/**
 * Stay Agent phase (Crawl → Walk → Run) status + promotion.
 *   GET  /api/phase/:companyId            — phase + promotion readiness
 *   POST /api/phase/:companyId/promote     — promote with criteria enforcement
 *
 * Promotion criteria (surfaced + enforced):
 *   - HITL agreement rate > 85% over the last 30 decisions
 *   - override rate < 10%
 *   - no compliance-boundary violation in the last 7 days
 *   - manual MoD sign-off required for Crawl → Walk
 */
import { Router, type IRouter } from "express";
import { db, agentPhases, hitlTokens, witnessEntries } from "@workspace/db";
import { and, eq, desc, gte, sql } from "drizzle-orm";
import { issueMandate } from "../lib/mandateIssuer.js";
import { writeWitnessEntry } from "../lib/witnessWriter.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const AGENT_SLUG = "stay-agent";
const AGENT_NAME = "Stay Agent";
const AGREEMENT_MIN = 0.85;
const OVERRIDE_MAX = 0.10;
const NEXT: Record<string, string | null> = { not_activated: "crawl", crawl: "walk", walk: "run", run: null };

async function ensureStayPhase(companyId: number) {
  const [row] = await db
    .select()
    .from(agentPhases)
    .where(and(eq(agentPhases.companyId, companyId), eq(agentPhases.agentId, AGENT_SLUG)))
    .limit(1);
  if (row) return row;
  const [created] = await db
    .insert(agentPhases)
    .values({ companyId, agentId: AGENT_SLUG, phase: "crawl", activatedAt: new Date() })
    .returning();
  return created;
}

async function computeReadiness(companyId: number) {
  const rows = await db
    .select({ outcome: hitlTokens.outcome })
    .from(hitlTokens)
    .where(and(eq(hitlTokens.agentId, AGENT_SLUG), eq(hitlTokens.companyId, companyId), eq(hitlTokens.cardType, "operational_exception")))
    .orderBy(desc(hitlTokens.decidedAt))
    .limit(30);
  const resolved = rows.filter((r) => r.outcome === "approved" || r.outcome === "rejected");
  const sample = resolved.length;
  const approved = resolved.filter((r) => r.outcome === "approved").length;
  const agreement = sample > 0 ? approved / sample : 0;
  const override = sample > 0 ? (sample - approved) / sample : 0;

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const violations = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(witnessEntries)
    .where(
      and(
        eq(witnessEntries.companyId, companyId),
        eq(witnessEntries.agent, AGENT_NAME),
        gte(witnessEntries.createdAt, sevenDaysAgo),
        sql`(${witnessEntries.eventCategory} ILIKE '%compliance_boundary%' OR ${witnessEntries.eventCategory} = 'COMPLIANCE_BOUNDARY')`,
      ),
    );
  const complianceViolations7d = Number(violations[0]?.n ?? 0);

  const criteria = {
    agreement: agreement > AGREEMENT_MIN,
    override: override < OVERRIDE_MAX,
    no_compliance_violation: complianceViolations7d === 0,
    sample,
  };
  return { agreement, override, sample, complianceViolations7d, criteria };
}

// GET /api/phase/:companyId
router.get("/phase/:companyId", async (req, res) => {
  try {
    const companyId = Number(req.params.companyId);
    if (Number.isNaN(companyId)) {
      res.status(400).json({ error: "companyId must be a number" });
      return;
    }
    const row = await ensureStayPhase(companyId);
    const readiness = await computeReadiness(companyId);
    const nextTarget = NEXT[row.phase] ?? null;
    const requiresModSignoff = row.phase === "crawl";
    const criteriaMet = readiness.criteria.agreement && readiness.criteria.override && readiness.criteria.no_compliance_violation;
    res.json({
      company_id: companyId,
      agent_id: AGENT_SLUG,
      phase: row.phase,
      agreement_rate: readiness.agreement,
      override_rate: readiness.override,
      sample: readiness.sample,
      compliance_violations_7d: readiness.complianceViolations7d,
      criteria: readiness.criteria,
      thresholds: { agreement_min: AGREEMENT_MIN, override_max: OVERRIDE_MAX },
      next_target: nextTarget,
      requires_mod_signoff: requiresModSignoff,
      promotion_ready: Boolean(nextTarget) && criteriaMet,
    });
  } catch (err) {
    logger.error({ err }, "phase get error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load phase" });
  }
});

