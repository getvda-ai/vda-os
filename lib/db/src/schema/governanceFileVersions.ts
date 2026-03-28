import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

export const governanceFileVersions = pgTable("governance_file_versions", {
  id: serial("id").primaryKey(),
  fileId: integer("file_id").notNull(),
  content: text("content").notNull(),
  commitMessage: text("commit_message").notNull(),
  author: text("author").notNull().default("User"),
  versionNumber: integer("version_number").notNull().default(1),
  mustCount: integer("must_count").default(0),
  mustNotCount: integer("must_not_count").default(0),
  mayCount: integer("may_count").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type GovernanceFileVersion = typeof governanceFileVersions.$inferSelect;
export type InsertGovernanceFileVersion = typeof governanceFileVersions.$inferInsert;
