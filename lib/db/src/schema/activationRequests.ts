import { pgTable, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const activationRequests = pgTable("activation_requests", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  agentId: text("agent_id").notNull(),
  companyId: integer("company_id").notNull(),
  initiatedBy: text("initiated_by").notNull(),
  status: text("status").notNull().default("pending_ambassador"),
  currentBandStep: text("current_band_step"),
  bandsCompleted: jsonb("bands_completed").default([]),
  bandsRejected: jsonb("bands_rejected").default([]),
  coSignedBy: text("co_signed_by"),
  coSignedAt: timestamp("co_signed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ActivationRequest = typeof activationRequests.$inferSelect;
export type InsertActivationRequest = typeof activationRequests.$inferInsert;
