import { useState, useEffect, useRef, useCallback } from "react";
import GuestScene from "./GuestScene.jsx";
import AgentPipeline from "./AgentPipeline.jsx";
import ShowreelSummary from "./ShowreelSummary.jsx";

const C = {
  bg: "#07090e",
  card: "#111318",
  border: "#1e2130",
  text: "#ffffff",
  muted: "#8b92a5",
  dim: "#555d72",
  green: "#4ade80",
  amber: "#f59e0b",
  red: "#f87171",
  blue: "#60a5fa",
  orange: "#fb923c",
};

const JOURNEY_META = {
  1: { icon: "🔍", name: "Availability Agent",          subtitle: "Querying live inventory" },
  2: { icon: "💰", name: "Rate Agent",                  subtitle: "Evaluating discount authority" },
  3: { icon: "📋", name: "Reservation Bot",             subtitle: "Creating booking in Apaleo" },
  4: { icon: "✅", name: "Check-In Agent",              subtitle: "5-gate validation" },
  5: { icon: "💳", name: "Folio Charge Agent",          subtitle: "O2C cross-domain policy" },
  6: { icon: "🚪", name: "Checkout Agent",              subtitle: "Loyalty exception evaluation" },
  7: { icon: "📊", name: "Revenue Reconciliation",      subtitle: "Sealing witness ledger" },
};

function StepTrail({ current, completed, total }) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 4,
      justifyContent: "center",
    }}>
      {Array.from({ length: total }, (_, i) => {
        const num = i + 1;
        const isDone = completed.has(num);
        const isActive = num === current;
        return (
          <div key={num} style={{
            width: isActive ? 28 : 8,
            height: 8,
            borderRadius: 4,
            background: isDone
              ? C.green
              : isActive
                ? C.orange
                : C.border,
            transition: "all 0.4s ease",
          }} />
        );
      })}
    </div>
  );
}

function CountdownRing({ step, total }) {
  const pct = (step - 1) / total;
  const r = 18;
  const circ = 2 * Math.PI * r;
  const dash = circ * (1 - pct);
  return (
    <svg width={44} height={44} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={22} cy={22} r={r} fill="none" stroke={C.border} strokeWidth={3} />
      <circle
        cx={22} cy={22} r={r} fill="none"
        stroke={C.orange} strokeWidth={3}
        strokeDasharray={circ}
        strokeDashoffset={dash}
        strokeLinecap="round"
        style={{ transition: "stroke-dashoffset 0.6s ease" }}
      />
    </svg>
  );
}

