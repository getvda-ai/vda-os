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
import { sealStayEvent } from "../lib/staySeal.js";
import { getRoleBandAuthority } from "../lib/exceptionAuthorityReader.js";
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

    // Write the resolution/governance witness entry AND seal it into VDA Witness
    // (so every made decision + governance change carries the tamper-evident badge).
    const writeStayWitness = async (decision: "PASS" | "FAIL" | "ESCALATE" | "INFO", eventCategory: string, clause: string, extra: Record<string, unknown> = {}): Promise<number> => {
      const id = await writeWitnessEntry({
        companyId,
        agent: AGENT_NAME,
        decision: { decision, clauseApplied: clause, actionProposed: String(payload.proposed_action ?? "Stay action"), exceptionApplied: false, escalationTarget: (payload.escalation_target as string) ?? null, reasoning: `${eventCategory} by ${decidedBy}${reason ? `: ${reason}` : ""}`, exceptionClass: (payload.exception_class as string) ?? undefined },
        fileReferenced: String(payload.clause_applied ?? "stay-agent.SOP.md"),
        apaleoData: { ...apaleoData, hitl_token: token, decided_by: decidedBy, role_band: hitl.roleBand, art17: { stage: payload.stage, exception_class: payload.exception_class, event: eventCategory, decided_by: decidedBy, role_band: hitl.roleBand, ...extra } },
        eventCategory,
        suppressAutoHitl: true,
      });
      await sealStayEvent({
        companyId,
        localWitnessId: id,
        verdict: eventCategory,
        reasoning: `${eventCategory} by ${decidedBy}${reason ? `: ${reason}` : ""}`,
        actionProposed: String(payload.proposed_action ?? "Stay action"),
        inputs: { stage: payload.stage, exception_class: payload.exception_class, decided_by: decidedBy, role_band: hitl.roleBand, hitl_token: token, ...extra },
        ruleId: String(payload.clause_applied ? "stay-agent.EXCEPTION_AUTHORITY.md" : "stay-agent.SOP.md"),
        ruleText: String(payload.clause_applied ?? clause),
        exceptionClass: (payload.exception_class as string) ?? undefined,
      });
      return id;
    };

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
          scopeAttrs: (payload.context_attrs as Record<string, unknown>) ?? null,
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
    // A real Apaleo write returns an id → record it as a first-class charge_posted event.
    const eventCategory = execution.apaleoId ? "charge_posted" : outcome === "baseline" ? "BASELINE_SET" : "HITL_APPROVED";
    const clause = execution.apaleoId
      ? `Approved by ${decidedBy}; posted Apaleo ${execution.tool} → id ${execution.apaleoId}.`
      : outcome === "baseline"
        ? `Approved and baselined by ${decidedBy} — this task auto-PASSes within its bounds going forward.`
        : `Operational exception approved by ${decidedBy}; Apaleo action ${execution.status}.`;
    const witnessId = await writeStayWitness("PASS", eventCategory, clause, { apaleo_execution: execution, apaleo_charge_id: execution.apaleoId ?? null, baseline_id: baselineId });
    const rates = await updateStayRates(companyId);
    res.json({ ok: true, action: outcome, token, apaleo_execution: execution, apaleo_charge_id: execution.apaleoId ?? null, baseline_id: baselineId, witness_entry_id: witnessId, rates });
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
    // "N auto-handled since" — count baseline_applied decisions per class since
    // each baseline was created (a baseline auto-PASSes matching requests).
    const applied = await db
      .select({ createdAt: witnessEntries.createdAt, apaleoData: witnessEntries.apaleoData })
      .from(witnessEntries)
      .where(and(eq(witnessEntries.companyId, companyId), eq(witnessEntries.agent, AGENT_NAME), eq(witnessEntries.eventCategory, "baseline_applied")))
      .orderBy(desc(witnessEntries.createdAt))
      .limit(500);
    const countAuto = (exceptionClass: string, since: Date | null): number =>
      applied.filter((a) => {
        const art = ((a.apaleoData ?? {}) as Record<string, unknown>).art17 as Record<string, unknown> | undefined;
        return art?.exception_class === exceptionClass && (!since || (a.createdAt && a.createdAt >= since));
      }).length;
    const baselines = rows.map((r) => ({
      id: r.id,
      company_id: r.companyId,
      agent_id: r.agentId,
      stage: r.stage,
      exception_class: r.exceptionClass,
      auto_handled: countAuto(r.exceptionClass, r.createdAt ?? null),
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
    // Witness: BASELINE_REVOKED — a sealed, MoD-attributed governance event
    // (forward + flag: future matching requests return to HITL; past auto-
    // approvals stand). Append-only; the baseline row is retained.
    const companyId = Number(req.body?.company_id ?? req.body?.companyId ?? 0) || 0;
    try {
      const wid = await writeWitnessEntry({
        companyId,
        agent: "Stay Agent",
        decision: {
          decision: "INFO",
          clauseApplied: `Class unbaselined on ${new Date().toISOString().slice(0, 10)} by ${revokedBy} — future matching requests return to HITL; past auto-approvals stand.`,
          actionProposed: "Unbaseline (revoke) governance change",
          exceptionApplied: false,
          escalationTarget: null,
          reasoning: `Baseline ${id} revoked by ${revokedBy}: ${revokedReason}`,
        },
        fileReferenced: `baseline:${id}`,
        apaleoData: {
          baseline_id: id,
          revoked_by: revokedBy,
          revoked_reason: revokedReason,
          role_band: "mod",
          art17: { event: "BASELINE_REVOKED", baseline_id: id, revoked_by: revokedBy, revoked_reason: revokedReason, role_band: "mod", decided_by: revokedBy },
        },
        eventCategory: "BASELINE_REVOKED",
        suppressAutoHitl: true,
      });
      await sealStayEvent({
        companyId,
        localWitnessId: wid,
        verdict: "BASELINE_REVOKED",
        reasoning: `Baseline ${id} unbaselined by ${revokedBy}: ${revokedReason}`,
        actionProposed: "Unbaseline (governance change)",
        inputs: { baseline_id: id, revoked_by: revokedBy, role_band: "mod" },
        ruleId: "stay-agent.EXCEPTION_AUTHORITY.md",
        ruleText: "Baselines are always revocable and never hard-deleted; revoking returns the class to human review going forward while past authorised decisions stand.",
      });
    } catch (wErr) {
      logger.warn({ wErr }, "baseline revoke witness/seal failed (continuing)");
    }
    res.json({ ok: true, id, revoked_by: revokedBy, revoked_reason: revokedReason });
  } catch (err) {
    logger.error({ err }, "baseline revoke error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to revoke baseline" });
  }
});

