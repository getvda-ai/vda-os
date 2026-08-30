/**
 * stayEventCategory.ts — classify a sealed event into the four governance-framework
 * categories the console badges.
 *
 * THIS IS A MAPPING, NOT A RENAME, AND THAT DISTINCTION IS LOAD-BEARING.
 *
 * The `event_category` column already holds two vocabularies that grew at different
 * times — SCREAMING_CASE governance events (`BASELINE_SET`, `HITL_APPROVED`, `ESCALATE`,
 * `TRAIL_CORRECTION`, `AGENT_LIFECYCLE`…) and lower_snake decision events
 * (`governed_pass`, `no_sop_coverage`, `charge_posted`…). Renaming them to the four
 * framework categories would:
 *
 *   1. break `routes/phase.ts`, whose promotion gate counts compliance-boundary
 *      violations with `event_category ILIKE '%compliance_boundary%'`;
 *   2. break the legacy fold in `/api/stay/log`, which keys on `vda_witness_sealed`;
 *   3. and — the real objection — REWRITE THE MEANING OF ALREADY-SEALED RECORDS. The
 *      trail is append-only. A record sealed as `governed_escalate` is that, forever.
 *
 * So the stored value stays exactly as sealed, and this function derives a display
 * classification over it. `classify()` is pure and total: an unrecognised value gets
 * AGENT_DECISION rather than a blank badge, because an unlabelled row in an evidence
 * log reads as a gap in the evidence.
 */

/** The four framework categories the console badges. */
export type FrameworkCategory =
  | "AGENT_DECISION"
  | "COMPLIANCE_BOUNDARY"
  | "FRAMEWORK_INTEGRITY"
  | "AGENT_LIFECYCLE";

const EXACT: Record<string, FrameworkCategory> = {
  // ── AGENT_DECISION — the agent decided, autonomously or as a proposal ──
  governed_pass: "AGENT_DECISION",
  governed_fail: "AGENT_DECISION",
  governed_escalate: "AGENT_DECISION",
  baseline_applied: "AGENT_DECISION",
  charge_posted: "AGENT_DECISION",

  // ── COMPLIANCE_BOUNDARY — a human authority was reached, or a ceiling crossed ──
  HITL_APPROVED: "COMPLIANCE_BOUNDARY",
  HITL_REJECTED: "COMPLIANCE_BOUNDARY",
  ESCALATE: "COMPLIANCE_BOUNDARY",
  BASELINE_SET: "COMPLIANCE_BOUNDARY",
  BASELINE_REVOKED: "COMPLIANCE_BOUNDARY",

  // ── FRAMEWORK_INTEGRITY — the governance framework itself spoke ──
  preflight_governance_failure: "FRAMEWORK_INTEGRITY",
  no_sop_coverage: "FRAMEWORK_INTEGRITY",
  FRAMEWORK_INTEGRITY: "FRAMEWORK_INTEGRITY",
  TRAIL_CORRECTION: "FRAMEWORK_INTEGRITY",
  MANDATE_CHECK: "FRAMEWORK_INTEGRITY",
  SCOPE_BLOCKED: "FRAMEWORK_INTEGRITY",

  // ── AGENT_LIFECYCLE — the agent's own operating envelope changed ──
  AGENT_LIFECYCLE: "AGENT_LIFECYCLE",
  PHASE_CHANGED: "AGENT_LIFECYCLE",
};

/** Human label for the badge. Kept short — this sits in a dense log row. */
export const CATEGORY_LABEL: Record<FrameworkCategory, string> = {
  AGENT_DECISION: "Agent decision",
  COMPLIANCE_BOUNDARY: "Compliance boundary",
  FRAMEWORK_INTEGRITY: "Framework integrity",
  AGENT_LIFECYCLE: "Agent lifecycle",
};

/**
 * Classify a stored event_category. Total by construction — never returns null, so no
 * render site has to invent a fallback badge (which is how inconsistent labelling starts).
 *
 * `humanDecided` resolves a real ambiguity in the sealed vocabulary rather than papering
 * over one. `charge_posted` is written by BOTH paths: the engine executing autonomously
 * inside its ceiling, and a human approving a card that was over it. Those are opposite
 * governance events wearing the same name, and the event name alone cannot separate them.
 * The decider can: if a named human resolved it, a compliance boundary was exercised —
 * that is what the category means. Derived from a sealed fact (`decided_by`), never by
 * rewriting the sealed event.
 */
export function classify(
  eventCategory: string | null | undefined,
  opts?: { humanDecided?: boolean },
): FrameworkCategory {
  const v = String(eventCategory ?? "").trim();
  if (!v) return "AGENT_DECISION";
  const exact = EXACT[v];
  if (exact) return opts?.humanDecided && exact === "AGENT_DECISION" ? "COMPLIANCE_BOUNDARY" : exact;
  // Substring rules catch values added later that follow the existing naming habits,
  // so a new event type gets a sensible badge before anyone remembers to add it above.
  const lower = v.toLowerCase();
  if (lower.includes("compliance_boundary") || lower.startsWith("hitl") || lower.includes("baseline")) return "COMPLIANCE_BOUNDARY";
  if (lower.includes("phase") || lower.includes("lifecycle") || lower.includes("mandate")) return "AGENT_LIFECYCLE";
  if (lower.includes("governance") || lower.includes("integrity") || lower.includes("correction") || lower.includes("scope_block")) return "FRAMEWORK_INTEGRITY";
  return opts?.humanDecided ? "COMPLIANCE_BOUNDARY" : "AGENT_DECISION";
}
