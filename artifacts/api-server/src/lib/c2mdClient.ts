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
 *   auth     : OAuth2 REQUIRED — Google Sign-In (authorizationCode) or Microsoft Entra
 *              (clientCredentials for machine callers). C2MD validates params FIRST and auth
 *              SECOND, so a call with bad params hides the fact that auth is also needed.
 *   modes    : demo      — synthetic; REQUIRES agent_description (omitting it is -32602)
 *              customer  — reads our trail via Witness; REQUIRES witness_api_key
 *              attested  — KEY-SAFE: we supply our OWN chain-proof bundle; no key at all
 *
 * WHY ATTESTED. Sending witness_api_key (customer mode) would hand C2MD our entire Witness
 * account — the key IS the account. Attested exists precisely to avoid that: we pass the
 * chain-proof bundle (records + predecessor path + anchor + didDocument) which C2MD verifies
 * OFFLINE against pinned public infrastructure (did:web + Rekor/TSA, zero calls to Witness),
 * and it REJECTS a witness_api_key if one is sent. The report is therefore evidence-backed
 * against our real trail AND the key never leaves this process. Article 12 is graded strictly
 * off the verified verdict: ANCHORED_VALID earns anchored language, SIGNED_PENDING reads
 * "readiness — not yet anchored", a tampered bundle is refused, an incomplete one returns
 * INSUFFICIENT_PROOF.
 *
 * This module used to call demo mode and tell the operator that an evidence-backed report
 * "cannot be produced without leaking the key". That was true before attested shipped; it is
 * false now. Worse, it called demo WITHOUT agent_description — which demo requires — so the
 * panel displayed a -32602 underneath a stale refusal to even attempt the mode that works.
 *
 * GUARDRAIL (unchanged, non-negotiable): the Witness key is NEVER sent to C2MD. Asserted on
 * the serialised payload before the request leaves.
 */
import { logger } from "./logger.js";
import { fetchChainProof, fetchReport } from "./witnessClient.js";

const C2MD_BASE = process.env.C2MD_BASE_URL || "https://c2md.getvda.ai";
const SKILL = "generate_evidence_readiness_report";
/** OAuth2 bearer for C2MD (Google Sign-In / MS service principal). NOT the Witness key. */
const c2mdToken = (): string => (process.env.C2MD_ACCESS_TOKEN || "").trim();

export const C2MD_CONTRACT = {
  endpoint: `${C2MD_BASE}/a2a`,
  transport: "A2A JSON-RPC 2.0 (skills/<skill_id>)",
  skill: SKILL,
  auth: "OAuth2 required — Google Sign-In or Microsoft Entra, scope c2md:assess (free tier)",
  trailAuthModel: "attested — we supply our own Witness chain-proof bundle; C2MD verifies it offline and rejects a witness_api_key. The key never leaves the Stay Agent.",
  keyBlocked: true,
  usedMode: "attested" as const,
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
      data_categories: input.dataCategories ?? ["customer_data"],
      autonomy_level: input.autonomyLevel ?? "assistive",
      // NO witness_api_key, NO agent_description — both deliberate. The first would hand over
      // the account; the second is a demo-mode input that attested neither needs nor accepts.
    },
  };
  const outbound = JSON.stringify(body);

  // HARD ASSERTION: the Witness key must never appear in anything sent to C2MD.
  const witnessKey = process.env.WITNESS_API_KEY;
  if (witnessKey && outbound.includes(witnessKey)) {
    logger.error("[c2md] refusing to send — Witness key present in outbound payload");
    return fail(
      "blocked: Witness key present in payload",
      "Refused to send: the Witness account key appeared in the outbound body. The key IS the account; it is never shared.",
      { chainKey: input.chainKey, proof: proofSummary },
    );
  }

  const token = c2mdToken();
  if (!token) {
    // Name what is actually missing. C2MD auth-checks every call whose params validate, so
    // without a token NEITHER attested NOR demo can return a report. This is a credential gap
    // — not a limitation of attested mode, and not a key-sharing problem.
    return fail(
      "no C2MD OAuth token configured (C2MD_ACCESS_TOKEN)",
      "C2MD requires an OAuth2 token on every call (Google Sign-In or Microsoft Entra, scope c2md:assess); without one it answers -32004. The attested request is otherwise complete and key-safe — it needs only a token. Set C2MD_ACCESS_TOKEN. No report produced; nothing synthesised in its place.",
      { chainKey: input.chainKey, proof: proofSummary },
    );
  }

  try {
    const r = await fetch(C2MD_CONTRACT.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: outbound,
      signal: AbortSignal.timeout(120_000),
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
