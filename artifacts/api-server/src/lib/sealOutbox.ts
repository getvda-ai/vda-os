/**
 * sealOutbox.ts — durable, fail-open, off-critical-path sealing to VDA Witness.
 *
 * A governed decision does NOT wait on Witness. It enqueues a PII-minimized seal
 * row (a fast local write) and returns; a background drain seals it with bounded
 * retry. Witness down → the hotel op still completed, the seal lands later from
 * the outbox, nothing is lost, and exhausted rows go to a visible dead-letter.
 *
 * Idempotency: the outbox is UNIQUE on (companyId, decisionId) and Witness itself
 * dedups on (account, decisionId) — replaying a decision never double-seals.
 *
 * GDPR: minimizeInputs() is the ONLY thing that shapes what gets sealed. Witness
 * records are immutable + externally anchored → un-erasable, so we seal ONLY
 * pseudonymous ids + decision facts. Raw guest PII stays in the operational DB.
 */
import { createHash } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { db, sealOutbox, witnessEntries } from "@workspace/db";
import { sealRecord, verifyOffline, isWitnessEnabled, type SealBody } from "./witnessClient.js";
import { logger } from "./logger.js";

const MAX_ATTEMPTS = 6;

/** Stable, non-reversible pseudonym for a guest/reservation identifier. */
export function pseudonymize(value: unknown, ns = "res"): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return `${ns}:${createHash("sha256").update(String(value)).digest("hex").slice(0, 16)}`;
}

// Keys that carry raw PII and must NEVER reach a seal.
const PII_KEYS = /name|email|phone|guest|first|last|passport|document|dob|birth|address|street|card|iban|note|comment|free.?text/i;

/**
 * Reduce raw engine decision facts to a PII-free, seal-safe input object.
 * Reservation/guest ids are pseudonymized; anything PII-shaped is dropped.
 */
export function minimizeInputs(raw: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {
    reservation_ref: pseudonymize(raw.reservationId ?? raw.reservation_id ?? raw.bookingId),
    folio_id: raw.folioId ?? raw.folio_id,
    property: raw.propertyId ?? raw.property,
    unit_group: raw.unitGroup ?? raw.unit_group,
    stage: raw.stage ?? raw.phase,
    exception_class: raw.exception_class ?? raw.class,
    amount: raw.amount,
    currency: raw.currency,
    nights: raw.nights,
    governance_source: raw.governance_source ?? raw.governanceRef,
    role_band: raw.role_band,
    apaleo_charge_id: raw.apaleo_charge_id ?? raw.chargeId,
    outcome: raw.outcome ?? raw.verdict,
  };
  // Belt-and-braces: strip undefined + any accidentally-PII-shaped keys/values.
  for (const k of Object.keys(out)) {
    if (out[k] === undefined || PII_KEYS.test(k)) delete out[k];
  }
  return out;
}

export interface EnqueueArgs {
  companyId: number;
  chainKey: string;
  decisionId: string;
  decision: SealBody["decision"];
  governingRule: SealBody["governingRule"];
  localWitnessId?: number | null;
}

/** Idempotent enqueue (never throws — enqueue must not break the hotel op). */
export async function enqueueSeal(args: EnqueueArgs): Promise<void> {
  try {
    await db
      .insert(sealOutbox)
      .values({
        companyId: args.companyId,
        chainKey: args.chainKey,
        decisionId: args.decisionId,
        payload: { decision: args.decision, governingRule: args.governingRule },
        localWitnessId: args.localWitnessId ?? null,
        status: "pending",
      })
      .onConflictDoNothing({ target: [sealOutbox.companyId, sealOutbox.decisionId] });
    if (args.localWitnessId) {
      await db.update(witnessEntries).set({ witnessState: "pending" }).where(eq(witnessEntries.id, args.localWitnessId));
    }
  } catch (err) {
    // Even the enqueue is best-effort: a governed op must never fail on sealing.
    logger.warn({ err, decisionId: args.decisionId }, "[outbox] enqueue failed (op unaffected)");
  }
}

export interface DrainResult { processed: number; sealed: number; failed: number; dead: number }

/** Drain pending rows to Witness. Safe to call from a cron, a request, or a test. */
export async function drainSealOutbox(limit = 25): Promise<DrainResult> {
  if (!isWitnessEnabled()) return { processed: 0, sealed: 0, failed: 0, dead: 0 };
  const rows = await db
    .select()
    .from(sealOutbox)
    .where(and(eq(sealOutbox.status, "pending"), lt(sealOutbox.attempts, MAX_ATTEMPTS)))
    .orderBy(sealOutbox.id)
    .limit(limit);

  let sealed = 0, failed = 0, dead = 0;
  for (const row of rows) {
    const payload = row.payload as { decision: SealBody["decision"]; governingRule: SealBody["governingRule"] };
    const res = await sealRecord({
      decision: payload.decision,
      governingRule: payload.governingRule,
      chainKey: row.chainKey,
      decisionId: row.decisionId,
    });

    if (res.ok && res.record) {
      const rec = res.record;
      const ref = {
        recordId: rec.recordId ?? rec.id,
        seq: rec.seq,
        chainKey: row.chainKey,
        decisionId: row.decisionId,
        record: rec,
      };
      let state = "SIGNED_PENDING";
      try { const v = await verifyOffline(rec, [rec]); state = (v as { state?: string }).state ?? state; } catch { /* verify is advisory */ }
      await db.update(sealOutbox).set({ status: "sealed", recordRef: ref, sealedAt: new Date(), lastError: null }).where(eq(sealOutbox.id, row.id));
      if (row.localWitnessId) {
        await db.update(witnessEntries).set({ witnessSealRef: ref, witnessState: state }).where(eq(witnessEntries.id, row.localWitnessId));
      }
      sealed++;
    } else {
      const attempts = row.attempts + 1;
      const isDead = attempts >= MAX_ATTEMPTS;
      await db.update(sealOutbox).set({ attempts, lastError: res.error ?? "unknown", status: isDead ? "dead" : "pending" }).where(eq(sealOutbox.id, row.id));
      if (row.localWitnessId && isDead) {
        await db.update(witnessEntries).set({ witnessState: "unsealed" }).where(eq(witnessEntries.id, row.localWitnessId));
      }
      if (isDead) dead++; else failed++;
    }
  }
  return { processed: rows.length, sealed, failed, dead };
}

/** Outbox status counts (for the Witness tab + health checks). */
export async function outboxHealth(companyId?: number): Promise<Record<string, number>> {
  const rows = await db
    .select({ status: sealOutbox.status, n: sql<number>`count(*)::int` })
    .from(sealOutbox)
    .where(companyId ? eq(sealOutbox.companyId, companyId) : sql`true`)
    .groupBy(sealOutbox.status);
  const out: Record<string, number> = { pending: 0, sealed: 0, dead: 0 };
  for (const r of rows) out[r.status] = r.n;
  return out;
}
