/**
 * EU AI Act Compliance Reporting API
 *
 * GET /api/eu-ai-act/register   — AI System Register (Art. 16h + Art. 49)
 * GET /api/eu-ai-act/monitoring — Post-market monitoring (Art. 72)
 * GET /api/eu-ai-act/incidents  — Serious incident register (Art. 73)
 * GET /api/eu-ai-act/declaration — Declaration of Conformity (Art. 47)
 */
import { Router } from "express";
import { db, witnessEntries, governanceFiles, agentPhases } from "@workspace/db";
import { eq, and, gte, lt, or, desc, inArray, sql, not } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const router = Router();

const COMPANIES = [1, 2, 3, 4, 5];
const COMPANY_MAP: Record<number, string> = { 1: "BER", 2: "LND", 3: "MUC", 4: "PAR", 5: "VIE" };

const AGENTS = [
  {
    id: "availability-agent", name: "Availability Agent", domain: "Operations",
    intendedUse: "Real-time unit availability checks and inventory queries",
    nistControl: "AC-2", riskClass: "limited",
  },
  {
    id: "rate-agent", name: "Rate Agent", domain: "Revenue",
    intendedUse: "Dynamic rate management, discount authority, and rate plan governance",
    nistControl: "AC-2", riskClass: "limited",
  },
  {
    id: "reservation-bot", name: "Reservation Bot", domain: "Operations",
    intendedUse: "Reservation creation, modification, and group booking governance",
    nistControl: "AC-2", riskClass: "limited",
  },
  {
    id: "check-in-agent", name: "Check-In Agent", domain: "Operations",
    intendedUse: "Guest check-in, pre-authorisation, unit assignment, and upgrade governance",
    nistControl: "AC-2", riskClass: "limited",
  },
  {
    id: "folio-agent", name: "Folio Agent", domain: "Operations",
    intendedUse: "Folio read access, charge dispute flagging, and audit trail management",
    nistControl: "AU-2", riskClass: "limited",
  },
  {
    id: "folio-charge-agent", name: "Folio Charge Agent", domain: "Operations",
    intendedUse: "Folio charge posting within authority ceilings with mandatory HITL escalation",
    nistControl: "AU-2", riskClass: "limited",
  },
  {
    id: "checkout-agent", name: "Checkout Agent", domain: "Operations",
    intendedUse: "Guest checkout, late fee waiver authority, and folio settlement governance",
    nistControl: "AC-2", riskClass: "limited",
  },
  {
    id: "revenue-reconciliation-agent", name: "Revenue Reconciliation Agent", domain: "Revenue",
    intendedUse: "Nightly revenue reconciliation, variance threshold governance, and override authority",
    nistControl: "SA-4", riskClass: "limited",
  },
];

function toSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

// ─── GET /api/eu-ai-act/register ──────────────────────────────────────────────

router.get("/eu-ai-act/register", async (_req, res) => {
  try {
    const files = await db
      .select({
        agentId: governanceFiles.agentId,
        fileType: governanceFiles.fileType,
        updatedAt: governanceFiles.updatedAt,
      })
      .from(governanceFiles)
      .where(
        and(
          not(eq(governanceFiles.isArchived, true)),
          inArray(governanceFiles.fileType, ["EXCEPTION_AUTHORITY", "AGENTS", "SOP", "COMPLIANCE"]),
        ),
      );

    const phases = await db
      .select({ agentId: agentPhases.agentId, phase: agentPhases.phase })
      .from(agentPhases)
      .where(inArray(agentPhases.companyId, COMPANIES));

    const filesByAgent: Record<string, typeof files> = {};
    for (const f of files) {
      if (!f.agentId) continue;
      if (!filesByAgent[f.agentId]) filesByAgent[f.agentId] = [];
      filesByAgent[f.agentId].push(f);
    }

    const phasesByAgent: Record<string, { phase: string }[]> = {};
    for (const p of phases) {
      if (!phasesByAgent[p.agentId]) phasesByAgent[p.agentId] = [];
      phasesByAgent[p.agentId].push({ phase: p.phase });
    }

    const register = AGENTS.map((agent) => {
      const agentFiles = filesByAgent[agent.id] ?? [];
      const agentPhaseList = phasesByAgent[agent.id] ?? [];

      const hasExceptionAuthority = agentFiles.some((f) => f.fileType === "EXCEPTION_AUTHORITY");
      const hasAgentsMd = agentFiles.some((f) => f.fileType === "AGENTS");
      const hasSop = agentFiles.some((f) => f.fileType === "SOP");
      const techDocComplete = hasExceptionAuthority && hasAgentsMd && hasSop;

      const runCount = agentPhaseList.filter((p) => p.phase === "run").length;
      const supervisedCount = agentPhaseList.filter(
        (p) => p.phase === "crawl" || p.phase === "walk",
      ).length;

      let deploymentStatus = "not_deployed";
      if (runCount > 0) deploymentStatus = "production";
      else if (supervisedCount > 0) deploymentStatus = "supervised";

      const latestFile = agentFiles
        .filter((f) => f.updatedAt)
        .sort((a, b) => new Date(b.updatedAt!).getTime() - new Date(a.updatedAt!).getTime())[0];

      return {
        agentId: agent.id,
        agentName: agent.name,
        domain: agent.domain,
        intendedUse: agent.intendedUse,
        nistControl: agent.nistControl,
        riskClass: agent.riskClass,
        provider: "Rawson Consulting BV — VDA-MD Platform",
        deployer: "citizenM Hotels",
        techDocComplete,
        conformityStatus: techDocComplete ? "conformant" : "incomplete",
        art49Status: "pending_submission",
        deploymentStatus,
        activeDeployments: runCount + supervisedCount,
        governanceFileCount: agentFiles.length,
        lastAssessed: latestFile?.updatedAt ?? null,
      };
    });

    res.json({ register, generatedAt: new Date().toISOString() });
  } catch (err) {
    logger.error({ err }, "eu-ai-act/register error");
    res.status(500).json({ error: "Failed to load AI register" });
  }
});

