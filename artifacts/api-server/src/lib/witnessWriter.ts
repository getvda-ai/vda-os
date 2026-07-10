/**
 * Core witness stream writer — extracted from routes/agents.ts into lib/ to
 * allow writeGovernanceEvent.ts (and routes/agents.ts itself) to import it
 * without creating an import cycle.
 *
 * When a decision is "ESCALATE", an operational HITL token is created
 * automatically (fire-and-forget) so a human can act on it in the dashboard.
 */

import { db, witnessEntries, hitlTokens, agentPhases, agentCredentials } from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import { logger } from "./logger.js";
import { buildC2PAManifest } from "./c2paManifest.js";

/**
 * Versioned model identifier embedded in every C2PA manifest.
 * `claude-sonnet-4-6` is Anthropic's API handle for claude-3-5-sonnet-20241022.
 * Update this constant when the platform model changes.
 */
const PLATFORM_MODEL_ID = "claude-sonnet-4-6 (claude-3-5-sonnet-20241022)";

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
  /** DID of the agent issuing this decision — embedded in the C2PA manifest when provided. */
  agentDid?: string | null;
  /** AI model that produced the decision — defaults to platform model if omitted. */
  modelId?: string | null;
  /**
   * Suppress the automatic generic operational HITL token on ESCALATE. Set by
   * callers (e.g. the Stay Agent) that create their own richly-routed card with
   * a role_band + full payload, to avoid duplicate cards.
   */
  suppressAutoHitl?: boolean;
  /**
   * Skip the internal C2PA manifest. Set by the Stay Agent, whose evidence of
   * record is the real VDA Witness seal (witness_seal_ref), not the internal
   * C2PA provenance manifest.
   */
  skipC2pa?: boolean;
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

  // ── C2PA Manifest generation ─────────────────────────────────────────────────
  // Build a C2PA v2.1-style provenance manifest and sign it with the platform's
  // Ed25519 key before inserting.  Per CAITA / Utah HB 276 / Washington HB 1170
  // requirements, EVERY witness entry MUST carry a signed provenance manifest.
  // Any failure is a hard error — the write is aborted so no entry exists without proof.

  // Resolve agent DID — caller may supply it directly; otherwise look up the
  // most recently issued (non-revoked) credential for this agent + company.
  let resolvedAgentDid: string | null = entry.agentDid ?? null;
  if (!entry.skipC2pa && !resolvedAgentDid && entry.companyId > 0) {
    try {
      const [cred] = await db
        .select({ did: agentCredentials.did })
        .from(agentCredentials)
        .where(and(
          eq(agentCredentials.agentId, toAgentSlug(entry.agent)),
          eq(agentCredentials.companyId, entry.companyId),
          eq(agentCredentials.revoked, false),
        ))
        .orderBy(desc(agentCredentials.issuedAt))
        .limit(1);
      resolvedAgentDid = cred?.did ?? null;
    } catch (didErr) {
      logger.warn(
        { err: didErr, agent: entry.agent, companyId: entry.companyId },
        "[C2PA] Could not resolve agent DID — manifest will omit agent_did"
      );
    }
  }

  // Stay Agent's evidence of record is the real VDA Witness seal, not the
  // internal C2PA manifest — skip it (also avoids the platform keypair on the
  // serverless read-only FS).
  const c2paManifest = entry.skipC2pa
    ? null
    : ((await buildC2PAManifest({
        modelId: entry.modelId ?? PLATFORM_MODEL_ID,
        agentDid: resolvedAgentDid,
        governanceFileHash: entry.governanceFileHash ?? null,
        filesConsulted,
        decision: entry.decision.decision,
        clauseApplied: entry.decision.clauseApplied,
        agentName: entry.agent,
        companyId: entry.companyId,
      })) as unknown as Record<string, unknown>);

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
        c2paManifest,
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
    !entry.scenarioRunId &&
    !entry.suppressAutoHitl
  ) {
    void createOperationalHitlToken(witnessId, entry);
  }

  return witnessId;
}
