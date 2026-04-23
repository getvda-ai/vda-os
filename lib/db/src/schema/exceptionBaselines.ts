import { pgTable, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const exceptionBaselines = pgTable("exception_baselines", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  agentId: text("agent_id").notNull(),
  companyId: integer("company_id").notNull(),
  roleBand: text("role_band").notNull(),
  exceptionClass: text("exception_class").notNull(),
  exceptionDescription: text("exception_description"),
  ceiling: text("ceiling"),
  ceilingType: text("ceiling_type"),
  authority: text("authority").notNull(),
  escalateTo: text("escalate_to"),
  accepted: boolean("accepted").notNull().default(false),
  rejected: boolean("rejected").notNull().default(false),
  rejectedReason: text("rejected_reason"),
  acceptedBy: text("accepted_by"),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  sourceFile: text("source_file"),
  sourceClause: text("source_clause"),
  activationRequestId: text("activation_request_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ExceptionBaseline = typeof exceptionBaselines.$inferSelect;
export type InsertExceptionBaseline = typeof exceptionBaselines.$inferInsert;
