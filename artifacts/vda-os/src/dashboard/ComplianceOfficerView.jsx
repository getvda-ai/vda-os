import { useState, useCallback } from "react";
import { usePoll } from "./useDashboard.js";

const DM = { fontFamily: "'DM Sans', sans-serif" };
const MONO = { fontFamily: "'DM Mono', monospace" };

const HOTELS = [
  { companyId: 3, code: "BER", name: "citizenM Berlin" },
  { companyId: 4, code: "LND", name: "citizenM London" },
  { companyId: 5, code: "MUC", name: "citizenM Munich" },
  { companyId: 6, code: "PAR", name: "citizenM Paris" },
  { companyId: 7, code: "VIE", name: "citizenM Vienna" },
];

const GATE_TARGETS = {
  "first_hitl_approval":  "Gate 1",
  "second_hitl_approval": "Gate 2",
};

function Spinner() {
  return (
    <span style={{
      display: "inline-block", width: 13, height: 13, borderRadius: "50%",
      border: "2px solid rgba(255,255,255,0.2)", borderTopColor: "#fff",
      animation: "co-spin 0.7s linear infinite", verticalAlign: "middle",
    }} />
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{
      ...MONO, fontSize: 10, fontWeight: 700, color: "#f87171",
      letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 12,
    }}>
      {children}
    </div>
  );
}

function StatBadge({ value, label, color }) {
  return (
    <div style={{
      ...DM, background: "#111318", border: "1px solid #1e2130",
      borderRadius: 8, padding: "12px 16px", minWidth: 90, textAlign: "center",
    }}>
      <div style={{ fontSize: 24, fontWeight: 700, color: color ?? "#fff", marginBottom: 2 }}>{value}</div>
      <div style={{ fontSize: 11, color: "#9ca3af" }}>{label}</div>
    </div>
  );
}

function GateChip({ status }) {
  if (status === "pending") {
    return (
      <span style={{
        ...MONO, fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
        background: "#451a03", color: "#f59e0b",
        padding: "3px 8px", borderRadius: 4,
      }}>PENDING</span>
    );
  }
  if (status === "approved") {
    return (
      <span style={{
        ...MONO, fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
        background: "#14532d", color: "#4ade80",
        padding: "3px 8px", borderRadius: 4,
      }}>APPROVED</span>
    );
  }
  if (status === "rejected") {
    return (
      <span style={{
        ...MONO, fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
        background: "#450a0a", color: "#f87171",
        padding: "3px 8px", borderRadius: 4,
      }}>REJECTED</span>
    );
  }
  return (
    <span style={{
      ...MONO, fontSize: 10, fontWeight: 600, letterSpacing: "0.04em",
      color: "#4b5563", padding: "3px 8px",
    }}>—</span>
  );
}

function OutcomeChip({ outcome }) {
  if (outcome === "approved") return (
    <span style={{ ...MONO, fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: "#4ade80", background: "#14532d", padding: "2px 7px", borderRadius: 4 }}>APPROVED</span>
  );
  if (outcome === "rejected") return (
    <span style={{ ...MONO, fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: "#f87171", background: "#450a0a", padding: "2px 7px", borderRadius: 4 }}>REJECTED</span>
  );
  return null;
}

