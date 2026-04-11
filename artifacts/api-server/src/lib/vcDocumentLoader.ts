/**
 * vcDocumentLoader.ts
 * Static JSON-LD document loader — NO network calls permitted.
 * Required contexts are bundled inline; any unrecognised URL throws.
 *
 * Requirement B: static, offline-capable loader for all VC operations.
 *
 * Bundled contexts (all served from memory, zero network I/O):
 *   - https://www.w3.org/2018/credentials/v1      (W3C VC Data Model v1)
 *   - https://w3id.org/security/suites/ed25519-2020/v1  (Ed25519Signature2020)
 *   - https://w3id.org/security/multikey/v1        (Multikey — did:key resolution)
 *   - https://w3id.org/did/v1                      (DID Core v1)
 *   - https://vda-mk.com/credentials/v1            (VDA-MK custom vocabulary)
 *   - did:key:* DID documents                      (synthetic, no network)
 */

import { Ed25519Signature2020 } from "@digitalbazaar/ed25519-signature-2020";

// ─── W3C Verifiable Credentials Data Model v1 — statically bundled ────────────
// Source: https://www.w3.org/2018/credentials/v1 (stable, extracted from @digitalbazaar/vc)
const W3C_CREDENTIALS_V1_URL = "https://www.w3.org/2018/credentials/v1";
const W3C_CREDENTIALS_V1_CONTEXT = {"@context":{"@version":1.1,"@protected":true,"id":"@id","type":"@type","VerifiableCredential":{"@id":"https://www.w3.org/2018/credentials#VerifiableCredential","@context":{"@version":1.1,"@protected":true,"id":"@id","type":"@type","cred":"https://www.w3.org/2018/credentials#","sec":"https://w3id.org/security#","xsd":"http://www.w3.org/2001/XMLSchema#","credentialSchema":{"@id":"cred:credentialSchema","@type":"@id","@context":{"@version":1.1,"@protected":true,"id":"@id","type":"@type","cred":"https://www.w3.org/2018/credentials#","JsonSchemaValidator2018":"cred:JsonSchemaValidator2018"}},"credentialStatus":{"@id":"cred:credentialStatus","@type":"@id"},"credentialSubject":{"@id":"cred:credentialSubject","@type":"@id"},"evidence":{"@id":"cred:evidence","@type":"@id"},"expirationDate":{"@id":"cred:expirationDate","@type":"xsd:dateTime"},"holder":{"@id":"cred:holder","@type":"@id"},"issued":{"@id":"cred:issued","@type":"xsd:dateTime"},"issuer":{"@id":"cred:issuer","@type":"@id"},"issuanceDate":{"@id":"cred:issuanceDate","@type":"xsd:dateTime"},"proof":{"@id":"sec:proof","@type":"@id","@container":"@graph"},"refreshService":{"@id":"cred:refreshService","@type":"@id","@context":{"@version":1.1,"@protected":true,"id":"@id","type":"@type","cred":"https://www.w3.org/2018/credentials#","ManualRefreshService2018":"cred:ManualRefreshService2018"}},"termsOfUse":{"@id":"cred:termsOfUse","@type":"@id"},"validFrom":{"@id":"cred:validFrom","@type":"xsd:dateTime"},"validUntil":{"@id":"cred:validUntil","@type":"xsd:dateTime"}}},"VerifiablePresentation":{"@id":"https://www.w3.org/2018/credentials#VerifiablePresentation","@context":{"@version":1.1,"@protected":true,"id":"@id","type":"@type","cred":"https://www.w3.org/2018/credentials#","sec":"https://w3id.org/security#","holder":{"@id":"cred:holder","@type":"@id"},"proof":{"@id":"sec:proof","@type":"@id","@container":"@graph"},"verifiableCredential":{"@id":"cred:verifiableCredential","@type":"@id","@container":"@graph"}}},"EcdsaSecp256k1Signature2019":{"@id":"https://w3id.org/security#EcdsaSecp256k1Signature2019","@context":{"@version":1.1,"@protected":true,"id":"@id","type":"@type","sec":"https://w3id.org/security#","xsd":"http://www.w3.org/2001/XMLSchema#","challenge":"sec:challenge","created":{"@id":"http://purl.org/dc/terms/created","@type":"xsd:dateTime"},"domain":"sec:domain","expires":{"@id":"sec:expiration","@type":"xsd:dateTime"},"jws":"sec:jws","nonce":"sec:nonce","proofPurpose":{"@id":"sec:proofPurpose","@type":"@vocab","@context":{"@version":1.1,"@protected":true,"id":"@id","type":"@type","sec":"https://w3id.org/security#","assertionMethod":{"@id":"sec:assertionMethod","@type":"@id","@container":"@set"},"authentication":{"@id":"sec:authenticationMethod","@type":"@id","@container":"@set"}}},"proofValue":"sec:proofValue","verificationMethod":{"@id":"sec:verificationMethod","@type":"@id"}}},"EcdsaSecp256r1Signature2019":{"@id":"https://w3id.org/security#EcdsaSecp256r1Signature2019","@context":{"@version":1.1,"@protected":true,"id":"@id","type":"@type","sec":"https://w3id.org/security#","xsd":"http://www.w3.org/2001/XMLSchema#","challenge":"sec:challenge","created":{"@id":"http://purl.org/dc/terms/created","@type":"xsd:dateTime"},"domain":"sec:domain","expires":{"@id":"sec:expiration","@type":"xsd:dateTime"},"jws":"sec:jws","nonce":"sec:nonce","proofPurpose":{"@id":"sec:proofPurpose","@type":"@vocab","@context":{"@version":1.1,"@protected":true,"id":"@id","type":"@type","sec":"https://w3id.org/security#","assertionMethod":{"@id":"sec:assertionMethod","@type":"@id","@container":"@set"},"authentication":{"@id":"sec:authenticationMethod","@type":"@id","@container":"@set"}}},"proofValue":"sec:proofValue","verificationMethod":{"@id":"sec:verificationMethod","@type":"@id"}}},"Ed25519Signature2018":{"@id":"https://w3id.org/security#Ed25519Signature2018","@context":{"@version":1.1,"@protected":true,"id":"@id","type":"@type","sec":"https://w3id.org/security#","xsd":"http://www.w3.org/2001/XMLSchema#","challenge":"sec:challenge","created":{"@id":"http://purl.org/dc/terms/created","@type":"xsd:dateTime"},"domain":"sec:domain","expires":{"@id":"sec:expiration","@type":"xsd:dateTime"},"jws":"sec:jws","nonce":"sec:nonce","proofPurpose":{"@id":"sec:proofPurpose","@type":"@vocab","@context":{"@version":1.1,"@protected":true,"id":"@id","type":"@type","sec":"https://w3id.org/security#","assertionMethod":{"@id":"sec:assertionMethod","@type":"@id","@container":"@set"},"authentication":{"@id":"sec:authenticationMethod","@type":"@id","@container":"@set"}}},"proofValue":"sec:proofValue","verificationMethod":{"@id":"sec:verificationMethod","@type":"@id"}}},"RsaSignature2018":{"@id":"https://w3id.org/security#RsaSignature2018","@context":{"@version":1.1,"@protected":true,"challenge":"sec:challenge","created":{"@id":"http://purl.org/dc/terms/created","@type":"xsd:dateTime"},"domain":"sec:domain","expires":{"@id":"sec:expiration","@type":"xsd:dateTime"},"jws":"sec:jws","nonce":"sec:nonce","proofPurpose":{"@id":"sec:proofPurpose","@type":"@vocab","@context":{"@version":1.1,"@protected":true,"id":"@id","type":"@type","sec":"https://w3id.org/security#","assertionMethod":{"@id":"sec:assertionMethod","@type":"@id","@container":"@set"},"authentication":{"@id":"sec:authenticationMethod","@type":"@id","@container":"@set"}}},"proofValue":"sec:proofValue","verificationMethod":{"@id":"sec:verificationMethod","@type":"@id"}}},"proof":{"@id":"https://w3id.org/security#proof","@type":"@id","@container":"@graph"}}};

