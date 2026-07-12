/**
 * witnessClient.ts — the Stay Agent's client for VDA Witness (witness.getvda.ai).
 *
 * Uses the `vda-witness` SDK for the REAL offline verifier (three-state:
 * ANCHORED_VALID / SIGNED_PENDING / BROKEN — zero calls back to Witness), and the
 * REST /seal endpoint for sealing (the SDK's seal() doesn't expose chainKey /
 * decisionId, which we need for per-property partitioning + idempotency).
 *
 * Contract (obeyed exactly): the API key IS the account — never send an accountId.
 * Key is sourced from GCP Secret Manager into WITNESS_API_KEY; test-tier keys are
 * self-serve and auto-refreshed on expiry. Sealing here is a plain POST; fail-open
 * + off-critical-path is provided by the seal-outbox that calls this.
 */
import { offlineVerify, type Verdict } from "vda-witness/verify";
import { logger } from "./logger.js";
// Bundled DID document (did:web:witness.getvda.ai) so offline verify makes ZERO
// network calls — even on a cold serverless start or with egress blocked. Refreshed
// opportunistically in the background; the bundled copy is always the fallback.
import bundledDid from "./witnessDid.json" with { type: "json" };

const base = (): string => process.env.WITNESS_BASE_URL || "https://witness.getvda.ai";
const AUTO_REFRESH = (process.env.WITNESS_AUTO_REFRESH ?? "true").toLowerCase() !== "false";
const KEY_EMAIL = process.env.WITNESS_KEY_EMAIL || "mikerawsonnz@gmail.com";
const EXPECTED_ACCOUNT = (): string | null => process.env.WITNESS_EXPECTED_ACCOUNT || null;

let cachedKey: string | null = null; // ONLY ever a bootstrap-minted key (no configured key present)
let boundAccount: string | null = null; // the account the loaded key resolves to
type KeyHealth = "unknown" | "ok" | "configured_key_rejected" | "account_mismatch" | "no_key";
let keyHealth: KeyHealth = "unknown";
let didDoc: unknown = null;
let didAt = 0;

/** The configured (seed) key from env / Secret Manager — this is the account binding. */
function configuredKey(): string | null { return process.env.WITNESS_API_KEY || null; }
function isConfigured(): boolean { return Boolean(configuredKey()); }
/**
 * Bootstrap minting is the legitimate self-serve on-ramp — permitted ONLY when NO
 * key is configured and NO account is pinned. When a key IS configured, we must use
 * it and only it; re-minting would spray seals into a fresh orphan account (the
 * scatter bug). Test keys expire ~hourly, so a configured key WILL be rejected on
 * "expired" — that must fail loud, never re-mint.
 */
function bootstrapAllowed(): boolean { return AUTO_REFRESH && !isConfigured() && !EXPECTED_ACCOUNT(); }
/** Configured key wins; only fall back to a bootstrap-minted key when none is configured. */
function currentKey(): string | null { return configuredKey() || cachedKey || null; }
export function isWitnessEnabled(): boolean { return Boolean(currentKey()) || bootstrapAllowed(); }
function isAuthError(m: string): boolean {
  return /unknown api key|malformed api key|unauthorized|api key .*(expired|invalid)|invalid api key|expired/i.test(m);
}
/** Bootstrap-only mint. Refuses when a key is configured or an account is pinned. */
async function bootstrapMint(): Promise<string | null> {
  if (!bootstrapAllowed()) return null; // NEVER mint over a configured/pinned key
  try {
    const r = await fetch(`${base()}/api/witness/test-key`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: KEY_EMAIL }), signal: AbortSignal.timeout(12000) });
    const j = (await r.json().catch(() => ({}))) as { apiKey?: string };
    if (j.apiKey) { cachedKey = j.apiKey; logger.info("[witness] bootstrap-minted test key (no configured key present)"); return j.apiKey; }
    return null;
  } catch (err) { logger.warn({ err }, "[witness] bootstrap mint failed"); return null; }
}

