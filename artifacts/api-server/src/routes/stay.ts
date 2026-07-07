/**
 * Stay Agent routes.
 *   POST /api/stay/decision  — run the governed check-in/in-stay/check-out engine.
 */
import { Router, type IRouter } from "express";
import { decideStay, type StayStage, type StayExceptionContext, type StayApaleoRef } from "../lib/stayDecisionEngine.js";
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

export default router;
