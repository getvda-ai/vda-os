import { pgTable, serial, text, integer, bigint, jsonb, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const companies = pgTable("companies", {
  id: serial("id").primaryKey(),
  companyName: text("company_name").notNull(),
  websiteUrl: text("website_url"),
  industry: text("industry").notNull(),
  brandContext: text("brand_context"),
  filesCount: integer("files_count").default(0),
  savedAt: bigint("saved_at", { mode: "number" }),
  uploadedFiles: jsonb("uploaded_files"),
  apaleoPropertyId: text("apaleo_property_id"),
  /**
   * x402 billing exemption flag.
   * true  = primary tenant (A Hotel Berlin) — governance calls are free.
   * false = external tenant — each governance call deducts from credit wallet;
   *         402 is returned when balance reaches zero.
   */
  x402Exempt: boolean("x402_exempt").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertCompanySchema = createInsertSchema(companies).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Company = typeof companies.$inferSelect;
export type InsertCompany = z.infer<typeof insertCompanySchema>;
