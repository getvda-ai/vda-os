/**
 * agentCredentialIssuer.ts
 * W3C Verifiable Credential issuance and verification for VDA-MK agent identity.
 *
 * Requirement A: Ed25519Signature2020 suite (RFC 8037)
 * Requirement B: Static document loader (vcDocumentLoader)
 * Requirement C: All custom fields inside credentialSubject
 */

import { Ed25519Signature2020 } from "@digitalbazaar/ed25519-signature-2020";
import { Ed25519VerificationKey2020 } from "@digitalbazaar/ed25519-verification-key-2020";
import * as vc from "@digitalbazaar/vc";
import { createHash } from "node:crypto";
import { db, agentCredentials, governanceFiles } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { vcDocumentLoader, VDA_CONTEXT_URL } from "./vcDocumentLoader.js";
import { logger } from "./logger.js";

// ─── Platform Issuer Key (singleton, rotated by scheduler) ───────────────────
// Stored in memory only — all issued VCs carry the public key in the DID.

interface PlatformIssuerKey {
  key: Ed25519VerificationKey2020;
  did: string;
  createdAt: Date;
}

let _platformIssuer: PlatformIssuerKey | null = null;

export async function getPlatformIssuer(): Promise<PlatformIssuerKey> {
  if (!_platformIssuer) {
    _platformIssuer = await rotatePlatformIssuer();
  }
  return _platformIssuer;
}

export async function rotatePlatformIssuer(): Promise<PlatformIssuerKey> {
  const key = await Ed25519VerificationKey2020.generate();
  const did = `did:key:${key.fingerprint()}`;
  key.id = `${did}#${key.fingerprint()}`;
  key.controller = did;
  _platformIssuer = { key, did, createdAt: new Date() };
  logger.info({ did }, "[VC] Platform issuer key rotated");
  return _platformIssuer;
}

// ─── Governance File Hash ─────────────────────────────────────────────────────

export async function getGovernanceFileHash(
  companyId: number,
  agentId: string
): Promise<string | null> {
  const rows = await db
    .select({ content: governanceFiles.content, filename: governanceFiles.filename })
    .from(governanceFiles)
    .where(
      and(
        eq(governanceFiles.companyId, companyId),
        eq(governanceFiles.agentId, agentId),
        eq(governanceFiles.isArchived, false)
      )
    );

  if (rows.length === 0) return null;

  const combined = rows
    .sort((a, b) => a.filename.localeCompare(b.filename))
    .map((r) => r.content)
    .join("\n");

  return createHash("sha256").update(combined).digest("hex");
}

// ─── Issue a Verifiable Credential for an agent ───────────────────────────────

export interface IssueCredentialInput {
  agentId: string;
  companyId: number;
  permittedSkills?: string[];
  domainOwner?: string;
  ttlHours?: number;
}

export interface IssuedCredentialResult {
  credentialId: number;
  did: string;
  signedVc: Record<string, unknown>;
  expiresAt: Date;
  governanceFileHash: string | null;
}

