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
// Uses a proper Ed25519 detached signature over the canonical mandate JSON.
// Signing uses the platform issuer's private key; verification uses the public key only.
// Signature is encoded as 128-char lowercase hex (64 bytes × 2).
//
// Legacy: pre-migration mandates were signed with HMAC-SHA256 (64-char hex).
// verifyMandateSignature detects the format and routes to the correct verifier.

const CANONICAL_KEYS = [
  "mandateId", "agentId", "companyId", "agentDid", "issuerDid",
  "phase", "authorizations", "linkedGovernanceHash", "issuedAt", "validUntil",
];

function canonicalize(payload: Record<string, unknown>): Uint8Array {
  const ordered: Record<string, unknown> = {};
  for (const k of CANONICAL_KEYS) ordered[k] = payload[k];
  return new TextEncoder().encode(JSON.stringify(ordered));
}

async function signMandatePayload(payload: Record<string, unknown>): Promise<string> {
  const issuer = await getPlatformIssuer();
  const signer = issuer.key.signer() as { sign(args: { data: Uint8Array }): Promise<Uint8Array> };
  const sigBytes = await signer.sign({ data: canonicalize(payload) });
  return Buffer.from(sigBytes).toString("hex");
}

// Legacy HMAC verifier — used only during migration for pre-Ed25519 mandates
async function verifyLegacyHmac(mandate: typeof agentMandates.$inferSelect): Promise<boolean> {
  try {
    const issuer = await getPlatformIssuer();
    const exported = await issuer.key.export({ privateKey: true }) as { privateKeyMultibase?: string; privateKeyBase58?: string };
    const keyMaterial = exported.privateKeyMultibase ?? exported.privateKeyBase58 ?? issuer.did;
    const payload: Record<string, unknown> = {
      mandateId:            mandate.mandateId,
      agentId:              mandate.agentId,
      companyId:            mandate.companyId,
      agentDid:             mandate.agentDid,
      issuerDid:            mandate.issuerDid,
      phase:                mandate.phase,
      authorizations:       mandate.authorizations,
      linkedGovernanceHash: mandate.linkedGovernanceHash ?? "NO_GOVERNANCE_FILES",
      issuedAt:             toIso(mandate.issuedAt),
      validUntil:           toIso(mandate.validUntil),
    };
    const canonical = JSON.stringify(payload, Object.keys(payload).sort());
    const expected = createHmac("sha256", keyMaterial).update(canonical).digest("hex");
    return expected === mandate.signature;
  } catch {
    return false;
  }
}

function toIso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();
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

  const insertValues = {
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
  };

  const [row] = await db.transaction(async (tx) => {
    await tx
      .update(agentMandates)
      .set({ revoked: true, revokedAt: new Date(), revokedReason: `replaced — phase promotion to ${phase}` })
      .where(
        and(
          eq(agentMandates.agentId, agentId),
          eq(agentMandates.companyId, companyId),
          eq(agentMandates.revoked, false)
        )
      );
    return tx.insert(agentMandates).values(insertValues).returning({ id: agentMandates.id });
  });

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
 * Uses the Ed25519 public key via `issuer.key.verifier()` — private key material
 * is never involved in verification.  Returns false (fail-closed) on any error.
 *
 * Format detection:
 *   128-char hex → new Ed25519 signature (verify with public key)
 *   64-char hex  → legacy HMAC-SHA256 signature (verify with HMAC for backward compat)
 */
export async function verifyMandateSignature(
  mandate: typeof agentMandates.$inferSelect
): Promise<boolean> {
  try {
    // Legacy HMAC-SHA256 mandates (pre-Ed25519 migration): 64-char hex
    if (/^[0-9a-f]{64}$/.test(mandate.signature)) {
      return verifyLegacyHmac(mandate);
    }

    // Ed25519 mandates: 128-char hex
    const payload: Record<string, unknown> = {
      mandateId:            mandate.mandateId,
      agentId:              mandate.agentId,
      companyId:            mandate.companyId,
      agentDid:             mandate.agentDid,
      issuerDid:            mandate.issuerDid,
      phase:                mandate.phase,
      authorizations:       mandate.authorizations,
      linkedGovernanceHash: mandate.linkedGovernanceHash ?? "NO_GOVERNANCE_FILES",
      issuedAt:             toIso(mandate.issuedAt),
      validUntil:           toIso(mandate.validUntil),
    };

    const issuer = await getPlatformIssuer();
    const verifier = issuer.key.verifier() as {
      verify(args: { data: Uint8Array; signature: Uint8Array }): Promise<boolean>;
    };
    const valid = await verifier.verify({
      data:      canonicalize(payload),
      signature: Buffer.from(mandate.signature, "hex"),
    });

    if (!valid) {
      logger.warn(
        { mandateId: mandate.mandateId, agentId: mandate.agentId },
        "[Mandate] Ed25519 signature mismatch — possible tampering"
      );
    }
    return valid;
  } catch (err) {
    logger.warn({ err, mandateId: mandate.mandateId }, "[Mandate] Signature verification error (fail-closed)");
    return false;
  }
}

