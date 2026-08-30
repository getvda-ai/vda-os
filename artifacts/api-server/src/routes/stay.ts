/**
 * Stay Agent routes.
 *   POST /api/stay/decision  — run the governed check-in/in-stay/check-out engine.
 */
import { Router, type IRouter, type Request } from "express";
import { db, hitlTokens, agentPhases, witnessEntries, sealOutbox, companies } from "@workspace/db";
import { and, eq, desc, sql, inArray } from "drizzle-orm";
import { decideStay, type StayStage, type StayExceptionContext, type StayApaleoRef } from "../lib/stayDecisionEngine.js";
import { listStayBaselines, revokeStayBaseline, createStayBaseline } from "../lib/stayBaselines.js";
import { executeStayAction, assertExecutorAgreement } from "../lib/stayExecutor.js";
import { writeWitnessEntry } from "../lib/witnessWriter.js";
import { sealStayEvent, sealHitlDecisionEvent } from "../lib/staySeal.js";
import { drainSealOutbox, outboxHealth, collectGuestPii } from "../lib/sealOutbox.js";
import { anchorStatus, fetchRecords, fetchReport, witnessKeyHealth, resolveBinding } from "../lib/witnessClient.js";
import { generateEuAiActReport, assessAgentRisk, C2MD_CONTRACT } from "../lib/c2mdClient.js";
import { stayChainKey, STAY_CHAIN_GENERATION } from "../lib/witnessChain.js";
import { getRoleBandAuthority, getExceptionAuthority } from "../lib/exceptionAuthorityReader.js";
import { STAY_SCENARIOS, buildAuthorityChain, hasAutonomousBand, scenarioForClass } from "../lib/stayScopeMap.js";
import { classify } from "../lib/stayEventCategory.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const VALID_STAGES = new Set(["check_in", "in_stay", "check_out"]);
const AGENT_SLUG = "stay-agent";
const AGENT_NAME = "Stay Agent";
const NEXT_BAND: Record<string, string> = { ambassador: "mod", mod: "compliance_officer", compliance_officer: "compliance_officer" };

/**
 * The session-integrity boundary. Witness seals the ASSERTED actor and makes it tamper-
 * evident; authenticating that the asserted human is truly the one at the console is OUR
 * concern, not Witness's. Actor identity is sourced HERE — from authenticated session state
 * when present — and never trusted blindly from request input.
 *
 * NOTE: there is no session/auth layer in the Stay Agent yet (see migration report), so for
 * now provenance falls back to "asserted" and we seal the assertion faithfully. Wiring an
 * authenticated session so `provenance` is genuinely "authenticated" is the tracked follow-up.
 */
function resolveActor(req: Request): { id: string; provenance: "authenticated" | "asserted" } {
  const sess = (req as unknown as { session?: { actorId?: string } }).session?.actorId;
  const hdr = req.headers["x-authenticated-actor"];
  const authed = (typeof sess === "string" && sess.trim()) || (typeof hdr === "string" && hdr.trim()) || "";
  if (authed) return { id: authed, provenance: "authenticated" };
  const asserted = String(req.body?.decided_by ?? req.body?.decidedBy ?? "").trim();
  return { id: asserted || "unattributed", provenance: "asserted" };
}

/** Shape the flat apaleo snapshot into the {reservation,folio,room,task} sub-objects the
 *  seal's evidence entries are built from. Strips our own injected routing metadata so it
 *  never lands as "evidence". Returns only sub-objects that carry data. */
function shapeArtifacts(apaleoData: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const a = apaleoData ?? {};
  if (a.folio) out.folio = a.folio;
  else if (a.folioId) out.folio = { folioId: a.folioId, currency: a.currency };
  if (a.reservation) out.reservation = a.reservation;
  else if (a.reservationId || a.status || a.arrival) out.reservation = { reservationId: a.reservationId, status: a.status, arrival: a.arrival, departure: a.departure, tier: a.tier };
  if (a.room || a.roomStatus) out.room = a.room ?? { roomStatus: a.roomStatus };
  if (a.task || a.housekeeping) out.task = a.task ?? a.housekeeping;
  return out;
}

/**
 * Explicit three-state account binding for the tier badge — never a null-vs-expected
 * string compare. `unresolved` (not yet probed) is NEUTRAL, not a warning.
 */
