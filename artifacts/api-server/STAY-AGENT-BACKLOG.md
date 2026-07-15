# Stay Agent — backlog

Tracked issues discovered during Stay Agent development that are owned elsewhere or deferred.

---

## BL-1 — Witness SDK `verifyTsa` shells out to `openssl`; breaks on serverless (OPEN)

**Owner:** VDA Witness SDK (`vda-witness`), not the Stay Agent.
**Severity:** high for offline `ANCHORED_VALID` on serverless; medium overall (Rekor still verifies, so evidence integrity is not affected — only the second-witness quorum).
**Found:** 2026-07-14, confirmed still open 2026-07-15.

### What
`vda-witness/dist/verify.js` → `verifyTsa()` verifies the RFC-3161 TSA tokens (DigiCert, Sectigo) by spawning the `openssl` CLI (`openssl ts -verify ...`). Two failures observed live:

1. **Vercel's `openssl` is mislinked** — `openssl: symbol lookup error: openssl: undefined symbol: SSL_get_srp_g, version OPENSSL_3.0.0`. The binary cannot execute at all, so *every* TSA verification fails on Vercel serverless, regardless of the token's validity.
2. **No pinned root for `sectigo`** — `no pinned root for TSA "sectigo"`. The SDK's `TSA_ROOTS` map has no Sectigo entry, so that token is never verifiable in **any** environment (this is why the quorum was 1/2 even on a machine with working openssl).

### Impact
The SDK's `offlineVerify` awards `ANCHORED_VALID` only when the Rekor + TSA **quorum** is met (Rekor AND ≥1 TSA). With openssl broken (Vercel) or the Sectigo root missing (everywhere), the quorum can't be completed, so a genuinely-anchored record cannot reach `ANCHORED_VALID` from the SDK alone.

### Mitigation already shipped (Stay Agent side)
`artifacts/api-server/src/lib/verifyRecord.ts` treats **Rekor as the discriminator**: Rekor's signed entry timestamp is verified in pure JS against a pinned key over the recomputed head, so it alone establishes the anchoring claim. When Rekor verifies but the TSA quorum can't complete, the record is reported `SIGNED_PENDING` with the reason verbatim — **never** a false tamper (`BROKEN`). A head mismatch or an invalid Rekor signature still fails loud. This means the Stay Agent is correct and safe today; it just can't display `ANCHORED_VALID` on Vercel until the SDK is fixed.

### Fix wanted (SDK)
1. Verify RFC-3161 TSA tokens **in-process** (e.g. `pkijs` / `@peculiar/asn1-*`) instead of shelling out to `openssl`. Removes the serverless dependency entirely.
2. Add a **pinned Sectigo root** to `TSA_ROOTS` so the second TSA actually verifies.

Once both land, the Stay Agent's existing anchor path reaches `ANCHORED_VALID` on Vercel with **no** Stay-Agent-side change (it already passes the anchor bundle and grades off the returned quorum).

---

## BL-2 — C2MD `assess_agent_risk` latency (~51–99s) vs serverless function limits (OPEN, C2MD-side + config)

**Owner:** C2MD (generation latency) + Stay Agent deploy config.
**Found:** 2026-07-15, C2MD tier-1 first-caller verification.

### What
A successful `skills/assess_agent_risk` call is a full multi-framework LLM generation. Measured live: **~51–55s warm, up to ~99s on a cold-started (scaled-to-zero) C2MD instance.** A validation-error (no LLM) call still takes ~10s on cold start because the governance input gate runs after the instance wakes.

### Impact
- Exceeds common HTTP client defaults (30s) — our client uses a 150s timeout.
- **Exceeds the Vercel Hobby function cap (60s).** A synchronous route will 504 before C2MD answers, routinely (not just on cold start), given the 99s tail.

### Mitigation / options
- `build-vercel.mjs` now sets `maxDuration` (default 60 = Hobby ceiling; `VERCEL_MAX_DURATION=300` on Pro).
- **Reliable fix needs Pro** (300s cap) for a synchronous route, **or** an async job pattern (kick off → poll) if staying on Hobby.
- Console shows a live elapsed-time waiting state and, on timeout, explains the cap rather than implying failure.

### Flag to C2MD
The ~10s cold-start-to-validation-error is a poor first-caller signal (a client with a tight timeout gives up before learning its params were wrong). Consider validating params at the edge / keeping a warm instance for the assess skill.
