import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Per-tenant credit wallet.
 * One row per company — updated atomically on each debit/credit operation.
 */
export const companyCredits = pgTable("company_credits", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().unique(),
  balance: integer("balance").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Append-only credit ledger.
 * Every debit (negative deltaCredits) and credit (positive) is recorded here.
 * The current balance lives in company_credits; this table provides the audit trail.
 */
export const creditLedger = pgTable("credit_ledger", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  /** Positive = credit (topup), negative = debit (governance call) */
  deltaCredits: integer("delta_credits").notNull(),
  /**
   * Operation type — maps to x402 rate card:
   *   governance_decision  = -1
   *   onboarding_phase     = -5
   *   hitl_resolution      = -10
   *   topup_stripe         = +N
   *   topup_admin          = +N
   *   initial_grant        = +N
   */
  operation: text("operation").notNull(),
  description: text("description"),
  /** Route, witness token, Stripe payment intent — caller-supplied reference */
  sourceRef: text("source_ref"),
  balanceAfter: integer("balance_after").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type CompanyCredits = typeof companyCredits.$inferSelect;
export type CreditLedgerEntry = typeof creditLedger.$inferSelect;
export type InsertCreditLedgerEntry = typeof creditLedger.$inferInsert;
