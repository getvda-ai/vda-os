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
import { eq, isNotNull } from "drizzle-orm";
import { db, witnessEntries, witnessChainRecords, witnessChainAnchors } from "@workspace/db";
import { fetchChainProof, verifyOffline } from "./witnessClient.js";

export type ChainSource = "local-db" | "witness-records" | "none";

export interface AssembledChain {
  chain: Record<string, unknown>[];
  /** The externally-anchored head (Rekor + TSA). Present → offline verify can reach ANCHORED_VALID. */
  anchor: Record<string, unknown> | null;
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

/** Everything we hold locally for this chain: records we sealed + records we mirrored. */
async function localRecords(chainKey: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];

  // Records we sealed ourselves — the seal response, held in full.
  const rows = await db.select().from(witnessEntries).where(isNotNull(witnessEntries.witnessSealRef));
  for (const row of rows) {
    const ref = row.witnessSealRef as Record<string, unknown> | null;
    if (!ref || ref.chainKey !== chainKey) continue; // one chain per property — never splice two chains
    const rec = ref.record as Record<string, unknown> | undefined;
    if (rec?.proof) out.push(rec); // a record with no proof is a display projection, not evidence
  }

  // Records we did not seal (genesis, or anything sealed by another instance), mirrored
  // locally so the chain can be assembled from seq 0 without calling Witness.
  const mirrored = await db.select().from(witnessChainRecords).where(eq(witnessChainRecords.chainKey, chainKey));
  for (const m of mirrored) if (m.record?.proof) out.push(m.record);

  return out; // normalise() de-duplicates by seq — our own seal wins, since it is pushed first
}

/** The anchor we hold for this chain (Rekor + TSA over the anchored head). */
async function localAnchor(chainKey: string): Promise<Record<string, unknown> | null> {
  const [row] = await db.select().from(witnessChainAnchors).where(eq(witnessChainAnchors.chainKey, chainKey)).limit(1);
  return row?.anchor ?? null;
}

/**
 * Mirror a chain's records AND its anchor locally, so future verifies are zero-call and can
 * reach ANCHORED_VALID.
 *
 * Sourced from GET /chains/{chainKey}/proof — one call returns the full records, the anchor
 * (Rekor entry + DigiCert/Sectigo TSA tokens) and the didDocument.
 *
 * The chain is VERIFIED BEFORE it is stored — signature + continuity from genesis against the
 * pinned did:web key. We will not seed the local store with records we have not checked: a
 * cache populated blindly is a cache that can quietly launder a forgery into "evidence".
 */
export async function backfillChain(chainKey: string): Promise<{ chainKey: string; ok: boolean; added: number[]; alreadyHeld: number[]; fetched: number; anchored: boolean; detail: string }> {
  const proof = await fetchChainProof(chainKey);
  const fetched = normalise(((proof.records ?? []) as Record<string, unknown>[]).filter((r) => r.proof));
  const anchor = (proof.anchor ?? null) as Record<string, unknown> | null;
  if (!fetched.complete) {
    return { chainKey, ok: false, added: [], alreadyHeld: [], fetched: fetched.chain.length, anchored: false, detail: "fetched chain is not genesis-rooted or has a gap — nothing stored" };
  }

  // Verify the head against the full fetched chain: proves every link back to genesis.
  const head = fetched.chain[fetched.chain.length - 1];
  const v = (await verifyOffline(head, fetched.chain)) as { state?: string; reason?: string; checks?: { signature?: boolean; chain?: boolean } };
  if (v.checks?.signature !== true || v.checks?.chain !== true) {
    return { chainKey, ok: false, added: [], alreadyHeld: [], fetched: fetched.chain.length, anchored: false, detail: `refusing to mirror an unverified chain: ${v.state}${v.reason ? `/${v.reason}` : ""} (signature=${v.checks?.signature}, chain=${v.checks?.chain})` };
  }

  const held = new Set((await localRecords(chainKey)).map((r) => Number(r.seq)));
  const added: number[] = [], alreadyHeld: number[] = [];
  for (const rec of fetched.chain) {
    const seq = Number(rec.seq);
    if (held.has(seq)) { alreadyHeld.push(seq); continue; }
    await db.insert(witnessChainRecords)
      .values({ chainKey, seq, recordId: String(rec.recordId ?? ""), record: rec })
      .onConflictDoNothing({ target: [witnessChainRecords.chainKey, witnessChainRecords.seq] });
    added.push(seq);
  }

  // Store/advance the anchor. It moves as the chain is re-anchored, so upsert on chainKey.
  let anchored = false;
  if (anchor?.head && anchor.seq != null) {
    await db.insert(witnessChainAnchors)
      .values({ chainKey, head: String(anchor.head), seq: Number(anchor.seq), anchor })
      .onConflictDoUpdate({ target: witnessChainAnchors.chainKey, set: { head: String(anchor.head), seq: Number(anchor.seq), anchor, fetchedAt: new Date() } });
    anchored = true;
  }

  return { chainKey, ok: true, added, alreadyHeld, fetched: fetched.chain.length, anchored, detail: `chain verified (signature + continuity from genesis) before storing; ${added.length} record(s) mirrored${anchored ? "; anchor (Rekor + TSA) stored" : "; no anchor published yet"}` };
}

