import { pgTable, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const a2aTasks = pgTable("a2a_tasks", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: text("session_id").notNull(),
  companyId: integer("company_id").notNull(),
  agentId: text("agent_id").notNull(),
  statusState: text("status_state").notNull().default("submitted"),
  inputMessage: jsonb("input_message").notNull(),
  outputArtifacts: jsonb("output_artifacts").notNull().default(sql`'[]'::jsonb`),
  errorMessage: text("error_message"),
  externalAgentDid: text("external_agent_did"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type A2ATask = typeof a2aTasks.$inferSelect;
export type InsertA2ATask = typeof a2aTasks.$inferInsert;
