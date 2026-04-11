import { useState } from "react";
import { usePoll, useSecondsAgo } from "./useDashboard.js";
import DecisionCard from "./DecisionCard.jsx";
import ShadowReviewRow from "./ShadowReviewRow.jsx";

const DM = { fontFamily: "'DM Sans', sans-serif" };

function StatCard({ label, value, color }) {
  return (
    <div style={{
      ...DM, flex: 1, background: "#111318", border: "1px solid #1e2130",
      borderRadius: 10, padding: "16px 18px", textAlign: "center",
    }}>
      <div style={{ fontSize: 30, fontWeight: 700, color, marginBottom: 4 }}>{value ?? 0}</div>
      <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 500 }}>{label}</div>
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
      {subtitle && <div style={{ fontSize: 12, color: "#6b7280" }}>{subtitle}</div>}
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
  // Track dismissed items locally — allows optimistic removal while staying live on each poll.
  // Fresh server data always replaces the base list; only locally-dismissed IDs are filtered out.
  const [dismissedTokens, setDismissedTokens] = useState(new Set());
  const [dismissedShadows, setDismissedShadows] = useState(new Set());

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
    // Filter to this hotel's tokens (companyId from enriched endpoint; fallback payload)
    const filtered = (d.pending ?? []).filter((p) => {
      if (!companyId) return true;
      const tokenCompany = p.companyId ?? p.payload?.companyId;
      return !tokenCompany || Number(tokenCompany) === Number(companyId);
    });
    return { ...d, pending: filtered };
  }, 30000);

  const shiftAgo = useSecondsAgo(shiftUpdated);

  // Optimistic removal — dismissed items hidden immediately but re-appear if server resets them
  const resolvedHitl = (token) => {
    setDismissedTokens((prev) => new Set([...prev, token]));
  };

  const resolvedShadow = (witnessId) => {
    setDismissedShadows((prev) => new Set([...prev, String(witnessId)]));
  };

  // Always derive from latest server data, filtered by local dismissals
  const pending = (hitlData?.pending ?? []).filter((p) => !dismissedTokens.has(p.token));
  const shadows = (shiftData?.shadow_reviews ?? []).filter((r) => !dismissedShadows.has(String(r.witnessId)));

  return (
    <div style={{ ...DM, padding: "24px 28px", maxWidth: 900 }}>
      {/* Section A — Needs attention */}
      <div style={{ marginBottom: 28 }}>
        <SectionHeader title="Needs your attention" count={pending.length} />
        {hitlLoading && !hitlData ? (
          <div style={{ color: "#6b7280", fontSize: 13 }}>Loading…</div>
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
                  cardType="ESCALATE"
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
          {shiftUpdated && <span style={{ fontSize: 11, color: "#6b7280" }}>Updated {shiftAgo}</span>}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <StatCard label="Autonomous decisions" value={shiftData?.autonomous_count} color="#4ade80" />
          <StatCard label="Escalated to you" value={shiftData?.escalated_count} color="#f59e0b" />
          <StatCard label="Shadow reviews waiting" value={shadows.length} color="#60a5fa" />
        </div>
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
