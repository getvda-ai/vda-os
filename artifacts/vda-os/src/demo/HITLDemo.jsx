/**
 * HITL Demo — Human-in-the-Loop decision interface.
 * Designed for citizenM ambassador + hotel manager workshops.
 * Mobile-first (iPhone-optimised), works with sample scenarios
 * and optionally loads live tokens from /api/hitl/pending.
 */
import React, { useState, useEffect, useRef, useCallback } from "react";

// ─── Design tokens ────────────────────────────────────────────────────────────
const T = {
  bg:        "#07080a",
  card:      "#0e1014",
  surface:   "#131519",
  border:    "#1e2229",
  borderHi:  "#2e3340",
  text:      "#f5f5f7",
  dim:       "#9ca3af",
  muted:     "#6b7280",
  green:     "#22c55e",
  red:       "#ef4444",
  amber:     "#f59e0b",
  blue:      "#3b82f6",
  purple:    "#a855f7",
  orange:    "#f97316",
  mono:      "'IBM Plex Mono', monospace",
  sans:      "'Outfit', 'DM Sans', sans-serif",
};

// ─── Sample HITL scenarios (ready for demo without any DB data) ───────────────
const SAMPLE_CARDS = [
  {
    id: "demo-1",
    cardType: "approval",
    agentId: "rate-agent",
    agentLabel: "Rate Agent",
    agentIcon: "💰",
    roleBand: "hotel_gm",
    context: "Walk-in guest at citizenM London — booked 3 nights",
    guestRef: "RES-00441 · J. Mensah",
    policyClause: "Rate-Agent-Hospitality-Revenue-Book.AGENTS.md §MUST NOT apply discounts above 10% without HITL approval",
    proposed: "Apply a 15% walk-in discount (£18.75 off per night × 3 nights = £56.25 saving)",
    reason: "Guest flagged competitor rate screenshot (Travelodge). Retention play — guest is a repeat visitor.",
    impact: "£56.25 revenue reduction · Guest retention score: high",
    riskLevel: "medium",
    urgency: "now",
  },
  {
    id: "demo-2",
    cardType: "approval",
    agentId: "check-in-agent",
    agentLabel: "Check-in Agent",
    agentIcon: "🏨",
    roleBand: "ambassador",
    context: "Room 412 — guest due to check out 12:00",
    guestRef: "RES-00512 · S. Okeke (citizenM member, 14 stays)",
    policyClause: "Check-in-Policy.AGENTS.md §Late checkout requires ambassador approval when requested after 09:00",
    proposed: "Grant 14:00 late checkout (2hr extension)",
    reason: "Guest has an early afternoon flight — requested via chat at 09:14. Room next booking is 16:00 arrival.",
    impact: "Room blocked 2hr extra · No revenue loss · High-value member",
    riskLevel: "low",
    urgency: "soon",
  },
  {
    id: "demo-3",
    cardType: "approval",
    agentId: "reservation-bot",
    agentLabel: "Reservation Bot",
    agentIcon: "📋",
    roleBand: "hotel_gm",
    context: "Room 204 — noise complaint logged at 23:15 last night",
    guestRef: "RES-00389 · A. Petrova · 2-night stay",
    policyClause: "Reservation-Policy.AGENTS.md §Complimentary upgrades >£40 value require Hotel GM sign-off",
    proposed: "Upgrade to Penthouse room (£65 rate uplift, night 2 complimentary)",
    reason: "Guest reported street noise through window. Engineering confirmed faulty window seal. Agent calculated retention value exceeds goodwill cost.",
    impact: "£65 lost room revenue · High NPS recovery probability · Guest has 3 future bookings",
    riskLevel: "medium",
    urgency: "now",
  },
  {
    id: "demo-4",
    cardType: "operational_exception",
    agentId: "checkout-agent",
    agentLabel: "Checkout Agent",
    agentIcon: "💳",
    roleBand: "ambassador",
    context: "Guest checked out 08:30 this morning — folio settled",
    guestRef: "RES-00501 · M. Yilmaz",
    policyClause: "Checkout-Policy.AGENTS.md §Refunds >£100 require human approval before processing",
    proposed: "Refund £135 for 1-night 'unacceptable experience' claim (lift out of service)",
    reason: "Guest emailed post-stay. Lift was out of service 18:00–22:00. Housekeeping confirmed. Agent assessed claim as valid under service guarantee.",
    impact: "£135 refund · Preventive: negative review risk if declined · Policy ceiling: £150",
    riskLevel: "high",
    urgency: "today",
  },
  {
    id: "demo-5",
    cardType: "approval",
    agentId: "rate-agent",
    agentLabel: "Rate Agent",
    agentIcon: "💰",
    roleBand: "hotel_gm",
    context: "Corporate account enquiry — BCG Amsterdam (15 rooms, 3 nights)",
    guestRef: "ORG-0088 · BCG Amsterdam",
    policyClause: "Rate-Agent-Hospitality-Revenue-Book.AGENTS.md §Group rates >15% discount require Regional GM approval",
    proposed: "Offer 18% corporate group rate (£31.50/room/night off × 15 rooms × 3 nights = £1,417.50)",
    reason: "Account Manager pre-agreed 18% to close deal. BCG is a target account — 10 stays/yr potential. Competitor offered 20%.",
    impact: "£1,417.50 revenue reduction · Account ARR value: £42k · Escalation: Regional GM required",
    riskLevel: "high",
    urgency: "today",
  },
];

