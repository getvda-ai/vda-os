/**
 * Stay Agent routes.
 *   POST /api/stay/decision  — run the governed check-in/in-stay/check-out engine.
 */
import { Router, type IRouter } from "express";
import { db, hitlTokens, agentPhases, witnessEntries, sealOutbox, companies } from "@workspace/db";
import { and, eq, desc, sql, inArray } from "drizzle-orm";
import { decideStay, type StayStage, type StayExceptionContext, type StayApaleoRef } from "../lib/stayDecisionEngine.js";
import { listStayBaselines, revokeStayBaseline, createStayBaseline } from "../lib/stayBaselines.js";
import { executeStayAction } from "../lib/stayExecutor.js";
import { writeWitnessEntry } from "../lib/witnessWriter.js";
import { sealStayEvent } from "../lib/staySeal.js";
import { drainSealOutbox, outboxHealth } from "../lib/sealOutbox.js";
import { anchorStatus, fetchRecords, fetchReport, witnessKeyHealth } from "../lib/witnessClient.js";
import { generateEuAiActReport, C2MD_CONTRACT } from "../lib/c2mdClient.js";
import { stayChainKey } from "../lib/witnessChain.js";
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
    // Opportunistic, bounded drain so freshly-enqueued seals land their record
    // ref before we render the tail. Best-effort — never fails the read.
    try { await drainSealOutbox(8); } catch { /* drain is advisory */ }
    const rows = await db
      .select()
      .from(witnessEntries)
      .where(and(eq(witnessEntries.companyId, companyId), eq(witnessEntries.agent, AGENT_NAME)))
      .orderBy(desc(witnessEntries.createdAt))
      .limit(limit);
    const outbox = await outboxHealth(companyId);
    res.json({ companyId, count: rows.length, entries: rows, outbox });
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
      // Baseline / unbaseline are MoD-only governance events — attribute them to
      // the MoD role, not the card's routing band (which may be ambassador).
      const eventRole = (eventCategory === "BASELINE_SET" || eventCategory === "BASELINE_REVOKED") ? "mod" : (hitl.roleBand ?? "ambassador");
      const id = await writeWitnessEntry({
        companyId,
        agent: AGENT_NAME,
        decision: { decision, clauseApplied: clause, actionProposed: String(payload.proposed_action ?? "Stay action"), exceptionApplied: false, escalationTarget: (payload.escalation_target as string) ?? null, reasoning: `${eventCategory} by ${decidedBy}${reason ? `: ${reason}` : ""}`, exceptionClass: (payload.exception_class as string) ?? undefined },
        fileReferenced: String(payload.clause_applied ?? "stay-agent.SOP.md"),
        apaleoData: { ...apaleoData, hitl_token: token, decided_by: decidedBy, role_band: eventRole, art17: { stage: payload.stage, exception_class: payload.exception_class, event: eventCategory, decided_by: decidedBy, role_band: eventRole, ...extra } },
        eventCategory,
        suppressAutoHitl: true,
        skipC2pa: true, // evidence of record is the real VDA Witness seal
      });
      await sealStayEvent({
        companyId,
        localWitnessId: id,
        verdict: eventCategory,
        reasoning: `${eventCategory} by ${decidedBy}${reason ? `: ${reason}` : ""}`,
        actionProposed: String(payload.proposed_action ?? "Stay action"),
        // PII-minimized in sealStayEvent → minimizeInputs (pseudonymous ids only).
        inputs: {
          reservationId: (apaleoData.reservationId as string) ?? (payload.reservation_id as string),
          folioId: (apaleoData.folioId as string) ?? (payload.folio_id as string),
          propertyId: apaleoData.propertyId as string,
          stage: payload.stage,
          exception_class: payload.exception_class,
          amount: ceilingBand.requested_value,
          currency: payload.currency,
          role_band: eventRole,
          ...extra,
        },
        ruleId: String(payload.clause_applied ? "stay-agent.EXCEPTION_AUTHORITY.md" : "stay-agent.SOP.md"),
        ruleText: String(payload.clause_applied ?? clause),
        exceptionClass: (payload.exception_class as string) ?? undefined,
        propertyId: (apaleoData.propertyId as string) ?? null,
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
    // Sandbox framing: an unexecuted write is STAGED (ready to execute in test),
    // not inert.
    const apaleoPhrase = execution.apaleoId
      ? `posted Apaleo ${execution.tool} → id ${execution.apaleoId}`
      : execution.status === "SANDBOX_NO_WRITE"
        ? (execution.tool ? `Apaleo ${execution.tool} staged (sandbox — ready to execute in test)` : "no Apaleo write required")
        : `Apaleo action ${execution.status}`;
    const clause = outcome === "baseline"
      ? `Approved and baselined by ${decidedBy} — this task auto-PASSes within its bounds going forward; ${apaleoPhrase}.`
      : `Operational exception approved by ${decidedBy}; ${apaleoPhrase}.`;
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
        skipC2pa: true, // evidence of record is the real VDA Witness seal
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
    // Opportunistic bounded drain so newly-made decisions show their seal ref.
    try { await drainSealOutbox(8); } catch { /* advisory */ }
    const rows = await db
      .select()
      .from(witnessEntries)
      .where(and(eq(witnessEntries.companyId, companyId), eq(witnessEntries.agent, AGENT_NAME)))
      .orderBy(desc(witnessEntries.createdAt))
      .limit(limit * 2);

    // Legacy fold: older entries recorded the seal as a separate link-entry.
    // New entries carry witnessSealRef / witnessState directly on the row.
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
        const legacy = sealByLocal.get(r.id);
        const ref = (r.witnessSealRef ?? null) as Record<string, unknown> | null;
        const recordId = (ref?.recordId as string) ?? legacy?.external_record_id ?? null;
        // Three-state, verbatim: SIGNED_PENDING / ANCHORED_VALID / BROKEN, plus
        // the pre-seal lifecycle states pending/unsealed.
        const witnessState = r.witnessState ?? (recordId ? "SIGNED_PENDING" : legacy?.external_record_id ? "SIGNED_PENDING" : "pending");
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
          sealed: Boolean(recordId),
          witness_state: witnessState, // ANCHORED_VALID | SIGNED_PENDING | BROKEN | pending | unsealed
          external_record_id: recordId,
          chain_key: (ref?.chainKey as string) ?? null,
          sealed_record: ref?.record ?? legacy?.sealed_record ?? null,
        };
      });
    // Attach the authoritative per-row outbox status (pending | sealed | dead) so
    // the dashboard can render the seal-state matrix honestly — "sealed" and
    // "verified" are different truths, and a dead-letter is a visible evidence gap.
    const decisionIds = made.map((m) => `stay-${companyId}-${m.id}`);
    if (decisionIds.length) {
      const obRows = await db
        .select({ d: sealOutbox.decisionId, s: sealOutbox.status })
        .from(sealOutbox)
        .where(and(eq(sealOutbox.companyId, companyId), inArray(sealOutbox.decisionId, decisionIds)));
      const statusByDecision = new Map(obRows.map((r) => [r.d, r.s]));
      for (const m of made) (m as { seal_status?: string | null }).seal_status = statusByDecision.get(`stay-${companyId}-${m.id}`) ?? null;
    }
    res.json({ companyId, count: made.length, made, outbox: await outboxHealth(companyId) });
  } catch (err) {
    logger.error({ err }, "stay/log error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load log" });
  }
});

