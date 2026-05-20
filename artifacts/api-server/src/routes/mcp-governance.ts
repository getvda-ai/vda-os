/**
 * mcp-governance.ts
 * VDA-MD MCP Governance Server — read-only inspection protocol
 *
 * Exposes 6 governance tools over standard MCP JSON-RPC 2.0.
 * Auth: W3C VC bearer token (same scheme as A2A routes).
 * Endpoint: POST /api/mcp/governance
 *
 * Tools:
 *   get_agent_sop         — Active SOP + all governance files for an agent
 *   get_agent_skills      — SKILL file content + A2A skill declarations
 *   get_authority_ceiling — Active AP2 Intent Mandate and authorization ceilings
 *   get_witness_log       — Recent Witness Agent audit log entries
 *   check_phase_status    — Lifecycle phase and operational metrics
 *   validate_decision     — Governance pre-flight check (dry-run, no side effects)
 */

import { Router, type Request, type Response } from "express";
import { db, governanceFiles, witnessEntries, agentPhases } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { getMandateWithStatus } from "../lib/mandateIssuer.js";
import { getGovernancePolicyFromFM, evaluateWithPolicy, POLICY_AGENT_ID_MAP } from "./agents.js";
import { verifyAgentCredentialMiddleware } from "../lib/verifyAgentCredential.js";
import { AGENT_DEFS, AGENT_ID_TO_POLICY_KEY } from "../a2a/agentCardRegistry.js";
import { logger } from "../lib/logger.js";

void POLICY_AGENT_ID_MAP; // imported for parity; reverse map via AGENT_ID_TO_POLICY_KEY

const router = Router();

const MCP_PROTOCOL_VERSION = "2024-11-05";

// ─── MCP JSON-RPC helpers ─────────────────────────────────────────────────────

function mcpResult(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function mcpError(id: unknown, code: number, message: string, data?: unknown) {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } };
}

// ─── Tool schema definitions ─────────────────────────────────────────────────

const GOVERNANCE_TOOLS = [
  {
    name: "get_agent_sop",
    description:
      "Returns the active Standard Operating Procedure (SOP) and all governance files loaded for a VDA-MD agent at a specific property. Includes AGENTS.md, SOP.md, SKILL.md, and any active EXCEPTION overlays.",
    inputSchema: {
      type: "object",
      properties: {
        agent_id:   { type: "string", description: "Agent identifier (e.g. rate-agent, checkout-agent, folio-charge-agent)" },
        company_id: { type: "number", description: "Numeric company/property identifier" },
      },
      required: ["agent_id", "company_id"],
    },
  },
  {
    name: "get_agent_skills",
    description:
      "Returns the SKILL governance file content and the A2A v1.0 skill declarations for a VDA-MD agent, showing what the agent is authorised to do.",
    inputSchema: {
      type: "object",
      properties: {
        agent_id:   { type: "string", description: "Agent identifier" },
        company_id: { type: "number", description: "Numeric company/property identifier" },
      },
      required: ["agent_id", "company_id"],
    },
  },
  {
    name: "get_authority_ceiling",
    description:
      "Returns the active AP2 Intent Mandate and its authorization ceilings (spending/action limits) for a VDA-MD agent. Includes mandate status, phase, issuance timestamps, and per-action ceilings.",
    inputSchema: {
      type: "object",
      properties: {
        agent_id:   { type: "string", description: "Agent identifier" },
        company_id: { type: "number", description: "Numeric company/property identifier" },
      },
      required: ["agent_id", "company_id"],
    },
  },
  {
    name: "get_witness_log",
    description:
      "Returns recent Witness Agent audit log entries for a VDA-MD agent, showing governance decisions with the exact clauses applied, escalation targets, and mandate references.",
    inputSchema: {
      type: "object",
      properties: {
        agent_id:   { type: "string", description: "Agent identifier" },
        company_id: { type: "number", description: "Numeric company/property identifier" },
        limit:      { type: "number", description: "Maximum number of entries to return (default 20, max 100)" },
      },
      required: ["agent_id", "company_id"],
    },
  },
  {
    name: "check_phase_status",
    description:
      "Returns the current lifecycle phase (crawl/walk/run) and operational metrics for a VDA-MD agent, including agreement rate, override rate, and active mandate phase.",
    inputSchema: {
      type: "object",
      properties: {
        agent_id:   { type: "string", description: "Agent identifier" },
        company_id: { type: "number", description: "Numeric company/property identifier" },
      },
      required: ["agent_id", "company_id"],
    },
  },
  {
    name: "validate_decision",
    description:
      "Runs a governance pre-flight check for a proposed action and returns what the VDA-MD framework would decide (PASS / FAIL / ESCALATE) along with the exact governing clause — without executing the action or writing any records.",
    inputSchema: {
      type: "object",
      properties: {
        agent_id:   { type: "string", description: "Agent identifier" },
        company_id: { type: "number", description: "Numeric company/property identifier" },
        action:     { type: "string", description: "The proposed action to evaluate (e.g. 'apply 15% discount to reservation R-001')" },
        context:    { type: "string", description: "Optional additional context for the governance evaluation (e.g. guest tier, booking value)" },
      },
      required: ["agent_id", "company_id", "action"],
    },
  },
];

