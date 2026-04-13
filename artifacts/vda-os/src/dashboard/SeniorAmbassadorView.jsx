import { useState } from "react";
import { usePoll, useSecondsAgo } from "./useDashboard.js";
import DecisionCard from "./DecisionCard.jsx";
import ShadowReviewRow from "./ShadowReviewRow.jsx";

const DM = { fontFamily: "'DM Sans', sans-serif" };

const PHASE_COLORS = {
  run:   { color: "#4ade80", bg: "#14532d", label: "RUN" },
  walk:  { color: "#f59e0b", bg: "#451a03", label: "WALK" },
  crawl: { color: "#60a5fa", bg: "#0f2744", label: "CRAWL" },
};

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

function PhasePill({ phase }) {
  const pc = PHASE_COLORS[phase];
  if (!pc) return null;
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: "0.07em",
      background: pc.bg, color: pc.color,
      padding: "3px 8px", borderRadius: 4,
      border: `1px solid ${pc.color}40`,
    }}>
      {pc.label}
    </span>
  );
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

function AgentStatusCard({ phase: phaseRow }) {
  const { agentId, phase, agreementRate } = phaseRow;
  const pc = PHASE_COLORS[phase];
  const agentLabel = agentId.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const rate = agreementRate !== null ? Number(agreementRate) : null;

  return (
    <div style={{
      ...DM, background: "#111318", border: "1px solid #1e2130",
      borderRadius: 10, padding: "14px 16px",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#ffffff" }}>{agentLabel}</span>
        <PhasePill phase={phase} />
      </div>
      {rate !== null && pc && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
            <span style={{ fontSize: 11, color: "#ffffff" }}>Agreement rate</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: pc.color }}>{rate}%</span>
          </div>
          <div style={{ height: 4, background: "#1e2130", borderRadius: 2, overflow: "hidden" }}>
            <div style={{
              height: "100%", width: `${Math.min(100, rate)}%`,
              background: pc.color, borderRadius: 2,
              transition: "width 0.6s ease",
            }} />
          </div>
        </>
      )}
    </div>
  );
}

export default function SeniorAmbassadorView({ companyId }) {
  const [resolvedTokens, setResolvedTokens] = useState(new Set());
  const [reviewedShadows, setReviewedShadows] = useState(new Set());
  const [activeCard, setActiveCard] = useState(null);

  const {
    data: hitlData,
    loading: hitlLoading,
    lastUpdated: hitlUpdated,
  } = usePoll(async () => {
    const r = await fetch("/api/hitl/pending");
    return r.json();
  }, 10000);

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
    data: phasesData,
    loading: phasesLoading,
  } = usePoll(async () => {
    if (!companyId) return null;
    const r = await fetch(`/api/dashboard/phases?companyId=${companyId}`);
    return r.json();
  }, 30000);

  const hitlAgo = useSecondsAgo(hitlUpdated);
  const shiftAgo = useSecondsAgo(shiftUpdated);

  const pending = (hitlData?.pending ?? []).filter((p) => {
    if (resolvedTokens.has(p.token)) return false;
    if (!companyId) return true;
    const tokenCompany = p.companyId ?? p.payload?.companyId;
    return !tokenCompany || Number(tokenCompany) === Number(companyId);
  });
  const activatedAgents = (phasesData?.phases ?? []).filter((p) => p.phase !== "not_activated");
  const allShadows = shiftData?.shadow_reviews ?? [];
  const shadows = allShadows.filter((s) => !reviewedShadows.has(String(s.witnessId)));

  const handleDecision = (token) => {
    setResolvedTokens((prev) => new Set([...prev, token]));
  };

  const handleShadowReviewed = (witnessId) => {
    setReviewedShadows((prev) => new Set([...prev, String(witnessId)]));
  };

  const toggleCard = (cardId) => setActiveCard((prev) => prev === cardId ? null : cardId);

  return (
    <div style={{ ...DM, padding: "24px 28px", maxWidth: 1100 }}>
      {/* Section A — Needs attention */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: "#fff", margin: 0 }}>Needs your attention</h3>
            {pending.length > 0 && (
              <span style={{
                fontSize: 11, fontWeight: 700, background: "#f59e0b", color: "#000",
                borderRadius: "50%", minWidth: 20, height: 20,
                display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 5px",
              }}>
                {pending.length}
              </span>
            )}
          </div>
          {hitlUpdated && <span style={{ fontSize: 11, color: "#ffffff" }}>Updated {hitlAgo}</span>}
        </div>

        {hitlLoading && !hitlData ? (
          <div style={{ color: "#ffffff", fontSize: 13 }}>Loading…</div>
        ) : pending.length === 0 ? (
          <EmptyCard
            icon="✓"
            title="All clear — no pending decisions"
            subtitle="No HITL tokens awaiting review"
          />
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {pending.map((p) => {
              const payload = p.payload ?? {};
              return (
                <DecisionCard
                  key={p.token}
                  token={p.token}
                  agentId={p.agent_name ?? "Unknown Agent"}
                  companyId={companyId}
                  whatTriggered={payload.what_triggered ?? `Onboarding decision requires approval (phase ${p.phase})`}
                  clauseApplied={payload.clause_applied ?? payload.clauseApplied}
                  riskLevel={payload.risk_level ?? "medium"}
                  recommendedAction={payload.recommended_action ?? "approve"}
                  rationale={payload.rationale}
                  dataContext={payload}
                  cardType="ESCALATE"
                  onDecision={handleDecision}
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
            label="Escalated"
            value={shiftData?.escalated_count}
            color="#f59e0b"
            active={activeCard === "escalated"}
            onClick={() => toggleCard("escalated")}
          />
          <StatCard
            label="Shadow reviews"
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

      {/* Section C — Shadow review queue */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
          <h3 style={{ ...DM, fontSize: 15, fontWeight: 700, color: "#fff", margin: 0 }}>Shadow reviews</h3>
          {shadows.length > 0 && (
            <span style={{
              fontSize: 11, fontWeight: 700, background: "#60a5fa", color: "#000",
              borderRadius: "50%", minWidth: 20, height: 20,
              display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 5px",
            }}>
              {shadows.length}
            </span>
          )}
          <span style={{ fontSize: 11, color: "#ffffff", marginLeft: 4 }}>crawl-phase decisions awaiting your yes/no</span>
        </div>

        {shiftLoading && !shiftData ? (
          <div style={{ color: "#ffffff", fontSize: 13 }}>Loading…</div>
        ) : shadows.length === 0 ? (
          <EmptyCard
            icon="✓"
            title="No unreviewed shadow decisions"
            subtitle="All crawl-phase decisions from this shift have been reviewed"
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {shadows.map((s) => (
              <ShadowReviewRow
                key={s.witnessId}
                witnessId={s.witnessId}
                agentId={s.agentId ?? s.agent}
                decision={s.decision}
                clauseApplied={s.clauseApplied}
                actionProposed={s.actionProposed}
                apaleoDataContext={s.apaleoData}
                onReviewed={handleShadowReviewed}
              />
            ))}
          </div>
        )}
      </div>

      {/* Section D — Agent status */}
      <div>
        <SectionHeader title="Agent status" />
        {phasesLoading && !phasesData ? (
          <div style={{ color: "#ffffff", fontSize: 13 }}>Loading…</div>
        ) : activatedAgents.length === 0 ? (
          <EmptyCard icon="⚙️" title="No agents activated yet" subtitle="Activate agents from the Hotel GM view" />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
            {activatedAgents.map((p) => (
              <AgentStatusCard key={p.agentId} phase={p} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
