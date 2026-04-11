import { usePoll, useSecondsAgo } from "./useDashboard.js";
import AgentStaircase, { CANONICAL_ORDER } from "./AgentStaircase.jsx";

const DM = { fontFamily: "'DM Sans', sans-serif" };

const HOTELS = [
  { companyId: 3, code: "BER", name: "citizenM Berlin" },
  { companyId: 4, code: "LND", name: "citizenM London" },
  { companyId: 5, code: "MUC", name: "citizenM Munich" },
  { companyId: 6, code: "PAR", name: "citizenM Paris" },
  { companyId: 7, code: "VIE", name: "citizenM Vienna" },
];

function StatCard({ label, value, color, subtitle }) {
  return (
    <div style={{
      ...DM, flex: 1, background: "#111318", border: "1px solid #1e2130",
      borderRadius: 10, padding: "14px 16px", textAlign: "center", minWidth: 100,
    }}>
      <div style={{ fontSize: 26, fontWeight: 700, color: color ?? "#fff", marginBottom: 4 }}>{value ?? 0}</div>
      <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 500 }}>{label}</div>
      {subtitle && <div style={{ fontSize: 10, color: "#4b5563", marginTop: 2 }}>{subtitle}</div>}
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

  return (
    <div style={{ ...DM, padding: "24px 28px", maxWidth: 1100 }}>
      {/* Section A — Chain-wide governance health */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: "#fff", margin: 0 }}>Chain-wide governance health</h3>
          {lastUpdated && <span style={{ fontSize: 11, color: "#6b7280" }}>Updated {updatedAgo}</span>}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <StatCard label="Properties live" value={chain.properties_live ?? 5} color="#e5e7eb" />
          <StatCard label="Agents in RUN" value={agentsPhase.run} color="#4ade80" />
          <StatCard label="Agents in WALK" value={agentsPhase.walk} color="#f59e0b" />
          <StatCard label="Agents in CRAWL" value={agentsPhase.crawl} color="#60a5fa" />
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
            <div style={{ fontSize: 13, color: "#6b7280" }}>No integrity checks recorded yet</div>
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
            <span style={{ fontSize: 13, color: "#9ca3af" }}>
              {new Date(lastCheck.timestamp).toLocaleString("en-GB", {
                day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
              })}
            </span>
            {lastCheck.detail?.envelopes_verified && (
              <span style={{ fontSize: 12, color: "#6b7280" }}>
                {lastCheck.detail.envelopes_verified} envelopes verified
              </span>
            )}
          </div>
        )}
      </div>

      {/* Section C — Adoption progress — chain */}
      <div>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: "#fff", margin: "0 0 12px" }}>Adoption progress — chain</h3>
        {(chainLoading && !chainData) || (phasesLoading && !allPhasesData) ? (
          <div style={{ color: "#6b7280", fontSize: 13 }}>Loading chain data…</div>
        ) : (
          <div style={{
            background: "#111318", border: "1px solid #1e2130",
            borderRadius: 10, padding: "16px 20px",
          }}>
            <AgentStaircase allPhases={allPhasesData ?? {}} />
          </div>
        )}
      </div>
    </div>
  );
}
