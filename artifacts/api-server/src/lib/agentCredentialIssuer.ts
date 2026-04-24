/**
 * agentCredentialIssuer.ts
 * W3C Verifiable Credential issuance and verification for VDA-MD agent identity.
 *
 * Crypto: Ed25519Signature2020 via @digitalbazaar/ed25519-signature-2020,
 * conformant with the W3C VC Data Model v1.1. Credentials are signed
 * with asymmetric keys; no shared secret is involved.
 *
 * Transport: The signed VC is serialised to JSON and base64url-encoded
 * for internal bearer transport (Authorization: Bearer header).
 * This is a non-standard transport for platform-managed agents only.
 * Cross-party VC exchange would use a Verifiable Presentation envelope
 * and is out of scope for the current deployment.
 *
 * Requirement A: Ed25519Signature2020 suite (RFC 8037)
 * Requirement B: Static document loader (vcDocumentLoader)
 * Requirement C: All custom fields inside credentialSubject
 */

import { Ed25519Signature2020 } from "@digitalbazaar/ed25519-signature-2020";
import { Ed25519VerificationKey2020 } from "@digitalbazaar/ed25519-verification-key-2020";
import * as vc from "@digitalbazaar/vc";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { db, agentCredentials, governanceFiles } from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { vcDocumentLoader, VDA_CONTEXT_URL } from "./vcDocumentLoader.js";
import { logger } from "./logger.js";

// Persistent credential store — stable across builds, gitignored
// process.cwd() = artifacts/api-server/ in all run modes (dev and built)
const CRED_DIR = join(process.cwd(), "agent-credentials");

function ensureCredDir(): void {
  if (!existsSync(CRED_DIR)) {
    mkdirSync(CRED_DIR, { recursive: true });
  }
}

const ISSUER_KEYPAIR_PATH = join(CRED_DIR, "issuer-keypair.json");

// One stable Ed25519 keypair per {companyId, agentId} — DID persists across re-issuances
async function loadOrGenerateAgentKeypair(
  companyId: number,
  agentId: string
): Promise<Ed25519VerificationKey2020> {
  ensureCredDir();
  const keypairPath = join(CRED_DIR, `${companyId}-${agentId}.keypair.json`);

  if (existsSync(keypairPath)) {
    try {
      const saved = JSON.parse(readFileSync(keypairPath, "utf-8")) as Parameters<typeof Ed25519VerificationKey2020.from>[0];
      const key = await Ed25519VerificationKey2020.from(saved);
      const did = `did:key:${key.fingerprint()}`;
      key.id = `${did}#${key.fingerprint()}`;
      key.controller = did;
      return key;
    } catch (err) {
      logger.warn({ err, companyId, agentId }, "[VC] Could not load agent keypair — regenerating");
    }
  }

  // Generate a new keypair and persist it (stable DID from now on)
  const key = await Ed25519VerificationKey2020.generate();
  const did = `did:key:${key.fingerprint()}`;
  key.id = `${did}#${key.fingerprint()}`;
  key.controller = did;
  const exported = await key.export({ publicKey: true, privateKey: true });
  writeFileSync(keypairPath, JSON.stringify(exported, null, 2));
  logger.info({ did, agentId, companyId }, "[VC] New stable agent keypair generated and saved");
  return key;
}

// ─── Platform Issuer Key (persisted to disk, rotated by scheduler) ────────────
// On startup: load from issuer-keypair.json if present, otherwise generate and save.
// Agent keys are ephemeral per credential; only the platform issuer key is persisted.

interface PlatformIssuerKey {
  key: Ed25519VerificationKey2020;
  did: string;
  createdAt: Date;
}

let _platformIssuer: PlatformIssuerKey | null = null;

export async function getPlatformIssuer(): Promise<PlatformIssuerKey> {
  if (!_platformIssuer) {
    _platformIssuer = await loadOrGeneratePlatformIssuer();
  }
  return _platformIssuer;
}

