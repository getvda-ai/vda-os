/**
 * HITL Token System — token-based human approval for onboarding workflow.
 * POST /api/hitl/escalate — create a decision card token
 * POST /api/hitl/respond/:token — approve/reject (calls orchestrator directly)
 * GET  /api/hitl/pending — all unresolved tokens for dashboard (role-band filtered)
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

// Canonical escalation_target → role_band mapping
const ESCALATION_TO_ROLE_BAND: Record<string, string> = {
  "Revenue Manager":      "hotel_gm",
  "Operations Director":  "hotel_gm",
  "Credit Control team":  "hotel_gm",
  "VP Revenue":           "regional_gm",
  "CFO":                  "regional_gm",
  "CISO":                 "operations_chief",
  "first_hitl_approval":  "compliance_officer",
  "second_hitl_approval": "compliance_officer",
};

function deriveRoleBand(payload: Record<string, unknown>): string | null {
  const target = payload?.escalation_target as string | undefined;
  if (!target) return null;
  const band = ESCALATION_TO_ROLE_BAND[target];
  if (!band) {
    logger.warn({ escalation_target: target }, "[HITL] Unrecognised escalation_target — role_band left NULL");
    return null;
  }
  return band;
}

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

    const roleBand = deriveRoleBand(payload);

    const rows = await db.insert(hitlTokens).values({
      onboardingRequestId: onboarding_request_id,
      phase,
      cardType: card_type,
      payload,
      roleBand,
    }).returning({ token: hitlTokens.token });

    const token = rows[0].token;
    const respondUrl = `${REPLIT_URL}/api/hitl/respond/${token}`;

    logger.info({ token, onboarding_request_id, phase, card_type, roleBand }, "HITL token created");

    res.json({ token, respond_url: respondUrl, phase, card_type, role_band: roleBand });
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
      .set({ outcome, decidedBy: decided_by, decidedAt: new Date() })
      .where(eq(hitlTokens.token, String(token)));

    // Reject acknowledged outcome for operational_exception cards — only approved/rejected are valid
    if (hitl.cardType === "operational_exception" && outcome === "acknowledged") {
      await db.update(hitlTokens).set({ outcome: null, decidedBy: null, decidedAt: null }).where(eq(hitlTokens.token, String(token)));
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
      const roleBand = hitl.roleBand;

      if (agentId && companyId) {
        try {
          // ── Overall agreement rate (across all bands for this agent+company) ──
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

          // ── Per-band agreement rate (persisted into role_band_phases[band]) ──
          if (roleBand) {
            const bandResolved = await db
              .select({ outcome: hitlTokens.outcome })
              .from(hitlTokens)
              .where(
                and(
                  eq(hitlTokens.cardType, "operational_exception"),
                  eq(hitlTokens.agentId, agentId),
                  eq(hitlTokens.companyId, companyId),
                  eq(hitlTokens.roleBand, roleBand),
                )
              );

            const bResolved = bandResolved.filter(r => r.outcome === "approved" || r.outcome === "rejected");
            const bTotal = bResolved.length;
            const bApproved = bResolved.filter(r => r.outcome === "approved").length;

            if (bTotal > 0) {
              // Fetch current roleBandPhases JSON and merge the updated band rate.
              const phaseRows = await db
                .select({ roleBandPhases: agentPhases.roleBandPhases, phase: agentPhases.phase })
                .from(agentPhases)
                .where(and(eq(agentPhases.companyId, companyId), eq(agentPhases.agentId, agentId)))
                .limit(1);

              // Always write full 6-band structure to keep storage normalized.
              const overallPhase = phaseRows[0]?.phase ?? "crawl";
              const FRONT_LINE_BANDS = ["ambassador", "senior_ambassador", "hotel_gm"];
              const CROSS_PROPERTY_BANDS = ["regional_gm", "operations_chief", "compliance_officer"];
              const stored = (phaseRows[0]?.roleBandPhases ?? {}) as Record<string, { phase?: string; agreementRate?: number | null; overrideRate?: number | null }>;

              // Synthesize full structure: defaults for missing bands, preserve stored values for others.
              const fullBandPhases: Record<string, { phase: string; agreementRate: number | null; overrideRate: number | null }> = {};
              for (const b of FRONT_LINE_BANDS) {
                fullBandPhases[b] = { phase: overallPhase, agreementRate: null, overrideRate: null, ...(stored[b] ?? {}) };
              }
              for (const b of CROSS_PROPERTY_BANDS) {
                fullBandPhases[b] = { phase: "not_applicable", agreementRate: null, overrideRate: null, ...(stored[b] ?? {}) };
              }
              // Apply updated band rate
              const bandEntry = fullBandPhases[roleBand] ?? { phase: "crawl", agreementRate: null, overrideRate: null };
              fullBandPhases[roleBand] = {
                ...bandEntry,
                agreementRate: bApproved / bTotal,
                overrideRate: (bTotal - bApproved) / bTotal,
              };

              await db
                .update(agentPhases)
                .set({ roleBandPhases: fullBandPhases })
                .where(and(eq(agentPhases.companyId, companyId), eq(agentPhases.agentId, agentId)));
            }
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
              role_band: roleBand,
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
// Optional query params:
//   ?role_band=hotel_gm          — filter to that band (compliance_officer also sees NULL-band tokens)
//   ?company_id=2                — filter to that company (comma-separated for Regional GM, e.g. 1,2,3,4,5)
//   No params                    — return all (existing behaviour)

router.get("/hitl/pending", async (req, res) => {
  try {
    const roleBandParam = req.query.role_band as string | undefined;
    const companyIdParam = req.query.company_id as string | undefined;

    // All conditions use Drizzle parameterized sql`` — no sql.raw or string interpolation.
    // Build each condition as a sql fragment, compose them with AND.
    type SqlFragment = ReturnType<typeof sql>;

    // Always filter resolved-out tokens
    const fragments: SqlFragment[] = [sql`outcome IS NULL`];

    if (roleBandParam) {
      if (roleBandParam === "compliance_officer") {
        // Compliance Officer sees their band + NULL (onboarding/legacy cards)
        fragments.push(sql`(role_band = ${"compliance_officer"} OR role_band IS NULL)`);
      } else {
        // All other roles see strictly their band — no NULL fallback
        fragments.push(sql`role_band = ${roleBandParam}`);
      }
    }

    if (companyIdParam) {
      // Only accept comma-separated positive integers to avoid injection
      const ids = companyIdParam.split(",").map(s => s.trim()).filter(s => /^\d+$/.test(s)).map(Number);
      if (ids.length === 1) {
        fragments.push(sql`company_id = ${ids[0]}`);
      } else if (ids.length > 1) {
        // Parameterized ANY(ARRAY[...]) — fully safe
        fragments.push(sql`company_id = ANY(ARRAY[${sql.join(ids.map(id => sql`${id}`), sql`, `)}])`);
      }
    }

    // Compose all conditions using Drizzle's sql.join helper
    const whereClause = sql.join(fragments, sql` AND `);

    const result = await db.execute(
      sql`SELECT token, onboarding_request_id, phase, card_type, payload,
               outcome, decided_at, created_at, agent_id, company_id,
               witness_entry_id, context, role_band
          FROM hitl_tokens
          WHERE ${whereClause}
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
      role_band: string | null;
    };

    const pending = result.rows as RawRow[];

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
      roleBand: p.role_band,
      ...extras,
    });

    const enriched = await Promise.all(
      pending.map(async (p) => {
        if (p.card_type === "operational_exception") {
          const pl = p.payload as Record<string, unknown>;
          return mapRow(p, {
            onboarding_status: "operational",
            agent_name: String(pl.agent_name ?? p.agent_id ?? "Unknown Agent"),
          });
        }

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
