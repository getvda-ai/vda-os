/**
 * witnessClient.ts — the Stay Agent's client for VDA Witness (witness.getvda.ai).
 *
 * Uses the `vda-witness` SDK for the REAL offline verifier (three-state:
 * ANCHORED_VALID / SIGNED_PENDING / BROKEN — zero calls back to Witness), and the
 * REST /seal endpoint for sealing (the SDK's seal() doesn't expose chainKey /
 * decisionId, which we need for per-property partitioning + idempotency).
 *
 * Contract (obeyed exactly): the API key IS the account — never send an accountId.
 * The account is a DURABLE identity pinned by WITNESS_EXPECTED_ACCOUNT and re-keyed
 * unattended by proving control of the bound Ed25519 controller key
 * (WITNESS_CONTROLLER_PRIVATE_JWK): challenge → sign → renew → fresh key, SAME
 * account. There is NO minting on the seal path — a rejected key renews or fails
 * loud, never scatters into a new account. Fail-open + off-critical-path is provided
 * by the seal-outbox that calls this.
 */
import { createPrivateKey, sign as edSign } from "node:crypto";
import { offlineVerify, type Verdict } from "vda-witness/verify";
import { logger } from "./logger.js";
// Bundled DID document (did:web:witness.getvda.ai) so offline verify makes ZERO
// network calls — even on a cold serverless start or with egress blocked. Refreshed
// opportunistically in the background; the bundled copy is always the fallback.
import bundledDid from "./witnessDid.json" with { type: "json" };

const base = (): string => process.env.WITNESS_BASE_URL || "https://witness.getvda.ai";
const EXPECTED_ACCOUNT = (): string | null => process.env.WITNESS_EXPECTED_ACCOUNT || null;
const RENEW_DOMAIN = "vda.witness.renew/1"; // exact domain-separated prefix — do not change

let cachedKey: string | null = null; // the current key — a RENEWED key for the pinned account (never a mint)
let keyExpiresAt = 0; // ms epoch when cachedKey expires (0 = unknown / configured long-lived seed)
let boundAccount: string | null = null; // the account the loaded key resolves to
type KeyHealth = "unknown" | "ok" | "configured_key_rejected" | "account_mismatch" | "renewal_failed" | "no_key";
let keyHealth: KeyHealth = "unknown";
/** Read keyHealth opaquely — it is mutated inside renewKey()/doRenew(), which TS's
 * control-flow analysis cannot see, so direct comparisons after those calls falsely
 * narrow. This helper keeps comparisons honest. */
const health = (): KeyHealth => keyHealth;
let didDoc: unknown = null;
let didAt = 0;

/** The configured (seed) key from env / Secret Manager — the initial account binding. */
function configuredKey(): string | null { return process.env.WITNESS_API_KEY || null; }
function isConfigured(): boolean { return Boolean(configuredKey()); }
/** A freshly-renewed key (same account) wins; else the configured long-lived seed. */
function currentKey(): string | null { return cachedKey || configuredKey() || null; }
export function isWitnessEnabled(): boolean { return Boolean(currentKey()) || canRenew(); }
function isAuthError(m: string): boolean {
  return /unknown api key|malformed api key|unauthorized|api key .*(expired|invalid)|invalid api key|expired|401/i.test(m);
}

// ── Controller-key renewal (durable account, no standing secret, no human) ─────
// The account is durable and re-keyed by proving control of the bound Ed25519
// controller key: challenge → sign("vda.witness.renew/1|<acct>|<nonce>") → renew →
// fresh 24h key for the SAME account. There is NO minting anywhere on the seal path.
let controllerKeyObj: import("node:crypto").KeyObject | null | undefined;
function controllerPrivateKey(): import("node:crypto").KeyObject | null {
  if (controllerKeyObj !== undefined) return controllerKeyObj;
  const raw = process.env.WITNESS_CONTROLLER_PRIVATE_JWK;
  if (!raw) { controllerKeyObj = null; return null; }
  try { controllerKeyObj = createPrivateKey({ key: JSON.parse(raw), format: "jwk" }); }
  catch (err) { logger.error({ err }, "[witness] controller private JWK is unparseable — renewal disabled"); controllerKeyObj = null; }
  return controllerKeyObj;
}
/** Renewal is possible only with a controller key AND a pinned account (never moves accounts). */
function canRenew(): boolean { return Boolean(controllerPrivateKey() && EXPECTED_ACCOUNT()); }

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
function jitterMs(attempt: number): number { return Math.round(400 * 2 ** attempt + Math.random() * 400); }

