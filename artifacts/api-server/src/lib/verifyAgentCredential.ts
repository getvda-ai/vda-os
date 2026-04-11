/**
 * verifyAgentCredential.ts
 * Express middleware that extracts a W3C VC from the Authorization header,
 * verifies the Ed25519Signature2020 proof, and attaches the result to req.
 *
 * Usage: apply to individual agent POST endpoints ONLY (not /scenario/run).
 * On success: req.vcVerified = true, req.vcPayload = { agentId, companyId, ... }
 * On failure: continues with req.vcVerified = false (non-blocking — UI shows badge).
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

/**
 * Parses the Authorization header for a Bearer token that is a JSON-encoded
 * Verifiable Credential, then verifies it using the static document loader.
 * Non-blocking: sets req.vcVerified = false and continues on any error.
 */
export async function verifyAgentCredentialMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  req.vcVerified = false;
  req.vcPayload = null;

  const authHeader = req.headers.authorization ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return next();
  }

  const token = authHeader.slice(7).trim();
  if (!token) return next();

  try {
    const rawVc = JSON.parse(Buffer.from(token, "base64").toString("utf-8")) as Record<string, unknown>;
    const result = await verifyAgentVc(rawVc);
    req.vcVerified = result.verified;
    req.vcPayload = result;
    if (result.verified) {
      logger.info(
        { agentId: result.agentId, companyId: result.companyId },
        "[VC] Agent credential verified"
      );
    } else {
      logger.warn({ error: result.error }, "[VC] Agent credential verification failed");
    }
  } catch (err) {
    logger.warn({ err }, "[VC] Failed to parse Authorization Bearer VC");
  }

  return next();
}
