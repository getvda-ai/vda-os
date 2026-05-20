/**
 * Credit Manager — x402 billing wallet operations.
 *
 * Each non-exempt tenant has a credit wallet (company_credits table).
 * Every governance call deducts credits according to the rate card.
 * Credits can be topped up via POST /api/billing/topup.
 *
 * Rate card:
 *   governance_decision  = 1 credit  (per agent call: availability, rate, compliance…)
 *   onboarding_phase     = 5 credits (per onboarding pipeline phase)
 *   hitl_resolution      = 10 credits (per HITL escalation resolved)
 */

import { db, companies, companyCredits, creditLedger } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger.js";

// ─── Rate Card ────────────────────────────────────────────────────────────────

export type CreditOperation =
  | "governance_decision"
  | "onboarding_phase"
  | "hitl_resolution"
  | "topup_stripe"
  | "topup_admin"
  | "initial_grant";

export const RATE_CARD: Record<string, number> = {
  governance_decision: 1,
  onboarding_phase: 5,
  hitl_resolution: 10,
};

// ─── Wallet Operations ────────────────────────────────────────────────────────

/**
 * Returns true if the company is x402 exempt (e.g. the primary citizenM tenant).
 * Caches result in memory for 60 seconds to avoid a DB round-trip on every request.
 */
const exemptCache = new Map<number, { value: boolean; expiresAt: number }>();

export async function isX402Exempt(companyId: number): Promise<boolean> {
  const cached = exemptCache.get(companyId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const [row] = await db
    .select({ x402Exempt: companies.x402Exempt })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);

  const value = row?.x402Exempt ?? false;
  exemptCache.set(companyId, { value, expiresAt: Date.now() + 60_000 });
  return value;
}

/** Clears the exempt cache for a company (call after updating x402Exempt flag). */
export function clearExemptCache(companyId: number): void {
  exemptCache.delete(companyId);
}

/**
 * Returns the current credit balance for a company.
 * Returns 0 if no wallet row exists yet.
 */
export async function getBalance(companyId: number): Promise<number> {
  const [row] = await db
    .select({ balance: companyCredits.balance })
    .from(companyCredits)
    .where(eq(companyCredits.companyId, companyId))
    .limit(1);
  return row?.balance ?? 0;
}

/**
 * Ensures a credit wallet row exists for the company (idempotent upsert).
 * Returns the current balance.
 */
export async function ensureWallet(companyId: number): Promise<number> {
  await db
    .insert(companyCredits)
    .values({ companyId, balance: 0 })
    .onConflictDoNothing({ target: companyCredits.companyId });
  return getBalance(companyId);
}

/**
 * Deducts `amount` credits from the company's wallet.
 * Returns { ok: true } if deducted successfully, or { ok: false, balance } if insufficient.
 * Uses a single UPDATE … WHERE balance >= amount to prevent races.
 */
export async function deductCredits(
  companyId: number,
  amount: number,
  operation: CreditOperation,
  description: string,
  sourceRef?: string
): Promise<{ ok: boolean; balance: number }> {
  await ensureWallet(companyId);

  const updated = await db
    .update(companyCredits)
    .set({
      balance: sql`${companyCredits.balance} - ${amount}`,
      updatedAt: sql`NOW()`,
    })
    .where(
      sql`${companyCredits.companyId} = ${companyId} AND ${companyCredits.balance} >= ${amount}`
    )
    .returning({ balance: companyCredits.balance });

  if (updated.length === 0) {
    const balance = await getBalance(companyId);
    logger.info({ companyId, amount, operation, balance }, "[x402] Insufficient credits");
    return { ok: false, balance };
  }

  const balanceAfter = updated[0].balance;

  await db.insert(creditLedger).values({
    companyId,
    deltaCredits: -amount,
    operation,
    description,
    sourceRef: sourceRef ?? null,
    balanceAfter,
  });

  logger.info({ companyId, amount, operation, balanceAfter }, "[x402] Credits deducted");
  return { ok: true, balance: balanceAfter };
}

/**
 * Adds `amount` credits to the company's wallet.
 * Initialises the wallet if it doesn't exist yet.
 */
export async function addCredits(
  companyId: number,
  amount: number,
  operation: "topup_stripe" | "topup_admin" | "initial_grant",
  description: string,
  sourceRef?: string
): Promise<number> {
  await db
    .insert(companyCredits)
    .values({ companyId, balance: amount })
    .onConflictDoUpdate({
      target: companyCredits.companyId,
      set: {
        balance: sql`${companyCredits.balance} + ${amount}`,
        updatedAt: sql`NOW()`,
      },
    });

  const balanceAfter = await getBalance(companyId);

  await db.insert(creditLedger).values({
    companyId,
    deltaCredits: amount,
    operation,
    description,
    sourceRef: sourceRef ?? null,
    balanceAfter,
  });

  logger.info({ companyId, amount, operation, balanceAfter }, "[x402] Credits added");
  clearExemptCache(companyId);
  return balanceAfter;
}

/**
 * Fetches recent ledger entries for a company (newest first).
 */
export async function getLedger(companyId: number, limit = 50) {
  return db
    .select()
    .from(creditLedger)
    .where(eq(creditLedger.companyId, companyId))
    .orderBy(sql`${creditLedger.createdAt} DESC`)
    .limit(limit);
}
