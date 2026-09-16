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

## BL-2 — C2MD `assess_agent_risk` latency vs serverless function limits (FIXED in tree 2026-09-16, awaiting deploy)

**Owner:** C2MD (generation latency) + Stay Agent deploy config.
**Found:** 2026-07-15, C2MD tier-1 first-caller verification.

### What
A successful `skills/assess_agent_risk` call is a full multi-framework LLM generation. Measured live: **~51–55s warm, up to ~99s on a cold-started (scaled-to-zero) C2MD instance.** A validation-error (no LLM) call still takes ~10s on cold start because the governance input gate runs after the instance wakes.

### Impact
- Exceeds common HTTP client defaults (30s) — our client uses a 150s timeout.
- **Exceeds the Vercel Hobby function cap (60s).** A synchronous route will 504 before C2MD answers, routinely (not just on cold start), given the 99s tail.

### Resolution (2026-09-16)

**"60s is the Hobby ceiling" was stale, and that stale belief WAS the bug.** Under Fluid
Compute (default for projects created after 2025-04-23) Hobby's default AND maximum are
both **300s**. No Pro upgrade is or ever was required.

`build-vercel.mjs` now defaults `MAX_DURATION` to **300** (still overridable via
`VERCEL_MAX_DURATION`). Verified in the prebuilt output: `.vc-config.json` carries
`"maxDuration": 300`.

**Prerequisite:** Fluid Compute must be ON for the `stay-agent` Vercel project. It is the
default for this project's creation date, but it is the one thing not verifiable through
the API — if a deploy rejects `maxDuration: 300`, the fix is Settings → Functions → enable
Fluid Compute, NOT upgrading to Pro.

### Re-measured latency (2026-09-16, prod, WARM — supersedes the ~51–55s figure)

Three warm anonymous calls to `c2md.getvda.ai`: **58s / 71s / 73s**. One real authenticated
`/a2a` call from this app: **79s server-side, HTTP 200**. No cold start and no validation
retries in any sample — the latency is structural. Breakdown from C2MD's prod logs:
Model Armor ~120ms, pass 1 `gemini-2.5-flash` 11–25s, pass 2 `gemini-2.5-pro` 38–58s.

So the true warm range is **60–80s**, not ~55s. A 60s cap sat below the median, which is
why this 504'd routinely rather than only on cold start.

### Still open (optional, C2MD-side)
A 60–80s synchronous hold is poor UX for a free diagnostic. C2MD already has proven async
rails — `generate_compliance_bundle` is `long_running` (submit → Cloud Tasks → poll via
`tasks/*` on A2A, `get_task` on MCP), and both dispatch paths exist on C2MD's `main`.
Making assess `long_running` would remove the hold, but it changes the skill's public
contract and would break anonymous MCP assess (`get_task` is not an anonymous tool), so it
needs a product decision on C2MD's side — not a Stay Agent change.

### Flag to C2MD
The ~10s cold-start-to-validation-error is a poor first-caller signal (a client with a tight timeout gives up before learning its params were wrong). Consider validating params at the edge / keeping a warm instance for the assess skill.
