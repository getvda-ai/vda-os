/**
 * Chain assembly — the verification INPUT for an offline verify.
 *
 * The SDK's verifyChain() recomputes, for every record i, the hash of the canonicalised
 * predecessor and compares it to record[i].prevHash — so it needs the ordered records
 * from GENESIS up to the one under test. Handing it a single record (chain = [rec]) can
 * only ever succeed at seq 0: every other record's prevHash has nothing to link against
 * and the verdict comes back BROKEN/"chain". That is a verifier-INPUT defect, not tamper
 * evidence, and rendering it as a failed verification accuses an intact trail of forgery.
 *
 * We already persist every sealed record in full (proof + prevHash + signer) in
 * witness_entries.witness_seal_ref, so the chain is reconstructable from OUR OWN store —
 * no call to witness.getvda.ai. Offline verification stays literally zero-call, and the
 * audit claim gets stronger rather than weaker: the trail's integrity is demonstrable
 * from local evidence plus the pinned did:web key, without asking the issuer to vouch
 * for itself.
 *
 * Witness's /records?view=full is the fallback for chains we did not seal ourselves, or
 * where our store has a gap. That is an EVIDENCE fetch, not a verdict fetch — the verdict
 * is still computed locally — but it IS a network call, so we report which source was
 * used instead of claiming zero-call unconditionally.
 */
import { isNotNull } from "drizzle-orm";
import { db, witnessEntries } from "@workspace/db";
import { fetchRecords } from "./witnessClient.js";

export type ChainSource = "local-db" | "witness-records" | "none";

export interface AssembledChain {
  chain: Record<string, unknown>[];
  source: ChainSource;
  /** Genesis-rooted and gap-free (seq 0..n) — verifyChain() only holds when this is true. */
  complete: boolean;
  detail: string;
}

/** Order, de-duplicate, and report whether the result is a genuine genesis-rooted chain. */
function normalise(records: Record<string, unknown>[]): { chain: Record<string, unknown>[]; complete: boolean } {
  const bySeq = new Map<number, Record<string, unknown>>();
  for (const r of records) {
    const seq = Number(r.seq);
    if (!Number.isFinite(seq)) continue;
    if (!bySeq.has(seq)) bySeq.set(seq, r); // first wins — a re-read of the same seq is the same record
  }
  const chain = [...bySeq.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => r);
  const complete =
    chain.length > 0 &&
    Number(chain[0].seq) === 0 &&
    (chain[0].prevHash ?? null) === null &&
    chain.every((r, i) => Number(r.seq) === i);
  return { chain, complete };
}

/**
 * Assemble the ordered chain for `chainKey`, preferring our own store.
 * Never throws: an unassemblable chain comes back complete=false so callers can say
 * "continuity not established" honestly instead of emitting a false BROKEN.
 */
export async function assembleChain(chainKey: string): Promise<AssembledChain> {
  // 1. Local — the records we sealed, held in full. Zero calls to witness.getvda.ai.
  try {
    const rows = await db.select().from(witnessEntries).where(isNotNull(witnessEntries.witnessSealRef));
    const mine: Record<string, unknown>[] = [];
    for (const row of rows) {
      const ref = row.witnessSealRef as Record<string, unknown> | null;
      if (!ref || ref.chainKey !== chainKey) continue; // one chain per property — never splice two chains
      const rec = ref.record as Record<string, unknown> | undefined;
      if (rec?.proof) mine.push(rec); // a record with no proof is a display projection, not evidence
    }
    const local = normalise(mine);
    if (local.complete) {
      return { chain: local.chain, source: "local-db", complete: true, detail: `${local.chain.length} record(s) from the local store — 0 calls to witness.getvda.ai` };
    }
  } catch { /* fall through to the evidence fetch */ }

  // 2. Fallback — Witness's own full view. An evidence read; the verdict is still ours.
  try {
    const raw = await fetchRecords(chainKey, "full");
    const remote = normalise(((raw.records ?? []) as Record<string, unknown>[]).filter((r) => r.proof));
    if (remote.complete) {
      return { chain: remote.chain, source: "witness-records", complete: true, detail: `${remote.chain.length} record(s) fetched from Witness as evidence — the verdict is still computed locally against the pinned did:web key` };
    }
    return {
      chain: remote.chain,
      source: remote.chain.length ? "witness-records" : "none",
      complete: false,
      detail: "chain is not genesis-rooted or has a gap — continuity cannot be established from the records available",
    };
  } catch (err) {
    return { chain: [], source: "none", complete: false, detail: `chain unavailable: ${err instanceof Error ? err.message : "unknown error"}` };
  }
}
