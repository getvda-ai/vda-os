import type { Request, Response } from "express";
import {
  evaluateWithPolicy,
  writeWitnessEntry,
  getGovernancePolicyFromFM,
} from "../routes/agents.js";
import {
  createTask,
  getTask,
  updateTask,
  cancelTask,
  listTasksForSession,
  isNewSession,
  type A2AMessage,
} from "./taskStore.js";
import { AGENT_ID_TO_POLICY_KEY } from "./agentCardRegistry.js";
import { A2A_ERRORS, jsonRpcError, jsonRpcResult } from "./a2aErrors.js";
import { logger } from "../lib/logger.js";

const AGENT_DISPLAY_NAMES: Record<string, string> = {
  "availability-agent":           "Availability Agent",
  "rate-agent":                   "Rate Agent",
  "reservation-bot":              "Reservation Bot",
  "check-in-agent":               "Check-In Agent",
  "folio-agent":                  "Folio Agent",
  "folio-charge-agent":           "Folio Charge Agent",
  "checkout-agent":               "Checkout Agent",
  "revenue-reconciliation-agent": "Revenue Reconciliation Agent",
};

function fileReferenced(filesLoaded: string[]): string {
  if (filesLoaded.length === 0) return "VDA-MD §2.1 — No governance file";
  return filesLoaded.find(f => f.endsWith(".SOP.md")) ?? filesLoaded[0];
}

function extractText(message: A2AMessage): string {
  return message.parts?.find(p => p.type === "text")?.text ?? "";
}

// tasks/send — the main A2A entry point
async function handleTasksSend(
  rpcId: string | number | null,
  params: unknown,
  companyId: number,
  agentId: string,
  externalAgentDid: string | null
): Promise<object> {
  const p = params as Record<string, unknown>;
  if (!p?.id || !p?.sessionId || !p?.message) {
    return jsonRpcError(rpcId, A2A_ERRORS.INVALID_PARAMS, "id, sessionId, and message are required");
  }

  const sessionId = String(p.sessionId);
  const message = p.message as A2AMessage;
  const instruction = extractText(message);

  if (!instruction) {
    return jsonRpcError(rpcId, A2A_ERRORS.INVALID_PARAMS, "message.parts must contain at least one text part");
  }

  const policyKey = AGENT_ID_TO_POLICY_KEY[agentId];
  if (!policyKey) {
    return jsonRpcError(rpcId, A2A_ERRORS.INVALID_PARAMS, `Unknown agentId: ${agentId}`);
  }
  const agentName = AGENT_DISPLAY_NAMES[agentId] ?? agentId;

  // Check if this is the first task in the session
  const newSession = await isNewSession(companyId, agentId, sessionId);

  // Create the task record
  const task = await createTask(companyId, agentId, sessionId, message, externalAgentDid);

  logger.info({ taskId: task.id, agentId, companyId, sessionId }, "[A2A] Task received");

  // Witness: session started (first task only)
  if (newSession) {
    await writeWitnessEntry({
      companyId,
      agent: agentId,
      decision: {
        decision: "PASS",
        clauseApplied: "A2A session initiated — first task received in this sessionId",
        actionProposed: `New A2A session ${sessionId} started`,
        exceptionApplied: false,
        escalationTarget: null,
        reasoning: `External agent (DID: ${externalAgentDid ?? "unknown"}) opened session ${sessionId} with ${agentId}`,
      },
      fileReferenced: "a2a_protocol",
      apaleoData: { event_type: "a2a_session_started", sessionId, externalAgentDid, taskId: task.id },
    });
  }

  // Witness: task received
  await writeWitnessEntry({
    companyId,
    agent: agentId,
    decision: {
      decision: "PASS",
      clauseApplied: "A2A task received and queued for governance evaluation",
      actionProposed: `Process A2A task ${task.id}`,
      exceptionApplied: false,
      escalationTarget: null,
      reasoning: `External agent submitted task: ${instruction.slice(0, 100)}`,
    },
    fileReferenced: "a2a_protocol",
    apaleoData: { event_type: "a2a_task_received", taskId: task.id, sessionId, externalAgentDid, inputPreview: instruction.slice(0, 100) },
  });

  // Mark working
  await updateTask(task.id, { statusState: "working" });

  // Build context from prior session tasks (for follow-up tasks)
  let priorContext = "";
  if (!newSession) {
    const prior = await listTasksForSession(companyId, agentId, sessionId);
    const completed = prior.filter(t => t.status.state === "completed" && t.id !== task.id);
    if (completed.length > 0) {
      priorContext = "\n\nPrior session context:\n" + completed.map(t =>
        `[${t.createdAt}] Input: ${extractText(t.message).slice(0, 100)} → Output: ${t.artifacts[0]?.parts[0]?.text?.slice(0, 100) ?? "N/A"}`
      ).join("\n");
    }
  }

  // §2.1 governance check
  const governance = await getGovernancePolicyFromFM(companyId, policyKey);

  if (governance.mandatoryEscalate) {
    await updateTask(task.id, { statusState: "failed", errorMessage: "§2.1 governance files missing" });
    await writeWitnessEntry({
      companyId,
      agent: agentId,
      decision: {
        decision: "ESCALATE",
        clauseApplied: "Per VDA-MD §2.1, all agent decisions are suspended until AGENTS.md, SOP.md, and SKILL.md are present",
        actionProposed: "Reject A2A task — governance files missing",
        exceptionApplied: false,
        escalationTarget: "Operations Director",
        reasoning: "Mandatory governance files not found for this agent/company pair",
      },
      fileReferenced: "VDA-MD §2.1 — No governance file",
      apaleoData: { event_type: "a2a_task_failed", taskId: task.id, reason: "governance_violation" },
    });
    return jsonRpcError(rpcId, A2A_ERRORS.GOVERNANCE_VIOLATION);
  }

  // Run governance pipeline
  let decision;
  try {
    decision = await evaluateWithPolicy(
      agentName,
      policyKey,
      `A2A external request${priorContext}`,
      instruction,
      companyId
    );
  } catch (err) {
    await updateTask(task.id, { statusState: "failed", errorMessage: String(err) });
    logger.error({ err, taskId: task.id }, "[A2A] evaluateWithPolicy threw");
    return jsonRpcError(rpcId, { code: -32603, message: "Internal error during governance evaluation" });
  }

  const fileRef = fileReferenced(governance.filesLoaded);

  // Write governance decision witness entry
  await writeWitnessEntry({
    companyId,
    agent: agentId,
    decision,
    fileReferenced: fileRef,
    filesConsulted: governance.filesLoaded,
    credentialVerified: true,
    apaleoData: { event_type: decision.decision === "ESCALATE" ? "a2a_task_failed" : "a2a_task_completed", taskId: task.id, sessionId, externalAgentDid },
  });

  if (decision.decision === "ESCALATE") {
    await updateTask(task.id, { statusState: "failed", errorMessage: decision.reasoning });
    return jsonRpcError(rpcId, A2A_ERRORS.AGENT_ESCALATION, decision.escalationTarget ?? undefined);
  }

  // Package result as A2A artifact
  const responseText = [
    `Decision: ${decision.decision}`,
    `Action: ${decision.actionProposed}`,
    `Clause applied: ${decision.clauseApplied}`,
    `Reasoning: ${decision.reasoning}`,
    decision.exceptionApplied ? `Exception applied: yes` : null,
    decision.escalationTarget ? `Escalation target: ${decision.escalationTarget}` : null,
  ].filter(Boolean).join("\n");

  const artifacts = [
    { index: 0, parts: [{ type: "text" as const, text: responseText }], lastChunk: true },
  ];

  const completed = await updateTask(task.id, { statusState: "completed", outputArtifacts: artifacts });

  return jsonRpcResult(rpcId, { ...completed, artifacts });
}

