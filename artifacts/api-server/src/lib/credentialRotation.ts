/**
 * credentialRotation.ts
 * Cron scheduler that rotates the platform issuer key every 24 hours
 * and re-issues credentials for all active agents.
 *
 * Runs on startup after DB is ready. Safe to call multiple times.
 */

import cron from "node-cron";
import { db, agentCredentials, companies } from "@workspace/db";
import { eq, and, lt } from "drizzle-orm";
import { rotatePlatformIssuer, issueAgentCredential } from "./agentCredentialIssuer.js";
import { logger } from "./logger.js";

let _started = false;

/**
 * Revoke credentials that have passed their expiresAt timestamp.
 */
async function revokeExpiredCredentials(): Promise<void> {
  const now = new Date();
  const result = await db
    .update(agentCredentials)
    .set({ revoked: true, revokedAt: now, revokedReason: "expired" })
    .where(
      and(
        eq(agentCredentials.revoked, false),
        lt(agentCredentials.expiresAt, now)
      )
    );
  void result;
  logger.info("[VC-Rotation] Expired credentials revoked");
}

/**
 * Re-issue credentials for all active agents across all companies.
 * Called after platform issuer rotation so all VCs carry the new issuer DID.
 */
async function reissueAllAgentCredentials(): Promise<void> {
  // Find all unique (agentId, companyId) pairs that have non-revoked credentials
  const active = await db
    .selectDistinct({
      agentId: agentCredentials.agentId,
      companyId: agentCredentials.companyId,
    })
    .from(agentCredentials)
    .where(eq(agentCredentials.revoked, false));

  logger.info({ count: active.length }, "[VC-Rotation] Re-issuing credentials");

  for (const { agentId, companyId } of active) {
    try {
      await issueAgentCredential({ agentId, companyId, ttlHours: 24 });
    } catch (err) {
      logger.error({ err, agentId, companyId }, "[VC-Rotation] Failed to re-issue credential");
    }
  }
}

/**
 * Start the credential rotation scheduler.
 * - Every hour: revoke expired credentials.
 * - Every 24 hours (at midnight UTC): rotate platform issuer key + re-issue all.
 */
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

  // Daily midnight UTC: rotate issuer key + re-issue
  cron.schedule("0 0 * * *", async () => {
    try {
      logger.info("[VC-Rotation] Daily rotation starting");
      await rotatePlatformIssuer();
      await revokeExpiredCredentials();
      await reissueAllAgentCredentials();
      logger.info("[VC-Rotation] Daily rotation complete");
    } catch (err) {
      logger.error({ err }, "[VC-Rotation] Daily rotation failed");
    }
  });

  logger.info("[VC-Rotation] Credential rotation scheduler started");
}
