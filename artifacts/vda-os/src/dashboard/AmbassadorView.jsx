import { useState } from "react";
import { usePoll, useSecondsAgo } from "./useDashboard.js";
import DecisionCard from "./DecisionCard.jsx";
import ShadowReviewRow from "./ShadowReviewRow.jsx";

const DM = { fontFamily: "'DM Sans', sans-serif" };

const DECISION_COLORS = {
  PASS:    "#4ade80",
  ESCALATE:"#f59e0b",
  FAIL:    "#f87171",
  INFO:    "#60a5fa",
};

function relativeTime(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (diff < 60)  return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function StatCard({ label, value, color, onClick, active }) {
  return (
    <div
      onClick={onClick}
      style={{
        ...DM, flex: 1, background: active ? "#1a1d26" : "#111318",
        border: active ? `1.5px solid ${color}` : "1px solid #1e2130",
        borderRadius: 10, padding: "16px 18px", textAlign: "center",
        cursor: "pointer", userSelect: "none",
        transition: "border 0.15s, background 0.15s",
        position: "relative",
      }}
    >
      <div style={{ fontSize: 30, fontWeight: 700, color, marginBottom: 4 }}>{value ?? 0}</div>
      <div style={{ fontSize: 12, color: "#ffffff", fontWeight: 500 }}>{label}</div>
      <div style={{ position: "absolute", top: 8, right: 10, fontSize: 10, color: color, opacity: 0.7 }}>
        {active ? "▲" : "▼"}
      </div>
    </div>
  );
}

function EventListPanel({ title, events, color, onClose, shadowMode = false, shadows = [] }) {
  const items = shadowMode ? shadows : events;
  return (
    <div style={{
      ...DM, background: "#0e1018", border: `1px solid ${color}40`,
      borderRadius: 10, padding: "16px 18px", marginTop: 10,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color }}>{title}</span>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", color: "#ffffff", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 4px" }}
        >
          ✕
        </button>
      </div>

      {items.length === 0 && (
        <div style={{ fontSize: 13, color: "#ffffff", textAlign: "center", padding: "12px 0" }}>
          No events in this shift
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 360, overflowY: "auto" }}>
        {items.map((e) => {
          const decision = e.decision ?? "INFO";
          const dc = DECISION_COLORS[decision] ?? "#60a5fa";
          const agent = e.agent ?? e.agentId ?? "Unknown Agent";
          const agentLabel = agent.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
          return (
            <div key={e.witnessId ?? e.id} style={{
              background: "#111318", border: `1px solid #1e2130`,
              borderRadius: 8, padding: "12px 14px",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700,
                    background: dc + "20", color: dc,
                    border: `1px solid ${dc}40`,
                    borderRadius: 4, padding: "2px 7px",
                    fontFamily: "monospace",
                  }}>{decision}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#ffffff" }}>{agentLabel}</span>
                </div>
                <span style={{ fontSize: 11, color: "#ffffff" }}>
                  {e.createdAt ? relativeTime(e.createdAt) : ""}
                </span>
              </div>
              {e.clauseApplied && (
                <div style={{ fontSize: 11, color: "#ffffff", marginBottom: 4, fontStyle: "italic" }}>
                  {e.clauseApplied}
                </div>
              )}
              {e.actionProposed && (
                <div style={{ fontSize: 12, color: "#d1d5db", lineHeight: 1.5 }}>
                  {e.actionProposed}
                </div>
              )}
              {e.escalationTarget && (
                <div style={{ fontSize: 11, color: "#f59e0b", marginTop: 4 }}>
                  ↗ Escalated to: {e.escalationTarget}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EmptyCard({ icon = "✓", title, subtitle }) {
  return (
    <div style={{
      ...DM, background: "#0d0f14", border: "1.5px dashed #1e2130",
      borderRadius: 10, padding: "28px 20px", textAlign: "center",
    }}>
      <div style={{ fontSize: 24, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#4ade80", marginBottom: 4 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 12, color: "#ffffff" }}>{subtitle}</div>}
    </div>
  );
}

function SectionHeader({ title, count }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
      <h3 style={{ ...DM, fontSize: 15, fontWeight: 700, color: "#fff", margin: 0 }}>{title}</h3>
      {count !== undefined && count > 0 && (
        <span style={{
          fontSize: 11, fontWeight: 700, background: "#f59e0b", color: "#000",
          borderRadius: "50%", minWidth: 20, height: 20, display: "inline-flex",
          alignItems: "center", justifyContent: "center", padding: "0 5px",
        }}>
          {count}
        </span>
      )}
    </div>
  );
}

export default function AmbassadorView({ companyId, onOpenTab }) {
  const [dismissedTokens, setDismissedTokens] = useState(new Set());
  const [dismissedShadows, setDismissedShadows] = useState(new Set());
  const [activeCard, setActiveCard] = useState(null);

  const {
    data: shiftData,
    loading: shiftLoading,
    lastUpdated: shiftUpdated,
  } = usePoll(async () => {
    if (!companyId) return null;
    const r = await fetch(`/api/dashboard/shift-summary?companyId=${companyId}`);
    return r.json();
  }, 30000);

  const {
    data: hitlData,
    loading: hitlLoading,
  } = usePoll(async () => {
    const r = await fetch("/api/hitl/pending");
    const d = await r.json();
    const filtered = (d.pending ?? []).filter((p) => {
      if (!companyId) return true;
      const tokenCompany = p.companyId ?? p.payload?.companyId;
      return !tokenCompany || Number(tokenCompany) === Number(companyId);
    });
    return { ...d, pending: filtered };
  }, 30000);

  const shiftAgo = useSecondsAgo(shiftUpdated);

  const resolvedHitl = (token) => {
    setDismissedTokens((prev) => new Set([...prev, token]));
  };

  const resolvedShadow = (witnessId) => {
    setDismissedShadows((prev) => new Set([...prev, String(witnessId)]));
  };

  const pending = (hitlData?.pending ?? []).filter((p) => !dismissedTokens.has(p.token));
  const shadows = (shiftData?.shadow_reviews ?? []).filter((r) => !dismissedShadows.has(String(r.witnessId)));

  const toggleCard = (cardId) => setActiveCard((prev) => prev === cardId ? null : cardId);

  return (
    <div style={{ ...DM, padding: "24px 28px", maxWidth: 900 }}>
      {/* Section A — Needs attention */}
      <div style={{ marginBottom: 28 }}>
        <SectionHeader title="Needs your attention" count={pending.length} />
        {hitlLoading && !hitlData ? (
          <div style={{ color: "#ffffff", fontSize: 13 }}>Loading…</div>
        ) : pending.length === 0 ? (
          <EmptyCard
            icon="✓"
            title="All clear — no pending decisions"
            subtitle="Agents are handling your shift autonomously"
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {pending.map((p) => {
              const payload = p.payload ?? {};
              return (
                <DecisionCard
                  key={p.token}
                  token={p.token}
                  agentId={p.agent_name ?? "Unknown Agent"}
                  companyId={companyId}
                  whatTriggered={payload.what_triggered ?? `Agent decision requires approval (phase ${p.phase})`}
                  clauseApplied={payload.clause_applied ?? payload.clauseApplied}
                  riskLevel={payload.risk_level ?? "medium"}
                  recommendedAction={payload.recommended_action ?? "approve"}
                  rationale={payload.rationale}
                  dataContext={payload}
                  cardType={p.cardType ?? "ESCALATE"}
                  onDecision={resolvedHitl}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Section B — This shift */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: "#fff", margin: 0 }}>This shift</h3>
          {shiftUpdated && <span style={{ fontSize: 11, color: "#ffffff" }}>Updated {shiftAgo}</span>}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <StatCard
            label="Autonomous decisions"
            value={shiftData?.autonomous_count}
            color="#4ade80"
            active={activeCard === "autonomous"}
            onClick={() => toggleCard("autonomous")}
          />
          <StatCard
            label="Escalated to you"
            value={shiftData?.escalated_count}
            color="#f59e0b"
            active={activeCard === "escalated"}
            onClick={() => toggleCard("escalated")}
          />
          <StatCard
            label="Shadow reviews waiting"
            value={shadows.length}
            color="#60a5fa"
            active={activeCard === "shadow"}
            onClick={() => toggleCard("shadow")}
          />
        </div>

        {activeCard === "autonomous" && (
          <EventListPanel
            title="Autonomous decisions this shift"
            color="#4ade80"
            events={shiftData?.autonomous_entries ?? []}
            onClose={() => setActiveCard(null)}
          />
        )}
        {activeCard === "escalated" && (
          <EventListPanel
            title="Escalated decisions this shift"
            color="#f59e0b"
            events={shiftData?.escalated_entries ?? []}
            onClose={() => setActiveCard(null)}
          />
        )}
        {activeCard === "shadow" && (
          <EventListPanel
            title="Shadow reviews waiting"
            color="#60a5fa"
            events={[]}
            shadowMode
            shadows={shadows}
            onClose={() => setActiveCard(null)}
          />
        )}
      </div>

      {/* Section C — Shadow reviews */}
      {shadows.length > 0 && (
        <div>
          <SectionHeader title="Would you have done the same?" />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {shadows.slice(0, 5).map((r) => (
              <ShadowReviewRow
                key={r.witnessId}
                witnessId={r.witnessId}
                agentId={r.agentId ?? r.agent}
                decision={r.decision}
                clauseApplied={r.clauseApplied}
                actionProposed={r.actionProposed}
                apaleoDataContext={{ ...(r.apaleoData ?? {}), companyId }}
                onReviewed={resolvedShadow}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
