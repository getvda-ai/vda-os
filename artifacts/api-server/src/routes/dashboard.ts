/**
 * Dashboard API — role-based views and phase management.
 *
 * GET  /api/dashboard/phases?companyId=
 * GET  /api/dashboard/shift-summary?companyId=
 * GET  /api/dashboard/chain-health
 * POST /api/dashboard/shadow-review
 * POST /api/dashboard/phases/reset   (dev only — NODE_ENV !== 'production')
 */
import { Router, type Request, type Response } from "express";
import { db, agentPhases, witnessEntries, governanceFiles, hitlTokens, agentValueEvents, agentMandates } from "@workspace/db";
import { eq, and, gte, lte, sql, isNull, not, inArray, desc, lt, sum } from "drizzle-orm";
import { writeGovernanceEvent } from "../lib/writeGovernanceEvent.js";
import { logger } from "../lib/logger.js";
import { getOnboardingPolicy } from "../lib/exceptionAuthorityReader.js";
import { issueMandate } from "../lib/mandateIssuer.js";

const router = Router();

// Live DB company IDs: BER=1, LND=2, MUC=3, PAR=4, VIE=5
const COMPANIES = [1, 2, 3, 4, 5];

// ─── GET /api/dashboard/phases ────────────────────────────────────────────────

router.get("/dashboard/phases", async (req, res) => {
  try {
    const companyId = Number(req.query.companyId);
    if (!companyId || isNaN(companyId)) {
      res.status(400).json({ error: "companyId required" });
      return;
    }

    const phasesPolicy = await getOnboardingPolicy();
    const frontLineBands = phasesPolicy.front_line_bands;
    const crossPropertyBands = phasesPolicy.cross_property_bands;

    const phases = await db
      .select()
      .from(agentPhases)
      .where(eq(agentPhases.companyId, companyId));

    // Compute potential_autonomous_decisions per agent_id (last 30 days, decision=PASS).
    // Normalize agent names to slug format to match agentPhases.agent_id — witness entries
    // may be written with either slugs ("availability-agent") or display names ("Availability Agent").
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const passRows = await db
      .select({
        agent: witnessEntries.agent,
        count: sql<string>`count(*)`,
      })
      .from(witnessEntries)
      .where(
        and(
          eq(witnessEntries.companyId, companyId),
          eq(witnessEntries.decision, "PASS"),
          gte(witnessEntries.createdAt, thirtyDaysAgo),
        ),
      )
      .groupBy(witnessEntries.agent);

    // Normalize agent name → slug for matching (handles both "Rate Agent" and "rate-agent")
    function toSlug(name: string): string {
      return name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    }

    const passByAgent: Record<string, number> = {};
    for (const r of passRows) {
      const slug = toSlug(r.agent);
      passByAgent[slug] = (passByAgent[slug] ?? 0) + Number(r.count);
    }

    function synthesiseRoleBandPhases(overallPhase: string, stored: unknown) {
      const defaultPhase = ["crawl", "walk", "run"].includes(overallPhase) ? overallPhase : "crawl";
      // Build the canonical 6-key default object
      const defaults: Record<string, { phase: string; agreementRate: null; overrideRate: null }> = {};
      for (const band of frontLineBands) {
        defaults[band] = { phase: defaultPhase, agreementRate: null, overrideRate: null };
      }
      for (const band of crossPropertyBands) {
        defaults[band] = { phase: "not_applicable", agreementRate: null, overrideRate: null };
      }
      // Deep-merge stored bands over defaults — each band entry is merged field-by-field
      // so partial stored objects (e.g. { phase: "crawl" } missing agreementRate) still return all keys.
      if (stored && typeof stored === "object" && !Array.isArray(stored)) {
        const storedBands = stored as Record<string, Record<string, unknown>>;
        const result = { ...defaults } as Record<string, { phase: string; agreementRate: unknown; overrideRate: unknown }>;
        for (const band of Object.keys(result)) {
          if (storedBands[band] && typeof storedBands[band] === "object") {
            result[band] = { ...result[band], ...storedBands[band] };
          }
        }
        return result;
      }
      return defaults;
    }

    const enriched = phases.map((p) => ({
      ...p,
      agreementRate: p.agreementRate !== null ? Number(p.agreementRate) : null,
      overrideRate: p.overrideRate !== null ? Number(p.overrideRate) : null,
      potential_autonomous_decisions: passByAgent[toSlug(p.agentId)] ?? 0,
      roleBandPhases: synthesiseRoleBandPhases(p.phase, p.roleBandPhases),
    }));

    res.json({ phases: enriched });
  } catch (err) {
    logger.error({ err }, "dashboard/phases error");
    res.status(500).json({ error: "Failed to load phases" });
  }
});

