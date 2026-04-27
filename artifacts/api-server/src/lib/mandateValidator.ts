/**
 * mandateValidator.ts
 * AP2 Mandate Validator Middleware — Task #61
 *
 * Enforces Intent Mandate ceilings on agent actions at request time.
 * Replaces the runtime EXCEPTION_AUTHORITY.md ceiling parse with a
 * verified, tamper-evident mandate check.
 *
 * Middleware: `requireValidMandate(agentId, action?, valueExtractor?)`
 * - Looks up the active mandate for the calling agent+company
 * - Checks that the proposed action+value is within ceiling
 * - HITL-escalates on breach rather than hard-blocking (preserves operator visibility)
 * - Falls back gracefully if mandate system is unavailable (logs warning, proceeds)
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

function hitlEscalation(
  agentId: string,
  action: string,
  value: number | undefined,
  ceiling: number | undefined,
  reason: "no_mandate" | "ceiling_breach" | "mandate_expired"
): object {
  const labels: Record<string, string> = {
    no_mandate:       "No active Intent Mandate",
    ceiling_breach:   "Mandate ceiling exceeded",
    mandate_expired:  "Intent Mandate expired",
  };
  return {
    decision: "ESCALATE",
    hitlRequired: true,
    mandateViolation: true,
    violationReason: reason,
    actionProposed: `${labels[reason]} — human approval required before ${action} can proceed${value !== undefined ? ` (requested: ${value}${ceiling !== undefined ? `, ceiling: ${ceiling}` : ""})` : ""}.`,
    confidence: 0,
    riskFlags: [`ap2_mandate_${reason}`],
    escalationReason: labels[reason],
  };
}

// ─── Middleware factory ────────────────────────────────────────────────────────

/**
 * Express middleware that validates an AP2 Intent Mandate ceiling for a given action.
 *
 * @param agentId     - The canonical agent identifier (e.g. "folio-charge-agent")
 * @param action      - The mandate action to check (e.g. "folio_charge", "discount")
 *                      If omitted, mandate existence is checked but no ceiling is enforced.
 * @param valueExtractor - Function that extracts the action value from `req.body`.
 *                         If omitted, only action-level authorization is checked.
 * @param mode        - "enforce" (default): returns ESCALATE on breach
 *                      "annotate": attaches mandateCtx to req but never blocks
 */
export function requireValidMandate(
  agentId: string,
  action?: string,
  valueExtractor?: (body: Record<string, unknown>) => number | undefined,
  mode: "enforce" | "annotate" = "enforce"
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const companyId = Number((req.body as Record<string, unknown>)?.companyId);
      if (!companyId || isNaN(companyId)) {
        // No company context → can't check mandate; proceed
        req.mandateCtx = { mandateId: null, phase: null, withinCeiling: true, requiresHitl: false };
        return next();
      }

      const mandate = await getActiveMandate(agentId, companyId);

      if (!mandate) {
        logger.warn({ agentId, companyId, action }, "[Mandate] No active mandate — HITL required");
        req.mandateCtx = { mandateId: null, phase: null, withinCeiling: false, requiresHitl: true };
        if (mode === "enforce") {
          return res.json(hitlEscalation(agentId, action ?? "action", undefined, undefined, "no_mandate"));
        }
        return next();
      }

      // Mandate exists — check ceiling if action+value provided
      let withinCeiling = true;
      let ceiling: number | undefined;

      if (action) {
        const value = valueExtractor ? valueExtractor(req.body as Record<string, unknown>) : undefined;
        const result = checkMandateCeiling(mandate, action, value);
        withinCeiling = result.allowed;
        ceiling = result.ceiling;

        if (!withinCeiling && mode === "enforce") {
          const val = valueExtractor ? valueExtractor(req.body as Record<string, unknown>) : undefined;
          logger.warn({ agentId, companyId, action, value: val, ceiling, mandateId: mandate.mandateId }, "[Mandate] Ceiling breach — escalating to HITL");
          req.mandateCtx = { mandateId: mandate.mandateId, phase: mandate.phase, withinCeiling: false, requiresHitl: true };
          return res.json(hitlEscalation(agentId, action, val, ceiling, "ceiling_breach"));
        }
      }

      req.mandateCtx = {
        mandateId: mandate.mandateId,
        phase: mandate.phase,
        withinCeiling,
        requiresHitl: !withinCeiling,
      };

      logger.debug({ agentId, companyId, action, mandateId: mandate.mandateId, phase: mandate.phase, withinCeiling }, "[Mandate] Validated");
      return next();
    } catch (err) {
      // Non-fatal: mandate system failure should not block agent operations
      logger.warn({ err, agentId, action }, "[Mandate] Validator error (non-fatal) — proceeding without mandate check");
      req.mandateCtx = { mandateId: null, phase: null, withinCeiling: true, requiresHitl: false };
      return next();
    }
  };
}