/** Health of the loaded Witness key + the account it is bound to (for /seal/health + badge). */
export function witnessKeyHealth(): { health: KeyHealth; boundAccount: string | null; expected: string | null; configured: boolean; red: boolean } {
  const red = keyHealth === "configured_key_rejected" || keyHealth === "account_mismatch" || keyHealth === "no_key";
  return { health: keyHealth, boundAccount, expected: EXPECTED_ACCOUNT(), configured: isConfigured(), red };
}

/**
 * Resolve the loaded key → account id via a cheap authed read, cache it, and assert
 * it equals WITNESS_EXPECTED_ACCOUNT (when pinned). Terminal on auth-rejection or
 * mismatch; transient (retryable) on network error. This is what makes a coherent
 * trail possible — a configured key can only ever resolve to ITS account.
 */
async function verifyAccountBinding(key: string): Promise<{ ok: boolean; account?: string; reason?: string; terminal?: boolean }> {
  if (keyHealth === "ok" && boundAccount) return { ok: true, account: boundAccount };
  let r: Response;
  try { r = await fetch(`${base()}/api/witness/records?chainKey=__acct_probe__`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000) }); }
  catch (e) { return { ok: false, reason: `account probe network error: ${e instanceof Error ? e.message : String(e)}` }; } // transient
  const j = (await r.json().catch(() => ({}))) as { account?: string; error?: string | { message?: string } };
  const errMsg = typeof j.error === "string" ? j.error : (j.error as { message?: string })?.message;
  if (!r.ok || errMsg) {
    if (isAuthError(errMsg || `http ${r.status}`)) { keyHealth = "configured_key_rejected"; return { ok: false, terminal: true, reason: `configured_key_rejected: ${errMsg || "http " + r.status}` }; }
    return { ok: false, reason: errMsg || `http ${r.status}` }; // transient
  }
  const acct = j.account ?? null;
  const expected = EXPECTED_ACCOUNT();
  if (expected && acct && acct !== expected) { keyHealth = "account_mismatch"; boundAccount = acct; return { ok: false, terminal: true, reason: `account_mismatch: loaded=${acct} expected=${expected}` }; }
  boundAccount = acct; keyHealth = "ok";
  return { ok: true, account: acct ?? undefined };
}

export interface SealBody {
  decision: { agent: string; verdict: string; reasoning: string; inputs?: unknown; actionProposed?: string };
  governingRule: { ruleId: string; ruleText: string; governanceRef?: string; governanceHash?: string };
  chainKey: string;
  decisionId: string;
}
export interface SealOutcome { ok: boolean; record?: Record<string, unknown>; error?: string; code?: string; terminal?: boolean }

