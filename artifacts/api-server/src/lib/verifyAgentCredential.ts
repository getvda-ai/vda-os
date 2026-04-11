/**
 * verifyAgentCredential.ts
 * Express middleware that HARD-BLOCKS requests without a valid W3C VC.
 *
 * Applied to the 8 individual agent POST endpoints (NOT /scenario/run).
 * Returns 401 JSON on any failure:
 *   { error: string, agent_id: string|null, reason: string, timestamp: string }
 *
 * On success: sets req.vcVerified = true, req.vcPayload = { agentId, companyId, governanceFileHash, ... }
 * and calls next().
 *
 * Token transport: Authorization: Bearer <base64url-encoded JSON VC>
 */

import type { Request, Response, NextFunction } from "express";
import { verifyAgentVc, type VerificationResult } from "./agentCredentialIssuer.js";
import { logger } from "./logger.js";


function unauthorised(
  res: Response,
  reason: string,
  agentId: string | null,
  detail: string
): void {
  res.status(401).json({
    error: `Agent credential required: ${detail}`,
    agent_id: agentId,
    reason,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Hard-blocking VC middleware.
 *
 * Token format: Authorization: Bearer <base64url(JSON.stringify(signedVc))>
 *
 * Steps:
 * 1. Extract bearer token — 401 if missing
 * 2. Decode base64url → JSON VC — 401 if malformed
 * 3. Tenant binding: credentialSubject.companyId must equal request.companyId — 401 if mismatch
 * 4. Verify Ed25519Signature2020 proof — 401 if invalid
 * 5. Check VC expiration — 401 if expired
 * 6. Recompute governance hash (AGENTS+SKILL) — 401 if mismatch
 * 7. (If expectedAgentId provided) Verify credentialSubject.agentId matches route agent — 401 if mismatch
 * 8. Set req.vcVerified + req.vcPayload, call next()
 */
async function runVerification(
  req: Request,
  res: Response,
  next: NextFunction,
  expectedAgentId?: string
): Promise<void> {
  req.vcVerified = false;
  req.vcPayload = null;

  // Step 1: extract bearer token
  const authHeader = req.headers.authorization ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    unauthorised(res, "MISSING_CREDENTIAL", null, "No Authorization: Bearer credential presented");
    return;
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    unauthorised(res, "MISSING_CREDENTIAL", null, "Empty bearer token");
    return;
  }

  // Step 2: decode base64url and parse JSON VC
  let rawVc: Record<string, unknown>;
  try {
    const json = Buffer.from(token, "base64url").toString("utf-8");
    rawVc = JSON.parse(json) as Record<string, unknown>;
  } catch {
    unauthorised(res, "MALFORMED_CREDENTIAL", null, "Bearer token is not valid base64url JSON");
    return;
  }

  // Step 3: Extract company_id from the VC's credentialSubject — NOT from request body.
  // This ensures tenant binding cannot be bypassed by omitting companyId from the request.
  const credentialSubject = (rawVc["credentialSubject"] ?? null) as
    | Record<string, unknown>
    | Record<string, unknown>[]
    | null;
  const subject = Array.isArray(credentialSubject) ? credentialSubject[0] : credentialSubject;
  const vcCompanyRaw = subject?.["company_id"];
  const vcCompanyId = Number(vcCompanyRaw);
  if (!Number.isFinite(vcCompanyId) || vcCompanyId <= 0) {
    unauthorised(res, "MISSING_COMPANY_ID", null, "Credential missing valid company_id in credentialSubject");
    return;
  }

  // If the request body carries a companyId, it must match the VC's company_id
  const reqCompanyRaw = (req.body as Record<string, unknown> | undefined)?.["companyId"];
  if (reqCompanyRaw !== undefined && reqCompanyRaw !== null && reqCompanyRaw !== "") {
    const reqCompanyId = Number(reqCompanyRaw);
    if (!Number.isFinite(reqCompanyId) || reqCompanyId !== vcCompanyId) {
      logger.warn({ reqCompanyId, vcCompanyId }, "[VC-Middleware] Request companyId does not match VC company_id");
      unauthorised(
        res,
        "COMPANY_ID_MISMATCH",
        null,
        `Request companyId '${String(reqCompanyRaw)}' does not match VC company_id '${vcCompanyId}'`
      );
      return;
    }
  }

  // Steps 4–6: cryptographic verification + expiry + governance hash comparison
  // Always pass vcCompanyId (from the VC) — never undefined
  let result: VerificationResult;
  try {
    result = await verifyAgentVc(rawVc, vcCompanyId);
  } catch (err) {
    logger.warn({ err }, "[VC-Middleware] verifyAgentVc threw unexpectedly");
    unauthorised(res, "VERIFICATION_ERROR", null, "Internal verification error");
    return;
  }

  if (!result.verified) {
    logger.warn({ reason: result.reason, agentId: result.agentId, vcCompanyId }, "[VC-Middleware] Credential rejected");
    unauthorised(
      res,
      result.reason ?? "VERIFICATION_FAILED",
      result.agentId ?? null,
      result.error ?? "Credential verification failed"
    );
    return;
  }

  // Step 7: per-route agent identity binding — reject cross-agent credential replay
  if (expectedAgentId) {
    if (!result.agentId) {
      logger.warn({ expectedAgentId, vcCompanyId }, "[VC-Middleware] Credential missing agentId claim");
      unauthorised(res, "MISSING_AGENT_ID", null, "Credential missing agentId in credentialSubject");
      return;
    }
    if (result.agentId !== expectedAgentId) {
      logger.warn(
        { expectedAgentId, vcAgentId: result.agentId, vcCompanyId },
        "[VC-Middleware] Cross-agent credential replay blocked"
      );
      unauthorised(
        res,
        "AGENT_ID_MISMATCH",
        result.agentId,
        `Credential issued for agent '${result.agentId}' but presented to '${expectedAgentId}' endpoint`
      );
      return;
    }
  }

  // All checks passed
  req.vcVerified = true;
  req.vcPayload = result;
  logger.info({ agentId: result.agentId, companyId: result.companyId, expectedAgentId }, "[VC-Middleware] Credential accepted");
  return next();
}

/**
 * Generic middleware (no per-route agent binding).
 * Use requireAgentCredential(agentId) for individual routes instead.
 */
export async function verifyAgentCredentialMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  return runVerification(req, res, next);
}

/**
 * Route-specific middleware factory.
 * Verifies the credential AND enforces that credentialSubject.agentId === expectedAgentId.
 * This prevents cross-agent credential replay within the same company.
 *
 * Usage: router.post("/agents/checkout", requireAgentCredential("checkout-agent"), handler)
 */
export function requireAgentCredential(expectedAgentId: string) {
  return function agentCredentialGuard(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    return runVerification(req, res, next, expectedAgentId);
  };
}
