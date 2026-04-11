import { writeWitnessEntry, type WitnessEntryInput, type AgentDecision } from "./witnessWriter.js";

export type { AgentDecision, WitnessEntryInput };

export type GovernanceEventInput = Omit<WitnessEntryInput, "decision"> & {
  eventCategory: string;
  decision?: AgentDecision["decision"];
  clauseApplied?: string;
  actionProposed?: string;
  reasoning?: string;
  exceptionApplied?: boolean;
  escalationTarget?: string | null;
};

export async function writeGovernanceEvent(fields: GovernanceEventInput): Promise<number> {
  const entry: WitnessEntryInput = {
    companyId: fields.companyId,
    agent: fields.agent,
    fileReferenced: fields.fileReferenced,
    apaleoData: fields.apaleoData,
    scenarioRunId: fields.scenarioRunId,
    filesConsulted: fields.filesConsulted,
    crossDomainInheritance: fields.crossDomainInheritance,
    credentialVerified: fields.credentialVerified,
    governanceFileHash: fields.governanceFileHash,
    eventCategory: fields.eventCategory,
    decision: {
      decision: fields.decision ?? "INFO",
      clauseApplied: fields.clauseApplied ?? "",
      actionProposed: fields.actionProposed ?? "",
      exceptionApplied: fields.exceptionApplied ?? false,
      escalationTarget: fields.escalationTarget ?? null,
      reasoning: fields.reasoning ?? "",
    },
  };
  return writeWitnessEntry(entry);
}
