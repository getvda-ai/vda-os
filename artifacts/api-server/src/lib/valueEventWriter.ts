/**
 * valueEventWriter.ts
 * AP2 Economic Metering — writes signed value records for every agent PASS decision.
 * Enables per-agent, per-property ROI calculation.
 */

import { createHmac } from "node:crypto";
import { db, agentValueEvents, type InsertAgentValueEvent } from "@workspace/db";
import { logger } from "./logger.js";

// ─── Governance cost estimates (cents) ────────────────────────────────────────
// These represent the cost of one Claude API call + Apaleo API call overhead.
// Roughly: ~5k input tokens ($3/1M) + ~1k output tokens ($15/1M) ≈ $0.030 = 3¢
const GOVERNANCE_COST_CENTS: Record<string, number> = {
  "reservation-bot":              4,   // extra MCP tool calls
  "check-in-agent":               4,
  "folio-agent":                  2,   // read-only
  "folio-charge-agent":           4,
  "checkout-agent":               4,
  "availability-agent":           2,
  "rate-agent":                   3,
  "revenue-reconciliation-agent": 5,
};

export interface ValueEventInput {
  agentId: string;
  agentName: string;
  companyId: number;
  propertyCode?: string;
  action: string;
  revenueDelta?: number;
  currency?: string;
  decisionOutcome?: string;
  witnessToken?: string | number | null;
  governancePhase?: string | null;
  sourceData?: Record<string, unknown>;
}

/**
 * Write an AP2 value event record.
 * Fire-and-forget — always resolves, never throws (non-blocking).
 * Returns the inserted row ID or null on error.
 */
export async function writeValueEvent(input: ValueEventInput): Promise<number | null> {
  try {
    const costCents = GOVERNANCE_COST_CENTS[input.agentId] ?? 3;

    const row: InsertAgentValueEvent = {
      agentId: input.agentId,
      companyId: input.companyId,
      propertyCode: input.propertyCode ?? null,
      action: input.action,
      revenueDelta: String(input.revenueDelta ?? 0),
      costCents,
      currency: input.currency ?? "EUR",
      decisionOutcome: input.decisionOutcome ?? "PASS",
      witnessToken: input.witnessToken != null ? String(input.witnessToken) : null,
      governancePhase: input.governancePhase ?? null,
      sourceData: input.sourceData ? JSON.stringify(input.sourceData) : null,
    };

    const [inserted] = await db
      .insert(agentValueEvents)
      .values(row)
      .returning({ id: agentValueEvents.id });

    logger.info({ agentId: input.agentId, action: input.action, companyId: input.companyId, revenueDelta: input.revenueDelta, id: inserted?.id }, "[ValueLedger] Event written");
    return inserted?.id ?? null;
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err), agentId: input.agentId, companyId: input.companyId, action: input.action }, "[ValueLedger] FAILED to write value event");
    return null;
  }
}
