import { db, witnessEntries } from "@workspace/db";

export interface GovernanceEventInput {
  companyId: number;
  agent: string;
  eventCategory: string;
  decision?: string;
  fileReferenced?: string;
  clauseApplied?: string;
  actionProposed?: string;
  exceptionApplied?: boolean;
  escalationTarget?: string | null;
  reasoning?: string;
  apaleoData?: Record<string, unknown>;
  scenarioRunId?: string;
  filesConsulted?: string[];
  crossDomainInheritance?: boolean;
  credentialVerified?: boolean;
  governanceFileHash?: string | null;
}

export async function writeGovernanceEvent(fields: GovernanceEventInput): Promise<number> {
  const [row] = await db
    .insert(witnessEntries)
    .values({
      companyId: fields.companyId,
      agent: fields.agent,
      decision: fields.decision ?? "INFO",
      fileReferenced: fields.fileReferenced ?? null,
      clauseApplied: fields.clauseApplied ?? null,
      actionProposed: fields.actionProposed ?? null,
      exceptionApplied: fields.exceptionApplied ?? false,
      escalationTarget: fields.escalationTarget ?? null,
      reasoning: fields.reasoning ?? null,
      apaleoData: fields.apaleoData ?? null,
      scenarioRunId: fields.scenarioRunId ?? null,
      filesConsulted: fields.filesConsulted ?? null,
      crossDomainInheritance: fields.crossDomainInheritance ?? false,
      credentialVerified: fields.credentialVerified ?? false,
      governanceFileHash: fields.governanceFileHash ?? null,
      eventCategory: fields.eventCategory,
    })
    .returning({ id: witnessEntries.id });
  return row.id;
}