let renewing: Promise<{ ok: boolean; key?: string; reason?: string; terminal?: boolean }> | null = null;
/** Single-flight renewal: concurrent seals share ONE in-flight renewal (no 429 storm). */
function renewKey(): Promise<{ ok: boolean; key?: string; reason?: string; terminal?: boolean }> {
  if (renewing) return renewing;
  renewing = doRenew().finally(() => { renewing = null; });
  return renewing;
}
async function doRenew(): Promise<{ ok: boolean; key?: string; reason?: string; terminal?: boolean }> {
  const ctl = controllerPrivateKey();
  const acct = EXPECTED_ACCOUNT();
  if (!ctl || !acct) return { ok: false, reason: "renewal not configured (need controller key + WITNESS_EXPECTED_ACCOUNT)", terminal: true };
  const B = base();
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      // 1) challenge (unauthenticated; per-IP burst-limited — back off on 429)
      const chR = await fetch(`${B}/api/witness/renew/challenge`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId: acct }), signal: AbortSignal.timeout(12000) });
      if (chR.status === 429) { await sleep(jitterMs(attempt)); continue; }
      const ch = (await chR.json().catch(() => ({}))) as { nonce?: string };
      if (!ch.nonce) return { ok: false, reason: `renew challenge failed: http ${chR.status}` };
      // 2) sign the EXACT domain-separated string with the controller private key
      const sig = edSign(null, Buffer.from(`${RENEW_DOMAIN}|${acct}|${ch.nonce}`, "utf8"), ctl).toString("base64url");
      // 3) renew → fresh short-TTL key, SAME account
      const rnR = await fetch(`${B}/api/witness/renew`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId: acct, nonce: ch.nonce, signature: sig }), signal: AbortSignal.timeout(12000) });
      if (rnR.status === 429) { await sleep(jitterMs(attempt)); continue; }
      const rn = (await rnR.json().catch(() => ({}))) as { apiKey?: string; accountId?: string; keyExpiresAt?: string; keyTtlSec?: number };
      if (!rnR.ok || !rn.apiKey) return { ok: false, reason: `renew failed: http ${rnR.status}` };
      // 4) the pin still governs — renewal must NEVER move accounts
      if (rn.accountId && rn.accountId !== acct) { keyHealth = "account_mismatch"; boundAccount = rn.accountId; return { ok: false, terminal: true, reason: `renew returned different account: ${rn.accountId} (expected ${acct})` }; }
      cachedKey = rn.apiKey;
      keyExpiresAt = rn.keyExpiresAt ? Date.parse(rn.keyExpiresAt) : Date.now() + (rn.keyTtlSec ?? 86400) * 1000;
      boundAccount = acct; keyHealth = "ok";
      logger.info({ account: acct }, "[witness] renewed key via controller (same account, no human)");
      return { ok: true, key: rn.apiKey };
    } catch (err) {
      if (attempt < 3) { await sleep(jitterMs(attempt)); continue; }
      return { ok: false, reason: `renew error: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
  return { ok: false, reason: "renew throttled (429) after retries" }; // transient — retry next drain
}

/**
 * Eagerly resolve the key → account binding with a cheap authenticated probe (renewing
 * first if needed) so /seal/health + the tier badge are informative on a COLD instance
 * without waiting for a seal. No-op once resolved. Never throws.
 */
export async function resolveBinding(): Promise<void> {
  if (keyHealth === "ok" && boundAccount) return;
  try {
    let key = currentKey();
    if (!key && canRenew()) { const r = await renewKey(); if (r.ok) key = r.key ?? null; }
    if (!key) return;
    const bind = await verifyAccountBinding(key);
    if (!bind.ok && health() === "configured_key_rejected" && canRenew()) {
      keyHealth = "unknown"; boundAccount = null;
      await renewKey(); // a successful renew resolves the binding (sets health=ok)
    }
  } catch { /* health is advisory — never throw */ }
}

/** Health of the loaded Witness key + the account it is bound to (for /seal/health + badge). */
export function witnessKeyHealth(): { health: KeyHealth; boundAccount: string | null; expected: string | null; configured: boolean; renewable: boolean; keyExpiresAt: number; red: boolean } {
  const red = health() === "configured_key_rejected" || health() === "account_mismatch" || keyHealth === "renewal_failed" || keyHealth === "no_key";
  return { health: keyHealth, boundAccount, expected: EXPECTED_ACCOUNT(), configured: isConfigured(), renewable: canRenew(), keyExpiresAt, red };
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
  // Cold start with no key (agent holds only controller key + accountId) → RENEW,
  // never mint. Renewal recovers a fresh key for the SAME pinned account.
  if (!key && canRenew()) {
    const r = await renewKey();
    if (r.ok) key = r.key ?? null;
    else { if (health() !== "account_mismatch") keyHealth = "renewal_failed"; return { ok: false, error: r.reason, code: health() === "account_mismatch" ? "account_mismatch" : "renewal_failed", terminal: Boolean(r.terminal) }; }
  }
  if (!key) { keyHealth = "no_key"; return { ok: false, error: "no VDA Witness key and no controller key to renew", code: "no_key", terminal: false }; }

  // Proactively renew a renewed key that is within 2 min of expiry (overlap → no gap).
  if (canRenew() && keyExpiresAt > 0 && Date.now() > keyExpiresAt - 120_000) {
    const r = await renewKey();
    if (r.ok && r.key) key = r.key;
  }

  // (A.3) Account pin — resolve + assert BEFORE sealing so we never seal into the
  // wrong account. Terminal on rejection/mismatch → drain dead-letters, health-red.
  let bind = await verifyAccountBinding(key);
  // If the pre-flight probe found the key expired/invalid, RENEW (same account) and
  // re-bind — never mint. A successful renew sets keyHealth=ok, so re-bind shortcuts.
  if (!bind.ok && health() === "configured_key_rejected" && canRenew()) {
    keyHealth = "unknown"; boundAccount = null;
    const r = await renewKey();
    if (r.ok && r.key) { key = r.key; bind = await verifyAccountBinding(key); }
    else { if (health() !== "account_mismatch") keyHealth = "renewal_failed"; return { ok: false, error: `renewal_failed: ${r.reason}`, code: health() === "account_mismatch" ? "account_mismatch" : "renewal_failed", terminal: Boolean(r.terminal) }; }
  }
  if (!bind.ok) {
    const code = health() === "configured_key_rejected" ? "configured_key_rejected" : health() === "account_mismatch" ? "account_mismatch" : "probe_error";
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
      // The current key was rejected (expired/invalid). RENEW (same account, no
      // human) and retry ONCE — never mint. Single-flight dedupes concurrent seals.
      if (canRenew()) {
        const r = await renewKey();
        if (r.ok && r.key && r.key !== key) {
          try { const record = await call(r.key); refreshDidInBackground(); return { ok: true, record }; }
          catch (e2) { return { ok: false, error: `post-renew seal failed: ${e2 instanceof Error ? e2.message : String(e2)}`, code: "renewal_failed", terminal: false }; }
        }
        // Renewal itself failed → fail loud (dead-letter), never mint. Op still ok.
        if (health() !== "account_mismatch") keyHealth = "renewal_failed";
        logger.error({ decisionId: body.decisionId, reason: r.reason }, "[witness] key rejected AND renewal failed — halting seal (no mint)");
        return { ok: false, error: `renewal_failed: ${r.reason}`, code: health() === "account_mismatch" ? "account_mismatch" : "renewal_failed", terminal: Boolean(r.terminal) };
      }
      // No controller key to renew with → fail loud (never mint). Op still completes.
      keyHealth = "configured_key_rejected";
      logger.error({ decisionId: body.decisionId }, "[witness] key rejected and no controller key — halting seal (no mint, no scatter)");
      return { ok: false, error: `configured_key_rejected: ${msg}`, code: "configured_key_rejected", terminal: true };
    }
    return { ok: false, error: msg }; // transient
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
/** Account-isolated trail read (by key; never pass an accountId).
 *  `view=full` returns each record's signed body + proof + prevHash + signer — the
 *  material an offline verifier needs. The default `view=summary` omits all of it
 *  (no proof, no prevHash, no decision), so a record read that way can NEVER verify:
 *  it is a display projection, not evidence. `?full=true` is silently ignored by
 *  Witness — the parameter is `view`. */
export async function fetchRecords(chainKey: string, view: "summary" | "full" = "summary"): Promise<Record<string, unknown>> {
  return authedGet(`/api/witness/records?chainKey=${encodeURIComponent(chainKey)}&view=${view}`);
}
/** The chain-proof bundle: records + predecessor path + anchor (Rekor + TSA tokens) +
 *  didDocument — everything a third party needs to verify our trail OFFLINE, without our
 *  key and without calling Witness. This is what makes C2MD's attested mode key-safe. */
export async function fetchChainProof(chainKey: string): Promise<Record<string, unknown>> {
  return authedGet(`/api/witness/chains/${encodeURIComponent(chainKey)}/proof`);
}
/** Anchor status, optionally scoped to a single chain (account by key; no accountId). */
export async function anchorStatus(chainKey?: string): Promise<Record<string, unknown>> {
  return authedGet(`/api/witness/anchor-status${chainKey ? `?chainKey=${encodeURIComponent(chainKey)}` : ""}`);
}
/** EU AI Act Article-12 evidence report — generated by Witness from the trail,
 *  optionally scoped to a single chainKey (account by key; never an accountId). */
export async function fetchReport(chainKey?: string): Promise<Record<string, unknown>> {
  const key = currentKey();
  const r = await fetch(`${base()}/api/witness/report`, { method: "POST", headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), "Content-Type": "application/json" }, body: chainKey ? JSON.stringify({ chainKey }) : "{}", signal: AbortSignal.timeout(25000) });
  return (await r.json().catch(() => ({}))) as Record<string, unknown>;
}
