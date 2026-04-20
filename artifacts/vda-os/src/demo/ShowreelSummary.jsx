const C = {
  bg: "#0a0c10",
  card: "#111318",
  border: "#1e2130",
  text: "#ffffff",
  muted: "#8b92a5",
  dim: "#555d72",
  green: "#4ade80",
  amber: "#f59e0b",
  red: "#f87171",
  blue: "#60a5fa",
  purple: "#a855f7",
  orange: "#fb923c",
};

const DEC = {
  PASS:     { color: C.green,  bg: "#14532d",  label: "PASS" },
  FAIL:     { color: C.red,    bg: "#450a0a",  label: "FAIL" },
  ESCALATE: { color: C.amber,  bg: "#451a03",  label: "ESCALATE" },
};

const STEP_ICONS = { 1: "🔍", 2: "💰", 3: "📋", 4: "✅", 5: "💳", 6: "🚪", 7: "📊" };

export default function ShowreelSummary({ steps, startedAt, onClose, onViewTimeline }) {
  const sortedSteps = [...steps].sort((a, b) => a.step - b.step);
  const totalIn    = sortedSteps.reduce((s, r) => s + (r.inputTokens  ?? 0), 0);
  const totalOut   = sortedSteps.reduce((s, r) => s + (r.outputTokens ?? 0), 0);
  const totalTokens = totalIn + totalOut;
  const elapsedSec = startedAt ? Math.round((Date.now() - startedAt) / 1000) : null;
  const passCount  = sortedSteps.filter(s => s.decision === "PASS").length;
  const escalCount = sortedSteps.filter(s => s.decision === "ESCALATE").length;
  const failCount  = sortedSteps.filter(s => s.decision === "FAIL").length;

  return (
    <div style={{
      height: "100%",
      overflowY: "auto",
      padding: "24px 28px",
      display: "flex",
      flexDirection: "column",
      gap: 20,
      scrollbarWidth: "none",
      fontFamily: "'DM Sans', sans-serif",
    }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>🏆</div>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 900, letterSpacing: "-0.04em", color: C.text }}>
          Journey Complete
        </h2>
        <p style={{ margin: "6px 0 0", fontSize: 12, color: C.muted }}>
          All 7 governance steps executed · Witness ledger sealed
        </p>
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
        {[
          { label: "PASS", value: passCount,  color: C.green,  bg: "#14532d" },
          { label: "ESCALATE", value: escalCount, color: C.amber,  bg: "#451a03" },
          { label: "FAIL", value: failCount,  color: C.red,    bg: "#450a0a" },
          { label: "Tokens", value: totalTokens.toLocaleString(), color: C.blue,   bg: "#0f2744" },
          ...(elapsedSec ? [{ label: "Time", value: `${elapsedSec}s`, color: C.muted, bg: C.card }] : []),
        ].map(({ label, value, color, bg }) => (
          <div key={label} style={{
            background: bg, border: `1px solid ${color}30`,
            borderRadius: 8, padding: "8px 16px", textAlign: "center",
          }}>
            <div style={{ fontSize: 18, fontWeight: 900, color }}>{value}</div>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>{label}</div>
          </div>
        ))}
      </div>

      <div style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        overflow: "hidden",
      }}>
        <div style={{
          display: "grid",
          gridTemplateColumns: "32px 1fr 80px 48px 48px 90px",
          gap: 0,
          borderBottom: `1px solid ${C.border}`,
          padding: "8px 14px",
        }}>
          {["#", "Agent", "Decision", "In", "Out", "Witness Seal"].map(h => (
            <div key={h} style={{
              fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
              textTransform: "uppercase", color: C.dim,
            }}>{h}</div>
          ))}
        </div>

        {sortedSteps.map((step, idx) => {
          const dc = DEC[step.decision] ?? DEC.PASS;
          const clause = step.clauseApplied ?? "";
          const seal = step.witnessEntryId
            ? `#${String(step.witnessEntryId).slice(0, 8)}`
            : "—";
          const isLast = idx === sortedSteps.length - 1;
          return (
            <div key={step.step} style={{
              borderBottom: isLast ? "none" : `1px solid ${C.border}`,
            }}>
              <div style={{
                display: "grid",
                gridTemplateColumns: "32px 1fr 80px 48px 48px 90px",
                gap: 0,
                padding: "10px 14px",
                alignItems: "center",
              }}>
                <div style={{
                  width: 22, height: 22, borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: "#1a1f2e",
                  fontSize: 12,
                }}>
                  {STEP_ICONS[step.step]}
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.text }}>{step.agent}</div>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 3, alignItems: "center" }}>
                  <span style={{
                    fontSize: 9, fontWeight: 700,
                    color: dc.color, background: dc.bg,
                    padding: "2px 6px", borderRadius: 4,
                    letterSpacing: "0.06em",
                  }}>
                    {dc.label}
                  </span>
                  {step.hitlDecision && (
                    <span style={{
                      fontSize: 8, fontWeight: 700,
                      color: step.hitlDecision === "APPROVED" ? C.green : C.red,
                      background: step.hitlDecision === "APPROVED" ? "#14532d" : "#450a0a",
                      padding: "1px 5px", borderRadius: 3, letterSpacing: "0.05em",
                    }}>
                      {step.hitlDecision === "APPROVED" ? "✓ Approved" : "✗ Rejected"}
                    </span>
                  )}
                  {step.exceptionApplied && (
                    <span style={{
                      fontSize: 8, color: C.purple, background: "#2d1b4e",
                      padding: "1px 4px", borderRadius: 3,
                    }}>EXC</span>
                  )}
                </div>
                <div style={{ fontSize: 9, color: C.muted, fontFamily: "monospace" }}>
                  {(step.inputTokens ?? 0).toLocaleString()}
                </div>
                <div style={{ fontSize: 9, color: C.muted, fontFamily: "monospace" }}>
                  {(step.outputTokens ?? 0).toLocaleString()}
                </div>
                <div style={{
                  fontSize: 8, color: C.blue, fontFamily: "monospace",
                  background: seal === "—" ? "transparent" : "#0f2744",
                  border: seal === "—" ? "none" : "1px solid #1e3a5f",
                  padding: seal === "—" ? 0 : "1px 5px",
                  borderRadius: 4,
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}>
                  {seal}
                </div>
              </div>
              {clause && (
                <div style={{
                  padding: "0 14px 10px 46px",
                  fontSize: 9, color: C.dim, fontStyle: "italic", lineHeight: 1.5,
                }}>
                  "{clause.slice(0, 100)}{clause.length > 100 ? "…" : ""}"
                </div>
              )}
            </div>
          );
        })}

        <div style={{
          borderTop: `1px solid ${C.border}`,
          padding: "10px 14px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}>
          <span style={{ fontSize: 10, color: C.muted }}>
            Total tokens
          </span>
          <span style={{ fontSize: 11, fontWeight: 700, color: C.text, fontFamily: "monospace" }}>
            {totalIn.toLocaleString()} in + {totalOut.toLocaleString()} out
            = <span style={{ color: C.blue }}>{totalTokens.toLocaleString()}</span>
          </span>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
        <button
          onClick={onViewTimeline}
          style={{
            background: "#1a2035",
            border: `1px solid ${C.border}`,
            borderRadius: 8, padding: "10px 24px",
            fontSize: 12, fontWeight: 700, color: C.text,
            cursor: "pointer",
            fontFamily: "'DM Sans', sans-serif",
          }}
        >
          View timeline →
        </button>
        <button
          onClick={onClose}
          style={{
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 8, padding: "10px 20px",
            fontSize: 12, fontWeight: 600, color: C.muted,
            cursor: "pointer",
            fontFamily: "'DM Sans', sans-serif",
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}