// ── /api/stay/seal/drain — drain the fail-open seal-outbox to VDA Witness ──────
// Idempotent + safe to call from a Vercel cron (GET), the UI, or a test (POST).
// Never seals PII. This is what lands delayed seals after a Witness outage.
const drainHandler = async (req: import("express").Request, res: import("express").Response): Promise<void> => {
  // Guard: when CRON_SECRET is configured (production), require it. Vercel Cron
  // sends `Authorization: Bearer ${CRON_SECRET}`. Header-only — never accept the
  // secret from the query string. The UI never hits this route (it drains on read).
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const provided = auth || String(req.headers["x-cron-secret"] ?? "");
    if (provided !== cronSecret) { res.status(401).json({ error: "unauthorized" }); return; }
  }
  try {
    const limit = Math.min(Number(req.body?.limit ?? req.query.limit ?? 25) || 25, 100);
    const result = await drainSealOutbox(limit);
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error({ err }, "stay/seal/drain error");
    res.status(500).json({ error: err instanceof Error ? err.message : "drain failed" });
  }
};
router.post("/stay/seal/drain", drainHandler);
router.get("/stay/seal/drain", drainHandler);

// ── GET /api/stay/seal/health?company_id= — outbox status counts (Witness tab) ─
router.get("/stay/seal/health", async (req, res) => {
  try {
    const companyId = Number(req.query.company_id ?? req.query.companyId ?? 0) || undefined;
    const key = witnessKeyHealth();
    res.json({ ok: true, outbox: await outboxHealth(companyId), key, red: key.red });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "health failed" });
  }
});