function bindingState(k: { health: string; boundAccount: string | null; expected: string | null }): "resolved" | "unresolved" | "mismatch" {
  if (k.health === "account_mismatch" || (k.boundAccount && k.expected && k.boundAccount !== k.expected)) return "mismatch";
  if (!k.boundAccount) return "unresolved";
  return "resolved";
}

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
    // Actor from the session-integrity boundary — not raw UI input (see resolveActor).
    const actor = resolveActor(req);
    const decidedBy = actor.id === "unattributed" ? "Dashboard User" : actor.id;
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

    // The Apaleo authority boundary this card sits at, and the role that holds it.
    // SEALED into the record (art17) rather than derived at read time: a scope that is
    // only computed when the log is rendered is not evidence of what was gated — it is
    // today's opinion about a decision made months ago. Sealing it makes "which scope
    // was invoked, and by whose authority" answerable from the record alone.
    const cardClass = String(payload.exception_class ?? "");
    const cardScenario = scenarioForClass(cardClass);
    const cardAuthority = await getExceptionAuthority(AGENT_SLUG, companyId).catch(() => null);
    const cardChain = buildAuthorityChain(cardAuthority, cardClass);
    const decidingNode = cardChain.find((n) => n.band === (hitl.roleBand ?? "ambassador")) ?? null;

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
        apaleoData: {
          ...apaleoData,
          hitl_token: token,
          decided_by: decidedBy,
          role_band: eventRole,
          art17: {
            stage: payload.stage,
            exception_class: payload.exception_class,
            event: eventCategory,
            decided_by: decidedBy,
            role_band: eventRole,
            // The authority boundary, sealed with the decision (see above).
            apaleo_scope: cardScenario?.scope ?? null,
            apaleo_endpoint: cardScenario?.endpoint ?? null,
            apaleo_role: decidingNode?.apaleoRole ?? null,
            approver_title: decidingNode?.title ?? null,
            ...extra,
          },
        },
        eventCategory,
        suppressAutoHitl: true,
        skipC2pa: true, // evidence of record is the real VDA Witness seal
      });
      // Seal as a HUMAN decision via the shaped seal_hitl_decision skill. Evidence is the
      // apaleo artifacts the decider saw, content-addressed (hash + ref, no PII inline);
      // basis_captured_at is the recommendation time (when the artifacts were captured).
      await sealHitlDecisionEvent({
        companyId,
        localWitnessId: id,
        eventCategory,
        actorId: decidedBy,
        actorRole: eventRole,
        statement: `${eventCategory} by ${decidedBy}${reason ? `: ${reason}` : ""}`,
        clauseApplied: String(payload.clause_applied ?? clause),
        sopSlug: (payload.exception_class as string) ?? undefined,
        sopRefs: (payload.sop_refs as Array<{ anchor?: string; heading?: string; text?: string }>) ?? [],
        artifacts: shapeArtifacts(apaleoData),
        basisCapturedAt: (hitl.createdAt instanceof Date ? hitl.createdAt : new Date(hitl.createdAt as string)).toISOString(),
        propertyId: (apaleoData.propertyId as string) ?? null,
        piiDenylist: collectGuestPii({ ...apaleoData, ...payload }),
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
      // Name the band we escalated TO in the chain's own vocabulary, so the console can
      // re-head the card without re-deriving the ladder for itself.
      const toNode = cardChain.find((n) => n.band === toBand) ?? null;
      res.json({
        ok: true,
        action: "escalate",
        token,
        rerouted_token: rerouted?.token,
        from_band: fromBand,
        to_band: toBand,
        to_title: toNode?.title ?? null,
        to_apaleo_role: toNode?.apaleoRole ?? null,
        // Escalation reaches for no scope. Stated, so the intercept panel can show the
        // action still pending rather than silently keeping its last status.
        apaleo_scope: cardScenario?.scope ?? null,
        scope_invoked: false,
        witness_entry_id: witnessId,
      });
      return;
    }

    // ── DENY — block; no write. ──
    if (outcome === "deny") {
      await db.update(hitlTokens).set({ outcome: "rejected", decidedBy, decidedAt: new Date() }).where(eq(hitlTokens.token, token));
      const witnessId = await writeStayWitness("FAIL", "HITL_REJECTED", `Operational exception denied by ${decidedBy}.`);
      const rates = await updateStayRates(companyId);
      res.json({
        ok: true,
        action: "deny",
        token,
        // No Apaleo call was made. Reported as an explicit false rather than by omission —
        // the console renders "scope blocked", and an absent field would render nothing.
        apaleo_scope: cardScenario?.scope ?? null,
        apaleo_endpoint: cardScenario?.endpoint ?? null,
        scope_invoked: false,
        witness_entry_id: witnessId,
        rates,
      });
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
    res.json({
      ok: true,
      action: outcome,
      token,
      apaleo_execution: execution,
      apaleo_charge_id: execution.apaleoId ?? null,
      // Scope and endpoint come off the EXECUTION, not off the card — so a staged write
      // reports the scope it reached for and does not claim the call landed.
      apaleo_scope: execution.scope ?? null,
      apaleo_endpoint: execution.endpoint ?? null,
      scope_invoked: execution.status === "EXECUTED",
      baseline_id: baselineId,
      // What a baseline actually reinstates: the clause it is pinned to, and the bounds
      // inside which this class will now auto-PASS. Returned so the card can name the
      // rule instead of asserting that one exists.
      baseline_clause: outcome === "baseline" ? String(payload.clause_applied ?? "") || null : null,
      baseline_bounds: outcome === "baseline"
        ? { value_max: ceilingBand.requested_value ?? null, ceiling_type: ceilingBand.ceiling_type ?? null }
        : null,
      witness_entry_id: witnessId,
      rates,
    });
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
      // A human MoD governance decision → shaped seal_hitl_decision. No operational artifact
      // is consulted (it's a policy change, not a folio decision), so evidence is honestly
      // omitted with a stated reason rather than fabricated.
      await sealHitlDecisionEvent({
        companyId,
        localWitnessId: wid,
        eventCategory: "BASELINE_REVOKED",
        actorId: resolveActor(req).id === "unattributed" ? revokedBy : resolveActor(req).id,
        actorRole: "mod",
        statement: `Baseline ${id} unbaselined by ${revokedBy}: ${revokedReason}`,
        clauseApplied: "Baselines are always revocable and never hard-deleted; revoking returns the class to human review going forward while past authorised decisions stand.",
        sopSlug: "exception_authority",
        basisCapturedAt: new Date().toISOString(),
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
      // The Apaleo role holding the equivalent authority, verbatim from governance.
      // Absent at the front line by design: the Ambassador band corresponds to no
      // Apaleo admin role — see /api/stay/scenarios.
      apaleo_role: (e as { apaleo_role?: string | null }).apaleo_role ?? null,
      conditions: e.conditions ?? [],
    }));
    res.json({ companyId, role_band: roleBand, can_baseline: roleBand === "mod", exceptions, rejected_classes: band?.rejectedClasses ?? [] });
  } catch (err) {
    logger.error({ err }, "stay/authority error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load authority" });
  }
});

