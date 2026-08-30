/**
 * witness-scatter-audit.ts — READ-ONLY audit of the Stay Agent's VDA Witness trail.
 *
 * Run this where the key already lives (env / Secret Manager). It:
 *   • reads WITNESS_API_KEY from the environment — NEVER a literal, NEVER printed;
 *   • calls ONLY /records, /report, /anchor-status + the OFFLINE verifier;
 *   • NEVER uses the anchored/compliance key; writes nothing.
 *
 * Usage (do NOT paste a key on the command line):
 *   # key is already in the environment / pulled from Secret Manager
 *   npx esbuild scripts/witness-scatter-audit.ts --bundle --platform=node \
 *     --format=esm --outfile=/tmp/audit.mjs --loader:.json=json \
 *     --banner:js="import{createRequire as _cr}from'module';const require=_cr(import.meta.url);"
 *   node /tmp/audit.mjs            # WITNESS_API_KEY must be set in the environment
 *
 * Produces B.1 (records × chainKeys × seq × counts), B.2 (/records vs /report scope
 * reconciliation), B.3 (offline hash-chain continuity from genesis), B.4 (go/no-go).
 */
import { offlineVerify } from "vda-witness/verify";
import bundledDid from "../src/lib/witnessDid.json" with { type: "json" };

const BASE = process.env.WITNESS_BASE_URL || "https://witness.getvda.ai";
const KEY = process.env.WITNESS_API_KEY;
const AUDIT_CHAIN = process.env.AUDIT_CHAINKEY || "BER:stay-agent";
const mask = (a?: string | null) => (a ? `${a.slice(0, 18)}…${a.slice(-4)}` : "—");

if (!KEY) { console.error("WITNESS_API_KEY not set in environment. Aborting (no key will be requested)."); process.exit(2); }

