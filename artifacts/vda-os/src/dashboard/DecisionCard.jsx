import { useState } from "react";

const PHASE_COLORS = {
  ESCALATE: { border: "#f59e0b", tag: "#f59e0b", tagBg: "#451a03" },
  EXCEPTION: { border: "#60a5fa", tag: "#60a5fa", tagBg: "#0f2744" },
};

const RISK_COLORS = {
  low: { color: "#4ade80", bg: "#14532d" },
  medium: { color: "#f59e0b", bg: "#451a03" },
  high: { color: "#f87171", bg: "#450a0a" },
};

function Spinner() {
  return (
    <span style={{
      display: "inline-block", width: 16, height: 16, borderRadius: "50%",
      border: "2px solid rgba(255,255,255,0.2)",
      borderTopColor: "#fff",
      animation: "dash-spin 0.7s linear infinite",
      verticalAlign: "middle",
    }} />
  );
}

/**
 * DecisionCard — HITL decision card for Ambassador/Senior Ambassador views.
 *
 * Props:
 *   token            — HITL token string
 *   agentId          — agent identifier
 *   companyId        — company ID (unused in POST but passed for context)
 *   whatTriggered    — plain English trigger description
 *   clauseApplied    — verbatim governance clause
 *   riskLevel        — 'low' | 'medium' | 'high'
 *   recommendedAction — 'approve' | 'reject'
 *   rationale        — one-line rationale for recommendation
 *   dataContext      — raw Apaleo/payload data
 *   cardType         — 'ESCALATE' | 'EXCEPTION'
 *   onDecision       — callback(token, outcome) after resolution
 */
