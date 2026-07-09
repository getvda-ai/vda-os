/**
 * Stay Agent routes.
 *   POST /api/stay/decision  — run the governed check-in/in-stay/check-out engine.
 */
import { Router, type IRouter } from "express";
import { db, hitlTokens, agentPhases, witnessEntries } from "@workspace/db";
import { and, eq, desc, sql } from "drizzle-orm";
import { decideStay, type StayStage, type StayExceptionContext, type StayApaleoRef } from "../lib/stayDecisionEngine.js";
import { listStayBaselines, revokeStayBaseline, createStayBaseline } from "../lib/stayBaselines.js";
import { executeStayAction } from "../lib/stayExecutor.js";
import { writeWitnessEntry } from "../lib/witnessWriter.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const VALID_STAGES = new Set(["check_in", "in_stay", "check_out"]);
const AGENT_SLUG = "stay-agent";
const AGENT_NAME = "Stay Agent";
const NEXT_BAND: Record<string, string> = { ambassador: "mod", mod: "compliance_officer", compliance_officer: "compliance_officer" };

/** Recompute agreement/override rates on agent_phases over the last 30 resolved stay cards. */
async function updateStayRates(companyId: number): Promise<{ agreement: number; override: number; sample: number }> {
  const rows = await db
    .select({ outcome: hitlTokens.outcome })
    .from(hitlTokens)
    .where(and(eq(hitlTokens.agentId, AGENT_SLUG), eq(hitlTokens.companyId, companyId), eq(hitlTokens.cardType, "operational_exception")))
    .orderBy(desc(hitlTokens.decidedAt))
    .limit(30);
  const resolved = rows.filter((r) => r.outcome === "approved" || r.outcome === "rejected");
  const total = resolved.length;
  const approved = resolved.filter((r) => r.outcome === "approved").length;
  const agreement = total > 0 ? approved / total : 0;
  const override = total > 0 ? (total - approved) / total : 0;
  if (total > 0) {
    await db
      .update(agentPhases)
      .set({ agreementRate: String(agreement), overrideRate: String(override) })
      .where(and(eq(agentPhases.companyId, companyId), eq(agentPhases.agentId, AGENT_SLUG)));
  }
  return { agreement, override, sample: total };
}

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

// ── GET /api/stay/hitl/pending?role_band=&company_id= — Ambassador/MoD queue ──
router.get("/stay/hitl/pending", async (req, res) => {
  try {
    const companyId = Number(req.query.company_id ?? req.query.companyId ?? 0);
    const roleBand = typeof req.query.role_band === "string" ? req.query.role_band : undefined;
    const conds = [eq(hitlTokens.agentId, AGENT_SLUG), eq(hitlTokens.companyId, companyId), sql`${hitlTokens.outcome} IS NULL`];
    if (roleBand) conds.push(eq(hitlTokens.roleBand, roleBand));
    const rows = await db.select().from(hitlTokens).where(and(...conds)).orderBy(desc(hitlTokens.createdAt));
    res.json({ companyId, roleBand: roleBand ?? null, count: rows.length, pending: rows });
  } catch (err) {
    logger.error({ err }, "stay/hitl/pending error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load pending cards" });
  }
});

// ── GET /api/stay/witness?company_id= — Witness tail for the Stay Agent ───────
router.get("/stay/witness", async (req, res) => {
  try {
    const companyId = Number(req.query.company_id ?? req.query.companyId ?? 0);
    const limit = Math.min(Number(req.query.limit ?? 40) || 40, 200);
    const rows = await db
      .select()
      .from(witnessEntries)
      .where(and(eq(witnessEntries.companyId, companyId), eq(witnessEntries.agent, AGENT_NAME)))
      .orderBy(desc(witnessEntries.createdAt))
      .limit(limit);
    res.json({ companyId, count: rows.length, entries: rows });
  } catch (err) {
    logger.error({ err }, "stay/witness error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load witness tail" });
  }
});

