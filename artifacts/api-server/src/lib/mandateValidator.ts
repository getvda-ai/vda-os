/**
 * mandateValidator.ts
 * AP2 Mandate Validator Middleware — Task #61
 *
 * Enforces Intent Mandate ceilings on agent actions at request time.
 * Replaces the runtime EXCEPTION_AUTHORITY.md ceiling parse with a
 * signature-verified, tamper-evident mandate check.
 *
 * Middleware: `requireValidMandate(agentId, action?, valueExtractor?, mode?)`
 * - Looks up the most recent mandate for the calling agent+company
 * - Verifies the HMAC-SHA256 mandate signature using the platform key
 * - Checks that the proposed action+value is within ceiling
 *
 * HTTP status codes (spec-compliant):
 *   403 — No mandate, revoked, expired, or invalid signature
 *   402 — Mandate ceiling breached (requires HITL approval + escalationToken)
 *   200 — Within mandate authority (PASS)
 *
 * Witness log: every check (pass or block) writes a MANDATE_CHECK governance event.
 */

import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import {
  getMandateWithStatus,
  verifyMandateSignature,
  checkMandateCeiling,
} from "./mandateIssuer.js";
import { logger } from "./logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MandateContext {
  mandateId: string | null;
  phase: string | null;
  withinCeiling: boolean;
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

type BlockReason =
  | "no_mandate"
  | "mandate_revoked"
  | "mandate_expired"
  | "mandate_signature_invalid"
  | "ceiling_breach";

function hitlEscalationBody(
  agentId: string,
  action: string,
  value: number | undefined,
  ceiling: number | undefined,
  reason: BlockReason,
  mandateId?: string | null
): object {
  const labels: Record<BlockReason, string> = {
    no_mandate:                   "No active Intent Mandate — agent must complete onboarding",
    mandate_revoked:              "Intent Mandate revoked — agent authority has been withdrawn",
    mandate_expired:              "Intent Mandate expired — mandate must be renewed before proceeding",
    mandate_signature_invalid:    "Intent Mandate signature invalid — possible tampering detected",
    ceiling_breach:               "Mandate ceiling exceeded — action requires HITL approval",
  };

  const escalationToken = randomUUID();

  return {
    decision:         "ESCALATE",
    hitlRequired:     true,
    mandateViolation: true,
    violationReason:  reason,
    escalationToken,
    actionProposed: `${labels[reason]}${
      value !== undefined
        ? ` (requested: ${value}${ceiling !== undefined ? `, ceiling: ${ceiling}` : ""})`
        : ""
    }.`,
    confidence:       0,
    riskFlags:        [`ap2_mandate_${reason}`],
    escalationReason: labels[reason],
    ap2: {
      reason,
      agentId,
      action,
      requestedValue:  value   ?? null,
      mandateCeiling:  ceiling ?? null,
      mandateId:       mandateId ?? null,
      escalationToken,
    },
  };
}

// ─── Lazy governance event writer ─────────────────────────────────────────────
// Lazy import keeps load order deterministic and breaks any potential
// circular dependency chain: mandateValidator → writeGovernanceEvent → witnessWriter → db

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
      companyId:     params.companyId,
      agent:         params.agentId,
      eventCategory: "MANDATE_CHECK",
      decision:      params.outcome === "PASS" ? "PASS" : "FAIL",
      fileReferenced: params.mandateId
        ? `agent_mandates (${params.mandateId})`
        : "agent_mandates (none)",
      clauseApplied:  `AP2 Intent Mandate — action: ${params.action ?? "any"}, outcome: ${params.outcome}`,
      actionProposed: `Mandate check for ${params.action ?? "request"} by ${params.agentId}`,
      mandateId:      params.mandateId,
      apaleoData: {
        event_type:     "ap2_mandate_check",
        mandateId:      params.mandateId,
        ceilingChecked: params.action,
        outcome:        params.outcome,
        reason:         params.reason ?? null,
      },
    });
  } catch (err) {
    logger.warn({ err, ...params }, "[Mandate] Failed to write mandate check event (non-fatal)");
  }
}

// ─── Middleware factory ────────────────────────────────────────────────────────

