/**
 * Admin routes:
 *   GET  /api/admin/onboarding-policy   — returns parsed onboarding-policy.md (60 s cache)
 *   POST /api/admin/seed-governance-files — idempotent seed for platform governance files
 *
 * Governance file content lives in src/governance/*.md (single-document YAML after front-matter).
 * No policy text is hardcoded in route code — all content is read from static files at seed time.
 */
import { Router, type IRouter } from "express";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { db, governanceFiles, governanceFileVersions, companies, witnessEntries, agentPhases, hitlTokens, onboardingRequests, a2aTasks, exceptionBaselines, activationRequests, agentCredentials, agentValueEvents, agentMandates, sealOutbox } from "@workspace/db";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { issueMandate } from "../lib/mandateIssuer.js";
import { buildRateOffer } from "../lib/ucpOffer.js";
import { getOnboardingPolicy } from "../lib/exceptionAuthorityReader.js";
import { generateExceptionAuthorityFile, COMPANIES_MAP, JURISDICTION_CONTEXT } from "../lib/exceptionAuthorityGenerator.js";
import { startOnboarding } from "../onboarding/onboardingOrchestrator.js";
import { seedStayAgentGovernance } from "../lib/seedStayAgent.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

// ─── POST /api/admin/seed-stay-agent ─────────────────────────────────────────
// Idempotent: seeds the Stay Agent's four governance files (AGENTS/SOP/SKILL/
// EXCEPTION_AUTHORITY) into governance_files for the given company. Binds the
// demo tenant so the check-in→check-out decision engine passes preflight.
router.post("/admin/seed-stay-agent", async (req, res) => {
  try {
    const companyId = Number(req.body?.companyId ?? 0);
    if (Number.isNaN(companyId) || companyId < 0) {
      res.status(400).json({ error: "companyId must be a non-negative integer" });
      return;
    }
    const seeded = await seedStayAgentGovernance(companyId);
    res.json({ ok: true, companyId, seeded });
  } catch (err) {
    logger.error({ err }, "admin/seed-stay-agent error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to seed stay-agent governance" });
  }
});

// ─── File reader helper ───────────────────────────────────────────────────────

// Resolve governance directory for both runtimes:
//   Built bundle (dist/index.mjs): __dirname is dist/ → governance files at dist/governance/
//   Dev/tsx (src/routes/admin.ts): __dirname is src/routes/ → governance files at src/governance/
// We probe the co-located path first (built); fall back to sibling (dev).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const _govColocated = path.join(__dirname, "governance");
const _govSibling   = path.join(__dirname, "../governance");
const GOVERNANCE_DIR = existsSync(_govColocated) ? _govColocated : _govSibling;

function readGovernanceFile(filename: string): string {
  return readFileSync(path.join(GOVERNANCE_DIR, filename), "utf-8");
}

// ─── GET /api/admin/onboarding-policy ────────────────────────────────────────

router.get("/admin/onboarding-policy", async (_req, res) => {
  try {
    const policy = await getOnboardingPolicy();
    res.json(policy);
  } catch (err) {
    logger.error({ err }, "admin/onboarding-policy error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load onboarding policy" });
  }
});

// ─── POST /api/admin/seed-governance-files ───────────────────────────────────

router.post("/admin/seed-governance-files", async (_req, res) => {
  try {
    const seeded = await seedPlatformGovernanceFiles();
    res.json({ ok: true, seeded });
  } catch (err) {
    logger.error({ err }, "admin/seed-governance-files error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Seed failed" });
  }
});

// ─── Seed Logic ───────────────────────────────────────────────────────────────
// Content is read from src/governance/*.md — NOT embedded in route code.
// Uses upsert logic: inserts if not present, updates content if already exists.

const NATIVE_AGENTS: Array<{
  agentId: string;
  agentName: string;
  domain: string;
  apaleoApi: string;
  filename: string;
}> = [
  { agentId: "availability-agent",          agentName: "Availability Agent",          domain: "Revenue",     apaleoApi: "Inventory API, Unit Groups API",           filename: "availability-agent.EXCEPTION_AUTHORITY.md" },
  { agentId: "rate-agent",                  agentName: "Rate Agent",                  domain: "Revenue",     apaleoApi: "Rate Plans API, Revenue Reports API",      filename: "rate-agent.EXCEPTION_AUTHORITY.md" },
  { agentId: "reservation-bot",             agentName: "Reservation Bot",             domain: "Revenue",     apaleoApi: "Reservations API, Booking API",            filename: "reservation-bot.EXCEPTION_AUTHORITY.md" },
  { agentId: "check-in-agent",              agentName: "Check-In Agent",              domain: "Operations",  apaleoApi: "Reservations API, Folio API, Unit API",    filename: "check-in-agent.EXCEPTION_AUTHORITY.md" },
  { agentId: "folio-agent",                 agentName: "Folio Agent",                 domain: "Operations",  apaleoApi: "Folio API, Finance API",                   filename: "folio-agent.EXCEPTION_AUTHORITY.md" },
  { agentId: "folio-charge-agent",          agentName: "Folio Charge Agent",          domain: "Operations",  apaleoApi: "Folio API, Finance API",                   filename: "folio-charge-agent.EXCEPTION_AUTHORITY.md" },
  { agentId: "checkout-agent",              agentName: "Checkout Agent",              domain: "Operations",  apaleoApi: "Reservations API, Folio API",              filename: "checkout-agent.EXCEPTION_AUTHORITY.md" },
  { agentId: "revenue-reconciliation-agent", agentName: "Revenue Reconciliation Agent", domain: "Revenue",   apaleoApi: "Revenue Reports API, Finance API",         filename: "revenue-reconciliation-agent.EXCEPTION_AUTHORITY.md" },
];

