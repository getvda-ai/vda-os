/**
 * mandateIssuer.ts
 * AP2 (Agent Payments Protocol) Intent Mandate issuance and management.
 *
 * Intent Mandates are cryptographically-signed spending authority grants.
 * They are issued at agent onboarding completion and re-issued at each
 * phase promotion (Crawl → Walk → Run).
 *
 * The mandate replaces the runtime EXCEPTION_AUTHORITY.md ceiling parse
 * with a verifiable, tamper-evident authority object.
 */

import { createHmac, randomUUID } from "node:crypto";
import { db, agentMandates, PHASE_AUTHORIZATION_TIERS, type MandateAuthorization } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { getPlatformIssuer, computeGovernanceHash } from "./agentCredentialIssuer.js";
import { logger } from "./logger.js";

// Mandate validity windows by phase
const MANDATE_VALIDITY_DAYS: Record<string, number> = {
  crawl: 7,    // Short window — frequent review required
  walk: 30,    // Monthly rolling renewal
  run: 90,     // Quarterly review
};

// ─── Sign a mandate payload ───────────────────────────────────────────────────
// Uses HMAC-SHA256 over the canonical mandate JSON using the platform issuer
// key's private key material. This is a simplified signing scheme for platform-
// managed mandates; cross-party exchange would use a full Ed25519 signature.