// ─── Risk badge config ─────────────────────────────────────────────────────────
const RISK = {
  low:    { label: "LOW RISK",    bg: "rgba(34,197,94,0.1)",   border: "rgba(34,197,94,0.3)",   text: "#22c55e" },
  medium: { label: "MED RISK",   bg: "rgba(245,158,11,0.1)",  border: "rgba(245,158,11,0.3)",  text: "#f59e0b" },
  high:   { label: "HIGH RISK",  bg: "rgba(239,68,68,0.1)",   border: "rgba(239,68,68,0.3)",   text: "#ef4444" },
};

const URGENCY = {
  now:    { label: "ACT NOW",  color: "#ef4444" },
  soon:   { label: "SOON",     color: "#f59e0b" },
  today:  { label: "TODAY",    color: "#3b82f6" },
};

// ─── Role options ─────────────────────────────────────────────────────────────
const ROLES = [
  { id: "ambassador", label: "Ambassador" },
  { id: "hotel_gm",   label: "Hotel GM" },
];

// ─── Main component ────────────────────────────────────────────────────────────
export default function HITLDemo({ companyId, companyName }) {
  const [activeRole, setActiveRole] = useState("ambassador");
  const [cards, setCards] = useState(SAMPLE_CARDS);
  const [decisions, setDecisions] = useState([]); // { id, action, reason, ts }
  const [activeCard, setActiveCard] = useState(null);
  const [reasonText, setReasonText] = useState("");
  const [escalateTarget, setEscalateTarget] = useState("hotel_gm");
  const [baselineConfirm, setBaselineConfirm] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);
  const [filter, setFilter] = useState("pending"); // pending | resolved | all
  const [liveCards, setLiveCards] = useState([]);
  const [liveLoading, setLiveLoading] = useState(false);
  const [showLive, setShowLive] = useState(false);

  const toastTimer = useRef(null);

  const toast = useCallback((msg, color = T.green) => {
    setToastMsg({ msg, color });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 3500);
  }, []);

  // Load live HITL tokens if companyId available
  useEffect(() => {
    if (!companyId) return;
    setLiveLoading(true);
    const roleParam = activeRole;
    const params = new URLSearchParams({ role_band: roleParam, company_id: String(companyId) });
    fetch(`/api/hitl/pending?${params}`)
      .then(r => r.ok ? r.json() : { pending: [] })
      .then(d => {
        const live = (d.pending || []).map(p => ({
          ...p,
          id: p.token,
          agentLabel: p.agentId?.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()) || "Agent",
          agentIcon: agentIcon(p.agentId),
          context: p.escalationData?.context || `${p.agentId} escalation`,
          guestRef: p.escalationData?.guestRef || "Live token",
          policyClause: p.escalationData?.policyClause || "Policy file — see Witness Agent for full clause",
          proposed: p.escalationData?.proposedAction || p.escalationData?.actionProposed || "Agent action pending approval",
          reason: p.escalationData?.reasoning || "See governance file for context",
          impact: p.escalationData?.impact || "—",
          riskLevel: p.escalationData?.riskLevel || "medium",
          urgency: "now",
          isLive: true,
        }));
        setLiveCards(live);
      })
      .catch(() => setLiveCards([]))
      .finally(() => setLiveLoading(false));
  }, [companyId, activeRole, showLive]);

  const agentIcon = (id) => {
    if (!id) return "🤖";
    if (id.includes("rate")) return "💰";
    if (id.includes("check-in") || id.includes("checkin")) return "🏨";
    if (id.includes("checkout")) return "💳";
    if (id.includes("reservation")) return "📋";
    if (id.includes("folio")) return "📄";
    if (id.includes("revenue")) return "📊";
    return "🤖";
  };

  // Visible demo cards filtered by role
  const roleFiltered = cards.filter(c => {
    if (activeRole === "ambassador") return c.roleBand === "ambassador";
    return true; // hotel_gm sees all
  });

  const pending  = roleFiltered.filter(c => !decisions.find(d => d.id === c.id));
  const resolved = roleFiltered.filter(c =>  decisions.find(d => d.id === c.id));

  const combined = showLive
    ? [...(filter === "pending" || filter === "all" ? [...pending, ...liveCards] : []),
       ...(filter === "resolved" || filter === "all" ? resolved : [])]
    : filter === "pending" ? pending : filter === "resolved" ? resolved : roleFiltered;

  const openCard = (card) => {
    setActiveCard(card);
    setReasonText("");
    setBaselineConfirm(false);
    setEscalateTarget(activeRole === "ambassador" ? "hotel_gm" : "operations_chief");
  };

  const decide = (action, card = activeCard) => {
    if (!card) return;

    // Try live API call if this is a real token
    if (card.isLive && card.id) {
      const body = { outcome: action === "approve" ? "approved" : action === "deny" ? "rejected" : "acknowledged", reason: reasonText, decided_by: `${activeRole} (demo)` };
      fetch(`/api/hitl/respond/${card.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
    }

    const entry = { id: card.id, action, reason: reasonText || null, ts: new Date(), card };
    setDecisions(p => [...p, entry]);
    setActiveCard(null);
    setReasonText("");
    setBaselineConfirm(false);

    const messages = {
      approve:   ["Approved ✓", T.green],
      deny:      ["Declined ✗", T.red],
      escalate:  ["Escalated ↑", T.amber],
      baseline:  ["Set as baseline ✦ Agent can act autonomously going forward", T.purple],
    };
    toast(messages[action][0], messages[action][1]);
  };

  const resetDemo = () => {
    setDecisions([]);
    setCards(SAMPLE_CARDS);
    setActiveCard(null);
    toast("Demo reset — all decisions cleared", T.blue);
  };

  const decisionFor = (id) => decisions.find(d => d.id === id);

  const ACTION_COLORS = {
    approve:  { bg: "rgba(34,197,94,0.12)",  border: "rgba(34,197,94,0.4)",  text: T.green },
    deny:     { bg: "rgba(239,68,68,0.12)",  border: "rgba(239,68,68,0.4)",  text: T.red },
    escalate: { bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.4)", text: T.amber },
    baseline: { bg: "rgba(168,85,247,0.12)", border: "rgba(168,85,247,0.4)", text: T.purple },
  };

  const pendingCount = pending.length + liveCards.length;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ background: T.bg, minHeight: "100vh", maxWidth: 480, margin: "0 auto", fontFamily: T.sans, position: "relative" }}>

      {/* Toast */}
      {toastMsg && (
        <div style={{
          position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)",
          background: "#1a1d22", border: `1px solid ${toastMsg.color}50`,
          color: toastMsg.color, padding: "10px 20px", borderRadius: 100,
          fontSize: 13, fontWeight: 700, fontFamily: T.sans,
          zIndex: 9999, pointerEvents: "none",
          boxShadow: `0 4px 24px ${toastMsg.color}30`,
          animation: "fadeInUp 0.2s ease",
          whiteSpace: "nowrap",
        }}>
          {toastMsg.msg}
        </div>
      )}

      {/* Header */}
      <div style={{
        background: "#070809", borderBottom: `1px solid ${T.border}`,
        padding: "16px 18px 12px", position: "sticky", top: 0, zIndex: 50,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 10, fontFamily: T.mono, color: T.muted, letterSpacing: "0.1em", marginBottom: 3 }}>
              HUMAN-IN-THE-LOOP · {companyName || "citizenM"}
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.03em", color: T.text }}>
              Decision Queue
              {pendingCount > 0 && (
                <span style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  width: 22, height: 22, background: "#ef4444", borderRadius: "50%",
                  fontSize: 11, fontWeight: 900, color: "#fff", marginLeft: 8,
                }}>{pendingCount}</span>
              )}
            </div>
          </div>
          <button onClick={resetDemo} style={{
            background: "none", border: `1px solid ${T.border}`, color: T.muted,
            padding: "5px 12px", borderRadius: 20, fontSize: 11, fontFamily: T.mono, cursor: "pointer",
          }}>Reset</button>
        </div>

        {/* Role pills */}
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          {ROLES.map(r => (
            <button key={r.id} onClick={() => setActiveRole(r.id)} style={{
              background: activeRole === r.id ? "rgba(249,115,22,0.12)" : T.card,
              border: `1px solid ${activeRole === r.id ? "rgba(249,115,22,0.4)" : T.border}`,
              color: activeRole === r.id ? T.orange : T.dim,
              padding: "5px 14px", borderRadius: 20, fontSize: 12, fontFamily: T.sans,
              fontWeight: activeRole === r.id ? 700 : 400, cursor: "pointer",
              transition: "all 0.15s",
            }}>{r.label}</button>
          ))}
          {companyId && (
            <button onClick={() => setShowLive(o => !o)} style={{
              background: showLive ? "rgba(59,130,246,0.12)" : T.card,
              border: `1px solid ${showLive ? "rgba(59,130,246,0.4)" : T.border}`,
              color: showLive ? T.blue : T.dim,
              padding: "5px 14px", borderRadius: 20, fontSize: 12, fontFamily: T.sans,
              fontWeight: showLive ? 700 : 400, cursor: "pointer", marginLeft: "auto",
            }}>
              {liveLoading ? "…" : showLive ? "● Live" : "⬤ Live off"}
            </button>
          )}
        </div>

        {/* Filter tabs */}
        <div style={{ display: "flex", gap: 0, borderBottom: `1px solid ${T.border}` }}>
          {[
            { id: "pending",  label: `Pending (${pending.length + (showLive ? liveCards.length : 0)})` },
            { id: "resolved", label: `Resolved (${resolved.length + decisions.filter(d => liveCards.find(l => l.id === d.id)).length})` },
          ].map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)} style={{
              background: "none", border: "none",
              borderBottom: `2px solid ${filter === f.id ? T.orange : "transparent"}`,
              color: filter === f.id ? T.text : T.muted,
              padding: "7px 14px", cursor: "pointer",
              fontSize: 12, fontFamily: T.sans, fontWeight: filter === f.id ? 700 : 400,
            }}>{f.label}</button>
          ))}
        </div>
      </div>

      {/* Card list */}
      <div style={{ padding: "14px 14px 100px" }}>
        {filter === "pending" && combined.length === 0 && (
          <div style={{
            textAlign: "center", padding: "48px 24px", color: T.muted,
          }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: T.dim, marginBottom: 6 }}>Queue clear</div>
            <div style={{ fontSize: 13, color: T.muted }}>All decisions resolved for this role.</div>
            <button onClick={resetDemo} style={{
              marginTop: 20, background: `rgba(249,115,22,0.1)`, border: `1px solid rgba(249,115,22,0.3)`,
              color: T.orange, padding: "8px 20px", borderRadius: 8, cursor: "pointer",
              fontSize: 13, fontFamily: T.sans, fontWeight: 700,
            }}>↺ Reset for demo</button>
          </div>
        )}

        {combined.map(card => {
          const decision = decisionFor(card.id);
          const risk = RISK[card.riskLevel] || RISK.medium;
          const urg = URGENCY[card.urgency] || URGENCY.today;
          const ac = decision ? ACTION_COLORS[decision.action] : null;

          return (
            <div
              key={card.id}
              onClick={() => !decision && openCard(card)}
              style={{
                background: ac ? ac.bg : T.card,
                border: `1px solid ${ac ? ac.border : T.border}`,
                borderRadius: 16, padding: "16px", marginBottom: 12,
                cursor: decision ? "default" : "pointer",
                transition: "all 0.18s",
                opacity: decision ? 0.7 : 1,
                position: "relative", overflow: "hidden",
              }}
            >
              {/* Decision ribbon */}
              {decision && (
                <div style={{
                  position: "absolute", top: 0, right: 0,
                  background: ac.border, padding: "3px 12px",
                  borderBottomLeftRadius: 10, fontSize: 10, fontFamily: T.mono,
                  fontWeight: 700, color: ac.text, letterSpacing: "0.08em",
                }}>
                  {decision.action.toUpperCase()}
                </div>
              )}

              {/* Card header */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 12,
                  background: T.surface, border: `1px solid ${T.border}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 20, flexShrink: 0,
                }}>
                  {card.agentIcon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{card.agentLabel}</span>
                    {card.isLive && (
                      <span style={{
                        fontSize: 9, fontFamily: T.mono, color: T.blue,
                        background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.3)",
                        borderRadius: 4, padding: "1px 5px", letterSpacing: "0.06em",
                      }}>LIVE</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: T.muted, fontFamily: T.mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {card.guestRef}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end", flexShrink: 0 }}>
                  <span style={{
                    fontSize: 9, fontFamily: T.mono, fontWeight: 700,
                    background: risk.bg, border: `1px solid ${risk.border}`,
                    color: risk.text, borderRadius: 4, padding: "2px 6px", letterSpacing: "0.06em",
                  }}>{risk.label}</span>
                  {!decision && (
                    <span style={{ fontSize: 9, fontFamily: T.mono, fontWeight: 700, color: urg.color }}>
                      {urg.label}
                    </span>
                  )}
                </div>
              </div>

              {/* Proposed action */}
              <div style={{
                background: T.surface, borderRadius: 10, padding: "10px 12px", marginBottom: 8,
                borderLeft: `3px solid ${decision ? ac.border : T.amber}`,
              }}>
                <div style={{ fontSize: 10, fontFamily: T.mono, color: T.muted, marginBottom: 4, letterSpacing: "0.06em" }}>
                  AGENT REQUESTS
                </div>
                <div style={{ fontSize: 13, color: T.text, lineHeight: 1.4, fontWeight: 500 }}>
                  {card.proposed}
                </div>
              </div>

              {/* Context snippet */}
              <div style={{ fontSize: 12, color: T.dim, lineHeight: 1.5, marginBottom: 8 }}>
                {card.context}
              </div>

              {/* Impact */}
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 10, fontFamily: T.mono, color: T.muted }}>IMPACT</span>
                <span style={{ fontSize: 11, color: T.dim }}>{card.impact}</span>
              </div>

              {/* Decision info if resolved */}
              {decision && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${T.border}` }}>
                  <div style={{ fontSize: 11, color: ac.text, fontWeight: 700 }}>
                    {decision.action === "approve" ? "✓ Approved" : decision.action === "deny" ? "✗ Declined" : decision.action === "escalate" ? "↑ Escalated" : "✦ Set as baseline"}
                    <span style={{ color: T.muted, fontWeight: 400, marginLeft: 6 }}>
                      {decision.ts.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  {decision.reason && (
                    <div style={{ fontSize: 11, color: T.dim, marginTop: 3 }}>"{decision.reason}"</div>
                  )}
                </div>
              )}

              {/* Tap hint for pending */}
              {!decision && (
                <div style={{ textAlign: "right", marginTop: 8 }}>
                  <span style={{ fontSize: 11, color: T.muted, fontFamily: T.mono }}>Tap to decide →</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Decision drawer ─────────────────────────────────────────────────── */}
      {activeCard && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 200,
          display: "flex", flexDirection: "column",
        }}>
          {/* Backdrop */}
          <div
            onClick={() => setActiveCard(null)}
            style={{ flex: 1, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
          />

          {/* Sheet */}
          <div style={{
            background: "#0d0f13",
            borderTop: `1px solid ${T.borderHi}`,
            borderRadius: "24px 24px 0 0",
            padding: "0 0 env(safe-area-inset-bottom,20px)",
            maxHeight: "88vh",
            overflowY: "auto",
          }}>
            {/* Drag handle */}
            <div style={{ padding: "12px 0 0", display: "flex", justifyContent: "center" }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: T.borderHi }} />
            </div>

            <div style={{ padding: "12px 20px 24px" }}>
              {/* Agent + card header */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <div style={{
                  width: 48, height: 48, borderRadius: 14,
                  background: T.surface, border: `1px solid ${T.borderHi}`,
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24,
                }}>
                  {activeCard.agentIcon}
                </div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: T.text }}>{activeCard.agentLabel}</div>
                  <div style={{ fontSize: 12, color: T.muted, fontFamily: T.mono }}>{activeCard.guestRef}</div>
                </div>
                <div style={{ marginLeft: "auto" }}>
                  <span style={{
                    fontSize: 9, fontFamily: T.mono, fontWeight: 700, letterSpacing: "0.06em",
                    background: RISK[activeCard.riskLevel]?.bg,
                    border: `1px solid ${RISK[activeCard.riskLevel]?.border}`,
                    color: RISK[activeCard.riskLevel]?.text,
                    borderRadius: 5, padding: "3px 8px",
                  }}>
                    {RISK[activeCard.riskLevel]?.label}
                  </span>
                </div>
              </div>

              {/* What the agent wants */}
              <Section title="AGENT REQUESTS">
                <div style={{ fontSize: 15, fontWeight: 600, color: T.text, lineHeight: 1.5 }}>
                  {activeCard.proposed}
                </div>
              </Section>

              {/* Why */}
              <Section title="AGENT'S REASONING">
                <div style={{ fontSize: 13, color: T.dim, lineHeight: 1.6 }}>
                  {activeCard.reason}
                </div>
              </Section>

              {/* Policy */}
              <Section title="POLICY RULE TRIGGERED">
                <div style={{
                  background: "rgba(245,158,11,0.06)", border: `1px solid rgba(245,158,11,0.2)`,
                  borderLeft: `3px solid ${T.amber}`, borderRadius: 8, padding: "10px 12px",
                }}>
                  <div style={{ fontSize: 11, fontFamily: T.mono, color: T.dim, lineHeight: 1.6 }}>
                    {activeCard.policyClause}
                  </div>
                </div>
              </Section>

              {/* Impact */}
              <Section title="IMPACT">
                <div style={{ fontSize: 13, color: T.dim, lineHeight: 1.5 }}>{activeCard.impact}</div>
              </Section>

              {/* Reason input */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, fontFamily: T.mono, color: T.muted, letterSpacing: "0.07em", marginBottom: 6 }}>
                  YOUR REASON (optional — logged to Witness Agent)
                </div>
                <textarea
                  value={reasonText}
                  onChange={e => setReasonText(e.target.value)}
                  placeholder="e.g. Guest retention priority, confirmed issue, overriding policy this time…"
                  rows={2}
                  style={{
                    width: "100%", boxSizing: "border-box",
                    background: T.surface, border: `1px solid ${T.border}`,
                    borderRadius: 10, padding: "10px 12px",
                    color: T.text, fontSize: 13, fontFamily: T.sans,
                    resize: "none", outline: "none", lineHeight: 1.5,
                  }}
                />
              </div>

              {/* Escalation target (for escalate action) */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 10, fontFamily: T.mono, color: T.muted, letterSpacing: "0.07em", marginBottom: 6 }}>
                  ESCALATE TO
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {[
                    { id: "hotel_gm",          label: "Hotel GM" },
                    { id: "regional_gm",       label: "Regional GM" },
                    { id: "operations_chief",  label: "Operations Chief" },
                    { id: "compliance_officer", label: "CISO" },
                  ].filter(t => t.id !== activeRole).map(t => (
                    <button key={t.id} onClick={() => setEscalateTarget(t.id)} style={{
                      background: escalateTarget === t.id ? "rgba(245,158,11,0.1)" : T.surface,
                      border: `1px solid ${escalateTarget === t.id ? "rgba(245,158,11,0.4)" : T.border}`,
                      color: escalateTarget === t.id ? T.amber : T.dim,
                      padding: "5px 12px", borderRadius: 8,
                      fontSize: 12, fontFamily: T.sans, cursor: "pointer",
                      fontWeight: escalateTarget === t.id ? 700 : 400,
                    }}>{t.label}</button>
                  ))}
                </div>
              </div>

              {/* Baseline confirm toggle */}
              {!baselineConfirm ? null : (
                <div style={{
                  background: "rgba(168,85,247,0.07)", border: "1px solid rgba(168,85,247,0.25)",
                  borderRadius: 12, padding: "12px 14px", marginBottom: 16,
                }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.purple, marginBottom: 6 }}>
                    ✦ Confirm: Set as baseline
                  </div>
                  <div style={{ fontSize: 12, color: T.dim, lineHeight: 1.5, marginBottom: 10 }}>
                    This tells the agent it can perform this type of action autonomously going forward — without asking for approval each time. The Witness Agent will log this permanently.
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => decide("baseline")} style={{
                      flex: 1, background: "rgba(168,85,247,0.12)", border: "1px solid rgba(168,85,247,0.4)",
                      color: T.purple, padding: "10px 0", borderRadius: 10, fontSize: 14,
                      fontWeight: 800, cursor: "pointer", fontFamily: T.sans,
                    }}>Confirm Baseline ✦</button>
                    <button onClick={() => setBaselineConfirm(false)} style={{
                      background: T.surface, border: `1px solid ${T.border}`, color: T.muted,
                      padding: "10px 14px", borderRadius: 10, fontSize: 13, cursor: "pointer",
                    }}>Cancel</button>
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                <ActionBtn
                  label="✓  Approve"
                  bg="rgba(34,197,94,0.12)" border="rgba(34,197,94,0.5)" color={T.green}
                  onClick={() => decide("approve")}
                />
                <ActionBtn
                  label="✗  Deny"
                  bg="rgba(239,68,68,0.12)" border="rgba(239,68,68,0.5)" color={T.red}
                  onClick={() => decide("deny")}
                />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <ActionBtn
                  label={`↑ Escalate to ${ROLES.find(r => r.id === escalateTarget)?.label || escalateTarget.replace(/_/g, " ")}`}
                  bg="rgba(245,158,11,0.1)" border="rgba(245,158,11,0.4)" color={T.amber}
                  onClick={() => decide("escalate")}
                  small
                />
                <ActionBtn
                  label="✦ Set baseline"
                  bg="rgba(168,85,247,0.08)" border="rgba(168,85,247,0.3)" color={T.purple}
                  onClick={() => setBaselineConfirm(true)}
                  small
                />
              </div>

              {/* Close */}
              <button
                onClick={() => setActiveCard(null)}
                style={{
                  width: "100%", marginTop: 14,
                  background: "none", border: `1px solid ${T.border}`, color: T.muted,
                  padding: "10px 0", borderRadius: 10, fontSize: 13, cursor: "pointer",
                  fontFamily: T.sans,
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Decisions log panel ────────────────────────────────────────────── */}
      {filter === "resolved" && decisions.length > 0 && (
        <div style={{ padding: "0 14px 24px" }}>
          <div style={{ fontSize: 10, fontFamily: T.mono, color: T.muted, letterSpacing: "0.1em", marginBottom: 12 }}>
            DECISION LOG — {decisions.length} RESOLVED
          </div>
          {decisions.slice().reverse().map(d => {
            const ac = ACTION_COLORS[d.action];
            return (
              <div key={d.id + d.ts} style={{
                background: ac.bg, border: `1px solid ${ac.border}`,
                borderRadius: 12, padding: "12px 14px", marginBottom: 8,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: ac.text }}>
                    {d.action === "approve" ? "✓ Approved" : d.action === "deny" ? "✗ Denied" : d.action === "escalate" ? "↑ Escalated" : "✦ Baselined"}
                  </span>
                  <span style={{ fontSize: 11, fontFamily: T.mono, color: T.muted }}>
                    {d.ts.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: T.text, fontWeight: 600, marginBottom: 2 }}>
                  {d.card.agentLabel} · {d.card.guestRef}
                </div>
                <div style={{ fontSize: 11, color: T.dim }}>
                  {d.card.proposed.slice(0, 90)}{d.card.proposed.length > 90 ? "…" : ""}
                </div>
                {d.reason && (
                  <div style={{ fontSize: 11, color: T.muted, marginTop: 4, fontStyle: "italic" }}>
                    "{d.reason}"
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        @keyframes fadeInUp { from { opacity:0; transform:translateX(-50%) translateY(8px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }
      `}</style>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10, fontFamily: "'IBM Plex Mono', monospace", color: "#6b7280", letterSpacing: "0.07em", marginBottom: 6 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function ActionBtn({ label, bg, border, color, onClick, small }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: hover ? bg.replace("0.12", "0.2").replace("0.1", "0.18").replace("0.08", "0.15") : bg,
        border: `1px solid ${border}`,
        color, padding: small ? "11px 8px" : "14px 8px",
        borderRadius: 12, fontSize: small ? 12 : 15,
        fontWeight: 700, cursor: "pointer", fontFamily: "'Outfit', sans-serif",
        transition: "all 0.15s", textAlign: "center",
        lineHeight: 1.3,
      }}
    >
      {label}
    </button>
  );
}
