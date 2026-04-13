import { usePoll, useSecondsAgo } from "./useDashboard.js";

const DM = { fontFamily: "'DM Sans', sans-serif" };

const HOTELS = [
  { companyId: 3, code: "BER", name: "citizenM Berlin" },
  { companyId: 4, code: "LND", name: "citizenM London" },
  { companyId: 5, code: "MUC", name: "citizenM Munich" },
  { companyId: 6, code: "PAR", name: "citizenM Paris" },
  { companyId: 7, code: "VIE", name: "citizenM Vienna" },
];

const PHASE_COLORS = {
  run:   { color: "#4ade80", bg: "#14532d" },
  walk:  { color: "#f59e0b", bg: "#451a03" },
  crawl: { color: "#60a5fa", bg: "#0f2744" },
};

function getHealthBadge(phases, metrics, pending) {
  const guardRejections = Number(metrics?.complianceRejectionsLast7d ?? 0);
  const integrityFailed = (metrics?.integrityFailuresAllTime ?? 0) > 0;
  const stalePending = pending.filter((p) => {
    const age = Date.now() - new Date(p.createdAt).getTime();
    return age > 30 * 60 * 1000;
  });

  if (guardRejections > 0 || integrityFailed) {
    return { label: "Alert", color: "#f87171", bg: "#450a0a" };
  }
  if (stalePending.length > 0) {
    return { label: "Review", color: "#f59e0b", bg: "#451a03" };
  }
  return { label: "Healthy", color: "#4ade80", bg: "#14532d" };
}

function PropertyCard({ hotel, phases, metrics, pending, isSelected, onClick }) {
  const phaseCounts = { run: 0, walk: 0, crawl: 0 };
  for (const p of phases ?? []) {
    if (p.phase !== "not_activated") phaseCounts[p.phase] = (phaseCounts[p.phase] ?? 0) + 1;
  }

  const health = getHealthBadge(phases, metrics, pending ?? []);
  const totalActive = phaseCounts.run + phaseCounts.walk + phaseCounts.crawl;

  return (
    <div
      onClick={onClick}
      style={{
        ...DM, background: "#111318",
        border: `1px solid ${isSelected ? "#f59e0b" : "#1e2130"}`,
        borderRadius: 10, padding: "16px 18px",
        cursor: "pointer",
        transition: "border-color 0.2s",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>{hotel.name}</div>
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2, fontFamily: "'DM Mono', monospace" }}>{hotel.code}</div>
        </div>
        <span style={{
          fontSize: 11, fontWeight: 700,
          background: health.bg, color: health.color,
          padding: "3px 10px", borderRadius: 4,
        }}>
          {health.label}
        </span>
      </div>

      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 10 }}>
        {totalActive} agent{totalActive !== 1 ? "s" : ""} active
        {pending?.length > 0 && ` · ${pending.length} pending`}
        {Number(metrics?.complianceRejectionsLast7d ?? 0) > 0 && " · guard events"}
      </div>

      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        {["run", "walk", "crawl"].map((phase) => {
          const count = phaseCounts[phase];
          if (count === 0) return null;
          const pc = PHASE_COLORS[phase];
          return (
            <span key={phase} style={{
              fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
              background: pc.bg, color: pc.color,
              padding: "2px 7px", borderRadius: 4,
              border: `1px solid ${pc.color}40`,
            }}>
              {count}× {phase.toUpperCase()}
            </span>
          );
        })}
        {totalActive === 0 && (
          <span style={{ fontSize: 11, color: "#4b5563", fontStyle: "italic" }}>No active agents</span>
        )}
      </div>
    </div>
  );
}