export async function seedPlatformGovernanceFiles(): Promise<string[]> {
  const seeded: string[] = [];

  // 1. Seed onboarding-policy.md
  const onboardingContent = readGovernanceFile("onboarding-policy.md");
  const existingPolicy = await db
    .select({ id: governanceFiles.id })
    .from(governanceFiles)
    .where(
      and(
        eq(governanceFiles.agentId, "onboarding-agent"),
        eq(governanceFiles.companyId, 0),
        eq(governanceFiles.fileType, "COMPLIANCE"),
        eq(governanceFiles.isArchived, false)
      )
    )
    .limit(1);

  if (!existingPolicy[0]) {
    await db.insert(governanceFiles).values({
      companyId: 0,
      filename: "onboarding-policy.md",
      filepath: "platform/onboarding-policy.md",
      fileType: "COMPLIANCE",
      axis: "shared",
      agentId: "onboarding-agent",
      content: onboardingContent,
      status: "approved",
      owner: "Compliance Officer",
      domain: "Platform",
      nistControl: "AC-2",
      baseline: true,
      mustCount: 0,
      mustNotCount: 0,
      mayCount: 0,
      wordCount: onboardingContent.split(/\s+/).filter(Boolean).length,
    });
    seeded.push("onboarding-policy.md");
    logger.info("Seeded onboarding-policy.md at companyId=0");
  } else {
    await db.update(governanceFiles)
      .set({ content: onboardingContent, wordCount: onboardingContent.split(/\s+/).filter(Boolean).length })
      .where(eq(governanceFiles.id, existingPolicy[0].id));
    seeded.push("onboarding-policy.md (updated)");
    logger.info("Updated onboarding-policy.md at companyId=0");
  }

  // 2. Seed EXCEPTION_AUTHORITY.md for each native agent
  for (const agent of NATIVE_AGENTS) {
    let content: string;
    try {
      content = readGovernanceFile(agent.filename);
    } catch (readErr) {
      logger.error({ readErr, filename: agent.filename }, "[admin] Failed to read governance file — skipping");
      continue;
    }

    const existing = await db
      .select({ id: governanceFiles.id })
      .from(governanceFiles)
      .where(
        and(
          eq(governanceFiles.agentId, agent.agentId),
          eq(governanceFiles.companyId, 0),
          eq(governanceFiles.fileType, "EXCEPTION_AUTHORITY"),
          eq(governanceFiles.isArchived, false)
        )
      )
      .limit(1);

    if (!existing[0]) {
      await db.insert(governanceFiles).values({
        companyId: 0,
        filename: `${agent.agentId}-EXCEPTION_AUTHORITY.md`,
        filepath: `platform/${agent.agentId}-EXCEPTION_AUTHORITY.md`,
        fileType: "EXCEPTION_AUTHORITY",
        axis: "shared",
        agentId: agent.agentId,
        content,
        status: "approved",
        owner: "Compliance Officer",
        domain: agent.domain,
        nistControl: "AC-2",
        baseline: true,
        mustCount: (content.match(/\bMUST\b(?!\s+NOT)/g) || []).length,
        mustNotCount: (content.match(/\bMUST NOT\b/g) || []).length,
        mayCount: (content.match(/\bMAY\b/g) || []).length,
        wordCount: content.split(/\s+/).filter(Boolean).length,
      });
      seeded.push(`${agent.agentId}-EXCEPTION_AUTHORITY.md`);
      logger.info({ agentId: agent.agentId }, "Seeded EXCEPTION_AUTHORITY.md");
    } else {
      await db.update(governanceFiles)
        .set({ content, wordCount: content.split(/\s+/).filter(Boolean).length })
        .where(eq(governanceFiles.id, existing[0].id));
      seeded.push(`${agent.agentId}-EXCEPTION_AUTHORITY.md (updated)`);
      logger.info({ agentId: agent.agentId }, "Updated EXCEPTION_AUTHORITY.md");
    }
  }

  return seeded;
}

// ─── POST /api/admin/seed-rate-agent ─────────────────────────────────────────
// Idempotent: seeds Rate Agent's EXCEPTION_AUTHORITY.md (via seedPlatformGovernanceFiles)
// and creates an onboarding_requests row with source="vda_native", status="pre_admitted".
// This is the entry point for the Iron Onboarding CO → GM → Crawl → Walk reference flow.