// ── GET /api/stay/scenarios?company_id= — the harness, one entry per authority config ──
// ONE call returns everything the cockpit needs to draw the scenario selector and every
// authority chain: the scope each class intercepts, and the escalation ladder WALKED
// FROM GOVERNANCE (escalate_to in EXCEPTION_AUTHORITY.md), not from a hardcoded list.
// Adding a band to the governance file lengthens the chain here with no code change.
//
// Serving it from one endpoint is deliberate: if the console assembled chains itself it
// would need its own copy of the ladder, and the copy would eventually disagree with the
// engine that actually routes the card.
router.get("/stay/scenarios", async (req, res) => {
  try {
    const companyId = Number(req.query.company_id ?? req.query.companyId ?? 0);
    const authority = await getExceptionAuthority(AGENT_SLUG, companyId);
    const scenarios = STAY_SCENARIOS.map((s) => {
      const chain = buildAuthorityChain(authority, s.exceptionClass);
      const autonomous = chain.find((n) => n.authority === "autonomous") ?? null;
      return {
        ...s,
        // The autonomous threshold, read from governance — never a UI constant.
        autonomous_ceiling: autonomous ? autonomous.ceiling : null,
        autonomous_ceiling_type: autonomous ? autonomous.ceilingType : null,
        never_autonomous: !hasAutonomousBand(authority, s.exceptionClass),
        chain,
        // A scenario whose class is missing from governance must say so rather than
        // render an empty chain that reads like "no approval needed".
        governed: chain.length > 0,
      };
    });
    // Prove the scope panel is telling the truth BEFORE the console draws it. If the
    // map and the executor disagree, the console suppresses the panel rather than naming
    // an Apaleo call the code would not make — a wrong integration claim in front of the
    // people who built the integration is the one failure worth degrading the UI for.
    let scopeMapVerified = true;
    let scopeMapError: string | null = null;
    try {
      assertExecutorAgreement();
    } catch (aErr) {
      scopeMapVerified = false;
      scopeMapError = aErr instanceof Error ? aErr.message : String(aErr);
      logger.error({ aErr }, "[stay] scope map disagrees with the executor");
    }
    res.json({
      companyId,
      count: scenarios.length,
      scenarios,
      scope_map_verified: scopeMapVerified,
      scope_map_error: scopeMapError,
      governance_loaded: Boolean(authority),
      // Stated once, here, rather than implied per-scenario: the front line holds no
      // Apaleo admin role. It acts under the integration's own OAuth client.
      front_line_note: "The Ambassador band maps to no Apaleo admin role — front-line actions run under the integration's OAuth client, not a named Apaleo user.",
    });
  } catch (err) {
    logger.error({ err }, "stay/scenarios error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load scenarios" });
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
        const cls = (art.exception_class as string) ?? null;
        const sc = scenarioForClass(cls);
        const decidedByName = (a.decided_by as string) ?? (art.decided_by as string) ?? AGENT_NAME;
        return {
          id: r.id,
          at: r.createdAt,
          decision: r.decision,
          event: r.eventCategory,
          // The four framework categories, DERIVED from the sealed `event` above — the
          // stored value is never rewritten. See lib/stayEventCategory.ts for why.
          // `humanDecided` separates an autonomous `charge_posted` from a human-approved
          // one — the same sealed event name covers both. See stayEventCategory.ts.
          event_category: classify(r.eventCategory, { humanDecided: Boolean(decidedByName && decidedByName !== AGENT_NAME) }),
          // Which Apaleo authority boundary this row sits at, and whether the scope was
          // actually reached. `apaleo_charge_id` present = the write landed.
          apaleo_scope: (art.apaleo_scope as string) ?? sc?.scope ?? null,
          apaleo_endpoint: (art.apaleo_endpoint as string) ?? sc?.endpoint ?? null,
          scenario_key: sc?.key ?? null,
          approver_role: (art.apaleo_role as string) ?? null,
          kind: isGovernance ? "governance" : "decision",
          exception_class: cls,
          stage: (art.stage as string) ?? null,
          clause: r.clauseApplied,
          reasoning: r.reasoning,
          decided_by: decidedByName,
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
    await resolveBinding().catch(() => {}); // populate boundAccount without waiting for a seal
    const key = witnessKeyHealth();
    res.json({ ok: true, outbox: await outboxHealth(companyId), key, red: key.red, accountBinding: bindingState(key) });
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
    // Scope to the CUSTOMER-FACING chain (v2). The retired chain is never surfaced.
    const chainKey = await chainKeyForCompany(companyId, req.query.chain_key as string | undefined);

    // Live anchor status for THIS chain — Witness's own external verification (Rekor +
    // DigiCert/Sectigo TSA quorum). We consume Witness's NEW state vocabulary
    // (sealedState / tierLabel / anchored); `tier`/`compliance` are deprecated aliases
    // we no longer read. We do NOT offline-verify /records summaries here (they omit
    // the full proof); the Verify button does that on the full sealed record.
    let anchor: Record<string, unknown> = {};
    try { anchor = await anchorStatus(chainKey); } catch { anchor = {}; }
    const headAnchored = Boolean(anchor.headAnchored);
    const externalValid = Boolean(anchor.externalValid);
    const anchoredThroughSeq = (anchor.anchoredThroughSeq as number | null) ?? null;
    const pendingRecords = (anchor.pendingRecords as number | null) ?? null;
    const witnessSealedState = (anchor.sealedState as string | undefined) ?? undefined;
    const sealedStateReason = (anchor.sealedStateReason as string | undefined) ?? undefined;
    const tierLabel = (anchor.tierLabel as string | undefined) ?? undefined;

    // How much of THIS chain is anchored vs still SIGNED_PENDING (honest anchor lag).
    let recordCount = 0, maxSeq = -1, anchoredRecords = 0;
    try {
      const rc = await fetchRecords(chainKey);
      const recs = (rc.records ?? []) as Array<{ seq?: number }>;
      recordCount = recs.length;
      for (const r of recs) { const s = Number(r.seq); if (Number.isFinite(s)) { if (s > maxSeq) maxSeq = s; if (anchoredThroughSeq != null && s <= anchoredThroughSeq) anchoredRecords++; } }
    } catch { /* read advisory */ }

    // Badge is driven by Witness's sealedState. Defensive honesty: only surface
    // "anchored" when Witness says so AND the head genuinely reads anchored+externally
    // valid — never claim anchored/audit-ready off a tier label alone.
    let sealedState: "anchored" | "anchoring_pending" | "not_anchored";
    if (witnessSealedState === "anchored" && headAnchored && externalValid) sealedState = "anchored";
    else if (witnessSealedState === "not_anchored") sealedState = "not_anchored";
    else sealedState = witnessSealedState === "anchored" ? "anchoring_pending" : (witnessSealedState as typeof sealedState) ?? "anchoring_pending";
    const pendingAnchor = pendingRecords ?? Math.max(0, recordCount - anchoredRecords);

    // The pinned/bound Witness account + key health — resolved eagerly so a cold
    // instance reports the real bound account, not null.
    await resolveBinding().catch(() => {});
    const key = witnessKeyHealth();
    // Account binding is a THREE-state, never a null-vs-expected string compare.
    const accountBinding = bindingState(key);

    res.json({ ok: true, chainKey, sealed: true, sealedState, sealedStateReason, tierLabel, observed: { headAnchored, externalValid, anchoredThroughSeq, pendingRecords, recordCount, anchoredRecords, maxSeq, pendingAnchor }, accountBinding, account: key.boundAccount, expectedAccount: key.expected, keyHealth: key.health, keyRed: key.red });
  } catch (err) {
    logger.error({ err }, "stay/anchor-status error");
    res.status(500).json({ error: err instanceof Error ? err.message : "anchor-status failed" });
  }
});

