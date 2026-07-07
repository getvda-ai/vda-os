/**
 * stayBaselines.ts — bounds-based baseline matching for the Stay Agent.
 *
 * A baseline = a human authorising "this one kind of task" going forward,
 * scoped to exact bounds and revocable. A non-revoked baseline whose bounds and
 * scope CONTAIN an incoming request auto-PASSes it (phase-independent).
 *
 * Phase 4 wires the match hook; Phase 5 implements the full bounds/scope
 * containment, signature, creation, and revoke lifecycle.
 */
import type { StayApaleoRef, StayStage } from "./stayDecisionEngine.js";

export interface MatchedBaseline {
  id: string;
  exceptionClass: string;
  bounds: Record<string, unknown> | null;
  roleBand: string | null;
  authorisedBy: string | null;
}

export interface MatchBaselineInput {
  companyId: number;
  stage: StayStage;
  exceptionClass: string;
  requestedValue?: number;
  apaleoRef?: StayApaleoRef;
}

/**
 * Return a matching non-revoked baseline for the request, or null.
 * (Full containment logic lands in Phase 5.)
 */
export async function matchBaseline(_input: MatchBaselineInput): Promise<MatchedBaseline | null> {
  return null;
}
