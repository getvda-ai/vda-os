/**
 * HITL Token System — token-based human approval for onboarding workflow.
 * POST /api/hitl/escalate — create a decision card token
 * POST /api/hitl/respond/:token — approve/reject (calls orchestrator directly)
 * GET  /api/hitl/pending — all unresolved tokens for dashboard
 */
import { Router, type IRouter } from "express";
import { db, hitlTokens, onboardingRequests, agentPhases } from "@workspace/db";
import { eq, isNull, and, sql } from "drizzle-orm";
import { writeGovernanceEvent } from "../lib/writeGovernanceEvent.js";
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

    // Reject acknowledged outcome for operational_exception cards — only approved/rejected are valid
    if (hitl.cardType === "operational_exception" && outcome === "acknowledged") {
      // Roll back the outcome we just wrote
      await db.update(hitlTokens).set({ outcome: null, decidedAt: null }).where(eq(hitlTokens.token, String(token)));
      res.status(400).json({ error: "operational_exception cards only accept 'approved' or 'rejected' outcomes" });
      return;
    }

    logger.info({ token, outcome, decided_by, card_type: hitl.cardType }, "HITL token resolved");

    // For raci_notification: acknowledged resolves the card, no orchestrator call
    if (hitl.cardType === "raci_notification") {
      res.json({ status: "acknowledged", token, card_type: "raci_notification" });
      return;
    }

    // For operational_exception cards: update agent agreementRate/overrideRate + write witness
    if (hitl.cardType === "operational_exception") {
      const agentId = hitl.agentId;
      const companyId = hitl.companyId;

      if (agentId && companyId) {
        try {
          // Recompute rates from all resolved operational_exception tokens for this agent+company
          const allResolved = await db
            .select({ outcome: hitlTokens.outcome })
            .from(hitlTokens)
            .where(
              and(
                eq(hitlTokens.cardType, "operational_exception"),
                eq(hitlTokens.agentId, agentId),
                eq(hitlTokens.companyId, companyId),
              )
            );

          // Only count approved/rejected outcomes — acknowledged is not valid for operational
          // exception cards but may exist in legacy data; exclude it from rate computation.
          const resolved = allResolved.filter(r => r.outcome === "approved" || r.outcome === "rejected");
          const total = resolved.length;
          const approvedCount = resolved.filter(r => r.outcome === "approved").length;
          const rejectedCount = resolved.filter(r => r.outcome === "rejected").length;

          if (total > 0) {
            await db
              .update(agentPhases)
              .set({
                agreementRate: String(approvedCount / total),
                overrideRate: String(rejectedCount / total),
              })
              .where(
                and(
                  eq(agentPhases.companyId, companyId),
                  eq(agentPhases.agentId, agentId),
                )
              );
          }

          const payload = hitl.payload as Record<string, unknown>;
          await writeGovernanceEvent({
            companyId,
            agent: agentId,
            eventCategory: "HITL_RESOLVED",
            decision: outcome === "approved" ? "PASS" : "FAIL",
            clauseApplied: outcome === "approved"
              ? "Operational exception approved by authorised reviewer — agent decision validated"
              : "Operational exception rejected by authorised reviewer — agent decision overridden",
            actionProposed: `Operational HITL ${outcome} by ${decided_by}`,
            reasoning: `Exception card resolved: ${outcome} by ${decided_by}. Agent: ${agentId}, witness entry: ${hitl.witnessEntryId ?? "n/a"}`,
            fileReferenced: String(payload.file_referenced ?? "VDA-MD Operational HITL Protocol"),
            apaleoData: {
              event_type: "operational_hitl_resolved",
              token,
              outcome,
              decided_by,
              agent_id: agentId,
              witness_entry_id: hitl.witnessEntryId,
              agreement_rate: total > 0 ? approvedCount / total : null,
              override_rate: total > 0 ? rejectedCount / total : null,
            },
          });
        } catch (err) {
          logger.warn({ err, agentId, companyId }, "Failed to update agent rates for operational HITL resolution");
        }
      }

      res.json({
        status: "resolved",
        token,
        outcome,
        decided_by,
        card_type: "operational_exception",
        agent_id: agentId,
        company_id: companyId,
      });
      return;
    }

    // For approval cards: advance orchestrator phase directly (synchronous call)
    if (hitl.cardType === "approval" && (outcome === "approved" || outcome === "rejected")) {
      try {
        await advanceOrchestratorPhase(hitl.onboardingRequestId ?? "", outcome, decided_by);
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
    // Use raw SQL to bypass Drizzle ORM table-object processing which can fail
    // in production when schema differs from compiled bundle.
    const result = await db.execute(
      sql`SELECT token, onboarding_request_id, phase, card_type, payload,
               outcome, decided_at, created_at, agent_id, company_id,
               witness_entry_id, context
          FROM hitl_tokens
          WHERE outcome IS NULL
          ORDER BY created_at DESC`
    );

    type RawRow = {
      token: string;
      onboarding_request_id: string | null;
      phase: number;
      card_type: string;
      payload: Record<string, unknown>;
      outcome: string | null;
      decided_at: string | null;
      created_at: string;
      agent_id: string | null;
      company_id: number | null;
      witness_entry_id: string | null;
      context: Record<string, unknown> | null;
    };

    const pending = result.rows as RawRow[];

    // Map snake_case DB columns to camelCase to match frontend expectations
    const mapRow = (p: RawRow, extras: Record<string, unknown> = {}) => ({
      token: p.token,
      onboardingRequestId: p.onboarding_request_id,
      phase: p.phase,
      cardType: p.card_type,
      payload: p.payload,
      outcome: p.outcome,
      decidedAt: p.decided_at,
      createdAt: p.created_at,
      agentId: p.agent_id,
      companyId: p.company_id,
      witnessEntryId: p.witness_entry_id,
      context: p.context,
      ...extras,
    });

    const enriched = await Promise.all(
      pending.map(async (p) => {
        // Operational exception cards carry their own agentId/companyId
        if (p.card_type === "operational_exception") {
          const pl = p.payload as Record<string, unknown>;
          return mapRow(p, {
            onboarding_status: "operational",
            agent_name: String(pl.agent_name ?? p.agent_id ?? "Unknown Agent"),
          });
        }

        // Onboarding cards: join with onboarding_requests for status + agent name
        if (!p.onboarding_request_id) {
          return mapRow(p, { onboarding_status: "unknown", agent_name: "Unknown Agent" });
        }
        const reqResult = await db.execute(
          sql`SELECT status, agent_card FROM onboarding_requests WHERE id = ${p.onboarding_request_id} LIMIT 1`
        );
        const req = reqResult.rows[0] as { status: string; agent_card: Record<string, unknown> } | undefined;
        return mapRow(p, {
          onboarding_status: req?.status ?? "unknown",
          agent_name: (req?.agent_card as Record<string, unknown>)?.name ?? "Unknown Agent",
        });
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