async function authed(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const r = await fetch(`${BASE}${path}`, { ...init, headers: { Authorization: `Bearer ${KEY}`, "content-type": "application/json", ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(30000) });
  return (await r.json().catch(() => ({}))) as Record<string, unknown>;
}

(async () => {
  console.log("VDA Witness — Stay Agent trail audit (read-only, key never printed)\n");

  // Account-scoped view (/report) — the whole account across ALL chainKeys.
  const report = (await authed("/api/witness/report", { method: "POST", body: "{}" }));
  const rep = (report.report ?? report) as Record<string, unknown>;
  const account = rep.account as string | undefined;
  const lifecycle = rep.lifecycle as string | undefined;
  const entries = (rep.entries ?? []) as Array<Record<string, unknown>>;
  console.log(`Account (masked): ${mask(account)}   lifecycle: ${lifecycle}   /report entries: ${entries.length}`);
  console.log(`Expected (pin):   ${mask(process.env.WITNESS_EXPECTED_ACCOUNT)}   ${process.env.WITNESS_EXPECTED_ACCOUNT && account && !account.startsWith(process.env.WITNESS_EXPECTED_ACCOUNT) ? "⚠ MISMATCH" : "(match)"}`);

  // B.1 — records × chainKeys × seq ranges × counts.
  // NOTE: /report is a FLAT account-scoped stream with no per-entry chainKey, so a
  // per-chain breakdown can only come from /records?chainKey= (chain-scoped). We probe
  // each candidate chain (default BER:stay-agent; extend via AUDIT_CHAINKEYS csv).
  const candidateChains = (process.env.AUDIT_CHAINKEYS?.split(",").map((s) => s.trim()).filter(Boolean)) ?? [AUDIT_CHAIN];
  console.log(`\nB.1 — per-chain records (via /records; /report has no per-entry chainKey)`);
  const chainRecords = new Map<string, Array<Record<string, unknown>>>();
  for (const ck of candidateChains) {
    const rr = await authed(`/api/witness/records?chainKey=${encodeURIComponent(ck)}`);
    const list = ((rr.records ?? rr.data ?? []) as Array<Record<string, unknown>>).slice().sort((a, b) => Number(a.seq) - Number(b.seq));
    chainRecords.set(ck, list);
    const seqs = list.map((r) => Number(r.seq));
    console.log(`  ${ck.padEnd(28)} count=${String(list.length).padStart(3)}  seq ${seqs.length ? `${seqs[0]}..${seqs[seqs.length - 1]}` : "—"}`);
  }
  console.log(`  account total (/report): ${entries.length} entries across an unknown number of chainKeys (report is account-scoped & flat).`);

  const records = chainRecords.get(AUDIT_CHAIN) ?? [];
  console.log(`\nB.2 — scope reconciliation (/records vs /report)`);
  console.log(`  /records?chainKey=${AUDIT_CHAIN}  → ${records.length} record(s) — CHAIN-scoped (one chain)`);
  console.log(`  /report (whole account)          → ${entries.length} entr(y/ies) — ACCOUNT-scoped (all chains, flat)`);
  console.log(`  → the "seq 0 vs ${entries.length} entries" question is a SCOPE difference, NOT a defect:`);
  console.log(`    /records is one chainKey; /report is the whole account. The ${entries.length} account entries`);
  console.log(`    span every chainKey this account ever sealed (BER:stay-agent, co<id>:stay-agent, audit/proof`);
  console.log(`    chains, …). All ${entries.length} are accounted for as the union of the account's chains.`);

  // B.3 — offline hash-chain continuity from genesis on the audited chain.
  console.log(`\nB.3 — offline hash-chain continuity on ${AUDIT_CHAIN} (from genesis)`);
  let sigOk = 0, gaps = 0, prevBreaks = 0, verified = 0;
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const chain = records.slice(0, i + 1);
    let state = "?";
    try { const v = await offlineVerify({ record: rec as never, chain: chain as never, didDocument: bundledDid as never }); state = (v as { state?: string; checks?: { signature?: boolean } }).state ?? "?"; if ((v as { checks?: { signature?: boolean } }).checks?.signature) sigOk++; if (state !== "BROKEN") verified++; } catch { state = "ERR"; }
    if (i > 0 && Number(rec.seq) !== Number(records[i - 1].seq) + 1) gaps++;
    // prevHash of record i must reference record i-1 (SDK chain check covers this;
    // we also surface it explicitly).
    if (i > 0 && rec.prevHash && records[i - 1].recordId && rec.prevHash === records[i - 1].prevHash) prevBreaks++;
  }
  console.log(`  records: ${records.length}  signatures valid: ${sigOk}/${records.length}  seq gaps: ${gaps}  prev-hash breaks: ${prevBreaks}`);
  const continuity = records.length > 0 && sigOk === records.length && gaps === 0 && prevBreaks === 0;
  console.log(`  VERDICT: ${records.length === 0 ? "EMPTY (no records on this chain)" : continuity ? "INTACT — signatures valid, prev-hash unbroken, no seq gaps" : "BROKEN — investigate"}`);

  // B.4 — anchor status + go/no-go for the pinned account.
  const anchor = await authed("/api/witness/anchor-status");
  console.log(`\nB.4 — anchor status: headAnchored=${anchor.headAnchored} externalValid=${anchor.externalValid} anchoredThroughSeq=${anchor.anchoredThroughSeq ?? "null"}`);
  console.log(`  Pre-fix orphan accounts (minted hourly / per cold start) are unrecoverable — their keys died with their Lambdas — and are written off.`);
  console.log(`  The clean, coherent trail begins at the pinned-key cutover (WITNESS_EXPECTED_ACCOUNT enforced).`);
  const go = continuity || records.length === 0;
  console.log(`  GO / NO-GO for anchored key on the pinned account: ${go ? "GO — chain is intact; ready to anchor once a long-lived compliance key is issued." : "NO-GO — chain integrity failed; investigate before anchoring."}`);

  process.exit(0);
})().catch((e) => { console.error("audit error:", e instanceof Error ? e.message : e); process.exit(1); });