// ─── GET /api/eu-ai-act/monitoring ────────────────────────────────────────────

router.get("/eu-ai-act/monitoring", async (_req, res) => {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    const [currentRows, priorRows, totalRows] = await Promise.all([
      db
        .select({
          agent: witnessEntries.agent,
          decision: witnessEntries.decision,
          eventCategory: witnessEntries.eventCategory,
          cnt: sql<string>`count(*)`,
        })
        .from(witnessEntries)
        .where(
          and(
            gte(witnessEntries.createdAt, thirtyDaysAgo),
            inArray(witnessEntries.companyId, COMPANIES),
          ),
        )
        .groupBy(
          witnessEntries.agent,
          witnessEntries.decision,
          witnessEntries.eventCategory,
        ),

      db
        .select({
          agent: witnessEntries.agent,
          decision: witnessEntries.decision,
          cnt: sql<string>`count(*)`,
        })
        .from(witnessEntries)
        .where(
          and(
            gte(witnessEntries.createdAt, sixtyDaysAgo),
            lt(witnessEntries.createdAt, thirtyDaysAgo),
            inArray(witnessEntries.companyId, COMPANIES),
          ),
        )
        .groupBy(witnessEntries.agent, witnessEntries.decision),

      db
        .select({ cnt: sql<string>`count(*)` })
        .from(witnessEntries)
        .where(inArray(witnessEntries.companyId, COMPANIES)),
    ]);

    const totalWitnessEntries = Number(totalRows[0]?.cnt ?? 0);

    const curByAgent: Record<
      string,
      { pass: number; fail: number; escalate: number; guardViolations: number }
    > = {};
    for (const r of currentRows) {
      const slug = toSlug(r.agent);
      if (!curByAgent[slug])
        curByAgent[slug] = { pass: 0, fail: 0, escalate: 0, guardViolations: 0 };
      const n = Number(r.cnt);
      if (r.decision === "PASS") curByAgent[slug].pass += n;
      else if (r.decision === "FAIL") curByAgent[slug].fail += n;
      else if (r.decision === "ESCALATE") curByAgent[slug].escalate += n;
      if (r.eventCategory === "COMPLIANCE_BOUNDARY" && r.decision === "FAIL") {
        curByAgent[slug].guardViolations += n;
      }
    }

    const priorByAgent: Record<string, { pass: number; fail: number; escalate: number }> = {};
    for (const r of priorRows) {
      const slug = toSlug(r.agent);
      if (!priorByAgent[slug]) priorByAgent[slug] = { pass: 0, fail: 0, escalate: 0 };
      const n = Number(r.cnt);
      if (r.decision === "PASS") priorByAgent[slug].pass += n;
      else if (r.decision === "FAIL") priorByAgent[slug].fail += n;
      else if (r.decision === "ESCALATE") priorByAgent[slug].escalate += n;
    }

    const agentMetrics = AGENTS.map((agent) => {
      const cur = curByAgent[agent.id] ?? { pass: 0, fail: 0, escalate: 0, guardViolations: 0 };
      const prior = priorByAgent[agent.id] ?? { pass: 0, fail: 0, escalate: 0 };
      const curTotal = cur.pass + cur.fail + cur.escalate;
      const priorTotal = prior.pass + prior.fail + prior.escalate;
      const failEscalateRate = curTotal > 0 ? (cur.fail + cur.escalate) / curTotal : 0;
      const priorFailEscalateRate = priorTotal > 0 ? (prior.fail + prior.escalate) / priorTotal : 0;

      const delta = failEscalateRate - priorFailEscalateRate;
      const trend: "up" | "down" | "stable" =
        delta > 0.02 ? "up" : delta < -0.02 ? "down" : "stable";

      return {
        agentId: agent.id,
        agentName: agent.name,
        current30d: {
          pass: cur.pass,
          fail: cur.fail,
          escalate: cur.escalate,
          guardViolations: cur.guardViolations,
          total: curTotal,
        },
        prior30d: { pass: prior.pass, fail: prior.fail, escalate: prior.escalate, total: priorTotal },
        failEscalateRatePct: Math.round(failEscalateRate * 1000) / 10,
        trend,
        anomaly: failEscalateRate > 0.1,
      };
    });

    res.json({
      agentMetrics,
      totalWitnessEntries,
      periodDays: 30,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "eu-ai-act/monitoring error");
    res.status(500).json({ error: "Failed to load monitoring data" });
  }
});