/** Seal via REST /seal (Bearer key; account derived server-side — no accountId). */
export async function sealRecord(body: SealBody): Promise<SealOutcome> {
  let key = currentKey();
  if (!key) key = await bootstrapMint(); // (A) genuine no-key bootstrap ONLY
  if (!key) { keyHealth = "no_key"; return { ok: false, error: "no VDA Witness key configured", code: "no_key", terminal: false }; }

  // (A.3) Account pin — resolve + assert BEFORE sealing so we never seal into the
  // wrong account. A rejected/mismatched configured key is TERMINAL: do not mint,
  // do not reseal elsewhere; the drain dead-letters it and health goes red.
  const bind = await verifyAccountBinding(key);
  if (!bind.ok) {
    const code = keyHealth === "configured_key_rejected" ? "configured_key_rejected" : keyHealth === "account_mismatch" ? "account_mismatch" : "probe_error";
    return { ok: false, error: bind.reason, code, terminal: Boolean(bind.terminal) };
  }

  const call = async (k: string): Promise<Record<string, unknown>> => {
    const r = await fetch(`${base()}/api/witness/seal`, { method: "POST", headers: { Authorization: `Bearer ${k}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(12000) });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok || j.error) throw new Error(String((j.error as { message?: string })?.message ?? j.error ?? `http ${r.status}`));
    return (j.record as Record<string, unknown>) ?? (j.data as Record<string, unknown>) ?? j;
  };
  try {
    const record = await call(key);
    // Defense-in-depth: the sealed record must belong to the pinned account.
    const acct = (record as { account?: string }).account;
    const expected = EXPECTED_ACCOUNT();
    if (expected && acct && acct !== expected) { keyHealth = "account_mismatch"; return { ok: false, error: `account_mismatch post-seal: loaded=${acct} expected=${expected}`, code: "account_mismatch", terminal: true, record }; }
    refreshDidInBackground(); // warm the DID off the seal path, never off verify
    return { ok: true, record };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isAuthError(msg)) {
      if (isConfigured()) {
        // (B) THE FIX — a CONFIGURED key was rejected (malformed/unknown/expired/
        // invalid). HALT. Never mint, never reseal into a throwaway account. The
        // operation already completed; only the silent wrong-account "success" is
        // removed. Outbox dead-letters this as configured_key_rejected → health-red.
        keyHealth = "configured_key_rejected";
        logger.error({ decisionId: body.decisionId }, "[witness] CONFIGURED key rejected — halting seal (no re-mint, no account scatter)");
        return { ok: false, error: `configured_key_rejected: ${msg}`, code: "configured_key_rejected", terminal: true };
      }
      // Pure bootstrap (no configured key, no pin) → the minted key expired → a
      // re-mint is legitimate here (there is no account to stay coherent with).
      const fresh = await bootstrapMint();
      if (fresh && fresh !== key) { try { return { ok: true, record: await call(fresh) }; } catch (e2) { return { ok: false, error: e2 instanceof Error ? e2.message : String(e2) }; } }
    }
    return { ok: false, error: msg };
  }
}

let didRefreshing = false;
/**
 * Refresh the cached DID document in the background. Called ONLY from the seal/
 * drain path — never from verify — so verification stays strictly zero-call to
 * witness.getvda.ai. Safe no-op if already fresh or already refreshing.
 */
export function refreshDidInBackground(): void {
  if (didRefreshing || Date.now() - didAt < 3_600_000) return;
  didRefreshing = true;
  void fetch(`${base()}/.well-known/did.json`, { signal: AbortSignal.timeout(10000) })
    .then((r) => r.json())
    .then((doc) => { didDoc = doc; didAt = Date.now(); })
    .catch((err) => logger.warn({ err }, "[witness] did.json background refresh failed (bundled copy in use)"))
    .finally(() => { didRefreshing = false; });
}

/**
 * DID document for offline verification. Returns the in-memory cache, else the
 * BUNDLED copy — always local, ZERO network. Never triggers a fetch, so the verify
 * path can never call witness.getvda.ai (even cold or with egress blocked).
 */
export function getDidDocumentSync(): unknown {
  return didDoc ?? bundledDid;
}
/** Async shim kept for callers that awaited it; still zero-call on the hot path. */
export async function getDidDocument(): Promise<unknown> {
  return getDidDocumentSync();
}

/** REAL offline verify (SDK) — three-state, ZERO calls to witness.getvda.ai. */
export async function verifyOffline(record: unknown, chain?: unknown[], anchor?: unknown): Promise<Verdict | { state: string; detail: string }> {
  const dd = getDidDocumentSync();
  if (!dd) return { state: "BROKEN", detail: "DID document unavailable for offline verification" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return offlineVerify({ record: record as any, chain: (chain as any) ?? [record], didDocument: dd as any, anchor: anchor as any });
}

async function authedGet(path: string): Promise<Record<string, unknown>> {
  const key = currentKey();
  const r = await fetch(`${base()}${path}`, { headers: key ? { Authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(15000) });
  return (await r.json().catch(() => ({}))) as Record<string, unknown>;
}
/** Account-isolated trail read (by key; never pass an accountId). */
export async function fetchRecords(chainKey: string): Promise<Record<string, unknown>> {
  return authedGet(`/api/witness/records?chainKey=${encodeURIComponent(chainKey)}`);
}
export async function anchorStatus(): Promise<Record<string, unknown>> {
  return authedGet(`/api/witness/anchor-status`);
}
/** EU AI Act Article-12 evidence report — generated by Witness from the trail. */
export async function fetchReport(): Promise<Record<string, unknown>> {
  const key = currentKey();
  const r = await fetch(`${base()}/api/witness/report`, { method: "POST", headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(25000) });
  return (await r.json().catch(() => ({}))) as Record<string, unknown>;
}