// ── GET /api/stay/authority?company_id=&role_band= — ceilings from governance ──
// The front-end reads ceilings/authority from here (never hardcodes them), so
// ingesting real citizenM governance changes what a role can do automatically.
router.get("/stay/authority", async (req, res) => {
  try {
    const companyId = Number(req.query.company_id ?? req.query.companyId ?? 0);
    const roleBand = String(req.query.role_band ?? "ambassador");
    const band = await getRoleBandAuthority(AGENT_SLUG, companyId, roleBand);
    const exceptions = (band?.exceptions ?? []).map((e) => ({
      exception_class: e.exception_class,
      description: e.description ?? null,
      ceiling: e.ceiling ?? null,
      ceiling_type: e.ceiling_type ?? null,
      authority: e.authority,
      escalate_to: e.escalate_to ?? null,
      conditions: e.conditions ?? [],
    }));
    res.json({ companyId, role_band: roleBand, can_baseline: roleBand === "mod", exceptions, rejected_classes: band?.rejectedClasses ?? [] });
  } catch (err) {
    logger.error({ err }, "stay/authority error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load authority" });
  }
});

// ── GET /api/stay/log?company_id=&limit= — unified "Made" evidence log ─────────
// One row per governed decision / governance event, each with who/role/clause/
// outcome and a VDA Witness sealed badge (external record + the record to verify).
router.get("/stay/log", async (req, res) => {
  try {
    const companyId = Number(req.query.company_id ?? req.query.companyId ?? 0);
    const limit = Math.min(Number(req.query.limit ?? 60) || 60, 200);
    const rows = await db
      .select()
      .from(witnessEntries)
      .where(and(eq(witnessEntries.companyId, companyId), eq(witnessEntries.agent, AGENT_NAME)))
      .orderBy(desc(witnessEntries.createdAt))
      .limit(limit * 2); // include the seal link-entries we fold in

    // Index seal link-entries by the local witness id they reference.
    const sealByLocal = new Map<number, { external_record_id: string | null; sealed_record: unknown }>();
    for (const r of rows) {
      const a = (r.apaleoData ?? {}) as Record<string, unknown>;
      if (r.eventCategory === "vda_witness_sealed") {
        const localId = (a.art17 as Record<string, unknown> | undefined)?.local_witness_id as number | undefined;
        if (typeof localId === "number") sealByLocal.set(localId, { external_record_id: ((a.art17 as Record<string, unknown>)?.external_record_id as string) ?? null, sealed_record: a.vda_witness_record });
      }
    }

    const made = rows
      .filter((r) => r.eventCategory !== "vda_witness_sealed")
      .slice(0, limit)
      .map((r) => {
        const a = (r.apaleoData ?? {}) as Record<string, unknown>;
        const art = (a.art17 ?? {}) as Record<string, unknown>;
        const seal = sealByLocal.get(r.id);
        const isGovernance = r.eventCategory === "BASELINE_SET" || r.eventCategory === "BASELINE_REVOKED";
        return {
          id: r.id,
          at: r.createdAt,
          decision: r.decision,
          event: r.eventCategory,
          kind: isGovernance ? "governance" : "decision",
          exception_class: (art.exception_class as string) ?? null,
          stage: (art.stage as string) ?? null,
          clause: r.clauseApplied,
          reasoning: r.reasoning,
          decided_by: (a.decided_by as string) ?? (art.decided_by as string) ?? AGENT_NAME,
          role_band: (a.role_band as string) ?? (art.role_band as string) ?? null,
          apaleo_charge_id: (art.apaleo_charge_id as string) ?? (a.apaleo_charge_id as string) ?? null,
          governance_source: (art.governance_source as string) ?? null,
          sealed: Boolean(seal?.external_record_id),
          external_record_id: seal?.external_record_id ?? null,
          sealed_record: seal?.sealed_record ?? null,
        };
      });
    res.json({ companyId, count: made.length, made });
  } catch (err) {
    logger.error({ err }, "stay/log error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load log" });
  }
});

export default router;