/**
 * Assemble the ordered chain for `chainKey`, preferring our own store.
 * Never throws: an unassemblable chain comes back complete=false so callers can say
 * "continuity not established" honestly instead of emitting a false BROKEN.
 */
export async function assembleChain(chainKey: string): Promise<AssembledChain> {
  // 1. Local — the records we sealed, plus the mirrored records we did not (a chain's
  //    seq-0 CHAIN_OPENED record is the Witness operator's, never ours). Zero calls out.
  try {
    const [local, anchor] = await Promise.all([localRecords(chainKey).then(normalise), localAnchor(chainKey)]);
    if (local.complete) {
      return { chain: local.chain, anchor, source: "local-db", complete: true, detail: `${local.chain.length} record(s)${anchor ? " + anchor" : ""} from the local store — 0 calls to witness.getvda.ai` };
    }
  } catch { /* fall through to the evidence fetch */ }

  // 2. Fallback — Witness's chain-proof bundle. An evidence read; the verdict is still ours.
  try {
    const proof = await fetchChainProof(chainKey);
    const remote = normalise(((proof.records ?? []) as Record<string, unknown>[]).filter((r) => r.proof));
    const remoteAnchor = (proof.anchor ?? null) as Record<string, unknown> | null;
    if (remote.complete) {
      // Self-heal: mirror what we just fetched so the NEXT verify is zero-call. Without this
      // the zero-call property decays silently — every new chain (new property) opens with a
      // genesis record we do not hold, and quietly reverts to fetching forever. backfillChain
      // re-verifies from genesis before writing, so nothing unchecked enters the store.
      //
      // AWAITED, not fire-and-forget: on serverless the function is frozen once the response
      // is sent, so a detached write would simply never land and the heal would never happen.
      // A failed mirror must not change the verdict, so it is swallowed — worst case we fetch
      // again next time, which is exactly today's behaviour.
      await backfillChain(chainKey).catch(() => {});
      return { chain: remote.chain, anchor: remoteAnchor, source: "witness-records", complete: true, detail: `${remote.chain.length} record(s) fetched from Witness as evidence — the verdict is still computed locally against the pinned did:web key; mirrored locally so the next verify is zero-call` };
    }
    return {
      chain: remote.chain,
      anchor: remoteAnchor,
      source: remote.chain.length ? "witness-records" : "none",
      complete: false,
      detail: "chain is not genesis-rooted or has a gap — continuity cannot be established from the records available",
    };
  } catch (err) {
    return { chain: [], anchor: null, source: "none", complete: false, detail: `chain unavailable: ${err instanceof Error ? err.message : "unknown error"}` };
  }
}
