/**
 * Onboarding Rollback — POST /api/onboarding/:id/rollback
 * Requires X-Compliance-Officer-Key header.
 */
import { Router, type IRouter } from "express";
import { db, onboardingRequests } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { writeWitnessEntry } from "../lib/witnessWriter.js";
import { deregisterDynamicAgent } from "./onboardingOrchestrator.js";

const router: IRouter = Router();

const PLATFORM_COMPANY_ID = 0;

// ─── POST /api/onboarding/:id/rollback ───────────────────────────────────────

router.post("/onboarding/:id/rollback", async (req, res) => {
  const apiKey = req.headers["x-compliance-officer-key"];
  const expectedKey = process.env.COMPLIANCE_OFFICER_API_KEY;

  if (!expectedKey || apiKey !== expectedKey) {
    res.status(401).json({
      error: "Unauthorized",
      detail: "X-Compliance-Officer-Key header required. Enterprise deployments should replace this with Entra ID auth.",
    });
    return;
  }

  const { id } = req.params;
  const { reason = "Manual rollback by Compliance Officer" } = req.body as { reason?: string };

  try {
    const rows = await db.select().from(onboardingRequests).where(eq(onboardingRequests.id, String(id))).limit(1);
    const req_ = rows[0];

    if (!req_) {
      res.status(404).json({ error: "Onboarding request not found" });
      return;
    }

    if (req_.status !== "onboarded") {
      res.status(400).json({
        error: "Cannot rollback",
        detail: `Onboarding request status is "${req_.status}" — only "onboarded" requests can be rolled back`,
      });
      return;
    }

    const agentCard = req_.agentCard as Record<string, unknown>;
    const agentId = String(agentCard.name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    let revertPrUrl: string | null = null;

    // Create revert PR if GitHub credentials available
    if (req_.prNumber && process.env.GITHUB_TOKEN && process.env.GITHUB_GOVERNANCE_REPO) {
      try {
        const { Octokit } = await import("@octokit/rest");
        const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
        const [owner, repo] = process.env.GITHUB_GOVERNANCE_REPO.split("/");

        const { data: pr } = await octokit.pulls.create({
          owner,
          repo,
          title: `Revert "Agent Onboarding: ${agentCard.name}"`,
          body: `Reverts PR #${req_.prNumber}.\n\nRollback reason: ${reason}\n\nInitiated by Compliance Officer. Agent VC will expire within 24 hours of revocation.`,
          head: `revert-${req_.prNumber}-${Date.now()}`,
          base: "main",
        });
        revertPrUrl = pr.html_url;
        logger.info({ revertPrUrl, prNumber: req_.prNumber }, "Revert PR created");
      } catch (ghErr) {
        logger.warn({ ghErr }, "GitHub revert PR creation failed — continuing rollback");
      }
    }

    // Revoke VC
    try {
      const REPLIT_URL = process.env.REPLIT_DEV_DOMAIN
        ? `https://${process.env.REPLIT_DEV_DOMAIN}`
        : process.env.REPLIT_URL ?? "http://localhost:8080";
      const revokeRes = await fetch(`${REPLIT_URL}/api/agents/credentials/${agentId}`, {
        method: "DELETE",
      });
      if (!revokeRes.ok) {
        logger.warn({ agentId }, "VC revocation returned non-OK status");
      }
    } catch (vcErr) {
      logger.warn({ vcErr, agentId }, "VC revocation failed — VC will expire naturally within 24h");
    }

    // Deregister from dynamic agent registry
    deregisterDynamicAgent(agentId);

    // Update status
    await db.update(onboardingRequests)
      .set({ status: "rolled_back", updatedAt: new Date() })
      .where(eq(onboardingRequests.id, String(id)));

    // Witness entry
    await writeWitnessEntry({
      companyId: PLATFORM_COMPANY_ID,
      agent: "onboarding-agent",
      decision: {
        decision: "PASS",
        clauseApplied: "Onboarding Agent §rollback — MUST create rollback reference before any production commit",
        actionProposed: "Agent offboarded and VC revoked",
        exceptionApplied: false,
        escalationTarget: null,
        reasoning: reason,
      },
      fileReferenced: "AGENTS.md",
      apaleoData: {
        event_type: "agent_offboarded",
        onboarding_id: id,
        agent_id: agentId,
        pr_number: req_.prNumber ?? "n/a",
        revert_pr_url: revertPrUrl ?? "not_created",
        rolled_back_by: "Compliance Officer",
        reason,
      },
      credentialVerified: true,
    });

    logger.info({ id, agentId, revertPrUrl }, "Onboarding rollback complete");

    res.json({
      status: "rolled_back",
      onboarding_id: id,
      agent_id: agentId,
      revert_pr_url: revertPrUrl,
      vc_revoked: true,
      registry_removed: true,
      note: "Agent VC will expire within 24 hours if revocation call failed. Revert PR must be manually merged.",
    });
  } catch (err) {
    logger.error({ err, id }, "Rollback error");
    res.status(500).json({ error: "Rollback failed", detail: String(err) });
  }
});

// ─── GET /api/onboarding — list all requests ─────────────────────────────────

router.get("/onboarding", async (_req, res) => {
  try {
    const all = await db
      .select()
      .from(onboardingRequests)
      .orderBy(onboardingRequests.createdAt);
    res.json({ requests: all, count: all.length });
  } catch (err) {
    logger.error({ err }, "Onboarding list error");
    res.status(500).json({ error: "Failed to list onboarding requests" });
  }
});

// ─── GET /api/onboarding/:id — single request (full dossier for HITL approvers)

router.get("/onboarding/:id", async (req, res) => {
  try {
    const { sql } = await import("drizzle-orm");
    const result = await db.execute(
      sql`SELECT id, session_id, external_agent_did, agent_card, impact_delta_report,
               candidate_files, eval_pass_rate, status, created_at, updated_at,
               first_hitl_token, first_hitl_outcome, first_hitl_decided_at,
               second_hitl_token, second_hitl_outcome, second_hitl_decided_at,
               pr_number, pr_url
          FROM onboarding_requests WHERE id = ${String(req.params.id)} LIMIT 1`
    );
    if (!result.rows[0]) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const row = result.rows[0] as Record<string, unknown>;
    res.json({
      id: row.id,
      status: row.status,
      externalAgentDid: row.external_agent_did,
      agentCard: row.agent_card,
      impactDeltaReport: row.impact_delta_report,
      candidateFiles: row.candidate_files,
      evalPassRate: row.eval_pass_rate,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      prNumber: row.pr_number,
      prUrl: row.pr_url,
      firstHitlToken: row.first_hitl_token,
      firstHitlOutcome: row.first_hitl_outcome,
      firstHitlDecidedAt: row.first_hitl_decided_at,
      secondHitlToken: row.second_hitl_token,
      secondHitlOutcome: row.second_hitl_outcome,
    });
  } catch (err) {
    logger.error({ err }, "Onboarding get error");
    res.status(500).json({ error: "Failed to get onboarding request" });
  }
});

export default router;
