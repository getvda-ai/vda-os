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

const base = (): string => process.env.WITNESS_BASE_URL || "https://witness.getvda.ai";
const AUTO_REFRESH = (process.env.WITNESS_AUTO_REFRESH ?? "true").toLowerCase() !== "false";
const KEY_EMAIL = process.env.WITNESS_KEY_EMAIL || "mikerawsonnz@gmail.com";

let cachedKey: string | null = null;
let didDoc: unknown = null;
let didAt = 0;

function currentKey(): string | null {
  return cachedKey || process.env.WITNESS_API_KEY || null;
}
export function isWitnessEnabled(): boolean {
  return Boolean(currentKey()) || AUTO_REFRESH;
}
function isAuthError(m: string): boolean {
  return /unknown api key|malformed api key|unauthorized|api key .*(expired|invalid)|invalid api key/i.test(m);
}
async function mintKey(): Promise<string | null> {
  if (!AUTO_REFRESH) return null;
  try {
    const r = await fetch(`${base()}/api/witness/test-key`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: KEY_EMAIL }), signal: AbortSignal.timeout(12000) });
    const j = (await r.json().catch(() => ({}))) as { apiKey?: string };
    if (j.apiKey) { cachedKey = j.apiKey; logger.info("[witness] minted fresh test-mode key"); return j.apiKey; }
    return null;
  } catch (err) { logger.warn({ err }, "[witness] key mint failed"); return null; }
}

export interface SealBody {
  decision: { agent: string; verdict: string; reasoning: string; inputs?: unknown; actionProposed?: string };
  governingRule: { ruleId: string; ruleText: string; governanceRef?: string; governanceHash?: string };
  chainKey: string;
  decisionId: string;
}
export interface SealOutcome { ok: boolean; record?: Record<string, unknown>; error?: string }

/** Seal via REST /seal (Bearer key; account derived server-side — no accountId). */
export async function sealRecord(body: SealBody): Promise<SealOutcome> {
  let key = currentKey();
  if (!key) key = await mintKey();
  if (!key) return { ok: false, error: "no VDA Witness key and auto-refresh off" };
  const call = async (k: string): Promise<Record<string, unknown>> => {
    const r = await fetch(`${base()}/api/witness/seal`, { method: "POST", headers: { Authorization: `Bearer ${k}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(12000) });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok || j.error) throw new Error(String((j.error as { message?: string })?.message ?? j.error ?? `http ${r.status}`));
    return (j.record as Record<string, unknown>) ?? (j.data as Record<string, unknown>) ?? j;
  };
  try {
    return { ok: true, record: await call(key) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (AUTO_REFRESH && isAuthError(msg)) {
      const fresh = await mintKey();
      if (fresh && fresh !== key) { try { return { ok: true, record: await call(fresh) }; } catch (e2) { return { ok: false, error: e2 instanceof Error ? e2.message : String(e2) }; } }
    }
    return { ok: false, error: msg };
  }
}

/** Pre-fetch (and cache 1h) the DID document so offline verify makes zero Witness calls. */
export async function getDidDocument(): Promise<unknown> {
  if (didDoc && Date.now() - didAt < 3_600_000) return didDoc;
  try {
    didDoc = await (await fetch(`${base()}/.well-known/did.json`, { signal: AbortSignal.timeout(10000) })).json();
    didAt = Date.now();
  } catch (err) { logger.warn({ err }, "[witness] could not fetch did.json"); }
  return didDoc;
}

/** REAL offline verify (SDK) — three-state, zero calls to Witness. */
export async function verifyOffline(record: unknown, chain?: unknown[], anchor?: unknown): Promise<Verdict | { state: string; detail: string }> {
  const dd = await getDidDocument();
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
