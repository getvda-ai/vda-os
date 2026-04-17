import { usePoll, useSecondsAgo } from "./useDashboard.js";

const DM = { fontFamily: "'DM Sans', sans-serif" };

const HOTELS = [
  { companyId: 3, code: "BER", name: "citizenM Berlin" },
  { companyId: 4, code: "LND", name: "citizenM London" },
  { companyId: 5, code: "MUC", name: "citizenM Munich" },
  { companyId: 6, code: "PAR", name: "citizenM Paris" },
  { companyId: 7, code: "VIE", name: "citizenM Vienna" },
];

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

const AGENT_SHORT = {
  "availability-agent":           "Availability",
  "rate-agent":                   "Rate",
  "revenue-reconciliation-agent": "Rev Rec",
  "checkout-agent":               "Checkout",
  "folio-agent":                  "Folio",
  "check-in-agent":               "Check-In",
  "reservation-bot":              "Res Bot",
  "folio-charge-agent":           "Folio Chg",
  "onboarding-agent":             "Onboarding",
};

const PHASE_COLORS = {
  run:           { color: "#4ade80", bg: "#14532d", label: "R" },
  walk:          { color: "#f59e0b", bg: "#451a03", label: "W" },
  crawl:         { color: "#60a5fa", bg: "#0f2744", label: "C" },
  not_activated: { color: "#ffffff", bg: "transparent", label: "—" },
};

function PhaseDot({ phase }) {
  const pc = PHASE_COLORS[phase] ?? PHASE_COLORS.not_activated;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: 24, height: 24, borderRadius: 4,
      background: phase !== "not_activated" ? pc.bg : "transparent",
      color: pc.color,
      fontSize: 10, fontWeight: 700, letterSpacing: "0.04em",
      border: phase === "not_activated" ? "1.5px dashed #1e2130" : `1px solid ${pc.color}40`,
    }}>
      {pc.label}
    </span>
  );
}

function StatCard({ label, value, color, subtitle }) {
  return (
    <div style={{
      ...DM, flex: 1, background: "#111318", border: "1px solid #1e2130",
      borderRadius: 10, padding: "14px 16px", textAlign: "center", minWidth: 100,
    }}>
      <div style={{ fontSize: 26, fontWeight: 700, color: color ?? "#fff", marginBottom: 4 }}>{value ?? 0}</div>
      <div style={{ fontSize: 11, color: "#ffffff", fontWeight: 500 }}>{label}</div>
      {subtitle && <div style={{ fontSize: 10, color: "#ffffff", marginTop: 2 }}>{subtitle}</div>}
    </div>
  );
}