// ─── DID Core v1 — minimal static context ─────────────────────────────────────
// Covers the base DID vocabulary; did:key documents are generated synthetically below.
const DID_V1_URL = "https://w3id.org/did/v1";
const DID_V1_CONTEXT = {
  "@context": {
    "@version": 1.1,
    "id": "@id",
    "type": "@type",
    "did": "https://www.w3.org/ns/did#",
    "sec": "https://w3id.org/security#",
    "controller": { "@id": "sec:controller", "@type": "@id" },
    "verificationMethod": { "@id": "sec:verificationMethod", "@type": "@id", "@container": "@set" },
    "authentication": { "@id": "sec:authenticationMethod", "@type": "@id", "@container": "@set" },
    "assertionMethod": { "@id": "sec:assertionMethod", "@type": "@id", "@container": "@set" },
    "keyAgreement": { "@id": "sec:keyAgreement", "@type": "@id", "@container": "@set" },
    "capabilityInvocation": { "@id": "sec:capabilityInvocationMethod", "@type": "@id", "@container": "@set" },
    "capabilityDelegation": { "@id": "sec:capabilityDelegationMethod", "@type": "@id", "@container": "@set" },
    "publicKeyJwk": { "@id": "sec:publicKeyJwk", "@type": "@json" },
    "publicKeyMultibase": "sec:publicKeyMultibase",
    "service": { "@id": "did:service", "@type": "@id" },
    "serviceEndpoint": { "@id": "did:serviceEndpoint", "@type": "@id" },
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

// ─── VDA-MK Custom Vocabulary ─────────────────────────────────────────────────
export const VDA_CONTEXT_URL = "https://vda-mk.com/credentials/v1";
const VDA_CONTEXT = {
  "@context": {
    "@version": 1.1,
    "@vocab": "https://vda-mk.com/ns#",
    agent_id: "https://vda-mk.com/ns#agent_id",
    company_id: "https://vda-mk.com/ns#company_id",
    governance_file_hash: "https://vda-mk.com/ns#governance_file_hash",
    domain_owner: "https://vda-mk.com/ns#domain_owner",
    permitted_skills: "https://vda-mk.com/ns#permitted_skills",
    event_type: "https://vda-mk.com/ns#event_type",
    issued_for: "https://vda-mk.com/ns#issued_for",
    rotation_schedule: "https://vda-mk.com/ns#rotation_schedule",
  },
};

// ─── Document Loader ───────────────────────────────────────────────────────────

interface LoadedDocument {
  contextUrl: null;
  documentUrl: string;
  document: Record<string, unknown>;
}

export async function vcDocumentLoader(url: string): Promise<LoadedDocument> {
  // W3C Credentials v1 — statically bundled (no network call)
  if (url === W3C_CREDENTIALS_V1_URL) {
    return { contextUrl: null, documentUrl: url, document: W3C_CREDENTIALS_V1_CONTEXT };
  }

  // Ed25519Signature2020 context — bundled inside @digitalbazaar/ed25519-signature-2020
  if (url === Ed25519Signature2020.CONTEXT_URL) {
    return {
      contextUrl: null,
      documentUrl: url,
      document: Ed25519Signature2020.CONTEXT as Record<string, unknown>,
    };
  }

  // DID Core v1 — statically bundled
  if (url === DID_V1_URL) {
    return { contextUrl: null, documentUrl: url, document: DID_V1_CONTEXT };
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
    `[vcDocumentLoader] Network access blocked — no static bundle for: ${url}`
  );
}
