import { pgTable, serial, text, integer, boolean, timestamp, jsonb, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * AP2 Intent Mandates
 * Cryptographically-signed spending authority grants, issued at agent onboarding
 * completion and re-issued at each phase promotion (Crawl → Walk → Run).
 * Replaces the runtime EXCEPTION_AUTHORITY.md ceiling parse with a
 * verifiable, tamper-evident authority object.
 */
export const agentMandates = pgTable("agent_mandates", {
  id: serial("id").primaryKey(),
  mandateId: text("mandate_id").notNull().unique(),
  agentId: text("agent_id").notNull(),
  companyId: integer("company_id").notNull(),
  agentDid: text("agent_did").notNull(),
  issuerDid: text("issuer_did").notNull(),
  phase: varchar("phase", { length: 20 }).notNull().default("crawl"),
  authorizations: jsonb("authorizations").notNull().$type<MandateAuthorization[]>(),
  linkedGovernanceHash: text("linked_governance_hash"),
  signature: text("signature").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).defaultNow().notNull(),
  validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
  revoked: boolean("revoked").notNull().default(false),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedReason: text("revoked_reason"),
  onboardingId: text("onboarding_id"),
});

export interface MandateAuthorization {
  action: string;
  ceiling: number | null;
  currency?: string;
  unit?: string;
  description?: string;
}

// Phase → authorization ceilings mapping
// Crawl: no standing authority (all actions require HITL pre-approval)
// Walk: Tier 1 — limited autonomous authority
// Run: Tier 1+2 — extended autonomous authority
export const PHASE_AUTHORIZATION_TIERS: Record<string, MandateAuthorization[]> = {
  crawl: [],  // No standing mandate — every action escalates to HITL
  walk: [
    { action: "discount", ceiling: 10, unit: "percent", description: "Maximum discount rate (%) agent may apply autonomously" },
    { action: "refund", ceiling: 150, currency: "EUR", description: "Maximum refund amount agent may process autonomously" },
    { action: "folio_charge", ceiling: 500, currency: "EUR", description: "Maximum single folio charge agent may post autonomously" },
    { action: "late_checkout_fee_waiver", ceiling: 50, currency: "EUR", description: "Maximum late checkout fee agent may waive autonomously" },
  ],
  run: [
    { action: "discount", ceiling: 25, unit: "percent", description: "Maximum discount rate (%) agent may apply autonomously" },
    { action: "refund", ceiling: 500, currency: "EUR", description: "Maximum refund amount agent may process autonomously" },
    { action: "folio_charge", ceiling: 2000, currency: "EUR", description: "Maximum single folio charge agent may post autonomously" },
    { action: "late_checkout_fee_waiver", ceiling: 150, currency: "EUR", description: "Maximum late checkout fee agent may waive autonomously" },
    { action: "rate_override", ceiling: 20, unit: "percent", description: "Maximum rate override percentage agent may apply autonomously" },
  ],
};

export type AgentMandate = typeof agentMandates.$inferSelect;
export type InsertAgentMandate = typeof agentMandates.$inferInsert;
