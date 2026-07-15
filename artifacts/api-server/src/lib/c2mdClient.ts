/**
 * c2mdClient.ts — the Stay Agent's seam to the C2MD Compliance Agent
 * (c2md.getvda.ai), which owns the EU AI Act Article-by-Article Evidence & Readiness
 * Report. The Stay Agent orchestrates; C2MD generates. We do NOT rebuild the Article logic.
 *
 * LIVE CONTRACT (verified against /.well-known/agent-card.json and the live endpoint):
 *   endpoint : POST https://c2md.getvda.ai/a2a
 *   method   : "skills/<skill_id>"  — NOT "message/send". That method does not exist here;
 *              our old call only ever got as far as a param error, never reaching it.
 *   skill    : generate_evidence_readiness_report   (free tier: scope c2md:assess)
 *   auth     : C2MD tier 1 (live since 2026-07-15) accepts the VDA Witness key DIRECTLY as an
 *              HTTP Bearer credential — securityScheme "witness_bearer", format
 *              wtn.<keyId>.<secret>, scope c2md:assess. This is a getvda.ai SUITE credential:
 *              C2MD validates it against witness.getvda.ai (a forged/revoked key is rejected
 *              -32004 "Witness key rejected"). OAuth2 (Google / Entra) still works but is no
 *              longer needed. C2MD validates params FIRST and auth SECOND.
 *
 * KEY-HANDLING POSTURE (revised, deliberate). The earlier module refused to let the Witness
 * key leave this process, because sending it as a skill PARAM would hand an arbitrary third
 * party the whole account. That reasoning is intact for params — the key is never a param. But
 * C2MD is now a sanctioned first-party consumer of the suite credential via the Authorization
 * header: it authenticates the key against Witness and, per its own contract, rejects a key
 * placed in params. So the key may travel as an Authorization: Bearer header to C2MD's own
 * origin ONLY, and never in a body, never in a param, never to any other host.
 *
 * TWO CALLS:
 *   assessAgentRisk  — skill assess_agent_risk. Diagnostic risk classification (Annex III,
 *                      provider/deployer role, DPIA/FRIA, control map). Free tier, works with a
 *                      SEALED key today. This is the evidence-readiness SCOPE.
 *   generateEuAiActReport — skill generate_evidence_readiness_report, ATTESTED mode: we hand
 *                      C2MD our own chain-proof bundle (no key in the body) and it verifies the
 *                      evidence offline. Full bundle generation needs the ANCHORED tier.
 *
 * LATENCY (measured live, flag for callers): a successful assess LLM call takes ~51-55s, plus
 * ~10s cold-start on a scaled-to-zero C2MD instance. Client timeouts and any serverless
 * function maxDuration MUST budget for this or the call 504s before C2MD answers.
 */
import { logger } from "./logger.js";
import { fetchChainProof, fetchReport, currentWitnessKey } from "./witnessClient.js";

const C2MD_BASE = process.env.C2MD_BASE_URL || "https://c2md.getvda.ai";
const SKILL = "generate_evidence_readiness_report";
/** OAuth2 bearer for C2MD, if configured. Optional now that witness_bearer works. */
const c2mdToken = (): string => (process.env.C2MD_ACCESS_TOKEN || "").trim();
/** The auth header C2MD accepts: an explicit OAuth token if set, else the Witness suite key.
 *  The key rides ONLY in this header, ONLY to C2MD's origin — never in a param or body. */
const c2mdAuthHeader = (): string | null => {
  const oauth = c2mdToken();
  if (oauth) return `Bearer ${oauth}`;
  const wk = currentWitnessKey();
  return wk ? `Bearer ${wk}` : null;
};

/** C2MD input enums (strict — a value off-list fails the governance gate with -32600). */
export const C2MD_DATA_CATEGORIES = ["special_category_gdpr_art9", "employment_data", "financial_data", "children_data", "biometric", "health_data", "no_personal_data"] as const;
export const C2MD_AUTONOMY_LEVELS = ["advisory", "assistive", "autonomous"] as const;

export const C2MD_CONTRACT = {
  endpoint: `${C2MD_BASE}/a2a`,
  transport: "A2A JSON-RPC 2.0 (skills/<skill_id>)",
  skill: SKILL,
  auth: "witness_bearer — the VDA Witness suite key as Authorization: Bearer wtn.<keyId>.<secret>, scope c2md:assess (free tier). OAuth2 (Google/Entra) also accepted.",
  trailAuthModel: "The Witness key authenticates to C2MD (a sibling getvda.ai suite service) as an Authorization header only; it is never placed in a skill param or body, and attested mode still rejects a key in params.",
  keyBlocked: false,
  usedMode: "witness_bearer" as const,
} as const;

export interface C2mdReportResult {
  ok: boolean;
  mode: "attested";
  /** True ONLY when C2MD returned a report generated from our own sealed trail. */
  evidenceBacked: boolean;
  grade: string;
  chainKey?: string;
  proof?: { records: number; anchored: boolean; head?: string };
  report?: unknown;
  markdown?: string;
  error?: string;
  contract: typeof C2MD_CONTRACT;
  /** Present only when no report was produced — the real reason, stated plainly. */
  blocked?: string;
}

