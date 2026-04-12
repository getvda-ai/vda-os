/**
 * VDA-MD §6 — Framework Integrity Check
 *
 * A delayed setTimeout loop that fires 6 hours after startup, then repeats
 * every 6 hours. Two checks per run:
 *   (a) All active agent credentials have a governance hash that matches
 *       the current hash computed from the live governance files.
 *   (b) MUST NOT clause counts in active governance files are unchanged
 *       since the previous check (in-memory baseline, resets on restart).
 *
 * Each run emits a canonical FRAMEWORK_INTEGRITY witness entry:
 *   - event_type: "integrity_check_passed" when all checks pass
 *   - event_type: "integrity_check_failed" when any check fails
 *
 * Sub-events (governance_hash_drift, must_not_count_drift) are also written
 * for detailed traceability. Failures are non-blocking — the server continues.
 */

import { db, agentCredentials, governanceFiles } from "@workspace/db";
import { eq, and, isNotNull } from "drizzle-orm";
import { computeGovernanceHash } from "./agentCredentialIssuer.js";
import { writeGovernanceEvent } from "./writeGovernanceEvent.js";
import { logger } from "./logger.js";

const INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const PLATFORM_COMPANY_ID = 0;

// In-memory MUST NOT count baseline — initialised by first run, resets on restart
let mustNotBaseline: number | null = null;

// ─── Count MUST NOT clauses in all active governance file content ─────────────

async function countActiveMustNotClauses(): Promise<number> {
  const files = await db
    .select({ content: governanceFiles.content })
    .from(governanceFiles)
    .where(eq(governanceFiles.status, "active"));

  let total = 0;
  for (const f of files) {
    if (f.content) {
      const matches = f.content.match(/MUST NOT/g);
      total += matches ? matches.length : 0;
    }
  }
  return total;
}

// ─── Check (a): governance hash integrity for all active agent credentials ────
// Returns true if all checks passed, false if any failure was detected.

async function checkCredentialHashIntegrity(): Promise<boolean> {
  const creds = await db
    .select({
      agentId: agentCredentials.agentId,
      companyId: agentCredentials.companyId,
      governanceFileHash: agentCredentials.governanceFileHash,
    })
    .from(agentCredentials)
    .where(
      and(
        isNotNull(agentCredentials.governanceFileHash),
        eq(agentCredentials.revoked, false)
      )
    );

  let allPassed = true;

  for (const cred of creds) {
    if (!cred.agentId || cred.companyId === null || !cred.governanceFileHash) continue;

    try {
      const currentHash = await computeGovernanceHash(cred.companyId, cred.agentId);
      if (currentHash === null) continue; // no governance files for this agent/company

      if (currentHash !== cred.governanceFileHash) {
        allPassed = false;
        logger.warn(
          { agentId: cred.agentId, companyId: cred.companyId, storedHash: cred.governanceFileHash, currentHash },
          "[IntegrityCheck] Governance hash drift detected"
        );

        await writeGovernanceEvent({
          companyId: cred.companyId,
          agent: cred.agentId,
          eventCategory: "FRAMEWORK_INTEGRITY",
          decision: "FAIL",
          fileReferenced: "VDA-MD Governance Framework — Integrity Check",
          clauseApplied: "VDA-MD §6: Agent credential governance hash must match current governance file state",
          actionProposed: `Integrity alert: governance hash drift for agent ${cred.agentId}`,
          reasoning: `Stored credential hash ${cred.governanceFileHash} does not match current computed hash ${currentHash} — governance files may have been modified since credential was issued`,
          apaleoData: {
            event_type: "governance_hash_drift",
            agentId: cred.agentId,
            storedHash: cred.governanceFileHash,
            currentHash,
            checkedAt: new Date().toISOString(),
          },
          credentialVerified: false,
        });
      }
    } catch (err) {
      logger.warn({ err, agentId: cred.agentId, companyId: cred.companyId }, "[IntegrityCheck] Error checking credential hash");
    }
  }

  return allPassed;
}

// ─── Check (b): MUST NOT clause count drift ───────────────────────────────────
// Returns true if the count is stable (or this is the first run), false on drift.

