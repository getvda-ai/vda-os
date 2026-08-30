/**
 * verify-stay-identity.mjs — prove Stay Agent's identity from the OUTSIDE.
 *
 * This is written as an independent verifier on purpose: it re-implements canonicalisation
 * and does its own Ed25519 verification against the published key, importing nothing from
 * src/. If it passes, an enforcer running the same steps gets the same answer — which is the
 * only claim worth making. A verifier sharing code with the signer would prove only that the
 * code agrees with itself.
 *
 * It runs the three checks an admission gate actually cares about:
 *   1. did:web:<host> RESOLVES  — GET https://<host>/.well-known/did.json
 *   2. the A2A card is SIGNED BY that DID's #key-1
 *   3. the agent can PROVE CONTROL of the key (DID-auth challenge/response)
 *
 * Run:  node scripts/verify-stay-identity.mjs [host]
 *       node scripts/verify-stay-identity.mjs localhost:8791   (http for a local server)
 */

import { createPublicKey, randomBytes, verify as edVerify } from "node:crypto";

const host = process.argv[2] || process.env.STAY_DID_HOST || "stay-agent-mikerawsonnzs-projects.vercel.app";
const scheme = host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
const base = `${scheme}://${host}`;
const expectedDid = `did:web:${host}`;

const out = (s = "") => process.stdout.write(s + "\n");
let failures = 0;

function check(ok, label, detail = "") {
  out(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
  return ok;
}

/** Byte-identical to the signer's canonicalJson: sorted keys, no whitespace. */
function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
}

/** Rebuild the Ed25519 public key from the DID document's publicKeyJwk. */
function keyFromJwk(jwk) {
  return createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: jwk.x }, format: "jwk" });
}

function verifyDetached(publicKey, payload, signatureB64Url) {
  return edVerify(null, Buffer.from(canonicalJson(payload), "utf8"), publicKey, Buffer.from(signatureB64Url, "base64url"));
}

async function getJson(path) {
  const res = await fetch(`${base}${path}`);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* left null — reported by the caller */ }
  return { status: res.status, json, text };
}

/**
 * The whole flow lives in a function so a check that makes the rest meaningless can simply
 * `return` — process.exit() mid-run trips a libuv assertion on Windows while undici's
 * keep-alive sockets are open, which would make even a PASSING run exit non-zero.
 */
async function run() {
  out(`Verifying ${expectedDid}`);
  out(`Base URL  ${base}`);
  out("");

  // ── 1. Does the DID resolve? ──────────────────────────────────────────────
  out("1. did:web resolution");
  const did = await getJson("/.well-known/did.json");
  if (did.status === 503) {
    check(false, "did.json served", `503 identity_not_provisioned: ${did.json?.reason ?? did.text.slice(0, 160)}`);
    out("");
    out("The deployment is honestly reporting that STAY_DID_PRIVATE_KEY_B64 is not set.");
    out("Provision it (scripts/gen-stay-did-key.mjs) and redeploy, then re-run this.");
    return;
  }
  check(did.status === 200, "did.json served", `HTTP ${did.status}`);
  const doc = did.json;
  if (!doc) {
    check(false, "did.json is JSON", did.text.slice(0, 160));
    return;
  }
  check(doc.id === expectedDid, "document id matches the host it was fetched from", `${doc.id}`);
  const vm = (doc.verificationMethod ?? []).find((m) => m.id === `${expectedDid}#key-1`);
  check(Boolean(vm), "#key-1 present in verificationMethod");
  check(vm?.publicKeyJwk?.crv === "Ed25519", "#key-1 is Ed25519", vm?.publicKeyJwk?.crv);
  check((doc.assertionMethod ?? []).includes(`${expectedDid}#key-1`), "#key-1 is an assertionMethod (may sign the card)");
  check((doc.authentication ?? []).includes(`${expectedDid}#key-1`), "#key-1 is an authentication method (may prove control)");
  if (!vm?.publicKeyJwk) return;
  const pub = keyFromJwk(vm.publicKeyJwk);
  out(`        published key x = ${vm.publicKeyJwk.x}`);
  out("");

  // ── 2. Is the A2A card signed by that key? ────────────────────────────────
  out("2. A2A card signature");
  const cardRes = await getJson("/.well-known/agent-card.json");
  check(cardRes.status === 200, "agent-card.json served", `HTTP ${cardRes.status}`);
  const card = cardRes.json;
  if (card) {
    check(card.did === expectedDid, "card declares this DID", card.did);
    const sig = card.agentCardSignature;
    check(Boolean(sig), "card carries agentCardSignature");
    if (sig) {
      check(sig.keyId === `${expectedDid}#key-1`, "signature names #key-1", sig.keyId);
      check(sig.alg === "EdDSA", "algorithm is EdDSA", sig.alg);
      const { agentCardSignature: _omit, ...unsigned } = card;
      check(verifyDetached(pub, unsigned, sig.value), "signature VERIFIES against the published key");
    }
    const skills = card.skills ?? [];
    check(skills.length > 0, "card advertises skills", `${skills.length}: ${skills.map((s) => s.id).join(", ")}`);
    check(skills.every((s) => s.inputSchema), "every skill carries an inputSchema");
  }
  out("");

  // ── 3. Can it prove control of the key? ───────────────────────────────────
  out("3. DID-auth holder binding");
  const challenge = randomBytes(24).toString("base64url"); // the VERIFIER's nonce, not the agent's
  const authRes = await fetch(`${base}/.well-known/did-auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ challenge, domain: "verify-stay-identity.local" }),
  });
  const proof = await authRes.json().catch(() => null);
  check(authRes.status === 200, "did-auth answered", `HTTP ${authRes.status}`);
  if (proof && authRes.status === 200) {
    check(proof.challenge === challenge, "our nonce is echoed verbatim (not a replay)");
    check(proof.domain === "verify-stay-identity.local", "our domain is bound into the proof");
    check(proof.keyId === `${expectedDid}#key-1`, "proof names #key-1", proof.keyId);
    const payload = { challenge: proof.challenge, did: proof.did, domain: proof.domain, issuedAt: proof.issuedAt, keyId: proof.keyId };
    check(verifyDetached(pub, payload, proof.signature), "proof VERIFIES — the agent controls the published key");
  }

  // A junk challenge must be refused, or "proves control" means nothing.
  const badRes = await fetch(`${base}/.well-known/did-auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ challenge: "short" }),
  });
  check(badRes.status === 400, "a too-short nonce is refused", `HTTP ${badRes.status}`);
}

await run().catch((e) => {
  check(false, "verifier reached the host", String(e?.message ?? e));
});

out("");
out(failures === 0 ? `RESULT: ${expectedDid} is live, signed and provably controlled.` : `RESULT: ${failures} check(s) FAILED.`);
// Set exitCode and let the loop drain rather than calling process.exit() — see run()'s note.
process.exitCode = failures === 0 ? 0 : 1;
