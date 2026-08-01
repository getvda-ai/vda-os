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

## Provisioning (Mike — the key is yours, not the repo's)

The private key was generated locally and is in `secrets/` (gitignored, never committed,
never printed to a transcript). The deployment does not have it yet, so **production
currently serves 503 `identity_not_provisioned` on all three endpoints** — an honest
"not provisioned" rather than a document built from an in-process key.

That refusal is deliberate. Without it, an unprovisioned deployment would mint a fresh
keypair on every cold start and serve a DID document that changes underneath anyone who
cached it — which reads as tampering to a careful verifier and as success to a careless one.

```bash
cd artifacts/api-server

# 1. Install the private key in the deployment (from the gitignored b64 file).
vercel env add STAY_DID_PRIVATE_KEY_B64 production < secrets/stay-did-key-1.b64

# 2. Redeploy from committed source.
node build-vercel.mjs
cd ../.. && vercel deploy --prebuilt --prod

# 3. Prove it from the outside. Exits 0 only if all checks pass.
cd artifacts/api-server && node scripts/verify-stay-identity.mjs
```

Then delete `secrets/stay-did-key-1.pem` and `secrets/stay-did-key-1.b64` — the deployment
is the custodian from that point, and a second copy on a laptop is a second thing to lose.

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

Moving to a real domain (`stay.getvda.ai`, or a citizenM domain) is a **DID change**, not a
redirect — `did:web` is host-bound. Set `STAY_DID_HOST`, expect a new DID, and keep the old
one resolving until it is formally retired.
