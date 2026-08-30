/**
 * stayDid.ts — the `did:web:<host>` document for Stay Agent.
 *
 * Mirrors the shape already verified across the suite (witness.getvda.ai and
 * onboard.getvda.ai): JsonWebKey2020 verification methods with an Ed25519 `publicKeyJwk`,
 * and a `rotationLog` with a genesis entry.
 *
 * ONE DELIBERATE DIVERGENCE from onboard's document: Stay Agent publishes an
 * `authentication` relationship as well as `assertionMethod`. Onboard and Witness only ever
 * SIGN, so assertion alone is right for them. Stay Agent is the outside party — the holder
 * that has to prove it controls this DID when an enforcer runs the holder-binding step of
 * Contract B. Advertising `authentication` is only honest because the challenge responder
 * actually exists (`POST /.well-known/did-auth`, see stayIdentity.ts); do not publish the
 * relationship without the endpoint that answers it.
 *
 * `validFrom` is a pinned provisioning fact, not `Date.now()` — the document must be
 * byte-identical on every cold start, or a resolver that caches it sees phantom rotation.
 */

import type { StaySigningKey } from "./stayKeys.js";

export interface StayDidDocument {
  "@context": string[];
  id: string;
  verificationMethod: Array<{
    id: string;
    type: "JsonWebKey2020";
    controller: string;
    publicKeyJwk: { crv: "Ed25519"; x: string; kty: "OKP" };
    validFrom: string;
    validUntil: string | null;
    status: "active";
  }>;
  assertionMethod: string[];
  authentication: string[];
  service: Array<{ id: string; type: string; serviceEndpoint: string }>;
  rotationLog: Array<{
    at: string;
    fromKeyId: string | null;
    toKeyId: string;
    reason: string;
    event: string;
  }>;
}

/** Genesis of Stay Agent's own identity. Pinned constant — see the note above. */
export const STAY_DID_VALID_FROM = "2026-08-01T00:00:00.000Z";

/**
 * `did:web:host` resolves to `https://host/.well-known/did.json`. A host with a port or a
 * path encodes as `did:web:host%3A8080:path`, which we do not need and do not support —
 * Stay Agent is served at the root of a bare host.
 */
export function didForHost(host: string): string {
  return `did:web:${host}`;
}

export function buildStayDidDocument(
  did: string,
  key: StaySigningKey,
  baseUrl: string,
  validFrom: string = STAY_DID_VALID_FROM,
): StayDidDocument {
  const cardKeyId = `${did}#key-1`;

  return {
    "@context": [
      "https://www.w3.org/ns/did/v1",
      "https://w3id.org/security/suites/jws-2020/v1",
    ],
    id: did,
    verificationMethod: [
      {
        id: cardKeyId,
        type: "JsonWebKey2020",
        controller: did,
        publicKeyJwk: { crv: "Ed25519", x: key.publicKeyJwkX, kty: "OKP" },
        validFrom,
        validUntil: null,
        status: "active",
      },
    ],
    // #key-1 signs the A2A card...
    assertionMethod: [cardKeyId],
    // ...and answers DID-auth challenges, which is what makes holder-binding possible.
    authentication: [cardKeyId],
    service: [
      {
        id: `${did}#agent-card`,
        type: "A2AAgentCard",
        serviceEndpoint: `${baseUrl}/.well-known/agent-card.json`,
      },
      {
        id: `${did}#did-auth`,
        type: "DIDAuthChallengeResponse",
        serviceEndpoint: `${baseUrl}/.well-known/did-auth`,
      },
    ],
    rotationLog: [
      {
        at: validFrom,
        fromKeyId: null,
        toKeyId: cardKeyId,
        reason: "genesis — Stay Agent's first self-controlled key",
        event: "genesis",
      },
    ],
  };
}
