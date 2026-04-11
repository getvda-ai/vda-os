/**
 * HITL Token System — token-based human approval for onboarding workflow.
 * POST /api/hitl/escalate — create a decision card token
 * POST /api/hitl/respond/:token — approve/reject (calls orchestrator directly)
 * GET  /api/hitl/pending — all unresolved tokens for dashboard
 */
import { Router, type IRouter } from "express";
import { db, hitlTokens, onboardingRequests } from "@workspace/db";
import { eq, isNull } from "drizzle-orm";
import { advanceOrchestratorPhase } from "../onboarding/onboardingOrchestrator.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const REPLIT_URL = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : process.env.REPLIT_URL ?? "http://localhost:8080";

// ─── POST /api/hitl/escalate ──────────────────────────────────────────────────

router.post("/hitl/escalate", async (req, res) => {
  try {
    const { onboarding_request_id, phase, card_type = "approval", payload } = req.body as {
      onboarding_request_id: string;
      phase: number;
      card_type?: string;
      payload: Record<string, unknown>;
    };

    if (!onboarding_request_id || !phase || !payload) {
      res.status(400).json({ error: "Missing required fields: onboarding_request_id, phase, payload" });
      return;
    }

    const rows = await db.insert(hitlTokens).values({
      onboardingRequestId: onboarding_request_id,
      phase,
      cardType: card_type,
      payload,
    }).returning({ token: hitlTokens.token });

    const token = rows[0].token;
    const respondUrl = `${REPLIT_URL}/api/hitl/respond/${token}`;

    logger.info({ token, onboarding_request_id, phase, card_type }, "HITL token created");

    res.json({ token, respond_url: respondUrl, phase, card_type });
  } catch (err) {
    logger.error({ err }, "HITL escalate error");
    res.status(500).json({ error: "Failed to create HITL token" });
  }
});

// ─── POST /api/hitl/respond/:token ────────────────────────────────────────────

router.post("/hitl/respond/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const { outcome, reason = "", decided_by = "Dashboard User" } = req.body as {
      outcome: "approved" | "rejected" | "acknowledged";
      reason?: string;
      decided_by?: string;
    };

    if (!outcome || !["approved", "rejected", "acknowledged"].includes(outcome)) {
      res.status(400).json({ error: "outcome must be: approved | rejected | acknowledged" });
      return;
    }

    // Load token
    const rows = await db.select().from(hitlTokens).where(eq(hitlTokens.token, String(token))).limit(1);
    const hitl = rows[0];
    if (!hitl) {
      res.status(404).json({ error: "Token not found" });
      return;
    }
    if (hitl.outcome) {
      res.status(409).json({ error: "Token already resolved", outcome: hitl.outcome });
      return;
    }

    // Mark as resolved
    await db.update(hitlTokens)
      .set({ outcome, decidedAt: new Date() })
      .where(eq(hitlTokens.token, String(token)));

    logger.info({ token, outcome, decided_by, card_type: hitl.cardType }, "HITL token resolved");

    // For raci_notification: acknowledged resolves the card, no orchestrator call
    if (hitl.cardType === "raci_notification") {
      res.json({ status: "acknowledged", token, card_type: "raci_notification" });
      return;
    }

    // For approval cards: advance orchestrator phase directly (synchronous call)
    if (hitl.cardType === "approval" && (outcome === "approved" || outcome === "rejected")) {
      try {
        await advanceOrchestratorPhase(hitl.onboardingRequestId, outcome, decided_by);
      } catch (orchErr) {
        logger.error({ orchErr, onboardingRequestId: hitl.onboardingRequestId }, "Orchestrator phase advance failed");
        // Don't fail the HTTP response — token is already resolved
      }
    }

    res.json({
      status: "resolved",
      token,
      outcome,
      decided_by,
      onboarding_request_id: hitl.onboardingRequestId,
    });
  } catch (err) {
    logger.error({ err }, "HITL respond error");
    res.status(500).json({ error: "Failed to resolve HITL token" });
  }
});

// ─── GET /api/hitl/pending ────────────────────────────────────────────────────

router.get("/hitl/pending", async (_req, res) => {
  try {
    const pending = await db
      .select({
        token: hitlTokens.token,
        onboardingRequestId: hitlTokens.onboardingRequestId,
        phase: hitlTokens.phase,
        cardType: hitlTokens.cardType,
        payload: hitlTokens.payload,
        createdAt: hitlTokens.createdAt,
      })
      .from(hitlTokens)
      .where(isNull(hitlTokens.outcome));

    // Enrich with onboarding request status + companyId (for per-property pending context)
    const enriched = await Promise.all(
      pending.map(async (p) => {
        const reqRows = await db
          .select({ status: onboardingRequests.status, agentCard: onboardingRequests.agentCard, companyId: onboardingRequests.companyId })
          .from(onboardingRequests)
          .where(eq(onboardingRequests.id, p.onboardingRequestId))
          .limit(1);
        return {
          ...p,
          companyId: reqRows[0]?.companyId ?? null,
          onboarding_status: reqRows[0]?.status ?? "unknown",
          agent_name: (reqRows[0]?.agentCard as Record<string, unknown>)?.name ?? "Unknown Agent",
        };
      })
    );

    res.json({ pending: enriched, count: enriched.length });
  } catch (err) {
    logger.error({ err }, "HITL pending error");
    res.status(500).json({ error: "Failed to load pending HITL tokens" });
  }
});

// ─── GET /api/hitl/all ────────────────────────────────────────────────────────

router.get("/hitl/all", async (_req, res) => {
  try {
    const all = await db.select().from(hitlTokens).orderBy(hitlTokens.createdAt);
    res.json({ tokens: all, count: all.length });
  } catch (err) {
    logger.error({ err }, "HITL all error");
    res.status(500).json({ error: "Failed to load HITL tokens" });
  }
});

export default router;