async function checkMustNotCountDrift(): Promise<boolean> {
  const currentCount = await countActiveMustNotClauses();

  if (mustNotBaseline === null) {
    // First run — establish baseline only, no comparison
    mustNotBaseline = currentCount;
    logger.info({ mustNotBaseline: currentCount }, "[IntegrityCheck] MUST NOT baseline established");
    await writeGovernanceEvent({
      companyId: PLATFORM_COMPANY_ID,
      agent: "integrity-check",
      eventCategory: "FRAMEWORK_INTEGRITY",
      decision: "INFO",
      fileReferenced: "VDA-MD Governance Framework — Integrity Check",
      clauseApplied: "VDA-MD §6: MUST NOT clause baseline established for drift monitoring",
      actionProposed: "Baseline established — future checks will compare against this count",
      reasoning: `Initial MUST NOT clause count across all active governance files: ${currentCount}`,
      apaleoData: {
        event_type: "must_not_baseline_established",
        baselineCount: currentCount,
        establishedAt: new Date().toISOString(),
      },
    });
    return true; // baseline run is always considered "passed"
  }

  if (currentCount !== mustNotBaseline) {
    const drift = currentCount - mustNotBaseline;
    logger.warn({ baseline: mustNotBaseline, current: currentCount, drift }, "[IntegrityCheck] MUST NOT clause count drift detected");

    await writeGovernanceEvent({
      companyId: PLATFORM_COMPANY_ID,
      agent: "integrity-check",
      eventCategory: "FRAMEWORK_INTEGRITY",
      decision: "FAIL",
      fileReferenced: "VDA-MD Governance Framework — Integrity Check",
      clauseApplied: "VDA-MD §6: MUST NOT clause count must remain stable — drift indicates unauthorised governance file modification",
      actionProposed: `Integrity alert: MUST NOT clause count changed by ${drift > 0 ? "+" : ""}${drift}`,
      reasoning: `Previous count: ${mustNotBaseline}, current count: ${currentCount}. MUST NOT clause drift of ${drift} detected — active governance files may have been modified.`,
      apaleoData: {
        event_type: "must_not_count_drift",
        baselineCount: mustNotBaseline,
        currentCount,
        drift,
        checkedAt: new Date().toISOString(),
      },
    });

    // Update baseline to current so subsequent checks compare from here
    mustNotBaseline = currentCount;
    return false;
  }

  logger.debug({ count: currentCount }, "[IntegrityCheck] MUST NOT clause count stable");
  return true;
}

// ─── Full integrity check run ─────────────────────────────────────────────────

async function runIntegrityCheck(): Promise<void> {
  const checkedAt = new Date().toISOString();
  logger.info("[IntegrityCheck] Running governance framework integrity check");

  const hashCheckPassed = await checkCredentialHashIntegrity();
  const mustNotCheckPassed = await checkMustNotCountDrift();
  const allPassed = hashCheckPassed && mustNotCheckPassed;

  // Canonical per-run summary event
  await writeGovernanceEvent({
    companyId: PLATFORM_COMPANY_ID,
    agent: "integrity-check",
    eventCategory: "FRAMEWORK_INTEGRITY",
    decision: allPassed ? "PASS" : "FAIL",
    fileReferenced: "VDA-MD Governance Framework — Integrity Check",
    clauseApplied: "VDA-MD §6: Periodic governance framework integrity check",
    actionProposed: allPassed
      ? "No integrity issues detected — governance framework is consistent"
      : "Integrity issues detected — see sub-events for details",
    reasoning: allPassed
      ? "All credential hash checks passed and MUST NOT clause count is stable"
      : `Failures detected: hash_check=${hashCheckPassed ? "PASS" : "FAIL"}, must_not_check=${mustNotCheckPassed ? "PASS" : "FAIL"}`,
    apaleoData: {
      event_type: allPassed ? "integrity_check_passed" : "integrity_check_failed",
      hashCheckPassed,
      mustNotCheckPassed,
      checkedAt,
    },
  });

  logger.info({ allPassed }, "[IntegrityCheck] Governance framework integrity check complete");
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

let _started = false;

export function startGovernanceIntegrityCheck(): void {
  if (_started) return;
  _started = true;

  const schedule = () => {
    setTimeout(async () => {
      try {
        await runIntegrityCheck();
      } catch (err) {
        logger.error({ err }, "[IntegrityCheck] Unhandled error in integrity check");
      } finally {
        schedule(); // Reschedule after each run regardless of outcome
      }
    }, INTERVAL_MS);
  };

  schedule(); // First fire: 6 hours after startup
  logger.info({ intervalHours: 6 }, "[IntegrityCheck] Governance integrity check scheduled (first run in 6h)");
}
