import { pgTable, serial, text, integer, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * seal_outbox — durable queue that keeps sealing OFF the critical path and
 * FAIL-OPEN. A governed event enqueues here (a fast local write) and the hotel
 * operation returns immediately; a background worker drains it to VDA Witness
 * with bounded retry. A transient Witness outage means a DELAYED seal, not a
 * lost one. Idempotent on (company_id, decision_id) so replays never double-seal.
 */
export const sealOutbox = pgTable(
  "seal_outbox",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    chainKey: text("chain_key").notNull(),
    decisionId: text("decision_id").notNull(), // idempotency key
    // PII-minimized seal payload: { decision:{...}, governingRule:{...} }
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    localWitnessId: integer("local_witness_id"), // witness_entries row to stamp with the ref
    status: text("status").notNull().default("pending"), // pending | sealed | dead
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    // The returned Witness seal reference (recordId / seq / chainKey / record).
    recordRef: jsonb("record_ref").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    sealedAt: timestamp("sealed_at", { withTimezone: true }),
  },
  (t) => ({
    // Idempotency: one outbox row (and thus one seal) per decision.
    uniqDecision: uniqueIndex("seal_outbox_company_decision_uniq").on(t.companyId, t.decisionId),
  }),
);

export type SealOutbox = typeof sealOutbox.$inferSelect;
export type InsertSealOutbox = typeof sealOutbox.$inferInsert;