// ── POST /api/stay/hitl/respond/:token { outcome, reason, decided_by, role_band } ──
// outcome ∈ approve | deny | escalate | baseline
router.post("/stay/hitl/respond/:token", async (req, res) => {
  try {
    const token = String(req.params.token);
    const outcome = String(req.body?.outcome ?? "");
    const reason = String(req.body?.reason ?? "");
    const decidedBy = String(req.body?.decided_by ?? req.body?.decidedBy ?? "Dashboard User");
    if (!["approve", "deny", "escalate", "baseline"].includes(outcome)) {
      res.status(400).json({ error: "outcome must be approve | deny | escalate | baseline" });
      return;
    }

    const [hitl] = await db.select().from(hitlTokens).where(eq(hitlTokens.token, token)).limit(1);
    if (!hitl) {
      res.status(404).json({ error: "Token not found" });
      return;
    }
    if (hitl.outcome) {
      res.status(409).json({ error: "Token already resolved", outcome: hitl.outcome });
      return;
    }
    const payload = (hitl.payload ?? {}) as Record<string, unknown>;
    const companyId = hitl.companyId ?? 0;
    const ceilingBand = (payload.ceiling_band ?? {}) as Record<string, unknown>;
    const apaleoData = (payload.apaleo_data ?? {}) as Record<string, unknown>;

    const writeStayWitness = (decision: "PASS" | "FAIL" | "ESCALATE" | "INFO", eventCategory: string, clause: string, extra: Record<string, unknown> = {}) =>
      writeWitnessEntry({
        companyId,
        agent: AGENT_NAME,
        decision: { decision, clauseApplied: clause, actionProposed: String(payload.proposed_action ?? "Stay action"), exceptionApplied: false, escalationTarget: (payload.escalation_target as string) ?? null, reasoning: `${eventCategory} by ${decidedBy}${reason ? `: ${reason}` : ""}`, exceptionClass: (payload.exception_class as string) ?? undefined },
        fileReferenced: String(payload.clause_applied ?? "stay-agent.SOP.md"),
        apaleoData: { ...apaleoData, hitl_token: token, decided_by: decidedBy, art17: { stage: payload.stage, exception_class: payload.exception_class, event: eventCategory, ...extra } },
        eventCategory,
        suppressAutoHitl: true,
      });

    // ── ESCALATE — reroute up a band; no write; new card to the higher band. ──
    if (outcome === "escalate") {
      const fromBand = hitl.roleBand ?? "ambassador";
      const toBand = NEXT_BAND[fromBand] ?? "compliance_officer";
      await db.update(hitlTokens).set({ outcome: "escalated", decidedBy, decidedAt: new Date() }).where(eq(hitlTokens.token, token));
      const [rerouted] = await db
        .insert(hitlTokens)
        .values({ cardType: "operational_exception", phase: 0, agentId: AGENT_SLUG, companyId, roleBand: toBand, witnessEntryId: hitl.witnessEntryId, payload: { ...payload, role_band: toBand, escalation_target: toBand, escalated_from: fromBand, escalated_by: decidedBy }, context: hitl.context })
        .returning({ token: hitlTokens.token });
      const witnessId = await writeStayWitness("ESCALATE", "ESCALATE", `Escalated from ${fromBand} to ${toBand} by ${decidedBy}.`, { escalated_from: fromBand, escalated_to: toBand });
      res.json({ ok: true, action: "escalate", token, rerouted_token: rerouted?.token, from_band: fromBand, to_band: toBand, witness_entry_id: witnessId });
      return;
    }

    // ── DENY — block; no write. ──
    if (outcome === "deny") {
      await db.update(hitlTokens).set({ outcome: "rejected", decidedBy, decidedAt: new Date() }).where(eq(hitlTokens.token, token));
      const witnessId = await writeStayWitness("FAIL", "HITL_REJECTED", `Operational exception denied by ${decidedBy}.`);
      const rates = await updateStayRates(companyId);
      res.json({ ok: true, action: "deny", token, witness_entry_id: witnessId, rates });
      return;
    }

    // ── APPROVE / BASELINE — execute the Apaleo action; baseline also authorises going forward. ──
    let baselineId: string | null = null;
    if (outcome === "baseline") {
      try {
        const created = await createStayBaseline({
          companyId,
          stage: String(payload.stage ?? "global"),
          exceptionClass: String(payload.exception_class ?? "unknown"),
          requestedValue: typeof ceilingBand.requested_value === "number" ? (ceilingBand.requested_value as number) : undefined,
          ceilingType: (ceilingBand.ceiling_type as string) ?? null,
          currency: (payload.currency as string) ?? undefined,
          roleBand: hitl.roleBand ?? "ambassador",
          authorisedBy: decidedBy,
          escalateTo: (payload.escalation_target as string) ?? null,
          apaleoScope: apaleoData.propertyId ? { propertyId: apaleoData.propertyId } : null,
          approvedHitlToken: token,
          sourceClause: String(payload.clause_applied ?? ""),
        });
        baselineId = created.id;
      } catch (bErr) {
        logger.error({ bErr }, "[stay] baseline creation failed");
      }
    }

    const execution = await executeStayAction(payload);
    await db.update(hitlTokens).set({ outcome: "approved", decidedBy, decidedAt: new Date() }).where(eq(hitlTokens.token, token));
    const eventCategory = outcome === "baseline" ? "BASELINE_SET" : "HITL_APPROVED";
    const clause = outcome === "baseline"
      ? `Approved and baselined by ${decidedBy} — this task auto-PASSes within its bounds going forward.`
      : `Operational exception approved by ${decidedBy}; Apaleo action ${execution.status}.`;
    const witnessId = await writeStayWitness("PASS", eventCategory, clause, { apaleo_execution: execution, baseline_id: baselineId });
    const rates = await updateStayRates(companyId);
    res.json({ ok: true, action: outcome, token, apaleo_execution: execution, baseline_id: baselineId, witness_entry_id: witnessId, rates });
  } catch (err) {
    logger.error({ err }, "stay/hitl/respond error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to resolve card" });
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
        apaleoData: {
          baseline_id: id,
          revoked_by: revokedBy,
          revoked_reason: revokedReason,
          art17: { event: "BASELINE_REVOKED", baseline_id: id, revoked_by: revokedBy, revoked_reason: revokedReason },
        },
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
