/**
 * C2PA v2.1-style provenance manifest generator for Witness Agent decision records.
 *
 * Each witness entry receives a signed manifest containing:
 *   - claim_generator: VDA-MD platform identifier
 *   - model_id: AI model that produced the decision
 *   - agent_did: DID of the agent whose decision is recorded (optional, caller-supplied)
 *   - platform_did: Platform issuer DID (from persisted Ed25519 keypair)
 *   - governance_file_hash: SHA-256 of the governance files consulted
 *   - files_consulted: list of governance file names
 *   - decision: PASS / FAIL / ESCALATE / INFO
 *   - clause_applied: the specific rule cited by the agent
 *   - created_at: ISO 8601 timestamp
 *   - signature: Ed25519 signature over the canonical manifest (base64url)
 *
 * Conformance: CAITA (California AI Transparency Act), Utah HB 276, Washington HB 1170.
 */

import { createHash } from "node:crypto";
import { getPlatformIssuer } from "./agentCredentialIssuer.js";
import { logger } from "./logger.js";

export interface C2PAManifestSignature {
  algorithm: "Ed25519";
  signer_did: string;
  value: string;
}

export interface C2PAManifest {
  "@context": "https://c2pa.org/statements/v1";
  spec_version: "2.1";
  claim_generator: string;
  created_at: string;
  platform_did: string;
  agent_did: string | null;
  assertions: C2PAAssertion[];
  signature: C2PAManifestSignature;
}

interface C2PAAssertion {
  label: string;
  data: Record<string, unknown>;
}

export interface BuildC2PAManifestInput {
  modelId: string;
  agentDid?: string | null;
  governanceFileHash?: string | null;
  filesConsulted?: string[] | null;
  decision: string;
  clauseApplied: string;
  agentName: string;
  companyId: number;
}

/**
 * Deterministic JSON serialiser — sorts object keys recursively so that the
 * canonical form is stable across JS engine versions and object construction order.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const sorted = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
  return `{${sorted.join(",")}}`;
}

export async function buildC2PAManifest(
  opts: BuildC2PAManifestInput
): Promise<C2PAManifest> {
  const { key: platformKey, did: platformDid } = await getPlatformIssuer();

  const createdAt = new Date().toISOString();

  const unsignedBody = {
    "@context": "https://c2pa.org/statements/v1" as const,
    spec_version: "2.1" as const,
    claim_generator: "vda-md/1.0 VDA-MD Governance Platform (Apaleo)",
    created_at: createdAt,
    platform_did: platformDid,
    agent_did: opts.agentDid ?? null,
    assertions: [
      {
        label: "vda-md.governance.decision",
        data: {
          model_id: opts.modelId,
          agent_name: opts.agentName,
          company_id: opts.companyId,
          governance_file_hash: opts.governanceFileHash ?? null,
          files_consulted: opts.filesConsulted ?? [],
          decision: opts.decision,
          clause_applied: opts.clauseApplied,
        },
      },
    ],
  };

  const canonical = Buffer.from(canonicalJson(unsignedBody), "utf-8");

  const signer = platformKey.signer();
  const sigBytes: Uint8Array = await signer.sign({ data: canonical as unknown as Uint8Array });
  const sigBase64url = Buffer.from(sigBytes).toString("base64url");

  return {
    ...unsignedBody,
    signature: {
      algorithm: "Ed25519",
      signer_did: platformDid,
      value: sigBase64url,
    },
  };
}

/**
 * Verifies a C2PA manifest's Ed25519 signature against the key encoded in
 * `signature.signer_did`.
 *
 * The `did:key:z6Mk…` DID scheme encodes the raw public key as a multibase
 * fingerprint, so no trust-registry lookup or network call is needed — the
 * public key is derived entirely from the DID string embedded in the manifest.
 * This means old manifests signed before a key rotation verify correctly
 * because we always use the key that *actually signed* the manifest, not the
 * current platform key.
 *
 * Returns true only when the signature is mathematically valid.
 */
export async function verifyC2PAManifest(manifest: C2PAManifest): Promise<boolean> {
  try {
    const { Ed25519VerificationKey2020 } = await import(
      "@digitalbazaar/ed25519-verification-key-2020" as string
    ) as { Ed25519VerificationKey2020: { fromFingerprint(opts: { fingerprint: string }): Promise<{ verifier(): { verify(opts: { data: Uint8Array; signature: Uint8Array }): Promise<boolean> } }> } };

    const signerDid = manifest.signature?.signer_did;
    if (typeof signerDid !== "string" || !signerDid.startsWith("did:key:")) {
      logger.warn({ signerDid }, "[C2PA] Manifest signer_did is not a did:key — cannot verify");
      return false;
    }

    const fingerprint = signerDid.replace("did:key:", "");
    const verificationKey = await Ed25519VerificationKey2020.fromFingerprint({ fingerprint });

    const { signature: sig, ...body } = manifest;
    const canonical = Buffer.from(canonicalJson(body), "utf-8");
    const sigBytes = Buffer.from(sig.value, "base64url");

    return verificationKey.verifier().verify({
      data: canonical as unknown as Uint8Array,
      signature: sigBytes as unknown as Uint8Array,
    });
  } catch (err) {
    logger.warn({ err }, "[C2PA] Manifest signature verification failed");
    return false;
  }
}

/**
 * Builds a content-hash (SHA-256) of a manifest's assertion data block —
 * used for manifest integrity chaining outside of the signature.
 */
export function hashManifestContent(manifest: C2PAManifest): string {
  return createHash("sha256")
    .update(canonicalJson(manifest.assertions))
    .digest("hex");
}