async function loadOrGeneratePlatformIssuer(): Promise<PlatformIssuerKey> {
  ensureCredDir();
  if (existsSync(ISSUER_KEYPAIR_PATH)) {
    try {
      const saved = JSON.parse(readFileSync(ISSUER_KEYPAIR_PATH, "utf-8")) as Record<string, unknown>;
      const key = await Ed25519VerificationKey2020.from(saved as Parameters<typeof Ed25519VerificationKey2020.from>[0]);
      const did = `did:key:${key.fingerprint()}`;
      key.id = `${did}#${key.fingerprint()}`;
      key.controller = did;
      logger.info({ did }, "[VC] Platform issuer key loaded from disk");
      return { key, did, createdAt: new Date((saved["createdAt"] as string) ?? Date.now()) };
    } catch (err) {
      logger.warn({ err }, "[VC] Could not load issuer keypair from disk — generating new one");
    }
  }
  return rotatePlatformIssuer();
}

export async function rotatePlatformIssuer(): Promise<PlatformIssuerKey> {
  ensureCredDir();
  const key = await Ed25519VerificationKey2020.generate();
  const did = `did:key:${key.fingerprint()}`;
  key.id = `${did}#${key.fingerprint()}`;
  key.controller = did;
  const createdAt = new Date();
  _platformIssuer = { key, did, createdAt };
  // Persist keypair to disk (excluded from git via .gitignore)
  const exported = await key.export({ publicKey: true, privateKey: true });
  writeFileSync(ISSUER_KEYPAIR_PATH, JSON.stringify({ ...exported, createdAt: createdAt.toISOString() }, null, 2));
  logger.info({ did }, "[VC] Platform issuer key rotated and saved to disk");
  return _platformIssuer;
}

// ─── Governance File Hash (AGENTS.md + SKILL.md binding) ─────────────────────
// Requirement: hash binds agentId+companyId to exactly the AGENTS and SKILL files.
// Any change to those files invalidates issued credentials (Hash-Mismatch).

