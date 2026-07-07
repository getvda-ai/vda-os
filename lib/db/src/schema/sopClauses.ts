import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

/**
 * sop_clauses — a heading-anchored, clause-level chunk of an ingested SOP
 * document. Loaded at decision time for the current stage (+ global) and
 * supplied to the model as business context; the model must cite the specific
 * clause(s) it applied in `sop_refs`. `anchor` is the slugified heading used for
 * verbatim citation on HITL cards.
 */
export const sopClauses = pgTable("sop_clauses", {
  id: serial("id").primaryKey(),
  sopDocumentId: integer("sop_document_id").notNull(),
  companyId: integer("company_id").notNull(),
  stage: text("stage").notNull().default("global"),
  anchor: text("anchor").notNull(),
  heading: text("heading").notNull(),
  text: text("text").notNull(),
  orderIndex: integer("order_index").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type SopClause = typeof sopClauses.$inferSelect;
export type InsertSopClause = typeof sopClauses.$inferInsert;