// ── GET /api/stay/anchor-status?company_id= — truthful tier, from observed state ─
// Tier is DERIVED from what the records actually are + Witness anchor status, never
// from a config string that merely claims a tier. Compliance-grade only when the
// head is anchored AND records genuinely read ANCHORED_VALID. Never leaks the key.
router.get("/stay/anchor-status", async (req, res) => {
  try {
    const companyId = Number(req.query.company_id ?? req.query.companyId ?? 0);
    // Observed local record lifecycle states.
    const rows = await db
      .select({ s: witnessEntries.witnessState, n: sql<number>`count(*)::int` })
      .from(witnessEntries)
      .where(and(eq(witnessEntries.companyId, companyId), eq(witnessEntries.agent, AGENT_NAME)))
      .groupBy(witnessEntries.witnessState);
    const states: Record<string, number> = {};
    for (const r of rows) states[r.s ?? "none"] = r.n;

    // External anchor status (a read, NOT verify — a network call here is fine).
    let anchor: Record<string, unknown> = {};
    try { anchor = await anchorStatus(); } catch { anchor = {}; }
    const headAnchored = Boolean(anchor.headAnchored);
    const externalValid = Boolean(anchor.externalValid);
    const anchoredThroughSeq = (anchor.anchoredThroughSeq as number | null) ?? null;
    const anyAnchoredRecord = (states.ANCHORED_VALID ?? 0) > 0;

    // Compliance-grade ONLY when the head is anchored and records read ANCHORED_VALID.
    const tier: "anchored" | "test" = headAnchored && anyAnchoredRecord ? "anchored" : "test";
    // Mismatch: the external chain claims anchoring but no local record reads anchored
    // yet (or vice versa). Surface it — the UI must not be able to lie about the key.
    const mismatch = headAnchored !== anyAnchoredRecord;

    // The pinned/bound Witness account + key health — so the badge shows WHICH
    // account seals land in, and goes red on a rejected key / account mismatch.
    const key = witnessKeyHealth();

    res.json({ ok: true, tier, observed: { headAnchored, externalValid, anchoredThroughSeq }, states, mismatch, account: key.boundAccount, expectedAccount: key.expected, keyHealth: key.health, keyRed: key.red });
  } catch (err) {
    logger.error({ err }, "stay/anchor-status error");
    res.status(500).json({ error: err instanceof Error ? err.message : "anchor-status failed" });
  }
});

// ── POST /api/stay/verify — REAL offline verification (SDK), three-state. ──────
// Zero calls back to Witness: Ed25519 + hash-chain + anchor checked from the
// bundled proof against the resolved did:web key. Returns the verdict verbatim.
router.post("/stay/verify", async (req, res) => {
  try {
    const record = req.body?.record ?? (req.body?.sealed_record as Record<string, unknown> | undefined);
    if (!record) { res.status(400).json({ error: "record required" }); return; }
    const { verifyOffline } = await import("../lib/witnessClient.js");
    const verdict = await verifyOffline(record, Array.isArray(req.body?.chain) ? req.body.chain : undefined, req.body?.anchor);
    res.json({ ok: true, verdict });
  } catch (err) {
    logger.error({ err }, "stay/verify error");
    res.status(500).json({ error: err instanceof Error ? err.message : "verify failed" });
  }
});

