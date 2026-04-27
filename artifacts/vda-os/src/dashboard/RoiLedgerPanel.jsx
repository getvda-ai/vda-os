/**
 * RoiLedgerPanel — AP2 Agent Value Ledger dashboard section.
 * Displays per-agent and total ROI from agent_value_events.
 */
import { useState } from "react";
import { usePoll } from "./useDashboard.js";

const DM = { fontFamily: "'DM Sans', sans-serif" };
const MONO = { fontFamily: "'DM Mono', monospace" };

const AGENT_COLORS = {
  "availability-agent":         "#60a5fa",
  "rate-agent":                 "#a78bfa",
  "reservation-bot":            "#4ade80",
  "check-in-agent":             "#34d399",
  "folio-agent":                "#f59e0b",
  "folio-charge-agent":         "#fb923c",
  "checkout-agent":             "#f87171",
  "revenue-reconciliation-agent": "#e879f9",
};

function fmtEur(v) {
  return `€${Number(v).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function fmtLabel(agentId) {
  return (agentId ?? "")
    .replace(/-agent$/, "")
    .replace(/-bot$/, " Bot")
    .replace(/-/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

function KpiCard({ label, value, color, sub }) {
  return (
    <div style={{
      ...DM, flex: 1, minWidth: 110,
      background: "#111318", border: "1px solid #1e2130",
      borderRadius: 10, padding: "14px 16px", textAlign: "center",
    }}>
      <div style={{ fontSize: 24, fontWeight: 700, color, ...MONO }}>{value}</div>
      <div style={{ fontSize: 11, color: "#ffffff", fontWeight: 500, marginTop: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: "#888ea0", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function RoiBar({ value, max }) {
  const pct = max > 0 ? Math.min(100, (Math.max(0, value) / max) * 100) : 0;
  const color = value > 0 ? "#4ade80" : "#f87171";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
      <div style={{ flex: 1, height: 5, background: "#1e2130", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 3 }} />
      </div>
      <span style={{ ...MONO, fontSize: 11, color, minWidth: 64, textAlign: "right" }}>
        {fmtEur(value)}
      </span>
    </div>
  );
}

function DrillDownPanel({ companyId, agentId, onClose }) {
  const { data, loading } = usePoll(async () => {
    const url = `/api/dashboard/value-ledger/events?companyId=${companyId}&limit=50${agentId ? `&agentId=${agentId}` : ""}`;
    const r = await fetch(url);
    return r.json();
  }, 30000);

  const events = data?.events ?? [];

  return (
    <div style={{
      marginTop: 12, background: "#0d0f14", border: "1px solid #1e2130",
      borderRadius: 8, overflow: "hidden",
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 16px", borderBottom: "1px solid #1e2130",
        background: "#111318",
      }}>
        <span style={{ ...DM, fontSize: 12, fontWeight: 600, color: "#fff" }}>
          Event log{agentId ? ` — ${fmtLabel(agentId)}` : ""} (last 50)
        </span>
        <button
          onClick={onClose}
          style={{ ...DM, background: "none", border: "none", color: "#888ea0", cursor: "pointer", fontSize: 14 }}
        >
          ✕
        </button>
      </div>
      {loading && !data ? (
        <div style={{ padding: "12px 16px", color: "#888ea0", fontSize: 12 }}>Loading…</div>
      ) : events.length === 0 ? (
        <div style={{ padding: "12px 16px", color: "#888ea0", fontSize: 12 }}>
          No events yet — run agents to populate the value ledger.
        </div>
      ) : (
        <div style={{ maxHeight: 260, overflowY: "auto" }}>
          {/* Header */}
          <div style={{
            display: "grid", gridTemplateColumns: "140px 150px 100px 80px 80px",
            gap: 8, padding: "7px 16px",
            borderBottom: "1px solid #1e2130",
            fontSize: 10, color: "#888ea0", fontWeight: 600,
            letterSpacing: "0.07em", textTransform: "uppercase",
          }}>
            <span>Agent</span><span>Action</span><span>Outcome</span><span style={{ textAlign: "right" }}>Revenue</span><span style={{ textAlign: "right" }}>Time</span>
          </div>
          {events.map((e, i) => {
            const col = AGENT_COLORS[e.agentId] ?? "#60a5fa";
            const outColor = e.decisionOutcome === "PASS" ? "#4ade80" : e.decisionOutcome === "FAIL" ? "#f87171" : "#f59e0b";
            return (
              <div key={e.id ?? i} style={{
                display: "grid", gridTemplateColumns: "140px 150px 100px 80px 80px",
                gap: 8, padding: "8px 16px", alignItems: "center",
                borderBottom: i < events.length - 1 ? "1px solid #0f1116" : "none",
                fontSize: 11,
              }}>
                <span style={{ ...MONO, color: col, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10 }}>
                  {fmtLabel(e.agentId)}
                </span>
                <span style={{ color: "#c0c6d8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {(e.action ?? "").replace(/_/g, " ")}
                </span>
                <span style={{ color: outColor, fontWeight: 600 }}>{e.decisionOutcome}</span>
                <span style={{ ...MONO, color: "#4ade80", textAlign: "right" }}>
                  {parseFloat(e.revenueDelta ?? 0) !== 0 ? fmtEur(e.revenueDelta) : "—"}
                </span>
                <span style={{ ...MONO, color: "#888ea0", textAlign: "right" }}>
                  {new Date(e.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function RoiLedgerPanel({ companyId }) {
  const [drillAgent, setDrillAgent] = useState(null); // null = closed, "ALL" = all, agentId = specific

  const { data, loading } = usePoll(async () => {
    if (!companyId) return null;
    const r = await fetch(`/api/dashboard/value-ledger?companyId=${companyId}`);
    return r.json();
  }, 30000);

  const totals = data?.totals ?? {};
  const agents = data?.agents ?? [];
  const maxRevenue = Math.max(...agents.map(a => a.totalRevenue), 1);

  const hasData = totals.totalEvents > 0;

  return (
    <div>
      {/* Panel header */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
        <h3 style={{ ...DM, fontSize: 15, fontWeight: 700, color: "#fff", margin: 0 }}>
          Agent Value Ledger
          <span style={{ ...MONO, fontSize: 10, color: "#6b7280", fontWeight: 400, marginLeft: 10 }}>
            AP2 · 30-day window
          </span>
        </h3>
        {hasData && (
          <button
            onClick={() => setDrillAgent(d => d === "ALL" ? null : "ALL")}
            style={{
              ...DM, background: "none", border: "1px solid #1e2130",
              borderRadius: 6, padding: "5px 12px", fontSize: 12, color: "#888ea0",
              cursor: "pointer",
            }}
          >
            {drillAgent === "ALL" ? "Hide event log" : "View event log →"}
          </button>
        )}
      </div>

      {/* KPI row */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <KpiCard
          label="Revenue processed"
          value={hasData ? fmtEur(totals.totalRevenue) : "—"}
          color="#4ade80"
          sub="Governance-approved"
        />
        <KpiCard
          label="Governance cost"
          value={hasData ? fmtEur(totals.totalCostEur) : "—"}
          color="#f59e0b"
          sub="LLM + API overhead"
        />
        <KpiCard
          label="Net value"
          value={hasData ? fmtEur(totals.netValue) : "—"}
          color={totals.netValue >= 0 ? "#4ade80" : "#f87171"}
          sub="Revenue − cost"
        />
        <KpiCard
          label="ROI multiple"
          value={totals.roiMultiple != null ? `${totals.roiMultiple}×` : "—"}
          color="#60a5fa"
          sub={`${totals.passEvents ?? 0} PASS decisions`}
        />
      </div>

      {/* Per-agent breakdown */}
      <div style={{
        background: "#111318", border: "1px solid #1e2130",
        borderRadius: 10, overflow: "hidden",
      }}>
        {loading && !data ? (
          <div style={{ padding: "18px 20px", fontSize: 13, color: "#888ea0" }}>Loading value ledger…</div>
        ) : !hasData ? (
          <div style={{ padding: "18px 20px", textAlign: "center" }}>
            <div style={{ fontSize: 18, marginBottom: 8 }}>📊</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#60a5fa", marginBottom: 4 }}>
              No value events yet
            </div>
            <div style={{ fontSize: 12, color: "#888ea0" }}>
              Run agents via the Live Demo or scenario runner to populate the ledger.
            </div>
          </div>
        ) : (
          <>
            {/* Table header */}
            <div style={{
              display: "grid", gridTemplateColumns: "180px 1fr 80px 80px 70px",
              gap: 10, padding: "8px 16px",
              borderBottom: "1px solid #1e2130",
              fontSize: 10, color: "#888ea0", fontWeight: 600,
              letterSpacing: "0.07em", textTransform: "uppercase",
            }}>
              <span>Agent</span>
              <span>Revenue</span>
              <span style={{ textAlign: "right" }}>Cost</span>
              <span style={{ textAlign: "right" }}>Net</span>
              <span style={{ textAlign: "right" }}>Events</span>
            </div>
            {agents.map((a, i) => {
              const color = AGENT_COLORS[a.agentId] ?? "#60a5fa";
              const isLast = i === agents.length - 1;
              return (
                <div key={a.agentId}>
                  <button
                    onClick={() => setDrillAgent(d => d === a.agentId ? null : a.agentId)}
                    style={{
                      width: "100%", background: drillAgent === a.agentId ? "#13151c" : "none",
                      border: "none", cursor: "pointer", textAlign: "left",
                      display: "grid", gridTemplateColumns: "180px 1fr 80px 80px 70px",
                      gap: 10, padding: "10px 16px", alignItems: "center",
                      borderBottom: isLast && drillAgent !== a.agentId ? "none" : "1px solid #0f1116",
                      transition: "background 0.12s",
                    }}
                    onMouseEnter={ev => { if (drillAgent !== a.agentId) ev.currentTarget.style.background = "#0f1116"; }}
                    onMouseLeave={ev => { if (drillAgent !== a.agentId) ev.currentTarget.style.background = "none"; }}
                  >
                    <span style={{ ...MONO, fontSize: 11, color, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {fmtLabel(a.agentId)}
                    </span>
                    <RoiBar value={a.totalRevenue} max={maxRevenue} />
                    <span style={{ ...MONO, fontSize: 11, color: "#f59e0b", textAlign: "right" }}>
                      {fmtEur(a.totalCostEur)}
                    </span>
                    <span style={{ ...MONO, fontSize: 11, color: a.netValue >= 0 ? "#4ade80" : "#f87171", textAlign: "right", fontWeight: 600 }}>
                      {fmtEur(a.netValue)}
                    </span>
                    <span style={{ ...MONO, fontSize: 11, color: "#888ea0", textAlign: "right" }}>
                      {a.totalEvents}
                    </span>
                  </button>

                  {/* Inline drill-down */}
                  {drillAgent === a.agentId && (
                    <div style={{ padding: "0 12px 12px" }}>
                      <DrillDownPanel
                        companyId={companyId}
                        agentId={a.agentId}
                        onClose={() => setDrillAgent(null)}
                      />
                    </div>
                  )}
                </div>
              );
            })}

            {/* Totals footer */}
            <div style={{
              display: "grid", gridTemplateColumns: "180px 1fr 80px 80px 70px",
              gap: 10, padding: "10px 16px", alignItems: "center",
              borderTop: "1px solid #1e2130", background: "#0d0f14",
            }}>
              <span style={{ fontSize: 11, color: "#fff", fontWeight: 600 }}>Total</span>
              <span style={{ ...MONO, fontSize: 11, color: "#4ade80" }}>{fmtEur(totals.totalRevenue)}</span>
              <span style={{ ...MONO, fontSize: 11, color: "#f59e0b", textAlign: "right" }}>{fmtEur(totals.totalCostEur)}</span>
              <span style={{ ...MONO, fontSize: 11, color: totals.netValue >= 0 ? "#4ade80" : "#f87171", textAlign: "right", fontWeight: 700 }}>{fmtEur(totals.netValue)}</span>
              <span style={{ ...MONO, fontSize: 11, color: "#888ea0", textAlign: "right" }}>{totals.totalEvents}</span>
            </div>
          </>
        )}
      </div>

      {/* All-agents drill-down */}
      {drillAgent === "ALL" && (
        <DrillDownPanel
          companyId={companyId}
          agentId={null}
          onClose={() => setDrillAgent(null)}
        />
      )}
    </div>
  );
}
