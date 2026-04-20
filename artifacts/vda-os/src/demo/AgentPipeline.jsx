import { useState, useEffect, useRef } from "react";

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
  orange: "#fb923c",
  purple: "#a855f7",
};

const DEC_COLORS = {
  PASS:     { color: C.green,  bg: "#14532d",  label: "PASS",     icon: "✓" },
  FAIL:     { color: C.red,    bg: "#450a0a",  label: "FAIL",     icon: "✗" },
  ESCALATE: { color: C.amber,  bg: "#451a03",  label: "ESCALATE", icon: "⚠" },
};

const MICRO_PHASES = [
  { id: "cred",    label: "W3C credential verified",      icon: "🔐", delay: 0 },
  { id: "files",   label: "Governance files loaded",       icon: "📄", delay: 400 },
  { id: "data",    label: "Apaleo live data fetched",      icon: "🔗", delay: 800 },
  { id: "ai",      label: "Policy AI evaluating…",         icon: "🧠", delay: 1200, spinner: true },
  { id: "decide",  label: "Decision",                      icon: "⚡", delay: 2000 },
  { id: "seal",    label: "Witness ledger sealed",         icon: "🔒", delay: 2500 },
];

function StepBadge({ stepNum, name, decision, isActive, isComplete }) {
  const dc = DEC_COLORS[decision] ?? DEC_COLORS.PASS;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "8px 12px",
      borderRadius: 8,
      background: isActive ? `${C.orange}08` : isComplete ? `${dc.bg}50` : C.card,
      border: `1px solid ${isActive ? C.orange + "40" : isComplete ? dc.color + "30" : C.border}`,
      marginBottom: 6,
      transition: "all 0.3s",
    }}>
      <div style={{
        width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: isActive ? `${C.orange}20` : isComplete ? `${dc.bg}` : C.border,
        border: `1.5px solid ${isActive ? C.orange : isComplete ? dc.color : C.border}`,
        fontSize: 9, fontWeight: 700, color: isActive ? C.orange : isComplete ? dc.color : C.dim,
      }}>
        {isComplete ? dc.icon : stepNum}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{
          fontSize: 11, fontWeight: isActive ? 700 : 600,
          color: isActive ? C.text : isComplete ? C.muted : C.dim,
        }}>
          {name}
        </div>
      </div>
      {isComplete && (
        <div style={{
          fontSize: 9, fontWeight: 700, letterSpacing: "0.07em",
          color: dc.color, background: dc.bg,
          padding: "2px 6px", borderRadius: 4,
        }}>
          {dc.label}
        </div>
      )}
      {isActive && (
        <div style={{
          fontSize: 9, color: C.orange,
          animation: "glow-pulse 1.5s ease infinite",
        }}>
          LIVE
        </div>
      )}
    </div>
  );
}

