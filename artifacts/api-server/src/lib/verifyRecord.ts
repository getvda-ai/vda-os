/**
 * verifyRecord.ts — the SINGLE verification policy.
 *
 * Every caller (the Verify button, the persisted-verdict repair, the seal path) must reach the
 * same verdict for the same record. When this logic was duplicated, the copies drifted: the
 * seal path verified against a chain of one, persisted BROKEN, and the console then rendered a
 * tamper alarm over evidence the live verifier considered intact. One policy, one place.
 *
 * The three ways a verdict can be WRONG, and the rule that prevents each:
 *   1. False tamper from a missing INPUT — no chain in hand → BROKEN/"chain". Report
 *      chainChecked=false and let the caller stay neutral; never persist it as BROKEN.
 *   2. False tamper from a check that could not RUN — the SDK's TSA verification shells out to
 *      openssl, absent on some serverless runtimes → quorum unmet → BROKEN/"anchor". Failing to
 *      run a check is not a check failing. Downgrade — but ONLY when Rekor still verifies.
 *   3. A forgery waved through — a fabricated anchor must never be downgraded as "environmental".
 *      Rekor's signature covers the head and is verified in pure JS against a pinned key, so a
 *      forged signature or a wrong head fails there and stays loud. A verdict is never upgraded
 *      on the strength of a TSA token, so a forged one buys an attacker nothing.
 */
import { verifyOffline } from "./witnessClient.js";
import { assembleChain } from "./witnessChainProof.js";
import { logger } from "./logger.js";

export interface VerifyOutcome {
  verdict: Record<string, unknown>;
  chain: { source: string; length: number; checked: boolean; detail: string };
  anchor: { supplied: boolean; seq: number | null; note?: string };
  /** The state to PERSIST — never a false BROKEN. */
  persistState: string;
}

export async function verifyRecordAgainstChain(
  record: Record<string, unknown>,
  chainKey: string,
  supplied?: { chain?: Record<string, unknown>[]; anchor?: Record<string, unknown> | null },
): Promise<VerifyOutcome> {
  let chain = supplied?.chain;
  let anchor = supplied?.anchor ?? null;
  let source = chain ? "caller-supplied" : "none";
  let detail = chain ? `${chain.length} record(s) supplied by the caller` : "";

  if (!chain) {
    const assembled = await assembleChain(chainKey);
    source = assembled.source;
    detail = assembled.detail;
    anchor = anchor ?? assembled.anchor;
    if (assembled.complete) {
      chain = assembled.chain;
      // The SDK rejects a record absent from the supplied chain as BROKEN/"malformed". A record
      // can legitimately be absent — sealed after this snapshot. Extend by one when it is the
      // contiguous next link (verifyChain still checks the linkage, so a forgery fails); else
      // verify without a chain rather than manufacture "malformed" for evidence out of view.
      if (!chain.some((r) => r.recordId === record.recordId)) {
        if (Number(record.seq) === chain.length) {
          chain = [...chain, record];
          detail = `${detail}; record under test appended as the contiguous next link`;
        } else {
          chain = undefined;
          detail = `record seq ${String(record.seq)} is not in the assembled chain (${assembled.chain.length} record(s)) — continuity not established`;
        }
      }
    }
  }

  let verdict = (await verifyOffline(record, chain, anchor ?? undefined)) as Record<string, unknown>;
  let note: string | undefined;

  if (verdict.state === "BROKEN" && verdict.reason === "anchor" && anchor) {
    const d = String(verdict.detail ?? "");
    const an = ((verdict.checks ?? {}) as { anchor?: { rekor?: { verified?: boolean }; tsa?: Array<{ provider?: string; verified?: boolean; detail?: string }> } }).anchor ?? {};
    const headMismatch = /recomputed head does not match/i.test(d);
    const rekorOk = an.rekor?.verified === true;
    const tsa = an.tsa ?? [];

    // What actually establishes the anchoring claim is REKOR: its signed entry timestamp is
    // verified in pure JS against a pinned key, over the head we recomputed from our own
    // records. An attacker cannot make an unanchored head verify there, and a tampered record
    // already dies at the signature/chain checks. The TSA tokens are a SECOND, independent
    // witness, and the SDK's quorum (Rekor AND >=1 TSA) is a stricter bar than integrity —
    // failing that bar is not evidence of tampering.
    //
    // And the bar cannot always be reached for reasons that have nothing to do with the
    // evidence. Observed in production, both benign:
    //   • digicert — "openssl: symbol lookup error: undefined symbol SSL_get_srp_g": the
    //     openssl binary on Vercel is mislinked and cannot execute at all.
    //   • sectigo  — "no pinned root for TSA \"sectigo\"": the SDK ships no trust anchor for
    //     that provider, so the token is never checked in ANY environment.
    // Neither can be told apart from a forged token by its message (openssl's failure text is
    // its first stderr line, which is config noise), so pattern-matching the detail is not a
    // sound basis for a tamper alarm — and calling intact, Rekor-anchored evidence BROKEN is
    // the exact failure this whole effort exists to eliminate.
    //
    // So: Rekor is the discriminator.
    //   • recomputed head != anchored head → a pre-anchor record was ALTERED. Tamper. Loud.
    //   • Rekor invalid                    → the anchor does not establish anchoring. Loud.
    //   • Rekor valid, quorum incomplete   → the head IS provably in the public transparency
    //                                        log; we simply cannot complete the second witness.
    //                                        Do NOT award ANCHORED_VALID, do NOT cry tamper.
    // Nothing is upgraded on the strength of a TSA token, so forging one gains an attacker
    // nothing — and the per-TSA failures are surfaced verbatim rather than swallowed.
    if (!headMismatch && rekorOk) {
      verdict = (await verifyOffline(record, chain)) as Record<string, unknown>;
      const why = tsa.length === 0
        ? "no TSA tokens were supplied"
        : tsa.map((t) => `${t.provider}: ${String(t.detail ?? "unverified").slice(0, 90)}`).join(" · ");
      note = `Rekor VERIFIED — the chain head is provably in the public transparency log (independent of VDA), and signature + hash-chain are proven locally. The Rekor+TSA quorum could not be completed, so ANCHORED_VALID is not awarded: ${why}. An incomplete second witness, NOT failed evidence — deliberately not reported as tamper.`;
      logger.warn({ detail: d, tsa }, "[verify] Rekor ok but TSA quorum incomplete — signature+chain+Rekor stand; not a tamper");
    } else {
      logger.error({ detail: d, rekorOk, headMismatch }, "[verify] anchor FAILED verification — BROKEN");
    }
  }

  // What we PERSIST. A "chain" failure with a valid signature and no chain in hand is a missing
  // input, not a tamper — never write that to the record's state. Everything else is verbatim.
  const chainChecked = chain !== undefined;
  const inputMissing =
    !chainChecked &&
    verdict.state === "BROKEN" &&
    verdict.reason === "chain" &&
    ((verdict.checks ?? {}) as { signature?: boolean }).signature === true;
  const persistState = inputMissing ? "SIGNED_PENDING" : String(verdict.state ?? "SIGNED_PENDING");

  return {
    verdict,
    chain: { source, length: chain?.length ?? 0, checked: chainChecked, detail },
    anchor: { supplied: Boolean(anchor), seq: (anchor?.seq as number | undefined) ?? null, note },
    persistState,
  };
}