async function signMandatePayload(payload: Record<string, unknown>): Promise<string> {
  const issuer = await getPlatformIssuer();
  // Export private key bytes from the Ed25519 keypair for HMAC derivation.
  // @digitalbazaar/ed25519-verification-key-2020 exports `privateKeyMultibase` (z-prefixed multibase).
  const exported = await issuer.key.export({ privateKey: true }) as { privateKeyMultibase?: string; privateKeyBase58?: string };
  const keyMaterial = exported.privateKeyMultibase ?? exported.privateKeyBase58 ?? issuer.did;
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  return createHmac("sha256", keyMaterial).update(canonical).digest("hex");
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface IssueMandateInput {
  agentId: string;
  companyId: number;
  agentDid: string;
  phase: string;
  onboardingId?: string;
}

export interface IssuedMandateResult {
  mandateId: string;
  phase: string;
  authorizations: MandateAuthorization[];
  validUntil: Date;
  signature: string;
  dbId: number;
}

/**
 * Issue a new Intent Mandate for an agent at the given phase.
 * Revokes any existing active mandates for this agent+company first.
 */
export async function issueMandate(input: IssueMandateInput): Promise<IssuedMandateResult> {
  const { agentId, companyId, agentDid, phase, onboardingId } = input;

  // Revoke existing active mandates
  await db
    .update(agentMandates)
    .set({ revoked: true, revokedAt: new Date(), revokedReason: `replaced — phase promotion to ${phase}` })
    .where(
      and(
        eq(agentMandates.agentId, agentId),
        eq(agentMandates.companyId, companyId),
        eq(agentMandates.revoked, false)
      )
    );

  const issuer = await getPlatformIssuer();
  const governanceHash = await computeGovernanceHash(companyId, agentId);
  const authorizations: MandateAuthorization[] = PHASE_AUTHORIZATION_TIERS[phase] ?? [];

  const now = new Date();
  const validDays = MANDATE_VALIDITY_DAYS[phase] ?? 30;
  const validUntil = new Date(now.getTime() + validDays * 24 * 3600 * 1000);
  const mandateId = `im_vda_${agentId.replace(/[^a-z0-9]/g, "_")}_${companyId}_${Date.now()}`;

  // Build the signable payload
  const payload = {
    mandateId,
    agentId,
    companyId,
    agentDid,
    issuerDid: issuer.did,
    phase,
    authorizations,
    linkedGovernanceHash: governanceHash ?? "NO_GOVERNANCE_FILES",
    issuedAt: now.toISOString(),
    validUntil: validUntil.toISOString(),
  };

  const signature = await signMandatePayload(payload);

  const [row] = await db
    .insert(agentMandates)
    .values({
      mandateId,
      agentId,
      companyId,
      agentDid,
      issuerDid: issuer.did,
      phase,
      authorizations,
      linkedGovernanceHash: governanceHash,
      signature,
      issuedAt: now,
      validUntil,
      revoked: false,
      onboardingId: onboardingId ?? null,
    })
    .returning({ id: agentMandates.id });

  logger.info({ mandateId, agentId, companyId, phase, authCount: authorizations.length }, "[Mandate] Intent mandate issued");

  return {
    mandateId,
    phase,
    authorizations,
    validUntil,
    signature,
    dbId: row.id,
  };
}

/**
 * Get the active (non-revoked, non-expired) mandate for an agent.
 * Returns null if no valid mandate exists (agent must operate in HITL-required mode).
 * @deprecated Prefer getMandateWithStatus for new code — it surfaces explicit revoked/expired states.
 */
export async function getActiveMandate(agentId: string, companyId: number) {
  const now = new Date();
  const [row] = await db
    .select()
    .from(agentMandates)
    .where(
      and(
        eq(agentMandates.agentId, agentId),
        eq(agentMandates.companyId, companyId),
        eq(agentMandates.revoked, false)
      )
    )
    .orderBy(desc(agentMandates.issuedAt))
    .limit(1);

  if (!row) return null;
  if (new Date(row.validUntil) < now) return null;
  return row;
}

// ─── Status-aware mandate retrieval ──────────────────────────────────────────

export type MandateStatus = "active" | "revoked" | "expired" | "not_found";

export interface MandateWithStatus {
  status: MandateStatus;
  mandate?: typeof agentMandates.$inferSelect;
}

/**
 * Retrieve the most recent mandate for an agent and surface its explicit lifecycle status.
 * Unlike getActiveMandate, this never collapses revoked/expired into null — callers can
 * distinguish between the four states and return differentiated HTTP responses.
 */
export async function getMandateWithStatus(
  agentId: string,
  companyId: number
): Promise<MandateWithStatus> {
  const [row] = await db
    .select()
    .from(agentMandates)
    .where(
      and(
        eq(agentMandates.agentId, agentId),
        eq(agentMandates.companyId, companyId)
      )
    )
    .orderBy(desc(agentMandates.issuedAt))
    .limit(1);

  if (!row) return { status: "not_found" };
  if (row.revoked) return { status: "revoked", mandate: row };
  if (new Date(row.validUntil) < new Date()) return { status: "expired", mandate: row };
  return { status: "active", mandate: row };
}

/**
 * Verify the HMAC-SHA256 signature on a stored mandate row.
 *
 * Re-constructs the canonical payload that was signed at issuance time and
 * computes the expected HMAC using the platform issuer key.  Returns false
 * (fail-closed) on any error including key unavailability.
 *
 * Note: mandates use HMAC-SHA256 over the platform Ed25519 key material —
 * equivalent tamper-detection for platform-internal authority grants.
 * Cross-party exchange would use a full Ed25519 detached signature.
 */
export async function verifyMandateSignature(
  mandate: typeof agentMandates.$inferSelect
): Promise<boolean> {
  try {
    const toDate = (v: unknown): Date =>
      v instanceof Date ? v : new Date(String(v));

    const payload = {
      mandateId:            mandate.mandateId,
      agentId:              mandate.agentId,
      companyId:            mandate.companyId,
      agentDid:             mandate.agentDid,
      issuerDid:            mandate.issuerDid,
      phase:                mandate.phase,
      authorizations:       mandate.authorizations,
      linkedGovernanceHash: mandate.linkedGovernanceHash ?? "NO_GOVERNANCE_FILES",
      issuedAt:             toDate(mandate.issuedAt).toISOString(),
      validUntil:           toDate(mandate.validUntil).toISOString(),
    };

    const expectedSig = await signMandatePayload(payload);
    const valid = expectedSig === mandate.signature;
    if (!valid) {
      logger.warn(
        { mandateId: mandate.mandateId, agentId: mandate.agentId },
        "[Mandate] Signature mismatch — possible tampering"
      );
    }
    return valid;
  } catch (err) {
    logger.warn({ err, mandateId: mandate.mandateId }, "[Mandate] Signature verification error (fail-closed)");
    return false;
  }
}

/**
 * Check if a proposed action+value is within the mandate's authorization ceiling.
 * Returns: { allowed: true } or { allowed: false, ceiling, required, action }
 */
export function checkMandateCeiling(
  mandate: typeof agentMandates.$inferSelect,
  action: string,
  value?: number
): { allowed: boolean; ceiling?: number; unit?: string; currency?: string } {
  const authorizations = mandate.authorizations as MandateAuthorization[];

  // Crawl phase: no standing authority
  if (!authorizations || authorizations.length === 0) {
    return { allowed: false };
  }

  const auth = authorizations.find(a => a.action === action);
  if (!auth) {
    // Action not in mandate — not authorized
    return { allowed: false };
  }

  if (auth.ceiling === null) {
    // Null ceiling = no limit for this action
    return { allowed: true };
  }

  if (value === undefined) {
    // Action is authorized but no value to check
    return { allowed: true, ceiling: auth.ceiling, unit: auth.unit, currency: auth.currency };
  }

  const allowed = value <= auth.ceiling;
  return { allowed, ceiling: auth.ceiling, unit: auth.unit, currency: auth.currency };
}

/**
 * Revoke a mandate by ID.
 */
export async function revokeMandate(mandateId: string, reason: string): Promise<void> {
  await db
    .update(agentMandates)
    .set({ revoked: true, revokedAt: new Date(), revokedReason: reason })
    .where(eq(agentMandates.mandateId, mandateId));
  logger.info({ mandateId, reason }, "[Mandate] Mandate revoked");
}