// Resolve a company's stay-agent chain key from its Apaleo property (falls back to
// the company-scoped key). One chain per property: `${propertyId}:stay-agent`.
async function chainKeyForCompany(companyId: number, override?: string): Promise<string> {
  if (override && override.trim()) return override.trim();
  const [c] = await db.select({ p: companies.apaleoPropertyId }).from(companies).where(eq(companies.id, companyId)).limit(1);
  return stayChainKey(c?.p, companyId);
}

// ── GET /api/stay/records — evidence trail from VDA Witness (account by key) ────
// Account-isolated: the account is derived server-side from the Bearer key; we NEVER
// send an accountId. chainKey scopes to this property. A foreign chainKey returns
// empty (no existence leak).
router.get("/stay/records", async (req, res) => {
  try {
    const companyId = Number(req.query.company_id ?? req.query.companyId ?? 0);
    const chainKey = await chainKeyForCompany(companyId, req.query.chain_key as string | undefined);
    const raw = await fetchRecords(chainKey);
    const records = (raw.records ?? raw.data ?? raw.entries ?? []) as Array<Record<string, unknown>>;
    // Render each record with Phase-2 honesty — three-state comes from offline verify
    // on demand; here we surface the durable lifecycle facts verbatim.
    const items = records.map((r) => ({
      recordId: r.recordId ?? r.id,
      seq: r.seq,
      issuedAt: r.issuedAt,
      verdict: (r.decision as { verdict?: string })?.verdict ?? null,
      agent: (r.decision as { agent?: string })?.agent ?? null,
      ruleId: (r.governingRule as { ruleId?: string })?.ruleId ?? null,
      anchored: Boolean((r.proof as { anchor?: unknown })?.anchor),
      record: r, // full record for offline Verify
    }));
    res.json({ ok: true, chainKey, account: raw.account ?? null, count: items.length, records: items, isolation: "account derived from key; no accountId sent" });
  } catch (err) {
    logger.error({ err }, "stay/records error");
    res.status(500).json({ error: err instanceof Error ? err.message : "records failed" });
  }
});

// ── POST /api/stay/report — EU AI Act Article-12 evidence report (from Witness) ─
// Generated by VDA Witness from the sealed trail (empty body — account from key).
// Rendered VERBATIM by the UI: reportType, lifecycle, entries, integrity, scope,
// disclaimer. On the test key lifecycle reads DEMO_DATA — shown as-is, never upgraded.
router.post("/stay/report", async (_req, res) => {
  try {
    const raw = await fetchReport();
    res.json({ ok: true, report: raw.report ?? raw });
  } catch (err) {
    logger.error({ err }, "stay/report error");
    res.status(500).json({ error: err instanceof Error ? err.message : "report failed" });
  }
});

// ── POST /api/stay/eu-ai-act-report — EU AI Act Article-by-Article via C2MD ─────
// C2MD owns the Article logic; the Stay Agent orchestrates. KEY-SAFE: the Witness
// account key is never sent to C2MD (enforced in c2mdClient). C2MD's only trail-
// backed mode requires that key, which we refuse — so this returns the DEMO report
// (SAMPLE — DEMO DATA, not evidenced from our trail) and surfaces the blocker.
router.post("/stay/eu-ai-act-report", async (req, res) => {
  try {
    const companyId = Number(req.body?.company_id ?? req.body?.companyId ?? 0);
    let industry: string | undefined; let desc: string;
    try {
      const [c] = await db.select({ name: companies.companyName, ind: companies.industry }).from(companies).where(eq(companies.id, companyId)).limit(1);
      industry = c?.ind ?? "Hospitality";
      desc = `${c?.name ?? "citizenM Stay Agent"} — an AI agent managing a hotel guest's on-property journey (check-in, in-stay, check-out), making governed exception decisions under human-in-the-loop oversight, sealing each decision into VDA Witness.`;
    } catch { industry = "Hospitality"; desc = "citizenM Stay Agent — hotel guest journey agent with HITL governance, decisions sealed into VDA Witness."; }
    const result = await generateEuAiActReport({ agentDescription: desc, industry, jurisdictions: ["EU"] });
    res.json(result);
  } catch (err) {
    logger.error({ err }, "stay/eu-ai-act-report error");
    res.status(500).json({ error: err instanceof Error ? err.message : "eu-ai-act-report failed", contract: C2MD_CONTRACT });
  }
});

export default router;