// ─── GET /api/dashboard/phases/portfolio ──────────────────────────────────────
// Returns per-hotel phase summary across all 5 citizenM properties.
// Used by the Wizard Step 8 (Portfolio Rollout) to count hotels at walk/run phase.

router.get("/dashboard/phases/portfolio", async (req, res) => {
  try {
    const rows = await db
      .select({ companyId: agentPhases.companyId, phase: agentPhases.phase })
      .from(agentPhases)
      .where(inArray(agentPhases.companyId, COMPANIES));

    // Summarise per-hotel: has at least one agent at walk or run phase
    const summary: Record<number, { walkRunCount: number; totalAgents: number }> = {};
    for (const cid of COMPANIES) {
      summary[cid] = { walkRunCount: 0, totalAgents: 0 };
    }
    for (const row of rows) {
      if (!summary[row.companyId]) continue;
      summary[row.companyId].totalAgents += 1;
      if (row.phase === "walk" || row.phase === "run") {
        summary[row.companyId].walkRunCount += 1;
      }
    }

    // Count hotels with at least one walk/run agent
    const hotelsAtWalkRun = Object.values(summary).filter(s => s.walkRunCount > 0).length;

    res.json({ summary, hotelsAtWalkRun, totalHotels: COMPANIES.length });
  } catch (err) {
    logger.error({ err }, "dashboard/phases/portfolio error");
    res.status(500).json({ error: "Failed to load portfolio phase summary" });
  }
});

// ─── GET /api/dashboard/shift-summary ─────────────────────────────────────────

