/**
 * gen-stay-did-key.mjs — genesis of Stay Agent's own Ed25519 key (`did:web:<host>#key-1`).
 *
 * This is the CARD key: it signs the A2A card and answers DID-auth challenges. It is NOT a
 * Witness record-signing key and NOT a Witness account controller key — Stay Agent still
 * has neither, and those remain separate provisioning steps.
 *
 * SECURITY: the private half is written ONLY to gitignored files under secrets/ for Mike to
 * move into the deploy environment. It is never printed to stdout, so it cannot end up in a
 * terminal transcript or an agent session log. Only the PUBLIC x is printed — that is the
 * value that appears in the served did.json, and it is safe to paste anywhere.
 *
 * Re-running is safe and idempotent: an existing key is loaded and re-reported, never
 * replaced. Rotating is a deliberate act — delete secrets/stay-did-key-1.pem first, and
 * expect to add a rotationLog entry to the DID document (identity/stayDid.ts) rather than
 * silently swapping the key under a DID that resolvers have already cached.
 *
 * Run from artifacts/api-server:  node scripts/gen-stay-did-key.mjs
 */

import { createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const KEY_PATH = "secrets/stay-did-key-1.pem";
const B64_PATH = "secrets/stay-did-key-1.b64";
const DEFAULT_HOST = "stay-agent-mikerawsonnzs-projects.vercel.app";
const host = process.env.STAY_DID_HOST || DEFAULT_HOST;

const out = (s = "") => process.stdout.write(s + "\n");

let publicX;
let created;

if (existsSync(KEY_PATH)) {
  const priv = createPrivateKey(readFileSync(KEY_PATH, "utf8"));
  if (priv.asymmetricKeyType !== "ed25519") {
    throw new Error(`${KEY_PATH} is ${priv.asymmetricKeyType}, expected ed25519`);
  }
  publicX = createPublicKey(priv).export({ format: "jwk" }).x;
  created = false;
} else {
  const { privateKey } = generateKeyPairSync("ed25519");
  const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  mkdirSync("secrets", { recursive: true });
  // mode 0600 is honoured on POSIX and is a no-op on Windows — the gitignore is what
  // actually keeps this out of the repo, so do not remove it from .gitignore.
  writeFileSync(KEY_PATH, pem, { mode: 0o600 });
  writeFileSync(B64_PATH, Buffer.from(pem, "utf8").toString("base64"), { mode: 0o600 });
  publicX = createPublicKey(privateKey).export({ format: "jwk" }).x;
  created = true;
}

out(`=== did:web:${host}#key-1 — Stay Agent card-signing key (Ed25519) ===`);
out(created ? `GENERATED and persisted -> ${KEY_PATH}` : `loaded existing -> ${KEY_PATH}`);
out("");
out("PUBLIC x (this is what /.well-known/did.json publishes):");
out(publicX);
out("");
out("To make the identity live, set the private key in the deployment:");
out(`  vercel env add STAY_DID_PRIVATE_KEY_B64 production < ${B64_PATH}`);
out("");
out("Then redeploy and verify:  node scripts/verify-stay-identity.mjs");
out("Delete the local copies once the deployment holds it. Private key NOT printed.");