export default function OperationsChiefView() {
  const { data: chainData, loading: chainLoading, lastUpdated } = usePoll(async () => {
    const r = await fetch("/api/dashboard/chain-health");
    return r.json();
  }, 30000);

  const { data: allPhasesData, loading: phasesLoading } = usePoll(async () => {
    const results = await Promise.all(
      HOTELS.map((h) => fetch(`/api/dashboard/phases?companyId=${h.companyId}`).then((r) => r.json()))
    );
    const byCompany = {};
    for (let i = 0; i < HOTELS.length; i++) {
      byCompany[HOTELS[i].companyId] = results[i]?.phases ?? [];
    }
    return byCompany;
  }, 30000);

  const updatedAgo = useSecondsAgo(lastUpdated);
  const chain = chainData ?? {};
  const agentsPhase = chain.agents_by_phase ?? {};
  const lastCheck = chain.last_integrity_check;

  // Build the per-property × per-agent matrix
  const matrix = CANONICAL_ORDER.map((agentId) => {
    const row = {};
    for (const hotel of HOTELS) {
      const phases = allPhasesData?.[hotel.companyId] ?? [];
      const found = phases.find((p) => p.agentId === agentId);
      row[hotel.companyId] = found?.phase ?? "not_activated";
    }
    return { agentId, row };
  });

  return (
    <div style={{ ...DM, padding: "24px 28px", maxWidth: 1100 }}>
      {/* Section A — Chain-wide governance health */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: "#fff", margin: 0 }}>Chain-wide governance health</h3>
          {lastUpdated && <span style={{ fontSize: 11, color: "#ffffff" }}>Updated {updatedAgo}</span>}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <StatCard label="Properties live" value={chain.properties_live ?? 5} color="#ffffff" />
          <StatCard label="Agents at RUN" value={agentsPhase.run} color="#4ade80" />
          <StatCard label="Agents at WALK+" value={agentsPhase.walk} color="#f59e0b" />
          <StatCard label="Agents at CRAWL+" value={agentsPhase.crawl} color="#60a5fa" />
          <StatCard label="Guard violations today" value={chain.guard_violations_today} color="#f87171" />
          <StatCard label="Exceptions expiring" value={chain.exceptions_expiring_soon} color="#a855f7" subtitle="next 30 days" />
        </div>
      </div>

      {/* Section B — Last integrity check */}
      <div style={{ marginBottom: 28 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: "#fff", margin: "0 0 12px" }}>Integrity check — last run</h3>
        {!lastCheck ? (
          <div style={{
            background: "#0d0f14", border: "1.5px dashed #1e2130", borderRadius: 10,
            padding: "18px 20px", textAlign: "center",
          }}>
            <div style={{ fontSize: 13, color: "#ffffff" }}>No integrity checks recorded yet</div>
          </div>
        ) : (
          <div style={{
            background: "#111318", border: "1px solid #1e2130",
            borderLeft: `4px solid ${lastCheck.result === "PASS" ? "#4ade80" : "#f87171"}`,
            borderRadius: 10, padding: "14px 18px",
            display: "flex", alignItems: "center", gap: 16,
          }}>
            <span style={{
              fontSize: 11, fontWeight: 700, letterSpacing: "0.07em",
              background: lastCheck.result === "PASS" ? "#14532d" : "#450a0a",
              color: lastCheck.result === "PASS" ? "#4ade80" : "#f87171",
              padding: "3px 10px", borderRadius: 4,
            }}>
              {lastCheck.result}
            </span>
            <span style={{ fontSize: 13, color: "#ffffff" }}>
              {new Date(lastCheck.timestamp).toLocaleString("en-GB", {
                day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
              })}
            </span>
            {lastCheck.detail?.envelopes_verified && (
              <span style={{ fontSize: 12, color: "#ffffff" }}>
                {lastCheck.detail.envelopes_verified} envelopes verified
              </span>
            )}
          </div>
        )}
      </div>

      {/* Section C — Adoption progress: 9 agents × 5 properties */}
      <div>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: "#fff", margin: "0 0 4px" }}>
          Adoption progress — all properties
        </h3>
        <div style={{ fontSize: 12, color: "#ffffff", marginBottom: 14 }}>
          R = RUN &nbsp;·&nbsp; W = WALK &nbsp;·&nbsp; C = CRAWL &nbsp;·&nbsp; — = not activated
        </div>
        {(chainLoading && !chainData) || (phasesLoading && !allPhasesData) ? (
          <div style={{ color: "#ffffff", fontSize: 13 }}>Loading chain data…</div>
        ) : (
          <div style={{
            background: "#111318", border: "1px solid #1e2130",
            borderRadius: 10, overflow: "auto",
          }}>
            {/* Header row */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "180px repeat(5, 1fr)",
              borderBottom: "1px solid #1e2130",
              padding: "8px 16px",
              background: "#0d0f14",
            }}>
              <div style={{ fontSize: 10, color: "#ffffff", fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase" }}>
                AGENT
              </div>
              {HOTELS.map((h) => (
                <div key={h.companyId} style={{
                  fontSize: 10, color: "#ffffff", fontWeight: 700, letterSpacing: "0.06em",
                  textAlign: "center", fontFamily: "'DM Mono', monospace",
                }}>
                  {h.code}
                </div>
              ))}
            </div>

            {/* Agent rows */}
            {matrix.map(({ agentId, row }, idx) => (
              <div key={agentId} style={{
                display: "grid",
                gridTemplateColumns: "180px repeat(5, 1fr)",
                padding: "10px 16px",
                borderBottom: idx < matrix.length - 1 ? "1px solid #1e2130" : "none",
                alignItems: "center",
              }}>
                <div style={{ fontSize: 12, color: "#ffffff", fontWeight: 500 }}>
                  {AGENT_SHORT[agentId] ?? agentId}
                </div>
                {HOTELS.map((h) => (
                  <div key={h.companyId} style={{ display: "flex", justifyContent: "center" }}>
                    <PhaseDot phase={row[h.companyId]} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
