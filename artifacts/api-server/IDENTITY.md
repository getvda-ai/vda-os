# Stay Agent — identity (did:web + signed A2A card)

Stay Agent is the **outside party** in the getvda.ai suite: it is the agent being admitted,
not one of the services doing the admitting. Before Onboarding can evaluate it, it has to be
addressable as itself — a DID that resolves, a key it controls, and a card that says what it
does and is signed by that key. This document is what was stood up and what was deliberately
left alone.

## What exists now

| | |
|---|---|
| DID | `did:web:stay-agent-mikerawsonnzs-projects.vercel.app` |
| Key | `#key-1`, Ed25519, generated 2026-08-01 |
| Public `x` | `Xq-iwyGyTkg85Ylsnkw1pHJ_1ljyezX9Mwo6wcaCrbM` |
| DID document | `GET /.well-known/did.json` |
| A2A card | `GET /.well-known/agent-card.json` — signed, 5 skills |
| Holder binding | `POST /.well-known/did-auth` — signs a caller nonce |

Code: `src/identity/` (`stayKeys.ts`, `stayDid.ts`, `canonicalJson.ts`, `stayIdentity.ts`),
wired into `src/app.ts`. The card body itself is still `src/a2a/stayAgentCard.ts`.

`#key-1` is published under **both** `assertionMethod` (it signs the card) and
`authentication` (it proves control). Onboard's and Witness's own DID documents publish
assertion only, because those services only ever sign. Stay Agent is the holder, so it needs
the authentication relationship — and it is only honest to publish it because
`/.well-known/did-auth` actually answers. **Do not keep the relationship if the endpoint
goes away.**

## What this does NOT give it

This closed exactly one gap, and it is easy to over-read.

- **Card identity ≠ seal custody.** Stay Agent still has **no Witness account and no
  record-signing key**. Decisions still seal under the shared account
  `acct_01KX3TQ8Z0ME1455RW16JC4ENQ`. An enforcer can now verify that *this agent published
  this card*; it still cannot verify that *this agent sealed a given decision*. Those are two
  different keys and only the first one exists. The card says so in
  `caveats[no_own_witness_account]` and in `custody`.
- **Signed ≠ admitted.** `status.admitted` is still `false`. There is no Onboarding
  credential. The card is the *entry ticket* to admission, not its result.
- **Env-held key.** `STAY_DID_PRIVATE_KEY_B64` is read into process memory at boot, so anyone
  with deploy access to the Vercel project can sign as Stay Agent. Fine for a sandbox demo;
  not fine for real guests or real money, which would need a KMS-backed signer first.
  (`caveats[identity_key_is_process_held]`.)
- **None of the pre-existing divergences.** Self-computed authority, its own HITL queue,
  inline Apaleo writes, no PII minimisation — all unchanged and all still on the card.

## Provisioning — DONE (2026-08-01)

`STAY_DID_PRIVATE_KEY_B64` is installed in the Vercel **Production** environment and the
identity is live: `verify-stay-identity.mjs` passes all 21 checks against
`https://stay-agent-mikerawsonnzs-projects.vercel.app`. The served `publicKeyJwk.x` matches
the locally generated key, which is the proof that the base64 survived the environment
round-trip intact.

The commands, for a rebuild or a second environment:

```bash
cd artifacts/api-server

# 1. Install the private key (from the gitignored b64 file).
vercel env add STAY_DID_PRIVATE_KEY_B64 production < secrets/stay-did-key-1.b64

# 2. Deploy PREBUILT. This matters: build-vercel.mjs bundles everything, so Vercel runs no
#    install. A plain git-triggered build fails on ERR_PNPM_LOCKFILE_CONFIG_MISMATCH — the
#    workspace `overrides` do not match pnpm-lock.yaml. That is what killed the
#    2026-07-27 deploy; it is not an identity problem and --prebuilt sidesteps it.
node build-vercel.mjs
cd ../.. && vercel deploy --prebuilt --prod

# 3. Prove it from the outside. Exits 0 only if every check passes.
cd artifacts/api-server && node scripts/verify-stay-identity.mjs
```

### Do not delete the local key without a backup first

Vercel stored this variable as **Sensitive**, which is write-only: `vercel env pull` returns
an empty value, and there is no API that reads it back. So the deployment is not a copy you
can recover from — it is a black hole. If `secrets/stay-did-key-1.pem` is deleted and the
Vercel value is ever lost or overwritten, the private key is gone permanently and the only
path forward is a **DID rotation**: new key, new `rotationLog` entry, and every verifier that
cached the old document has to be told.

Put the PEM in a password manager or another durable store **first**, then delete the
working copies from `secrets/`. Two custodians, not zero.

## Verifying it (what an enforcer does)

`scripts/verify-stay-identity.mjs` is written as an **independent** verifier: it
re-implements canonicalisation and does its own Ed25519 checks, importing nothing from
`src/`. A verifier sharing code with the signer proves only that the code agrees with itself.

It checks that the DID resolves, that the card's `agentCardSignature` verifies against the
published `#key-1`, that a fresh caller nonce comes back signed (holder binding), and that a
too-short nonce is refused.

## Rotation

Rotating is a deliberate act, not a redeploy. Delete `secrets/stay-did-key-1.pem`, re-run
`scripts/gen-stay-did-key.mjs`, **add a `rotationLog` entry** in `src/identity/stayDid.ts`
recording `fromKeyId`/`toKeyId`, and install the new key. Silently swapping the key under a
DID that resolvers have cached is indistinguishable from compromise.

Moving to a real domain (`stay.getvda.ai`, or a hotel-owned domain) is a **DID change**, not a
redirect — `did:web` is host-bound. Set `STAY_DID_HOST`, expect a new DID, and keep the old
one resolving until it is formally retired.
