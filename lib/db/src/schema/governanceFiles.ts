import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const governanceFiles = pgTable("governance_files", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  filename: text("filename").notNull(),
  filepath: text("filepath").notNull(),
  fileType: text("file_type").notNull(),
  axis: text("axis").notNull(),
  stage: text("stage"),
  content: text("content").notNull(),
  status: text("status").notNull().default("draft"),
  owner: text("owner"),
  domain: text("domain"),
  agentId: text("agent_id"),
  journeyStage: text("journey_stage"),
  normalisationLevel: integer("normalisation_level"),
  vendor: text("vendor"),
  baseline: boolean("baseline"),
  expiresAt: text("expires_at"),
  exceptionReason: text("exception_reason"),
  signedBy: text("signed_by"),
  signedRole: text("signed_role"),
  signedAt: timestamp("signed_at", { withTimezone: true }),
  nistControl: text("nist_control"),
  mustCount: integer("must_count").default(0),
  mustNotCount: integer("must_not_count").default(0),
  mayCount: integer("may_count").default(0),
  wordCount: integer("word_count").default(0),
  isArchived: boolean("is_archived").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type GovernanceFile = typeof governanceFiles.$inferSelect;
export type InsertGovernanceFile = typeof governanceFiles.$inferInsert;
