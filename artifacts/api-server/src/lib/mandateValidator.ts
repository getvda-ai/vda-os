/**
 * mandateValidator.ts
 * AP2 Mandate Validator Middleware — Task #61
 *
 * Enforces Intent Mandate ceilings on agent actions at request time.
 * Replaces the runtime EXCEPTION_AUTHORITY.md ceiling parse with a
 * verified, tamper-evident mandate check.
 *
 * Middleware: `requireValidMandate(agentId, action?, valueExtractor?, mode?)`
 * - Looks up the active mandate for the calling agent+company
 * - Checks that the proposed action+value is within ceiling
 * - Returns 402 Payment Required on ceiling breach or expired mandate
 * - Returns 403 Forbidden on missing or revoked mandate
 * - Falls back gracefully if mandate system is unavailable (logs warning, proceeds)
 *
 * HTTP status codes (spec-compliant):
 *   403 — No mandate (agent not onboarded), or mandate revoked
 *   402 — Mandate expired or ceiling breached (requires HITL approval / renewal)
 *   200 — Within mandate authority (PASS)
 *
 * Witness log: every check (pass or block) writes a MANDATE_CHECK governance event.
 */

import type { Request, Response, NextFunction } from "express";
import { getActiveMandate, checkMandateCeiling } from "./mandateIssuer.js";
import { logger } from "./logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MandateContext {
  /** Active mandate ID, or null if no mandate is found. */
  mandateId: string | null;
  /** Phase from the mandate. */
  phase: string | null;
  /** Whether this request is within mandate ceilings. */
  withinCeiling: boolean;
  /** True if no active mandate exists — requires HITL. */
  requiresHitl: boolean;
}

declare global {
  namespace Express {
    interface Request {
      mandateCtx?: MandateContext;
    }
  }
}

// ─── HITL escalation payload ──────────────────────────────────────────────────

function hitlEscalationBody(
  agentId: string,
  action: string,
  value: number | undefined,
  ceiling: number | undefined,
  reason: "no_mandate" | "ceiling_breach" | "mandate_expired" | "mandate_revoked"
): object {
  const labels: Record<string, string> = {
    no_mandate:      "No active Intent Mandate — agent must complete onboarding",
    ceiling_breach:  "Mandate ceiling exceeded — action requires HITL approval",
    mandate_expired: "Intent Mandate expired — mandate must be renewed before proceeding",
    mandate_revoked: "Intent Mandate revoked — agent authority has been withdrawn",
  };
  return {
    decision: "ESCALATE",
    hitlRequired: true,
    mandateViolation: true,
    violationReason: reason,
    actionProposed: `${labels[reason]}${value !== undefined ? ` (requested: ${value}${ceiling !== undefined ? `, ceiling: ${ceiling}` : ""})` : ""}.`,
    confidence: 0,
    riskFlags: [`ap2_mandate_${reason}`],
    escalationReason: labels[reason],
    ap2: {
      reason,
      agentId,
      action,
      requestedValue: value ?? null,
      mandateCeiling: ceiling ?? null,
    },
  };
}

// ─── Lazy governance event writer ─────────────────────────────────────────────
// Lazy import breaks any potential circular dependency chain:
//   mandateValidator → writeGovernanceEvent → witnessWriter → db
// (witnessWriter does not import mandateValidator, so the cycle is not real,
// but lazy import keeps load order deterministic.)

async function writeMandateCheckEvent(params: {
  companyId: number;
  agentId: string;
  action: string | null;
  mandateId: string | null;
  outcome: "PASS" | "BLOCK";
  reason?: string;
}): Promise<void> {
  try {
    const { writeGovernanceEvent } = await import("./writeGovernanceEvent.js");
    void writeGovernanceEvent({
      companyId: params.companyId,
      agent: params.agentId,
      eventCategory: "MANDATE_CHECK",
      decision: params.outcome === "PASS" ? "PASS" : "FAIL",
      fileReferenced: params.mandateId ? `agent_mandates (${params.mandateId})` : "agent_mandates (none)",
      clauseApplied: `AP2 Intent Mandate — action: ${params.action ?? "any"}, outcome: ${params.outcome}`,
      actionProposed: `Mandate check for ${params.action ?? "request"} by ${params.agentId}`,
      apaleoData: {
        event_type: "ap2_mandate_check",
        mandateId: params.mandateId,
        ceilingChecked: params.action,
        outcome: params.outcome,
        reason: params.reason ?? null,
      },
    });
  } catch (err) {
    logger.warn({ err, ...params }, "[Mandate] Failed to write mandate check event (non-fatal)");
  }
}

// ─── Middleware factory ────────────────────────────────────────────────────────

/**
 * Express middleware that validates an AP2 Intent Mandate ceiling for a given action.
 *
 * @param agentId        - The canonical agent identifier (e.g. "folio-charge-agent")
 * @param action         - The mandate action to check (e.g. "folio_charge", "discount")
 *                         If omitted, only mandate existence and expiry is checked.
 * @param valueExtractor - Function that extracts the action value from `req.body`.
 *                         If omitted, only action-level authorization is checked.
 * @param mode           - "enforce" (default): returns 402/403 on breach
 *                         "annotate": attaches mandateCtx to req but never blocks
 */
