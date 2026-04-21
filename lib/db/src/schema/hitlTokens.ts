import { pgTable, text, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const hitlTokens = pgTable("hitl_tokens", {
  token: text("token").primaryKey().default(sql`gen_random_uuid()`),
  onboardingRequestId: text("onboarding_request_id"),
  phase: integer("phase").notNull().default(0),
  cardType: text("card_type").notNull().default("approval"),
  payload: jsonb("payload").notNull(),
  outcome: text("outcome"),
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  agentId: text("agent_id"),
  companyId: integer("company_id"),
  witnessEntryId: text("witness_entry_id"),
  context: jsonb("context"),
  roleBand: text("role_band"),
});

export type HitlToken = typeof hitlTokens.$inferSelect;
export type InsertHitlToken = typeof hitlTokens.$inferInsert;
