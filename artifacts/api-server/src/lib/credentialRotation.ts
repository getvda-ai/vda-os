/**
 * credentialRotation.ts
 * Credential lifecycle management:
 * - Every hour: revoke expired credentials
 * - Every 23 hours: rotate platform issuer key + re-issue for ALL distinct
 *   (agentId, companyId) pairs found in governance_files table
 *   (not just pairs with existing DB credentials)
 *
 * Each rotation writes a Witness Agent entry: credential_rotation PASS/ESCALATE.
 */

import cron from "node-cron";
import { db, agentCredentials, governanceFiles } from "@workspace/db";
import { eq, and, lt, sql } from "drizzle-orm";
import { rotatePlatformIssuer, issueAgentCredential } from "./agentCredentialIssuer.js";
import { writeGovernanceEvent } from "./writeGovernanceEvent.js";
import { logger } from "./logger.js";

let _started = false;
let _rotationTimer: NodeJS.Timeout | null = null;

// ─── Revoke expired credentials ───────────────────────────────────────────────

async function revokeExpiredCredentials(): Promise<number> {
  const now = new Date();
  const result = await db
    .update(agentCredentials)
    .set({ revoked: true, revokedAt: now, revokedReason: "expired" })
    .where(
      and(
        eq(agentCredentials.revoked, false),
        lt(agentCredentials.expiresAt, now)
      )
    )
    .returning({ id: agentCredentials.id });
  logger.info({ count: result.length }, "[VC-Rotation] Expired credentials revoked");
  return result.length;
}

// ─── Get all distinct (agentId, companyId) pairs from governance_files ─────────

async function getAllGovernanceAgentPairs(): Promise<{ agentId: string; companyId: number }[]> {
  const rows = await db
    .selectDistinct({
      agentId: governanceFiles.agentId,
      companyId: governanceFiles.companyId,
    })
    .from(governanceFiles)
    .where(
      and(
        eq(governanceFiles.isArchived, false),
        eq(governanceFiles.fileType, "AGENTS"),
        sql`${governanceFiles.agentId} IS NOT NULL`
      )
    );

  return rows
    .filter((r) => r.agentId !== null && r.companyId !== null)
    .map((r) => ({ agentId: r.agentId as string, companyId: r.companyId as number }));
}

// ─── Write credential_rotation witness entry ──────────────────────────────────

async function writeRotationWitnessEntry(
  agentId: string,
  companyId: number,
  decision: "PASS" | "ESCALATE",
  reason: string
): Promise<void> {
  await writeGovernanceEvent({
    companyId,
    agent: agentId,
    eventCategory: "AGENT_LIFECYCLE",
    decision,
    fileReferenced: "VDA-MD Credential Rotation — 23h Schedule",
    clauseApplied: "VDA-MD §7: Agent Identity must be cryptographically verified and rotated on schedule",
    actionProposed: reason,
    reasoning: reason,
    apaleoData: { rotated_at: new Date().toISOString(), event_type: "credential_rotation" },
    credentialVerified: decision === "PASS",
  });
}

// ─── Full rotation cycle ──────────────────────────────────────────────────────

async function runRotationCycle(): Promise<void> {
  logger.info("[VC-Rotation] 23h rotation cycle starting");

  try {
    // 1. Rotate platform issuer key
    await rotatePlatformIssuer();

    // 2. Revoke expired
    await revokeExpiredCredentials();

    // 3. Find all distinct (agentId, companyId) pairs with governance files
    const pairs = await getAllGovernanceAgentPairs();
    logger.info({ count: pairs.length }, "[VC-Rotation] Re-issuing credentials for governance pairs");

    let passCount = 0;
    let escalateCount = 0;

    for (const { agentId, companyId } of pairs) {
      try {
        await issueAgentCredential({ agentId, companyId, ttlHours: 24 });
        await writeRotationWitnessEntry(
          agentId,
          companyId,
          "PASS",
          `Credential rotated successfully. New 24h VC issued with updated governance hash.`
        );
        passCount++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err, agentId, companyId }, "[VC-Rotation] Failed to re-issue credential");
        await writeRotationWitnessEntry(
          agentId,
          companyId,
          "ESCALATE",
          `Credential rotation failed: ${msg}. Manual intervention required.`
        );
        escalateCount++;
      }
    }

    logger.info({ passCount, escalateCount }, "[VC-Rotation] 23h rotation cycle complete");
  } catch (err) {
    logger.error({ err }, "[VC-Rotation] Rotation cycle failed critically");
  }
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

export function startCredentialRotationScheduler(): void {
  if (_started) return;
  _started = true;

  // Hourly: clean up expired credentials
  cron.schedule("0 * * * *", async () => {
    try {
      await revokeExpiredCredentials();
    } catch (err) {
      logger.error({ err }, "[VC-Rotation] Hourly cleanup failed");
    }
  });

  // Every 23 hours (using setTimeout loop — more reliable than cron for non-24h intervals)
  const scheduleNextRotation = (): void => {
    _rotationTimer = setTimeout(async () => {
      await runRotationCycle();
      scheduleNextRotation();
    }, 23 * 60 * 60 * 1000);
  };
  scheduleNextRotation();

  logger.info("[VC-Rotation] Credential rotation scheduler started (23h rotation cycle, hourly cleanup)");
}
