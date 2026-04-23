import { useState, useCallback } from "react";
import { usePoll } from "./useDashboard.js";

const DM   = { fontFamily: "'DM Sans', sans-serif" };
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

// ─── Shared primitives ─────────────────────────────────────────────────────────

function Spinner() {
  return (
    <span style={{
      display: "inline-block", width: 13, height: 13, borderRadius: "50%",
      border: "2px solid rgba(255,255,255,0.2)", borderTopColor: "#fff",
      animation: "co-spin 0.7s linear infinite", verticalAlign: "middle",
    }} />
  );
}

function SectionLabel({ children, color = "#f87171" }) {
  return (
    <div style={{
      ...MONO, fontSize: 10, fontWeight: 700, color,
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
  if (status === "pending") return (
    <span style={{ ...MONO, fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", background: "#451a03", color: "#f59e0b", padding: "3px 8px", borderRadius: 4 }}>PENDING</span>
  );
  if (status === "approved") return (
    <span style={{ ...MONO, fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", background: "#14532d", color: "#4ade80", padding: "3px 8px", borderRadius: 4 }}>APPROVED</span>
  );
  if (status === "rejected") return (
    <span style={{ ...MONO, fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", background: "#450a0a", color: "#f87171", padding: "3px 8px", borderRadius: 4 }}>REJECTED</span>
  );
  return (
    <span style={{ ...MONO, fontSize: 10, fontWeight: 600, letterSpacing: "0.04em", color: "#4b5563", padding: "3px 8px" }}>—</span>
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

function formatDate(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
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

// ─── Gate Approvals Tab ────────────────────────────────────────────────────────

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
      borderLeft: "4px solid #f87171", borderRadius: 10, padding: "16px 18px",
      opacity: resolved ? 0 : 1, transform: resolved ? "translateY(-6px)" : "translateY(0)",
      transition: "opacity 0.35s ease, transform 0.35s ease",
      position: "relative", overflow: "hidden",
    }}>
      {toast && (
        <div style={{
          position: "absolute", top: 10, right: 10, left: 10, zIndex: 10,
          background: "#14532d", border: "1px solid #4ade80", borderRadius: 6,
          padding: "7px 12px", fontSize: 12, color: "#4ade80", fontWeight: 600,
        }}>✓ {toast}</div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <span style={{ ...MONO, fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", background: "#450a0a", color: "#f87171", padding: "3px 8px", borderRadius: 4 }}>{gate}</span>
        <span style={{ fontSize: 12, color: "#e5e7eb", fontWeight: 500 }}>{agentLabel(item.agentId, item.agent_name)}</span>
        {item.companyId && <span style={{ fontSize: 11, color: "#6b7280", marginLeft: "auto" }}>{hotelName(item.companyId)}</span>}
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", lineHeight: 1.4, marginBottom: 8 }}>
        {payload.what_triggered ?? payload.title ?? "Approval required"}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <span style={{ ...MONO, fontSize: 10, fontWeight: 700, textTransform: "uppercase", background: riskBg, color: riskColor, padding: "2px 7px", borderRadius: 4, letterSpacing: "0.06em" }}>{risk} risk</span>
        <span style={{ fontSize: 11, color: "#6b7280" }}>{formatTs(item.createdAt)}</span>
      </div>
      {clause && (
        <div style={{ background: "#0d0f14", border: "1px solid #1e2130", borderLeft: "3px solid #f87171", borderRadius: 6, padding: "8px 12px", marginBottom: 12 }}>
          <div style={{ ...MONO, fontSize: 10, color: "#9ca3af", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>Governance clause</div>
          <div style={{ ...MONO, fontSize: 11, color: "#d1d5db", lineHeight: 1.6 }}>{shortClause}</div>
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button disabled={loading || resolved} onClick={() => handleDecision("approved")} style={{ flex: 1, padding: "9px 0", background: "#14532d", border: "1px solid #4ade80", borderRadius: 7, color: "#4ade80", fontSize: 13, fontWeight: 700, ...DM, cursor: loading || resolved ? "not-allowed" : "pointer", opacity: loading || resolved ? 0.5 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          {loading ? <Spinner /> : null} APPROVE
        </button>
        <button disabled={loading || resolved} onClick={() => handleDecision("rejected")} style={{ flex: 1, padding: "9px 0", background: "#450a0a", border: "1px solid #f87171", borderRadius: 7, color: "#f87171", fontSize: 13, fontWeight: 700, ...DM, cursor: loading || resolved ? "not-allowed" : "pointer", opacity: loading || resolved ? 0.5 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          {loading ? <Spinner /> : null} REJECT
        </button>
      </div>
    </div>
  );
}

function GateStatusTable({ pendingTokens, recentTokens }) {
  const buildGateStatus = (companyId, gateTarget) => {
    const hasPending = pendingTokens.some(t =>
      Number(t.companyId) === Number(companyId) &&
      (t.payload?.escalation_target === gateTarget || (gateTarget === "first_hitl_approval" && !t.payload?.escalation_target))
    );
    if (hasPending) return "pending";
    const recent = recentTokens.find(t =>
      Number(t.companyId) === Number(companyId) && t.payload?.escalation_target === gateTarget
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
          {HOTELS.map((hotel) => (
            <tr key={hotel.companyId} style={{ borderBottom: "1px solid #111318" }}>
              <td style={{ padding: "10px 12px", fontSize: 13, color: "#e5e7eb", fontWeight: 500 }}>
                <span style={{ ...MONO, fontSize: 10, color: "#6b7280", marginRight: 6 }}>{hotel.code}</span>
                {hotel.name}
              </td>
              <td style={{ padding: "10px 12px", textAlign: "center" }}>
                <GateChip status={buildGateStatus(hotel.companyId, "first_hitl_approval")} />
              </td>
              <td style={{ padding: "10px 12px", textAlign: "center" }}>
                <GateChip status={buildGateStatus(hotel.companyId, "second_hitl_approval")} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecentRow({ item }) {
  const payload = item.payload ?? {};
  const gate = gateLabelFromPayload(payload);
  const reviewer = item.decidedBy ?? "Unknown reviewer";
  return (
    <div style={{ ...DM, padding: "10px 14px", background: "#0d0f14", border: "1px solid #1e2130", borderRadius: 8, marginBottom: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
        <OutcomeChip outcome={item.outcome} />
        <span style={{ ...MONO, fontSize: 10, color: "#6b7280" }}>{gate}</span>
        <span style={{ fontSize: 12, color: "#d1d5db", fontWeight: 500, flex: 1, minWidth: 0 }}>
          {payload.what_triggered ?? payload.title ?? `Token ${item.token?.slice(0, 8)}…`}
        </span>
        {item.companyId && <span style={{ fontSize: 11, color: "#6b7280" }}>{hotelName(item.companyId)}</span>}
        <span style={{ fontSize: 11, color: "#6b7280", whiteSpace: "nowrap" }}>{formatTs(item.decidedAt)}</span>
      </div>
      <div style={{ fontSize: 11, color: "#4b5563", paddingLeft: 2 }}>
        <span style={{ color: "#6b7280" }}>Decided by </span>
        <span style={{ color: "#9ca3af", fontWeight: 500 }}>{reviewer}</span>
      </div>
    </div>
  );
}

// ─── EU AI Act Tab Components ──────────────────────────────────────────────────

function RiskBadge({ riskClass }) {
  if (riskClass === "high") return (
    <span style={{ ...MONO, fontSize: 10, fontWeight: 700, background: "#450a0a", color: "#f87171", padding: "2px 8px", borderRadius: 4, letterSpacing: "0.06em" }}>HIGH RISK</span>
  );
  return (
    <span style={{ ...MONO, fontSize: 10, fontWeight: 700, background: "#451a03", color: "#f59e0b", padding: "2px 8px", borderRadius: 4, letterSpacing: "0.06em" }}>LIMITED RISK</span>
  );
}

function StatusDot({ ok }) {
  return (
    <span style={{ color: ok ? "#4ade80" : "#f59e0b", fontSize: 14, marginRight: 4 }}>{ok ? "✓" : "○"}</span>
  );
}

function TrendArrow({ trend }) {
  if (trend === "up")   return <span style={{ color: "#f87171", fontWeight: 700 }}>↑</span>;
  if (trend === "down") return <span style={{ color: "#4ade80", fontWeight: 700 }}>↓</span>;
  return <span style={{ color: "#6b7280" }}>→</span>;
}

function SeverityBadge({ severity }) {
  if (severity === "HIGH") return (
    <span style={{ ...MONO, fontSize: 10, fontWeight: 700, background: "#450a0a", color: "#f87171", padding: "2px 8px", borderRadius: 4, letterSpacing: "0.06em" }}>HIGH</span>
  );
  return (
    <span style={{ ...MONO, fontSize: 10, fontWeight: 700, background: "#451a03", color: "#f59e0b", padding: "2px 8px", borderRadius: 4, letterSpacing: "0.06em" }}>MEDIUM</span>
  );
}

function Card({ children, style = {} }) {
  return (
    <div style={{ background: "#111318", border: "1px solid #1e2130", borderRadius: 10, padding: "16px 18px", marginBottom: 20, ...style }}>
      {children}
    </div>
  );
}

function DeployStatusBadge({ status }) {
  if (status === "production") return (
    <span style={{ ...MONO, fontSize: 10, fontWeight: 700, background: "#14532d", color: "#4ade80", padding: "2px 7px", borderRadius: 4 }}>Production</span>
  );
  if (status === "supervised") return (
    <span style={{ ...MONO, fontSize: 10, fontWeight: 700, background: "#451a03", color: "#f59e0b", padding: "2px 7px", borderRadius: 4 }}>Supervised</span>
  );
  return (
    <span style={{ ...MONO, fontSize: 10, fontWeight: 700, background: "#1e2130", color: "#4b5563", padding: "2px 7px", borderRadius: 4 }}>Not deployed</span>
  );
}

function AISystemRegister({ data, loading }) {
  if (loading && !data) return <div style={{ color: "#4b5563", fontSize: 13 }}>Loading register…</div>;
  const register = data?.register ?? [];
  return (
    <Card>
      <SectionLabel color="#60a5fa">AI System Register — Art. 16(h) + Art. 49</SectionLabel>
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
        Registration readiness data sourced from live governance files. Manual submission to the EU AI Act database required (Art. 49).
      </div>
      <div style={{ fontSize: 11, color: "#4b5563", marginBottom: 12 }}>
        Provider: Rawson Consulting BV — VDA-MD Platform &nbsp;·&nbsp; Deployer: citizenM Hotels (BER, LND, MUC, PAR, VIE)
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", ...DM, fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #1e2130" }}>
              {["Agent", "Risk Class", "Domain", "Intended Use", "Tech Doc", "Conformity", "Provider", "Deployer", "Deployment Status", "Art. 49"].map(h => (
                <th key={h} style={{ textAlign: "left", padding: "8px 10px", fontSize: 10, color: "#6b7280", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {register.map(row => (
              <tr key={row.agentId} style={{ borderBottom: "1px solid #0d0f14" }}>
                <td style={{ padding: "10px 10px", color: "#e5e7eb", fontWeight: 500, whiteSpace: "nowrap" }}>
                  {row.agentName}
                </td>
                <td style={{ padding: "10px 10px" }}>
                  <RiskBadge riskClass={row.riskClass} />
                </td>
                <td style={{ padding: "10px 10px", color: "#9ca3af", whiteSpace: "nowrap" }}>{row.domain}</td>
                <td style={{ padding: "10px 10px", color: "#6b7280", maxWidth: 200 }}>
                  <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.intendedUse}>
                    {row.intendedUse}
                  </span>
                </td>
                <td style={{ padding: "10px 10px", textAlign: "center" }}>
                  <StatusDot ok={row.techDocComplete} />
                  <span style={{ color: row.techDocComplete ? "#4ade80" : "#f59e0b", fontSize: 11 }}>
                    {row.techDocComplete ? "Complete" : "Partial"}
                  </span>
                </td>
                <td style={{ padding: "10px 10px", textAlign: "center" }}>
                  <StatusDot ok={row.conformityStatus === "conformant"} />
                  <span style={{ color: row.conformityStatus === "conformant" ? "#4ade80" : "#f59e0b", fontSize: 11 }}>
                    {row.conformityStatus === "conformant" ? "Conformant" : "Incomplete"}
                  </span>
                </td>
                <td style={{ padding: "10px 10px", color: "#6b7280", fontSize: 11, whiteSpace: "nowrap" }}>Rawson Consulting BV</td>
                <td style={{ padding: "10px 10px", color: "#6b7280", fontSize: 11, whiteSpace: "nowrap" }}>citizenM Hotels</td>
                <td style={{ padding: "10px 10px" }}>
                  <DeployStatusBadge status={row.deploymentStatus} />
                  {row.activeDeployments > 0 && (
                    <span style={{ fontSize: 10, color: "#6b7280", marginLeft: 6 }}>
                      {row.activeDeployments} hotel{row.activeDeployments !== 1 ? "s" : ""}
                    </span>
                  )}
                </td>
                <td style={{ padding: "10px 10px" }}>
                  <span style={{ ...MONO, fontSize: 10, color: "#f59e0b", background: "#451a03", padding: "2px 7px", borderRadius: 4 }} title="Manual submission to EU AI Act database required">Pending — manual submission required</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 12, fontSize: 11, color: "#4b5563", borderTop: "1px solid #1e2130", paddingTop: 10 }}>
        Art. 49 registration requires manual submission to the EU AI Act database once the platform is in commercial deployment.
        Limited Risk AI systems have reduced transparency obligations under Art. 50.
      </div>
    </Card>
  );
}

// Returns { status: "green"|"amber"|"red", evidence }
// green = fully compliant · amber = needs attention, not yet critical · red = critical noncompliance
const ARTICLES = [
  {
    id: "Art. 11", title: "Technical Documentation",
    getStatus: (reg) => {
      const list = reg?.register ?? [];
      const incomplete = list.filter(r => !r.techDocComplete);
      if (incomplete.length === 0 && list.length > 0)
        return { status: "green", evidence: `All ${list.length} agents have complete AGENTS.md, EXCEPTION_AUTHORITY.md, and SOP.md on file` };
      if (incomplete.length > 0)
        return { status: "amber", evidence: `${incomplete.length} agent(s) have incomplete governance file sets — complete before commercial deployment` };
      return { status: "amber", evidence: "Governance file data not yet loaded" };
    },
  },
  {
    id: "Art. 12", title: "Record-keeping / Logging",
    getStatus: (_reg, mon) => {
      const count = mon?.totalWitnessEntries ?? 0;
      if (count === 0)
        return { status: "red", evidence: "No Witness Agent audit entries found — logging system is not operational or has not recorded any decisions" };
      return { status: "green", evidence: `Witness Agent has recorded ${count.toLocaleString()} tamper-evident audit entries with governance file hash and W3C VC status` };
    },
  },
  {
    id: "Art. 13", title: "Transparency to Deployers",
    getStatus: () => ({
      status: "green",
      evidence: "All agent decisions surface the verbatim governing clause, EXCEPTION_AUTHORITY.md ceiling, and HITL escalation path to hotel staff",
    }),
  },
  {
    id: "Art. 14", title: "Human Oversight",
    getStatus: () => ({
      status: "green",
      evidence: "HITL queue enforces mandatory human approval for all decisions above agent authority ceiling; CO Gate 1 + Gate 2 sign-off required for material decisions",
    }),
  },
  {
    id: "Art. 16", title: "Provider Obligations",
    getStatus: (reg) => {
      const list = reg?.register ?? [];
      const nonConformant = list.filter(r => r.conformityStatus !== "conformant");
      if (nonConformant.length === 0 && list.length > 0)
        return { status: "green", evidence: "All AI systems have technical documentation, governance file sets, and Declaration of Conformity generated" };
      if (nonConformant.length > 0)
        return { status: "amber", evidence: `${nonConformant.length} agent(s) missing governance files — complete technical documentation before commercial deployment` };
      return { status: "amber", evidence: "Register data not yet loaded" };
    },
  },
  {
    id: "Art. 47", title: "Declaration of Conformity",
    getStatus: (_reg, _mon, _inc, decl) => {
      if (!decl?.declarationText)
        return { status: "amber", evidence: "Declaration not yet generated" };
      return { status: "amber", evidence: "Declaration auto-generated from live governance state — manual Compliance Officer sign-off required before Art. 49 submission" };
    },
  },
  {
    id: "Art. 72", title: "Post-Market Monitoring",
    getStatus: (_reg, mon) => {
      const metrics = mon?.agentMetrics ?? [];
      const anomalies = metrics.filter(m => m.anomaly).length;
      if (metrics.length === 0)
        return { status: "amber", evidence: "Monitoring data not yet loaded" };
      if (anomalies === 0)
        return { status: "green", evidence: "30-day monitoring active: all agent FAIL+ESCALATE rates within the 10% anomaly threshold" };
      if (anomalies <= 2)
        return { status: "amber", evidence: `${anomalies} agent(s) exceed the 10% FAIL+ESCALATE anomaly threshold — review post-market monitoring panel` };
      return { status: "red", evidence: `${anomalies} agents exceed the 10% anomaly threshold — immediate review required per Art. 72` };
    },
  },
  {
    id: "Art. 73", title: "Serious Incident Reporting",
    getStatus: (_reg, _mon, inc) => {
      const highCount   = inc?.highCount   ?? 0;
      const mediumCount = inc?.mediumCount ?? 0;
      if (highCount > 0)
        return { status: "red", evidence: `${highCount} HIGH severity incident(s) require authority notification within 15 working days (Art. 73)` };
      if (mediumCount > 0)
        return { status: "amber", evidence: `${mediumCount} MEDIUM severity incident(s) in last 90 days — review escalation handling and authority notification obligations` };
      return { status: "green", evidence: "No serious incidents in the last 90 days" };
    },
  },
];

const ARTICLE_STYLE = {
  green: { border: "#14532d", borderLeft: "#4ade80", icon: "✅" },
  amber: { border: "#451a03", borderLeft: "#f59e0b", icon: "⚠️" },
  red:   { border: "#450a0a", borderLeft: "#f87171", icon: "🔴" },
};

function ArticleChecklist({ regData, monData, incData, declData, regLoading, monLoading, incLoading }) {
  const loading = regLoading || monLoading || incLoading;
  return (
    <Card>
      <SectionLabel color="#60a5fa">Conformity Status — Article-by-Article</SectionLabel>
      {loading && !regData && !monData && !incData ? (
        <div style={{ color: "#4b5563", fontSize: 13 }}>Computing compliance status…</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 10 }}>
          {ARTICLES.map(art => {
            const { status, evidence } = art.getStatus(regData, monData, incData, declData);
            const s = ARTICLE_STYLE[status];
            return (
              <div key={art.id} style={{
                background: "#0d0f14", border: `1px solid ${s.border}`,
                borderLeft: `3px solid ${s.borderLeft}`,
                borderRadius: 8, padding: "12px 14px",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ ...MONO, fontSize: 10, fontWeight: 700, color: "#60a5fa" }}>{art.id}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#e5e7eb" }}>{art.title}</span>
                  <span style={{ marginLeft: "auto", fontSize: 14 }}>{s.icon}</span>
                </div>
                <div style={{ fontSize: 11, color: "#9ca3af", lineHeight: 1.5 }}>{evidence}</div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function IncidentRegister({ data, loading }) {
  const incidents = data?.incidents ?? [];
  return (
    <Card>
      <SectionLabel color="#60a5fa">Serious Incident Register — Art. 73</SectionLabel>
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 12 }}>
        Art. 73 requires serious incidents to be reported to the national competent authority within 15 working days of becoming aware.
        Last 90 days · {data ? `${data.highCount ?? 0} HIGH · ${data.mediumCount ?? 0} MEDIUM` : "Loading…"}
      </div>
      {loading && !data ? (
        <div style={{ color: "#4b5563", fontSize: 13 }}>Loading incident register…</div>
      ) : incidents.length === 0 ? (
        <div style={{ background: "#0d0f14", border: "1px solid #14532d", borderRadius: 8, padding: "16px", fontSize: 13, color: "#4ade80", textAlign: "center" }}>
          ✓ No serious incidents in the last 90 days
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", ...DM, fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #1e2130" }}>
                {["Date", "Hotel", "Agent", "Severity", "Governing Clause", "Report Status"].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "8px 10px", fontSize: 10, color: "#6b7280", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {incidents.map(inc => (
                <tr key={inc.id} style={{ borderBottom: "1px solid #0d0f14" }}>
                  <td style={{ padding: "9px 10px", color: "#9ca3af", whiteSpace: "nowrap" }}>{formatDate(inc.date)}</td>
                  <td style={{ padding: "9px 10px" }}>
                    <span style={{ ...MONO, fontSize: 10, color: "#60a5fa" }}>{inc.hotel}</span>
                  </td>
                  <td style={{ padding: "9px 10px", color: "#e5e7eb", whiteSpace: "nowrap" }}>{inc.agent}</td>
                  <td style={{ padding: "9px 10px" }}><SeverityBadge severity={inc.severity} /></td>
                  <td style={{ padding: "9px 10px", color: "#9ca3af", maxWidth: 280 }}>
                    <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={inc.governingClause}>
                      {inc.governingClause}
                    </span>
                  </td>
                  <td style={{ padding: "9px 10px" }}>
                    <span style={{ ...MONO, fontSize: 10, color: "#f59e0b" }}>Pending — authority not yet notified</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function PostMarketMonitoring({ data, loading }) {
  const metrics = data?.agentMetrics ?? [];
  return (
    <Card>
      <SectionLabel color="#60a5fa">Post-Market Monitoring — Art. 72</SectionLabel>
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 12 }}>
        30-day rolling performance. Anomaly threshold: FAIL+ESCALATE rate &gt; 10%. Agreement rate = PASS / total decisions (averaged across active hotels). ↑ = worsening · ↓ = improving · → = stable.
      </div>
      {loading && !data ? (
        <div style={{ color: "#4b5563", fontSize: 13 }}>Loading monitoring data…</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", ...DM, fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #1e2130" }}>
                {["Agent", "PASS", "FAIL", "ESCALATE", "Guard Violations", "Fail+Esc %", "Agreement Rate", "Trend", "Status"].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "8px 10px", fontSize: 10, color: "#6b7280", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {metrics.map(m => (
                <tr key={m.agentId} style={{
                  borderBottom: "1px solid #0d0f14",
                  background: m.anomaly ? "rgba(248,113,113,0.04)" : "transparent",
                }}>
                  <td style={{ padding: "9px 10px", color: "#e5e7eb", whiteSpace: "nowrap" }}>{m.agentDisplayName}</td>
                  <td style={{ padding: "9px 10px", color: "#4ade80" }}>{m.current30d.pass}</td>
                  <td style={{ padding: "9px 10px", color: m.current30d.fail > 0 ? "#f87171" : "#6b7280" }}>{m.current30d.fail}</td>
                  <td style={{ padding: "9px 10px", color: m.current30d.escalate > 0 ? "#f59e0b" : "#6b7280" }}>{m.current30d.escalate}</td>
                  <td style={{ padding: "9px 10px", color: m.current30d.guardViolations > 0 ? "#f87171" : "#4b5563" }}>
                    {m.current30d.guardViolations}
                  </td>
                  <td style={{ padding: "9px 10px", color: m.anomaly ? "#f87171" : "#9ca3af", fontWeight: m.anomaly ? 700 : 400 }}>
                    {m.failEscalateRatePct}%
                  </td>
                  <td style={{ padding: "9px 10px", color: m.avgAgreementRatePct !== null ? (m.avgAgreementRatePct >= 80 ? "#4ade80" : m.avgAgreementRatePct >= 60 ? "#f59e0b" : "#f87171") : "#4b5563" }}>
                    {m.avgAgreementRatePct !== null ? `${m.avgAgreementRatePct}%` : "—"}
                  </td>
                  <td style={{ padding: "9px 10px" }}><TrendArrow trend={m.trend} /></td>
                  <td style={{ padding: "9px 10px" }}>
                    {m.anomaly
                      ? <span style={{ ...MONO, fontSize: 10, color: "#f87171", background: "#450a0a", padding: "2px 7px", borderRadius: 4 }}>ANOMALY</span>
                      : <span style={{ ...MONO, fontSize: 10, color: "#4ade80", background: "#14532d", padding: "2px 7px", borderRadius: 4 }}>NORMAL</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 10, fontSize: 11, color: "#4b5563" }}>
            Total audit entries: {(data?.totalWitnessEntries ?? 0).toLocaleString()} · Period: last 30 days vs prior 30 days
          </div>
        </div>
      )}
    </Card>
  );
}

function DeclarationOfConformity({ data, loading }) {
  const handleExport = () => {
    if (!data?.declarationText) return;
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>EU AI Act Declaration of Conformity — VDA-MD</title><style>
      body { font-family: 'Courier New', monospace; font-size: 13px; line-height: 1.7; padding: 40px; max-width: 860px; margin: 0 auto; color: #111; }
      pre { white-space: pre-wrap; word-wrap: break-word; }
      @media print { body { padding: 20px; } }
    </style></head><body><pre>${data.declarationText}</pre></body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 400);
  };

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
        <SectionLabel color="#60a5fa">Declaration of Conformity — Art. 47/48</SectionLabel>
        <button
          onClick={handleExport}
          disabled={loading || !data}
          style={{
            ...MONO, fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
            background: "#1e3a5f", border: "1px solid #60a5fa", color: "#60a5fa",
            padding: "6px 16px", borderRadius: 6, cursor: loading || !data ? "not-allowed" : "pointer",
            opacity: loading || !data ? 0.5 : 1,
          }}
        >
          EXPORT FOR AUDIT ↗
        </button>
      </div>
      {data && (
        <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
          <div style={{ background: "#0d0f14", border: "1px solid #1e2130", borderRadius: 6, padding: "8px 12px" }}>
            <div style={{ fontSize: 11, color: "#6b7280" }}>Declaration date</div>
            <div style={{ fontSize: 13, color: "#e5e7eb", fontWeight: 600 }}>{data.declarationDate}</div>
          </div>
          <div style={{ background: "#0d0f14", border: "1px solid #1e2130", borderRadius: 6, padding: "8px 12px" }}>
            <div style={{ fontSize: 11, color: "#6b7280" }}>Governance files</div>
            <div style={{ fontSize: 13, color: "#4ade80", fontWeight: 600 }}>{data.fileCount}</div>
          </div>
          <div style={{ background: "#0d0f14", border: "1px solid #1e2130", borderRadius: 6, padding: "8px 12px" }}>
            <div style={{ fontSize: 11, color: "#6b7280" }}>Audit entries</div>
            <div style={{ fontSize: 13, color: "#4ade80", fontWeight: 600 }}>{(data.witnessCount ?? 0).toLocaleString()}</div>
          </div>
          <div style={{ background: "#0d0f14", border: "1px solid #1e2130", borderRadius: 6, padding: "8px 12px" }}>
            <div style={{ fontSize: 11, color: "#6b7280" }}>NIST controls</div>
            <div style={{ fontSize: 13, color: "#e5e7eb", fontWeight: 600 }}>{(data.nistControls ?? []).join(", ")}</div>
          </div>
        </div>
      )}
      {loading && !data ? (
        <div style={{ color: "#4b5563", fontSize: 13 }}>Generating declaration…</div>
      ) : (
        <div style={{
          ...MONO, fontSize: 11, lineHeight: 1.8, color: "#9ca3af",
          background: "#0d0f14", border: "1px solid #1e2130", borderRadius: 8,
          padding: "16px 18px", maxHeight: 360, overflowY: "auto",
          whiteSpace: "pre-wrap", wordBreak: "break-word",
        }}>
          {data?.declarationText ?? ""}
        </div>
      )}
      <div style={{ marginTop: 10, fontSize: 11, color: "#4b5563" }}>
        This declaration is auto-generated from live governance state. Manual Compliance Officer sign-off required before submission to the EU AI Act registration portal.
      </div>
    </Card>
  );
}

// ─── Main View ────────────────────────────────────────────────────────────────

export default function ComplianceOfficerView() {
  const [activeTab, setActiveTab] = useState("gate");

  const { data: pendingData, loading: pendingLoading, refresh: refreshPending } = usePoll(async () => {
    const r = await fetch("/api/hitl/pending?role_band=compliance_officer");
    return r.json();
  }, 20000);

  const { data: allData, loading: allLoading, refresh: refreshAll } = usePoll(async () => {
    const r = await fetch("/api/hitl/all");
    return r.json();
  }, 30000);

  const { data: regData, loading: regLoading } = usePoll(async () => {
    const r = await fetch("/api/eu-ai-act/register");
    return r.json();
  }, 60000);

  const { data: monData, loading: monLoading } = usePoll(async () => {
    const r = await fetch("/api/eu-ai-act/monitoring");
    return r.json();
  }, 60000);

  const { data: incData, loading: incLoading } = usePoll(async () => {
    const r = await fetch("/api/eu-ai-act/incidents");
    return r.json();
  }, 60000);

  const { data: declData, loading: declLoading } = usePoll(async () => {
    const r = await fetch("/api/eu-ai-act/declaration");
    return r.json();
  }, 120000);

  const forceRefresh = useCallback(() => {
    refreshPending();
    refreshAll();
  }, [refreshPending, refreshAll]);

  const pending = pendingData?.pending ?? [];
  const allDecided = (allData?.tokens ?? [])
    .filter(t => t.outcome && (t.roleBand === "compliance_officer" || t.roleBand == null))
    .sort((a, b) => new Date(b.decidedAt ?? 0) - new Date(a.decidedAt ?? 0));
  const recentDecided = allDecided.slice(0, 10);
  const pendingCount  = pending.length;
  const approvedCount = allDecided.filter(t => t.outcome === "approved").length;
  const rejectedCount = allDecided.filter(t => t.outcome === "rejected").length;

  const euTabActive = activeTab === "eu";

  return (
    <div style={{ padding: "28px 32px", maxWidth: 980, ...DM }}>
      <style>{`@keyframes co-spin { to { transform: rotate(360deg); } }`}</style>

      {/* Header */}
      <div style={{ ...MONO, fontSize: 11, fontWeight: 700, color: "#f87171", letterSpacing: "0.1em", marginBottom: 6 }}>
        COMPLIANCE OFFICER — GOVERNANCE OVERSIGHT
      </div>
      <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 20 }}>
        Cross-portfolio oversight · Gate 1 + Gate 2 approvals · EU AI Act compliance reporting · All 5 hotels
      </div>

      {/* Tab switcher */}
      <div style={{ display: "flex", gap: 4, marginBottom: 28, background: "#0d0f14", border: "1px solid #1e2130", borderRadius: 8, padding: 4, width: "fit-content" }}>
        {[
          { id: "gate", label: pendingCount > 0 ? `Gate Approvals (${pendingCount})` : "Gate Approvals" },
          { id: "eu",   label: "EU AI Act Compliance" },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              ...MONO, fontSize: 11, fontWeight: 700, letterSpacing: "0.08em",
              padding: "8px 18px", borderRadius: 6, border: "none", cursor: "pointer",
              transition: "all 0.15s",
              background: activeTab === tab.id ? "#1e2130" : "transparent",
              color: activeTab === tab.id ? (tab.id === "eu" ? "#60a5fa" : "#f87171") : "#6b7280",
            }}
          >
            {tab.label.toUpperCase()}
          </button>
        ))}
      </div>

      {/* ── Gate Approvals Tab ── */}
      {!euTabActive && (
        <>
          <div style={{ display: "flex", gap: 12, marginBottom: 28, flexWrap: "wrap" }}>
            <StatBadge value={pendingCount}  label="Pending approvals"  color={pendingCount > 0 ? "#f59e0b" : "#4ade80"} />
            <StatBadge value={approvedCount} label="Recently approved"  color="#4ade80" />
            <StatBadge value={rejectedCount} label="Recently rejected"  color="#f87171" />
            <StatBadge value={HOTELS.length} label="Hotels monitored"   color="#60a5fa" />
          </div>

          <div style={{ background: "#111318", border: "1px solid #1e2130", borderRadius: 10, padding: "16px 18px", marginBottom: 28 }}>
            <SectionLabel>Hotel gate status</SectionLabel>
            {pendingLoading && !pendingData
              ? <div style={{ color: "#4b5563", fontSize: 13, padding: "12px 0" }}>Loading gate status…</div>
              : <GateStatusTable pendingTokens={pending} recentTokens={allDecided} />}
          </div>

          <div style={{ marginBottom: 28 }}>
            <SectionLabel>Pending approvals{pendingCount > 0 ? ` (${pendingCount})` : ""}</SectionLabel>
            {pendingLoading && !pendingData
              ? <div style={{ color: "#4b5563", fontSize: 13 }}>Loading…</div>
              : pending.length === 0
                ? <div style={{ background: "#111318", border: "1px solid #1e2130", borderRadius: 10, padding: "20px 18px", fontSize: 13, color: "#4b5563", textAlign: "center" }}>
                    No pending approvals — all gates clear
                  </div>
                : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 14 }}>
                    {pending.map(item => <PendingCard key={item.token} item={item} onDecision={forceRefresh} />)}
                  </div>}
          </div>

          <div>
            <SectionLabel>Recent decisions</SectionLabel>
            {allLoading && !allData
              ? <div style={{ color: "#4b5563", fontSize: 13 }}>Loading…</div>
              : recentDecided.length === 0
                ? <div style={{ background: "#111318", border: "1px solid #1e2130", borderRadius: 10, padding: "16px 18px", fontSize: 13, color: "#4b5563", textAlign: "center" }}>No resolved tokens yet</div>
                : <div>{recentDecided.map(item => <RecentRow key={item.token} item={item} />)}</div>}
          </div>
        </>
      )}

      {/* ── EU AI Act Compliance Tab ── */}
      {euTabActive && (
        <>
          <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
            <StatBadge value={regData?.register?.length ?? "—"}                                    label="AI systems registered"     color="#60a5fa" />
            <StatBadge value={regData?.register?.filter(r => r.techDocComplete).length ?? "—"}    label="Tech docs complete"        color="#4ade80" />
            <StatBadge value={incData?.total ?? "—"}                                              label="Incidents (90d)"           color={incData?.total > 0 ? "#f59e0b" : "#4ade80"} />
            <StatBadge value={monData?.agentMetrics?.filter(m => m.anomaly).length ?? "—"}        label="Monitoring anomalies"      color={monData?.agentMetrics?.some(m => m.anomaly) ? "#f87171" : "#4ade80"} />
          </div>

          <AISystemRegister   data={regData} loading={regLoading} />
          <ArticleChecklist   regData={regData} monData={monData} incData={incData} declData={declData} regLoading={regLoading} monLoading={monLoading} incLoading={incLoading} />
          <PostMarketMonitoring data={monData} loading={monLoading} />
          <IncidentRegister   data={incData} loading={incLoading} />
          <DeclarationOfConformity data={declData} loading={declLoading} />
        </>
      )}
    </div>
  );
}