const fail = (error: string, blocked: string, extra: Partial<C2mdReportResult> = {}): C2mdReportResult => ({
  ok: false, mode: "attested", evidenceBacked: false, grade: "not-produced",
  error, blocked, contract: C2MD_CONTRACT, ...extra,
});

export interface C2mdAssessResult {
  ok: boolean;
  skill: "assess_agent_risk";
  /** The diagnostic assessment (ai_act_assessment, gdpr_assessment, required_formal_deliverables, ...). */
  assessment?: Record<string, unknown>;
  error?: string;
  /** Present only when no assessment was produced — the real reason, stated plainly. */
  blocked?: string;
  latencyMs?: number;
  contract: typeof C2MD_CONTRACT;
}

/**
 * C2MD tier-1 risk assessment (skill assess_agent_risk) — diagnostic only, free tier.
 *
 * Authenticated with the Witness suite key via the Authorization header (see c2mdAuthHeader).
 * Nothing is fabricated on failure: the reason is returned verbatim and no assessment is shown.
 *
 * Latency budget is deliberately large (~55s generation + ~10s cold-start observed live). The
 * caller's own timeout — and any serverless maxDuration — must exceed this or the call 504s.
 */
export async function assessAgentRisk(input: {
  agentDescription: string;
  jurisdictions: string[];
  dataCategories: Array<(typeof C2MD_DATA_CATEGORIES)[number]>;
  autonomyLevel: (typeof C2MD_AUTONOMY_LEVELS)[number];
  industry?: string;
}): Promise<C2mdAssessResult> {
  const auth = c2mdAuthHeader();
  if (!auth) {
    return { ok: false, skill: "assess_agent_risk", error: "no credential available", blocked: "No Witness key (or C2MD OAuth token) is configured, so C2MD cannot authenticate the call. Set WITNESS_API_KEY (or C2MD_ACCESS_TOKEN). No assessment produced.", contract: C2MD_CONTRACT };
  }

  const body = {
    jsonrpc: "2.0",
    id: "stay-agent-assess",
    method: `skills/assess_agent_risk`,
    params: {
      agent_description: input.agentDescription,
      jurisdictions: input.jurisdictions,
      data_categories: input.dataCategories, // strict enum — see C2MD_DATA_CATEGORIES
      autonomy_level: input.autonomyLevel,   // strict enum — see C2MD_AUTONOMY_LEVELS
      ...(input.industry ? { industry: input.industry } : {}),
      // The Witness key is NOT here. It rides in the Authorization header only; C2MD rejects
      // a key placed in params, and embedding it in a body would be the leak we guard against.
    },
  };

  const t0 = Date.now();
  try {
    const r = await fetch(C2MD_CONTRACT.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: auth },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(150_000), // C2MD assess runs ~55s + cold start; do not clip it
    });
    const latencyMs = Date.now() - t0;
    const text = await r.text();
    let j: Record<string, unknown>;
    try { j = JSON.parse(text) as Record<string, unknown>; }
    catch { return { ok: false, skill: "assess_agent_risk", error: `C2MD returned non-JSON (HTTP ${r.status}): ${text.slice(0, 160)}`, blocked: "C2MD did not return a JSON-RPC response. No assessment produced.", latencyMs, contract: C2MD_CONTRACT }; }

    if (j.error) {
      const e = j.error as { code?: number; message?: string };
      const msg = `C2MD error ${e.code ?? ""}: ${String(e.message ?? "unknown").split("\n")[0]}`;
      const blocked = e.code === -32004
        ? "C2MD rejected the credential. If this is 'Witness key rejected', the key may be invalid or revoked; if 'Invalid audience', no credential reached C2MD."
        : "C2MD refused the request. Its error is shown verbatim — nothing softened, no assessment substituted.";
      return { ok: false, skill: "assess_agent_risk", error: msg, blocked, latencyMs, contract: C2MD_CONTRACT };
    }

    // A2A envelope: { result: { content, content_type, skill_id } } — the assessment is `content`.
    const result = (j.result ?? {}) as Record<string, unknown>;
    const assessment = (result.content ?? result) as Record<string, unknown>;
    return { ok: true, skill: "assess_agent_risk", assessment, latencyMs, contract: C2MD_CONTRACT };
  } catch (err) {
    const latencyMs = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    const blocked = /timeout|abort/i.test(msg)
      ? `The C2MD call did not return within the client timeout (${latencyMs}ms elapsed). assess_agent_risk runs ~55s; if this recurs the timeout — or a serverless function's maxDuration — is set too low.`
      : "The C2MD call failed. No assessment produced.";
    return { ok: false, skill: "assess_agent_risk", error: msg, blocked, latencyMs, contract: C2MD_CONTRACT };
  }
}