// POST /api/phase/:companyId/demo-set { phase }
//
// Sets the operating phase DIRECTLY, for a presenter driving the cockpit through
// Crawl → Walk → Run in a demo. It is deliberately NOT /promote and must never be
// confused with it:
//
//   /promote   earns a phase — enforces the agreement/override/violation criteria,
//              requires a named sign-off, and only ever moves forwards.
//   /demo-set  asserts a phase — claims no criteria, names no signatory, and moves in
//              either direction so a scenario can be replayed at a lower phase.
//
// A demo control that reused /promote would have to either bypass the criteria (making
// the gate a lie) or fail on a fresh tenant with no decision history (making the demo
// unrunnable). Keeping them apart lets the promotion gate stay honest AND the demo run.
//
// The distinction is carried into the evidence: this seals AGENT_LIFECYCLE with
// `promotion: false` and a reason of "demo setup", so a reader of the trail can see the
// phase was set rather than earned. It is never presented as a promotion.
router.post("/phase/:companyId/demo-set", async (req, res) => {
  try {
    const companyId = Number(req.params.companyId);
    const phase = String(req.body?.phase ?? "").trim();
    if (Number.isNaN(companyId)) {
      res.status(400).json({ error: "companyId must be a number" });
      return;
    }
    if (!["crawl", "walk", "run"].includes(phase)) {
      res.status(400).json({ error: "phase must be crawl | walk | run" });
      return;
    }
    const row = await ensureStayPhase(companyId);
    if (row.phase === phase) {
      res.json({ ok: true, company_id: companyId, phase, unchanged: true, promotion: false });
      return;
    }
    await db
      .update(agentPhases)
      .set({ phase, phaseChangedAt: new Date(), notes: `Demo setup: phase set ${row.phase}→${phase} (not a promotion; no criteria claimed)` })
      .where(and(eq(agentPhases.companyId, companyId), eq(agentPhases.agentId, AGENT_SLUG)));

    // Seal it. A phase change is what the agent is ALLOWED to do without asking — the
    // single most consequential fact about its operating envelope. It belongs in the
    // trail whether it was earned or asserted, and the record says which.
    let witnessId: number | null = null;
    try {
      witnessId = await writeWitnessEntry({
        companyId,
        agent: AGENT_NAME,
        decision: {
          decision: "INFO",
          clauseApplied: `Operating phase set to ${phase} as demo setup. Not a promotion: no promotion criteria were evaluated and no sign-off was recorded.`,
          actionProposed: `Set operating phase ${row.phase} → ${phase}`,
          exceptionApplied: false,
          escalationTarget: null,
          reasoning: `Presenter set the operating phase directly via /demo-set. The promotion gate (/promote) was not used and its criteria were neither met nor claimed.`,
        },
        fileReferenced: "stay-agent.AGENTS.md",
        apaleoData: { art17: { event: "PHASE_CHANGED", from_phase: row.phase, to_phase: phase, promotion: false, source: "demo_set" } },
        eventCategory: "AGENT_LIFECYCLE",
        suppressAutoHitl: true,
        skipC2pa: true,
      });
    } catch (wErr) {
      logger.warn({ wErr }, "[phase] demo-set witness write failed (non-blocking)");
    }

    logger.info({ companyId, from: row.phase, to: phase }, "[phase] Stay Agent phase set (demo)");
    res.json({ ok: true, company_id: companyId, from: row.phase, phase, promotion: false, witness_entry_id: witnessId });
  } catch (err) {
    logger.error({ err }, "phase demo-set error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to set phase" });
  }
});

// POST /api/phase/:companyId/promote { target, signed_by }
router.post("/phase/:companyId/promote", async (req, res) => {
  try {
    const companyId = Number(req.params.companyId);
    const target = String(req.body?.target ?? "");
    const signedBy = String(req.body?.signed_by ?? req.body?.signedBy ?? "").trim();
    if (Number.isNaN(companyId)) {
      res.status(400).json({ error: "companyId must be a number" });
      return;
    }
    if (!["walk", "run"].includes(target)) {
      res.status(400).json({ error: "target must be walk | run" });
      return;
    }

    const row = await ensureStayPhase(companyId);
    const expected = NEXT[row.phase];
    if (expected !== target) {
      res.status(409).json({ error: `Invalid transition ${row.phase} → ${target}. Next allowed: ${expected ?? "none"}.` });
      return;
    }

    // MoD sign-off is mandatory for Crawl → Walk.
    if (row.phase === "crawl" && !signedBy) {
      res.status(400).json({ error: "Crawl → Walk requires manual MoD sign-off (signed_by)." });
      return;
    }
    if (target === "run" && !signedBy) {
      res.status(400).json({ error: "Walk → Run requires a sign-off (signed_by)." });
      return;
    }

    const readiness = await computeReadiness(companyId);
    const failed: string[] = [];
    if (!readiness.criteria.agreement) failed.push(`agreement ${(readiness.agreement * 100).toFixed(0)}% ≤ ${(AGREEMENT_MIN * 100)}% (n=${readiness.sample})`);
    if (!readiness.criteria.override) failed.push(`override ${(readiness.override * 100).toFixed(0)}% ≥ ${(OVERRIDE_MAX * 100)}%`);
    if (!readiness.criteria.no_compliance_violation) failed.push(`${readiness.complianceViolations7d} compliance-boundary violation(s) in last 7 days`);
    if (failed.length > 0) {
      res.status(412).json({ error: "Promotion criteria not met", failed, readiness });
      return;
    }

    await db
      .update(agentPhases)
      .set({ phase: target, phaseChangedAt: new Date(), notes: `Promoted ${row.phase}→${target} by ${signedBy}` })
      .where(and(eq(agentPhases.companyId, companyId), eq(agentPhases.agentId, AGENT_SLUG)));

    // Best-effort: issue a fresh AP2 mandate for the new phase (non-blocking).
    let mandate: string | null = null;
    try {
      const issued = await issueMandate({ agentId: AGENT_SLUG, companyId, agentDid: `did:key:stay-agent-${companyId}`, phase: target });
      mandate = issued.mandateId;
    } catch (mErr) {
      logger.warn({ mErr }, "[phase] mandate issuance deferred (non-blocking)");
    }

    logger.info({ companyId, from: row.phase, to: target, signedBy }, "[phase] Stay Agent promoted");
    res.json({ ok: true, company_id: companyId, from: row.phase, to: target, signed_by: signedBy, mandate_id: mandate, readiness });
  } catch (err) {
    logger.error({ err }, "phase promote error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to promote" });
  }
});

export default router;
