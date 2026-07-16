/**
 * staySeal.ts — seal a governed Stay Agent HITL / governance event (approve /
 * deny / escalate / baseline / unbaseline) into VDA Witness via the durable,
 * fail-open seal-outbox — the same path autonomous decisions use.
 *
 * The seal is enqueued (a fast local write) and drained to Witness in the
 * background; it never blocks or gates the operator's action.
 */
import { enqueueSeal, buildSealBody, buildHitlSealBody, collectGuestPii } from "./sealOutbox.js";
import { stayChainKey } from "./witnessChain.js";
import { isWitnessEnabled } from "./witnessClient.js";
import { logger } from "./logger.js";

const AGENT_NAME = "Stay Agent";

/** A human eventCategory → the schema's controlled disposition vocabulary. */
function dispositionFor(eventCategory: string): string {
  if (/APPROV/i.test(eventCategory)) return "approved";
  if (/DEN/i.test(eventCategory)) return "rejected";
  if (/ESCAL/i.test(eventCategory)) return "escalated";
  if (/REVOK/i.test(eventCategory)) return "modified";
  if (/BASELINE/i.test(eventCategory)) return "approved";
  return "modified";
}

export interface CitedSopClause { anchor?: string; heading?: string; text?: string }

export interface HitlSealInput {
  companyId: number;
  localWitnessId: number;
  eventCategory: string; // HITL_APPROVED | HITL_DENIED | HITL_ESCALATED | BASELINE_SET | BASELINE_REVOKED
  /** The AUTHENTICATED human actor (see resolveActor) — never raw UI input. */
  actorId: string;
  actorRole?: string; // ambassador | mod
  statement: string; // the human's rationale
  clauseApplied?: string; // the fired clause text / file ref
  sopSlug?: string; // slug for the ref prefix, e.g. "late_check_out"
  sopRefs?: Array<CitedSopClause | string>;
  artifacts?: Record<string, unknown>; // apaleo_data the decider saw
  basisCapturedAt: string; // ISO — when the artifacts were captured (recommendation time)
  propertyId?: string | null;
  piiDenylist?: string[];
}

/** Build the {ref,text,hash} clause objects the schema requires (validated live — strings 400). */
function buildClauses(p: HitlSealInput): Array<{ ref: string; text?: string; hash?: string }> {
  const slug = p.sopSlug || "stay-agent";
  const refs = (p.sopRefs ?? []).filter(Boolean);
  if (refs.length) {
    return refs.map((r) => {
      if (typeof r === "string") return { ref: `sop:${slug}:${r}`, text: p.clauseApplied };
      return { ref: `sop:${slug}:${r.anchor ?? "clause"}`, text: r.text ?? r.heading ?? p.clauseApplied };
    });
  }
  return [{ ref: `sop:${slug}:applied`, text: p.clauseApplied }];
}

/**
 * Enqueue a HUMAN HITL decision for sealing via the shaped seal_hitl_decision skill.
 * Fail-open (never throws — a governed op must not fail on sealing). Emits the evidence-
 * omission telemetry signal at enqueue time so "gaps visible" is real over the trail.
 */
export async function sealHitlDecisionEvent(p: HitlSealInput): Promise<void> {
  if (!isWitnessEnabled()) return;
  try {
    const body = buildHitlSealBody({
      actorId: p.actorId,
      actorRole: p.actorRole,
      disposition: dispositionFor(p.eventCategory),
      statement: p.statement,
      clauses: buildClauses(p),
      artifacts: p.artifacts,
      basisCapturedAt: p.basisCapturedAt,
      piiDenylist: p.piiDenylist ?? collectGuestPii(p.artifacts ?? {}),
    });

    // Telemetry — the observability signal that makes evidence-gap visibility real.
    logger.info({
      metric: "hitl_seal_evidence",
      role: p.actorRole ?? "unknown",
      event: p.eventCategory,
      has_evidence: Boolean(body.evidence?.length),
      reason_class: body.evidence?.length ? "has_evidence" : "no_evidence",
    }, "[telemetry] hitl_seal_evidence");

    await enqueueSeal({
      companyId: p.companyId,
      chainKey: stayChainKey(p.propertyId, p.companyId),
      decisionId: `stay-hitl-${p.companyId}-${p.localWitnessId}`,
      hitl: body,
      localWitnessId: p.localWitnessId,
    });
  } catch (err) {
    logger.warn({ err }, "[staySeal] HITL enqueue failed — event recorded locally, seal will not land");
  }
}

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
    // Single choke point: inputs minimized + all free-text PII-scrubbed.
    const sealBody = buildSealBody({
      agent: AGENT_NAME,
      verdict: p.verdict,
      reasoning: p.reasoning,
      actionProposed: p.actionProposed,
      inputsRaw: p.inputs ?? {},
      ruleId: p.ruleId,
      ruleText: p.ruleText,
      ruleRef: "stay-agent",
      piiDenylist: collectGuestPii(p.inputs ?? {}),
    });
    await enqueueSeal({
      companyId: p.companyId,
      chainKey: stayChainKey(p.propertyId, p.companyId),
      decisionId: `stay-${p.companyId}-${p.localWitnessId}`,
      decision: sealBody.decision,
      governingRule: sealBody.governingRule,
      localWitnessId: p.localWitnessId,
    });
  } catch (err) {
    logger.warn({ err }, "[staySeal] enqueue failed — event recorded locally, seal will not land");
  }
}
