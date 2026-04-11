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

// Extend Express Request with VC fields
declare module "express-serve-static-core" {
  interface Request {
    vcVerified: boolean;
    vcPayload: VerificationResult | null;
  }
}

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
 * 3. Verify Ed25519Signature2020 proof — 401 if invalid
 * 4. Check VC expiration — 401 if expired
 * 5. Recompute governance hash (AGENTS+SKILL) — 401 if mismatch
 * 6. Set req.vcVerified + req.vcPayload, call next()
 */
export async function verifyAgentCredentialMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
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

  // Extract companyId from request body for hash recomputation
  const companyId = Number((req.body as Record<string, unknown>)["companyId"] ?? 0) || undefined;

  // Steps 3–5: cryptographic verification + expiry + hash comparison
  let result: VerificationResult;
  try {
    result = await verifyAgentVc(rawVc, companyId);
  } catch (err) {
    logger.warn({ err }, "[VC-Middleware] verifyAgentVc threw unexpectedly");
    unauthorised(res, "VERIFICATION_ERROR", null, "Internal verification error");
    return;
  }

  if (!result.verified) {
    logger.warn({ reason: result.reason, agentId: result.agentId, companyId }, "[VC-Middleware] Credential rejected");
    unauthorised(
      res,
      result.reason ?? "VERIFICATION_FAILED",
      result.agentId ?? null,
      result.error ?? "Credential verification failed"
    );
    return;
  }

  // All checks passed
  req.vcVerified = true;
  req.vcPayload = result;
  logger.info({ agentId: result.agentId, companyId: result.companyId }, "[VC-Middleware] Credential accepted");
  return next();
}
