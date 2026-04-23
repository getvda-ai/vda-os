/**
 * Admin routes:
 *   GET  /api/admin/onboarding-policy   — returns parsed onboarding-policy.md (60 s cache)
 *   POST /api/admin/seed-governance-files — idempotent seed for platform governance files
 *
 * Governance file content lives in src/governance/*.md (single-document YAML after front-matter).
 * No policy text is hardcoded in route code — all content is read from static files at seed time.
 */
import { Router, type IRouter } from "express";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { db, governanceFiles } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { getOnboardingPolicy } from "../lib/exceptionAuthorityReader.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

// ─── File reader helper ───────────────────────────────────────────────────────

// In the esbuild bundle (dist/index.mjs), import.meta.url resolves to the dist directory.
// Governance .md files are copied to dist/governance/ by build.mjs so this path works for both
// dev (via ts-node/tsx) and production (built bundle).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GOVERNANCE_DIR = path.join(__dirname, "governance");

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

export default router;