router.get("/dashboard/shift-summary", async (req, res) => {
  try {
    const companyId = Number(req.query.companyId);
    if (!companyId || isNaN(companyId)) {
      res.status(400).json({ error: "companyId required" });
      return;
    }

    const eightHoursAgo = new Date(Date.now() - 8 * 60 * 60 * 1000);

    const entries = await db
      .select()
      .from(witnessEntries)
      .where(
        and(
          eq(witnessEntries.companyId, companyId),
          gte(witnessEntries.createdAt, eightHoursAgo),
        ),
      )
      .orderBy(desc(witnessEntries.createdAt));

    // Crawl-phase agents for this company — shadow review only applies to crawl.
    // Normalize to slug so both "Check-in Agent" and "check-in-agent" match correctly.
    function toSlugLocal(name: string): string {
      return name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    }

    const crawlRows = await db
      .select({ agentId: agentPhases.agentId })
      .from(agentPhases)
      .where(
        and(
          eq(agentPhases.companyId, companyId),
          eq(agentPhases.phase, "crawl"),
        ),
      );
    // Build slug-keyed set so matches work regardless of agent name format in witness entries
    const crawlAgents = new Set(crawlRows.map((r) => toSlugLocal(r.agentId)));

    let autonomous_count = 0;
    let escalated_count = 0;
    let shadow_count = 0;
    const raw_shadow: typeof entries = [];
    const raw_autonomous: typeof entries = [];
    const raw_escalated: typeof entries = [];

    for (const e of entries) {
      const ap = e.apaleoData as Record<string, unknown> | null;
      // Check shadow_decision FIRST — shadow entries may carry any decision value (PASS/FAIL/INFO).
      // Must not be consumed by the autonomous/escalated branch before the event_type is inspected.
      if (ap?.event_type === "shadow_decision" && crawlAgents.has(toSlugLocal(e.agent))) {
        shadow_count++;
        raw_shadow.push(e);
      } else if (e.decision === "PASS" && !e.escalationTarget) {
        autonomous_count++;
        raw_autonomous.push(e);
      } else if (e.decision === "ESCALATE") {
        escalated_count++;
        raw_escalated.push(e);
      }
    }

    // Anti-join: unreviewed = no COMPLIANCE_BOUNDARY/INFO entry with matching reviewed_decision_witness_id
    const shadowIds = raw_shadow.map((e) => String(e.id));
    let reviewedIds = new Set<string>();

    if (shadowIds.length > 0) {
      const reviewedEntries = await db
        .select({ apaleoData: witnessEntries.apaleoData })
        .from(witnessEntries)
        .where(
          and(
            eq(witnessEntries.companyId, companyId),
            eq(witnessEntries.eventCategory, "COMPLIANCE_BOUNDARY"),
            eq(witnessEntries.decision, "INFO"),
          ),
        );

      for (const re of reviewedEntries) {
        const ap = re.apaleoData as Record<string, unknown> | null;
        // Any COMPLIANCE_BOUNDARY/INFO entry with a reviewed_decision_witness_id counts as a review
        if (ap?.reviewed_decision_witness_id) {
          reviewedIds.add(String(ap.reviewed_decision_witness_id));
        }
      }
    }

    const shadow_reviews = raw_shadow
      .filter((e) => !reviewedIds.has(String(e.id)))
      .map((e) => ({
        witnessId: e.id,
        companyId: e.companyId,   // required by shadow-review POST endpoint
        agent: e.agent,
        agentId: e.agent,
        decision: e.decision,
        clauseApplied: e.clauseApplied,
        actionProposed: e.actionProposed,
        reasoning: e.reasoning,
        apaleoData: { ...(e.apaleoData as Record<string, unknown> ?? {}), companyId: e.companyId },
        createdAt: e.createdAt,
      }));

    const autonomous_entries = raw_autonomous.map((e) => ({
      witnessId: e.id,
      agent: e.agent,
      decision: e.decision,
      clauseApplied: e.clauseApplied,
      actionProposed: e.actionProposed,
      fileReferenced: e.fileReferenced,
      reasoning: e.reasoning,
      createdAt: e.createdAt,
    }));

    const escalated_entries = raw_escalated.map((e) => ({
      witnessId: e.id,
      agent: e.agent,
      decision: e.decision,
      clauseApplied: e.clauseApplied,
      actionProposed: e.actionProposed,
      escalationTarget: e.escalationTarget,
      fileReferenced: e.fileReferenced,
      reasoning: e.reasoning,
      createdAt: e.createdAt,
    }));

    res.json({
      autonomous_count,
      escalated_count,
      shadow_count,
      shadow_reviews,
      autonomous_entries,
      escalated_entries,
    });
  } catch (err) {
    logger.error({ err }, "dashboard/shift-summary error");
    res.status(500).json({ error: "Failed to load shift summary" });
  }
});

// ─── GET /api/dashboard/chain-health ──────────────────────────────────────────

