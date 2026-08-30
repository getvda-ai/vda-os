/**
 * seedStayAgent.ts
 * Seeds the Stay Agent's four governance files (AGENTS, SOP, SKILL,
 * EXCEPTION_AUTHORITY) from src/governance/stay-agent.*.md into the
 * governance_files table for a given company. Idempotent (upsert by
 * company+agent+fileType). No hardcoded policy — the files are the law.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, governanceFiles } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Bundled (dist/index.mjs): __dirname = dist/ → governance colocated at dist/governance.
// Dev/tsx (src/lib/seedStayAgent.ts): __dirname = src/lib/ → governance at ../governance.
const _govColocated = path.join(__dirname, "governance");
const _govSibling = path.join(__dirname, "../governance");
const GOVERNANCE_DIR = existsSync(_govColocated) ? _govColocated : _govSibling;

const STAY_AGENT_ID = "stay-agent";

interface StayFileDef {
  fileType: "AGENTS" | "SOP" | "SKILL" | "EXCEPTION_AUTHORITY";
  filename: string;
}

const STAY_FILES: StayFileDef[] = [
  { fileType: "AGENTS", filename: "stay-agent.AGENTS.md" },
  { fileType: "SOP", filename: "stay-agent.SOP.md" },
  { fileType: "SKILL", filename: "stay-agent.SKILL.md" },
  { fileType: "EXCEPTION_AUTHORITY", filename: "stay-agent.EXCEPTION_AUTHORITY.md" },
];

function readGovernanceFile(filename: string): string {
  return readFileSync(path.join(GOVERNANCE_DIR, filename), "utf-8");
}

/**
 * Seed the four Stay Agent governance files into governance_files for `companyId`.
 * companyId=0 is the platform baseline; per-company seeding binds the demo tenant.
 */
export async function seedStayAgentGovernance(companyId: number): Promise<string[]> {
  const seeded: string[] = [];

  for (const def of STAY_FILES) {
    let content: string;
    try {
      content = readGovernanceFile(def.filename);
    } catch (readErr) {
      logger.error({ readErr, filename: def.filename }, "[seedStayAgent] Failed to read governance file — skipping");
      continue;
    }

    const existing = await db
      .select({ id: governanceFiles.id })
      .from(governanceFiles)
      .where(
        and(
          eq(governanceFiles.agentId, STAY_AGENT_ID),
          eq(governanceFiles.companyId, companyId),
          eq(governanceFiles.fileType, def.fileType),
          eq(governanceFiles.isArchived, false),
        ),
      )
      .limit(1);

    const wordCount = content.split(/\s+/).filter(Boolean).length;

    if (!existing[0]) {
      await db.insert(governanceFiles).values({
        companyId,
        filename: def.filename,
        filepath: `governance/${def.filename}`,
        fileType: def.fileType,
        axis: "vertical",
        stage: "stay",
        journeyStage: "Stay",
        agentId: STAY_AGENT_ID,
        content,
        status: "approved",
        owner: "Manager on Duty",
        domain: "Operations",
        nistControl: "AC-2",
        baseline: true,
        mustCount: (content.match(/\bMUST\b(?!\s+NOT)/g) || []).length,
        mustNotCount: (content.match(/\bMUST NOT\b/g) || []).length,
        mayCount: (content.match(/\bMAY\b/g) || []).length,
        wordCount,
      });
      seeded.push(`${def.filename}@${companyId}`);
      logger.info({ companyId, fileType: def.fileType }, "[seedStayAgent] Seeded governance file");
    } else {
      await db
        .update(governanceFiles)
        .set({ content, wordCount })
        .where(eq(governanceFiles.id, existing[0].id));
      seeded.push(`${def.filename}@${companyId} (updated)`);
      logger.info({ companyId, fileType: def.fileType }, "[seedStayAgent] Updated governance file");
    }
  }

  return seeded;
}
