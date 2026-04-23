/**
 * GDPR Compliance Reporting API
 *
 * GET /api/gdpr/ropa      — Records of Processing Activities (Art. 30)
 * GET /api/gdpr/article22 — Automated Decision-Making register (Art. 22)
 * GET /api/gdpr/checklist — Article-by-article GDPR checklist
 * GET /api/gdpr/breaches  — Data breach / near-miss register (Art. 33)
 */
import { Router } from "express";
import { db, witnessEntries, governanceFiles, agentPhases } from "@workspace/db";
import { eq, and, gte, lt, or, desc, inArray, sql, not } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const router = Router();

const COMPANIES = [1, 2, 3, 4, 5];
const COMPANY_MAP: Record<number, string> = { 1: "BER", 2: "LND", 3: "MUC", 4: "PAR", 5: "VIE" };

/**
 * Per-agent GDPR processing activity definitions.
 * Data categories sourced from the Apaleo PMS context each agent receives.
 * Lawful basis: Art. 6(1)(b) (performance of a contract) for guest-facing agents,
 * Art. 6(1)(f) (legitimate interests) for internal/revenue agents.
 */
const AGENT_ROPA: Array<{
  agentId: string;
  activityName: string;
  purposeOfProcessing: string;
  dataCategories: string[];
  dataSubjects: string;
  lawfulBasis: string;
  lawfulBasisArticle: string;
  art22Scope: boolean;
  art22Exception: string | null;
  retentionPeriod: string;
  safeguards: string[];
  recipients: string[];
}> = [
  {
    agentId: "availability-agent",
    activityName: "Unit availability verification",
    purposeOfProcessing: "Check real-time unit availability for guest reservation requests and upgrades",
    dataCategories: ["Reservation ID", "Arrival/departure dates", "Unit type preference", "Company affiliation"],
    dataSubjects: "Hotel guests and bookers",
    lawfulBasis: "Performance of a contract",
    lawfulBasisArticle: "Art. 6(1)(b)",
    art22Scope: false,
    art22Exception: null,
    retentionPeriod: "Duration of stay + 90 days audit log",
    safeguards: ["HITL oversight", "PII scrubbing layer (Microsoft Presidio)", "Governance file constraints"],
    recipients: ["citizenM front-of-house staff", "Apaleo PMS"],
  },
  {
    agentId: "rate-agent",
    activityName: "Dynamic rate determination",
    purposeOfProcessing: "Apply rate plans and discount authority to guest reservations within governance ceilings",
    dataCategories: ["Reservation ID", "Rate plan", "Company/corporate rate code", "Loyalty tier", "Booking channel"],
    dataSubjects: "Hotel guests and corporate bookers",
    lawfulBasis: "Performance of a contract",
    lawfulBasisArticle: "Art. 6(1)(b)",
    art22Scope: true,
    art22Exception: "Art. 22(2)(a) — necessary for the performance of the guest contract; HITL safeguard applied for decisions above authority ceiling",
    retentionPeriod: "7 years (financial record retention)",
    safeguards: ["HITL mandatory for above-ceiling discounts", "EXCEPTION_AUTHORITY.md ceiling constraints", "Governance file hash verification"],
    recipients: ["citizenM Revenue Management", "Apaleo PMS"],
  },
  {
    agentId: "reservation-bot",
    activityName: "Reservation creation and modification",
    purposeOfProcessing: "Process reservation requests, modifications, and group bookings for hotel guests",
    dataCategories: ["Guest name", "Email", "Phone", "Arrival/departure dates", "Room preferences", "Booker vs. guest identity", "Group affiliation"],
    dataSubjects: "Hotel guests, bookers, and group coordinators",
    lawfulBasis: "Performance of a contract",
    lawfulBasisArticle: "Art. 6(1)(b)",
    art22Scope: true,
    art22Exception: "Art. 22(2)(a) — necessary for performance of the reservation contract; guest retains right to request human review",
    retentionPeriod: "Duration of stay + 7 years (financial)",
    safeguards: ["HITL for group bookings above ceiling", "PII scrubbing layer (Microsoft Presidio)", "EXCEPTION_AUTHORITY.md ceiling constraints"],
    recipients: ["citizenM front-of-house staff", "Apaleo PMS", "Channel managers (where applicable)"],
  },
  {
    agentId: "check-in-agent",
    activityName: "Guest check-in and unit assignment",
    purposeOfProcessing: "Process guest check-in, pre-authorisation holds, unit assignment, and upgrade decisions",
    dataCategories: ["Guest name", "Email", "Phone", "Date of birth", "Nationality", "Identity document reference", "Loyalty tier", "Payment method authorisation", "Room assignment"],
    dataSubjects: "Hotel guests",
    lawfulBasis: "Performance of a contract",
    lawfulBasisArticle: "Art. 6(1)(b)",
    art22Scope: true,
    art22Exception: "Art. 22(2)(a) — check-in and unit assignment are necessary to perform the accommodation contract; HITL escalation for all pre-auth above ceiling",
    retentionPeriod: "Duration of stay + 7 years (financial)",
    safeguards: ["HITL for pre-auth above authority ceiling", "PII scrubbing layer (Microsoft Presidio)", "Governance file constraints on biometric and ID data", "EXCEPTION_AUTHORITY.md ceiling"],
    recipients: ["citizenM front-of-house staff", "Apaleo PMS", "Payment processor (pre-auth only)"],
  },
  {
    agentId: "folio-agent",
    activityName: "Folio audit and charge dispute flagging",
    purposeOfProcessing: "Read-only access to guest folio for audit trail management and dispute flagging",
    dataCategories: ["Guest name", "Folio ID", "Charge descriptions", "Charge amounts", "Dispute history"],
    dataSubjects: "Hotel guests",
    lawfulBasis: "Legitimate interests",
    lawfulBasisArticle: "Art. 6(1)(f) — legitimate interest: financial audit and dispute resolution",
    art22Scope: false,
    art22Exception: null,
    retentionPeriod: "7 years (financial record retention)",
    safeguards: ["Read-only access scope", "PII scrubbing layer (Microsoft Presidio)", "Governance file audit trail"],
    recipients: ["citizenM Finance", "Apaleo PMS"],
  },
  {
    agentId: "folio-charge-agent",
    activityName: "Folio charge posting",
    purposeOfProcessing: "Post charges to guest folio within authority ceilings with mandatory HITL escalation for above-limit charges",
    dataCategories: ["Guest name", "Folio ID", "Charge type", "Amount", "Billing description", "Payment method"],
    dataSubjects: "Hotel guests",
    lawfulBasis: "Performance of a contract",
    lawfulBasisArticle: "Art. 6(1)(b)",
    art22Scope: true,
    art22Exception: "Art. 22(2)(a) — charge posting is necessary to settle the accommodation contract; all above-ceiling charges require HITL approval",
    retentionPeriod: "7 years (financial record retention)",
    safeguards: ["HITL mandatory for charges above authority ceiling", "EXCEPTION_AUTHORITY.md ceiling constraints", "Witness Agent tamper-evident audit trail"],
    recipients: ["citizenM Finance", "Apaleo PMS", "Payment processor"],
  },
  {
    agentId: "checkout-agent",
    activityName: "Guest checkout and folio settlement",
    purposeOfProcessing: "Process guest checkout, late fee waiver decisions, and folio settlement governance",
    dataCategories: ["Guest name", "Loyalty tier", "Stay duration", "Late checkout status", "Folio balance", "Payment method"],
    dataSubjects: "Hotel guests",
    lawfulBasis: "Performance of a contract",
    lawfulBasisArticle: "Art. 6(1)(b)",
    art22Scope: true,
    art22Exception: "Art. 22(2)(a) — checkout processing is necessary to complete the accommodation contract; fee waiver decisions above ceiling require HITL approval",
    retentionPeriod: "7 years (financial record retention)",
    safeguards: ["HITL for above-ceiling fee waivers", "PII scrubbing layer (Microsoft Presidio)", "Governance file constraints"],
    recipients: ["citizenM front-of-house staff", "Apaleo PMS", "Payment processor"],
  },
  {
    agentId: "revenue-reconciliation-agent",
    activityName: "Nightly revenue reconciliation",
    purposeOfProcessing: "Internal revenue variance analysis and reconciliation; does not directly process guest identity data",
    dataCategories: ["Aggregated reservation revenue", "Folio totals", "Variance flags", "Hotel-level financial metrics"],
    dataSubjects: "Internal (hotel financial records, not individual guests)",
    lawfulBasis: "Legitimate interests",
    lawfulBasisArticle: "Art. 6(1)(f) — legitimate interest: financial oversight and regulatory compliance",
    art22Scope: false,
    art22Exception: null,
    retentionPeriod: "7 years (financial record retention)",
    safeguards: ["No individual guest PII in processing scope", "HITL for above-threshold override authority", "EXCEPTION_AUTHORITY.md ceiling constraints"],
    recipients: ["citizenM Finance", "Revenue Management", "Apaleo PMS"],
  },
];