// ─── GET /api/eu-ai-act/incidents ─────────────────────────────────────────────

router.get("/eu-ai-act/incidents", async (_req, res) => {
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
            eq(witnessEntries.decision, "ESCALATE"),
            and(
              eq(witnessEntries.eventCategory, "COMPLIANCE_BOUNDARY"),
              eq(witnessEntries.decision, "FAIL"),
            ),
          ),
        ),
      )
      .orderBy(desc(witnessEntries.createdAt))
      .limit(100);

    const incidents = rows.map((r) => ({
      id: r.id,
      date: r.createdAt,
      hotel: COMPANY_MAP[r.companyId] ?? `Hotel ${r.companyId}`,
      agent: r.agent,
      severity:
        r.eventCategory === "COMPLIANCE_BOUNDARY" && r.decision === "FAIL" ? "HIGH" : "MEDIUM",
      decision: r.decision,
      governingClause: r.clauseApplied ?? "—",
      fileReferenced: r.fileReferenced ?? "—",
      escalationTarget: r.escalationTarget ?? null,
      reportStatus: "pending_authority_notification",
    }));

    res.json({
      incidents,
      total: incidents.length,
      highCount: incidents.filter((i) => i.severity === "HIGH").length,
      mediumCount: incidents.filter((i) => i.severity === "MEDIUM").length,
      periodDays: 90,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "eu-ai-act/incidents error");
    res.status(500).json({ error: "Failed to load incident register" });
  }
});

// ─── GET /api/eu-ai-act/declaration ───────────────────────────────────────────