router.post("/admin/seed-rate-agent", async (_req, res) => {
  try {
    // 1. Ensure governance files are seeded (idempotent)
    const seeded = await seedPlatformGovernanceFiles();

    // 2. Upsert onboarding_requests row for Rate Agent
    const rateAgentDid = "did:vda:hospitality:rate-agent";
    const existing = await db
      .select({ id: onboardingRequests.id, status: onboardingRequests.status })
      .from(onboardingRequests)
      .where(
        and(
          eq(onboardingRequests.source, "vda_native"),
          eq(onboardingRequests.externalAgentDid, rateAgentDid)
        )
      )
      .limit(1);

    let onboardingRequestId: string;
    let alreadyExists = false;

    if (existing[0]) {
      onboardingRequestId = existing[0].id;
      alreadyExists = true;
    } else {
      const agentCard = {
        id: rateAgentDid,
        name: "Rate Agent",
        version: "1.0.0",
        description: "Apaleo-native rate override agent for the A Hotel Berlin hospitality stack. Operates under full VDA-MD governance with NIST-mapped controls. Implements AP2 Intent Mandates for structured exception handling.",
        skills: [
          {
            id: "rate-agent-core",
            name: "Rate Override Evaluation",
            description: "Evaluates rate requests against BAR, applies role-band authority thresholds, and produces governance-compliant PASS/ESCALATE decisions.",
          },
        ],
        url: "/api/agents/rate",
        provider: { organization: "A Hotel Berlin · VDA-MD Platform", url: "https://aihospitalityalliance.com" },
      };

      const [row] = await db
        .insert(onboardingRequests)
        .values({
          sessionId: `vda-native-rate-agent-${Date.now()}`,
          externalAgentDid: rateAgentDid,
          agentCard,
          source: "vda_native",
          status: "pre_admitted",
        })
        .returning({ id: onboardingRequests.id });

      onboardingRequestId = row.id;
    }

    logger.info({ onboardingRequestId, alreadyExists }, "[admin] Rate Agent seeded");
    res.json({
      ok: true,
      onboardingRequestId,
      alreadyExists,
      message: alreadyExists
        ? `Rate Agent already seeded (status: ${existing[0]?.status})`
        : "Rate Agent seeded as pre_admitted — switch to Compliance Officer role to admit",
      governanceFilesSeeded: seeded,
    });
  } catch (err) {
    logger.error({ err }, "admin/seed-rate-agent error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Seed failed" });
  }
});

// ─── POST /api/admin/master-reset ────────────────────────────────────────────
// Wipes all tenant data so the platform returns to the pre-onboarding state.
// Order matters: delete child tables before parent (companies).
router.post("/admin/master-reset", async (_req, res) => {
  try {
    await db.delete(governanceFileVersions);
    await db.delete(governanceFiles);
    await db.delete(witnessEntries);
    await db.delete(agentPhases);
    await db.delete(hitlTokens);
    await db.delete(onboardingRequests);
    await db.delete(a2aTasks);
    await db.delete(exceptionBaselines);
    await db.delete(activationRequests);
    await db.delete(agentCredentials);
    await db.delete(companies);
    logger.info("Master reset completed — all tenant data wiped");
    res.json({ ok: true, message: "Platform reset to pre-onboarding state" });
  } catch (err) {
    logger.error({ err }, "master-reset error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Reset failed" });
  }
});

// ─── Quick-submit — demo happy-path shortcut (no external VC required) ────────
// Called from the wizard pre-submission card when arriving from File Manager review.
// Constructs a minimal agent card and triggers the full onboarding pipeline
// without requiring a cryptographically-signed W3C Verifiable Credential.

router.post("/admin/onboarding/quick-submit", async (req, res) => {
  const { agentSlug, agentName, agentIcon, agentEndpoint, companyId } = req.body as {
    agentSlug: string;
    agentName: string;
    agentIcon?: string;
    agentEndpoint?: string;
    companyId?: number;
  };

  if (!agentSlug || !agentName) {
    res.status(400).json({ error: "agentSlug and agentName are required" });
    return;
  }

  const agentCard = {
    // Use the slug as the canonical A2A agent card ID (not a DID) so downstream
    // lookups against governance files and agent registries match directly.
    // The DID for W3C VC issuance is separately computed in the onboarding pipeline.
    id: agentSlug,
    name: agentName,
    version: "1.0.0",
    description: `Apaleo-native ${agentName.toLowerCase()} for the A Hotel Berlin hospitality stack. Operates under full VDA-MD governance with NIST-mapped controls.`,
    skills: [
      {
        id: `${agentSlug}-core`,
        name: `${agentName} Core`,
        description: `Core governance skills for ${agentName} within the VDA-MD framework.`,
      },
    ],
    url: agentEndpoint ?? `/api/agents/${agentSlug}`,
  };

  try {
    const result = await startOnboarding({
      sessionId: crypto.randomUUID(),
      agentCard: agentCard as unknown as Parameters<typeof startOnboarding>[0]["agentCard"],
      externalAgentDid: agentCard.id,
      rpcId: null,
      companyId: companyId ?? null,
    });

    if ("error" in result) {
      res.status(400).json(result.error);
      return;
    }

    logger.info({ agentSlug, agentName, companyId }, "[quick-submit] Onboarding pipeline started");
    res.json({ ok: true, onboardingId: result.onboardingId });
  } catch (err) {
    logger.error({ err, agentSlug }, "[quick-submit] Failed to start onboarding");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to start onboarding" });
  }
});

