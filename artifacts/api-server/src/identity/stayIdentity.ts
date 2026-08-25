/**
 * stayIdentity.ts — Stay Agent's own identity, assembled once at boot.
 *
 * Composes the three things that together make Stay Agent an addressable outside party:
 *   1. an Ed25519 key it controls              (stayKeys.ts)
 *   2. a resolvable did:web document           (stayDid.ts)
 *   3. an A2A card signed by that key          (stayAgentCard.ts + canonicalJson.ts)
 *
 * THE PRODUCTION GUARD IS THE POINT OF THIS FILE. Without a provisioned key we can still
 * generate a working keypair in-process, and every document built from it would verify
 * against every other one — self-consistent, and completely false. A did:web that resolves
 * to a key which rotates on each cold start is worse than a 404: a verifier that cached
 * yesterday's document sees tampering, and one that fetches fresh believes it has
 * established something it has not. So in production an unprovisioned identity serves an
 * explicit 503 with a reason, never an ephemeral document. This is the CLAUDE.md rendering
 * -safety principle applied to identity: fail to a flagged degraded state, never to a
 * plausible-looking fake.
 */

import { buildStayAgentCard } from "../a2a/stayAgentCard.js";
import { logger } from "../lib/logger.js";
import { canonicalBytes } from "./canonicalJson.js";
import { buildStayDidDocument, didForHost, type StayDidDocument } from "./stayDid.js";
import { loadStaySigningKey, readStayDidPrivateKeyPem, signBytes, type StaySigningKey } from "./stayKeys.js";

/**
 * The host Stay Agent's DID is anchored to. Defaults to the deployment the A2A card has
 * always advertised. A did:web is host-bound, so moving Stay Agent to a real domain
 * (stay.getvda.ai, or a A Hotel Berlin domain) is a DID change, not a redirect — set this env
 * and re-run the genesis, and expect the old DID to keep resolving until it is retired.
 */
const DEFAULT_DID_HOST = "stay-agent-mikerawsonnzs-projects.vercel.app";

/** Any signature Stay Agent produces names this key. */
export type StayIdentityState =
  | { provisioned: true; ephemeral: boolean }
  | { provisioned: false; reason: string };

export interface StayIdentity {
  did: string;
  keyId: string;
  host: string;
  baseUrl: string;
  /** null when the identity is not publishable — routes must 503 rather than invent one. */
  didDocument: StayDidDocument | null;
  /** The signed A2A card, or null for the same reason. */
  card: Record<string, unknown> | null;
  key: StaySigningKey | null;
  state: StayIdentityState;
}

function isProductionRuntime(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === "production" || env.VERCEL === "1" || Boolean(env.VERCEL_ENV);
}

/**
 * Sign the A2A card with #key-1 and attach a detached signature.
 *
 * `agentCardSignature` (singular, an object) is the shape the suite's live cards use —
 * matching hitl.getvda.ai and onboard.getvda.ai — so an existing verifier needs no special
 * case for us. The signature covers the canonical bytes of the card with the signature
 * block itself removed.
 */
export function signStayAgentCard(
  card: Record<string, unknown>,
  key: StaySigningKey,
  keyId: string,
): Record<string, unknown> {
  const value = signBytes(key, canonicalBytes(card, ["agentCardSignature"]));
  return { ...card, agentCardSignature: { keyId, alg: "EdDSA", value } };
}

export function buildStayIdentity(
  env: NodeJS.ProcessEnv = process.env,
  now: string = new Date().toISOString(),
): StayIdentity {
  const host = (env.STAY_DID_HOST || DEFAULT_DID_HOST).replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const baseUrl = `https://${host}`;
  const did = didForHost(host);
  const keyId = `${did}#key-1`;

  const pem = readStayDidPrivateKeyPem(env);

  // Production + no key => publish nothing. See the file header.
  if (!pem && isProductionRuntime(env)) {
    const reason =
      "STAY_DID_PRIVATE_KEY_B64 is not set in this deployment. Stay Agent's did:web is NOT provisioned here — serving an in-process key would publish an identity that rotates on every cold start.";
    logger.error({ did }, "stay identity NOT provisioned — /.well-known/did.json and /.well-known/agent-card.json will 503");
    return { did, keyId, host, baseUrl, didDocument: null, card: null, key: null, state: { provisioned: false, reason } };
  }

  const key = loadStaySigningKey(pem);
  const didDocument = buildStayDidDocument(did, key, baseUrl);
  const card = signStayAgentCard(buildStayAgentCard(now, { did, keyId }), key, keyId);

  logger.info(
    { did, keyId, ephemeral: key.ephemeral, publicKeyJwkX: key.publicKeyJwkX },
    key.ephemeral
      ? "stay identity built from an EPHEMERAL dev key — not Stay Agent's published identity"
      : "stay identity built from the provisioned did:web key",
  );

  return { did, keyId, host, baseUrl, didDocument, card, key, state: { provisioned: true, ephemeral: key.ephemeral } };
}

export interface DidAuthProof {
  did: string;
  keyId: string;
  alg: "EdDSA";
  challenge: string;
  domain: string | null;
  issuedAt: string;
  signature: string;
}

/**
 * Answer a DID-auth challenge: prove control of #key-1 over a caller-supplied nonce.
 *
 * This is the holder-binding half of Contract B, from the holder's side. An enforcer
 * resolves did:web:<host>, takes #key-1, and verifies `signature` over the canonical bytes
 * of {challenge, did, domain, issuedAt, keyId}. `domain` is echoed back verbatim so the
 * verifier can confirm the proof was minted for it and not replayed from elsewhere; the
 * caller supplies the nonce, so freshness is the caller's to enforce, not ours.
 */
export function signDidAuthChallenge(
  identity: StayIdentity,
  challenge: string,
  domain: string | null,
  issuedAt: string = new Date().toISOString(),
): DidAuthProof {
  if (!identity.key) {
    throw new Error("stay identity is not provisioned — cannot answer a DID-auth challenge");
  }
  const payload = { challenge, did: identity.did, domain, issuedAt, keyId: identity.keyId };
  return {
    ...payload,
    alg: "EdDSA",
    signature: signBytes(identity.key, canonicalBytes(payload)),
  };
}

/** Built once per process — the card's signature is stable for the life of the instance. */
export const stayIdentity: StayIdentity = buildStayIdentity();
