import { pgTable, text, integer, timestamp, jsonb, numeric } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const onboardingRequests = pgTable("onboarding_requests", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: text("session_id").notNull(),
  companyId: integer("company_id"),
  externalAgentDid: text("external_agent_did"),
  agentCard: jsonb("agent_card").notNull(),
  impactDeltaReport: jsonb("impact_delta_report"),
  candidateFiles: jsonb("candidate_files"),
  evalReportJobId: text("eval_report_job_id"),
  evalPassRate: numeric("eval_pass_rate"),
  firstHitlToken: text("first_hitl_token"),
  firstHitlOutcome: text("first_hitl_outcome"),
  firstHitlDecidedAt: timestamp("first_hitl_decided_at", { withTimezone: true }),
  secondHitlToken: text("second_hitl_token"),
  secondHitlOutcome: text("second_hitl_outcome"),
  secondHitlDecidedAt: timestamp("second_hitl_decided_at", { withTimezone: true }),
  prNumber: text("pr_number"),
  prUrl: text("pr_url"),
  source: text("source").notNull().default("a2a_external"),
  status: text("status").notNull().default("received"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type OnboardingRequest = typeof onboardingRequests.$inferSelect;
export type InsertOnboardingRequest = typeof onboardingRequests.$inferInsert;
