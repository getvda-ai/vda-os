/**
 * stayBaselines.ts — bounds-based baseline lifecycle for the Stay Agent.
 *
 * A baseline = a human authorising "this one kind of task" going forward,
 * scoped to EXACT bounds and revocable. It is phase-independent: a matching
 * non-revoked baseline auto-PASSes even in Crawl, because a human explicitly
 * authorised that exact task. Bounds are never widened beyond the approved
 * request, and baselines are never hard-deleted (revoke only).
 */
import { createHash } from "node:crypto";
import { db, exceptionBaselines } from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import { logger } from "./logger.js";
import type { StayApaleoRef, StayStage } from "./stayDecisionEngine.js";

const AGENT_SLUG = "stay-agent";

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
  /** Qualifying attributes of the request (e.g. rate_type, refundable, group)
   *  that a baseline's scope may narrow on — so non-refundable/group still escalate. */
  context?: Record<string, unknown>;
}

// Scope qualifiers a baseline may pin (beyond property). A request must match each.
const SCOPE_QUALIFIERS = ["rate_type", "refundable", "group"] as const;

// ── Signature + bounds helpers ───────────────────────────────────────────────
export function computeBounds(
  requestedValue: number | undefined,
  ceilingType: string | null | undefined,
  currency?: string,
): Record<string, unknown> {
  // Bound to the EXACT approved request, never looser.
  if (typeof requestedValue !== "number" || Number.isNaN(requestedValue)) {
    return { unbounded: true, ceiling_type: ceilingType ?? "none" };
  }
  const bounds: Record<string, unknown> = { value_max: requestedValue, ceiling_type: ceilingType ?? "value" };
  if (currency) bounds.currency = currency;
  return bounds;
}