export async function issueAgentCredential(
  input: IssueCredentialInput
): Promise<IssuedCredentialResult> {
  const { agentId, companyId, permittedSkills = [], domainOwner = "", ttlHours = 24 } = input;

  // Revoke any existing active credentials for this agent+company
  await db
    .update(agentCredentials)
    .set({ revoked: true, revokedAt: new Date(), revokedReason: "replaced" })
    .where(
      and(
        eq(agentCredentials.agentId, agentId),
        eq(agentCredentials.companyId, companyId),
        eq(agentCredentials.revoked, false)
      )
    );

  // Generate a fresh per-agent key pair (agent's own DID identity)
  const agentKey = await Ed25519VerificationKey2020.generate();
  const agentDid = `did:key:${agentKey.fingerprint()}`;

  // Get governance file hash for this agent
  const governanceFileHash = await getGovernanceFileHash(companyId, agentId);

  // Platform issuer signs the credential
  const issuer = await getPlatformIssuer();

  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlHours * 3600 * 1000);

  // Build the credential — all custom fields inside credentialSubject (Requirement C)
  const credential = {
    "@context": [
      "https://www.w3.org/2018/credentials/v1",
      Ed25519Signature2020.CONTEXT_URL,
      VDA_CONTEXT_URL,
    ],
    type: ["VerifiableCredential", "AgentGovernanceCredential"],
    issuer: issuer.did,
    issuanceDate: now.toISOString(),
    expirationDate: expiresAt.toISOString(),
    credentialSubject: {
      id: agentDid,
      agentId,
      companyId: String(companyId),
      governanceFileHash: governanceFileHash ?? "NO_GOVERNANCE_FILES",
      domainOwner,
      permittedSkills,
      issuedFor: "VDA-MK Apaleo Agent Runtime",
      rotationSchedule: "24h",
    },
  };

  const suite = new Ed25519Signature2020({ key: issuer.key });
  const signedVc = await vc.issue({ credential, suite, documentLoader: vcDocumentLoader });

  // Export agent key for storage (stored encrypted in DB for verification)
  const agentKeyExport = await agentKey.export({ publicKey: true, secretKey: true });

  // Persist to database
  const [row] = await db
    .insert(agentCredentials)
    .values({
      agentId,
      companyId,
      did: agentDid,
      publicKeyMultibase: String(agentKeyExport.publicKeyMultibase ?? ""),
      secretKeyMultibase: String(agentKeyExport.secretKeyMultibase ?? ""),
      issuedAt: now,
      expiresAt,
      signedVc: signedVc as Record<string, unknown>,
      governanceFileHash,
      revoked: false,
    })
    .returning({ id: agentCredentials.id });

  logger.info(
    { agentId, companyId, did: agentDid, credentialId: row.id },
    "[VC] Agent credential issued"
  );

  return {
    credentialId: row.id,
    did: agentDid,
    signedVc: signedVc as Record<string, unknown>,
    expiresAt,
    governanceFileHash,
  };
}

// ─── Verify a Verifiable Credential ──────────────────────────────────────────

export interface VerificationResult {
  verified: boolean;
  agentId?: string;
  companyId?: string;
  governanceFileHash?: string;
  expiresAt?: string;
  error?: string;
}

export async function verifyAgentVc(
  rawVc: Record<string, unknown>
): Promise<VerificationResult> {
  try {
    const result = await vc.verifyCredential({
      credential: rawVc,
      suite: new Ed25519Signature2020(),
      documentLoader: vcDocumentLoader,
    });

    if (!result.verified) {
      const errMsg = (result.error as { errors?: { message?: string }[] })?.errors?.[0]?.message ?? "Unknown error";
      return { verified: false, error: errMsg };
    }

    const subject = rawVc.credentialSubject as Record<string, unknown> | undefined;
    return {
      verified: true,
      agentId: subject?.agentId as string | undefined,
      companyId: subject?.companyId as string | undefined,
      governanceFileHash: subject?.governanceFileHash as string | undefined,
      expiresAt: rawVc.expirationDate as string | undefined,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err }, "[VC] Verification threw exception");
    return { verified: false, error: message };
  }
}

// ─── Get active credential for an agent ──────────────────────────────────────

export async function getActiveCredential(
  agentId: string,
  companyId: number
) {
  const [row] = await db
    .select()
    .from(agentCredentials)
    .where(
      and(
        eq(agentCredentials.agentId, agentId),
        eq(agentCredentials.companyId, companyId),
        eq(agentCredentials.revoked, false)
      )
    )
    .orderBy(desc(agentCredentials.issuedAt))
    .limit(1);

  return row ?? null;
}

// ─── List all credentials for a company ──────────────────────────────────────

export async function listCredentialsForCompany(companyId: number) {
  return db
    .select({
      id: agentCredentials.id,
      agentId: agentCredentials.agentId,
      companyId: agentCredentials.companyId,
      did: agentCredentials.did,
      issuedAt: agentCredentials.issuedAt,
      expiresAt: agentCredentials.expiresAt,
      governanceFileHash: agentCredentials.governanceFileHash,
      revoked: agentCredentials.revoked,
      revokedAt: agentCredentials.revokedAt,
      revokedReason: agentCredentials.revokedReason,
    })
    .from(agentCredentials)
    .where(eq(agentCredentials.companyId, companyId))
    .orderBy(desc(agentCredentials.issuedAt));
}
