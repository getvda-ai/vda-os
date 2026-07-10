/**
 * staySeal.ts — seal a governed Stay Agent event (HITL resolution or governance
 * change: approve / deny / escalate / baseline / unbaseline) into the external
 * VDA Witness, and write the append-only vda_witness_sealed link entry so it
 * carries the same tamper-evident badge as an autonomous decision.
 *
 * Reuses the exact seal mechanism from the decision engine — same sealDecision()
 * + link-entry shape — so every made decision AND every governance change is
 * independently verifiable.
 */
import { writeWitnessEntry } from "./witnessWriter.js";
import { isVdaWitnessEnabled, sealDecision, extractRecordId } from "./vdaWitness.js";
import { logger } from "./logger.js";

const AGENT_NAME = "Stay Agent";

export interface StaySealInput {
  companyId: number;
  localWitnessId: number;
  verdict: string; // event/outcome label (HITL_APPROVED, BASELINE_SET, ...)
  reasoning: string;
  actionProposed?: string;
  inputs?: unknown;
  ruleId: string; // governing clause id / file
  ruleText: string; // verbatim governing clause
  exceptionClass?: string;
}

export async function sealStayEvent(p: StaySealInput): Promise<{ recordId: string | null; sealed: unknown } | null> {
  if (!isVdaWitnessEnabled()) return null;
  try {
    const sealed = await sealDecision({
      decision: { agent: AGENT_NAME, verdict: p.verdict, reasoning: p.reasoning, actionProposed: p.actionProposed, inputs: p.inputs },
      governingRule: { ruleId: p.ruleId, ruleText: p.ruleText, governanceRef: "stay-agent" },
      chainKey: `stay-agent-${p.companyId}`,
      decisionId: `stay-${p.companyId}-${p.localWitnessId}`,
    });
    const recordId = extractRecordId(sealed);
    await writeWitnessEntry({
      companyId: p.companyId,
      agent: AGENT_NAME,
      decision: {
        decision: "INFO",
        clauseApplied: `Sealed into VDA Witness${recordId ? ` (record ${recordId})` : ""} — independently verifiable (Ed25519 + hash-chain) at witness.getvda.ai.`,
        actionProposed: "External tamper-evident seal",
        exceptionApplied: false,
        escalationTarget: null,
        reasoning: `Governed event (local witness #${p.localWitnessId}) sealed into the external VDA Witness evidence chain.`,
        exceptionClass: p.exceptionClass,
      },
      fileReferenced: p.ruleId,
      apaleoData: {
        vda_witness_record: sealed,
        local_witness_id: p.localWitnessId,
        art17: { event: "vda_witness_sealed", external_record_id: recordId ?? null, local_witness_id: p.localWitnessId },
      },
      eventCategory: "vda_witness_sealed",
      suppressAutoHitl: true,
    });
    logger.info({ localWitnessId: p.localWitnessId, recordId }, "[staySeal] event sealed into VDA Witness");
    return { recordId: recordId ?? null, sealed };
  } catch (err) {
    logger.warn({ err }, "[staySeal] seal failed — event recorded locally, external seal skipped");
    return null;
  }
}