// tasks/get
async function handleTasksGet(
  rpcId: string | number | null,
  params: unknown
): Promise<object> {
  const p = params as Record<string, unknown>;
  if (!p?.id) return jsonRpcError(rpcId, A2A_ERRORS.INVALID_PARAMS, "id is required");

  const task = await getTask(String(p.id));
  if (!task) return jsonRpcError(rpcId, A2A_ERRORS.TASK_NOT_FOUND);

  return jsonRpcResult(rpcId, task);
}

// tasks/cancel
async function handleTasksCancel(
  rpcId: string | number | null,
  params: unknown,
  companyId: number,
  agentId: string
): Promise<object> {
  const p = params as Record<string, unknown>;
  if (!p?.id) return jsonRpcError(rpcId, A2A_ERRORS.INVALID_PARAMS, "id is required");

  const existing = await getTask(String(p.id));
  if (!existing) return jsonRpcError(rpcId, A2A_ERRORS.TASK_NOT_FOUND);
  if (existing.status.state === "cancelled") return jsonRpcError(rpcId, A2A_ERRORS.TASK_ALREADY_CANCELLED);

  const cancelled = await cancelTask(String(p.id));

  await writeWitnessEntry({
    companyId,
    agent: agentId,
    decision: {
      decision: "PASS",
      clauseApplied: "A2A task cancelled by requesting external agent",
      actionProposed: `Cancel task ${p.id}`,
      exceptionApplied: false,
      escalationTarget: null,
      reasoning: "External agent requested cancellation",
    },
    fileReferenced: "a2a_protocol",
    apaleoData: { event_type: "a2a_task_cancelled", taskId: p.id },
  });

  return jsonRpcResult(rpcId, cancelled);
}

// Main JSON-RPC dispatcher
export async function a2aJsonRpcHandler(req: Request, res: Response): Promise<void> {
  const companyId = parseInt(String(req.params.companyId), 10);
  const agentId = String(req.params.agentId);

  if (!req.vcVerified) {
    res.json(jsonRpcError(null, A2A_ERRORS.AUTH_REQUIRED));
    return;
  }

  const externalAgentDid = req.vcPayload?.agentId ?? null;

  let body: Record<string, unknown>;
  try {
    body = req.body;
    if (!body || typeof body !== "object") throw new Error("not object");
  } catch {
    res.json(jsonRpcError(null, A2A_ERRORS.PARSE_ERROR));
    return;
  }

  if (body.jsonrpc !== "2.0" || !body.method) {
    res.json(jsonRpcError(body.id as string | number | null ?? null, A2A_ERRORS.INVALID_REQUEST));
    return;
  }

  const rpcId = (body.id as string | number | null) ?? null;
  const method = String(body.method);
  const params = body.params ?? {};

  let result: object;
  switch (method) {
    case "tasks/send":
      result = await handleTasksSend(rpcId, params, companyId, agentId, externalAgentDid);
      break;
    case "tasks/get":
      result = await handleTasksGet(rpcId, params);
      break;
    case "tasks/cancel":
      result = await handleTasksCancel(rpcId, params, companyId, agentId);
      break;
    default:
      result = jsonRpcError(rpcId, A2A_ERRORS.METHOD_NOT_FOUND, method);
  }

  res.json(result);
}