router.get("/dashboard/chain-health", async (_req, res) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // Count agents by phase across all companies
    const phaseRows = await db.select().from(agentPhases).where(
      inArray(agentPhases.companyId, COMPANIES),
    );

    // Cumulative counts: a RUN agent also counts towards WALK+ and CRAWL+,
    // matching the staircase visual that highlights all phases reached up to current.
    let run = 0, walk = 0, crawl = 0;
    for (const p of phaseRows) {
      if (p.phase === "run")                                        run++;
      if (p.phase === "run" || p.phase === "walk")                  walk++;
      if (p.phase === "run" || p.phase === "walk" || p.phase === "crawl") crawl++;
    }

    // Guard violations today (COMPLIANCE_BOUNDARY/FAIL)
    const guardRows = await db
      .select({ count: sql<string>`count(*)` })
      .from(witnessEntries)
      .where(
        and(
          eq(witnessEntries.eventCategory, "COMPLIANCE_BOUNDARY"),
          eq(witnessEntries.decision, "FAIL"),
          gte(witnessEntries.createdAt, todayStart),
          inArray(witnessEntries.companyId, COMPANIES),
        ),
      );
    const guard_violations_today = Number(guardRows[0]?.count ?? 0);

    // Exceptions expiring soon (within 30 days, not already expired)
    // expiresAt is stored as text in ISO 8601 format — cast to date for comparison
    const todayIso = new Date().toISOString().split("T")[0];
    const thirtyDaysIso = thirtyDaysFromNow.toISOString().split("T")[0];
    const expiryRows = await db
      .select({ count: sql<string>`count(*)` })
      .from(governanceFiles)
      .where(
        and(
          eq(governanceFiles.fileType, "EXCEPTION"),
          eq(governanceFiles.isArchived, false),
          not(isNull(governanceFiles.expiresAt)),
          inArray(governanceFiles.companyId, COMPANIES),
          sql`${governanceFiles.expiresAt} >= ${todayIso}`,
          sql`${governanceFiles.expiresAt} <= ${thirtyDaysIso}`,
        ),
      );
    const exceptions_expiring_soon = Number(expiryRows[0]?.count ?? 0);

    // Last integrity check
    const integrityRows = await db
      .select({
        decision: witnessEntries.decision,
        createdAt: witnessEntries.createdAt,
        apaleoData: witnessEntries.apaleoData,
      })
      .from(witnessEntries)
      .where(
        and(
          eq(witnessEntries.eventCategory, "FRAMEWORK_INTEGRITY"),
          inArray(witnessEntries.companyId, COMPANIES),
        ),
      )
      .orderBy(desc(witnessEntries.createdAt))
      .limit(1);

    const last_integrity_check = integrityRows[0]
      ? {
          timestamp: integrityRows[0].createdAt,
          result: integrityRows[0].decision,
          detail: integrityRows[0].apaleoData,
        }
      : null;

    res.json({
      properties_live: COMPANIES.length,
      agents_by_phase: { run, walk, crawl },
      guard_violations_today,
      exceptions_expiring_soon,
      last_integrity_check,
    });
  } catch (err) {
    logger.error({ err }, "dashboard/chain-health error");
    res.status(500).json({ error: "Failed to load chain health" });
  }
});

// ─── POST /api/dashboard/shadow-review ───────────────────────────────────────

router.post("/dashboard/shadow-review", async (req, res) => {
  try {
    const { witnessId, agentId, companyId, agreed } = req.body as {
      witnessId: number | string;
      agentId: string;
      companyId: number;
      agreed: boolean;
    };

    if (!witnessId || !agentId || !companyId || agreed === undefined) {
      res.status(400).json({ error: "Missing required fields: witnessId, agentId, companyId, agreed" });
      return;
    }

    await writeGovernanceEvent({
      companyId: Number(companyId),
      agent: agentId,
      eventCategory: "COMPLIANCE_BOUNDARY",
      decision: "INFO",
      clauseApplied: agreed
        ? "Senior Ambassador agreed with agent shadow decision"
        : "Senior Ambassador disagreed with agent shadow decision — human override recorded",
      actionProposed: agreed
        ? "Shadow review: agreed"
        : "Shadow review: disagreed — review for training",
      reasoning: `Shadow review response recorded. Agreed: ${agreed}`,
      fileReferenced: "VDA-MD Shadow Review Protocol",
      apaleoData: {
        event_type: "shadow_review_response",
        agreed,
        agent_id: agentId,
        reviewed_decision_witness_id: String(witnessId),
      },
    });

    res.json({ ok: true, witnessId, agentId, agreed });
  } catch (err) {
    logger.error({ err }, "dashboard/shadow-review error");
    res.status(500).json({ error: "Failed to record shadow review" });
  }
});

// ─── POST /api/dashboard/phases/promote ──────────────────────────────────────

