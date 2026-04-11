/**
 * Core witness stream writer — extracted from routes/agents.ts into lib/ to
 * allow writeGovernanceEvent.ts (and routes/agents.ts itself) to import it
 * without creating an import cycle.
 */

import { db, witnessEntries } from "@workspace/db";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface AgentDecision {
  decision: "PASS" | "FAIL" | "ESCALATE" | "INFO";
  clauseApplied: string;
  actionProposed: string;
  exceptionApplied: boolean;
  escalationTarget: string | null;
  reasoning: string;
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
}

// ─── Writer ────────────────────────────────────────────────────────────────────

export async function writeWitnessEntry(entry: WitnessEntryInput): Promise<number> {
  const [row] = await db
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
      filesConsulted: entry.filesConsulted ?? null,
      crossDomainInheritance: entry.crossDomainInheritance ?? false,
      credentialVerified: entry.credentialVerified ?? false,
      governanceFileHash: entry.governanceFileHash ?? null,
      eventCategory: entry.eventCategory ?? null,
    })
    .returning({ id: witnessEntries.id });
  return row.id;
}
