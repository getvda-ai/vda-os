/**
 * Dashboard API — role-based views and phase management.
 *
 * GET  /api/dashboard/phases?companyId=
 * GET  /api/dashboard/shift-summary?companyId=
 * GET  /api/dashboard/chain-health
 * POST /api/dashboard/shadow-review
 * POST /api/dashboard/phases/reset   (dev only — NODE_ENV !== 'production')
 */
import { Router } from "express";
import { db, agentPhases, witnessEntries, governanceFiles } from "@workspace/db";
import { eq, and, gte, lte, sql, isNull, not, inArray, desc, lt } from "drizzle-orm";
import { writeGovernanceEvent } from "../lib/writeGovernanceEvent.js";
import { logger } from "../lib/logger.js";

const router = Router();

const COMPANIES = [3, 4, 5, 6, 7];

// ─── GET /api/dashboard/phases ────────────────────────────────────────────────

router.get("/dashboard/phases", async (req, res) => {
  try {
    const companyId = Number(req.query.companyId);
    if (!companyId || isNaN(companyId)) {
      res.status(400).json({ error: "companyId required" });
      return;
    }

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

    const enriched = phases.map((p) => ({
      ...p,
      agreementRate: p.agreementRate !== null ? Number(p.agreementRate) : null,
      overrideRate: p.overrideRate !== null ? Number(p.overrideRate) : null,
      potential_autonomous_decisions: passByAgent[toSlug(p.agentId)] ?? 0,
    }));

    res.json({ phases: enriched });
  } catch (err) {
    logger.error({ err }, "dashboard/phases error");
    res.status(500).json({ error: "Failed to load phases" });
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

    for (const e of entries) {
      if (e.decision === "PASS" && !e.escalationTarget) autonomous_count++;
      else if (e.decision === "ESCALATE") escalated_count++;
      else {
        const ap = e.apaleoData as Record<string, unknown> | null;
        // Shadow review: event_type key only — no decision value restriction,
        // since shadow decisions may carry any decision value (PASS/FAIL/INFO).
        if (ap?.event_type === "shadow_decision" && crawlAgents.has(toSlugLocal(e.agent))) {
          shadow_count++;
          raw_shadow.push(e);
        }
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

    res.json({
      autonomous_count,
      escalated_count,
      shadow_count,
      shadow_reviews,
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

    let run = 0, walk = 0, crawl = 0;
    for (const p of phaseRows) {
      if (p.phase === "run") run++;
      else if (p.phase === "walk") walk++;
      else if (p.phase === "crawl") crawl++;
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

export default router;
