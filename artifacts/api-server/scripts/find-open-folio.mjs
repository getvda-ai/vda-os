/**
 * find-open-folio.mjs — DEMO-DATA-SEED helper for the governed-charge demo.
 *
 * Finds an OPEN folio at a property (default BER) via the Apaleo MCP surface, so
 * the Stay Agent can post a real folio charge through the governed path
 * (/api/stay/decision → HITL approve → CreateFolioCharge). This is OPERATOR
 * bootstrap (discovery only — it does not post any charge itself).
 *
 * Prereqs: the api-server running locally with APALEO_CLIENT_ID/SECRET set.
 * Usage:   node artifacts/api-server/scripts/find-open-folio.mjs [BER] [http://localhost:8080]
 *
 * Note on the sandbox: the citizenM sandbox has only historical CheckedOut
 * reservations, but their folios remain status=Open and in EUR, so a
 * post-checkout incidental charge (a legitimate check-out action) lands for
 * real. No fresh booking is needed per demo run — the open folios persist.
 */
const PROP = process.argv[2] || "BER";
const BASE = process.argv[3] || process.env.API_BASE || "http://localhost:8080";

async function mcp(tool, args) {
  const r = await fetch(`${BASE}/api/apaleo/mcp/tools/${tool}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const j = await r.json().catch(() => ({}));
  const text = (j.content || []).map((c) => c.text).join("\n");
  let parsed = null;
  try { parsed = JSON.parse(text); } catch {}
  const data = parsed && parsed.data ? parsed.data : parsed || {};
  return { data, isError: j.isError === true, text };
}

const res = await mcp("ListFolios", { property_ids: [PROP], exclude_closed: false, page_size: 20 });
if (res.isError) { console.error("ListFolios failed:", res.text.slice(0, 300)); process.exit(1); }
const folios = res.data.folios || [];
const open = folios.filter((f) => (f.status || "").toLowerCase() === "open" && f.reservation?.id);
if (open.length === 0) { console.error(`No open folio with a reservation found at ${PROP}.`); process.exit(1); }

const chosen = open[0];
const out = {
  propertyId: PROP,
  reservationId: chosen.reservation.id,
  folioId: chosen.id,
  currency: chosen.balance?.currency || "EUR",
  status: chosen.status,
};
console.error(`[DEMO-DATA-SEED] ${open.length} open folio(s) at ${PROP}; selected:`);
console.log(JSON.stringify(out, null, 2));
