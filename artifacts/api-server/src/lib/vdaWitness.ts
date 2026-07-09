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

const apiKey = () => process.env.WITNESS_API_KEY;
export function isVdaWitnessEnabled(): boolean {
  return Boolean(apiKey());
}
export function vdaWitnessInfo() {
  return { enabled: isVdaWitnessEnabled(), endpoint: MCP_URL, card: CARD_URL, keyless_verify: true };
}

interface McpOpts {
  auth?: boolean;
  timeoutMs?: number;
}
async function mcpCall(name: string, args: unknown, opts: McpOpts = {}): Promise<unknown> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.auth) {
    const k = apiKey();
    if (!k) throw new Error("WITNESS_API_KEY is not set — cannot call an authenticated VDA Witness tool.");
    headers["Authorization"] = `Bearer ${k}`;
  }
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  const resp = await fetch(MCP_URL, { method: "POST", headers, body, signal: AbortSignal.timeout(opts.timeoutMs ?? 12000) });
  const j = (await resp.json()) as { error?: { message: string }; result?: { content?: Array<{ text?: string }> } };
  if (j.error) throw new Error(j.error.message);
  const text = (j.result?.content ?? []).map((c) => c.text ?? "").join("");
  try {
    return JSON.parse(text);
  } catch {
    return text;
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