router.get("/eu-ai-act/declaration", async (_req, res) => {
  try {
    const [fileCountRows, witnessCountRows, integrityRows] = await Promise.all([
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
        .select({ cnt: sql<string>`count(*)` })
        .from(witnessEntries)
        .where(inArray(witnessEntries.companyId, COMPANIES)),
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
    ]);

    const fileCount = Number(fileCountRows[0]?.cnt ?? 0);
    const witnessCount = Number(witnessCountRows[0]?.cnt ?? 0);
    const lastIntegrityCheck = integrityRows[0]?.createdAt ?? null;
    const declarationDate = new Date().toISOString().split("T")[0];
    const lastIntegrityStr = lastIntegrityCheck
      ? new Date(lastIntegrityCheck).toISOString()
      : "Not yet run";

    const declarationText = `EU AI ACT — DECLARATION OF CONFORMITY
Regulation (EU) 2024/1689 of the European Parliament and of the Council

Date of Declaration: ${declarationDate}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. PROVIDER INFORMATION
   Name:     Rawson Consulting BV
   Platform: VDA-MD (Value-Driven AI — Markdown Governance Platform)
   Version:  1.0 (Apaleo Hospitality Stack)
   Contact:  compliance@vda-md.io

2. DEPLOYER INFORMATION
   Organisation: citizenM Hotels
   Properties:   citizenM Berlin (BER), citizenM London (LND),
                 citizenM Munich (MUC), citizenM Paris (PAR),
                 citizenM Vienna (VIE)
   Use Domain:   Hotel Operations & Revenue Management

3. AI SYSTEMS COVERED — Article 49 Registration Readiness
   The following AI agents are covered by this declaration:
   • Availability Agent              (Operations — inventory governance)
   • Rate Agent                      (Revenue — discount authority governance)
   • Reservation Bot                 (Operations — reservation governance)
   • Check-In Agent                  (Operations — check-in & upgrade governance)
   • Folio Agent                     (Operations — folio audit & dispute flagging)
   • Folio Charge Agent              (Operations — charge authority governance)
   • Checkout Agent                  (Operations — checkout & fee waiver governance)
   • Revenue Reconciliation Agent    (Revenue — variance & reconciliation governance)

   Risk Classification: Limited Risk (Article 50, EU AI Act)
   Rationale: All agents operate within human-in-the-loop (HITL) oversight at
   all material decision points. No autonomous decisions with irreversible
   consequences are permitted. Escalation is mandatory for all decisions above
   the agent's authority ceiling defined in EXCEPTION_AUTHORITY.md.

4. TECHNICAL DOCUMENTATION — Article 11 + Annex IV
   Each agent is governed by a complete set of Markdown governance files:
   • AGENTS.md           — purpose, capabilities, limitations, NIST control mapping
   • EXCEPTION_AUTHORITY.md — exception ceilings per role band, escalation targets
   • SOP.md              — operational procedures (MUST / MUST NOT / MAY clauses)
   • EXCEPTION.md        — time-limited approved exception overlays
   Total governance files in active registry: ${fileCount}
   All files are cryptographically hashed and version-tracked. GDPR, EU AI Act,
   and ISO 42001 references are permanently protected under VDA-MD §3 (immutable
   compliance guard — any reduction triggers a mandatory HTTP 409 rejection).

5. RECORD-KEEPING AND LOGGING — Article 12
   The VDA-MD Witness Agent provides an immutable, tamper-evident audit trail
   for every AI agent decision. Each entry captures:
   • Decision outcome (PASS / FAIL / ESCALATE / INFO)
   • Verbatim governance clause applied (exact text from the Markdown file)
   • Cryptographic hash of the governance file at the moment of decision
   • W3C Verifiable Credential status of the acting agent
   • Raw Apaleo PMS context data at the time of the decision
   • Cross-domain governance inheritance flags
   Total audit entries recorded: ${witnessCount}
   Last framework integrity check: ${lastIntegrityStr}

6. TRANSPARENCY — Article 13
   Deployers (citizenM hotel staff) are informed at all times:
   • The identity of the AI agent making the decision
   • The specific governance clause governing the decision
   • The authority ceiling that applies to the current decision
   • Their right to override any agent decision via the HITL queue
   • The full escalation path when agent authority is exceeded

7. HUMAN OVERSIGHT — Article 14
   The Human-In-The-Loop (HITL) system enforces human oversight:
   • Every ESCALATE decision creates a mandatory approval card for the
     appropriate role band (Ambassador → Senior Ambassador → Hotel GM →
     Regional GM → Operations Chief → Compliance Officer)
   • Compliance Officer Gate 1 and Gate 2 sign-off for material decisions
   • No agent can bypass the HITL queue for decisions above its ceiling
   • Shadow review protocol: 100% human review for all crawl-phase agents
   • Phase promotion (crawl → walk → run) requires sustained human agreement
     rate above the threshold defined in onboarding-policy.md

8. POST-MARKET MONITORING — Article 72
   VDA-MD provides continuous post-market performance monitoring:
   • 30-day rolling PASS / FAIL / ESCALATE rate tracking per agent
   • Agreement rate monitoring per role band
   • Compliance boundary violation detection and classification
   • Automated anomaly flagging: FAIL+ESCALATE rate exceeding 10% triggers
     a monitoring alert on the Compliance Officer dashboard
   • Framework integrity checks run on a 6-hour cycle with cryptographic
     verification of all governance file content hashes

9. SERIOUS INCIDENT REPORTING — Article 73
   VDA-MD classifies and tracks serious incidents:
   • HIGH severity: COMPLIANCE_BOUNDARY / FAIL events (governance rule blocked)
   • MEDIUM severity: ESCALATE decisions (agent authority ceiling exceeded)
   Providers are responsible for reporting serious incidents to the relevant
   national competent authority within 15 working days of becoming aware.
   Incident Register: Available in the VDA-MD Compliance Officer dashboard.
   Current status: All incidents classified — authority notification pending
   (manual submission required to national competent authority).

10. APPLICABLE STANDARDS AND FRAMEWORKS
    • EU AI Act (Regulation EU 2024/1689)
    • GDPR — Article 22 (automated decision rights preserved for all guests)
    • ISO 42001 (AI management system)
    • NIST SP 800-53 (controls: AC-2, AU-2, SA-4, IR-4)
    • W3C Verifiable Credentials (agent identity and governance integrity)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

This declaration was generated automatically from the live governance state
of the VDA-MD platform and reflects the platform configuration as of the
declaration date above.

Signed on behalf of Rawson Consulting BV:

_______________________________________
[Digital signature pending — Compliance Officer manual sign-off required
 before submission to the EU AI Act registration portal (Art. 49)]`;

    res.json({
      declarationText,
      declarationDate,
      fileCount,
      witnessCount,
      lastIntegrityCheck,
      agentCount: AGENTS.length,
      nistControls: [...new Set(AGENTS.map((a) => a.nistControl))],
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "eu-ai-act/declaration error");
    res.status(500).json({ error: "Failed to generate declaration" });
  }
});

export default router;
