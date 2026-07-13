import { pgTable, serial, text, integer, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * witness_chain_records — a local mirror of Witness chain records we did NOT seal
 * ourselves, so an offline verify can assemble the chain from genesis without calling
 * witness.getvda.ai.
 *
 * verifyChain() links record i to the canonical hash of record i-1, so it needs the
 * ordered records from GENESIS. We persist every record we seal (witness_entries.
 * witness_seal_ref), but a chain's seq-0 record is opened by the Witness operator
 * (verdict CHAIN_OPENED) — it is not one of our decisions, so we never held it, and the
 * chain could not be assembled locally. This table holds those records.
 *
 * Caching them is safe because they are SELF-AUTHENTICATING: each carries its Ed25519
 * proof and prevHash, checked against the pinned did:web key. A tampered mirror is caught
 * by the verifier itself — nobody is asked to trust this store. It is a convenience for
 * availability, never a root of trust, which is why records are verified BEFORE they are
 * written here.
 */
export const witnessChainRecords = pgTable(
  "witness_chain_records",
  {
    id: serial("id").primaryKey(),
    chainKey: text("chain_key").notNull(),
    seq: integer("seq").notNull(),
    recordId: text("record_id").notNull(),
    record: jsonb("record").$type<Record<string, unknown>>().notNull(), // the full signed record (proof + prevHash + signer)
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // One record per position per chain — a chain never has two seq-N records.
    chainSeq: uniqueIndex("witness_chain_records_chain_seq_idx").on(t.chainKey, t.seq),
  }),
);

export type WitnessChainRecord = typeof witnessChainRecords.$inferSelect;
export type InsertWitnessChainRecord = typeof witnessChainRecords.$inferInsert;