router.post("/dashboard/phases/promote", async (req, res) => {
  try {
    const {
      companyId,
      agentId,
      targetPhase,
      promotedBy = "Dashboard User",
    } = req.body as {
      companyId: number;
      agentId: string;
      targetPhase: "walk" | "run";
      promotedBy?: string;
    };

    if (!companyId || !agentId || !targetPhase) {
      res.status(400).json({ error: "companyId, agentId, targetPhase required" });
      return;
    }
    if (!["walk", "run"].includes(targetPhase)) {
      res.status(400).json({ error: "targetPhase must be 'walk' or 'run'" });
      return;
    }

    const rows = await db
      .select()
      .from(agentPhases)
      .where(and(eq(agentPhases.companyId, companyId), eq(agentPhases.agentId, agentId)))
      .limit(1);

    const current = rows[0];
    if (!current) {
      res.status(404).json({ error: `No phase row found for agent '${agentId}' in company ${companyId}` });
      return;
    }

    const promotePolicy = await getOnboardingPolicy();
    if (promotePolicy.valid_transitions[current.phase] !== targetPhase) {
      res.status(409).json({
        error: `Invalid transition: ${current.phase} → ${targetPhase}. Only crawl→walk and walk→run are permitted.`,
        currentPhase: current.phase,
      });
      return;
    }

    // Server-side governance gate: block promotion when unresolved operational exception
    // tokens exist for this agent+company. UI enforces this too, but API callers must
    // not be able to bypass it with a direct request.
    const unresolvedExceptions = await db
      .select({ token: hitlTokens.token })
      .from(hitlTokens)
      .where(
        and(
          eq(hitlTokens.cardType, "operational_exception"),
          eq(hitlTokens.agentId, agentId),
          eq(hitlTokens.companyId, companyId),
          isNull(hitlTokens.outcome),
        )
      )
      .limit(1);

    if (unresolvedExceptions.length > 0) {
      res.status(409).json({
        error: `Cannot promote '${agentId}': ${unresolvedExceptions.length} unresolved operational exception(s) must be reviewed first`,
        blocked_by: "unresolved_operational_exceptions",
        currentPhase: current.phase,
      });
      return;
    }

    await db
      .update(agentPhases)
      .set({ phase: targetPhase, phaseChangedAt: new Date() })
      .where(and(eq(agentPhases.companyId, companyId), eq(agentPhases.agentId, agentId)));

    await writeGovernanceEvent({
      companyId,
      agent: agentId,
      eventCategory: "AGENT_LIFECYCLE",
      decision: "PASS",
      clauseApplied: `VDA-MD Crawl/Walk/Run §${targetPhase}: Agent phase promoted by authorised reviewer`,
      actionProposed: `Agent promoted from ${current.phase} to ${targetPhase} by ${promotedBy}`,
      reasoning: `Phase promotion approved: ${agentId} is ready for ${targetPhase}-phase autonomous operation`,
      fileReferenced: "VDA-MD Phase Management Protocol",
      apaleoData: {
        event_type: "agent_phase_promoted",
        agent_id: agentId,
        from_phase: current.phase,
        to_phase: targetPhase,
        promoted_by: promotedBy,
      },
    });

    logger.info({ companyId, agentId, from: current.phase, to: targetPhase, promotedBy }, "Agent phase promoted");

    // Issue a new AP2 Intent Mandate with the promoted phase's authorization tiers
    let mandateId: string | null = null;
    try {
      const agentDid = `did:key:vda-${agentId}-${companyId}`;
      const mandate = await issueMandate({ agentId, companyId, agentDid, phase: targetPhase });
      mandateId = mandate.mandateId;
      logger.info({ mandateId, agentId, companyId, phase: targetPhase }, "[Mandate] Mandate re-issued after phase promotion");
    } catch (mandateErr) {
      logger.warn({ mandateErr, agentId, companyId, targetPhase }, "[Mandate] Failed to re-issue mandate after phase promotion — non-fatal");
    }

    res.json({ ok: true, agentId, companyId, from: current.phase, to: targetPhase, promotedBy, mandateId });
  } catch (err) {
    logger.error({ err }, "dashboard/phases/promote error");
    res.status(500).json({ error: "Failed to promote agent phase" });
  }
});