export default function RegionalGMView({ companyId, onSelectCompany }) {
  const { data, loading, lastUpdated } = usePoll(async () => {
    const [phasesResults, metricsResults, hitlResult, expiryResult] = await Promise.all([
      Promise.all(HOTELS.map((h) =>
        fetch(`/api/dashboard/phases?companyId=${h.companyId}`).then((r) => r.json())
      )),
      Promise.all(HOTELS.map((h) =>
        fetch(`/api/agents/witness/integrity-metrics?companyId=${h.companyId}`).then((r) => r.json())
      )),
      fetch("/api/hitl/pending").then((r) => r.json()),
      // Fetch exceptions expiring soon from chain-health (covers all hotels)
      fetch("/api/dashboard/chain-health").then((r) => r.json()).catch(() => null),
    ]);

    // HITL tokens are linked to onboarding_requests which carry companyId.
    // The pending endpoint now returns companyId per token — group for per-property context.
    const allPending = hitlResult.pending ?? [];
    const pendingByCompany = {};
    for (const t of allPending) {
      if (t.companyId != null) {
        if (!pendingByCompany[t.companyId]) pendingByCompany[t.companyId] = [];
        pendingByCompany[t.companyId].push(t);
      }
    }

    return {
      hotels: HOTELS.map((h, i) => ({
        ...h,
        phases: phasesResults[i]?.phases ?? [],
        metrics: metricsResults[i] ?? {},
        pending: pendingByCompany[h.companyId] ?? [],
      })),
      allPending,
      pendingHitlTotal: allPending.length,
      exceptionsExpiringSoon: expiryResult?.exceptions_expiring_soon ?? 0,
    };
  }, 30000);

  const updatedAgo = useSecondsAgo(lastUpdated);

  const hotels = data?.hotels ?? HOTELS.map((h) => ({ ...h, phases: [], metrics: {}, pending: [] }));

  // Cross-property alerts
  const alerts = [];

  // Cluster-level: pending onboarding HITL approvals
  const pendingHitlTotal = data?.pendingHitlTotal ?? 0;
  if (pendingHitlTotal > 0) {
    alerts.push({
      type: "hitl",
      hotel: null,
      msg: `${pendingHitlTotal} onboarding HITL approval${pendingHitlTotal > 1 ? "s" : ""} awaiting decision — platform-level`,
      severity: "#f59e0b",
    });
  }

  // Chain-level: exceptions expiring in the next 30 days
  const expiringCount = data?.exceptionsExpiringSoon ?? 0;
  if (expiringCount > 0) {
    alerts.push({
      type: "expiry",
      hotel: null,
      msg: `${expiringCount} exception${expiringCount > 1 ? "s" : ""} expiring within 30 days — review before auto-revert`,
      severity: "#a855f7",
    });
  }

  for (const hotel of hotels) {
    const intFailed = Number(hotel.metrics?.integrityFailuresAllTime ?? 0) > 0;
    if (intFailed) alerts.push({ type: "integrity", hotel, msg: `Integrity check failed at ${hotel.name}`, severity: "#f87171" });

    const lowRate = hotel.phases.filter((p) => p.phase === "crawl" && Number(p.agreementRate ?? 100) < 80);
    for (const lp of lowRate) {
      const agentLabel = lp.agentId.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      alerts.push({ type: "agreement", hotel, msg: `${hotel.code}: ${agentLabel} agreement rate below 80% (${lp.agreementRate}%)`, severity: "#f59e0b" });
    }
  }

  return (
    <div style={{ ...DM, padding: "24px 28px", maxWidth: 1100 }}>
      {/* Section A — Your properties */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: "#fff", margin: 0 }}>Your properties</h3>
          {lastUpdated && <span style={{ fontSize: 11, color: "#6b7280" }}>Updated {updatedAgo}</span>}
        </div>
        {loading && !data ? (
          <div style={{ color: "#6b7280", fontSize: 13 }}>Loading property data…</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
            {hotels.map((hotel) => (
              <PropertyCard
                key={hotel.companyId}
                hotel={hotel}
                phases={hotel.phases}
                metrics={hotel.metrics}
                pending={hotel.pending}
                isSelected={hotel.companyId === companyId}
                onClick={() => onSelectCompany?.(hotel.companyId)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Section B — Cross-property alerts */}
      <div>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: "#fff", margin: "0 0 12px" }}>Cross-property alerts</h3>
        {alerts.length === 0 ? (
          <div style={{
            background: "#0d0f14", border: "1.5px dashed #1e2130",
            borderRadius: 10, padding: "24px 20px", textAlign: "center",
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#4ade80" }}>No issues across your cluster</div>
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>All properties within normal governance parameters</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {alerts.map((alert, idx) => (
              <div key={idx} style={{
                background: "#111318", border: "1px solid #1e2130",
                borderLeft: `3px solid ${alert.severity ?? "#f59e0b"}`,
                borderRadius: 8, padding: "12px 16px",
                display: "flex", alignItems: "center", gap: 10,
              }}>
                <span style={{ fontSize: 13, color: "#ffffff" }}>{alert.msg}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
