/**
 * c2mdClient.ts — the Stay Agent's seam to the C2MD Compliance Agent
 * (c2md.getvda.ai), which owns the EU AI Act Article-by-Article Evidence &
 * Readiness Report. The Stay Agent orchestrates; C2MD generates. We do NOT rebuild
 * the Article logic.
 *
 * DISCOVERED CONTRACT (live, from /.well-known/agent-card.json — 2026-07):
 *   endpoint : POST https://c2md.getvda.ai/a2a   (A2A JSON-RPC 2.0, message/send)
 *   skill    : generate_evidence_readiness_report  (Free tier)
 *   auth     : google_oauth2 (Google Sign-In); assess/evidence skills are free-tier
 *   input    : agent_description (required), data_mode ∈ demo|customer, industry,
 *              jurisdictions
 *   trail authz: data_mode=customer REQUIRES `witness_api_key` — "that Bearer key is
 *              the sole account binding … account isolation inherited from Witness."
 *              There is NO report-passthrough input and NO scoped-grant input.
 *
 * GUARDRAIL (enforced in code, non-negotiable): the Witness account key is NEVER
 * sent to C2MD. The key IS the Witness account — sharing it hands over the whole
 * account. C2MD's only trail-backed mode (customer) requires exactly that key, so we
 * DELIBERATELY DO NOT use customer mode. We call demo mode only (synthetic, labelled
 * SAMPLE — DEMO DATA), and hard-assert no Witness key is ever in the outbound body.
 * Delivering an evidence-backed report from our real trail therefore needs C2MD to
 * add a report-passthrough or scoped-grant input — surfaced to the operator, not
 * worked around by leaking the key.
 */
import { logger } from "./logger.js";

const C2MD_BASE = process.env.C2MD_BASE_URL || "https://c2md.getvda.ai";

export const C2MD_CONTRACT = {
  endpoint: `${C2MD_BASE}/a2a`,
  transport: "A2A JSON-RPC 2.0 (message/send)",
  skill: "generate_evidence_readiness_report",
  auth: "google_oauth2 (free tier for the evidence skill)",
  trailAuthModel: "customer mode requires the raw Witness API key (witness_api_key) — no report-passthrough, no scoped grant",
  keyBlocked: true,
  usedMode: "demo" as const,
} as const;

export interface C2mdReportResult {
  ok: boolean;
  mode: "demo";
  /** Evidence-backed against OUR Witness trail? Always false in demo mode. */
  evidenceBacked: false;
  grade: "sample-demo-data";
  report?: unknown;
  markdown?: string;
  error?: string;
  contract: typeof C2MD_CONTRACT;
  /** Why the trail-backed (customer) report is not produced here. */
  customerModeBlocked: string;
}

const CUSTOMER_BLOCK =
  "C2MD's customer (trail-backed) mode requires the raw Witness API key, which the key IS the account — sending it would hand C2MD the whole account. C2MD's live contract offers no report-passthrough and no scoped read-grant, so an evidence-backed EU AI Act report cannot be produced without leaking the key. Not done. Demo mode (synthetic, SAMPLE — DEMO DATA) shown instead.";

/** Generate the EU AI Act Evidence & Readiness Report via C2MD — DEMO mode only, key-safe. */
export async function generateEuAiActReport(input: {
  agentDescription: string;
  industry?: string;
  jurisdictions?: string[];
}): Promise<C2mdReportResult> {
  // C2MD reads skill params from message.metadata; the agent card marks only
  // agent_description required and extra keys tightened validation in probing, so we
  // keep metadata minimal. We also mirror the params in a structured DataPart (some
  // A2A servers read there). NEVER include witness_api_key — that is customer mode =
  // handing over the whole account. industry/jurisdictions are intentionally omitted.
  const skillParams = {
    skill: "generate_evidence_readiness_report",
    data_mode: "demo" as const,
    agent_description: input.agentDescription,
  };
  void input.industry; void input.jurisdictions;
  const body = {
    jsonrpc: "2.0",
    id: "stay-agent-eu-ai-act",
    method: "message/send",
    params: {
      message: {
        role: "user",
        messageId: "stay-agent-eu-ai-act",
        parts: [
          { kind: "text", text: "EU AI Act Article-by-Article Evidence & Readiness Report, demo mode" },
          { kind: "data", data: skillParams },
        ],
        metadata: skillParams,
      },
      configuration: { blocking: true },
    },
  };
  const outbound = JSON.stringify(body);

  // HARD ASSERTION: the Witness key must never appear in anything sent to C2MD.
  const witnessKey = process.env.WITNESS_API_KEY;
  if (witnessKey && outbound.includes(witnessKey)) {
    logger.error("[c2md] refusing to send — Witness key present in outbound C2MD payload");
    return { ok: false, mode: "demo", evidenceBacked: false, grade: "sample-demo-data", error: "blocked: Witness key present in payload", contract: C2MD_CONTRACT, customerModeBlocked: CUSTOMER_BLOCK };
  }

  try {
    const r = await fetch(C2MD_CONTRACT.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: outbound,
      signal: AbortSignal.timeout(90_000),
    });
    const text = await r.text();
    let j: Record<string, unknown>;
    try { j = JSON.parse(text) as Record<string, unknown>; }
    catch { return { ok: false, mode: "demo", evidenceBacked: false, grade: "sample-demo-data", error: `C2MD returned non-JSON (HTTP ${r.status}): ${text.slice(0, 140)}`, contract: C2MD_CONTRACT, customerModeBlocked: CUSTOMER_BLOCK }; }

    if (j.error) {
      const e = j.error as { code?: number; message?: string };
      return { ok: false, mode: "demo", evidenceBacked: false, grade: "sample-demo-data", error: `C2MD error ${e.code ?? ""}: ${e.message ?? "unknown"}`, contract: C2MD_CONTRACT, customerModeBlocked: CUSTOMER_BLOCK };
    }
    // A2A result: extract a data part (report JSON) and/or a text part (markdown).
    const result = (j.result ?? j) as Record<string, unknown>;
    const parts = ((result.message as { parts?: unknown[] })?.parts ?? (result.parts as unknown[]) ?? []) as Array<Record<string, unknown>>;
    let report: unknown; let markdown: string | undefined;
    for (const p of parts) {
      if (p.kind === "data" && p.data) report = p.data;
      if (p.kind === "text" && typeof p.text === "string") markdown = p.text;
    }
    if (report === undefined && markdown === undefined) report = result; // fall back to whole result
    return { ok: true, mode: "demo", evidenceBacked: false, grade: "sample-demo-data", report, markdown, contract: C2MD_CONTRACT, customerModeBlocked: CUSTOMER_BLOCK };
  } catch (err) {
    return { ok: false, mode: "demo", evidenceBacked: false, grade: "sample-demo-data", error: err instanceof Error ? err.message : String(err), contract: C2MD_CONTRACT, customerModeBlocked: CUSTOMER_BLOCK };
  }
}