// ─── Tool handlers ─────────────────────────────────────────────────────────────

async function handleGetAgentSop(args: Record<string, unknown>): Promise<string> {
  const agentId   = String(args["agent_id"]   ?? "");
  const companyId = Number(args["company_id"] ?? NaN);

  const policyKey = AGENT_ID_TO_POLICY_KEY[agentId];
  if (!policyKey) {
    return JSON.stringify({
      error: `Unknown agent_id: '${agentId}'`,
      valid_agent_ids: Object.keys(AGENT_ID_TO_POLICY_KEY),
    });
  }

  const { policyText, filesLoaded, mandatoryEscalate } = await getGovernancePolicyFromFM(companyId, policyKey);

  return JSON.stringify({
    agent_id:          agentId,
    company_id:        companyId,
    files_loaded:      filesLoaded,
    mandatory_escalate: mandatoryEscalate ?? false,
    governance_content: policyText,
  }, null, 2);
}

async function handleGetAgentSkills(args: Record<string, unknown>): Promise<string> {
  const agentId   = String(args["agent_id"]   ?? "");
  const companyId = Number(args["company_id"] ?? NaN);

  const skillRows = await db
    .select({
      filename:  governanceFiles.filename,
      content:   governanceFiles.content,
      updatedAt: governanceFiles.updatedAt,
    })
    .from(governanceFiles)
    .where(and(
      eq(governanceFiles.companyId,  companyId),
      eq(governanceFiles.agentId,    agentId),
      eq(governanceFiles.fileType,   "SKILL"),
      eq(governanceFiles.isArchived, false),
    ));

  const a2aSkills = AGENT_DEFS[agentId]?.defaultSkills ?? [];

  return JSON.stringify({
    agent_id:    agentId,
    company_id:  companyId,
    a2a_skills:  a2aSkills,
    skill_files: skillRows.map(r => ({
      filename:   r.filename,
      updated_at: r.updatedAt,
      content:    r.content,
    })),
  }, null, 2);
}

async function handleGetAuthorityCeiling(args: Record<string, unknown>): Promise<string> {
  const agentId   = String(args["agent_id"]   ?? "");
  const companyId = Number(args["company_id"] ?? NaN);

  const { status, mandate } = await getMandateWithStatus(agentId, companyId);

  if (!mandate) {
    return JSON.stringify({
      agent_id:         agentId,
      company_id:       companyId,
      mandate_status:   status,
      message:          "No mandate record found. All actions require HITL pre-approval.",
      authorizations:   [],
    }, null, 2);
  }

  return JSON.stringify({
    agent_id:          agentId,
    company_id:        companyId,
    mandate_status:    status,
    mandate_id:        mandate.mandateId,
    phase:             mandate.phase,
    issued_at:         mandate.issuedAt,
    valid_until:       mandate.validUntil,
    revoked:           mandate.revoked,
    revoked_reason:    mandate.revokedReason ?? null,
    authorizations:    mandate.authorizations,
    governance_hash:   mandate.linkedGovernanceHash,
  }, null, 2);
}

async function handleGetWitnessLog(args: Record<string, unknown>): Promise<string> {
  const agentId   = String(args["agent_id"]   ?? "");
  const companyId = Number(args["company_id"] ?? NaN);
  const limitArg  = Number(args["limit"]      ?? 20);
  const limit     = Math.min(isNaN(limitArg) ? 20 : limitArg, 100);

  const entries = await db
    .select()
    .from(witnessEntries)
    .where(and(
      eq(witnessEntries.companyId, companyId),
      eq(witnessEntries.agent,     agentId),
    ))
    .orderBy(desc(witnessEntries.createdAt))
    .limit(limit);

  return JSON.stringify({
    agent_id:   agentId,
    company_id: companyId,
    count:      entries.length,
    entries:    entries.map(e => ({
      id:                   e.id,
      decision:             e.decision,
      action_proposed:      e.actionProposed,
      clause_applied:       e.clauseApplied,
      file_referenced:      e.fileReferenced,
      exception_applied:    e.exceptionApplied,
      escalation_target:    e.escalationTarget,
      mandate_id:           e.mandateId,
      event_category:       e.eventCategory,
      credential_verified:  e.credentialVerified,
      files_consulted:      e.filesConsulted,
      cross_domain:         e.crossDomainInheritance,
      created_at:           e.createdAt,
    })),
  }, null, 2);
}

