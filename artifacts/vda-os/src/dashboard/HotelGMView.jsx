import { useState } from "react";
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
      <div style={{ fontSize: 11, color: "#ffffff", fontWeight: 500 }}>{label}</div>
      {subtitle && <div style={{ fontSize: 10, color: "#ffffff", marginTop: 2 }}>{subtitle}</div>}
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
      {subtitle && <div style={{ fontSize: 12, color: "#ffffff" }}>{subtitle}</div>}
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

function DecisionRow({ e, idx, isLast }) {
  const [open, setOpen] = useState(false);
  const dc = DECISION_COLORS[e.decision] ?? DECISION_COLORS.INFO;
  const agentLabel = (e.agent ?? "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const ts = new Date(e.createdAt).toLocaleString("en-GB", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    day: "2-digit", month: "short",
  });
  const clauseShort = (e.clauseApplied ?? "").slice(0, 80) || "No clause recorded";
  const isFail = e.decision === "FAIL";

  const apaleoData = e.apaleoData && typeof e.apaleoData === "object"
    ? Object.entries(e.apaleoData)
        .filter(([, v]) => v !== null && v !== undefined && v !== "")
        .map(([k, v]) => ({ k, v: typeof v === "object" ? JSON.stringify(v) : String(v) }))
    : [];

  return (
    <div style={{
      borderBottom: isLast ? "none" : "1px solid #1e2130",
      borderLeft: isFail ? "3px solid #f87171" : open ? `3px solid ${dc.color}50` : "3px solid transparent",
      transition: "border-color 0.15s",
    }}>
      {/* Collapsed row — always visible, click to toggle */}
      <button
        onClick={() => setOpen((p) => !p)}
        style={{
          width: "100%", background: open ? "#13151c" : "none",
          border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", gap: 12,
          padding: "11px 16px",
          textAlign: "left",
          transition: "background 0.15s",
        }}
        onMouseEnter={(ev) => { if (!open) ev.currentTarget.style.background = "#0f1116"; }}
        onMouseLeave={(ev) => { if (!open) ev.currentTarget.style.background = "none"; }}
      >
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
          background: dc.bg, color: dc.color,
          padding: "2px 7px", borderRadius: 4, flexShrink: 0,
        }}>
          {e.decision}
        </span>
        <span style={{ fontSize: 12, color: "#ffffff", flexShrink: 0, minWidth: 120, fontFamily: "'DM Sans', sans-serif" }}>
          {agentLabel}
        </span>
        <span style={{ fontSize: 12, color: "#ffffff", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "'DM Sans', sans-serif" }}>
          {clauseShort}
        </span>
        <span style={{ fontSize: 11, color: "#ffffff", flexShrink: 0, fontFamily: "'DM Sans', sans-serif" }}>{ts}</span>
        <span style={{
          fontSize: 10, color: dc.color, flexShrink: 0, marginLeft: 4,
          transform: open ? "rotate(180deg)" : "rotate(0deg)",
          transition: "transform 0.2s",
          display: "inline-block",
        }}>▼</span>
      </button>

      {/* Expanded detail panel */}
      {open && (
        <div style={{
          background: "#0c0e13", padding: "16px 20px 18px",
          borderTop: "1px solid #1e2130",
          fontFamily: "'DM Sans', sans-serif",
        }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 28px" }}>

            {/* Left column */}
            <div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, color: "#ffffff", fontWeight: 600, letterSpacing: "0.07em", marginBottom: 4, textTransform: "uppercase" }}>Governance clause</div>
                <div style={{ fontSize: 12, color: "#ffffff", lineHeight: 1.55 }}>
                  {e.clauseApplied || <em style={{ color: "#ffffff" }}>None recorded</em>}
                </div>
              </div>

              {e.actionProposed && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 10, color: "#ffffff", fontWeight: 600, letterSpacing: "0.07em", marginBottom: 4, textTransform: "uppercase" }}>Action proposed</div>
                  <div style={{ fontSize: 12, color: "#ffffff", lineHeight: 1.55 }}>{e.actionProposed}</div>
                </div>
              )}

              {e.reasoning && (
                <div>
                  <div style={{ fontSize: 10, color: "#ffffff", fontWeight: 600, letterSpacing: "0.07em", marginBottom: 4, textTransform: "uppercase" }}>Reasoning</div>
                  <div style={{ fontSize: 12, color: "#ffffff", lineHeight: 1.55 }}>{e.reasoning}</div>
                </div>
              )}
            </div>

            {/* Right column */}
            <div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, color: "#ffffff", fontWeight: 600, letterSpacing: "0.07em", marginBottom: 6, textTransform: "uppercase" }}>Decision details</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ display: "flex", gap: 8 }}>
                    <span style={{ fontSize: 11, color: "#ffffff", minWidth: 100 }}>Event category</span>
                    <span style={{ fontSize: 11, color: "#ffffff", fontFamily: "'DM Mono', monospace" }}>{e.eventCategory ?? "—"}</span>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <span style={{ fontSize: 11, color: "#ffffff", minWidth: 100 }}>File referenced</span>
                    <span style={{ fontSize: 11, color: "#ffffff" }}>{e.fileReferenced ?? "—"}</span>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <span style={{ fontSize: 11, color: "#ffffff", minWidth: 100 }}>Timestamp</span>
                    <span style={{ fontSize: 11, color: "#ffffff" }}>{new Date(e.createdAt).toISOString()}</span>
                  </div>
                  {e.escalationTarget && (
                    <div style={{ display: "flex", gap: 8 }}>
                      <span style={{ fontSize: 11, color: "#ffffff", minWidth: 100 }}>Escalated to</span>
                      <span style={{ fontSize: 11, color: "#f59e0b" }}>{e.escalationTarget}</span>
                    </div>
                  )}
                </div>
              </div>

              {apaleoData.length > 0 && (
                <div>
                  <div style={{ fontSize: 10, color: "#ffffff", fontWeight: 600, letterSpacing: "0.07em", marginBottom: 6, textTransform: "uppercase" }}>Apaleo context</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    {apaleoData.map(({ k, v }) => (
                      <div key={k} style={{ display: "flex", gap: 8 }}>
                        <span style={{ fontSize: 11, color: "#ffffff", minWidth: 100, flexShrink: 0 }}>{k}</span>
                        <span style={{
                          fontSize: 11, color: "#ffffff",
                          fontFamily: "'DM Mono', monospace",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          maxWidth: 220,
                        }} title={v}>{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DecisionList({ decisions }) {
  if (!decisions || decisions.length === 0) {
    return <EmptyCard title="No decisions recorded in the last 24 hours" />;
  }
  return (
    <div style={{
      background: "#111318", border: "1px solid #1e2130",
      borderRadius: 10, overflow: "hidden",
    }}>
      {decisions.map((e, idx) => (
        <DecisionRow key={e.id ?? idx} e={e} idx={idx} isLast={idx === decisions.length - 1} />
      ))}
    </div>
  );
}

function CacheBar({ pct }) {
  const clamped = Math.min(100, Math.max(0, pct ?? 0));
  const color = clamped >= 50 ? "#4ade80" : clamped >= 20 ? "#f59e0b" : "#60a5fa";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
      <div style={{
        flex: 1, height: 6, background: "#1e2130", borderRadius: 3, overflow: "hidden",
      }}>
        <div style={{
          width: `${clamped}%`, height: "100%", background: color,
          borderRadius: 3, transition: "width 0.4s ease",
        }} />
      </div>
      <span style={{ fontSize: 11, color, fontFamily: "'DM Mono', monospace", minWidth: 38, textAlign: "right" }}>
        {clamped.toFixed(1)}%
      </span>
    </div>
  );
}

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

  const { data: tokenStatsData } = usePoll(async () => {
    if (!companyId) return null;
    const r = await fetch(`/api/agents/token-stats?companyId=${companyId}`);
    return r.json();
  }, 60000);

  const updatedAgo = useSecondsAgo(lastUpdated);

  const phases = phasesData?.phases ?? [];
  // Cumulative counts to match the staircase visual (which highlights all phases reached up to current).
  // A RUN agent contributes to RUN, WALK, and CRAWL counts; a WALK agent to WALK and CRAWL, etc.
  const phaseCounts = { run: 0, walk: 0, crawl: 0 };
  for (const p of phases) {
    if (p.phase === "run")                                     phaseCounts.run++;
    if (p.phase === "run" || p.phase === "walk")               phaseCounts.walk++;
    if (p.phase === "run" || p.phase === "walk" || p.phase === "crawl") phaseCounts.crawl++;
  }

  // Find next agent to activate
  const activatedIds = new Set(phases.filter((p) => p.phase !== "not_activated").map((p) => p.agentId));
  const nextAgentId = CANONICAL_ORDER.find((id) => !activatedIds.has(id));
  let nextAgent = null;
  if (nextAgentId) {
    const passCount = phases.find((p) => p.agentId === nextAgentId)?.potential_autonomous_decisions ?? 0;
    nextAgent = {
      agentId: nextAgentId,
      potentialAutonomous: passCount,
      totalDecisions: passCount,
    };
  }

  // Yesterday's decisions (last 24h)
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const recentDecisions = (Array.isArray(witnessData) ? witnessData : [])
    .filter((e) => new Date(e.createdAt).getTime() > oneDayAgo)
    .slice(0, 8);

  const agentCacheRows = tokenStatsData?.agents ?? [];
  const cacheTotals = tokenStatsData?.totals ?? {};
  const hasCacheData = agentCacheRows.some((r) => (r.totalCacheReadTokens ?? 0) > 0 || (r.totalCacheCreationTokens ?? 0) > 0);

  return (
    <div style={{ ...DM, padding: "24px 28px", maxWidth: 1100 }}>
      {/* Section A — Property health */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
          <SectionHeader title="Property health" />
          {lastUpdated && <span style={{ fontSize: 11, color: "#ffffff" }}>Updated {updatedAgo}</span>}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <StatCard label="Agents at RUN" value={phaseCounts.run} color="#4ade80" />
          <StatCard label="Agents at WALK+" value={phaseCounts.walk} color="#f59e0b" />
          <StatCard label="Agents at CRAWL+" value={phaseCounts.crawl} color="#60a5fa" />
          <StatCard label="Guard rejections today" value={metricsData?.complianceRejectionsLast7d} color="#ffffff" subtitle="Last 7 days" />
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
            <div style={{ color: "#ffffff", fontSize: 13 }}>Loading…</div>
          ) : (
            <AgentStaircase phases={phases} nextAgent={nextAgent} />
          )}
        </div>
      </div>

      {/* Section C — AI cache efficiency */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
          <SectionHeader title="AI cache efficiency" />
          {cacheTotals.cacheSavingsPct != null && (
            <span style={{ fontSize: 11, color: "#4ade80", fontFamily: "'DM Mono', monospace" }}>
              {cacheTotals.cacheSavingsPct.toFixed(1)}% overall cache hit rate
            </span>
          )}
        </div>
        <div style={{
          background: "#111318", border: "1px solid #1e2130",
          borderRadius: 10, overflow: "hidden",
        }}>
          {!hasCacheData ? (
            <div style={{ padding: "18px 20px", fontSize: 13, color: "#ffffff" }}>
              No cache data yet — run the demo scenario to populate.
            </div>
          ) : (
            <>
              {/* Header row */}
              <div style={{
                display: "grid", gridTemplateColumns: "180px 1fr 80px 80px",
                gap: 12, padding: "8px 16px",
                borderBottom: "1px solid #1e2130",
                fontSize: 10, color: "#ffffff", fontWeight: 600,
                letterSpacing: "0.07em", textTransform: "uppercase",
              }}>
                <span>Agent</span>
                <span>Cache hit rate</span>
                <span style={{ textAlign: "right" }}>Calls</span>
                <span style={{ textAlign: "right" }}>Saved tokens</span>
              </div>
              {agentCacheRows.map((row, i) => (
                <div
                  key={row.agent ?? i}
                  style={{
                    display: "grid", gridTemplateColumns: "180px 1fr 80px 80px",
                    gap: 12, padding: "10px 16px", alignItems: "center",
                    borderBottom: i < agentCacheRows.length - 1 ? "1px solid #1e2130" : "none",
                  }}
                >
                  <span style={{ fontSize: 12, color: "#ffffff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {(row.agent ?? "").replace(/ Agent$/, "").replace(/ Bot$/, " Bot")}
                  </span>
                  <CacheBar pct={row.cacheSavingsPct ?? 0} />
                  <span style={{ fontSize: 11, color: "#ffffff", textAlign: "right", fontFamily: "'DM Mono', monospace" }}>
                    {row.calls ?? 0}
                  </span>
                  <span style={{ fontSize: 11, color: "#4ade80", textAlign: "right", fontFamily: "'DM Mono', monospace" }}>
                    {(row.totalCacheReadTokens ?? 0).toLocaleString()}
                  </span>
                </div>
              ))}
              {/* Totals footer */}
              {cacheTotals.calls > 0 && (
                <div style={{
                  display: "grid", gridTemplateColumns: "180px 1fr 80px 80px",
                  gap: 12, padding: "10px 16px", alignItems: "center",
                  borderTop: "1px solid #1e2130",
                  background: "#0d0f14",
                }}>
                  <span style={{ fontSize: 11, color: "#ffffff", fontWeight: 600 }}>Total</span>
                  <CacheBar pct={cacheTotals.cacheSavingsPct ?? 0} />
                  <span style={{ fontSize: 11, color: "#ffffff", textAlign: "right", fontFamily: "'DM Mono', monospace" }}>
                    {cacheTotals.calls ?? 0}
                  </span>
                  <span style={{ fontSize: 11, color: "#4ade80", textAlign: "right", fontFamily: "'DM Mono', monospace", fontWeight: 600 }}>
                    {(cacheTotals.totalCacheReadTokens ?? 0).toLocaleString()}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Section D — Yesterday's decisions */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <SectionHeader title="Yesterday's decisions" />
          {onOpenTab && (
            <button
              onClick={() => onOpenTab("witness")}
              style={{
                ...DM, background: "none", border: "1px solid #1e2130",
                borderRadius: 6, padding: "5px 12px", fontSize: 12, color: "#ffffff",
                cursor: "pointer",
              }}
            >
              View full Witness trail →
            </button>
          )}
        </div>

        <DecisionList decisions={recentDecisions} />
      </div>
    </div>
  );
}
