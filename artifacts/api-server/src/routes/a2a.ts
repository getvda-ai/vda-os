import { Router } from "express";
import { getAgentCard, getAllAgentCards, getPlatformCard, getOnboardingAgentCard, AGENT_IDS } from "../a2a/agentCardRegistry.js";
import { a2aJsonRpcHandler } from "../a2a/a2aHandler.js";
import { listTasksForCompany, listTasksForSession } from "../a2a/taskStore.js";
import { requireAgentCredential } from "../lib/verifyAgentCredential.js";
import { startOnboarding } from "../onboarding/onboardingOrchestrator.js";
import { A2A_ERRORS, jsonRpcError, jsonRpcResult } from "../a2a/a2aErrors.js";
import { logger } from "../lib/logger.js";

const router = Router();

// ─── Well-known & discovery ───────────────────────────────────────────────────

router.get("/well-known/agent.json", (_req, res) => {
  res.json(getPlatformCard());
});

// Onboarding Agent card (platform-level, no companyId)
router.get("/a2a/onboarding/agent.json", (_req, res) => {
  res.json(getOnboardingAgentCard());
});

// All 9 agent cards for a property (8 + onboarding-agent)
router.get("/a2a/:companyId/agents", async (req, res) => {
  const companyId = parseInt(req.params.companyId, 10);
  if (isNaN(companyId)) { res.status(400).json({ error: "Invalid companyId" }); return; }
  // getAllAgentCards already includes onboarding-agent (it's in AGENT_IDS)
  const cards = await getAllAgentCards(companyId);
  res.json({ companyId, agents: cards });
});

// Single agent card
router.get("/a2a/:companyId/:agentId/agent.json", async (req, res) => {
  const companyId = parseInt(req.params.companyId, 10);
  const agentId = String(req.params.agentId);
  if (isNaN(companyId)) { res.status(400).json({ error: "Invalid companyId" }); return; }
  if (!AGENT_IDS.includes(agentId)) { res.status(404).json({ error: "Unknown agentId" }); return; }
  const card = await getAgentCard(companyId, agentId);
  if (!card) { res.status(404).json({ error: "Agent not found" }); return; }
  res.json(card);
});

// Task listing for dashboard polling (no VC required)
router.get("/a2a/:companyId/tasks", async (req, res) => {
  const companyId = parseInt(req.params.companyId, 10);
  if (isNaN(companyId)) { res.status(400).json({ error: "Invalid companyId" }); return; }
  const limit = Math.min(parseInt(String(req.query.limit ?? "100"), 10), 200);
  const tasks = await listTasksForCompany(companyId, limit);
  res.json({ tasks, companyId });
});

// Session history
router.get("/a2a/:companyId/:agentId/sessions/:sessionId", async (req, res) => {
  const companyId = parseInt(req.params.companyId, 10);
  const { agentId, sessionId } = req.params;
  if (isNaN(companyId)) { res.status(400).json({ error: "Invalid companyId" }); return; }
  const tasks = await listTasksForSession(companyId, String(agentId), String(sessionId));
  res.json({ sessionId, agentId, companyId, tasks });
});

// ─── Onboarding Agent — platform-level JSON-RPC endpoint ─────────────────────
// Sits behind verifyAgentCredential, accepts tasks/send with Agent Card JSON payload

router.post("/a2a/onboarding",
  (req, res, next) => requireAgentCredential("onboarding-agent")(req, res, next),
  async (req, res) => {
    const body = req.body as {
      jsonrpc: string;
      id: string | number | null;
      method: string;
      params?: Record<string, unknown>;
    };

    const rpcId = body?.id ?? null;

    if (!body || body.jsonrpc !== "2.0") {
      res.json(jsonRpcError(rpcId, A2A_ERRORS.INVALID_REQUEST));
      return;
    }

    const method = body.method;

    if (method === "tasks/send") {
      const params = body.params ?? {};
      const taskId = params.id as string ?? crypto.randomUUID();
      const sessionId = params.sessionId as string ?? crypto.randomUUID();
      const message = params.message as { role: string; parts: Array<{ type: string; text: string }> };
      const messageText = message?.parts?.[0]?.text ?? "";

      // Parse Agent Card from message text
      let agentCard: Record<string, unknown>;
      try {
        agentCard = JSON.parse(messageText);
      } catch {
        res.json(jsonRpcError(rpcId, A2A_ERRORS.INVALID_PARAMS, "message.parts[0].text must be a JSON-stringified Agent Card"));
        return;
      }

      // Self-onboarding guard — fires before orchestrator
      if (String(agentCard.name ?? "").toLowerCase().includes("onboarding-agent")) {
        res.json(jsonRpcError(rpcId, A2A_ERRORS.SELF_ONBOARDING_DENIED));
        return;
      }

      const externalAgentDid = req.vcPayload?.agentId ?? "unknown";

      const result = await startOnboarding({
        sessionId,
        agentCard: agentCard as unknown as Parameters<typeof startOnboarding>[0]["agentCard"],
        externalAgentDid,
        rpcId,
      });

      if ("error" in result) {
        res.json(result.error);
        return;
      }

      res.json(jsonRpcResult(rpcId, {
        id: taskId,
        sessionId,
        status: { state: "submitted" },
        artifacts: [{ index: 0, parts: [{ type: "text", text: result.artifact }], lastChunk: true }],
        onboarding_id: result.onboardingId,
      }));
      return;
    }

    if (method === "tasks/get") {
      const params = body.params ?? {};
      const { id } = params as { id: string };
      if (!id) { res.json(jsonRpcError(rpcId, A2A_ERRORS.INVALID_PARAMS, "params.id required")); return; }

      // Return onboarding request status as A2A task
      const { db, onboardingRequests } = await import("@workspace/db");
      const { eq } = await import("drizzle-orm");
      const rows = await db.select().from(onboardingRequests).where(eq(onboardingRequests.id, id)).limit(1);
      if (!rows[0]) { res.json(jsonRpcError(rpcId, A2A_ERRORS.TASK_NOT_FOUND)); return; }
      const req_ = rows[0];
      res.json(jsonRpcResult(rpcId, {
        id,
        sessionId: req_.sessionId,
        status: { state: req_.status },
        metadata: { onboarding_status: req_.status, pr_url: req_.prUrl },
      }));
      return;
    }

    res.json(jsonRpcError(rpcId, A2A_ERRORS.METHOD_NOT_FOUND));
  }
);

// ─── Standard A2A JSON-RPC endpoint — 8 governed agents (per-company) ─────────

router.post("/a2a/:companyId/:agentId", (req, res, next) => {
  requireAgentCredential(String(req.params.agentId))(req, res, next);
}, a2aJsonRpcHandler);

export default router;