/**
 * Re-issue any active mandates that still carry legacy HMAC-SHA256 signatures.
 * Called once at server startup — idempotent and safe to run repeatedly.
 * After migration all active mandates have proper Ed25519 signatures.
 */
export async function reissueMandatesIfLegacy(): Promise<void> {
  const legacyPattern = /^[0-9a-f]{64}$/;
  const now = new Date();

  const rows = await db
    .select()
    .from(agentMandates)
    .where(eq(agentMandates.revoked, false));

  const legacy = rows.filter(
    r => legacyPattern.test(r.signature) && new Date(r.validUntil) > now
  );

  if (legacy.length === 0) {
    logger.debug("[Mandate] No legacy HMAC mandates found — Ed25519 migration not required");
    return;
  }

  logger.info({ count: legacy.length }, "[Mandate] Re-issuing legacy HMAC-signed mandates with Ed25519");

  for (const m of legacy) {
    try {
      await issueMandate({
        agentId:      m.agentId,
        companyId:    m.companyId,
        agentDid:     m.agentDid,
        phase:        m.phase,
        onboardingId: m.onboardingId ?? undefined,
      });
    } catch (err) {
      logger.warn({ err, agentId: m.agentId, companyId: m.companyId },
        "[Mandate] Failed to re-issue legacy mandate — skipping");
    }
  }

  logger.info({ count: legacy.length }, "[Mandate] Ed25519 mandate migration complete");

  // Orphan recovery: verify every processed pair now has an active mandate.
  // If not (e.g. prior run revoked without inserting), re-issue once more.
  const orphans: typeof legacy = [];
  for (const m of legacy) {
    const { status } = await getMandateWithStatus(m.agentId, m.companyId);
    if (status !== "active") orphans.push(m);
  }

  if (orphans.length > 0) {
    logger.warn({ count: orphans.length }, "[Mandate] Orphaned agents detected after migration — re-issuing");
    for (const m of orphans) {
      try {
        await issueMandate({
          agentId:      m.agentId,
          companyId:    m.companyId,
          agentDid:     m.agentDid,
          phase:        m.phase,
          onboardingId: m.onboardingId ?? undefined,
        });
        logger.info({ agentId: m.agentId, companyId: m.companyId }, "[Mandate] Orphan recovered — Ed25519 mandate issued");
      } catch (err) {
        logger.error({ err, agentId: m.agentId, companyId: m.companyId },
          "[Mandate] Orphan recovery failed — agent has no active mandate");
      }
    }
  }
}

/**
 * Startup health check: find every (agentId, companyId) pair that has mandate history
 * but no currently active mandate, and re-issue one. Fixes agents left orphaned by
 * any prior non-transactional revoke+insert failure.
 */
export async function recoverOrphanedMandates(): Promise<void> {
  const pairs = await db
    .selectDistinct({ agentId: agentMandates.agentId, companyId: agentMandates.companyId })
    .from(agentMandates);

  const orphans: Array<{ agentId: string; companyId: number; agentDid: string; phase: string; onboardingId: string | null }> = [];

  for (const { agentId, companyId } of pairs) {
    const { status } = await getMandateWithStatus(agentId, companyId);
    if (status !== "active") {
      const [latest] = await db
        .select()
        .from(agentMandates)
        .where(and(eq(agentMandates.agentId, agentId), eq(agentMandates.companyId, companyId)))
        .orderBy(desc(agentMandates.issuedAt))
        .limit(1);
      if (latest) {
        orphans.push({ agentId, companyId, agentDid: latest.agentDid, phase: latest.phase, onboardingId: latest.onboardingId ?? null });
      }
    }
  }

  if (orphans.length === 0) {
    logger.debug("[Mandate] Orphan check: all agents have active mandates");
    return;
  }

  logger.warn({ count: orphans.length }, "[Mandate] Orphan recovery: agents with no active mandate — re-issuing");
  for (const o of orphans) {
    try {
      await issueMandate({ agentId: o.agentId, companyId: o.companyId, agentDid: o.agentDid, phase: o.phase, onboardingId: o.onboardingId ?? undefined });
      logger.info({ agentId: o.agentId, companyId: o.companyId }, "[Mandate] Orphan recovered — Ed25519 mandate issued");
    } catch (err) {
      logger.error({ err, agentId: o.agentId, companyId: o.companyId }, "[Mandate] Orphan recovery failed");
    }
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
