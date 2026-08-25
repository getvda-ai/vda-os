import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

/**
 * sop_documents — an ingested Standard Operating Procedure document.
 * SOPs are the BUSINESS source of truth the Stay Agent consults per stage; they
 * are split into heading-anchored clauses (see sop_clauses). Stage is inferred
 * from front-matter (`stage: check_in`) or filename, defaulting to `global`.
 */
export const sopDocuments = pgTable("sop_documents", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  agentId: text("agent_id").notNull().default("stay-agent"),
  // check_in | in_stay | check_out | global
  stage: text("stage").notNull().default("global"),
  filename: text("filename").notNull(),
  title: text("title").notNull(),
  version: text("version").notNull().default("1.0"),
  // md | pdf | docx | txt | upload | folder
  sourceType: text("source_type").notNull().default("md"),
  clauseCount: integer("clause_count").notNull().default(0),
  ingestedAt: timestamp("ingested_at", { withTimezone: true }).defaultNow().notNull(),
});

export type SopDocument = typeof sopDocuments.$inferSelect;
export type InsertSopDocument = typeof sopDocuments.$inferInsert;