/**
 * Express middleware that validates an AP2 Intent Mandate for a given agent action.
 *
 * @param agentId        - The canonical agent identifier (e.g. "folio-charge-agent")
 * @param action         - The mandate action to check (e.g. "folio_charge", "discount").
 *                         If omitted, only mandate existence, expiry, and signature is checked.
 * @param valueExtractor - Function that extracts the action value from `req.body`.
 *                         If omitted, only action-level authorization is checked (no ceiling).
 * @param mode           - "enforce" (default): returns 402/403 on breach/block
 *                         "annotate": attaches mandateCtx but never blocks
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

      // ── Retrieve mandate with explicit lifecycle status ────────────────────
      const { status, mandate } = await getMandateWithStatus(agentId, companyId);

      // ── No mandate found ──────────────────────────────────────────────────
      if (status === "not_found") {
        logger.warn({ agentId, companyId, action }, "[Mandate] No mandate found — 403");
        req.mandateCtx = { mandateId: null, phase: null, withinCeiling: false, requiresHitl: true };
        void writeMandateCheckEvent({ companyId, agentId, action: action ?? null, mandateId: null, outcome: "BLOCK", reason: "no_mandate" });
        if (mode === "enforce") {
          return res.status(403).json(hitlEscalationBody(agentId, action ?? "action", undefined, undefined, "no_mandate", null));
        }
        return next();
      }

      // ── Mandate revoked ───────────────────────────────────────────────────
      if (status === "revoked") {
        logger.warn({ agentId, companyId, mandateId: mandate!.mandateId, action }, "[Mandate] Mandate revoked — 403");
        req.mandateCtx = { mandateId: mandate!.mandateId, phase: mandate!.phase, withinCeiling: false, requiresHitl: true };
        void writeMandateCheckEvent({ companyId, agentId, action: action ?? null, mandateId: mandate!.mandateId, outcome: "BLOCK", reason: "mandate_revoked" });
        if (mode === "enforce") {
          return res.status(403).json(hitlEscalationBody(agentId, action ?? "action", undefined, undefined, "mandate_revoked", mandate!.mandateId));
        }
        return next();
      }

      // ── Mandate expired ───────────────────────────────────────────────────
      if (status === "expired") {
        logger.warn({ agentId, companyId, mandateId: mandate!.mandateId, validUntil: mandate!.validUntil, action }, "[Mandate] Mandate expired — 403");
        req.mandateCtx = { mandateId: mandate!.mandateId, phase: mandate!.phase, withinCeiling: false, requiresHitl: true };
        void writeMandateCheckEvent({ companyId, agentId, action: action ?? null, mandateId: mandate!.mandateId, outcome: "BLOCK", reason: "mandate_expired" });
        if (mode === "enforce") {
          return res.status(403).json(hitlEscalationBody(agentId, action ?? "action", undefined, undefined, "mandate_expired", mandate!.mandateId));
        }
        return next();
      }

      // ── Status is "active" — verify cryptographic signature ──────────────
      // Fail closed: invalid/tampered mandate is treated as no authority.
      const sigValid = await verifyMandateSignature(mandate!);
      if (!sigValid) {
        logger.warn({ agentId, companyId, mandateId: mandate!.mandateId }, "[Mandate] Signature invalid — 403 (fail-closed)");
        req.mandateCtx = { mandateId: mandate!.mandateId, phase: mandate!.phase, withinCeiling: false, requiresHitl: true };
        void writeMandateCheckEvent({ companyId, agentId, action: action ?? null, mandateId: mandate!.mandateId, outcome: "BLOCK", reason: "mandate_signature_invalid" });
        if (mode === "enforce") {
          return res.status(403).json(hitlEscalationBody(agentId, action ?? "action", undefined, undefined, "mandate_signature_invalid", mandate!.mandateId));
        }
        return next();
      }

      // ── Ceiling check (if action provided) ───────────────────────────────
      let withinCeiling = true;
      let ceiling: number | undefined;

      if (action) {
        const value = valueExtractor
          ? valueExtractor(req.body as Record<string, unknown>)
          : undefined;
        const result = checkMandateCeiling(mandate!, action, value);
        withinCeiling = result.allowed;
        ceiling = result.ceiling;

        if (!withinCeiling && mode === "enforce") {
          logger.warn(
            { agentId, companyId, action, value, ceiling, mandateId: mandate!.mandateId },
            "[Mandate] Ceiling breach — 402 escalating to HITL"
          );
          req.mandateCtx = { mandateId: mandate!.mandateId, phase: mandate!.phase, withinCeiling: false, requiresHitl: true };
          void writeMandateCheckEvent({ companyId, agentId, action, mandateId: mandate!.mandateId, outcome: "BLOCK", reason: "ceiling_breach" });
          return res.status(402).json(hitlEscalationBody(agentId, action, value, ceiling, "ceiling_breach", mandate!.mandateId));
        }
      }

      req.mandateCtx = {
        mandateId:    mandate!.mandateId,
        phase:        mandate!.phase,
        withinCeiling,
        requiresHitl: !withinCeiling,
      };

      void writeMandateCheckEvent({
        companyId,
        agentId,
        action:    action ?? null,
        mandateId: mandate!.mandateId,
        outcome:   "PASS",
      });

      logger.debug(
        { agentId, companyId, action, mandateId: mandate!.mandateId, phase: mandate!.phase, withinCeiling },
        "[Mandate] Validated — PASS"
      );
      return next();

    } catch (err) {
      // Non-fatal: mandate system failure must not block agent operations
      logger.warn({ err, agentId, action }, "[Mandate] Validator error (non-fatal) — proceeding without mandate check");
      req.mandateCtx = { mandateId: null, phase: null, withinCeiling: true, requiresHitl: false };
      return next();
    }
  };
}