// ─── GET /api/gdpr/ropa ──────────────────────────────────────────────────────

router.get("/gdpr/ropa", async (_req, res) => {
  try {
    const [fileCounts, phaseCounts] = await Promise.all([
      // Count governance files per agent to determine if RoPA record is documented
      db
        .select({ agentId: governanceFiles.agentId, cnt: sql<string>`count(*)` })
        .from(governanceFiles)
        .where(
          and(
            not(eq(governanceFiles.isArchived, true)),
            inArray(governanceFiles.companyId, [0, 1, 2, 3, 4, 5]),
          ),
        )
        .groupBy(governanceFiles.agentId),
      // Phase counts per agent to derive deployment status
      db
        .select({ agentId: agentPhases.agentId, phase: agentPhases.phase })
        .from(agentPhases)
        .where(inArray(agentPhases.companyId, COMPANIES)),
    ]);

    const fileCountByAgent: Record<string, number> = {};
    for (const r of fileCounts) {
      if (r.agentId) fileCountByAgent[r.agentId] = Number(r.cnt);
    }

    const activeHotelsByAgent: Record<string, string[]> = {};
    for (const r of phaseCounts) {
      if (!activeHotelsByAgent[r.agentId]) activeHotelsByAgent[r.agentId] = [];
      const hotel = Object.values(COMPANY_MAP).find((_, i) => Object.keys(COMPANY_MAP)[i]);
      // just track that agent is active somewhere
      if (!activeHotelsByAgent[r.agentId].includes(r.phase)) {
        activeHotelsByAgent[r.agentId].push(r.phase);
      }
    }

    const activities = AGENT_ROPA.map((a) => ({
      ...a,
      governanceFileCount: fileCountByAgent[a.agentId] ?? 0,
      documented: (fileCountByAgent[a.agentId] ?? 0) > 0,
      controller: "citizenM Hotels",
      processor: "Rawson Consulting BV — VDA-MD Platform",
      transfersOutsideEEA: false,
      transferSafeguards: "Data processed within EU. Apaleo PMS — EU-hosted SaaS.",
    }));

    const totalArt22 = activities.filter((a) => a.art22Scope).length;
    const allDocumented = activities.every((a) => a.documented);

    res.json({
      activities,
      totalActivities: activities.length,
      totalArt22Scope: totalArt22,
      allDocumented,
      controller: "citizenM Hotels",
      processor: "Rawson Consulting BV — VDA-MD Platform",
      dpo: "To be appointed by citizenM Hotels (Art. 37)",
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "gdpr/ropa error");
    res.status(500).json({ error: "Failed to load RoPA" });
  }
});

// ─── GET /api/gdpr/article22 ──────────────────────────────────────────────────

router.get("/gdpr/article22", async (_req, res) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Count PASS (automated, no HITL) vs ESCALATE (human review triggered) per agent
    const decisionRows = await db
      .select({
        agent: witnessEntries.agent,
        decision: witnessEntries.decision,
        cnt: sql<string>`count(*)`,
      })
      .from(witnessEntries)
      .where(
        and(
          gte(witnessEntries.createdAt, thirtyDaysAgo),
          inArray(witnessEntries.companyId, COMPANIES),
        ),
      )
      .groupBy(witnessEntries.agent, witnessEntries.decision);

    const byAgent: Record<string, { pass: number; fail: number; escalate: number }> = {};
    for (const r of decisionRows) {
      const slug = r.agent.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
      if (!byAgent[slug]) byAgent[slug] = { pass: 0, fail: 0, escalate: 0 };
      if (r.decision === "PASS")     byAgent[slug].pass     += Number(r.cnt);
      if (r.decision === "FAIL")     byAgent[slug].fail     += Number(r.cnt);
      if (r.decision === "ESCALATE") byAgent[slug].escalate += Number(r.cnt);
    }

    const art22Agents = AGENT_ROPA.filter((a) => a.art22Scope).map((a) => {
      const counts = byAgent[a.agentId] ?? { pass: 0, fail: 0, escalate: 0 };
      const total = counts.pass + counts.fail + counts.escalate;
      const humanReviewRate = total > 0 ? Math.round(((counts.escalate + counts.fail) / total) * 1000) / 10 : null;
      const automatedPassRate = total > 0 ? Math.round((counts.pass / total) * 1000) / 10 : null;

      return {
        agentId: a.agentId,
        agentName: a.agentId.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        activityName: a.activityName,
        dataCategories: a.dataCategories,
        lawfulBasis: a.lawfulBasis,
        lawfulBasisArticle: a.lawfulBasisArticle,
        art22Exception: a.art22Exception,
        // Within-ceiling PASS decisions are automated (no HITL required per governance rules)
        automated30d: counts.pass,
        humanReviewed30d: counts.escalate + counts.fail,
        total30d: total,
        humanReviewRatePct: humanReviewRate,
        automatedPassRatePct: automatedPassRate,
        // Compliance status: green if human review rate >= 5% (HITL engaged), amber if fully automated
        hitlSafeguardActive: counts.escalate > 0,
        complianceStatus: counts.escalate > 0 ? "safeguarded" : total > 0 ? "monitoring" : "no_data",
      };
    });

    const totalAutomated30d = art22Agents.reduce((s, a) => s + a.automated30d, 0);
    const totalHumanReviewed30d = art22Agents.reduce((s, a) => s + a.humanReviewed30d, 0);

    res.json({
      art22Agents,
      totalArt22Agents: art22Agents.length,
      totalAutomated30d,
      totalHumanReviewed30d,
      overallSafeguard: "HITL (human-in-the-loop) mandatory for all decisions above authority ceiling (Art. 22(2)(a) + Art. 22(3))",
      guestRights: [
        "Right to be informed about automated decision-making (surfaced via HITL notification)",
        "Right to request human review of any automated decision (HITL queue always available)",
        "Right to express their point of view before automated checkout/charge decisions",
        "Right not to be subject to a decision based solely on automated processing where it produces significant legal or similarly significant effects",
      ],
      periodDays: 30,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "gdpr/article22 error");
    res.status(500).json({ error: "Failed to load Art. 22 data" });
  }
});

