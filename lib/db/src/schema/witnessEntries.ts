import { pgTable, serial, text, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";

export const witnessEntries = pgTable("witness_entries", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  agent: text("agent").notNull(),
  decision: text("decision").notNull(),
  fileReferenced: text("file_referenced"),
  clauseApplied: text("clause_applied"),
  actionProposed: text("action_proposed"),
  exceptionApplied: boolean("exception_applied").default(false),
  escalationTarget: text("escalation_target"),
  reasoning: text("reasoning"),
  apaleoData: jsonb("apaleo_data"),
  scenarioRunId: text("scenario_run_id"),
  filesConsulted: text("files_consulted").array(),
  crossDomainInheritance: boolean("cross_domain_inheritance").default(false),
  credentialVerified: boolean("credential_verified").default(false),
  governanceFileHash: text("governance_file_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type WitnessEntry = typeof witnessEntries.$inferSelect;
export type InsertWitnessEntry = typeof witnessEntries.$inferInsert;
