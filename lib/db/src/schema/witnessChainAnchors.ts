import { pgTable, serial, text, integer, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * witness_chain_anchors — the externally-anchored head of a chain, held locally.
 *
 * The anchor bundle (Rekor entry + DigiCert/Sectigo RFC-3161 TSA tokens, from
 * GET /api/witness/chains/{chainKey}/proof) is what lets an offline verify reach
 * ANCHORED_VALID: it proves the head was notarised on infrastructure VDA does not control.
 * Stored alongside the mirrored records so verification stays zero-call — fetching the anchor
 * at verify time would call Witness on every click and quietly void that property.
 *
 * Self-authenticating, like the records: the Rekor signature and TSA tokens are checked
 * against pinned roots, and the head is recomputed from OUR records. A tampered anchor row
 * cannot pass — it is availability, not a root of trust.
 */
export const witnessChainAnchors = pgTable(
  "witness_chain_anchors",
  {
    id: serial("id").primaryKey(),
    chainKey: text("chain_key").notNull(),
    head: text("head").notNull(), // sha256:... of the anchored chain head
    seq: integer("seq").notNull(), // the record seq this anchor covers
    anchor: jsonb("anchor").$type<Record<string, unknown>>().notNull(), // { head, seq, rekor, tsa[] }
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // One current anchor per chain — it advances as the chain is re-anchored.
    chain: uniqueIndex("witness_chain_anchors_chain_idx").on(t.chainKey),
  }),
);

export type WitnessChainAnchor = typeof witnessChainAnchors.$inferSelect;
export type InsertWitnessChainAnchor = typeof witnessChainAnchors.$inferInsert;