// ── POST /api/stay/verify — REAL offline verification (SDK), three-state. ─────
// Signature + hash-chain + anchor (Rekor + TSA) checked from our own stored bundle against
// the pinned did:web key. Zero calls to witness.getvda.ai. The verdict is returned VERBATIM.
//
// All of the policy — chain assembly, the missing-input vs real-tamper distinction, and the
// anchor rules — lives in ONE place (lib/verifyRecord.ts) so this route, the persisted-verdict
// repair, and anything added later can never drift into disagreeing about the same record.
router.post("/stay/verify", async (req, res) => {
  try {
    const record = req.body?.record ?? (req.body?.sealed_record as Record<string, unknown> | undefined);
    if (!record) { res.status(400).json({ error: "record required" }); return; }
    const { verifyRecordAgainstChain } = await import("../lib/verifyRecord.js");

    const companyId = Number(req.body?.company_id ?? req.body?.companyId ?? 0);
    const chainKey = (req.body?.chain_key as string | undefined) ?? (await chainKeyForCompany(companyId));
    const out = await verifyRecordAgainstChain(record as Record<string, unknown>, chainKey, {
      chain: Array.isArray(req.body?.chain) ? (req.body.chain as Record<string, unknown>[]) : undefined,
      anchor: (req.body?.anchor ?? null) as Record<string, unknown> | null,
    });

    res.json({ ok: true, verdict: out.verdict, chain: out.chain, anchor: out.anchor });
  } catch (err) {
    logger.error({ err }, "stay/verify error");
    res.status(500).json({ error: err instanceof Error ? err.message : "verify failed" });
  }
});

