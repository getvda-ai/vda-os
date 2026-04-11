const CANONICAL_ORDER = [
  "availability-agent",
  "rate-agent",
  "revenue-reconciliation-agent",
  "checkout-agent",
  "folio-agent",
  "check-in-agent",
  "reservation-bot",
  "folio-charge-agent",
  "onboarding-agent",
];

const DISPLAY_NAMES = {
  "availability-agent": "Availability Agent",
  "rate-agent": "Rate Agent",
  "revenue-reconciliation-agent": "Revenue Reconciliation",
  "checkout-agent": "Checkout Agent",
  "folio-agent": "Folio Agent",
  "check-in-agent": "Check-In Agent",
  "reservation-bot": "Reservation Bot",
  "folio-charge-agent": "Folio Charge Agent",
  "onboarding-agent": "Onboarding Agent",
};

const PHASE_ORDER = ["crawl", "walk", "run"];
const PHASE_COLORS = {
  run:   { color: "#4ade80", bg: "#14532d" },
  walk:  { color: "#f59e0b", bg: "#451a03" },
  crawl: { color: "#60a5fa", bg: "#0f2744" },
};

function phaseReached(currentPhase, targetPhase) {
  if (currentPhase === "not_activated") return false;
  return PHASE_ORDER.indexOf(currentPhase) >= PHASE_ORDER.indexOf(targetPhase);
}

/**
 * AgentStaircase — activation staircase for Hotel GM and Operations Chief views.
 *
 * Single-property mode:  phases = array of agent_phases rows for one company
 * Chain view mode:       allPhases = { companyId: [rows], ... } object
 *                        companyNames = { companyId: "citizenM Berlin", ... }
 */
export default function AgentStaircase({ phases, allPhases, companyNames, nextAgent }) {
  const isChain = !!allPhases;

  const getPhaseForAgent = (agentId) => {
    if (!phases) return "not_activated";
    const row = phases.find((p) => p.agentId === agentId);
    return row?.phase ?? "not_activated";
  };

  const getPhasesAcrossCompanies = (agentId) => {
    if (!allPhases) return {};
    const result = {};
    for (const [cid, rows] of Object.entries(allPhases)) {
      const row = rows.find((p) => p.agentId === agentId);
      result[cid] = row?.phase ?? "not_activated";
    }
    return result;
  };

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif" }}>
      {CANONICAL_ORDER.map((agentId, idx) => {
        const currentPhase = getPhaseForAgent(agentId);
        const isActivated = currentPhase !== "not_activated";

        return (
          <div
            key={agentId}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "10px 0",
              borderBottom: idx < CANONICAL_ORDER.length - 1 ? "1px solid #1e2130" : "none",
              opacity: isActivated ? 1 : 0.4,
            }}
          >
            {/* Position */}
            <span style={{
              width: 22, height: 22, flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              borderRadius: "50%",
              background: isActivated ? "#1e2130" : "transparent",
              border: `1px solid ${isActivated ? "#2e3340" : "#1e2130"}`,
              fontSize: 11, color: "#6b7280", fontWeight: 700,
            }}>
              {idx + 1}
            </span>

            {/* Name */}
            <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: isActivated ? "#e5e7eb" : "#6b7280" }}>
              {DISPLAY_NAMES[agentId]}
            </span>

            {/* Phase pills — single property */}
            {!isChain && (
              <div style={{ display: "flex", gap: 5 }}>
                {PHASE_ORDER.map((phase) => {
                  const reached = phaseReached(currentPhase, phase);
                  const pc = PHASE_COLORS[phase];
                  return (
                    <span key={phase} style={{
                      fontSize: 10, fontWeight: 700, letterSpacing: "0.07em",
                      textTransform: "uppercase",
                      padding: "3px 8px", borderRadius: 4,
                      background: reached ? pc.bg : "transparent",
                      color: reached ? pc.color : "#374151",
                      border: reached ? `1px solid ${pc.color}40` : "1.5px dashed #374151",
                    }}>
                      {phase}
                    </span>
                  );
                })}
              </div>
            )}

            {/* Chain breakdown */}
            {isChain && (() => {
              const phaseMap = getPhasesAcrossCompanies(agentId);
              const counts = { run: 0, walk: 0, crawl: 0, not_activated: 0 };
              for (const p of Object.values(phaseMap)) counts[p] = (counts[p] ?? 0) + 1;

              return (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {["run", "walk", "crawl", "not_activated"].map((ph) => {
                    const count = counts[ph];
                    if (count === 0) return null;
                    const pc = PHASE_COLORS[ph] ?? { color: "#6b7280", bg: "transparent" };
                    const label = ph === "not_activated" ? "inactive" : ph;
                    return (
                      <span key={ph} style={{
                        fontSize: 11, fontWeight: 600,
                        color: pc.color,
                        background: ph !== "not_activated" ? pc.bg : "transparent",
                        padding: "2px 6px", borderRadius: 4,
                        border: ph === "not_activated" ? "1px dashed #374151" : `1px solid ${pc.color}40`,
                      }}>
                        {count}× {label}
                      </span>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        );
      })}

      {/* Next to activate callout — single property only */}
      {!isChain && nextAgent && (
        <div style={{
          marginTop: 14, padding: "12px 14px",
          background: "#0d0f14", border: "1px solid #1e2130", borderLeft: "3px solid #4ade80",
          borderRadius: 8,
        }}>
          <div style={{ fontSize: 11, color: "#4ade80", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
            Next to activate
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#e5e7eb", marginBottom: 4 }}>
            {DISPLAY_NAMES[nextAgent.agentId] ?? nextAgent.agentId}
          </div>
          <div style={{ fontSize: 12, color: "#9ca3af", lineHeight: 1.5 }}>
            In the last 30 days there were{" "}
            <span style={{ color: "#e5e7eb", fontWeight: 600 }}>{nextAgent.totalDecisions ?? 0}</span>{" "}
            decisions this agent could have handled.{" "}
            <span style={{ color: "#4ade80", fontWeight: 600 }}>
              {nextAgent.potentialAutonomous ?? 0}
            </span>{" "}
            would have been autonomous.
          </div>
        </div>
      )}
    </div>
  );
}

export { CANONICAL_ORDER, DISPLAY_NAMES, PHASE_COLORS };
