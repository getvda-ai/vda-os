import { pgTable, serial, text, integer, numeric, timestamp, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Agent Value Ledger — AP2 economic metering
 * Records the revenue impact and governance cost of every agent PASS decision.
 * Enables per-agent, per-property ROI calculation.
 */
export const agentValueEvents = pgTable("agent_value_events", {
  id: serial("id").primaryKey(),
  agentId: text("agent_id").notNull(),
  companyId: integer("company_id").notNull(),
  propertyCode: varchar("property_code", { length: 10 }),
  action: text("action").notNull(),
  revenueDelta: numeric("revenue_delta", { precision: 12, scale: 2 }).notNull().default("0"),
  costCents: integer("cost_cents").notNull().default(0),
  currency: varchar("currency", { length: 3 }).notNull().default("EUR"),
  decisionOutcome: varchar("decision_outcome", { length: 20 }).notNull().default("PASS"),
  witnessToken: text("witness_token"),
  governancePhase: varchar("governance_phase", { length: 20 }),
  sourceData: text("source_data"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type AgentValueEvent = typeof agentValueEvents.$inferSelect;
export type InsertAgentValueEvent = typeof agentValueEvents.$inferInsert;
