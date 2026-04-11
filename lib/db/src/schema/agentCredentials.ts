import { pgTable, serial, text, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";

export const agentCredentials = pgTable("agent_credentials", {
  id: serial("id").primaryKey(),
  agentId: text("agent_id").notNull(),
  companyId: integer("company_id").notNull(),
  did: text("did").notNull(),
  publicKeyMultibase: text("public_key_multibase").notNull(),
  secretKeyMultibase: text("secret_key_multibase").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  signedVc: jsonb("signed_vc").notNull(),
  governanceFileHash: text("governance_file_hash"),
  revoked: boolean("revoked").default(false).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedReason: text("revoked_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type AgentCredential = typeof agentCredentials.$inferSelect;
export type InsertAgentCredential = typeof agentCredentials.$inferInsert;