export function computeContextHash(params: {
  stage: string;
  exceptionClass: string;
  bounds: Record<string, unknown>;
  apaleoScope: Record<string, unknown> | null;
}): string {
  const canonical = JSON.stringify({
    stage: params.stage,
    exception_class: params.exceptionClass,
    bounds: params.bounds,
    apaleo_scope: params.apaleoScope ?? null,
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

/** Does a baseline's bounds CONTAIN the request's value? */
function boundsContain(bounds: Record<string, unknown> | null, requestedValue: number | undefined): boolean {
  if (!bounds) return false;
  if (bounds.unbounded === true) return true;
  const max = bounds.value_max;
  if (typeof max !== "number") return true; // no numeric bound stored → treat as containing
  if (typeof requestedValue !== "number" || Number.isNaN(requestedValue)) return false;
  return requestedValue <= max;
}

/** Does a baseline's apaleo_scope CONTAIN the request's scope + qualifiers?
 *  (null scope = all). Any pinned qualifier (rate_type/refundable/group) must
 *  match exactly — so a "standard, refundable" baseline never covers a
 *  non-refundable or group request; those return to HITL. */
function scopeContain(
  scope: Record<string, unknown> | null,
  ref: StayApaleoRef | undefined,
  context?: Record<string, unknown>,
): boolean {
  if (!scope || Object.keys(scope).length === 0) return true; // unscoped → applies everywhere
  if (scope.propertyId && ref?.propertyId && scope.propertyId !== ref.propertyId) return false;
  for (const k of SCOPE_QUALIFIERS) {
    if (k in scope) {
      if (!context || context[k] !== scope[k]) return false;
    }
  }
  return true;
}

// ── Match (used by the decision engine before governance) ────────────────────
export async function matchBaseline(input: MatchBaselineInput): Promise<MatchedBaseline | null> {
  try {
    const rows = await db
      .select()
      .from(exceptionBaselines)
      .where(
        and(
          eq(exceptionBaselines.agentId, AGENT_SLUG),
          eq(exceptionBaselines.companyId, input.companyId),
          eq(exceptionBaselines.exceptionClass, input.exceptionClass),
          eq(exceptionBaselines.revoked, false),
          eq(exceptionBaselines.accepted, true),
        ),
      )
      .orderBy(desc(exceptionBaselines.createdAt));

    for (const row of rows) {
      // Stage must match (or baseline stage is unset/global).
      if (row.stage && row.stage !== input.stage) continue;
      if (!boundsContain(row.bounds ?? null, input.requestedValue)) continue;
      if (!scopeContain(row.apaleoScope ?? null, input.apaleoRef, input.context)) continue;
      return {
        id: row.id,
        exceptionClass: row.exceptionClass,
        bounds: row.bounds ?? null,
        roleBand: row.roleBand,
        authorisedBy: row.authorisedBy ?? row.acceptedBy ?? null,
      };
    }
    return null;
  } catch (err) {
    logger.warn({ err }, "[stayBaselines] matchBaseline failed — treating as no baseline");
    return null;
  }
}

// ── Create (called by the HITL "baseline" action) ────────────────────────────
export interface CreateBaselineInput {
  companyId: number;
  stage: string;
  exceptionClass: string;
  requestedValue?: number;
  ceilingType?: string | null;
  currency?: string;
  roleBand: string;
  authorisedBy: string;
  escalateTo?: string | null;
  apaleoScope?: Record<string, unknown> | null;
  /** Qualifiers to pin on the baseline scope (rate_type/refundable/group). */
  scopeAttrs?: Record<string, unknown> | null;
  approvedHitlToken?: string | null;
  sourceClause?: string | null;
}

export async function createStayBaseline(input: CreateBaselineInput): Promise<{ id: string; contextHash: string; bounds: Record<string, unknown> }> {
  const bounds = computeBounds(input.requestedValue, input.ceilingType, input.currency);
  // Pin property + any qualifying attributes (rate_type/refundable/group) so the
  // baseline is scoped exactly to the kind of request that was approved.
  const scopeAttrs: Record<string, unknown> = {};
  for (const k of SCOPE_QUALIFIERS) {
    if (input.scopeAttrs && k in input.scopeAttrs && input.scopeAttrs[k] !== undefined) scopeAttrs[k] = input.scopeAttrs[k];
  }
  const mergedScope = { ...(input.apaleoScope ?? {}), ...scopeAttrs };
  const apaleoScope = Object.keys(mergedScope).length > 0 ? mergedScope : null;
  const contextHash = computeContextHash({ stage: input.stage, exceptionClass: input.exceptionClass, bounds, apaleoScope });

  const [row] = await db
    .insert(exceptionBaselines)
    .values({
      agentId: AGENT_SLUG,
      companyId: input.companyId,
      roleBand: input.roleBand,
      exceptionClass: input.exceptionClass,
      authority: "baseline",
      escalateTo: input.escalateTo ?? null,
      accepted: true,
      rejected: false,
      acceptedBy: input.authorisedBy,
      acceptedAt: new Date(),
      sourceClause: input.sourceClause ?? null,
      // Stay bounds-based fields
      stage: input.stage,
      bounds,
      apaleoScope,
      contextHash,
      authorisedBy: input.authorisedBy,
      approvedHitlToken: input.approvedHitlToken ?? null,
      ceilingType: input.ceilingType ?? null,
      ceiling: typeof input.requestedValue === "number" ? String(input.requestedValue) : null,
      revoked: false,
    })
    .returning({ id: exceptionBaselines.id });

  logger.info({ id: row.id, companyId: input.companyId, exceptionClass: input.exceptionClass, bounds }, "[stayBaselines] Baseline created");
  return { id: row.id, contextHash, bounds };
}

// ── List (dashboard Baselines panel) ─────────────────────────────────────────
export async function listStayBaselines(companyId: number) {
  return db
    .select()
    .from(exceptionBaselines)
    .where(and(eq(exceptionBaselines.agentId, AGENT_SLUG), eq(exceptionBaselines.companyId, companyId)))
    .orderBy(desc(exceptionBaselines.createdAt));
}

// ── Revoke (never hard-delete) ───────────────────────────────────────────────
export async function revokeStayBaseline(id: string, revokedBy: string, revokedReason: string): Promise<boolean> {
  const [row] = await db
    .select({ id: exceptionBaselines.id, revoked: exceptionBaselines.revoked })
    .from(exceptionBaselines)
    .where(eq(exceptionBaselines.id, id))
    .limit(1);
  if (!row) return false;
  await db
    .update(exceptionBaselines)
    .set({ revoked: true, revokedBy, revokedReason, revokedAt: new Date() })
    .where(eq(exceptionBaselines.id, id));
  logger.info({ id, revokedBy }, "[stayBaselines] Baseline revoked");
  return true;
}
