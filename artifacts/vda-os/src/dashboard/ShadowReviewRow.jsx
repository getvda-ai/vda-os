import { useState } from "react";

const DECISION_COLORS = {
  PASS: { bg: "#14532d", color: "#4ade80" },
  FAIL: { bg: "#450a0a", color: "#f87171" },
  ESCALATE: { bg: "#451a03", color: "#f59e0b" },
  INFO: { bg: "#0f2744", color: "#60a5fa" },
};

/**
 * ShadowReviewRow — crawl-phase shadow decision review for Ambassador view.
 *
 * Props:
 *   witnessId        — witness entry ID
 *   agentId          — agent identifier string
 *   decision         — PASS | FAIL | ESCALATE | INFO
 *   clauseApplied    — verbatim governance clause
 *   actionProposed   — plain English of what agent would have done
 *   apaleoDataContext — raw apaleoData json
 *   onReviewed       — callback(witnessId, agreed) after response
 */
export default function ShadowReviewRow({
  witnessId,
  agentId,
  decision,
  clauseApplied,
  actionProposed,
  apaleoDataContext,
  onReviewed,
}) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const agentLabel = (agentId ?? "Unknown Agent")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  const decStyle = DECISION_COLORS[decision] ?? DECISION_COLORS.INFO;

  const plainEnglish = actionProposed
    || clauseApplied?.slice(0, 120)
    || "Agent made a decision that requires your review.";

  const handleReview = async (agreed) => {
    if (loading || done) return;
    setLoading(true);
    try {
      await fetch("/api/dashboard/shadow-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ witnessId, agentId, companyId: apaleoDataContext?.companyId, agreed }),
      });
      setDone(true);
      setTimeout(() => onReviewed?.(witnessId, agreed), 350);
    } catch (err) {
      console.error("Shadow review error:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      fontFamily: "'DM Sans', sans-serif",
      display: "flex", alignItems: "flex-start", gap: 12,
      padding: "12px 16px",
      background: "#111318",
      border: "1px solid #1e2130",
      borderRadius: 8,
      opacity: done ? 0 : 1,
      transform: done ? "translateY(-4px)" : "translateY(0)",
      transition: "opacity 0.3s ease, transform 0.3s ease",
    }}>
      {/* Decision badge */}
      <span style={{
        flexShrink: 0, fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
        background: decStyle.bg, color: decStyle.color,
        padding: "3px 8px", borderRadius: 4,
        whiteSpace: "nowrap",
      }}>
        {decision}
      </span>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 3, fontWeight: 500 }}>
          {agentLabel}
        </div>
        <div style={{ fontSize: 13, color: "#e5e7eb", lineHeight: 1.45, marginBottom: 8 }}>
          {plainEnglish}
        </div>
        <div style={{ fontSize: 12, color: "#6b7280" }}>
          Would you have done the same?
        </div>
      </div>

      {/* Buttons */}
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        <button
          disabled={loading || done}
          onClick={() => handleReview(true)}
          style={{
            minHeight: 36, minWidth: 52,
            background: "#14532d", border: "1px solid #4ade80",
            borderRadius: 6, color: "#4ade80",
            fontSize: 12, fontWeight: 700,
            fontFamily: "'DM Sans', sans-serif",
            cursor: loading || done ? "not-allowed" : "pointer",
            opacity: loading || done ? 0.5 : 1,
            transition: "opacity 0.2s",
          }}
        >
          ✓ Yes
        </button>
        <button
          disabled={loading || done}
          onClick={() => handleReview(false)}
          style={{
            minHeight: 36, minWidth: 52,
            background: "#450a0a", border: "1px solid #f87171",
            borderRadius: 6, color: "#f87171",
            fontSize: 12, fontWeight: 700,
            fontFamily: "'DM Sans', sans-serif",
            cursor: loading || done ? "not-allowed" : "pointer",
            opacity: loading || done ? 0.5 : 1,
            transition: "opacity 0.2s",
          }}
        >
          ✗ No
        </button>
      </div>
    </div>
  );
}