function formatTs(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function gateLabelFromPayload(payload) {
  const target = payload?.escalation_target;
  return GATE_TARGETS[target] ?? "Gate";
}

function agentLabel(agentId, agentName) {
  if (agentName && agentName !== "Unknown Agent") return agentName;
  if (agentId) return agentId.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  return "Unknown Agent";
}

function hotelName(companyId) {
  const h = HOTELS.find(h => h.companyId === Number(companyId));
  return h ? `${h.code} — ${h.name}` : `Hotel ${companyId}`;
}

// ─── Pending HITL Card ────────────────────────────────────────────────────────

function PendingCard({ item, onDecision }) {
  const [loading, setLoading] = useState(false);
  const [resolved, setResolved] = useState(false);
  const [toast, setToast] = useState(null);

  const payload = item.payload ?? {};
  const gate = gateLabelFromPayload(payload);
  const risk = payload.risk_level ?? "medium";
  const riskColor = risk === "high" ? "#f87171" : risk === "low" ? "#4ade80" : "#f59e0b";
  const riskBg   = risk === "high" ? "#450a0a" : risk === "low" ? "#14532d" : "#451a03";
  const clause   = payload.governance_clause ?? payload.clause_applied ?? payload.what_triggered ?? "";
  const shortClause = clause.length > 180 ? clause.slice(0, 180) + "…" : clause;

  const handleDecision = useCallback(async (outcome) => {
    if (loading || resolved) return;
    setLoading(true);
    try {
      const resp = await fetch(`/api/hitl/respond/${item.token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outcome,
          reason: outcome === "approved" ? "Approved by Compliance Officer" : "Rejected by Compliance Officer",
          decided_by: "Compliance Officer",
        }),
      });
      if (!resp.ok) throw new Error("Request failed");
      setResolved(true);
      setToast(outcome === "approved" ? "Approved — token resolved" : "Rejected — token resolved");
      setTimeout(() => { setToast(null); onDecision?.(); }, 1200);
    } catch (err) {
      console.error("HITL respond error:", err);
    } finally {
      setLoading(false);
    }
  }, [loading, resolved, item.token, onDecision]);

  return (
    <div style={{
      ...DM, background: "#111318", border: "1px solid #1e2130",
      borderLeft: "4px solid #f87171",
      borderRadius: 10, padding: "16px 18px",
      opacity: resolved ? 0 : 1,
      transform: resolved ? "translateY(-6px)" : "translateY(0)",
      transition: "opacity 0.35s ease, transform 0.35s ease",
      position: "relative", overflow: "hidden",
    }}>
      <style>{`@keyframes co-spin { to { transform: rotate(360deg); } }`}</style>

      {toast && (
        <div style={{
          position: "absolute", top: 10, right: 10, left: 10, zIndex: 10,
          background: "#14532d", border: "1px solid #4ade80", borderRadius: 6,
          padding: "7px 12px", fontSize: 12, color: "#4ade80", fontWeight: 600,
        }}>
          ✓ {toast}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <span style={{
          ...MONO, fontSize: 10, fontWeight: 700, letterSpacing: "0.07em",
          background: "#450a0a", color: "#f87171", padding: "3px 8px", borderRadius: 4,
        }}>{gate}</span>
        <span style={{ fontSize: 12, color: "#e5e7eb", fontWeight: 500 }}>
          {agentLabel(item.agentId, item.agent_name)}
        </span>
        {item.companyId && (
          <span style={{ fontSize: 11, color: "#6b7280", marginLeft: "auto" }}>
            {hotelName(item.companyId)}
          </span>
        )}
      </div>

      <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", lineHeight: 1.4, marginBottom: 8 }}>
        {payload.what_triggered ?? payload.title ?? "Approval required"}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <span style={{
          ...MONO, fontSize: 10, fontWeight: 700, textTransform: "uppercase",
          background: riskBg, color: riskColor, padding: "2px 7px", borderRadius: 4, letterSpacing: "0.06em",
        }}>{risk} risk</span>
        <span style={{ fontSize: 11, color: "#6b7280" }}>{formatTs(item.createdAt)}</span>
      </div>

      {clause && (
        <div style={{
          background: "#0d0f14", border: "1px solid #1e2130",
          borderLeft: "3px solid #f87171",
          borderRadius: 6, padding: "8px 12px", marginBottom: 12,
        }}>
          <div style={{ ...MONO, fontSize: 10, color: "#9ca3af", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>
            Governance clause
          </div>
          <div style={{ ...MONO, fontSize: 11, color: "#d1d5db", lineHeight: 1.6 }}>
            {shortClause}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          disabled={loading || resolved}
          onClick={() => handleDecision("approved")}
          style={{
            flex: 1, padding: "9px 0",
            background: "#14532d", border: "1px solid #4ade80",
            borderRadius: 7, color: "#4ade80",
            fontSize: 13, fontWeight: 700, ...DM,
            cursor: loading || resolved ? "not-allowed" : "pointer",
            opacity: loading || resolved ? 0.5 : 1,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}
        >
          {loading ? <Spinner /> : null} APPROVE
        </button>
        <button
          disabled={loading || resolved}
          onClick={() => handleDecision("rejected")}
          style={{
            flex: 1, padding: "9px 0",
            background: "#450a0a", border: "1px solid #f87171",
            borderRadius: 7, color: "#f87171",
            fontSize: 13, fontWeight: 700, ...DM,
            cursor: loading || resolved ? "not-allowed" : "pointer",
            opacity: loading || resolved ? 0.5 : 1,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}
        >
          {loading ? <Spinner /> : null} REJECT
        </button>
      </div>
    </div>
  );
}

// ─── Gate Status Table ────────────────────────────────────────────────────────

function GateStatusTable({ pendingTokens, recentTokens }) {
  const buildGateStatus = (companyId, gateTarget) => {
    const hasPending = pendingTokens.some(t =>
      Number(t.companyId) === Number(companyId) &&
      (t.payload?.escalation_target === gateTarget || (gateTarget === "first_hitl_approval" && !t.payload?.escalation_target))
    );
    if (hasPending) return "pending";
    const recent = recentTokens.find(t =>
      Number(t.companyId) === Number(companyId) &&
      (t.payload?.escalation_target === gateTarget)
    );
    if (recent) return recent.outcome ?? "clear";
    return "clear";
  };

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", ...DM }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #1e2130" }}>
            <th style={{ textAlign: "left", padding: "8px 12px", fontSize: 11, color: "#6b7280", fontWeight: 600 }}>Hotel</th>
            <th style={{ textAlign: "center", padding: "8px 12px", fontSize: 11, color: "#6b7280", fontWeight: 600 }}>Gate 1</th>
            <th style={{ textAlign: "center", padding: "8px 12px", fontSize: 11, color: "#6b7280", fontWeight: 600 }}>Gate 2</th>
          </tr>
        </thead>
        <tbody>
          {HOTELS.map((hotel) => {
            const g1 = buildGateStatus(hotel.companyId, "first_hitl_approval");
            const g2 = buildGateStatus(hotel.companyId, "second_hitl_approval");
            return (
              <tr key={hotel.companyId} style={{ borderBottom: "1px solid #111318" }}>
                <td style={{ padding: "10px 12px", fontSize: 13, color: "#e5e7eb", fontWeight: 500 }}>
                  <span style={{ ...MONO, fontSize: 10, color: "#6b7280", marginRight: 6 }}>{hotel.code}</span>
                  {hotel.name}
                </td>
                <td style={{ padding: "10px 12px", textAlign: "center" }}>
                  <GateChip status={g1} />
                </td>
                <td style={{ padding: "10px 12px", textAlign: "center" }}>
                  <GateChip status={g2} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Recently Decided Row ─────────────────────────────────────────────────────

function RecentRow({ item }) {
  const payload = item.payload ?? {};
  const gate = gateLabelFromPayload(payload);
  const reviewer = item.decidedBy ?? "Unknown reviewer";
  return (
    <div style={{
      ...DM, padding: "10px 14px", background: "#0d0f14",
      border: "1px solid #1e2130", borderRadius: 8, marginBottom: 6,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
        <OutcomeChip outcome={item.outcome} />
        <span style={{ ...MONO, fontSize: 10, color: "#6b7280" }}>{gate}</span>
        <span style={{ fontSize: 12, color: "#d1d5db", fontWeight: 500, flex: 1, minWidth: 0 }}>
          {payload.what_triggered ?? payload.title ?? `Token ${item.token?.slice(0, 8)}…`}
        </span>
        {item.companyId && (
          <span style={{ fontSize: 11, color: "#6b7280" }}>{hotelName(item.companyId)}</span>
        )}
        <span style={{ fontSize: 11, color: "#6b7280", whiteSpace: "nowrap" }}>
          {formatTs(item.decidedAt)}
        </span>
      </div>
      <div style={{ fontSize: 11, color: "#4b5563", paddingLeft: 2 }}>
        <span style={{ color: "#6b7280" }}>Decided by </span>
        <span style={{ color: "#9ca3af", fontWeight: 500 }}>{reviewer}</span>
      </div>
    </div>
  );
}

// ─── Main View ────────────────────────────────────────────────────────────────

export default function ComplianceOfficerView() {
  const { data: pendingData, loading: pendingLoading, refresh: refreshPending } = usePoll(async () => {
    const r = await fetch("/api/hitl/pending?role_band=compliance_officer");
    return r.json();
  }, 20000);

  const { data: allData, loading: allLoading, refresh: refreshAll } = usePoll(async () => {
    const r = await fetch("/api/hitl/all");
    return r.json();
  }, 30000);

  const forceRefresh = useCallback(() => {
    refreshPending();
    refreshAll();
  }, [refreshPending, refreshAll]);

  const pending = pendingData?.pending ?? [];

  // All resolved compliance tokens — used for gate status accuracy
  const allDecided = (allData?.tokens ?? [])
    .filter(t =>
      t.outcome &&
      (t.roleBand === "compliance_officer" || t.roleBand == null)
    )
    .sort((a, b) => new Date(b.decidedAt ?? 0) - new Date(a.decidedAt ?? 0));

  // Display slice — top 10 for the recent decisions list
  const recentDecided = allDecided.slice(0, 10);

  const pendingCount = pending.length;
  const approvedCount = allDecided.filter(t => t.outcome === "approved").length;
  const rejectedCount = allDecided.filter(t => t.outcome === "rejected").length;

  return (
    <div style={{ padding: "28px 32px", maxWidth: 960, ...DM }}>
      <style>{`@keyframes co-spin { to { transform: rotate(360deg); } }`}</style>

      {/* Header */}
      <div style={{ ...MONO, fontSize: 11, fontWeight: 700, color: "#f87171", letterSpacing: "0.1em", marginBottom: 6 }}>
        COMPLIANCE OFFICER — GOVERNANCE SIGN-OFF
      </div>
      <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 24 }}>
        Cross-portfolio oversight · Gate 1 + Gate 2 approvals · All 5 hotels
      </div>

      {/* Summary stats */}
      <div style={{ display: "flex", gap: 12, marginBottom: 28, flexWrap: "wrap" }}>
        <StatBadge value={pendingCount} label="Pending approvals" color={pendingCount > 0 ? "#f59e0b" : "#4ade80"} />
        <StatBadge value={approvedCount} label="Recently approved" color="#4ade80" />
        <StatBadge value={rejectedCount} label="Recently rejected" color="#f87171" />
        <StatBadge value={HOTELS.length} label="Hotels monitored" color="#60a5fa" />
      </div>

      {/* Per-hotel Gate Status */}
      <div style={{ background: "#111318", border: "1px solid #1e2130", borderRadius: 10, padding: "16px 18px", marginBottom: 28 }}>
        <SectionLabel>Hotel gate status</SectionLabel>
        {(pendingLoading && !pendingData) ? (
          <div style={{ color: "#4b5563", fontSize: 13, padding: "12px 0" }}>Loading gate status…</div>
        ) : (
          <GateStatusTable pendingTokens={pending} recentTokens={allDecided} />
        )}
      </div>

      {/* Pending Approvals */}
      <div style={{ marginBottom: 28 }}>
        <SectionLabel>
          Pending approvals{pendingCount > 0 ? ` (${pendingCount})` : ""}
        </SectionLabel>
        {pendingLoading && !pendingData ? (
          <div style={{ color: "#4b5563", fontSize: 13 }}>Loading…</div>
        ) : pending.length === 0 ? (
          <div style={{
            background: "#111318", border: "1px solid #1e2130",
            borderRadius: 10, padding: "20px 18px",
            fontSize: 13, color: "#4b5563", textAlign: "center",
          }}>
            No pending approvals — all gates clear
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 14 }}>
            {pending.map(item => (
              <PendingCard key={item.token} item={item} onDecision={forceRefresh} />
            ))}
          </div>
        )}
      </div>

      {/* Recent decisions */}
      <div>
        <SectionLabel>Recent decisions</SectionLabel>
        {allLoading && !allData ? (
          <div style={{ color: "#4b5563", fontSize: 13 }}>Loading…</div>
        ) : recentDecided.length === 0 ? (
          <div style={{
            background: "#111318", border: "1px solid #1e2130",
            borderRadius: 10, padding: "16px 18px",
            fontSize: 13, color: "#4b5563", textAlign: "center",
          }}>
            No resolved tokens yet
          </div>
        ) : (
          <div>
            {recentDecided.map(item => (
              <RecentRow key={item.token} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