// ─── POST /api/dashboard/phases/promote-band ─────────────────────────────────

router.post("/dashboard/phases/promote-band", async (req, res) => {
  try {
    const {
      companyId,
      agentId,
      roleBand,
      targetPhase,
      promotedBy = "Dashboard User",
    } = req.body as {
      companyId: number;
      agentId: string;
      roleBand: string;
      targetPhase?: "walk" | "run";
      promotedBy?: string;
    };

    const VALID_BANDS = ["ambassador", "senior_ambassador", "hotel_gm", "regional_gm", "operations_chief", "compliance_officer"];
    if (!companyId || !agentId || !roleBand) {
      res.status(400).json({ error: "companyId, agentId, roleBand required" });
      return;
    }
    if (!VALID_BANDS.includes(roleBand)) {
      res.status(400).json({ error: `roleBand must be one of: ${VALID_BANDS.join(", ")}` });
      return;
    }
    if (targetPhase && !["walk", "run"].includes(targetPhase)) {
      res.status(400).json({ error: "targetPhase must be 'walk' or 'run'" });
      return;
    }

    const rows = await db
      .select()
      .from(agentPhases)
      .where(and(eq(agentPhases.companyId, companyId), eq(agentPhases.agentId, agentId)))
      .limit(1);

    const current = rows[0];
    if (!current) {
      res.status(404).json({ error: `No phase row found for agent '${agentId}' in company ${companyId}` });
      return;
    }

    // Build current roleBandPhases (or initialise from scratch)
    const bandPolicy = await getOnboardingPolicy();
    const frontLineBandsBp = bandPolicy.front_line_bands;
    const crossPropertyBandsBp = bandPolicy.cross_property_bands;
    const overallPhase = ["crawl", "walk", "run"].includes(current.phase) ? current.phase : "crawl";

    let bandPhases: Record<string, { phase: string; agreementRate: number | null; overrideRate: number | null }>;
    if (current.roleBandPhases && typeof current.roleBandPhases === "object") {
      bandPhases = current.roleBandPhases as typeof bandPhases;
    } else {
      bandPhases = {};
      for (const band of frontLineBandsBp) {
        bandPhases[band] = { phase: overallPhase, agreementRate: null, overrideRate: null };
      }
      for (const band of crossPropertyBandsBp) {
        bandPhases[band] = { phase: "not_applicable", agreementRate: null, overrideRate: null };
      }
    }

    const currentBandPhase = bandPhases[roleBand]?.phase ?? "crawl";
    // If targetPhase not supplied, infer it from the current band state.
    const resolvedTargetPhase: string = targetPhase ?? bandPolicy.valid_transitions[currentBandPhase];
    if (!resolvedTargetPhase || bandPolicy.valid_transitions[currentBandPhase] !== resolvedTargetPhase) {
      res.status(409).json({
        error: `Invalid band transition: ${currentBandPhase} → ${resolvedTargetPhase ?? "?"} for band '${roleBand}'`,
        currentBandPhase,
        roleBand,
      });
      return;
    }

    // Governance gate: block if ANY unresolved HITL tokens for this agent+band+company.
    // For compliance_officer band: also check null-company tokens (global CO approval cards).
    // For all other bands: strict company_id scope only — null-company tokens do not affect them.
    const complianceBand = roleBand === "compliance_officer";
    const unresolvedCheck = await db.execute(
      complianceBand
        ? sql`SELECT token, card_type FROM hitl_tokens
              WHERE agent_id = ${agentId}
                AND (company_id = ${companyId} OR company_id IS NULL)
                AND role_band = ${roleBand}
                AND outcome IS NULL
              LIMIT 5`
        : sql`SELECT token, card_type FROM hitl_tokens
              WHERE agent_id = ${agentId}
                AND company_id = ${companyId}
                AND role_band = ${roleBand}
                AND outcome IS NULL
              LIMIT 5`
    );
    if (unresolvedCheck.rows.length > 0) {
      const cardTypes = [...new Set((unresolvedCheck.rows as { card_type: string }[]).map(r => r.card_type))];
      res.status(409).json({
        error: `Cannot promote '${agentId}' band '${roleBand}': ${unresolvedCheck.rows.length} unresolved HITL token(s) must be reviewed first`,
        blocked_by: "unresolved_hitl_tokens",
        card_types: cardTypes,
        currentBandPhase,
        roleBand,
      });
      return;
    }

    // Write updated band phase
    bandPhases[roleBand] = { ...bandPhases[roleBand], phase: resolvedTargetPhase };

    await db
      .update(agentPhases)
      .set({ roleBandPhases: bandPhases, phaseChangedAt: new Date() })
      .where(and(eq(agentPhases.companyId, companyId), eq(agentPhases.agentId, agentId)));

    await writeGovernanceEvent({
      companyId,
      agent: agentId,
      eventCategory: "AGENT_LIFECYCLE",
      decision: "PASS",
      clauseApplied: `VDA-MD Crawl/Walk/Run §${resolvedTargetPhase}: Role-band phase promoted by authorised reviewer`,
      actionProposed: `${roleBand} band promoted from ${currentBandPhase} to ${resolvedTargetPhase} by ${promotedBy}`,
      reasoning: `Band phase promotion: ${agentId} role_band=${roleBand} is ready for ${resolvedTargetPhase}-phase autonomous operation`,
      fileReferenced: "VDA-MD Phase Management Protocol",
      apaleoData: {
        event_type: "agent_band_phase_promoted",
        agent_id: agentId,
        role_band: roleBand,
        from_phase: currentBandPhase,
        to_phase: resolvedTargetPhase,
        promoted_by: promotedBy,
      },
    });

    logger.info({ companyId, agentId, roleBand, from: currentBandPhase, to: resolvedTargetPhase, promotedBy }, "Agent band phase promoted");
    res.json({ ok: true, agentId, companyId, roleBand, from: currentBandPhase, to: resolvedTargetPhase, promotedBy });
  } catch (err) {
    logger.error({ err }, "dashboard/phases/promote-band error");
    res.status(500).json({ error: "Failed to promote agent band phase" });
  }
});

