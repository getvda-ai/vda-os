import { pgTable, text, integer, timestamp, numeric, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const agentPhases = pgTable("agent_phases", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: integer("company_id").notNull(),
  agentId: text("agent_id").notNull(),
  phase: text("phase").notNull().default("not_activated"),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  phaseChangedAt: timestamp("phase_changed_at", { withTimezone: true }).defaultNow().notNull(),
  agreementRate: numeric("agreement_rate"),
  overrideRate: numeric("override_rate"),
  notes: text("notes"),
  roleBandPhases: jsonb("role_band_phases"),
});

export type AgentPhase = typeof agentPhases.$inferSelect;
export type InsertAgentPhase = typeof agentPhases.$inferInsert;