// ── POST /api/stay/chain/backfill — mirror a chain locally so verify is zero-call. ──
// We hold every record we seal, but never the chain's seq-0 CHAIN_OPENED record (the
// Witness operator opens the chain, not us), so continuity could not be established from
// local evidence alone and /stay/verify fell back to fetching the chain from Witness.
// Mirroring the missing records makes the offline verify literally zero-call again.
// The chain is verified from genesis BEFORE anything is stored — see backfillChain().
// Idempotent: records already held are reported, not rewritten.
router.post("/stay/chain/backfill", async (req, res) => {
  try {
    const { backfillChain, assembleChain } = await import("../lib/witnessChainProof.js");
    // Explicit chain_key(s), else every chain we have actually sealed to (from the seal refs).
    let chainKeys: string[] = [];
    if (Array.isArray(req.body?.chain_keys)) chainKeys = req.body.chain_keys as string[];
    else if (req.body?.chain_key) chainKeys = [String(req.body.chain_key)];
    else if (req.body?.company_id != null) chainKeys = [await chainKeyForCompany(Number(req.body.company_id))];
    else {
      const rows = await db.select().from(witnessEntries);
      chainKeys = [...new Set(rows.map((r) => (r.witnessSealRef as Record<string, unknown> | null)?.chainKey).filter((k): k is string => typeof k === "string"))];
    }

    const results = [];
    for (const chainKey of chainKeys) {
      const filled = await backfillChain(chainKey);
      const after = await assembleChain(chainKey); // did it actually achieve zero-call?
      results.push({ ...filled, nowVerifiesFrom: after.source, zeroCall: after.complete && after.source === "local-db" });
    }
    res.json({ ok: true, chains: results });
  } catch (err) {
    logger.error({ err }, "stay/chain/backfill error");
    res.status(500).json({ error: err instanceof Error ? err.message : "backfill failed" });
  }
});