// ─── In-memory seed job tracker ──────────────────────────────────────────────

interface SeedJob {
  completed: number;
  total: number;
  errors: { agentId: string; companyId: number; error: string }[];
  done: boolean;
}

const seedJobs = new Map<string, SeedJob>();

// ─── POST /api/admin/seed-exception-authority-files ──────────────────────────
// Returns { jobId } immediately. Body: { regenerate?: boolean } (default false).
// regenerate=false skips existing files (idempotent). regenerate=true overwrites.
// Covers 48 files: 8 agents × 6 scopes (companyId 0–5, where 0 = platform baseline).

router.post("/admin/seed-exception-authority-files", async (req, res) => {
  const { regenerate = false } = (req.body ?? {}) as { regenerate?: boolean };
  const jobId = `ea-seed-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const companyIds = [0, ...Object.keys(COMPANIES_MAP).map(Number)]; // [0,1,2,3,4,5]
  const total = NATIVE_AGENTS.length * companyIds.length; // 48

  const job: SeedJob = { completed: 0, total, errors: [], done: false };
  seedJobs.set(jobId, job);

  res.json({ jobId, total });

  // Run in background (intentionally not awaited)
  (async () => {
    for (const agent of NATIVE_AGENTS) {
      for (const companyId of companyIds) {
        try {
          // Fetch source files (companyId first, then 0)
          const lookupIds = [companyId, 0];
          const filesByType: Record<string, string> = {};
          for (const ft of ["AGENTS", "SOP", "SKILL"]) {
            for (const cid of lookupIds) {
              const rows = await db
                .select({ content: governanceFiles.content })
                .from(governanceFiles)
                .where(and(
                  eq(governanceFiles.agentId, agent.agentId),
                  eq(governanceFiles.companyId, cid),
                  eq(governanceFiles.fileType, ft as "AGENTS" | "SOP" | "SKILL"),
                  eq(governanceFiles.isArchived, false)
                ))
                .limit(1);
              if (rows[0]) { filesByType[ft] = rows[0].content; break; }
            }
          }

          // Fetch brand context
          let companyName = "A Hotel Berlin Hotels";
          let brandContextStr: string | undefined;
          const companyRows = await db
            .select({ companyName: companies.companyName, brandContext: companies.brandContext })
            .from(companies)
            .where(eq(companies.id, companyId))
            .limit(1);
          if (companyRows[0]) {
            companyName = companyRows[0].companyName;
            brandContextStr = companyRows[0].brandContext ?? undefined;
          }

          // Derive jurisdiction
          const companyMeta = COMPANIES_MAP[companyId] ?? null;
          const jurisdiction = companyMeta ? (JURISDICTION_CONTEXT[companyMeta.propertyCode] ?? null) : null;

          // Generate
          const result = await generateExceptionAuthorityFile({
            agentId: agent.agentId,
            companyId,
            agentsMd: filesByType["AGENTS"] ?? "",
            sopMd: filesByType["SOP"] ?? "",
            skillMd: filesByType["SKILL"] ?? "",
            brandContext: brandContextStr,
            companyName,
            industry: "hospitality",
            jurisdiction,
          });

          const { content } = result;
          const mustCount = (content.match(/\bMUST\b(?!\s+NOT)/g) || []).length;
          const mustNotCount = (content.match(/\bMUST NOT\b/g) || []).length;
          const mayCount = (content.match(/\bMAY\b/g) || []).length;
          const wordCount = content.split(/\s+/).filter(Boolean).length;
          const filename = `${agent.agentId}-EXCEPTION_AUTHORITY.md`;

          // Upsert
          const existing = await db
            .select({ id: governanceFiles.id })
            .from(governanceFiles)
            .where(and(
              eq(governanceFiles.agentId, agent.agentId),
              eq(governanceFiles.companyId, companyId),
              eq(governanceFiles.fileType, "EXCEPTION_AUTHORITY"),
              eq(governanceFiles.isArchived, false)
            ))
            .limit(1);

          if (existing[0]) {
            // companyId=0 (platform baseline) always regenerated to keep source_clauses enriched.
            // Hotel-scope files (companyId>0) are skipped when regenerate=false.
            if (!regenerate && companyId !== 0) {
              logger.info({ agentId: agent.agentId, companyId }, "[seed-ea] Skipping existing (regenerate=false)");
            } else {
              await db.update(governanceFiles)
                .set({ content, mustCount, mustNotCount, mayCount, wordCount, updatedAt: new Date() })
                .where(eq(governanceFiles.id, existing[0].id));
            }
          } else {
            await db.insert(governanceFiles).values({
              companyId,
              filename,
              filepath: `company-${companyId}/${filename}`,
              fileType: "EXCEPTION_AUTHORITY",
              axis: "shared",
              agentId: agent.agentId,
              content,
              status: "approved",
              owner: "Compliance Officer",
              domain: agent.domain,
              nistControl: "AC-2",
              baseline: false,
              mustCount,
              mustNotCount,
              mayCount,
              wordCount,
            });
          }

          logger.info({ agentId: agent.agentId, companyId }, "[seed-ea] Generated OK");
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          job.errors.push({ agentId: agent.agentId, companyId, error: errMsg });
          logger.error({ agentId: agent.agentId, companyId, err: errMsg }, "[seed-ea] Generation failed");
        }
        job.completed++;
      }
    }
    job.done = true;
    logger.info({ jobId, completed: job.completed, errors: job.errors.length }, "[seed-ea] Job complete");
  })().catch(err => {
    logger.error({ jobId, err }, "[seed-ea] Unexpected job error");
    job.done = true;
  });
});

// ─── GET /api/admin/seed-exception-authority-files/:jobId ────────────────────

router.get("/admin/seed-exception-authority-files/:jobId", (req, res) => {
  const job = seedJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  return res.json({
    jobId: req.params.jobId,
    completed: job.completed,
    total: job.total,
    done: job.done,
    errors: job.errors,
  });
});

// ─── POST /api/admin/seed-value-events ───────────────────────────────────────
// Seeds realistic baseline AP2 value events for the ROI dashboard demo.
// Idempotent per company: skips if ≥ 50 events already exist.

const SEED_AGENTS: Array<{
  agentId: string; agentName: string;
  actions: Array<{ action: string; revenueDelta: number; costCents: number; outcome: string }>;
}> = [
  { agentId: "reservation-bot", agentName: "Reservation Bot", actions: [
    { action: "reservation_create", revenueDelta: 189, costCents: 4, outcome: "PASS" },
    { action: "reservation_create", revenueDelta: 254, costCents: 4, outcome: "PASS" },
    { action: "reservation_create", revenueDelta: 189, costCents: 4, outcome: "PASS" },
    { action: "reservation_create", revenueDelta: 378, costCents: 4, outcome: "PASS" },
    { action: "reservation_create", revenueDelta: 0, costCents: 4, outcome: "ESCALATE" },
    { action: "reservation_create", revenueDelta: 189, costCents: 4, outcome: "PASS" },
    { action: "reservation_create", revenueDelta: 126, costCents: 4, outcome: "PASS" },
    { action: "reservation_create", revenueDelta: 252, costCents: 4, outcome: "PASS" },
    { action: "reservation_retrieve", revenueDelta: 0, costCents: 4, outcome: "PASS" },
    { action: "reservation_retrieve", revenueDelta: 0, costCents: 4, outcome: "PASS" },
  ]},
  { agentId: "check-in-agent", agentName: "Check-In Agent", actions: [
    { action: "checkin_process", revenueDelta: 0, costCents: 4, outcome: "PASS" },
    { action: "checkin_process", revenueDelta: 0, costCents: 4, outcome: "PASS" },
    { action: "checkin_process", revenueDelta: 0, costCents: 4, outcome: "PASS" },
    { action: "checkin_process", revenueDelta: 0, costCents: 4, outcome: "ESCALATE" },
    { action: "checkin_process", revenueDelta: 0, costCents: 4, outcome: "PASS" },
    { action: "checkin_process", revenueDelta: 0, costCents: 4, outcome: "PASS" },
    { action: "checkin_process", revenueDelta: 0, costCents: 4, outcome: "PASS" },
    { action: "checkin_process", revenueDelta: 0, costCents: 4, outcome: "PASS" },
  ]},
  { agentId: "folio-charge-agent", agentName: "Folio Charge Agent", actions: [
    { action: "folio_charge", revenueDelta: 89, costCents: 4, outcome: "PASS" },
    { action: "folio_charge", revenueDelta: 45, costCents: 4, outcome: "PASS" },
    { action: "folio_charge", revenueDelta: 0, costCents: 4, outcome: "FAIL" },
    { action: "folio_charge", revenueDelta: 89, costCents: 4, outcome: "PASS" },
    { action: "folio_charge", revenueDelta: 125, costCents: 4, outcome: "PASS" },
    { action: "folio_charge", revenueDelta: 89, costCents: 4, outcome: "PASS" },
    { action: "folio_charge", revenueDelta: 0, costCents: 4, outcome: "ESCALATE" },
    { action: "folio_charge", revenueDelta: 89, costCents: 4, outcome: "PASS" },
  ]},
  { agentId: "checkout-agent", agentName: "Checkout Agent", actions: [
    { action: "checkout_process", revenueDelta: 0, costCents: 4, outcome: "PASS" },
    { action: "checkout_process", revenueDelta: 0, costCents: 4, outcome: "PASS" },
    { action: "checkout_process", revenueDelta: 0, costCents: 4, outcome: "PASS" },
    { action: "checkout_process", revenueDelta: 0, costCents: 4, outcome: "ESCALATE" },
    { action: "checkout_process", revenueDelta: 0, costCents: 4, outcome: "PASS" },
    { action: "checkout_process", revenueDelta: 0, costCents: 4, outcome: "PASS" },
    { action: "checkout_process", revenueDelta: 0, costCents: 4, outcome: "PASS" },
  ]},
  { agentId: "rate-agent", agentName: "Rate Agent", actions: [
    { action: "rate_override", revenueDelta: 0, costCents: 3, outcome: "PASS" },
    { action: "rate_override", revenueDelta: 0, costCents: 3, outcome: "PASS" },
    { action: "rate_override", revenueDelta: 0, costCents: 3, outcome: "FAIL" },
    { action: "rate_override", revenueDelta: 0, costCents: 3, outcome: "PASS" },
    { action: "rate_override", revenueDelta: 0, costCents: 3, outcome: "ESCALATE" },
    { action: "rate_override", revenueDelta: 0, costCents: 3, outcome: "PASS" },
  ]},
  { agentId: "availability-agent", agentName: "Availability Agent", actions: [
    { action: "availability_check", revenueDelta: 0, costCents: 2, outcome: "PASS" },
    { action: "availability_check", revenueDelta: 0, costCents: 2, outcome: "PASS" },
    { action: "availability_check", revenueDelta: 0, costCents: 2, outcome: "PASS" },
    { action: "availability_check", revenueDelta: 0, costCents: 2, outcome: "PASS" },
    { action: "availability_check", revenueDelta: 0, costCents: 2, outcome: "FAIL" },
    { action: "availability_check", revenueDelta: 0, costCents: 2, outcome: "PASS" },
    { action: "availability_check", revenueDelta: 0, costCents: 2, outcome: "PASS" },
  ]},
  { agentId: "folio-agent", agentName: "Folio Agent", actions: [
    { action: "folio_read", revenueDelta: 0, costCents: 2, outcome: "PASS" },
    { action: "folio_read", revenueDelta: 0, costCents: 2, outcome: "PASS" },
    { action: "folio_read", revenueDelta: 0, costCents: 2, outcome: "PASS" },
    { action: "folio_read", revenueDelta: 0, costCents: 2, outcome: "PASS" },
    { action: "folio_read", revenueDelta: 0, costCents: 2, outcome: "PASS" },
  ]},
  { agentId: "revenue-reconciliation-agent", agentName: "Revenue Reconciliation Agent", actions: [
    { action: "revenue_reconciliation", revenueDelta: 4872, costCents: 5, outcome: "PASS" },
    { action: "revenue_reconciliation", revenueDelta: 5104, costCents: 5, outcome: "PASS" },
    { action: "revenue_reconciliation", revenueDelta: 4690, costCents: 5, outcome: "PASS" },
    { action: "revenue_reconciliation", revenueDelta: 5380, costCents: 5, outcome: "PASS" },
    { action: "revenue_reconciliation", revenueDelta: 0, costCents: 5, outcome: "ESCALATE" },
    { action: "revenue_reconciliation", revenueDelta: 5210, costCents: 5, outcome: "PASS" },
    { action: "revenue_reconciliation", revenueDelta: 4950, costCents: 5, outcome: "PASS" },
  ]},
];

router.post("/admin/seed-value-events", async (req, res) => {
  try {
    const targetCompanyId = Number((req.body as { companyId?: number })?.companyId ?? 1);

    // Idempotent guard: skip if already seeded
    const [existing] = await db
      .select({ count: agentValueEvents.id })
      .from(agentValueEvents)
      .where(eq(agentValueEvents.companyId, targetCompanyId))
      .limit(1);
    const existingCount = await db
      .select()
      .from(agentValueEvents)
      .where(eq(agentValueEvents.companyId, targetCompanyId))
      .then(rows => rows.length);

    if (existingCount >= 50) {
      return res.json({ ok: true, skipped: true, existing: existingCount, message: "Already seeded — ≥50 events exist" });
    }

    const now = Date.now();
    const DAYS_30 = 30 * 24 * 3600 * 1000;
    const rows: Array<{
      agentId: string; companyId: number; propertyCode: string; action: string;
      revenueDelta: string; costCents: number; currency: string;
      decisionOutcome: string; witnessToken: null; governancePhase: string; createdAt: Date;
    }> = [];

    for (const agent of SEED_AGENTS) {
      agent.actions.forEach((ev, idx) => {
        const ageMs = Math.floor((idx / agent.actions.length) * DAYS_30 * 0.9);
        rows.push({
          agentId: agent.agentId,
          companyId: targetCompanyId,
          propertyCode: targetCompanyId === 1 ? "BER" : targetCompanyId === 2 ? "LND" : "MUC",
          action: ev.action,
          revenueDelta: String(ev.revenueDelta),
          costCents: ev.costCents,
          currency: "EUR",
          decisionOutcome: ev.outcome,
          witnessToken: null,
          governancePhase: "walk",
          createdAt: new Date(now - DAYS_30 + ageMs + Math.floor(Math.random() * 3600000)),
        });
      });
    }

    await db.insert(agentValueEvents).values(rows);
    logger.info({ companyId: targetCompanyId, count: rows.length }, "[seed-value-events] Seeded");
    return res.json({ ok: true, seeded: rows.length, companyId: targetCompanyId });
  } catch (err) {
    logger.error({ err }, "admin/seed-value-events error");
    return res.status(500).json({ error: err instanceof Error ? err.message : "Seed failed" });
  }
});

// ─── POST /api/admin/seed-mandates ───────────────────────────────────────────
// Issues AP2 Intent Mandates for all native VDA agents in all companies
// based on their current agent_phases phase. Idempotent: skips agents that
// already have an active (non-revoked, non-expired) mandate.

const VDA_NATIVE_AGENTS = [
  "rate-agent","availability-agent","reservation-bot","check-in-agent",
  "folio-agent","folio-charge-agent","checkout-agent","revenue-reconciliation-agent",
];

router.post("/admin/seed-mandates", async (req, res) => {
  try {
    const targetCompanyIds = req.body?.companyIds
      ? (req.body.companyIds as number[])
      : await db.select({ id: companies.id }).from(companies).then(rows => rows.map(r => r.id));

    const now = new Date();
    const issued: Array<{ agentId: string; companyId: number; phase: string; mandateId: string }> = [];
    const skipped: Array<{ agentId: string; companyId: number; reason: string }> = [];

    for (const companyId of targetCompanyIds) {
      // Check for existing active mandates
      const existing = await db
        .select({ agentId: agentMandates.agentId, validUntil: agentMandates.validUntil })
        .from(agentMandates)
        .where(and(eq(agentMandates.companyId, companyId), eq(agentMandates.revoked, false)));
      const activeAgents = new Set(
        existing.filter(m => new Date(m.validUntil) > now).map(m => m.agentId)
      );

      // Get phase for each agent at this company
      const phases = await db
        .select({ agentId: agentPhases.agentId, phase: agentPhases.phase })
        .from(agentPhases)
        .where(and(eq(agentPhases.companyId, companyId), inArray(agentPhases.agentId, VDA_NATIVE_AGENTS)));

      const phaseMap: Record<string, string> = {};
      for (const p of phases) phaseMap[p.agentId] = p.phase;

      for (const agentId of VDA_NATIVE_AGENTS) {
        if (activeAgents.has(agentId)) {
          skipped.push({ agentId, companyId, reason: "active mandate exists" });
          continue;
        }
        // Default to "walk" if no phase row yet (for demo purposes)
        const phase = phaseMap[agentId] ?? "walk";
        if (phase === "crawl") {
          // Crawl mandates have no standing authority — only issue if explicitly requested
          skipped.push({ agentId, companyId, reason: "crawl phase — no standing mandate" });
          continue;
        }
        try {
          const agentDid = `did:key:vda-${agentId}-${companyId}`;
          const mandate = await issueMandate({ agentId, companyId, agentDid, phase });
          issued.push({ agentId, companyId, phase, mandateId: mandate.mandateId });
        } catch (err) {
          skipped.push({ agentId, companyId, reason: err instanceof Error ? err.message : "issue failed" });
        }
      }
    }

    logger.info({ issued: issued.length, skipped: skipped.length }, "[seed-mandates] Mandates seeded");
    return res.json({ ok: true, issued: issued.length, skipped: skipped.length, details: issued });
  } catch (err) {
    logger.error({ err }, "admin/seed-mandates error");
    return res.status(500).json({ error: err instanceof Error ? err.message : "Seed failed" });
  }
});

// ─── POST /api/admin/ucp-test-offer ───────────────────────────────────────────
// Test-only helper: generates a properly signed UCP rate offer for E2E tests.
// Returns a ucpOffer with a valid serverToken so tests can exercise the full
// negotiate flow without needing a live LLM/Apaleo rate agent call.
router.post("/admin/ucp-test-offer", async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(404).json({ error: "Not found" });
  }
  try {
    const { propertyId = "MUC", companyId = 1, barRate = 150, requestedRate, ratePlanId = null } = req.body as {
      propertyId?: string;
      companyId?: number;
      barRate?: number;
      requestedRate?: number;
      ratePlanId?: string | null;
    };

    const effective = Number(requestedRate ?? barRate);
    const bar = Number(barRate);
    const discountPct = bar > 0 ? Math.round(((bar - effective) / bar) * 100) : 0;

    const offer = buildRateOffer({
      propertyId,
      companyId: Number(companyId),
      requestedRate: effective,
      barRate: bar,
      ratePlanId: ratePlanId ?? null,
      discountPct,
      mandateId: null,
    });

    return res.json({ offer: { ...offer, barRate: bar } });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to build test offer" });
  }
});

// ─── POST /api/admin/reset-demo ───────────────────────────────────────────────
// Wipes all transient demo state so the next user starts from a clean slate.
// Preserved: governance_files, governance_file_versions, companies, exception_baselines.
// Cleared:   onboarding_requests, witness_entries, agent_credentials, hitl_tokens,
//            a2a_tasks, activation_requests, agent_phases, agent_mandates, agent_value_events.
router.post("/admin/reset-demo", async (_req, res) => {
  try {
    await db.delete(witnessEntries);
    await db.delete(hitlTokens);
    await db.delete(agentMandates);
    await db.delete(agentCredentials);
    await db.delete(agentValueEvents);
    await db.delete(agentPhases);
    await db.delete(activationRequests);
    await db.delete(a2aTasks);
    await db.delete(onboardingRequests);
    logger.info("[reset-demo] All transient demo state cleared");
    res.json({ ok: true, message: "Demo reset — all agent progress cleared. Governance files preserved." });
  } catch (err) {
    logger.error({ err }, "admin/reset-demo error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Reset failed" });
  }
});

// ─── POST /api/admin/reset-stay-demo ──────────────────────────────────────────
// Return the A Hotel Berlin demo to a clean, working start state.
//
// WHAT THIS DOES NOT DO: it does not un-seal anything. The Witness chain is remote and
// append-only, and every record this demo ever sealed is still on it, still signed, still
// anchored. Sequence numbers are assigned by the Witness, not by us — so "resetting" by
// deleting local rows and re-sealing from zero is not even available: the next seal would
// come back as seq N+1 with no local predecessors, and /stay/verify would report BROKEN
// against evidence that is in fact intact. A false tamper alarm on a demo is worse than
// a demo that admits what it is.
//
// So this clears the CONSOLE'S VIEW — the local decision log, the pending queue, the
// bounds-based baselines — and then re-mirrors the full chain from the Witness so an
// offline verify still resolves from genesis. Nothing is destroyed; the trail is simply
// no longer being displayed. The alternative — a fresh chain per reset — needs a
// CHAIN_OPENED record that only the Witness operator can write, and a chain abandoned
// whenever it gets inconvenient is the shape of evidence laundering.
//
// PRESERVED: governance files, companies, agent phases, and the EXCEPTION_AUTHORITY rows
//            that define the Ambassador/MoD ceilings (those ARE the governance).
// CLEARED:   witness entries, HITL cards, value events, pending seals, and every
//            authority:"baseline" row — the demo starts with NO baselines set, so each
//            exception is decided on governance rather than on a prior authorisation.
router.post("/admin/reset-stay-demo", async (req, res) => {
  const companyId = Number(req.body?.company_id ?? req.body?.companyId ?? 1);
  if (!Number.isInteger(companyId) || companyId < 0) {
    res.status(400).json({ error: "company_id must be a non-negative integer" });
    return;
  }
  const propertyId = String(req.body?.property_id ?? req.body?.propertyId ?? "BER");

  try {
    const cleared: Record<string, number> = {};
    const count = (r: unknown): number => (r as { rowCount?: number })?.rowCount ?? 0;

    cleared.witness_entries = count(await db.delete(witnessEntries).where(eq(witnessEntries.companyId, companyId)));
    cleared.hitl_tokens = count(await db.delete(hitlTokens).where(eq(hitlTokens.companyId, companyId)));
    cleared.agent_value_events = count(await db.delete(agentValueEvents).where(eq(agentValueEvents.companyId, companyId)));
    cleared.seal_outbox = count(await db.delete(sealOutbox).where(eq(sealOutbox.companyId, companyId)));

    // Bounds-based baselines only. A governance ceiling and a baseline share this table;
    // authority:"baseline" + a non-null stage is what createStayBaseline writes, and it is
    // the only thing that may be removed here. Deleting the rest would delete the
    // authority model itself and the console would show no ceilings at all.
    cleared.stay_baselines = count(
      await db.delete(exceptionBaselines).where(
        and(
          eq(exceptionBaselines.agentId, "stay-agent"),
          eq(exceptionBaselines.companyId, companyId),
          eq(exceptionBaselines.authority, "baseline"),
          isNotNull(exceptionBaselines.stage),
        ),
      ),
    );

    // Re-mirror the chain so verification still resolves from genesis with zero calls out
    // after the local seal refs above were dropped. Best-effort: a demo reset must not fail
    // because the Witness is briefly unreachable, but say so rather than implying success.
    let chain: Record<string, unknown>;
    const { stayChainKey } = await import("../lib/witnessChain.js");
    const chainKey = stayChainKey(propertyId, companyId);
    try {
      const { backfillChain } = await import("../lib/witnessChainProof.js");
      const filled = await backfillChain(chainKey);
      chain = { chainKey, remirrored: filled.added.length, held: filled.alreadyHeld.length, ok: filled.ok, detail: filled.detail };
    } catch (err) {
      chain = { chainKey, ok: false, detail: `chain re-mirror skipped: ${err instanceof Error ? err.message : String(err)}` };
    }

    logger.info({ companyId, cleared, chain }, "[reset-stay-demo] demo view reset");
    res.json({
      ok: true,
      companyId,
      propertyId,
      cleared,
      chain,
      preserved: ["governance_files", "companies", "agent_phases", "exception_authority_ceilings"],
      note:
        "Console view reset. Nothing was un-sealed — the Witness chain is append-only and " +
        "still holds every prior record; it has been re-mirrored locally so verification " +
        "resolves from genesis.",
    });
  } catch (err) {
    logger.error({ err }, "admin/reset-stay-demo error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Reset failed" });
  }
});

export default router;
