/**
 * stayKeys.ts — Ed25519 key material for `did:web:<host>#key-1`, the FIRST key Stay Agent
 * actually controls.
 *
 * Scope of this key, stated precisely so it is not over-read: it signs Stay Agent's A2A
 * card and its DID-auth challenge responses. It is NOT a Witness record-signing key and
 * NOT a Witness account controller key — decisions are still sealed under the shared
 * account Stay borrows. Card identity and seal custody are separate problems; this file
 * solves the first one only (see the card's `custody` block).
 *
 * Native `node:crypto` only — no third-party crypto in the signing path, so the audit
 * surface for the one key that matters stays small. Mirrors the suite pattern already
 * proven at onboard.getvda.ai (`src/identity/keys.ts`).
 *
 * CUSTODY: Mike holds the real private key. It lives in the deploy environment as
 * STAY_DID_PRIVATE_KEY_B64 (base64 of a PKCS#8 PEM) and never in the tree.
 */

import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as edSign,
  type KeyObject,
} from "node:crypto";
import { logger } from "../lib/logger.js";

export interface StaySigningKey {
  privateKey: KeyObject;
  publicKey: KeyObject;
  /** base64url of the raw 32-byte Ed25519 public key — feeds `publicKeyJwk.x`. */
  publicKeyJwkX: string;
  /**
   * true => this key was generated in-process and dies with the process. A did.json built
   * from it is self-consistent but is NOT Stay Agent's identity. Never serve one in prod.
   */
  ephemeral: boolean;
}

function rawPublicKeyBase64Url(publicKey: KeyObject): string {
  // A JWK export already gives the raw curve point base64url-encoded.
  const jwk = publicKey.export({ format: "jwk" }) as { x?: string };
  if (!jwk.x) throw new Error("failed to export Ed25519 public key as JWK");
  return jwk.x;
}

/**
 * Decode STAY_DID_PRIVATE_KEY_B64 (base64 PKCS#8 PEM) into a PEM string.
 *
 * Accepts a raw PEM too: this Windows box has a CRLF/BOM corruption history with secret
 * round-trips, so a value that already looks like a PEM is passed through rather than
 * being base64-decoded into garbage.
 */
export function readStayDidPrivateKeyPem(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw = env.STAY_DID_PRIVATE_KEY_B64?.trim();
  if (!raw) return null;
  if (raw.includes("-----BEGIN")) return raw;
  return Buffer.from(raw, "base64").toString("utf8");
}

/**
 * Load the card-signing key. `privateKeyPem === null` means the key is not provisioned:
 * a loud EPHEMERAL dev key is generated so local work is possible, and `ephemeral` is set
 * so callers can refuse to publish it (stayIdentity.ts refuses in production).
 */
export function loadStaySigningKey(privateKeyPem: string | null): StaySigningKey {
  if (privateKeyPem) {
    const privateKey = createPrivateKey(privateKeyPem);
    if (privateKey.asymmetricKeyType !== "ed25519") {
      throw new Error(
        `stay-did-key-1 must be Ed25519, got ${privateKey.asymmetricKeyType}`,
      );
    }
    const publicKey = createPublicKey(privateKey);
    return {
      privateKey,
      publicKey,
      publicKeyJwkX: rawPublicKeyBase64Url(publicKey),
      ephemeral: false,
    };
  }

  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  logger.warn(
    "no STAY_DID_PRIVATE_KEY_B64 set — generated an EPHEMERAL dev signing key. Card signatures and the served did.json are DEV-ONLY, rotate on every restart, and are NOT Stay Agent's published identity.",
  );
  return {
    privateKey,
    publicKey,
    publicKeyJwkX: rawPublicKeyBase64Url(publicKey),
    ephemeral: true,
  };
}

/** Detached Ed25519 signature over `bytes`, base64url. */
export function signBytes(key: StaySigningKey, bytes: Buffer): string {
  return edSign(null, bytes, key.privateKey).toString("base64url");
}