// ── POST /api/stay/trail/correct — append a correction to the evidence trail. ──
// Records sealed before the parse fix carry governingRule.ruleText = "Unable to parse agent
// response" under ruleId stay-agent.SOP.md — so the trail ASSERTS the SOP contained that text.
// It never did. That is a fabricated clause in permanent, anchored evidence.
//
// An append-only trail is corrected by APPENDING, never by rewriting or by retiring the chain
// and starting a clean one — a chain quietly abandoned the moment it embarrasses its author is
// exactly what evidence laundering looks like, and the anchored records would remain anyway.
// So we publish a correction record that names the defective records, states the defect and its
// root cause, and leaves the originals standing. An auditor reading the chain sees both the
// error and the correction, which is the point.
//
// Idempotent: if a correction covering the same records is already on the chain, it is not
// re-appended.
const FABRICATED_CLAUSE = "Unable to parse agent response";
router.post("/stay/trail/correct", async (req, res) => {
  try {
    const dryRun = Boolean(req.body?.dry_run);
    const rows = (await db.select().from(witnessEntries)).filter((r) => r.witnessSealRef);

    // Find the defective records + any correction already published, per chain.
    const defects = new Map<string, Array<{ recordId: string; seq: number; companyId: number }>>();
    const corrected = new Set<string>();
    for (const row of rows) {
      const ref = row.witnessSealRef as Record<string, unknown>;
      const rec = ref.record as Record<string, unknown> | undefined;
      const chainKey = ref.chainKey as string | undefined;
      if (!rec || !chainKey) continue;
      const rule = (rec.governingRule ?? {}) as { ruleText?: string };
      const decision = (rec.decision ?? {}) as { verdict?: string; inputs?: { corrects_records?: unknown[] } };
      const verdict = decision.verdict;
      if (verdict === "TRAIL_CORRECTION") {
        // A correction only counts as published if it actually NAMES the records it corrects in
        // machine-readable form. The first one we appended lost that payload to input
        // minimisation (its allowlist dropped the fields), leaving prose an auditor can read but
        // a tool cannot act on. Treat it as incomplete and supersede it — by appending, of course.
        if (Array.isArray(decision.inputs?.corrects_records) && decision.inputs.corrects_records.length) corrected.add(chainKey);
        continue;
      }
      if (typeof rule.ruleText === "string" && rule.ruleText.trim() === FABRICATED_CLAUSE) {
        const list = defects.get(chainKey) ?? [];
        list.push({ recordId: String(rec.recordId ?? ""), seq: Number(rec.seq), companyId: row.companyId });
        defects.set(chainKey, list);
      }
    }

    // A RETIRED chain (the pre-v2 generation) must never be written to again — that invariant is
    // what makes its retirement meaningful, and breaking it to tidy up our own mistake would be
    // self-serving. Its defective records are instead named in the correction published on the
    // CURRENT chain for the same property, which is the live evidence surface an auditor reads.
    const isCurrent = (k: string) => k.endsWith(`:${STAY_CHAIN_GENERATION}`);
    const scopeOf = (k: string) => (k.includes(":") ? k.split(":")[0] : k);
    const foreign = new Map<string, Array<{ chainKey: string; recordId: string; seq: number }>>();
    for (const [chainKey, records] of [...defects]) {
      if (isCurrent(chainKey)) continue;
      const target = `${scopeOf(chainKey)}:${STAY_CHAIN_GENERATION}`;
      const list = foreign.get(target) ?? [];
      for (const r of records) list.push({ chainKey, recordId: r.recordId, seq: r.seq });
      foreign.set(target, list);
      defects.delete(chainKey); // never appended to; carried on the current chain instead
      if (!defects.has(target)) defects.set(target, []); // ensure the correction still gets published
    }

    const results = [];
    for (const [chainKey, records] of defects) {
      records.sort((a, b) => a.seq - b.seq);
      const alsoOnRetired = foreign.get(chainKey) ?? [];
      if (corrected.has(chainKey)) { results.push({ chainKey, affected: records.map((r) => r.seq), appended: false, reason: "a correction is already published on this chain" }); continue; }
      if (dryRun) { results.push({ chainKey, affected: records.map((r) => r.seq), alsoCorrectsRetired: alsoOnRetired.map((r) => `${r.chainKey}#${r.seq}`), appended: false, reason: "dry run" }); continue; }

      const companyId = records[0]?.companyId ?? Number(req.body?.company_id ?? 1);
      const propertyId = chainKey.includes(":") ? chainKey.split(":")[0] : null;
      const seqs = records.map((r) => r.seq);

      const here = seqs.length ? `Records ${seqs.map((s) => `seq ${s}`).join(", ")} on this chain` : "Records on a retired chain for this property";
      const alsoText = alsoOnRetired.length
        ? ` This correction also covers ${alsoOnRetired.map((r) => `${r.chainKey} seq ${r.seq}`).join(", ")} — a RETIRED chain, which is append-only and closed, so its correction is published here on the current chain rather than by writing to it.`
        : "";

      const reasoning =
        `Correction. ${here} were sealed with governingRule.ruleText = "${FABRICATED_CLAUSE}" attributed to stay-agent.SOP.md. The SOP has never contained that text. It was an agent fault — the decision model's JSON answer was truncated and could not be parsed — written into the governing-rule field, so the trail wrongly asserted the SOP said it.${alsoText} ` +
        `Root cause: the decision call allowed 2048 max_tokens, but the model bills its internal reasoning against that budget (it spent ~1962), leaving the answer truncated mid-string on every request. Those decisions escalated to a human, so no ungoverned action was taken. ` +
        `Fixed: the token budget was raised and truncation is now retried and detected explicitly; an agent fault is now recorded as a typed agent_error and can no longer be written into the governing-rule field. ` +
        `The original records are left standing and unaltered — this chain is append-only and correcting it by rewriting would destroy the very property that makes it evidence.` +
        ` If an earlier TRAIL_CORRECTION appears on this chain, this record supersedes it: that one carried this narrative but lost its machine-readable list of corrected records to input minimisation, so it is restated here in full. It too is left standing rather than removed.`;

      const localId = await writeWitnessEntry({
        companyId,
        agent: "Stay Agent",
        decision: {
          decision: "TRAIL_CORRECTION",
          clauseApplied: "stay-agent.SOP.md#correction — a defect in sealed evidence is corrected by appending, never by rewriting.",
          reasoning,
          actionProposed: "No operational action. This record corrects the evidence trail only.",
        } as never,
        fileReferenced: "stay-agent.SOP.md",
        apaleoData: {},
        eventCategory: "TRAIL_CORRECTION",
      });

      await sealStayEvent({
        companyId,
        localWitnessId: localId,
        verdict: "TRAIL_CORRECTION",
        reasoning,
        actionProposed: "No operational action — corrects the evidence trail only.",
        inputs: {
          corrects_records: [
            ...records.map((r) => ({ chainKey, recordId: r.recordId, seq: r.seq })),
            ...alsoOnRetired.map((r) => ({ chainKey: r.chainKey, recordId: r.recordId, seq: r.seq, note: "retired chain — closed to writes; corrected from here" })),
          ],
          defect: `governingRule.ruleText was set to "${FABRICATED_CLAUSE}" — an agent fault recorded as if it were the text of the governing SOP clause`,
          root_cause: "decision-model answer truncated (thinking tokens billed against max_tokens=2048); the parse failure was written into the clause field",
          operational_impact: "none — every affected decision ESCALATED to a human; no autonomous action was taken on a failed parse",
          remedy: "token budget raised + truncation retried/detected; agent faults now carried as a typed agent_error and never as a governing rule",
        },
        ruleId: "stay-agent.SOP.md#correction",
        ruleText:
          "Evidence correction: a defect in an append-only trail is corrected by appending a correction record that names the defective records and the defect. The originals are never rewritten, deleted, or hidden, and the chain is never retired to bury them.",
        propertyId,
      });

      results.push({ chainKey, affected: seqs, alsoCorrectsRetired: alsoOnRetired.map((r) => `${r.chainKey}#${r.seq}`), appended: true, correctsRecordIds: records.map((r) => r.recordId) });
    }

    if (!defects.size) { res.json({ ok: true, chains: [], detail: "no records carrying the fabricated clause were found — nothing to correct" }); return; }
    res.json({ ok: true, dryRun, chains: results });
  } catch (err) {
    logger.error({ err }, "stay/trail/correct error");
    res.status(500).json({ error: err instanceof Error ? err.message : "trail correction failed" });
  }
});