// ── HITL Decision Card ────────────────────────────────────────────────────
function HitlDecisionCard({ step, onDecide }) {
  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 10,
      background: "rgba(7,9,14,0.88)",
      display: "flex", alignItems: "center", justifyContent: "center",
      animation: "fadeIn 0.25s ease",
      backdropFilter: "blur(4px)",
    }}>
      <div style={{
        background: "#111318",
        border: `1.5px solid #f59e0b60`,
        borderRadius: 14,
        padding: "24px 28px",
        maxWidth: 380,
        width: "90%",
        boxShadow: "0 0 40px rgba(245,158,11,0.15)",
        animation: "fadeIn 0.3s ease",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <div style={{
            width: 36, height: 36, borderRadius: "50%",
            background: "#451a03", border: "1.5px solid #f59e0b",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18,
            animation: "pulse-ring 1.5s ease infinite",
          }}>⚠</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 900, color: "#f59e0b" }}>Human Approval Required</div>
            <div style={{ fontSize: 10, color: "#8b92a5", marginTop: 1 }}>
              Step {step.step} · {step.agent}
            </div>
          </div>
        </div>

        {step.reasoning && (
          <div style={{
            background: "#0a0c10", border: "1px solid #1e2130",
            borderRadius: 8, padding: "10px 12px", marginBottom: 16,
            fontSize: 10, color: "#8b92a5", lineHeight: 1.6, fontStyle: "italic",
          }}>
            "{step.reasoning.slice(0, 160)}{step.reasoning.length > 160 ? "…" : ""}"
          </div>
        )}

        {step.escalationTarget && (
          <div style={{
            fontSize: 10, color: "#60a5fa", marginBottom: 14,
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <span style={{ opacity: 0.6 }}>Escalated to:</span>
            <span style={{ fontWeight: 700 }}>{step.escalationTarget}</span>
          </div>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={() => onDecide("APPROVED")}
            style={{
              flex: 1, padding: "10px 0",
              background: "#14532d", border: "1.5px solid #4ade80",
              borderRadius: 8, fontSize: 13, fontWeight: 900,
              color: "#4ade80", cursor: "pointer",
              fontFamily: "'DM Sans', sans-serif",
              transition: "all 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "#166534"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "#14532d"; }}
          >
            ✓ Approve
          </button>
          <button
            onClick={() => onDecide("REJECTED")}
            style={{
              flex: 1, padding: "10px 0",
              background: "#450a0a", border: "1.5px solid #f87171",
              borderRadius: 8, fontSize: 13, fontWeight: 900,
              color: "#f87171", cursor: "pointer",
              fontFamily: "'DM Sans', sans-serif",
              transition: "all 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "#7f1d1d"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "#450a0a"; }}
          >
            ✗ Reject
          </button>
        </div>
        <div style={{ marginTop: 10, fontSize: 9, color: "#555d72", textAlign: "center" }}>
          Your decision is recorded in the witness ledger
        </div>
      </div>
    </div>
  );
}

export default function DemoShowreel({
  propertyId,
  companyId,
  onClose,
  onStepComplete,
  onAllComplete,
}) {
  const [activeStep, setActiveStep]                 = useState(1);
  const [completedSteps, setCompletedSteps]         = useState({});
  const [filesConsultedByStep, setFilesConsulted]   = useState({});
  const [completedSet, setCompletedSet]             = useState(new Set());
  const [phase, setPhase]                           = useState("running"); // "running" | "summary"
  const [startedAt]                                 = useState(() => Date.now());
  const [error, setError]                           = useState(null);
  const [hitlStep, setHitlStep]                     = useState(null);  // step needing HITL
  const [hitlChoices, setHitlChoices]               = useState({});    // { [stepNum]: "APPROVED"|"REJECTED" }
  const readerRef                                   = useRef(null);
  const bufferRef                                   = useRef("");

  const TOTAL = 7;
  const meta  = JOURNEY_META[activeStep] ?? {};

  const stopStream = useCallback(() => {
    if (readerRef.current) {
      readerRef.current.cancel().catch(() => {});
      readerRef.current = null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function startStream() {
      try {
        const res = await fetch("/api/agents/scenario/run", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
          },
          body: JSON.stringify({ propertyId, companyId }),
        });

        if (!res.ok || !res.body) {
          setError(`Server returned ${res.status}`);
          return;
        }

        const reader = res.body.getReader();
        readerRef.current = reader;
        const decoder = new TextDecoder();

        while (true) {
          if (cancelled) break;
          const { done, value } = await reader.read();
          if (done) break;

          bufferRef.current += decoder.decode(value, { stream: true });
          const lines = bufferRef.current.split("\n");
          bufferRef.current = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6).trim();
            if (payload === "[DONE]") {
              if (!cancelled) setPhase("summary");
              break;
            }
            try {
              const step = JSON.parse(payload);
              if (cancelled) break;

              setCompletedSteps(prev => ({ ...prev, [step.step]: step }));
              setCompletedSet(prev => new Set([...prev, step.step]));
              setFilesConsulted(prev => ({
                ...prev,
                [step.step]: step.filesConsulted ?? [],
              }));
              if (step.step < TOTAL) {
                setActiveStep(step.step + 1);
              }
              if (step.decision === "ESCALATE") {
                setHitlStep(step);
              }
              if (onStepComplete) onStepComplete(step);
            } catch (e) {
              // malformed SSE line — ignore
            }
          }
        }

        if (!cancelled && Object.keys(completedSteps).length === TOTAL) {
          setPhase("summary");
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    }

    startStream();

    return () => {
      cancelled = true;
      stopStream();
    };
  }, []);

  useEffect(() => {
    if (phase === "summary" && onAllComplete) {
      onAllComplete(Object.values(completedSteps));
    }
  }, [phase]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") handleClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleClose = () => {
    stopStream();
    onClose();
  };

  const handleViewTimeline = () => {
    stopStream();
    onClose(true);
  };

  const handleHitlDecide = useCallback((choice) => {
    if (!hitlStep) return;
    setHitlChoices(prev => ({ ...prev, [hitlStep.step]: choice }));
    setHitlStep(null);
  }, [hitlStep]);

  const steps = Object.values(completedSteps);
  const currentStepData = completedSteps[activeStep];

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      zIndex: 9999,
      background: C.bg,
      display: "flex",
      flexDirection: "column",
      fontFamily: "'DM Sans', sans-serif",
      overflow: "hidden",
    }}>
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes glow-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }
        @keyframes pulse-ring {
          0%   { box-shadow: 0 0 0 0 rgba(251,146,60,0.3); }
          70%  { box-shadow: 0 0 0 8px rgba(251,146,60,0); }
          100% { box-shadow: 0 0 0 0 rgba(251,146,60,0); }
        }
        ::-webkit-scrollbar { display: none; }
      `}</style>

      {/* ── Top bar ── */}
      <div style={{
        height: 56,
        flexShrink: 0,
        borderBottom: `1px solid ${C.border}`,
        display: "flex",
        alignItems: "center",
        padding: "0 20px",
        gap: 14,
        background: "#0a0c10",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16, fontWeight: 900, letterSpacing: "-0.03em", color: C.text }}>citizenM</span>
          <span style={{ fontSize: 9, color: C.dim }}>VDA-MD Guest Journey</span>
        </div>

        <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
          <StepTrail
            current={activeStep}
            completed={completedSet}
            total={TOTAL}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {phase === "running" && (
            <div style={{
              fontSize: 9, fontWeight: 700, color: C.orange,
              letterSpacing: "0.1em", textTransform: "uppercase",
              animation: "glow-pulse 1.5s ease infinite",
            }}>
              Live
            </div>
          )}
          {phase === "summary" && (
            <div style={{
              fontSize: 9, fontWeight: 700, color: C.green,
              letterSpacing: "0.1em", textTransform: "uppercase",
            }}>
              Complete
            </div>
          )}
          <button
            onClick={handleClose}
            style={{
              background: "none",
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              width: 28, height: 28,
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer",
              color: C.muted,
              fontSize: 14,
            }}
            title="Close (Esc)"
          >×</button>
        </div>
      </div>

      {/* ── Error state ── */}
      {error && (
        <div style={{
          background: "#450a0a", border: `1px solid ${C.red}40`,
          padding: "12px 20px",
          display: "flex", gap: 10, alignItems: "center",
        }}>
          <span style={{ color: C.red, fontSize: 12 }}>⚠ {error}</span>
          <button
            onClick={handleClose}
            style={{ marginLeft: "auto", background: "none", border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 12px", color: C.muted, cursor: "pointer", fontSize: 11 }}
          >Close</button>
        </div>
      )}

      {/* ── Main body ── */}
      {phase === "summary" ? (
        <ShowreelSummary
          steps={steps}
          startedAt={startedAt}
          onClose={handleClose}
          onViewTimeline={handleViewTimeline}
        />
      ) : (
        <div style={{
          flex: 1,
          display: "flex",
          overflow: "hidden",
        }}>
          {/* ── Left: Guest POV (40%) ── */}
          <div style={{
            width: "40%",
            flexShrink: 0,
            borderRight: `1px solid ${C.border}`,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}>
            <div style={{
              padding: "12px 20px 8px",
              borderBottom: `1px solid ${C.border}`,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}>
              <div style={{
                width: 8, height: 8, borderRadius: "50%",
                background: C.orange,
                animation: "glow-pulse 2s ease infinite",
              }} />
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  Guest perspective
                </div>
                <div style={{ fontSize: 9, color: C.dim }}>What the citizen sees</div>
              </div>
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
                <CountdownRing step={activeStep} total={TOTAL} />
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 16, fontWeight: 900, color: C.text, lineHeight: 1 }}>
                    {activeStep}<span style={{ fontSize: 11, color: C.dim }}>/{TOTAL}</span>
                  </div>
                  <div style={{ fontSize: 8, color: C.dim }}>step</div>
                </div>
              </div>
            </div>

            <div style={{
              flex: 1,
              overflow: "hidden",
              position: "relative",
            }}>
              <GuestScene
                step={activeStep}
                result={currentStepData}
              />
            </div>

            <div style={{
              padding: "10px 20px 12px",
              borderTop: `1px solid ${C.border}`,
              background: "#0a0c10",
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{meta.icon} {meta.name}</div>
              <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{meta.subtitle}</div>
            </div>
          </div>

          {/* ── Right: Agent Layer (60%) ── */}
          <div style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            position: "relative",
          }}>
            {hitlStep && (
              <HitlDecisionCard step={hitlStep} onDecide={handleHitlDecide} />
            )}
            <div style={{
              padding: "12px 20px 8px",
              borderBottom: `1px solid ${C.border}`,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}>
              <div style={{
                width: 8, height: 8, borderRadius: "50%",
                background: C.blue,
                animation: "glow-pulse 2s ease infinite",
              }} />
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  Governance layer
                </div>
                <div style={{ fontSize: 9, color: C.dim }}>VDA-MD policy enforcement</div>
              </div>
              {propertyId && (
                <div style={{
                  marginLeft: "auto",
                  fontSize: 9, color: C.green, fontFamily: "monospace",
                  background: `${C.green}12`, border: `1px solid ${C.green}30`,
                  padding: "2px 8px", borderRadius: 4,
                }}>
                  🏨 {propertyId}
                </div>
              )}
            </div>

            <div style={{ flex: 1, overflow: "hidden", padding: "12px 16px" }}>
              <AgentPipeline
                journeySteps={Object.values(JOURNEY_META).map((m, i) => ({
                  step: i + 1,
                  name: m.name,
                }))}
                completedSteps={completedSteps}
                activeStepNum={activeStep}
                filesConsultedByStep={filesConsultedByStep}
              />
            </div>

            <div style={{
              padding: "10px 16px",
              borderTop: `1px solid ${C.border}`,
              background: "#0a0c10",
              display: "flex",
              gap: 16,
              alignItems: "center",
            }}>
              <div style={{ fontSize: 9, color: C.dim }}>
                {completedSet.size} of {TOTAL} decisions sealed
              </div>
              <div style={{
                flex: 1,
                height: 3,
                background: C.border,
                borderRadius: 2,
                overflow: "hidden",
              }}>
                <div style={{
                  height: "100%",
                  width: `${(completedSet.size / TOTAL) * 100}%`,
                  background: C.green,
                  borderRadius: 2,
                  transition: "width 0.5s ease",
                }} />
              </div>
              <div style={{ fontSize: 9, color: C.muted }}>
                {Math.round((completedSet.size / TOTAL) * 100)}%
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
