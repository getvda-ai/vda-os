/**
 * One-time idempotent backfill: populate role_band on hitl_tokens from
 * payload->>'escalation_target' using the canonical VDA-MD mapping table.
 * Safe to run on every startup — only touches rows where role_band IS NULL.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

const ESCALATION_MAP: Record<string, string> = {
  "Revenue Manager":      "hotel_gm",
  "Operations Director":  "hotel_gm",
  "Credit Control team":  "hotel_gm",
  "VP Revenue":           "regional_gm",
  "CFO":                  "regional_gm",
  "CISO":                 "operations_chief",
  "first_hitl_approval":  "compliance_officer",
  "second_hitl_approval": "compliance_officer",
};

export async function backfillRoleBand(): Promise<void> {
  try {
    // Check if any unbackfilled rows exist before doing anything
    const check = await db.execute(
      sql`SELECT COUNT(*) as cnt FROM hitl_tokens WHERE role_band IS NULL`
    );
    const cnt = Number((check.rows[0] as { cnt: string }).cnt);
    if (cnt === 0) {
      logger.info("[RoleBandBackfill] No unbackfilled rows, skipping");
      return;
    }

    logger.info({ cnt }, "[RoleBandBackfill] Backfilling role_band for rows with NULL value");

    // Build a CASE expression from the mapping table
    const caseExpression = Object.entries(ESCALATION_MAP)
      .map(([target, band]) => `WHEN payload->>'escalation_target' = '${target.replace(/'/g, "''")}' THEN '${band}'`)
      .join("\n      ");

    await db.execute(sql`
      UPDATE hitl_tokens
      SET role_band = CASE
        ${sql.raw(caseExpression)}
        ELSE NULL
      END
      WHERE role_band IS NULL
    `);

    // Log any unrecognised escalation targets as a warning
    const unrecognised = await db.execute(sql`
      SELECT DISTINCT payload->>'escalation_target' as target
      FROM hitl_tokens
      WHERE role_band IS NULL
        AND payload->>'escalation_target' IS NOT NULL
    `);
    if (unrecognised.rows.length > 0) {
      logger.warn(
        { unrecognised: unrecognised.rows.map((r: any) => r.target) },
        "[RoleBandBackfill] Unrecognised escalation_target values — left as NULL"
      );
    }

    const verify = await db.execute(
      sql`SELECT role_band, COUNT(*) as cnt FROM hitl_tokens GROUP BY role_band ORDER BY cnt DESC`
    );
    logger.info({ distribution: verify.rows }, "[RoleBandBackfill] Backfill complete");
  } catch (err) {
    logger.warn({ err }, "[RoleBandBackfill] Backfill failed (non-fatal)");
  }
}
