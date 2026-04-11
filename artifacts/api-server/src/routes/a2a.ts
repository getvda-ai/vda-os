import { Router } from "express";
import { getAgentCard, getAllAgentCards, getPlatformCard, AGENT_IDS } from "../a2a/agentCardRegistry.js";
import { a2aJsonRpcHandler } from "../a2a/a2aHandler.js";
import { listTasksForCompany, listTasksForSession } from "../a2a/taskStore.js";
import { requireAgentCredential } from "../lib/verifyAgentCredential.js";
import { logger } from "../lib/logger.js";

const router = Router();

// Platform-level Agent Card (well-known)
router.get("/well-known/agent.json", (_req, res) => {
  res.json(getPlatformCard());
});

// All 8 agent cards for a property
router.get("/a2a/:companyId/agents", async (req, res) => {
  const companyId = parseInt(req.params.companyId, 10);
  if (isNaN(companyId)) { res.status(400).json({ error: "Invalid companyId" }); return; }
  const cards = await getAllAgentCards(companyId);
  res.json({ companyId, agents: cards });
});

// Single agent card
router.get("/a2a/:companyId/:agentId/agent.json", async (req, res) => {
  const companyId = parseInt(req.params.companyId, 10);
  const { agentId } = req.params;
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
  const tasks = await listTasksForSession(companyId, agentId, sessionId);
  res.json({ sessionId, agentId, companyId, tasks });
});

// A2A JSON-RPC endpoint — requires VC (per-agent binding)
router.post("/a2a/:companyId/:agentId", (req, res, next) => {
  requireAgentCredential(String(req.params.agentId))(req, res, next);
}, a2aJsonRpcHandler);

export default router;