function ActivePipeline({ stepResult, agentName, stepNum, filesConsulted }) {
  const [revealed, setRevealed] = useState([]);
  const decided = !!stepResult;
  const dc = DEC_COLORS[stepResult?.decision] ?? null;

  useEffect(() => {
    setRevealed([]);
    const timers = MICRO_PHASES.map((ph) =>
      setTimeout(() => {
        if (ph.id === "decide" && !decided) return;
        if (ph.id === "seal" && !decided) return;
        setRevealed(prev => [...prev, ph.id]);
      }, ph.delay)
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    if (decided) {
      setRevealed(prev => {
        const next = [...prev];
        if (!next.includes("decide")) next.push("decide");
        setTimeout(() => setRevealed(p => p.includes("seal") ? p : [...p, "seal"]), 500);
        return next;
      });
    }
  }, [decided]);

  const fileNames = filesConsulted?.length > 0
    ? filesConsulted
    : ["AGENTS.md", "SOP.md", "SKILL.md"];

  return (
    <div style={{
      background: C.card,
      border: `1px solid ${C.orange}30`,
      borderRadius: 12,
      padding: "16px",
      marginBottom: 10,
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
        color: C.orange, marginBottom: 12, display: "flex", alignItems: "center", gap: 6,
      }}>
        <span style={{ animation: "spin 2s linear infinite", display: "inline-block" }}>⟳</span>
        Step {stepNum} · {agentName}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {MICRO_PHASES.map((ph) => {
          const done = revealed.includes(ph.id);
          const isDecide = ph.id === "decide";
          const isSeal = ph.id === "seal";
          const isRunning = ph.id === "ai" && done && !decided;
          const skip = (isDecide || isSeal) && !decided && !done;

          return (
            <div key={ph.id} style={{
              display: "flex", alignItems: "flex-start", gap: 10,
              opacity: skip ? 0.25 : done ? 1 : 0.4,
              transition: "opacity 0.4s",
            }}>
              <div style={{
                width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: done
                  ? (isDecide && dc ? dc.bg : "#1a1f2e")
                  : "#0d0f14",
                border: `1px solid ${done
                  ? (isDecide && dc ? dc.color + "50" : C.border)
                  : C.border}`,
                fontSize: 11,
                transition: "all 0.3s",
              }}>
                {done ? ph.icon : <span style={{ width: 8, height: 8, background: C.border, borderRadius: "50%", display: "block" }} />}
              </div>

              <div style={{ flex: 1, paddingTop: 2 }}>
                {isDecide && done && dc ? (
                  <div>
                    <div style={{
                      fontSize: 14, fontWeight: 900, color: dc.color,
                      letterSpacing: "-0.02em", lineHeight: 1,
                    }}>
                      {dc.icon} {dc.label}
                    </div>
                    {stepResult?.clauseApplied && (
                      <div style={{
                        fontSize: 9, color: C.muted,
                        fontStyle: "italic",
                        marginTop: 4,
                        lineHeight: 1.5,
                        maxHeight: 48, overflow: "hidden",
                        display: "-webkit-box",
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: "vertical",
                      }}>
                        "{stepResult.clauseApplied.slice(0, 120)}{stepResult.clauseApplied.length > 120 ? "…" : ""}"
                      </div>
                    )}
                  </div>
                ) : isDecide ? (
                  <span style={{ fontSize: 11, color: C.dim }}>Awaiting AI decision…</span>
                ) : isSeal && done ? (
                  <div>
                    <span style={{ fontSize: 11, color: C.muted }}>Witness entry </span>
                    <span style={{ fontSize: 9, color: C.blue, fontFamily: "monospace" }}>
                      #{stepResult?.witnessEntryId}
                    </span>
                  </div>
                ) : ph.id === "files" && done ? (
                  <div>
                    <div style={{ fontSize: 11, color: C.muted }}>{ph.label}</div>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 3 }}>
                      {fileNames.slice(0, 4).map(f => (
                        <span key={f} style={{
                          fontSize: 8, fontFamily: "monospace", color: C.blue,
                          background: "#0a1020", border: "1px solid #1e3a5f",
                          padding: "1px 5px", borderRadius: 3,
                        }}>
                          {f.split("/").pop()}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <span style={{ fontSize: 11, color: isRunning ? C.text : C.muted }}>
                    {ph.label}
                    {isRunning && <span style={{ animation: "glow-pulse 1.5s ease infinite" }}> ●●●</span>}
                  </span>
                )}
              </div>

              {done && ph.id !== "decide" && (
                <span style={{ fontSize: 9, color: C.green, flexShrink: 0, paddingTop: 4 }}>✓</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function AgentPipeline({
  journeySteps,
  completedSteps,
  activeStepNum,
  filesConsultedByStep = {},
}) {
  const scrollRef = useRef(null);

  const activeIdx = journeySteps.findIndex(s => s.step === activeStepNum);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeStepNum, Object.keys(completedSteps).length]);

  return (
    <div style={{
      height: "100%",
      overflowY: "auto",
      padding: "4px 2px",
      scrollbarWidth: "none",
    }} ref={scrollRef}>
      {journeySteps.map((step) => {
        const stepData = completedSteps[step.step];
        const isComplete = !!stepData && step.step !== activeStepNum;
        const isActive = step.step === activeStepNum;

        if (isActive) {
          return (
            <ActivePipeline
              key={step.step}
              stepNum={step.step}
              agentName={step.name}
              stepResult={completedSteps[step.step]}
              filesConsulted={filesConsultedByStep[step.step]}
            />
          );
        }

        return (
          <StepBadge
            key={step.step}
            stepNum={step.step}
            name={step.name}
            decision={stepData?.decision}
            isActive={isActive}
            isComplete={isComplete}
          />
        );
      })}
    </div>
  );
}