// ── POST /api/stay/reverify — repair persisted verdicts. ──────────────────────
// Records sealed before the chain-aware verify carry witness_state = "BROKEN", written by a
// seal-time check that verified each record against a chain containing only itself —
// unsatisfiable for any seq >= 1. Those rows render "✗ verification failed" over evidence that
// is intact and externally anchored. Re-verify each sealed record through the SAME policy the
// live Verify button uses (lib/verifyRecord.ts) and persist the honest verdict — now including
// ANCHORED_VALID where the Rekor + TSA quorum verifies. Idempotent, and it corrects in BOTH
// directions: a genuinely broken record is still written BROKEN.
router.post("/stay/reverify", async (req, res) => {
  try {
    const { verifyRecordAgainstChain } = await import("../lib/verifyRecord.js");

    const rows = (await db.select().from(witnessEntries)).filter((r) => r.witnessSealRef);
    const changed: Array<{ id: number; seq: unknown; from: string | null; to: string }> = [];
    const sources = new Map<string, string>();
    let unchanged = 0, skipped = 0;

    for (const row of rows) {
      const ref = row.witnessSealRef as Record<string, unknown>;
      const record = ref.record as Record<string, unknown> | undefined;
      const chainKey = ref.chainKey as string | undefined;
      if (!record?.proof || !chainKey) { skipped++; continue; } // nothing verifiable held

      const out = await verifyRecordAgainstChain(record, chainKey);
      sources.set(chainKey, `${out.chain.source}${out.anchor.supplied ? " +anchor" : ""}`);

      if (out.persistState === row.witnessState) { unchanged++; continue; }
      await db.update(witnessEntries).set({ witnessState: out.persistState }).where(eq(witnessEntries.id, row.id));
      changed.push({ id: row.id, seq: record.seq, from: row.witnessState, to: out.persistState });
    }

    res.json({ ok: true, changed: changed.length, unchanged, skipped, chains: [...sources.entries()].map(([chainKey, source]) => ({ chainKey, source })), updates: changed });
  } catch (err) {
    logger.error({ err }, "stay/reverify error");
    res.status(500).json({ error: err instanceof Error ? err.message : "reverify failed" });
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
    // view=full — the SIGNED bodies with proof + prevHash + signer. The default summary
    // view carries none of that (no decision, no governingRule, no proof), so it rendered
    // every verdict as "—" and the `record` handed to offline Verify could not verify at
    // all. A summary is a display projection; only the full view is evidence.
    const raw = await fetchRecords(chainKey, "full");
    const records = (raw.records ?? raw.data ?? raw.entries ?? []) as Array<Record<string, unknown>>;
    // Per-record Sealed/Anchored state comes from the chain's anchoredThroughSeq
    // (Witness's external verification): seq ≤ anchoredThroughSeq → anchored, else the
    // record is sealed and awaiting the anchor tick (SIGNED_PENDING — correct, transient).
    let anchoredThroughSeq: number | null = null;
    try { const a = await anchorStatus(chainKey); anchoredThroughSeq = (a.anchoredThroughSeq as number | null) ?? null; } catch { /* advisory */ }
    // Join our own sealed rows onto the Witness records by recordId, so each entry can
    // carry the framework category, the Apaleo scope it gated, and who approved it.
    //
    // These are attached as OUR fields on OUR envelope — the `record` below is still the
    // Witness record byte-for-byte, because that is the thing that verifies. Enriching
    // the signed record itself would break its signature and, worse, would mean shipping
    // an "evidence" object that says more than what was actually signed.
    const localRows = await db
      .select({ ec: witnessEntries.eventCategory, ref: witnessEntries.witnessSealRef, ad: witnessEntries.apaleoData })
      .from(witnessEntries)
      .where(and(eq(witnessEntries.companyId, companyId), eq(witnessEntries.agent, AGENT_NAME)))
      .orderBy(desc(witnessEntries.createdAt))
      .limit(400);
    const localByRecordId = new Map<string, { ec: string | null; art: Record<string, unknown>; by: string | null }>();
    for (const lr of localRows) {
      const rid = (lr.ref as { recordId?: string } | null)?.recordId;
      if (!rid) continue;
      const a = (lr.ad ?? {}) as Record<string, unknown>;
      localByRecordId.set(rid, { ec: lr.ec, art: (a.art17 ?? {}) as Record<string, unknown>, by: (a.decided_by as string) ?? null });
    }

    const items = records.map((r) => {
      const seq = Number(r.seq);
      const anchored = anchoredThroughSeq != null && Number.isFinite(seq) && seq <= anchoredThroughSeq;
      const rid = (r.recordId ?? r.id) as string;
      const local = localByRecordId.get(rid) ?? null;
      return {
        recordId: rid,
        seq: r.seq,
        issuedAt: r.issuedAt,
        verdict: (r.decision as { verdict?: string })?.verdict ?? null,
        agent: (r.decision as { agent?: string })?.agent ?? null,
        ruleId: (r.governingRule as { ruleId?: string })?.ruleId ?? null,
        anchored,
        sealedState: anchored ? "anchored" : "anchoring_pending", // sealed always; anchoring is what varies
        // Locally-derived classification. Null when this record was not sealed by this
        // deployment — stated as null rather than guessed, so a gap reads as a gap.
        event: local?.ec ?? null,
        event_category: local ? classify(local.ec, { humanDecided: Boolean(local.by && local.by !== AGENT_NAME) }) : null,
        apaleo_scope: (local?.art.apaleo_scope as string) ?? null,
        approver_role: (local?.art.apaleo_role as string) ?? null,
        record: r, // full record for offline Verify — Witness's bytes, unmodified
      };
    });
    res.json({
      ok: true,
      chainKey,
      account: raw.account ?? null,
      count: items.length,
      anchoredThroughSeq,
      records: items,
      isolation: "account derived from key; no accountId sent",
      event_category_note:
        "event_category, apaleo_scope and approver_role are derived by this deployment from its own sealed rows and joined by recordId. They are NOT part of the Witness record and are not covered by its signature; `record` is Witness's bytes verbatim.",
    });
  } catch (err) {
    logger.error({ err }, "stay/records error");
    res.status(500).json({ error: err instanceof Error ? err.message : "records failed" });
  }
});