export async function computeGovernanceHash(
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
        inArray(governanceFiles.fileType, ["AGENTS", "SKILL"]),
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
  vcBase64url: string;
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

  // Load or generate a STABLE per-agent keypair (reused across re-issuances)
  // DID is deterministic per {companyId, agentId} — only public key stored in DB
  const agentKey = await loadOrGenerateAgentKeypair(companyId, agentId);
  const agentDid = `did:key:${agentKey.fingerprint()}`;

  // Compute governance hash for AGENTS + SKILL files only
  const governanceFileHash = await computeGovernanceHash(companyId, agentId);

  // Platform issuer signs the credential
  const issuer = await getPlatformIssuer();

  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlHours * 3600 * 1000);

  // Build the credential — all custom fields inside credentialSubject (Requirement C)
  // Claim names use snake_case per VDA-MD VC schema contract
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
      agent_id: agentId,
      company_id: String(companyId),
      governance_file_hash: governanceFileHash ?? "NO_GOVERNANCE_FILES",
      domain_owner: domainOwner,
      permitted_skills: permittedSkills,
      issued_for: "VDA-MD Apaleo Agent Runtime",
      rotation_schedule: "23h",
    },
  };

  const suite = new Ed25519Signature2020({ key: issuer.key });
  const signedVc = await vc.issue({ credential, suite, documentLoader: vcDocumentLoader });

  // Persist to database — only public key stored (no secret key)
  const [row] = await db
    .insert(agentCredentials)
    .values({
      agentId,
      companyId,
      did: agentDid,
      publicKeyMultibase: agentKey.fingerprint(),
      secretKeyMultibase: "", // intentionally empty — not stored
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

  // Persist issued VC to disk (gitignored) — one file per agent+company, overwritten on re-issue
  try {
    ensureCredDir();
    const credFile = join(CRED_DIR, `${companyId}-${agentId}.json`);
    writeFileSync(credFile, JSON.stringify({
      credentialId: row.id,
      agentId,
      companyId,
      did: agentDid,
      governanceFileHash,
      issuedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      signedVc,
    }, null, 2));
  } catch (err) {
    logger.warn({ err, agentId, companyId }, "[VC] Could not write credential file (non-fatal)");
  }

  // Encode the signed W3C VC JSON as base64url for internal bearer transport.
  // This is NOT a JWT — no header.payload.signature structure; the full
  // W3C VC JSON object is base64url-encoded as a single opaque token.
  const vcBase64url = Buffer.from(JSON.stringify(signedVc)).toString("base64url");

  return {
    credentialId: row.id,
    did: agentDid,
    signedVc: signedVc as Record<string, unknown>,
    vcBase64url,
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
  reason?: string;
}

export async function verifyAgentVc(
  rawVc: Record<string, unknown>,
  companyId?: number
): Promise<VerificationResult> {
  try {
    // 1. Cryptographic proof verification (Ed25519Signature2020)
    const result = await vc.verifyCredential({
      credential: rawVc,
      suite: new Ed25519Signature2020(),
      documentLoader: vcDocumentLoader,
    });

    if (!result.verified) {
      const errMsg = (result.error as { errors?: { message?: string }[] })?.errors?.[0]?.message ?? "Signature invalid";
      return { verified: false, error: errMsg, reason: "SIGNATURE_INVALID" };
    }

    const subject = rawVc.credentialSubject as Record<string, unknown> | undefined;
    // Claims use snake_case per VDA-MD VC schema contract
    const vcAgentId = (subject?.agent_id ?? subject?.agentId) as string | undefined;
    const vcCompanyId = (subject?.company_id ?? subject?.companyId) as string | undefined;
    const vcGovHash = (subject?.governance_file_hash ?? subject?.governanceFileHash) as string | undefined;
    const vcExpiry = rawVc.expirationDate as string | undefined;

    // 2. Tenant binding check — VC must be issued for the same company as the request
    if (companyId !== undefined) {
      if (!vcCompanyId) {
        return { verified: false, agentId: vcAgentId, error: "Credential missing company_id claim", reason: "MISSING_COMPANY_ID" };
      }
      if (String(companyId) !== String(vcCompanyId)) {
        logger.warn({ requestCompanyId: companyId, vcCompanyId, vcAgentId }, "[VC] Company ID mismatch — cross-hotel replay attempt blocked");
        return {
          verified: false,
          agentId: vcAgentId,
          companyId: vcCompanyId,
          error: `Credential issued for company ${vcCompanyId} but presented to company ${companyId}`,
          reason: "COMPANY_ID_MISMATCH",
        };
      }
    }

    // 3. Expiration check
    if (vcExpiry && new Date(vcExpiry) < new Date()) {
      return { verified: false, agentId: vcAgentId, companyId: vcCompanyId, expiresAt: vcExpiry, error: "Credential expired", reason: "EXPIRED" };
    }

    // 4. Governance hash check — recompute AGENTS + SKILL hash and compare
    if (vcAgentId && companyId !== undefined) {
      const currentHash = await computeGovernanceHash(companyId, vcAgentId);
      if (currentHash !== null && vcGovHash !== currentHash) {
        logger.warn({ vcAgentId, companyId, vcGovHash, currentHash }, "[VC] Governance hash mismatch — governance files changed since credential was issued");
        // Lazy import: agentCredentialIssuer is imported by agents.ts which is in
        // the import chain leading back here. A static import of writeGovernanceEvent
        // at module level would still be safe (witnessWriter extraction broke the old
        // cycle), but lazy import is retained here to keep this hot path async-safe
        // and avoid any future re-introduction of circular load-order issues.
        const { writeGovernanceEvent } = await import("./writeGovernanceEvent.js");
        writeGovernanceEvent({
          companyId: typeof companyId === "number" ? companyId : Number(companyId),
          agent: vcAgentId,
          eventCategory: "FRAMEWORK_INTEGRITY",
          decision: "FAIL",
          fileReferenced: "VDA-MD Verifiable Credential — Governance Hash",
          clauseApplied: "VDA-MD §6: Agent credentials must reflect current governance file hash",
          actionProposed: `Reject credential for ${vcAgentId} — governance hash mismatch`,
          reasoning: `Stored hash ${vcGovHash ?? "null"} does not match current hash ${currentHash} — governance files changed since credential was issued`,
          apaleoData: { event_type: "vc_hash_mismatch", agentId: vcAgentId, storedHash: vcGovHash, currentHash },
          credentialVerified: false,
        }).catch(err => logger.warn({ err }, "[VC] Failed to write hash mismatch governance event"));
        return {
          verified: false,
          agentId: vcAgentId,
          companyId: vcCompanyId,
          governanceFileHash: vcGovHash,
          expiresAt: vcExpiry,
          error: "Governance files changed since credential was issued",
          reason: "HASH_MISMATCH",
        };
      }
    }

    return {
      verified: true,
      agentId: vcAgentId,
      companyId: vcCompanyId,
      governanceFileHash: vcGovHash,
      expiresAt: vcExpiry,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err }, "[VC] Verification threw exception");
    return { verified: false, error: message, reason: "VERIFICATION_ERROR" };
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

// ─── Credential status helpers ────────────────────────────────────────────────

type CredentialStatus = "Valid" | "Expiring-Soon" | "Expired" | "Hash-Mismatch" | "Revoked";

export async function computeCredentialStatus(
  cred: typeof agentCredentials.$inferSelect
): Promise<CredentialStatus> {
  if (cred.revoked) return "Revoked";
  const now = new Date();
  if (new Date(cred.expiresAt) < now) return "Expired";
  // Recompute governance hash against current DB content
  const currentHash = await computeGovernanceHash(cred.companyId, cred.agentId);
  if (currentHash !== null && cred.governanceFileHash !== currentHash) return "Hash-Mismatch";
  // Expiring within 2 hours
  const twoHoursFromNow = new Date(now.getTime() + 2 * 3600_000);
  if (new Date(cred.expiresAt) < twoHoursFromNow) return "Expiring-Soon";
  return "Valid";
}

// ─── List all credentials for a company (with computed status) ────────────────

export async function listCredentialsForCompany(companyId: number) {
  const rows = await db
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
      signedVc: agentCredentials.signedVc,
    })
    .from(agentCredentials)
    .where(eq(agentCredentials.companyId, companyId))
    .orderBy(desc(agentCredentials.issuedAt));

  // Attach recomputed status to each credential
  const withStatus = await Promise.all(
    rows.map(async (r) => ({
      ...r,
      status: await computeCredentialStatus(r as typeof agentCredentials.$inferSelect),
      currentGovernanceHash: await computeGovernanceHash(r.companyId, r.agentId),
    }))
  );

  return withStatus;
}


// File-based credential listing: reads CRED_DIR, recomputes status from DB

interface CredentialFileRecord {
  id: number;
  credentialId: number;
  agentId: string;
  companyId: number;
  did: string;
  governanceFileHash: string | null;
  issuedAt: string;
  expiresAt: string;
  status: CredentialStatus;
  currentGovernanceHash: string | null;
}

export async function listCredentialsFromFiles(
  companyId: number
): Promise<CredentialFileRecord[]> {
  ensureCredDir();

  const pattern = new RegExp(`^${companyId}-(.+)\\.json$`);
  const files = readdirSync(CRED_DIR).filter((f) => pattern.test(f) && !f.endsWith(".keypair.json"));

  const results: CredentialFileRecord[] = [];

  for (const filename of files) {
    try {
      const match = pattern.exec(filename);
      if (!match) continue;
      const agentId = match[1];
      const raw = JSON.parse(readFileSync(join(CRED_DIR, filename), "utf-8")) as {
        credentialId: number;
        agentId: string;
        companyId: number;
        did: string;
        governanceFileHash: string | null;
        issuedAt: string;
        expiresAt: string;
      };

      // Recompute status from DB for accuracy — include expired entries so the UI can show them
      const now = new Date();
      const expires = new Date(raw.expiresAt);
      const currentHash = await computeGovernanceHash(companyId, agentId);
      let status: CredentialStatus;
      if (expires < now) {
        status = "Expired";
      } else if (currentHash !== null && raw.governanceFileHash !== currentHash) {
        status = "Hash-Mismatch";
      } else if (expires < new Date(now.getTime() + 2 * 3600_000)) {
        status = "Expiring-Soon";
      } else {
        status = "Valid";
      }
      results.push({ ...raw, id: raw.credentialId, status, currentGovernanceHash: currentHash });
    } catch (err) {
      logger.warn({ err, filename }, "[VC] Could not parse credential file — skipping");
    }
  }

  return results;
}