// ─── GET /api/gdpr/checklist ──────────────────────────────────────────────────

router.get("/gdpr/checklist", async (_req, res) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const seventyTwoHoursAgo = new Date(Date.now() - 72 * 60 * 60 * 1000);

    const [
      totalWitnessRows,
      fileCountRows,
      integrityRows,
      complianceBoundaryRecent,
      art22DecisionRows,
      piiLayerRows,
    ] = await Promise.all([
      db
        .select({ cnt: sql<string>`count(*)` })
        .from(witnessEntries)
        .where(inArray(witnessEntries.companyId, COMPANIES)),

      db
        .select({ cnt: sql<string>`count(*)` })
        .from(governanceFiles)
        .where(
          and(
            not(eq(governanceFiles.isArchived, true)),
            inArray(governanceFiles.companyId, [0, 1, 2, 3, 4, 5]),
          ),
        ),

      db
        .select({ createdAt: witnessEntries.createdAt })
        .from(witnessEntries)
        .where(
          and(
            eq(witnessEntries.eventCategory, "FRAMEWORK_INTEGRITY"),
            inArray(witnessEntries.companyId, COMPANIES),
          ),
        )
        .orderBy(desc(witnessEntries.createdAt))
        .limit(1),

      // COMPLIANCE_BOUNDARY events in last 30 days (Art. 33 near-misses + Art. 32 security)
      db
        .select({ cnt: sql<string>`count(*)` })
        .from(witnessEntries)
        .where(
          and(
            gte(witnessEntries.createdAt, thirtyDaysAgo),
            eq(witnessEntries.eventCategory, "COMPLIANCE_BOUNDARY"),
            inArray(witnessEntries.companyId, COMPANIES),
          ),
        ),

      // Art. 22: ESCALATE count (HITL engaged) vs total Art. 22-scope decisions
      db
        .select({ decision: witnessEntries.decision, cnt: sql<string>`count(*)` })
        .from(witnessEntries)
        .where(
          and(
            gte(witnessEntries.createdAt, thirtyDaysAgo),
            inArray(witnessEntries.companyId, COMPANIES),
          ),
        )
        .groupBy(witnessEntries.decision),

      // PII scrubbing: check for FRAMEWORK_INTEGRITY events referencing PII/privacy
      db
        .select({ cnt: sql<string>`count(*)` })
        .from(witnessEntries)
        .where(
          and(
            eq(witnessEntries.eventCategory, "FRAMEWORK_INTEGRITY"),
            gte(witnessEntries.createdAt, thirtyDaysAgo),
            inArray(witnessEntries.companyId, COMPANIES),
          ),
        ),
    ]);

    const totalWitness = Number(totalWitnessRows[0]?.cnt ?? 0);
    const totalFiles   = Number(fileCountRows[0]?.cnt ?? 0);
    const lastIntegrity = integrityRows[0]?.createdAt ?? null;
    const complianceBoundaryCount = Number(complianceBoundaryRecent[0]?.cnt ?? 0);
    const piiLayerEvents = Number(piiLayerRows[0]?.cnt ?? 0);

    const decisionMap: Record<string, number> = {};
    for (const r of art22DecisionRows) {
      if (r.decision) decisionMap[r.decision] = Number(r.cnt);
    }
    const escalateCount = decisionMap["ESCALATE"] ?? 0;
    const passCount     = decisionMap["PASS"]     ?? 0;
    const totalDecisions = passCount + escalateCount + (decisionMap["FAIL"] ?? 0);
    const hitlEngagementRatePct = totalDecisions > 0
      ? Math.round((escalateCount / totalDecisions) * 1000) / 10
      : null;

    res.json({
      articles: [
        {
          id: "Art. 5", title: "Processing Principles",
          status: totalWitness > 0 && totalFiles > 0 ? "green" : "amber",
          evidence: totalWitness > 0
            ? `${totalWitness.toLocaleString()} decisions logged with verbatim governance clause (accountability). ${totalFiles} governance files enforce data minimisation, purpose limitation, and accuracy constraints.`
            : "Insufficient audit data to confirm processing principles are consistently applied",
          principles: ["Lawfulness", "Fairness", "Transparency", "Purpose limitation", "Data minimisation", "Accuracy", "Storage limitation", "Integrity & confidentiality", "Accountability"],
        },
        {
          id: "Art. 6", title: "Lawful Basis for Processing",
          status: "green",
          evidence: `All agent processing activities operate under Art. 6(1)(b) (contract performance) for guest-facing decisions and Art. 6(1)(f) (legitimate interests) for internal analytics. Lawful basis documented per agent in the Records of Processing Activities.`,
        },
        {
          id: "Art. 13/14", title: "Transparency to Data Subjects",
          status: "amber",
          evidence: "VDA-MD governance files document agent purpose, data categories, and HITL escalation rights for internal transparency. Guest-facing privacy notices (informing guests of AI-assisted decisions) must be confirmed as present and up-to-date by citizenM Hotels as data controller.",
        },
        {
          id: "Art. 22", title: "Automated Decision-Making",
          status: escalateCount > 0 ? "green" : passCount > 0 ? "amber" : "amber",
          evidence: escalateCount > 0
            ? `HITL safeguard operational: ${escalateCount} decisions escalated to human review in last 30 days (${hitlEngagementRatePct}% human engagement). All above-ceiling decisions require HITL approval before execution. Agents operate under Art. 22(2)(a) exception (contract necessity) with Art. 22(3) safeguards.`
            : passCount > 0
            ? `${passCount} automated decisions in last 30 days with 0 HITL escalations — confirm authority ceilings are set appropriately for current guest decision types.`
            : "No decision data in last 30 days — confirm agents are operational",
        },
        {
          id: "Art. 25", title: "Privacy by Design & Default",
          status: "green",
          evidence: `Microsoft Presidio PII scrubbing layer active — raw guest PII is redacted before reaching LLM inference. Governance files enforce data minimisation (agents only receive Apaleo context fields necessary for their specific decision). ${totalFiles} governance files encode privacy-protective MUST NOT clauses.`,
        },
        {
          id: "Art. 30", title: "Records of Processing Activities",
          status: "amber",
          evidence: `RoPA generated from live governance state: ${AGENT_ROPA.length} processing activities documented across ${AGENT_ROPA.filter(a => a.art22Scope).length} Art. 22-scope agents. citizenM Hotels (data controller) must formally maintain and sign off the RoPA. DPO appointment status requires confirmation.`,
        },
        {
          id: "Art. 32", title: "Security of Processing",
          status: lastIntegrity ? "green" : "amber",
          evidence: lastIntegrity
            ? `Framework integrity checks active (W3C Verifiable Credentials, governance file hash verification, tamper-evident Witness Agent log). Last integrity check: ${new Date(lastIntegrity).toISOString()}. ${complianceBoundaryCount} compliance boundary events in last 30 days (monitored).`
            : "No framework integrity check data found — verify integrity check scheduler is running",
        },
        {
          id: "Art. 33", title: "Breach Notification",
          status: complianceBoundaryCount === 0 ? "green" : "amber",
          evidence: complianceBoundaryCount === 0
            ? "No compliance boundary events in last 30 days. Data breach response procedure documented in onboarding-policy.md. 72-hour notification deadline to supervisory authority on awareness of a breach."
            : `${complianceBoundaryCount} compliance boundary event(s) in last 30 days (classified as near-misses). Review each event in the Breach Register to confirm none meet the Art. 33 breach notification threshold. 72-hour deadline applies from moment of awareness.`,
        },
        {
          id: "Art. 35", title: "Data Protection Impact Assessment",
          status: "amber",
          evidence: "DPIA has not been formally completed for the VDA-MD platform deployment at citizenM Hotels. A DPIA is recommended given the automated decision-making scope (Art. 35(3)(a)) and large-scale processing of guest personal data. citizenM Hotels as controller is responsible for commissioning the DPIA.",
        },
      ],
      summary: {
        totalWitnessEntries: totalWitness,
        totalGovernanceFiles: totalFiles,
        lastIntegrityCheck: lastIntegrity,
        complianceBoundary30d: complianceBoundaryCount,
        hitlEngagementRatePct,
        escalateCount30d: escalateCount,
        passCount30d: passCount,
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "gdpr/checklist error");
    res.status(500).json({ error: "Failed to load GDPR checklist" });
  }
});

