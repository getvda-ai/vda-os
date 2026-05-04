/**
 * Core witness stream writer — extracted from routes/agents.ts into lib/ to
 * allow writeGovernanceEvent.ts (and routes/agents.ts itself) to import it
 * without creating an import cycle.
 *
 * When a decision is "ESCALATE", an operational HITL token is created
 * automatically (fire-and-forget) so a human can act on it in the dashboard.
 */

import { db, witnessEntries, hitlTokens, agentPhases } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "./logger.js";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface AgentDecision {
  decision: "PASS" | "FAIL" | "ESCALATE" | "INFO";
  clauseApplied: string;
  actionProposed: string;
  exceptionApplied: boolean;
  escalationTarget: string | null;
  reasoning: string;
  /** Structured exception class slug attached by the agent before calling writeWitnessEntry. */
  exceptionClass?: string;
}

export interface WitnessEntryInput {
  companyId: number;
  agent: string;
  decision: AgentDecision;
  fileReferenced: string;
  apaleoData: Record<string, unknown>;
  scenarioRunId?: string;
  filesConsulted?: string[];
  crossDomainInheritance?: boolean;
  credentialVerified?: boolean;
  governanceFileHash?: string | null;
  eventCategory?: string;
  /** AP2 Intent Mandate ID that governed this decision — stored as a first-class column for queryable compliance evidence. */
  mandateId?: string | null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function toAgentSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

// Canonical mapping from escalation_target → role_band (mirrors backfillRoleBand.ts).
// Kept here so role_band is populated at insert time, avoiding NULL until next restart.
const ESCALATION_TARGET_ROLE_BAND: Record<string, string> = {
  "Revenue Manager":      "hotel_gm",
  "Operations Director":  "hotel_gm",
  "Credit Control team":  "hotel_gm",
  "VP Revenue":           "regional_gm",
  "CFO":                  "regional_gm",
  "CISO":                 "operations_chief",
  "first_hitl_approval":  "compliance_officer",
  "second_hitl_approval": "compliance_officer",
};

// ─── Operational HITL creation ─────────────────────────────────────────────────

async function createOperationalHitlToken(
  witnessEntryId: number,
  entry: WitnessEntryInput
): Promise<void> {
  try {
    const agentId = toAgentSlug(entry.agent);

    const phaseRows = await db
      .select({ phase: agentPhases.phase })
      .from(agentPhases)
      .where(
        and(
          eq(agentPhases.companyId, entry.companyId),
          eq(agentPhases.agentId, agentId),
        ),
      )
      .limit(1);

    const currentPhase = phaseRows[0]?.phase ?? "crawl";

    // Derive role_band from escalation_target at insert time so role-scoped queries work immediately.
    const roleBand = entry.decision.escalationTarget
      ? (ESCALATION_TARGET_ROLE_BAND[entry.decision.escalationTarget] ?? null)
      : null;

    await db.insert(hitlTokens).values({
      onboardingRequestId: null,
      phase: 0,
      cardType: "operational_exception",
      agentId,
      companyId: entry.companyId,
      roleBand,
      witnessEntryId: String(witnessEntryId),
      payload: {
        type: "operational_exception",
        agent_name: entry.agent,
        agent_id: agentId,
        company_id: entry.companyId,
        current_phase: currentPhase,
        exception_class: entry.decision.exceptionClass ?? null,
        witness_entry_id: witnessEntryId,
        decision: entry.decision.decision,
        clause_applied: entry.decision.clauseApplied,
        action_proposed: entry.decision.actionProposed,
        reasoning: entry.decision.reasoning,
        escalation_target: entry.decision.escalationTarget,
        file_referenced: entry.fileReferenced,
        apaleo_data: entry.apaleoData,
      },
      context: {
        agent: entry.agent,
        agent_id: agentId,
        company_id: entry.companyId,
        decision: entry.decision,
        witness_entry_id: witnessEntryId,
      },
    });

    logger.info(
      { agentId, companyId: entry.companyId, witnessEntryId },
      "Operational HITL token created for ESCALATE decision"
    );
  } catch (err) {
    logger.warn({ err }, "Failed to create operational HITL token — continuing");
  }
}

// ─── Writer ────────────────────────────────────────────────────────────────────

export async function writeWitnessEntry(entry: WitnessEntryInput): Promise<number> {
  // Defensive: normalise filesConsulted — pass null rather than an empty array
  // to avoid any ORM-level quirks with empty text[] parameters.
  const filesConsulted =
    Array.isArray(entry.filesConsulted) && entry.filesConsulted.length > 0
      ? entry.filesConsulted
      : null;

  let insertedRow: { id: number } | undefined;
  try {
    const result = await db
      .insert(witnessEntries)
      .values({
        companyId: entry.companyId,
        agent: entry.agent,
        decision: entry.decision.decision,
        fileReferenced: entry.fileReferenced,
        clauseApplied: entry.decision.clauseApplied,
        actionProposed: entry.decision.actionProposed,
        exceptionApplied: entry.decision.exceptionApplied,
        escalationTarget: entry.decision.escalationTarget,
        reasoning: entry.decision.reasoning,
        apaleoData: entry.apaleoData,
        scenarioRunId: entry.scenarioRunId ?? null,
        filesConsulted,
        crossDomainInheritance: entry.crossDomainInheritance ?? false,
        credentialVerified: entry.credentialVerified ?? false,
        governanceFileHash: entry.governanceFileHash ?? null,
        eventCategory: entry.eventCategory ?? null,
        mandateId: entry.mandateId ?? null,
      })
      .returning({ id: witnessEntries.id });
    insertedRow = result[0];
  } catch (insertErr) {
    // Re-throw with a readable message so callers get a useful string in their logs.
    const msg = insertErr instanceof Error ? insertErr.message : String(insertErr);
    throw new Error(
      `witness_entries DB insert failed — agent='${entry.agent}' companyId=${entry.companyId}: ${msg}`
    );
  }

  if (!insertedRow) {
    // Should never happen: a successful PostgreSQL INSERT … RETURNING always
    // yields exactly one row. Guard anyway to prevent a silent TypeError.
    throw new Error(
      `witness_entries insert returned no row — agent='${entry.agent}' companyId=${entry.companyId}`
    );
  }

  const witnessId = insertedRow.id;

  // Fire-and-forget: create an operational HITL card for runtime ESCALATE decisions.
  // Guards:
  //   • companyId > 0 — skip platform-sentinel events (companyId === 0 is the
  //     platform / onboarding-agent context, not a live hotel property)
  //   • no scenarioRunId — skip sandbox evaluation runs; those are test traffic,
  //     not real operational decisions that need a governance review
  // When the decision is ESCALATE, always create an operational HITL card.
  // Baseline convergence (ESCALATE → PASS for baselined classes) is handled upstream
  // in the agent route using getRejectedOrBaselinedClasses() with a 60s TTL cache.
  // A decision that reaches writeWitnessEntry as ESCALATE is not yet baselined
  // and always requires human review.
  if (
    entry.decision.decision === "ESCALATE" &&
    entry.companyId > 0 &&
    !entry.scenarioRunId
  ) {
    void createOperationalHitlToken(witnessId, entry);
  }

  return witnessId;
}
