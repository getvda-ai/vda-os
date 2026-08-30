/**
 * stayAgentSkills.ts — the SINGLE definition of Stay Agent's skills.
 *
 * Each skill's inputSchema is declared exactly once here and emitted to BOTH the A2A
 * card (cardSkills) AND an MCP tools/list (mcpTools) from the same object. There is no
 * second schema to drift from — deliberately not the pattern where card skills defer
 * their schema to MCP.
 *
 * These describe what Stay Agent does TODAY (a bespoke monolith on the Apaleo sandbox),
 * not the future thin-adapter state. Where a skill does something the framework now does
 * generically — deciding its own authority, hosting its own HITL, executing its own
 * writes — the description says so plainly, and the card's caveats/doesNotOwn carry it.
 */

export interface JsonSchema {
  type: "object";
  required?: string[];
  properties: Record<string, unknown>;
  additionalProperties?: boolean;
}

export interface StaySkill {
  id: string;
  name: string;
  description: string;
  /** "mutating" flags a skill that writes to Apaleo and/or seals an irreversible record. */
  tags: string[];
  inputSchema: JsonSchema;
}

const S = (type: string, description: string, extra: Record<string, unknown> = {}) => ({ type, description, ...extra });

export const STAY_SKILLS: StaySkill[] = [
  {
    id: "propose_stay_action",
    name: "Propose and govern a hospitality exception",
    description:
      "Evaluate a guest-journey exception (late/early check-out, folio adjustment, refund, etc.) at a citizenM property. Reads the LIVE Apaleo reservation and folio, runs a hospitality prompt that PROPOSES an action, then governs it end-to-end IN THIS AGENT: it decides the outcome against ceilings and a band ladder it computes ITSELF in code (hardcoded ambassador → mod → compliance_officer, not a signed ACP bundle evaluated by ACP's SDK); on a self-authorised PASS or a matching local baseline it EXECUTES the Apaleo write itself; otherwise it escalates to this agent's OWN human queue. Every outcome is sealed to a shared Witness account. This is one fused skill today; the framework separates propose / authorise / route / execute / seal.",
    tags: ["hospitality", "decision", "mutating", "self-authority"],
    inputSchema: {
      type: "object",
      required: ["company_id", "stage", "exception_context"],
      properties: {
        company_id: S("integer", "Tenant id (a citizenM property/company).", { minimum: 0 }),
        stage: S("string", "Guest-journey stage.", { enum: ["check_in", "in_stay", "check_out"] }),
        exception_context: {
          type: "object",
          required: ["exception_class"],
          description: "The exception to govern.",
          properties: {
            exception_class: S("string", "e.g. late_checkout, early_checkout, refund_folio_adjustment."),
            requested_value: S("number", "The magnitude requested (hours, nights, amount) — evaluated against the ceiling."),
            unit: S("string", "Unit of requested_value.", { enum: ["hours", "nights", "amount", "count"] }),
            role_band: S("string", "The band the caller is acting as. NOTE: bands are hardcoded in this agent, not registered config."),
          },
          additionalProperties: true,
        },
        apaleo_ref: {
          type: "object",
          description: "Which Apaleo records to read as the decision basis. Sandbox reservations only.",
          properties: {
            propertyId: S("string", "Apaleo property id, e.g. BER."),
            reservationId: S("string", "Apaleo reservation id."),
            folioId: S("string", "Apaleo folio id (optional)."),
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
  },
  {
    id: "list_pending_decisions",
    name: "List decisions awaiting a human",
    description:
      "List exceptions this agent has escalated to a human, filtered by band. This is a SELF-HOSTED human-in-the-loop queue (/stay/hitl/*) that duplicates the live hitl.getvda.ai service — the same concept implemented twice.",
    tags: ["hitl", "read", "duplicates-substrate"],
    inputSchema: {
      type: "object",
      required: ["company_id"],
      properties: {
        company_id: S("integer", "Tenant id.", { minimum: 0 }),
        role_band: S("string", "Filter to a band. Hardcoded set: ambassador | mod | compliance_officer."),
      },
      additionalProperties: false,
    },
  },
  {
    id: "resolve_decision",
    name: "Record a human's resolution",
    description:
      "Record a human's decision on a pending item: approve | deny | escalate | baseline. On approve or baseline this agent EXECUTES the Apaleo write itself and seals the decision. The deciding human is ASSERTED from request input (decided_by), not authenticated; the endpoint is unauthenticated.",
    tags: ["hitl", "governance", "mutating", "actor-asserted"],
    inputSchema: {
      type: "object",
      required: ["token", "outcome"],
      properties: {
        token: S("string", "The pending item's token (UUID)."),
        outcome: S("string", "The human's disposition.", { enum: ["approve", "deny", "escalate", "baseline"] }),
        reason: S("string", "Optional free-text rationale, sealed with the decision."),
        decided_by: S("string", "Asserted actor id. NOT authenticated; defaults to 'Dashboard User' if omitted."),
        role_band: S("string", "The band the human is acting as."),
      },
      additionalProperties: false,
    },
  },
  {
    id: "manage_baselines",
    name: "List and revoke standing baselines",
    description:
      "List or revoke baselines — the 'make this the new rule' outcome that moves a decision class inside this agent's ceiling so future matching requests auto-approve without a human. Baselines are CREATED via resolve_decision(outcome=baseline). Bounds and scope are Apaleo-specific (propertyId, rate_type/refundable/group). Matching runs locally in this agent's decision loop, before any human is asked.",
    tags: ["governance", "baseline", "mutating", "apaleo-scoped"],
    inputSchema: {
      type: "object",
      required: ["company_id"],
      properties: {
        company_id: S("integer", "Tenant id.", { minimum: 0 }),
        revoke: {
          type: "object",
          description: "Present to revoke a baseline (never hard-deleted; future matches return to HITL).",
          required: ["id", "revoked_by", "revoked_reason"],
          properties: {
            id: S("string", "Baseline id to revoke."),
            revoked_by: S("string", "Asserted actor (MoD)."),
            revoked_reason: S("string", "Why."),
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
  },
  {
    id: "report_evidence",
    name: "Produce a record-keeping / EU AI Act evidence report",
    description:
      "Produce an EU AI Act Article 12 record-keeping report from this agent's sealed decision trail (generated by Witness), or an EU AI Act risk assessment (generated by C2MD via the Witness suite key, key-safe). Read-only over the sealed trail.",
    tags: ["evidence", "eu-ai-act", "read"],
    inputSchema: {
      type: "object",
      required: ["company_id"],
      properties: {
        company_id: S("integer", "Tenant id.", { minimum: 0 }),
        kind: S("string", "Which report.", { enum: ["article12", "eu_ai_act_assessment"] }),
        chain_key: S("string", "Optional explicit Witness chain key; defaults to this company's customer-facing chain."),
      },
      additionalProperties: false,
    },
  },
];

/** Emit the A2A card `skills[]` shape — inputSchema included on every skill. */
export function cardSkills(): Array<Pick<StaySkill, "id" | "name" | "description" | "tags" | "inputSchema">> {
  return STAY_SKILLS.map(({ id, name, description, tags, inputSchema }) => ({ id, name, description, tags, inputSchema }));
}

/** Emit an MCP `tools/list` shape from the SAME definitions — no separate schema. */
export function mcpTools(): Array<{ name: string; description: string; inputSchema: JsonSchema }> {
  return STAY_SKILLS.map(({ id, description, inputSchema }) => ({ name: id, description, inputSchema }));
}
