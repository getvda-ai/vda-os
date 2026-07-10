/**
 * staySeal.ts — seal a governed Stay Agent HITL / governance event (approve /
 * deny / escalate / baseline / unbaseline) into VDA Witness via the durable,
 * fail-open seal-outbox — the same path autonomous decisions use.
 *
 * The seal is enqueued (a fast local write) and drained to Witness in the
 * background; it never blocks or gates the operator's action.
 */
import { enqueueSeal, minimizeInputs } from "./sealOutbox.js";
import { stayChainKey } from "./witnessChain.js";
import { isWitnessEnabled } from "./witnessClient.js";
import { logger } from "./logger.js";

const AGENT_NAME = "Stay Agent";

export interface StaySealInput {
  companyId: number;
  localWitnessId: number;
  verdict: string; // event/outcome label (HITL_APPROVED, BASELINE_SET, ...)
  reasoning: string;
  actionProposed?: string;
  inputs?: Record<string, unknown>;
  ruleId: string; // governing clause id / file
  ruleText: string; // verbatim governing clause
  exceptionClass?: string;
  propertyId?: string | null; // for the per-property chain key
}

/** Enqueue a governed HITL/governance event for sealing. Fail-open, never throws. */
export async function sealStayEvent(p: StaySealInput): Promise<void> {
  if (!isWitnessEnabled()) return;
  try {
    await enqueueSeal({
      companyId: p.companyId,
      chainKey: stayChainKey(p.propertyId, p.companyId),
      decisionId: `stay-${p.companyId}-${p.localWitnessId}`,
      decision: {
        agent: AGENT_NAME,
        verdict: p.verdict,
        reasoning: p.reasoning,
        actionProposed: p.actionProposed,
        inputs: minimizeInputs(p.inputs ?? {}), // PII-minimized: no guest PII
      },
      governingRule: { ruleId: p.ruleId, ruleText: p.ruleText, governanceRef: "stay-agent" },
      localWitnessId: p.localWitnessId,
    });
  } catch (err) {
    logger.warn({ err }, "[staySeal] enqueue failed — event recorded locally, seal will not land");
  }
}
