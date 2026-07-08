/**
 * Stay Agent routes.
 *   POST /api/stay/decision  — run the governed check-in/in-stay/check-out engine.
 */
import { Router, type IRouter } from "express";
import { decideStay, type StayStage, type StayExceptionContext, type StayApaleoRef } from "../lib/stayDecisionEngine.js";
import { listStayBaselines, revokeStayBaseline } from "../lib/stayBaselines.js";
import { writeWitnessEntry } from "../lib/witnessWriter.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const VALID_STAGES = new Set(["check_in", "in_stay", "check_out"]);

// POST /api/stay/decision  { company_id, stage, exception_context, apaleo_ref }
router.post("/stay/decision", async (req, res) => {
  try {
    const companyId = Number(req.body?.company_id ?? req.body?.companyId);
    const stage = String(req.body?.stage ?? "");
    const exceptionContext = (req.body?.exception_context ?? req.body?.exceptionContext ?? {}) as StayExceptionContext;
    const apaleoRef = (req.body?.apaleo_ref ?? req.body?.apaleoRef) as StayApaleoRef | undefined;

    if (Number.isNaN(companyId) || companyId < 0) {
      res.status(400).json({ error: "company_id must be a non-negative integer" });
      return;
    }
    if (!VALID_STAGES.has(stage)) {
      res.status(400).json({ error: "stage must be one of check_in | in_stay | check_out" });
      return;
    }
    if (!exceptionContext?.exception_class) {
      res.status(400).json({ error: "exception_context.exception_class is required" });
      return;
    }

    const decision = await decideStay({
      companyId,
      stage: stage as StayStage,
      exceptionContext,
      apaleoRef,
      actor: typeof req.body?.actor === "string" ? req.body.actor : undefined,
    });
    res.json(decision);
  } catch (err) {
    logger.error({ err }, "stay/decision error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Stay decision failed" });
  }
});

// ── GET /api/baselines?company_id= — active + revoked baselines ───────────────
router.get("/baselines", async (req, res) => {
  try {
    const companyId = Number(req.query.company_id ?? req.query.companyId ?? 0);
    if (Number.isNaN(companyId) || companyId < 0) {
      res.status(400).json({ error: "company_id must be a non-negative integer" });
      return;
    }
    const rows = await listStayBaselines(companyId);
    const baselines = rows.map((r) => ({
      id: r.id,
      company_id: r.companyId,
      agent_id: r.agentId,
      stage: r.stage,
      exception_class: r.exceptionClass,
      bounds: r.bounds,
      apaleo_scope: r.apaleoScope,
      context_hash: r.contextHash,
      role_band: r.roleBand,
      authorised_by: r.authorisedBy ?? r.acceptedBy,
      approved_hitl_token: r.approvedHitlToken,
      created_at: r.createdAt,
      revoked: r.revoked,
      revoked_by: r.revokedBy,
      revoked_reason: r.revokedReason,
      revoked_at: r.revokedAt,
    }));
    res.json({
      companyId,
      active: baselines.filter((b) => !b.revoked),
      revoked: baselines.filter((b) => b.revoked),
    });
  } catch (err) {
    logger.error({ err }, "baselines list error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to list baselines" });
  }
});

// ── POST /api/baselines/:id/revoke { revoked_by, revoked_reason } ──────────────
router.post("/baselines/:id/revoke", async (req, res) => {
  try {
    const id = String(req.params.id);
    const revokedBy = String(req.body?.revoked_by ?? req.body?.revokedBy ?? "").trim();
    const revokedReason = String(req.body?.revoked_reason ?? req.body?.revokedReason ?? "").trim();
    if (!revokedBy || !revokedReason) {
      res.status(400).json({ error: "revoked_by and revoked_reason are required" });
      return;
    }
    const ok = await revokeStayBaseline(id, revokedBy, revokedReason);
    if (!ok) {
      res.status(404).json({ error: "Baseline not found" });
      return;
    }
    // Witness: BASELINE_REVOKED (append-only; row retained).
    try {
      await writeWitnessEntry({
        companyId: Number(req.body?.company_id ?? req.body?.companyId ?? 0) || 0,
        agent: "Stay Agent",
        decision: {
          decision: "INFO",
          clauseApplied: `Baseline ${id} revoked — future matching requests return to HITL.`,
          actionProposed: "Revoke baseline",
          exceptionApplied: false,
          escalationTarget: null,
          reasoning: `Baseline ${id} revoked by ${revokedBy}: ${revokedReason}`,
        },
        fileReferenced: `baseline:${id}`,
        apaleoData: { baseline_id: id, revoked_by: revokedBy, revoked_reason: revokedReason },
        eventCategory: "BASELINE_REVOKED",
        suppressAutoHitl: true,
      });
    } catch (wErr) {
      logger.warn({ wErr }, "baseline revoke witness write failed (continuing)");
    }
    res.json({ ok: true, id, revoked_by: revokedBy, revoked_reason: revokedReason });
  } catch (err) {
    logger.error({ err }, "baseline revoke error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to revoke baseline" });
  }
});

export default router;