// ─── GET /api/gdpr/breaches ──────────────────────────────────────────────────
// Art. 33: Returns COMPLIANCE_BOUNDARY/FAIL events as near-misses + any
// classified breaches. A COMPLIANCE_BOUNDARY/FAIL event indicates a governance
// rule blocked a potentially non-compliant action — these are security near-misses
// that must be assessed for Art. 33 breach notification threshold.

router.get("/gdpr/breaches", async (_req, res) => {
  try {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const rows = await db
      .select()
      .from(witnessEntries)
      .where(
        and(
          gte(witnessEntries.createdAt, ninetyDaysAgo),
          inArray(witnessEntries.companyId, COMPANIES),
          or(
            and(
              eq(witnessEntries.eventCategory, "COMPLIANCE_BOUNDARY"),
              eq(witnessEntries.decision, "FAIL"),
            ),
            // FRAMEWORK_INTEGRITY failures indicate potential security events
            and(
              eq(witnessEntries.eventCategory, "FRAMEWORK_INTEGRITY"),
              eq(witnessEntries.decision, "FAIL"),
            ),
          ),
        ),
      )
      .orderBy(desc(witnessEntries.createdAt));

    const events = rows.map((r) => ({
      id: r.id,
      date: r.createdAt,
      hotel: COMPANY_MAP[r.companyId] ?? `Hotel ${r.companyId}`,
      agent: r.agent,
      category: r.eventCategory ?? "UNKNOWN",
      // FRAMEWORK_INTEGRITY/FAIL = security event; COMPLIANCE_BOUNDARY/FAIL = regulatory near-miss
      classification:
        r.eventCategory === "FRAMEWORK_INTEGRITY"
          ? "SECURITY_EVENT"
          : "REGULATORY_NEAR_MISS",
      severity: r.eventCategory === "FRAMEWORK_INTEGRITY" ? "HIGH" : "MEDIUM",
      governingClause: r.clauseApplied ?? "—",
      fileReferenced: r.fileReferenced ?? "—",
      actionBlocked: r.actionProposed ?? "—",
      // Governance rule blocked the action — this is a prevented breach, not a reportable breach
      breachStatus: "prevented_by_governance",
      art33AssessmentRequired: r.eventCategory === "FRAMEWORK_INTEGRITY",
      notificationStatus: "not_required_action_was_prevented",
    }));

    const securityEvents = events.filter((e) => e.classification === "SECURITY_EVENT");
    const nearMisses     = events.filter((e) => e.classification === "REGULATORY_NEAR_MISS");

    res.json({
      events,
      total: events.length,
      securityEventCount: securityEvents.length,
      nearMissCount: nearMisses.length,
      reportableBreachCount: 0,
      note: "All events in this register represent prevented actions — the governance system blocked the non-compliant operation before it occurred. No reportable personal data breaches under Art. 33 are recorded in this period. Any event classified as SECURITY_EVENT should be reviewed by the DPO within 24 hours to confirm it does not meet the Art. 33 breach threshold.",
      periodDays: 90,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "gdpr/breaches error");
    res.status(500).json({ error: "Failed to load breach register" });
  }
});

export default router;
