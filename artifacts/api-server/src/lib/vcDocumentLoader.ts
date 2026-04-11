/**
 * vcDocumentLoader.ts
 * Static JSON-LD document loader — NO network calls permitted.
 * Required contexts are bundled inline; any unrecognised URL throws.
 *
 * Requirement B: static, offline-capable loader for all VC operations.
 */

import { Ed25519Signature2020 } from "@digitalbazaar/ed25519-signature-2020";
import * as vc from "@digitalbazaar/vc";

// ─── VDA-MK Custom Vocabulary ─────────────────────────────────────────────────
export const VDA_CONTEXT_URL = "https://vda-mk.com/credentials/v1";
const VDA_CONTEXT = {
  "@context": {
    "@version": 1.1,
    "@vocab": "https://vda-mk.com/ns#",
    agentId: "https://vda-mk.com/ns#agentId",
    companyId: "https://vda-mk.com/ns#companyId",
    governanceFileHash: "https://vda-mk.com/ns#governanceFileHash",
    domainOwner: "https://vda-mk.com/ns#domainOwner",
    permittedSkills: "https://vda-mk.com/ns#permittedSkills",
    eventType: "https://vda-mk.com/ns#eventType",
    issuedFor: "https://vda-mk.com/ns#issuedFor",
    rotationSchedule: "https://vda-mk.com/ns#rotationSchedule",
  },
};

// ─── Multikey Context (for did:key verification method resolution) ─────────────
const MULTIKEY_CONTEXT_URL = "https://w3id.org/security/multikey/v1";
const MULTIKEY_CONTEXT = {
  "@context": {
    "@version": 1.1,
    "@protected": true,
    id: "@id",
    type: "@type",
    Multikey: "https://w3id.org/security#Multikey",
    controller: { "@id": "https://w3id.org/security#controller", "@type": "@id" },
    publicKeyMultibase: "https://w3id.org/security#publicKeyMultibase",
    secretKeyMultibase: "https://w3id.org/security#secretKeyMultibase",
    assertionMethod: {
      "@id": "https://w3id.org/security#assertionMethod",
      "@type": "@id",
      "@container": "@set",
    },
    authentication: {
      "@id": "https://w3id.org/security#authentication",
      "@type": "@id",
      "@container": "@set",
    },
    verificationMethod: {
      "@id": "https://w3id.org/security#verificationMethod",
      "@type": "@id",
      "@container": "@set",
    },
  },
};

// ─── Document Loader ───────────────────────────────────────────────────────────

interface LoadedDocument {
  contextUrl: null;
  documentUrl: string;
  document: Record<string, unknown>;
}

export async function vcDocumentLoader(url: string): Promise<LoadedDocument> {
  // W3C Credentials v1 — bundled inside @digitalbazaar/vc
  if (url === "https://www.w3.org/2018/credentials/v1") {
    return vc.defaultDocumentLoader(url) as Promise<LoadedDocument>;
  }

  // Ed25519Signature2020 context — bundled inside @digitalbazaar/ed25519-signature-2020
  if (url === Ed25519Signature2020.CONTEXT_URL) {
    return {
      contextUrl: null,
      documentUrl: url,
      document: Ed25519Signature2020.CONTEXT as Record<string, unknown>,
    };
  }

  // Multikey context — needed for did:key verification method resolution
  if (url === MULTIKEY_CONTEXT_URL) {
    return { contextUrl: null, documentUrl: url, document: MULTIKEY_CONTEXT };
  }

  // VDA-MK vocabulary context
  if (url === VDA_CONTEXT_URL) {
    return { contextUrl: null, documentUrl: url, document: VDA_CONTEXT };
  }

  // did:key DID resolution — synthetic documents only (no network)
  if (url.startsWith("did:key:")) {
    const hasFragment = url.includes("#");
    const base = url.split("#")[0];
    const fingerprint = base.replace("did:key:", "");
    const keyId = `${base}#${fingerprint}`;

    const multikeyDoc = {
      "@context": MULTIKEY_CONTEXT_URL,
      type: "Multikey",
      id: keyId,
      controller: base,
      publicKeyMultibase: fingerprint,
    };

    if (hasFragment) {
      // Fragment URL → return just the verification method
      return { contextUrl: null, documentUrl: url, document: multikeyDoc };
    }

    // Base DID URL → return full synthetic DID document
    return {
      contextUrl: null,
      documentUrl: url,
      document: {
        "@context": MULTIKEY_CONTEXT_URL,
        id: base,
        verificationMethod: [multikeyDoc],
        authentication: [keyId],
        assertionMethod: [keyId],
      },
    };
  }

  throw new Error(
    `[vcDocumentLoader] Network access blocked — unknown context URL: ${url}`
  );
}
