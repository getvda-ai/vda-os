import { usePoll, useSecondsAgo } from "./useDashboard.js";
import AgentStaircase, { CANONICAL_ORDER } from "./AgentStaircase.jsx";

const DM = { fontFamily: "'DM Sans', sans-serif" };

function StatCard({ label, value, color, subtitle }) {
  return (
    <div style={{
      ...DM, flex: 1, background: "#111318", border: "1px solid #1e2130",
      borderRadius: 10, padding: "14px 16px", textAlign: "center", minWidth: 100,
    }}>
      <div style={{ fontSize: 26, fontWeight: 700, color, marginBottom: 4 }}>{value ?? 0}</div>
      <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 500 }}>{label}</div>
      {subtitle && <div style={{ fontSize: 10, color: "#4b5563", marginTop: 2 }}>{subtitle}</div>}
    </div>
  );
}

function EmptyCard({ icon, title, subtitle }) {
  return (
    <div style={{
      ...DM, background: "#0d0f14", border: "1.5px dashed #1e2130",
      borderRadius: 10, padding: "24px 20px", textAlign: "center",
    }}>
      {icon && <div style={{ fontSize: 24, marginBottom: 8 }}>{icon}</div>}
      <div style={{ fontSize: 14, fontWeight: 600, color: "#4ade80", marginBottom: 4 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 12, color: "#6b7280" }}>{subtitle}</div>}
    </div>
  );
}

function SectionHeader({ title }) {
  return <h3 style={{ ...DM, fontSize: 15, fontWeight: 700, color: "#fff", margin: "0 0 14px" }}>{title}</h3>;
}

const DECISION_COLORS = {
  PASS: { bg: "#14532d", color: "#4ade80" },
  FAIL: { bg: "#450a0a", color: "#f87171" },
  ESCALATE: { bg: "#451a03", color: "#f59e0b" },
  INFO: { bg: "#0f2744", color: "#60a5fa" },
};

export default function HotelGMView({ companyId, onOpenTab }) {
  const { data: phasesData, loading: phasesLoading, lastUpdated } = usePoll(async () => {
    if (!companyId) return null;
    const r = await fetch(`/api/dashboard/phases?companyId=${companyId}`);
    return r.json();
  }, 30000);

  const { data: metricsData } = usePoll(async () => {
    if (!companyId) return null;
    const r = await fetch(`/api/agents/witness/integrity-metrics?companyId=${companyId}`);
    return r.json();
  }, 30000);

  const { data: witnessData } = usePoll(async () => {
    if (!companyId) return null;
    const r = await fetch(`/api/agents/witness?companyId=${companyId}&limit=50`);
    return r.json();
  }, 30000);

  const { data: hitlData } = usePoll(async () => {
    const r = await fetch("/api/hitl/pending");
    return r.json();
  }, 30000);

  const updatedAgo = useSecondsAgo(lastUpdated);

  const phases = phasesData?.phases ?? [];
  const phaseCounts = { run: 0, walk: 0, crawl: 0, not_activated: 0 };
  for (const p of phases) {
    phaseCounts[p.phase] = (phaseCounts[p.phase] ?? 0) + 1;
  }

  // Find next agent to activate
  const activatedIds = new Set(phases.filter((p) => p.phase !== "not_activated").map((p) => p.agentId));
  const nextAgentId = CANONICAL_ORDER.find((id) => !activatedIds.has(id));
  let nextAgent = null;
  if (nextAgentId) {
    const passCount = phases.find((p) => p.agentId === nextAgentId)?.potentialAutonomousDecisions ?? 0;
    nextAgent = {
      agentId: nextAgentId,
      potentialAutonomous: passCount,
      totalDecisions: passCount,
    };
  }

  // Yesterday's decisions (last 24h)
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const recentDecisions = (witnessData?.entries ?? [])
    .filter((e) => new Date(e.createdAt).getTime() > oneDayAgo)
    .slice(0, 8);

  const pendingHitl = hitlData?.pending?.length ?? 0;

  return (
    <div style={{ ...DM, padding: "24px 28px", maxWidth: 1100 }}>
      {/* Section A — Property health */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
          <SectionHeader title="Property health" />
          {lastUpdated && <span style={{ fontSize: 11, color: "#6b7280" }}>Updated {updatedAgo}</span>}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <StatCard label="Agents in RUN" value={phaseCounts.run} color="#4ade80" />
          <StatCard label="Agents in WALK" value={phaseCounts.walk} color="#f59e0b" />
          <StatCard label="Agents in CRAWL" value={phaseCounts.crawl} color="#60a5fa" />
          <StatCard label="Guard rejections today" value={metricsData?.complianceRejectionsLast7d} color="#e5e7eb" subtitle="Last 7 days" />
          <StatCard label="Active exceptions" value={metricsData?.activeExceptions} color="#a855f7" />
        </div>
      </div>

      {/* Section B — Agent activation staircase */}
      <div style={{ marginBottom: 28 }}>
        <SectionHeader title="Agent activation — staircase" />
        <div style={{
          background: "#111318", border: "1px solid #1e2130",
          borderRadius: 10, padding: "16px 20px",
        }}>
          {phasesLoading && !phasesData ? (
            <div style={{ color: "#6b7280", fontSize: 13 }}>Loading…</div>
          ) : (
            <AgentStaircase phases={phases} nextAgent={nextAgent} />
          )}
        </div>
      </div>

      {/* Section C — Yesterday's decisions */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <SectionHeader title="Yesterday's decisions" />
          {onOpenTab && (
            <button
              onClick={() => onOpenTab("witness")}
              style={{
                ...DM, background: "none", border: "1px solid #1e2130",
                borderRadius: 6, padding: "5px 12px", fontSize: 12, color: "#9ca3af",
                cursor: "pointer",
              }}
            >
              View full Witness trail →
            </button>
          )}
        </div>

        {recentDecisions.length === 0 ? (
          <EmptyCard title="No decisions recorded in the last 24 hours" />
        ) : (
          <div style={{
            background: "#111318", border: "1px solid #1e2130",
            borderRadius: 10, overflow: "hidden",
          }}>
            {recentDecisions.map((e, idx) => {
              const dc = DECISION_COLORS[e.decision] ?? DECISION_COLORS.INFO;
              const agentLabel = (e.agent ?? "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
              const ts = new Date(e.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
              const clauseShort = (e.clauseApplied ?? "").slice(0, 80) || "No clause recorded";
              return (
                <div key={e.id} style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "10px 16px",
                  borderBottom: idx < recentDecisions.length - 1 ? "1px solid #1e2130" : "none",
                }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
                    background: dc.bg, color: dc.color,
                    padding: "2px 7px", borderRadius: 4, flexShrink: 0,
                  }}>
                    {e.decision}
                  </span>
                  <span style={{ fontSize: 12, color: "#9ca3af", flexShrink: 0, minWidth: 120 }}>
                    {agentLabel}
                  </span>
                  <span style={{ fontSize: 12, color: "#6b7280", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {clauseShort}
                  </span>
                  <span style={{ fontSize: 11, color: "#4b5563", flexShrink: 0 }}>{ts}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
