import { pgTable, text, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const hitlTokens = pgTable("hitl_tokens", {
  token: text("token").primaryKey().default(sql`gen_random_uuid()`),
  onboardingRequestId: text("onboarding_request_id").notNull(),
  phase: integer("phase").notNull(),
  cardType: text("card_type").notNull().default("approval"),
  payload: jsonb("payload").notNull(),
  outcome: text("outcome"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type HitlToken = typeof hitlTokens.$inferSelect;
export type InsertHitlToken = typeof hitlTokens.$inferInsert;