/**
 * Generate the EU AI Act Evidence & Readiness Report via C2MD — ATTESTED mode: key-safe and
 * evidence-backed against our real Witness trail.
 *
 * Nothing is fabricated on failure. If the proof bundle is unavailable or C2MD refuses, the
 * reason is returned verbatim and NO report is shown. We never silently substitute a synthetic
 * demo report and present it as if it were the best obtainable answer.
 */
export async function generateEuAiActReport(input: {
  chainKey: string;
  jurisdictions?: string[];
  dataCategories?: string[];
  autonomyLevel?: string;
}): Promise<C2mdReportResult> {
  // 1. Our own evidence: the chain-proof bundle + the Art-12 report Witness derives from it.
  //    attested needs NO agent_description — C2MD derives the agent from the verified evidence.
  let proofBundle: Record<string, unknown>;
  let witnessReport: Record<string, unknown>;
  try {
    [proofBundle, witnessReport] = await Promise.all([fetchChainProof(input.chainKey), fetchReport(input.chainKey)]);
  } catch (err) {
    return fail(
      `could not read our own chain proof: ${err instanceof Error ? err.message : String(err)}`,
      "The Witness chain-proof bundle could not be fetched, so there is nothing to attest. No report produced — nothing synthesised in its place.",
      { chainKey: input.chainKey },
    );
  }

  const records = (proofBundle.records as unknown[] | undefined) ?? [];
  if (!records.length) {
    return fail(
      "empty chain — no sealed records to attest",
      "This chain has no sealed records, so an evidence-backed report would have nothing to evidence (C2MD would return INSUFFICIENT_PROOF). No report produced.",
      { chainKey: input.chainKey, proof: { records: 0, anchored: false } },
    );
  }
  const anchor = (proofBundle.anchor ?? {}) as { head?: string; rekor?: unknown };
  const proofSummary = { records: records.length, anchored: Boolean(anchor.rekor), head: anchor.head };

  const body = {
    jsonrpc: "2.0",
    id: "stay-agent-eu-ai-act",
    method: `skills/${SKILL}`,
    params: {
      data_mode: "attested",
      witness_proof_bundle: proofBundle,
      witness_report: witnessReport,
      jurisdictions: input.jurisdictions ?? ["EU"],
      // Strict enum — "customer_data" is NOT a member and fails the governance gate (-32600).
      // A hotel handles payment references → financial_data.
      data_categories: input.dataCategories ?? ["financial_data"],
      autonomy_level: input.autonomyLevel ?? "assistive",
      // NO witness_api_key in params, NO agent_description. The key authenticates via the
      // Authorization header (below); attested rejects a key placed in params.
    },
  };
  const outbound = JSON.stringify(body);

  // HARD ASSERTION: the key rides in the Authorization header, never in the body. If it ever
  // appears in the serialised params, that is a leak — refuse.
  const witnessKey = currentWitnessKey();
  if (witnessKey && outbound.includes(witnessKey)) {
    logger.error("[c2md] refusing to send — Witness key present in outbound body");
    return fail(
      "blocked: Witness key present in body",
      "Refused to send: the Witness key appeared in the request body. It may only travel as an Authorization header to C2MD, never as a param.",
      { chainKey: input.chainKey, proof: proofSummary },
    );
  }

  const auth = c2mdAuthHeader();
  if (!auth) {
    return fail(
      "no credential available (WITNESS_API_KEY or C2MD_ACCESS_TOKEN)",
      "C2MD authenticates every call. With no Witness key and no OAuth token configured it answers -32004. Set WITNESS_API_KEY. No report produced; nothing synthesised in its place.",
      { chainKey: input.chainKey, proof: proofSummary },
    );
  }

  try {
    const r = await fetch(C2MD_CONTRACT.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: auth },
      body: outbound,
      signal: AbortSignal.timeout(150_000), // generation is slow; do not clip it
    });
    const text = await r.text();
    let j: Record<string, unknown>;
    try { j = JSON.parse(text) as Record<string, unknown>; }
    catch {
      return fail(`C2MD returned non-JSON (HTTP ${r.status}): ${text.slice(0, 160)}`, "C2MD did not return a JSON-RPC response. No report produced.", { chainKey: input.chainKey, proof: proofSummary });
    }

    if (j.error) {
      const e = j.error as { code?: number; message?: string };
      return fail(
        `C2MD error ${e.code ?? ""}: ${e.message ?? "unknown"}`,
        "C2MD refused the attested request. Its error is shown verbatim — nothing softened, and no demo report substituted in its place.",
        { chainKey: input.chainKey, proof: proofSummary },
      );
    }

    const result = (j.result ?? {}) as Record<string, unknown>;
    const report = (result.report ?? result.data ?? result) as unknown;
    const markdown = typeof result.markdown === "string" ? result.markdown : undefined;
    const grade = String(result.grade ?? result.verdict ?? "evidence-backed");
    return { ok: true, mode: "attested", evidenceBacked: true, grade, chainKey: input.chainKey, proof: proofSummary, report, markdown, contract: C2MD_CONTRACT };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err), "The C2MD call failed. No report produced; nothing synthesised in its place.", { chainKey: input.chainKey, proof: proofSummary });
  }
}
