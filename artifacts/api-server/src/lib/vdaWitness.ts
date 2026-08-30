/**
 * vdaWitness.ts — client for the deployed VDA Witness service (witness.getvda.ai).
 *
 * VDA Witness is an external, independent A2A/MCP agent that seals governed
 * decisions into tamper-evident, Ed25519-signed, hash-chained evidence records
 * and produces EU AI Act Article 12 reports. The Stay Agent seals every governed
 * decision here (fire-and-forget) so its decisions carry an INDEPENDENT witness
 * on top of the platform's own Witness Stream.
 *
 * MCP endpoint + tools come from the agent card (/.well-known/agent.json):
 *   seal (key required) · verify (keyless) · report (key required)
 * Auth: WITNESS_API_KEY as a Bearer token. Sealing is skipped when unset.
 */
import { logger } from "./logger.js";

const MCP_URL = process.env.WITNESS_MCP_URL || "https://witness.getvda.ai/api/witness/mcp";
const CARD_URL = process.env.WITNESS_CARD_URL || "https://witness.getvda.ai/.well-known/agent.json";

// ── Self-healing key management ──────────────────────────────────────────────
// witness.getvda.ai test-mode keys are ephemeral (~hourly). We seed from
// WITNESS_API_KEY, cache a live key in-memory per instance, and mint a fresh
// test-mode key on demand / on any auth error — so seals never break on expiry.
const AUTO_REFRESH = (process.env.WITNESS_AUTO_REFRESH ?? "true").toLowerCase() !== "false";
const KEY_EMAIL = process.env.WITNESS_KEY_EMAIL || "mikerawsonnz@gmail.com";
const TEST_KEY_URL = (() => {
  try { return `${new URL(MCP_URL).origin}/api/witness/test-key`; }
  catch { return "https://witness.getvda.ai/api/witness/test-key"; }
})();

let cachedKey: string | null = null;
let lastMint = 0;
// Configured (seed) key wins; a bootstrap-minted key is used ONLY when none is
// configured. See witnessClient.ts for the full rationale — never re-mint over a
// configured key (that is the account-scatter bug).
function currentKey(): string | null {
  return process.env.WITNESS_API_KEY || cachedKey || null;
}
export function isVdaWitnessEnabled(): boolean {
  return Boolean(currentKey()) || AUTO_REFRESH;
}
export function vdaWitnessInfo() {
  return { enabled: isVdaWitnessEnabled(), endpoint: MCP_URL, card: CARD_URL, keyless_verify: true, auto_refresh: AUTO_REFRESH, minted: Boolean(cachedKey) };
}

/** Mint a fresh test-mode key (rate-limited to once per 5s) and cache it. */
async function mintTestKey(): Promise<string | null> {
  if (!AUTO_REFRESH) return null;
  // Bootstrap only: NEVER mint when a key is configured (that would spray reads/
  // seals into a fresh orphan account). A configured key that is rejected must fail
  // loud, not silently re-mint.
  if (process.env.WITNESS_API_KEY) return null;
  if (Date.now() - lastMint < 5000 && cachedKey) return cachedKey;
  lastMint = Date.now();
  try {
    const r = await fetch(TEST_KEY_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: KEY_EMAIL }),
      signal: AbortSignal.timeout(12000),
    });
    const j = (await r.json().catch(() => ({}))) as { apiKey?: string; api_key?: string; key?: string };
    const key = j.apiKey || j.api_key || j.key || null;
    if (key) { cachedKey = key; logger.info("[vdaWitness] minted fresh test-mode key"); }
    else logger.warn({ j }, "[vdaWitness] test-key mint returned no key");
    return key;
  } catch (err) {
    logger.warn({ err }, "[vdaWitness] test-key mint failed");
    return null;
  }
}

function isAuthError(msg: string): boolean {
  return /unknown api key|malformed api key|unauthorized|api key .*(expired|invalid)|invalid api key/i.test(msg);
}

interface McpOpts {
  auth?: boolean;
  timeoutMs?: number;
}
async function rawCall(name: string, args: unknown, timeoutMs: number, key?: string): Promise<unknown> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (key) headers["Authorization"] = `Bearer ${key}`;
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  const resp = await fetch(MCP_URL, { method: "POST", headers, body, signal: AbortSignal.timeout(timeoutMs) });
  const j = (await resp.json()) as { error?: { message: string }; result?: { content?: Array<{ text?: string }> } };
  if (j.error) throw new Error(j.error.message);
  const text = (j.result?.content ?? []).map((c) => c.text ?? "").join("");
  try { return JSON.parse(text); } catch { return text; }
}
async function mcpCall(name: string, args: unknown, opts: McpOpts = {}): Promise<unknown> {
  const timeoutMs = opts.timeoutMs ?? 12000;
  if (!opts.auth) return rawCall(name, args, timeoutMs); // keyless (verify)

  let key = currentKey();
  if (!key) key = await mintTestKey();
  if (!key) throw new Error("No VDA Witness API key and auto-refresh is off — cannot seal.");
  try {
    return await rawCall(name, args, timeoutMs, key);
  } catch (err) {
    // Key likely expired — mint a fresh one and retry once.
    if (AUTO_REFRESH && err instanceof Error && isAuthError(err.message)) {
      const fresh = await mintTestKey();
      if (fresh && fresh !== key) return await rawCall(name, args, timeoutMs, fresh);
    }
    throw err;
  }
}

export interface SealInput {
  decision: { agent: string; verdict: string; reasoning: string; actionProposed?: string; inputs?: unknown };
  governingRule: { ruleId: string; ruleText: string; governanceRef?: string; governanceHash?: string };
  chainKey?: string;
  decisionId?: string;
}

export async function sealDecision(input: SealInput): Promise<unknown> {
  return mcpCall("seal", input, { auth: true, timeoutMs: 15000 });
}
export async function verifyRecord(record: unknown): Promise<unknown> {
  return mcpCall("verify", { record }, { auth: false, timeoutMs: 15000 });
}
export async function verifyChain(records: unknown[]): Promise<unknown> {
  return mcpCall("verify", { records }, { auth: false, timeoutMs: 15000 });
}
export async function generateReport(): Promise<unknown> {
  return mcpCall("report", {}, { auth: true, timeoutMs: 25000 });
}

/** Best-effort extraction of the sealed record id from a seal response. */
export function extractRecordId(sealed: unknown): string | undefined {
  const s = sealed as { id?: string; recordId?: string; record?: { id?: string; recordId?: string } } | undefined;
  return s?.record?.id ?? s?.record?.recordId ?? s?.id ?? s?.recordId;
}

/** Fetch and lightly summarise the signed agent card (the "vcard"). */
export async function fetchWitnessCard(): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(CARD_URL, { signal: AbortSignal.timeout(10000) });
    return (await r.json()) as Record<string, unknown>;
  } catch (err) {
    logger.warn({ err }, "[vdaWitness] could not fetch agent card");
    return null;
  }
}