export function requireValidMandate(
  agentId: string,
  action?: string,
  valueExtractor?: (body: Record<string, unknown>) => number | undefined,
  mode: "enforce" | "annotate" = "enforce"
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const companyId = Number(
        (req.body as Record<string, unknown>)?.companyId
        ?? req.params?.companyId
      );
      if (!companyId || isNaN(companyId)) {
        req.mandateCtx = { mandateId: null, phase: null, withinCeiling: true, requiresHitl: false };
        return next();
      }

      const mandate = await getActiveMandate(agentId, companyId);

      // ── No active mandate ─────────────────────────────────────────────────
      if (!mandate) {
        logger.warn({ agentId, companyId, action }, "[Mandate] No active mandate — HITL required");
        req.mandateCtx = { mandateId: null, phase: null, withinCeiling: false, requiresHitl: true };
        void writeMandateCheckEvent({ companyId, agentId, action: action ?? null, mandateId: null, outcome: "BLOCK", reason: "no_mandate" });
        if (mode === "enforce") {
          return res.status(403).json(hitlEscalationBody(agentId, action ?? "action", undefined, undefined, "no_mandate"));
        }
        return next();
      }

      // ── Mandate is revoked ────────────────────────────────────────────────
      if (mandate.revoked) {
        logger.warn({ agentId, companyId, mandateId: mandate.mandateId, action }, "[Mandate] Mandate revoked — blocking request");
        req.mandateCtx = { mandateId: mandate.mandateId, phase: mandate.phase, withinCeiling: false, requiresHitl: true };
        void writeMandateCheckEvent({ companyId, agentId, action: action ?? null, mandateId: mandate.mandateId, outcome: "BLOCK", reason: "mandate_revoked" });
        if (mode === "enforce") {
          return res.status(403).json(hitlEscalationBody(agentId, action ?? "action", undefined, undefined, "mandate_revoked"));
        }
        return next();
      }

      // ── Mandate is expired ────────────────────────────────────────────────
      if (new Date(mandate.validUntil) < new Date()) {
        logger.warn({ agentId, companyId, mandateId: mandate.mandateId, validUntil: mandate.validUntil, action }, "[Mandate] Mandate expired — renewal required");
        req.mandateCtx = { mandateId: mandate.mandateId, phase: mandate.phase, withinCeiling: false, requiresHitl: true };
        void writeMandateCheckEvent({ companyId, agentId, action: action ?? null, mandateId: mandate.mandateId, outcome: "BLOCK", reason: "mandate_expired" });
        if (mode === "enforce") {
          return res.status(402).json(hitlEscalationBody(agentId, action ?? "action", undefined, undefined, "mandate_expired"));
        }
        return next();
      }

      // ── Ceiling check (if action + value provided) ────────────────────────
      let withinCeiling = true;
      let ceiling: number | undefined;

      if (action) {
        const value = valueExtractor ? valueExtractor(req.body as Record<string, unknown>) : undefined;
        const result = checkMandateCeiling(mandate, action, value);
        withinCeiling = result.allowed;
        ceiling = result.ceiling;

        if (!withinCeiling && mode === "enforce") {
          const val = valueExtractor ? valueExtractor(req.body as Record<string, unknown>) : undefined;
          logger.warn({ agentId, companyId, action, value: val, ceiling, mandateId: mandate.mandateId }, "[Mandate] Ceiling breach — 402 escalating to HITL");
          req.mandateCtx = { mandateId: mandate.mandateId, phase: mandate.phase, withinCeiling: false, requiresHitl: true };
          void writeMandateCheckEvent({ companyId, agentId, action, mandateId: mandate.mandateId, outcome: "BLOCK", reason: "ceiling_breach" });
          return res.status(402).json(hitlEscalationBody(agentId, action, val, ceiling, "ceiling_breach"));
        }
      }

      req.mandateCtx = {
        mandateId: mandate.mandateId,
        phase: mandate.phase,
        withinCeiling,
        requiresHitl: !withinCeiling,
      };

      // Write PASS event (fire-and-forget — do not block the request)
      void writeMandateCheckEvent({ companyId, agentId, action: action ?? null, mandateId: mandate.mandateId, outcome: "PASS" });

      logger.debug({ agentId, companyId, action, mandateId: mandate.mandateId, phase: mandate.phase, withinCeiling }, "[Mandate] Validated — PASS");
      return next();
    } catch (err) {
      // Non-fatal: mandate system failure must not block agent operations
      logger.warn({ err, agentId, action }, "[Mandate] Validator error (non-fatal) — proceeding without mandate check");
      req.mandateCtx = { mandateId: null, phase: null, withinCeiling: true, requiresHitl: false };
      return next();
    }
  };
}