async function handleCheckPhaseStatus(args: Record<string, unknown>): Promise<string> {
  const agentId   = String(args["agent_id"]   ?? "");
  const companyId = Number(args["company_id"] ?? NaN);

  const [phaseRow] = await db
    .select()
    .from(agentPhases)
    .where(and(
      eq(agentPhases.companyId, companyId),
      eq(agentPhases.agentId,   agentId),
    ))
    .orderBy(desc(agentPhases.phaseChangedAt))
    .limit(1);

  const { status: mandateStatus, mandate } = await getMandateWithStatus(agentId, companyId);

  return JSON.stringify({
    agent_id:          agentId,
    company_id:        companyId,
    phase:             phaseRow?.phase             ?? "not_activated",
    activated_at:      phaseRow?.activatedAt       ?? null,
    phase_changed_at:  phaseRow?.phaseChangedAt    ?? null,
    agreement_rate:    phaseRow?.agreementRate      ?? null,
    override_rate:     phaseRow?.overrideRate       ?? null,
    notes:             phaseRow?.notes              ?? null,
    role_band_phases:  phaseRow?.roleBandPhases     ?? null,
    mandate_status:    mandateStatus,
    mandate_phase:     mandate?.phase               ?? null,
    mandate_valid_until: mandate?.validUntil        ?? null,
  }, null, 2);
}

async function handleValidateDecision(args: Record<string, unknown>): Promise<string> {
  const agentId   = String(args["agent_id"]   ?? "");
  const companyId = Number(args["company_id"] ?? NaN);
  const action    = String(args["action"]     ?? "");
  const context   = String(args["context"]    ?? "No additional context provided.");

  const policyKey = AGENT_ID_TO_POLICY_KEY[agentId];
  if (!policyKey) {
    return JSON.stringify({
      error:           `Unknown agent_id: '${agentId}'`,
      valid_agent_ids: Object.keys(AGENT_ID_TO_POLICY_KEY),
    });
  }

  if (!action.trim()) {
    return JSON.stringify({ error: "action must be a non-empty string describing the proposed operation" });
  }

  const agentName = AGENT_DEFS[agentId]?.name ?? agentId;
  const decision  = await evaluateWithPolicy(agentName, policyKey, context, action, companyId);

  return JSON.stringify({
    agent_id:         agentId,
    company_id:       companyId,
    action_evaluated: action,
    decision:         decision.decision,
    clause_applied:   decision.clauseApplied,
    action_proposed:  decision.actionProposed,
    exception_applied: decision.exceptionApplied,
    escalation_target: decision.escalationTarget,
    reasoning:        decision.reasoning,
    note:             "Dry-run governance evaluation only. No action was executed and no audit records were written.",
  }, null, 2);
}

// ─── Tool dispatcher ──────────────────────────────────────────────────────────

const TOOL_HANDLERS: Record<string, (args: Record<string, unknown>) => Promise<string>> = {
  get_agent_sop:        handleGetAgentSop,
  get_agent_skills:     handleGetAgentSkills,
  get_authority_ceiling: handleGetAuthorityCeiling,
  get_witness_log:      handleGetWitnessLog,
  check_phase_status:   handleCheckPhaseStatus,
  validate_decision:    handleValidateDecision,
};

// ─── MCP JSON-RPC request handler ────────────────────────────────────────────

async function handleGovernanceMcp(req: Request, res: Response): Promise<void> {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  const body   = req.body as Record<string, unknown>;
  const id     = body?.["id"]     ?? null;
  const method = typeof body?.["method"] === "string" ? body["method"] : "";
  const params = (body?.["params"] ?? {}) as Record<string, unknown>;

  try {
    // ── initialize ─────────────────────────────────────────────────────────
    if (method === "initialize") {
      res.json(mcpResult(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities:    { tools: {} },
        serverInfo: {
          name:        "vda-md-governance",
          version:     "1.0.0",
          description: "VDA-MD Governance Inspection Server — read-only access to agent SOPs, mandates, witness logs, and phase status",
        },
      }));
      return;
    }

    // ── tools/list ─────────────────────────────────────────────────────────
    if (method === "tools/list") {
      res.json(mcpResult(id, { tools: GOVERNANCE_TOOLS }));
      return;
    }

    // ── tools/call ─────────────────────────────────────────────────────────
    if (method === "tools/call") {
      const toolName = typeof params["name"] === "string" ? params["name"] : "";
      const toolArgs = (params["arguments"] ?? {}) as Record<string, unknown>;

      const handler = TOOL_HANDLERS[toolName];
      if (!handler) {
        res.json(mcpError(id, -32601, `Tool not found: '${toolName}'`, {
          available_tools: Object.keys(TOOL_HANDLERS),
        }));
        return;
      }

      logger.info(
        { toolName, agentId: toolArgs["agent_id"], companyId: toolArgs["company_id"] },
        "[MCP-Gov] Tool call"
      );

      const text = await handler(toolArgs);
      res.json(mcpResult(id, {
        content: [{ type: "text", text }],
      }));
      return;
    }

    // ── unknown method ─────────────────────────────────────────────────────
    res.json(mcpError(id, -32601, `Method not found: '${method}'`, {
      supported_methods: ["initialize", "tools/list", "tools/call"],
    }));

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, method }, "[MCP-Gov] Internal error");
    res.status(500).json(mcpError(id, -32603, "Internal governance server error", { detail: message }));
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

router.options("/mcp/governance", (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.status(204).end();
});

router.post(
  "/mcp/governance",
  verifyAgentCredentialMiddleware,
  (req: Request, res: Response) => void handleGovernanceMcp(req, res)
);

export default router;