export default function DecisionCard({
  token,
  agentId,
  companyId,
  whatTriggered,
  clauseApplied,
  riskLevel = "medium",
  recommendedAction = "approve",
  rationale,
  dataContext,
  cardType = "ESCALATE",
  onDecision,
}) {
  const [loading, setLoading] = useState(false);
  const [resolved, setResolved] = useState(false);
  const [clauseExpanded, setClauseExpanded] = useState(false);
  const [toast, setToast] = useState(null);

  const colors = PHASE_COLORS[cardType] ?? PHASE_COLORS.ESCALATE;
  const riskStyle = RISK_COLORS[riskLevel] ?? RISK_COLORS.medium;

  const agentLabel = (agentId ?? "Unknown Agent")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  const handleDecision = async (outcome) => {
    if (loading || resolved) return;
    setLoading(true);
    try {
      const resp = await fetch(`/api/hitl/respond/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outcome,
          reason: outcome === "approved" ? "Approved via dashboard" : "Rejected via dashboard",
          decided_by: "Dashboard User",
        }),
      });
      if (!resp.ok) throw new Error("Request failed");
      setResolved(true);
      if (outcome === "approved") {
        setToast("Decision logged — agent proceeding");
        setTimeout(() => setToast(null), 3000);
      }
      setTimeout(() => onDecision?.(token, outcome), 400);
    } catch (err) {
      console.error("HITL respond error:", err);
    } finally {
      setLoading(false);
    }
  };

  const clauseText = clauseApplied ?? "No governance clause available.";
  const shortClause = clauseText.length > 200 ? clauseText.slice(0, 200) + "…" : clauseText;

  return (
    <div style={{
      fontFamily: "'DM Sans', sans-serif",
      background: "#111318",
      border: `1px solid #1e2130`,
      borderLeft: `4px solid ${colors.border}`,
      borderRadius: 10,
      maxWidth: 480,
      width: "100%",
      position: "relative",
      opacity: resolved ? 0 : 1,
      transform: resolved ? "translateY(-8px)" : "translateY(0)",
      transition: "opacity 0.35s ease, transform 0.35s ease",
      overflow: "hidden",
    }}>
      <style>{`
        @keyframes dash-spin { to { transform: rotate(360deg); } }
        @keyframes decision-slide-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      {/* Toast */}
      {toast && (
        <div style={{
          position: "absolute", top: 10, right: 10, left: 10,
          background: "#14532d", border: "1px solid #4ade80",
          borderRadius: 6, padding: "8px 12px",
          fontSize: 13, color: "#4ade80", fontWeight: 600,
          animation: "decision-slide-in 0.2s ease",
          zIndex: 10,
        }}>
          ✓ {toast}
        </div>
      )}

      <div style={{ padding: "16px 18px 20px" }}>
        {/* Tag + agent */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <span style={{
            fontSize: 11, fontWeight: 700, letterSpacing: "0.07em",
            background: colors.tagBg, color: colors.tag,
            padding: "3px 8px", borderRadius: 4,
          }}>
            {cardType}
          </span>
          <span style={{ fontSize: 12, color: "#ffffff", fontWeight: 500 }}>{agentLabel}</span>
        </div>

        {/* Title */}
        <div style={{ fontSize: 15, fontWeight: 600, color: "#fff", lineHeight: 1.4, marginBottom: 8 }}>
          {whatTriggered ?? "An agent decision requires your review."}
        </div>

        {/* Risk badge */}
        <div style={{ display: "inline-flex", alignItems: "center", gap: 5, marginBottom: 12 }}>
          <span style={{
            fontSize: 11, fontWeight: 700, textTransform: "uppercase",
            background: riskStyle.bg, color: riskStyle.color,
            padding: "2px 8px", borderRadius: 4, letterSpacing: "0.06em",
          }}>
            {riskLevel} risk
          </span>
        </div>

        {/* Clause box */}
        <div style={{
          background: "#0d0f14", border: "1px solid #1e2130",
          borderLeft: `3px solid ${colors.border}`,
          borderRadius: 6, padding: "10px 12px", marginBottom: 12,
        }}>
          <div style={{ fontSize: 10, color: "#ffffff", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
            Governance clause
          </div>
          <div style={{
            fontFamily: "'DM Mono', monospace", fontSize: 12, color: "#ffffff", lineHeight: 1.6,
            maxHeight: clauseExpanded ? "none" : 72,
            overflow: "hidden",
          }}>
            {clauseExpanded ? clauseText : shortClause}
          </div>
          {clauseText.length > 200 && (
            <button
              onClick={() => setClauseExpanded(p => !p)}
              style={{ background: "none", border: "none", cursor: "pointer", color: colors.border, fontSize: 11, marginTop: 4, padding: 0, fontFamily: "'DM Sans', sans-serif" }}
            >
              {clauseExpanded ? "Show less" : "Show more"}
            </button>
          )}
        </div>

        {/* Recommendation */}
        {rationale && (
          <div style={{ fontSize: 13, color: "#ffffff", marginBottom: 14, lineHeight: 1.5 }}>
            <span style={{ color: "#ffffff", fontWeight: 600 }}>Agent recommends: </span>
            <span style={{ color: recommendedAction === "approve" ? "#4ade80" : "#f87171", fontWeight: 600 }}>
              {recommendedAction.toUpperCase()}
            </span>
            {" — "}{rationale}
          </div>
        )}

        {/* CTA Buttons */}
        <div style={{ display: "flex", gap: 8, flexDirection: "column" }}>
          <button
            disabled={loading || resolved}
            onClick={() => handleDecision("approved")}
            style={{
              width: "100%", minHeight: 52,
              background: "#14532d", border: "1px solid #4ade80",
              borderRadius: 8, color: "#4ade80",
              fontSize: 14, fontWeight: 700,
              fontFamily: "'DM Sans', sans-serif",
              cursor: loading || resolved ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              transition: "opacity 0.2s",
              opacity: loading || resolved ? 0.5 : 1,
            }}
          >
            {loading ? <Spinner /> : null}
            APPROVE
          </button>
          <button
            disabled={loading || resolved}
            onClick={() => handleDecision("rejected")}
            style={{
              width: "100%", minHeight: 52,
              background: "#450a0a", border: "1px solid #f87171",
              borderRadius: 8, color: "#f87171",
              fontSize: 14, fontWeight: 700,
              fontFamily: "'DM Sans', sans-serif",
              cursor: loading || resolved ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              transition: "opacity 0.2s",
              opacity: loading || resolved ? 0.5 : 1,
            }}
          >
            {loading ? <Spinner /> : null}
            REJECT
          </button>
        </div>
      </div>
    </div>
  );
}