// ── POST /api/stay/report — EU AI Act Article-12 evidence report (from Witness) ─
// Generated by VDA Witness from the sealed trail (empty body — account from key).
// Rendered VERBATIM by the UI: reportType, lifecycle, entries, integrity, scope,
// disclaimer. NB: Witness has not yet renamed `lifecycle`, so it may still emit
// "DEMO_DATA" even for a genuinely Anchored account — we render it verbatim anyway
// (never remap/suppress) and report the observed string for the coordinated rename.
router.post("/stay/report", async (req, res) => {
  try {
    // Scope to the CUSTOMER-FACING chain (v2) by default so the retired/dev chains
    // never appear in customer evidence. Account derives from the key — no accountId.
    const companyId = Number(req.body?.company_id ?? req.body?.companyId ?? 0);
    const chainKey = await chainKeyForCompany(companyId, req.body?.chain_key);
    const raw = await fetchReport(chainKey);
    res.json({ ok: true, chainKey, report: raw.report ?? raw });
  } catch (err) {
    logger.error({ err }, "stay/report error");
    res.status(500).json({ error: err instanceof Error ? err.message : "report failed" });
  }
});

// ── POST /api/stay/eu-ai-act-report — EU AI Act Article-by-Article via C2MD ─────
// C2MD owns the Article logic; the Stay Agent orchestrates. ATTESTED mode: we hand C2MD our
// own Witness chain-proof bundle, which it verifies offline (did:web + Rekor/TSA, zero calls
// to Witness). The report is evidence-backed against our REAL trail and the Witness key never
// leaves this process — attested rejects a key outright. No synthetic demo substitute: if the
// report cannot be produced, the reason is returned verbatim and nothing is shown in its place.
router.post("/stay/eu-ai-act-report", async (req, res) => {
  try {
    const companyId = Number(req.body?.company_id ?? req.body?.companyId ?? 0);
    const chainKey = await chainKeyForCompany(companyId, req.body?.chain_key as string | undefined);
    const result = await generateEuAiActReport({
      chainKey,
      jurisdictions: ["EU"],
      dataCategories: ["financial_data"], // payment references; strict C2MD enum
      autonomyLevel: "assistive",
    });
    res.json(result);
  } catch (err) {
    logger.error({ err }, "stay/eu-ai-act-report error");
    res.status(500).json({ error: err instanceof Error ? err.message : "eu-ai-act-report failed", contract: C2MD_CONTRACT });
  }
});

// ── POST /api/stay/eu-ai-act-assessment — C2MD tier-1 risk assessment. ─────────
// skill assess_agent_risk: diagnostic risk classification (Annex III, provider/deployer role,
// DPIA/FRIA/conformity, control map across NIST + ISO 42001). Authenticated with the Witness
// suite key via the Authorization header (see c2mdClient). Works today on a SEALED key.
//
// SLOW BY DESIGN: the assessment is an LLM generation that runs ~55s (plus ~10s cold-start).
// The route must be allowed to wait — see the maxDuration config in build-vercel.mjs — and the
// console shows a long-running state rather than assuming failure.
router.post("/stay/eu-ai-act-assessment", async (req, res) => {
  try {
    const companyId = Number(req.body?.company_id ?? req.body?.companyId ?? 0);
    let industry = "Hospitality";
    try {
      const [c] = await db.select({ ind: companies.industry }).from(companies).where(eq(companies.id, companyId)).limit(1);
      if (c?.ind) industry = c.ind;
    } catch { /* default */ }

    const result = await assessAgentRisk({
      agentDescription:
        "citizenM Stay Agent — an AI agent that manages a hotel guest's on-property journey (check-in, in-stay, check-out). It makes governed exception decisions (late check-out, incidental folio charges) under human-in-the-loop oversight (Ambassador and Manager-on-Duty approval bands), reads and writes reservation and folio data via Apaleo, and seals every decision into a tamper-evident VDA Witness hash-chain. Deployed for hotels in the EU (Germany), the UK, and other jurisdictions. Handles guest personal data including names, contact details, payment references, and stay history.",
      jurisdictions: ["EU", "DE", "GB"],
      dataCategories: ["financial_data"], // payment references; ordinary PII has no enum member
      autonomyLevel: "assistive",          // proposes; a human approves within authority bands
      industry,
    });
    res.json(result);
  } catch (err) {
    logger.error({ err }, "stay/eu-ai-act-assessment error");
    res.status(500).json({ error: err instanceof Error ? err.message : "eu-ai-act-assessment failed", contract: C2MD_CONTRACT });
  }
});

export default router;