// ─── POST /api/dashboard/phases/reset (DEV ONLY) ─────────────────────────────

if (process.env.NODE_ENV !== "production") {
  router.post("/dashboard/phases/reset", async (req, res) => {
    try {
      await db.delete(agentPhases);
      res.json({ ok: true, message: "agent_phases cleared (dev only)" });
    } catch (err) {
      logger.error({ err }, "dashboard/phases/reset error");
      res.status(500).json({ error: "Reset failed" });
    }
  });
}

// ─── GET /api/dashboard/value-ledger ─────────────────────────────────────────
// Returns per-agent ROI summary: total revenue delta, total governance cost, net value.

router.get("/dashboard/value-ledger", async (req, res) => {
  try {
    const companyId = Number(req.query.companyId);
    if (!companyId) return res.status(400).json({ error: "companyId required" });

    const sinceParam = req.query.since as string | undefined;
    const since = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 30 * 24 * 3600 * 1000);

    const conditions = [
      eq(agentValueEvents.companyId, companyId),
      gte(agentValueEvents.createdAt, since),
    ];

    // Per-agent aggregation
    const rows = await db
      .select({
        agentId: agentValueEvents.agentId,
        totalEvents: sql<number>`COUNT(*)::int`,
        passEvents: sql<number>`SUM(CASE WHEN decision_outcome = 'PASS' THEN 1 ELSE 0 END)::int`,
        totalRevenue: sql<string>`COALESCE(SUM(CASE WHEN decision_outcome = 'PASS' THEN revenue_delta::numeric ELSE 0 END), 0)::text`,
        totalCostCents: sql<number>`COALESCE(SUM(cost_cents), 0)::int`,
        currency: agentValueEvents.currency,
      })
      .from(agentValueEvents)
      .where(and(...conditions))
      .groupBy(agentValueEvents.agentId, agentValueEvents.currency)
      .orderBy(sql`SUM(CASE WHEN decision_outcome = 'PASS' THEN revenue_delta::numeric ELSE 0 END) DESC`);

    // Platform totals
    const [totals] = await db
      .select({
        totalRevenue: sql<string>`COALESCE(SUM(CASE WHEN decision_outcome = 'PASS' THEN revenue_delta::numeric ELSE 0 END), 0)::text`,
        totalCostCents: sql<number>`COALESCE(SUM(cost_cents), 0)::int`,
        totalEvents: sql<number>`COUNT(*)::int`,
        passEvents: sql<number>`SUM(CASE WHEN decision_outcome = 'PASS' THEN 1 ELSE 0 END)::int`,
      })
      .from(agentValueEvents)
      .where(and(...conditions));

    const totalRevenue = parseFloat(totals?.totalRevenue ?? "0");
    const totalCostEur = (totals?.totalCostCents ?? 0) / 100;

    return res.json({
      companyId,
      since: since.toISOString(),
      totals: {
        totalRevenue,
        totalCostEur,
        netValue: totalRevenue - totalCostEur,
        roiMultiple: totalCostEur > 0 ? +(totalRevenue / totalCostEur).toFixed(1) : null,
        totalEvents: totals?.totalEvents ?? 0,
        passEvents: totals?.passEvents ?? 0,
      },
      agents: rows.map(r => ({
        agentId: r.agentId,
        totalEvents: r.totalEvents,
        passEvents: r.passEvents,
        totalRevenue: parseFloat(r.totalRevenue),
        totalCostEur: r.totalCostCents / 100,
        netValue: parseFloat(r.totalRevenue) - r.totalCostCents / 100,
        currency: r.currency ?? "EUR",
      })),
    });
  } catch (err) {
    logger.error({ err }, "dashboard/value-ledger error");
    return res.status(500).json({ error: "Failed to fetch value ledger" });
  }
});

// ─── GET /api/dashboard/value-ledger/events ───────────────────────────────────
// Returns raw value event log for audit/drill-down.

router.get("/dashboard/value-ledger/events", async (req, res) => {
  try {
    const companyId = Number(req.query.companyId);
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    const limit = Math.min(Number(req.query.limit ?? 100), 500);
    const agentFilter = req.query.agentId as string | undefined;

    const conditions = [eq(agentValueEvents.companyId, companyId)];
    if (agentFilter) conditions.push(eq(agentValueEvents.agentId, agentFilter));

    const events = await db
      .select()
      .from(agentValueEvents)
      .where(and(...conditions))
      .orderBy(desc(agentValueEvents.createdAt))
      .limit(limit);

    return res.json({ events });
  } catch (err) {
    logger.error({ err }, "dashboard/value-ledger/events error");
    return res.status(500).json({ error: "Failed to fetch events" });
  }
});

// ─── GET /api/mandates ────────────────────────────────────────────────────────
// Returns active mandates for a company.
// Also aliased at /api/dashboard/mandates for backwards compatibility.

async function handleGetMandates(req: Request, res: Response) {
  try {
    const companyId = Number(req.query.companyId);
    if (!companyId) return res.status(400).json({ error: "companyId required" });

    const mandates = await db
      .select()
      .from(agentMandates)
      .where(eq(agentMandates.companyId, companyId))
      .orderBy(desc(agentMandates.issuedAt));

    return res.json({
      mandates: mandates.map(m => ({
        ...m,
        expired: new Date(m.validUntil) < new Date(),
        authorizations: m.authorizations,
      })),
    });
  } catch (err) {
    logger.error({ err }, "mandates error");
    return res.status(500).json({ error: "Failed to fetch mandates" });
  }
}

router.get("/mandates", handleGetMandates);
router.get("/dashboard/mandates", handleGetMandates);

export default router;
