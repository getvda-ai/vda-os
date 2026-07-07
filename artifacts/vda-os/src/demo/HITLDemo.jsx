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
  dim:       "#ffffff",
  muted:     "#ffffff",
  green:     "#22c55e",
  red:       "#ef4444",
  amber:     "#f59e0b",
  blue:      "#3b82f6",
  purple:    "#a855f7",
  orange:    "#f97316",
  mono:      "'IBM Plex Mono', monospace",
  sans:      "'Outfit', 'DM Sans', sans-serif",
};

// ─── Sample HITL scenarios ─────────────────────────────────────────────────────
// Each card has: id, cardType, agentId, agentLabel, agentIcon, roleBand,
//   property, guestRef, context, policyClause, proposed, reason,
//   impact, riskLevel, urgency, confidence, financialExposure,
//   suggestedApproveReason, suggestedDenyReason
const SAMPLE_CARDS = [
  {
    id: "demo-1",
    cardType: "approval",
    agentId: "rate-agent",
    agentLabel: "Rate Agent",
    agentIcon: "💰",
    roleBand: "ambassador",
    property: "citizenM London Bankside",
    guestRef: "RES-00441 · J. Mensah · 3 nights",
    context: "Walk-in guest arrived 14:32 — showed competitor screenshot on Booking.com for Travelodge at £89/night vs. our BAR of £125.",
    policyClause: "Rate-Agent-Hospitality-Revenue-Book.AGENTS.md §4.2 — MUST NOT apply discounts above 10% without ambassador HITL approval. Current request: 15%.",
    proposed: "Apply a 15% walk-in discount — £18.75 off/night × 3 nights = £56.25 saving for guest.",
    reason: "Guest is a repeat visitor (4 prior stays in CRM). Showed competitor price evidence. Agent calculates retention value of this guest at £420/yr. Discount payback period: 0.4 visits.",
    impact: "£56.25 revenue reduction tonight · Guest LTV risk if declined: high · No impact on other rooms",
    riskLevel: "medium",
    urgency: "now",
    confidence: 81,
    financialExposure: 56.25,
    tags: ["revenue", "walk-in", "retention"],
    suggestedApproveReason: "Repeat guest with solid LTV — competitor pricing is credible, retention value outweighs the discount.",
    suggestedDenyReason: "BAR integrity must hold during peak nights — offered a loyalty voucher for next stay instead.",
  },
  {
    id: "demo-2",
    cardType: "approval",
    agentId: "check-in-agent",
    agentLabel: "Check-in Agent",
    agentIcon: "🏨",
    roleBand: "ambassador",
    property: "citizenM Amsterdam City",
    guestRef: "RES-00512 · S. Okeke · citizenM member, 14 stays",
    context: "Room 412 — current guest due to check out at 12:00. Request came in via chat at 09:14. Next booking for this room is 16:00 arrival.",
    policyClause: "Check-in-Policy.AGENTS.md §3.1 — Late checkout grants >1hr require ambassador approval when requested after 09:00 same-day.",
    proposed: "Grant 14:00 late checkout — 2hr extension, no charge (member benefit).",
    reason: "Guest has an early afternoon intercontinental flight (KL 592 at 17:45). Checked Apaleo: room has no housekeeping conflict before 15:30. Member tier qualifies for one complimentary late checkout per quarter — this is their first this quarter.",
    impact: "Room blocked 2hr extra · Housekeeping slot shifts to 14:15 · No revenue loss · High NPS upside",
    riskLevel: "low",
    urgency: "now",
    confidence: 96,
    financialExposure: 0,
    tags: ["checkout", "member", "housekeeping"],
    suggestedApproveReason: "14-stay member, room is free until 16:00, and it's within their quarterly benefit — straightforward approval.",
    suggestedDenyReason: "Housekeeping schedule is full — offered 13:00 as a compromise and stored luggage.",
  },
  {
    id: "demo-3",
    cardType: "operational_exception",
    agentId: "revenue-optimizer",
    agentLabel: "Revenue Optimizer",
    agentIcon: "📊",
    roleBand: "hotel_gm",
    property: "citizenM Paris La Défense",
    guestRef: "DEMAND-EVENT · Roland Garros Finals (June 8)",
    context: "System detected demand surge for June 8 check-in (Roland Garros Final). Current BAR: €189. Agent proposes dynamic rate uplift. 14 rooms remain.",
    policyClause: "Revenue-Optimizer.AGENTS.md §2.5 — Dynamic rate increases >40% above current BAR require Hotel GM approval before publishing to OTAs and Apaleo channel manager.",
    proposed: "Raise BAR from €189 → €289 for June 8 check-in (53% uplift) and restrict to min 2-night stays. Estimated uplift: €1,400.",
    reason: "Competitor AirBnB pricing in 5km radius averages €318/night for same dates. STR forward demand index at 94 (sold-out threshold: 95). Agent projects full sell-out within 6hrs at new rate. Current opportunity cost at €189 BAR vs. market: €1,400 for remaining 14 rooms.",
    impact: "£1,400 revenue uplift potential · Channel manager update takes 8min · Window closes ~18:00 tonight",
    riskLevel: "high",
    urgency: "now",
    confidence: 88,
    financialExposure: 1400,
    tags: ["revenue", "dynamic-pricing", "event"],
    suggestedApproveReason: "Comp set data supports it — Roland Garros Final is a once-a-year event. Approve and monitor conversion.",
    suggestedDenyReason: "citizenM brand promise is transparent pricing — large spike on a public event could drive negative press. Held at €229 instead.",
  },
  {
    id: "demo-4",
    cardType: "operational_exception",
    agentId: "checkout-agent",
    agentLabel: "Checkout Agent",
    agentIcon: "💳",
    roleBand: "ambassador",
    property: "citizenM London Tower of London",
    guestRef: "RES-00501 · M. Yilmaz · checked out 08:30",
    context: "Guest checked out this morning. Folio settled at checkout. Emailed complaints team at 11:05 — lift was out of service from 18:00–22:00 last night. Housekeeping log confirms the outage.",
    policyClause: "Checkout-Policy.AGENTS.md §6.1 — Post-stay refunds >£100 require human approval before processing to prevent automated abuse. Service failure refunds up to £150 are pre-authorised under policy.",
    proposed: "Issue £135 refund to original payment card for service disruption (lift outage — 1 night at 50% = £135 goodwill credit).",
    reason: "Lift outage confirmed in engineering log (18:03–21:58). Guest's room was floor 7 — stairs are the only alternative. Agent assessed claim validity: HIGH. Comparable resolved cases: 4 prior approvals at £90–£150. Guest has no prior refund claims. Social media sentiment risk: moderate (83 followers on TripAdvisor).",
    impact: "£135 refund · Prevents estimated 0.8 negative TripAdvisor reviews · Policy ceiling: £150",
    riskLevel: "high",
    urgency: "today",
    confidence: 91,
    financialExposure: 135,
    tags: ["refund", "service-failure", "post-stay"],
    suggestedApproveReason: "Engineering log confirms the outage — this is a genuine service failure. £135 is within policy, approve it.",
    suggestedDenyReason: "Lift was repaired same evening and stairs were available — offered a £40 voucher for next stay as goodwill.",
  },
  {
    id: "demo-5",
    cardType: "approval",
    agentId: "reservation-bot",
    agentLabel: "Reservation Bot",
    agentIcon: "📋",
    roleBand: "hotel_gm",
    property: "citizenM Munich Airport",
    guestRef: "RES-00389 · A. Petrova · 2-night stay",
    context: "Noise complaint filed at 23:15 last night (Room 204). Engineering investigated — confirmed faulty window seal causing street noise ingress. Guest still in-house for second night.",
    policyClause: "Reservation-Policy.AGENTS.md §5.4 — Complimentary room upgrades with rate differential >£40 require Hotel GM sign-off. Penthouse uplift is £65/night.",
    proposed: "Upgrade A. Petrova to Penthouse room (available, floor 12) — night 2 at complimentary Penthouse rate, absorbing £65 uplift.",
    reason: "Guest has 3 future citizenM bookings in next 90 days totalling £540. Engineering confirmed window seal is not repairable before checkout — only fix is room move. No other standard rooms available. Penthouse is free tonight. NPS recovery probability: 85% if upgraded vs. 34% if no action taken.",
    impact: "£65 revenue cost (1 night uplift) · Guest future bookings at risk: £540 · NPS delta: +51pp",
    riskLevel: "medium",
    urgency: "now",
    confidence: 79,
    financialExposure: 65,
    tags: ["upgrade", "complaint", "nps"],
    suggestedApproveReason: "£65 cost, £540 future booking protection, and Engineering confirmed no repair before checkout — easy ROI.",
    suggestedDenyReason: "Offered Room 210 (same floor, quiet courtyard side) as an alternative to avoid the £65 Penthouse cost.",
  },
  {
    id: "demo-6",
    cardType: "compliance_flag",
    agentId: "fraud-detection-agent",
    agentLabel: "Fraud Detection Agent",
    agentIcon: "🔍",
    roleBand: "hotel_gm",
    property: "citizenM New York Times Square",
    guestRef: "ORG-0192 · \"Meridian Consulting\" · 8 rooms, 4 nights",
    context: "New corporate booking received via Apaleo OTA channel. 8 rooms, 4 nights, corporate rate requested. Pattern match flagged by agent: billing address doesn't match registered company, payment card is pre-paid Visa, and booker email domain is 3 days old.",
    policyClause: "Fraud-Detection.AGENTS.md §1.1 — Any corporate booking with ≥3 anomaly signals MUST be held for Hotel GM review before room assignment and key activation.",
    proposed: "Hold booking in Apaleo pending status — request corporate verification documents (company reg. number, signed PO) before confirming. Do not assign rooms.",
    reason: "3 anomaly signals detected: (1) billing address mismatch vs. Companies House record, (2) pre-paid card used for corporate rate, (3) booker domain registered 72hrs ago. Pattern matches 2 prior fraud incidents in NYC portfolio (Aug 2024, Jan 2025). Revenue at risk if rooms occupied without payment recovery: $3,840.",
    impact: "$3,840 revenue at risk if fraud confirmed · Rooms withheld for max 24hrs · Legitimate booking probability: 31%",
    riskLevel: "high",
    urgency: "today",
    confidence: 73,
    financialExposure: 3840,
    tags: ["fraud", "compliance", "corporate"],
    suggestedApproveReason: "Hold confirmed — sent verification request to booker. Will confirm rooms once documents received.",
    suggestedDenyReason: "Contact made with booker directly — anomalies explained by relocation scenario. Verified and released.",
  },
  {
    id: "demo-7",
    cardType: "approval",
    agentId: "rate-agent",
    agentLabel: "Rate Agent",
    agentIcon: "💰",
    roleBand: "hotel_gm",
    property: "citizenM Amsterdam Schiphol Airport",
    guestRef: "ORG-0088 · BCG Amsterdam",
    context: "Corporate Account Manager pre-negotiated 18% group rate for BCG Amsterdam annual offsite. 15 rooms, 3 nights, Q3. Competitor (Van der Valk) offered 20% discount.",
    policyClause: "Rate-Agent-Hospitality-Revenue-Book.AGENTS.md §7.3 — Group rates >15% discount require Regional GM approval for accounts with no prior stays. BCG has 0 prior citizenM stays.",
    proposed: "Offer 18% corporate group rate (€27.90/room/night off × 15 rooms × 3 nights = £1,255 total discount). Contract lock-in for Q3.",
    reason: "BCG Amsterdam is a target account. Account ARR potential: £42k/yr across EU portfolio. Competitor gap: 2% (van der Valk at 20%). Agent calculates break-even at 1.3 future corporate bookings. Marketing qualified the account as Tier 1 in April. Risk of losing to competitor: 68% if declined.",
    impact: "£1,255 revenue reduction this booking · Account ARR potential: £42k · Competitor capture risk: high",
    riskLevel: "high",
    urgency: "today",
    confidence: 84,
    financialExposure: 1255,
    tags: ["corporate", "group-rate", "account"],
    suggestedApproveReason: "BCG is a Tier 1 target account — 18% to land a £42k ARR account is well within acquisition cost tolerance.",
    suggestedDenyReason: "Counter-offered 16% with a free private meeting room for all 3 days — €600 value add without the full rate discount.",
  },
  {
    id: "demo-8",
    cardType: "operational_exception",
    agentId: "housekeeping-agent",
    agentLabel: "Housekeeping Agent",
    agentIcon: "🧹",
    roleBand: "ambassador",
    property: "citizenM Rotterdam",
    guestRef: "RES-00677 · C. Bergström · checking in 15:00",
    context: "Room 308 failed departure inspection at 13:45 — previous guest left significant room damage (broken mirror, stained linens, scuff marks on MoodPad). Repair crew estimate: 3hrs. Guest arrival in 75 minutes.",
    policyClause: "Housekeeping-Policy.AGENTS.md §8.2 — Room damage repairs blocking an incoming reservation require ambassador to either: (a) arrange complimentary upgrade, or (b) contact incoming guest for delay, or (c) escalate to GM for involuntary walk.",
    proposed: "Upgrade C. Bergström to Room 412 (superior floor, city view — same rate, no uplift charge). Guest has not yet been notified.",
    reason: "Room 412 is available (departure at 10:00, housekeeping completed 12:30). Rate parity maintained — guest pays same price. City view is an objective improvement. Alternative: wait 3hrs, but guest confirmed by-train arrival — no buffer for delay. Damage repair cost will be charged to departing guest's card as per Apaleo damage policy.",
    impact: "No revenue impact · Smooth arrival for incoming guest · Departure guest damage charge: £95 (separate process)",
    riskLevel: "low",
    urgency: "now",
    confidence: 94,
    financialExposure: 0,
    tags: ["housekeeping", "damage", "upgrade"],
    suggestedApproveReason: "Same rate, better room, no cost to us — approve it and drop a message to the guest about the city view.",
    suggestedDenyReason: "Decided to wait for the repair — guest was happy to delay 45min and the original room was ready by 15:50.",
  },
  {
    id: "demo-9",
    cardType: "compliance_flag",
    agentId: "witness-agent",
    agentLabel: "Witness Agent",
    agentIcon: "🧾",
    roleBand: "hotel_gm",
    property: "citizenM London Shoreditch",
    guestRef: "AUDIT-2026-Q2 · EU AI Act Article 17 Review",
    context: "Quarterly AI Act Article 17 compliance self-assessment. Witness Agent detected 3 agent actions in the past 30 days that were logged as 'auto-approved' but do not have a corresponding HITL record or baseline authorisation on file.",
    policyClause: "EU-AI-Act.AGENTS.md §Article 17(1)(d) — High-risk AI systems must maintain complete logs of human oversight decisions. Gaps in HITL records constitute a compliance incident requiring GM acknowledgment within 72hrs.",
    proposed: "Acknowledge the 3 logging gaps and confirm retroactive review. Witness Agent will generate a corrected audit trail and flag for CISO quarterly report.",
    reason: "Gaps identified: (1) Rate-Agent on 12 May — auto-approved a 12% walk-in discount with no prior baseline on file. (2) Check-in-Agent on 19 May — late checkout approved outside of authorised hours with no HITL record. (3) Folio-Agent on 28 May — mini-bar adjustment of £28 auto-processed. None exceed individual thresholds but together represent a pattern that EU AI Act requires acknowledgment of.",
    impact: "Regulatory risk: medium · CISO report due July 31 · Corrective record takes 4min to complete",
    riskLevel: "medium",
    urgency: "today",
    confidence: 99,
    financialExposure: 0,
    tags: ["compliance", "eu-ai-act", "audit"],
    suggestedApproveReason: "Acknowledged — these were edge cases during the Q1 rollout. Retroactive review complete, CISO report updated.",
    suggestedDenyReason: "Escalating to CISO directly for formal review before acknowledging — want full legal review first.",
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

const CARD_TYPE_LABEL = {
  approval:             { label: "Approval",            color: "#f59e0b" },
  operational_exception:{ label: "Op. Exception",       color: "#f97316" },
  compliance_flag:      { label: "Compliance Flag",     color: "#a855f7" },
};

// ─── Role options ─────────────────────────────────────────────────────────────
const ROLES = [
  { id: "ambassador", label: "Ambassador" },
  { id: "hotel_gm",   label: "Hotel GM" },
];

// ─── Main component ────────────────────────────────────────────────────────────
export default function HITLDemo({ companyId, companyName }) {
  const [activeRole, setActiveRole] = useState("ambassador");
  const [cards]     = useState(SAMPLE_CARDS);
  const [decisions, setDecisions] = useState([]);
  const [activeCard, setActiveCard] = useState(null);
  const [reasonText, setReasonText] = useState("");
  const [escalateTarget, setEscalateTarget] = useState("hotel_gm");
  const [baselineConfirm, setBaselineConfirm] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);
  const [filter, setFilter] = useState("pending");
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
    const params = new URLSearchParams({ role_band: activeRole, company_id: String(companyId) });
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
          confidence: null,
          financialExposure: null,
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
    if (id.includes("fraud")) return "🔍";
    if (id.includes("house")) return "🧹";
    if (id.includes("witness")) return "🧾";
    return "🤖";
  };

  // Visible demo cards filtered by role
  const roleFiltered = cards.filter(c =>
    activeRole === "ambassador" ? c.roleBand === "ambassador" : true
  );

  const pending  = roleFiltered.filter(c => !decisions.find(d => d.id === c.id));
  const resolved = roleFiltered.filter(c =>  decisions.find(d => d.id === c.id));

  const combined = showLive
    ? [...(filter === "pending" || filter === "all" ? [...pending, ...liveCards] : []),
       ...(filter === "resolved" || filter === "all" ? resolved : [])]
    : filter === "pending" ? pending : filter === "resolved" ? resolved : roleFiltered;

  // Financial exposure totals
  const pendingExposure = pending
    .filter(c => c.financialExposure != null && c.financialExposure > 0)
    .reduce((s, c) => s + c.financialExposure, 0);

  const openCard = (card) => {
    setActiveCard(card);
    setReasonText("");
    setBaselineConfirm(false);
    setEscalateTarget(activeRole === "ambassador" ? "hotel_gm" : "operations_chief");
  };

  const decide = (action, card = activeCard) => {
    if (!card) return;
    if (card.isLive && card.id) {
      const body = { outcome: action === "approve" ? "approved" : action === "deny" ? "rejected" : "acknowledged", reason: reasonText, decided_by: `${activeRole} (demo)` };
      fetch(`/api/hitl/respond/${card.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
    }
    setDecisions(p => [...p, { id: card.id, action, reason: reasonText || null, ts: new Date(), card }]);
    setActiveCard(null);
    setReasonText("");
    setBaselineConfirm(false);
    const msgs = { approve: ["Approved ✓", T.green], deny: ["Declined ✗", T.red], escalate: ["Escalated ↑", T.amber], baseline: ["Set as baseline ✦", T.purple] };
    toast(msgs[action][0], msgs[action][1]);
  };

  const resetDemo = () => {
    setDecisions([]);
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

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ background: T.bg, minHeight: "100vh", maxWidth: 520, margin: "0 auto", fontFamily: T.sans, position: "relative" }}>

      {/* Toast */}
      {toastMsg && (
        <div style={{
          position: "fixed", top: 68, left: "50%", transform: "translateX(-50%)",
          background: "#1a1d22", border: `1px solid ${toastMsg.color}50`,
          color: toastMsg.color, padding: "10px 22px", borderRadius: 100,
          fontSize: 13, fontWeight: 700, zIndex: 9999, pointerEvents: "none",
          boxShadow: `0 4px 24px ${toastMsg.color}30`,
          animation: "fadeInUp 0.2s ease", whiteSpace: "nowrap",
        }}>
          {toastMsg.msg}
        </div>
      )}

      {/* ── Sticky header ───────────────────────────────────────────────────── */}
      <div style={{ background: "#070809", borderBottom: `1px solid ${T.border}`, padding: "14px 18px 0", position: "sticky", top: 0, zIndex: 50 }}>

        {/* Title row */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 10, fontFamily: T.mono, color: T.muted, letterSpacing: "0.1em", marginBottom: 2 }}>
              HUMAN-IN-THE-LOOP · {companyName || "citizenM"}
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.03em", color: T.text, display: "flex", alignItems: "center", gap: 8 }}>
              Decision Queue
              {pendingCount > 0 && (
                <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, background: "#ef4444", borderRadius: "50%", fontSize: 11, fontWeight: 900, color: "#fff" }}>{pendingCount}</span>
              )}
            </div>
          </div>
          <button onClick={resetDemo} style={{ background: "none", border: `1px solid ${T.border}`, color: T.muted, padding: "5px 12px", borderRadius: 20, fontSize: 11, fontFamily: T.mono, cursor: "pointer", flexShrink: 0, marginTop: 4 }}>
            ↺ Reset
          </button>
        </div>

        {/* Stats banner — exposure + resolved count */}
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <StatPill
            label="EXPOSURE"
            value={pendingExposure > 0 ? `€${pendingExposure >= 1000 ? (pendingExposure/1000).toFixed(1)+"k" : pendingExposure.toFixed(0)}` : "—"}
            color={pendingExposure > 1000 ? T.red : pendingExposure > 200 ? T.amber : T.dim}
          />
          <StatPill label="PENDING"   value={String(pendingCount)}      color={pendingCount > 0 ? T.orange : T.green} />
          <StatPill label="RESOLVED"  value={String(decisions.length)}   color={decisions.length > 0 ? T.green : T.dim} />
          <StatPill label="HIGH RISK" value={String(pending.filter(c => c.riskLevel === "high").length)} color={T.red} />
        </div>

        {/* Role pills */}
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          {ROLES.map(r => (
            <button key={r.id} onClick={() => setActiveRole(r.id)} style={{
              background: activeRole === r.id ? "rgba(249,115,22,0.12)" : T.card,
              border: `1px solid ${activeRole === r.id ? "rgba(249,115,22,0.4)" : T.border}`,
              color: activeRole === r.id ? T.orange : T.dim,
              padding: "5px 14px", borderRadius: 20, fontSize: 12, fontFamily: T.sans,
              fontWeight: activeRole === r.id ? 700 : 400, cursor: "pointer", transition: "all 0.15s",
            }}>{r.label}</button>
          ))}
          {companyId && (
            <button onClick={() => setShowLive(o => !o)} style={{
              background: showLive ? "rgba(59,130,246,0.12)" : T.card,
              border: `1px solid ${showLive ? "rgba(59,130,246,0.4)" : T.border}`,
              color: showLive ? T.blue : T.dim,
              padding: "5px 14px", borderRadius: 20, fontSize: 12, fontFamily: T.sans,
              fontWeight: showLive ? 700 : 400, cursor: "pointer", marginLeft: "auto",
            }}>{liveLoading ? "…" : showLive ? "● Live" : "○ Live"}</button>
          )}
        </div>

        {/* Filter tabs */}
        <div style={{ display: "flex", gap: 0, borderBottom: `1px solid ${T.border}` }}>
          {[
            { id: "pending",  label: `Pending (${pendingCount})` },
            { id: "resolved", label: `Resolved (${decisions.length})` },
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

      {/* ── Card list ────────────────────────────────────────────────────────── */}
      <div style={{ padding: "14px 14px 100px" }}>
        {filter === "pending" && combined.length === 0 && (
          <div style={{ textAlign: "center", padding: "48px 24px", color: T.muted }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: T.dim, marginBottom: 6 }}>Queue clear</div>
            <div style={{ fontSize: 13, color: T.muted }}>All decisions resolved for this role.</div>
            <button onClick={resetDemo} style={{ marginTop: 20, background: "rgba(249,115,22,0.1)", border: "1px solid rgba(249,115,22,0.3)", color: T.orange, padding: "8px 20px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontFamily: T.sans, fontWeight: 700 }}>
              ↺ Reset for demo
            </button>
          </div>
        )}

        {combined.map(card => {
          const decision = decisionFor(card.id);
          const risk     = RISK[card.riskLevel] || RISK.medium;
          const urg      = URGENCY[card.urgency] || URGENCY.today;
          const ac       = decision ? ACTION_COLORS[decision.action] : null;
          const ctLabel  = CARD_TYPE_LABEL[card.cardType];

          return (
            <div
              key={card.id}
              onClick={() => !decision && openCard(card)}
              style={{
                background: ac ? ac.bg : T.card,
                border: `1px solid ${ac ? ac.border : T.border}`,
                borderRadius: 16, padding: "16px", marginBottom: 12,
                cursor: decision ? "default" : "pointer",
                transition: "all 0.18s", opacity: decision ? 0.7 : 1,
                position: "relative", overflow: "hidden",
              }}
            >
              {/* Decision ribbon */}
              {decision && (
                <div style={{ position: "absolute", top: 0, right: 0, background: ac.border, padding: "3px 12px", borderBottomLeftRadius: 10, fontSize: 10, fontFamily: T.mono, fontWeight: 700, color: ac.text, letterSpacing: "0.08em" }}>
                  {decision.action.toUpperCase()}
                </div>
              )}

              {/* Card header */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: T.surface, border: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>
                  {card.agentIcon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{card.agentLabel}</span>
                    {card.isLive && <span style={{ fontSize: 9, fontFamily: T.mono, color: T.blue, background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.3)", borderRadius: 4, padding: "1px 5px", letterSpacing: "0.06em" }}>LIVE</span>}
                    {ctLabel && !card.isLive && (
                      <span style={{ fontSize: 9, fontFamily: T.mono, color: ctLabel.color, background: `${ctLabel.color}15`, border: `1px solid ${ctLabel.color}30`, borderRadius: 4, padding: "1px 5px", letterSpacing: "0.05em" }}>
                        {ctLabel.label.toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: T.muted, fontFamily: T.mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {card.property ? `${card.property} · ` : ""}{card.guestRef}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end", flexShrink: 0 }}>
                  <span style={{ fontSize: 9, fontFamily: T.mono, fontWeight: 700, background: risk.bg, border: `1px solid ${risk.border}`, color: risk.text, borderRadius: 4, padding: "2px 6px", letterSpacing: "0.06em" }}>
                    {risk.label}
                  </span>
                  {!decision && <span style={{ fontSize: 9, fontFamily: T.mono, fontWeight: 700, color: urg.color }}>{urg.label}</span>}
                  {card.confidence != null && (
                    <span style={{ fontSize: 9, fontFamily: T.mono, color: card.confidence >= 85 ? T.green : card.confidence >= 65 ? T.amber : T.red }}>
                      {card.confidence}% conf.
                    </span>
                  )}
                </div>
              </div>

              {/* Proposed action */}
              <div style={{ background: T.surface, borderRadius: 10, padding: "10px 12px", marginBottom: 8, borderLeft: `3px solid ${decision ? ac.border : T.amber}` }}>
                <div style={{ fontSize: 10, fontFamily: T.mono, color: T.muted, marginBottom: 4, letterSpacing: "0.06em" }}>AGENT REQUESTS</div>
                <div style={{ fontSize: 13, color: T.text, lineHeight: 1.4, fontWeight: 500 }}>{card.proposed}</div>
              </div>

              {/* Context */}
              <div style={{ fontSize: 12, color: T.dim, lineHeight: 1.5, marginBottom: 8 }}>{card.context}</div>

              {/* Impact + financial exposure */}
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 10, fontFamily: T.mono, color: T.muted }}>IMPACT</span>
                  <span style={{ fontSize: 11, color: T.dim }}>{card.impact}</span>
                </div>
                {card.financialExposure > 0 && (
                  <span style={{ fontSize: 11, fontFamily: T.mono, fontWeight: 700, color: card.financialExposure >= 1000 ? T.red : T.amber, flexShrink: 0 }}>
                    €{card.financialExposure >= 1000 ? (card.financialExposure/1000).toFixed(1)+"k" : card.financialExposure.toFixed(0)}
                  </span>
                )}
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
                  {decision.reason && <div style={{ fontSize: 11, color: T.dim, marginTop: 3 }}>"{decision.reason}"</div>}
                </div>
              )}

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
        <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", flexDirection: "column" }}>
          <div onClick={() => setActiveCard(null)} style={{ flex: 1, background: "rgba(0,0,0,0.72)", backdropFilter: "blur(4px)" }} />

          <div style={{ background: "#0d0f13", borderTop: `1px solid ${T.borderHi}`, borderRadius: "24px 24px 0 0", padding: "0 0 env(safe-area-inset-bottom,24px)", maxHeight: "92vh", overflowY: "auto" }}>
            <div style={{ padding: "12px 0 0", display: "flex", justifyContent: "center" }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: T.borderHi }} />
            </div>

            <div style={{ padding: "12px 20px 28px" }}>
              {/* Agent header */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <div style={{ width: 48, height: 48, borderRadius: 14, background: T.surface, border: `1px solid ${T.borderHi}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>
                  {activeCard.agentIcon}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: T.text }}>{activeCard.agentLabel}</div>
                  <div style={{ fontSize: 11, color: T.muted, fontFamily: T.mono }}>{activeCard.guestRef}</div>
                  {activeCard.property && (
                    <div style={{ fontSize: 11, color: T.dim, marginTop: 1 }}>{activeCard.property}</div>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: "flex-end" }}>
                  <span style={{ fontSize: 9, fontFamily: T.mono, fontWeight: 700, letterSpacing: "0.06em", background: RISK[activeCard.riskLevel]?.bg, border: `1px solid ${RISK[activeCard.riskLevel]?.border}`, color: RISK[activeCard.riskLevel]?.text, borderRadius: 5, padding: "3px 8px" }}>
                    {RISK[activeCard.riskLevel]?.label}
                  </span>
                  {activeCard.confidence != null && (
                    <span style={{ fontSize: 10, fontFamily: T.mono, color: activeCard.confidence >= 85 ? T.green : activeCard.confidence >= 65 ? T.amber : T.red }}>
                      {activeCard.confidence}% confidence
                    </span>
                  )}
                </div>
              </div>

              <Section title="AGENT REQUESTS">
                <div style={{ fontSize: 15, fontWeight: 600, color: T.text, lineHeight: 1.5 }}>{activeCard.proposed}</div>
              </Section>

              <Section title="AGENT'S REASONING">
                <div style={{ fontSize: 13, color: T.dim, lineHeight: 1.6 }}>{activeCard.reason}</div>
              </Section>

              <Section title="POLICY RULE TRIGGERED">
                <div style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)", borderLeft: `3px solid ${T.amber}`, borderRadius: 8, padding: "10px 12px" }}>
                  <div style={{ fontSize: 11, fontFamily: T.mono, color: T.dim, lineHeight: 1.6 }}>{activeCard.policyClause}</div>
                </div>
              </Section>

              <Section title="IMPACT">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: 13, color: T.dim, lineHeight: 1.5, flex: 1 }}>{activeCard.impact}</div>
                  {activeCard.financialExposure > 0 && (
                    <div style={{ marginLeft: 14, textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 10, fontFamily: T.mono, color: T.muted, marginBottom: 2 }}>EXPOSURE</div>
                      <div style={{ fontSize: 18, fontWeight: 800, fontFamily: T.mono, color: activeCard.financialExposure >= 1000 ? T.red : T.amber }}>
                        €{activeCard.financialExposure >= 1000 ? (activeCard.financialExposure/1000).toFixed(1)+"k" : activeCard.financialExposure.toFixed(0)}
                      </div>
                    </div>
                  )}
                </div>
              </Section>

              {/* Reason input with suggested reasons */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, fontFamily: T.mono, color: T.muted, letterSpacing: "0.07em", marginBottom: 6 }}>
                  YOUR REASON <span style={{ color: "#4b5563" }}>(optional — logged to Witness Agent)</span>
                </div>
                <textarea
                  value={reasonText}
                  onChange={e => setReasonText(e.target.value)}
                  placeholder="Enter your rationale…"
                  rows={2}
                  style={{ width: "100%", boxSizing: "border-box", background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: "10px 12px", color: T.text, fontSize: 13, fontFamily: T.sans, resize: "none", outline: "none", lineHeight: 1.5 }}
                />
                {/* Suggested reasons */}
                {(activeCard.suggestedApproveReason || activeCard.suggestedDenyReason) && (
                  <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 5 }}>
                    <div style={{ fontSize: 10, fontFamily: T.mono, color: T.muted, letterSpacing: "0.06em" }}>QUICK REASONS</div>
                    {activeCard.suggestedApproveReason && (
                      <button onClick={() => setReasonText(activeCard.suggestedApproveReason)} style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: 8, padding: "7px 10px", color: T.dim, fontSize: 11, fontFamily: T.sans, cursor: "pointer", textAlign: "left", lineHeight: 1.4 }}>
                        <span style={{ color: T.green, fontWeight: 700, marginRight: 5 }}>✓</span>{activeCard.suggestedApproveReason}
                      </button>
                    )}
                    {activeCard.suggestedDenyReason && (
                      <button onClick={() => setReasonText(activeCard.suggestedDenyReason)} style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 8, padding: "7px 10px", color: T.dim, fontSize: 11, fontFamily: T.sans, cursor: "pointer", textAlign: "left", lineHeight: 1.4 }}>
                        <span style={{ color: T.red, fontWeight: 700, marginRight: 5 }}>✗</span>{activeCard.suggestedDenyReason}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Escalation target */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 10, fontFamily: T.mono, color: T.muted, letterSpacing: "0.07em", marginBottom: 6 }}>ESCALATE TO</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {[
                    { id: "hotel_gm",          label: "Hotel GM" },
                    { id: "regional_gm",       label: "Regional GM" },
                    { id: "operations_chief",  label: "Operations Chief" },
                    { id: "compliance_officer", label: "CISO" },
                  ].filter(t => t.id !== activeRole).map(t => (
                    <button key={t.id} onClick={() => setEscalateTarget(t.id)} style={{ background: escalateTarget === t.id ? "rgba(245,158,11,0.1)" : T.surface, border: `1px solid ${escalateTarget === t.id ? "rgba(245,158,11,0.4)" : T.border}`, color: escalateTarget === t.id ? T.amber : T.dim, padding: "5px 12px", borderRadius: 8, fontSize: 12, fontFamily: T.sans, cursor: "pointer", fontWeight: escalateTarget === t.id ? 700 : 400 }}>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Baseline confirm */}
              {baselineConfirm && (
                <div style={{ background: "rgba(168,85,247,0.07)", border: "1px solid rgba(168,85,247,0.25)", borderRadius: 12, padding: "12px 14px", marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.purple, marginBottom: 6 }}>✦ Confirm: Set as baseline</div>
                  <div style={{ fontSize: 12, color: T.dim, lineHeight: 1.5, marginBottom: 10 }}>
                    This tells the agent it can perform this type of action autonomously going forward — without asking for approval each time. The Witness Agent will log this permanently.
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => decide("baseline")} style={{ flex: 1, background: "rgba(168,85,247,0.12)", border: "1px solid rgba(168,85,247,0.4)", color: T.purple, padding: "10px 0", borderRadius: 10, fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: T.sans }}>
                      Confirm Baseline ✦
                    </button>
                    <button onClick={() => setBaselineConfirm(false)} style={{ background: T.surface, border: `1px solid ${T.border}`, color: T.muted, padding: "10px 14px", borderRadius: 10, fontSize: 13, cursor: "pointer" }}>Cancel</button>
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                <ActionBtn label="✓  Approve" bg="rgba(34,197,94,0.12)" border="rgba(34,197,94,0.5)" color={T.green} onClick={() => decide("approve")} />
                <ActionBtn label="✗  Deny"    bg="rgba(239,68,68,0.12)" border="rgba(239,68,68,0.5)" color={T.red}   onClick={() => decide("deny")} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <ActionBtn
                  label={`↑ Escalate to ${[{id:"hotel_gm",label:"Hotel GM"},{id:"regional_gm",label:"Regional GM"},{id:"operations_chief",label:"Ops Chief"},{id:"compliance_officer",label:"CISO"}].find(r => r.id === escalateTarget)?.label || escalateTarget}`}
                  bg="rgba(245,158,11,0.1)" border="rgba(245,158,11,0.4)" color={T.amber}
                  onClick={() => decide("escalate")} small
                />
                <ActionBtn label="✦ Set baseline" bg="rgba(168,85,247,0.08)" border="rgba(168,85,247,0.3)" color={T.purple} onClick={() => setBaselineConfirm(true)} small />
              </div>

              <button onClick={() => setActiveCard(null)} style={{ width: "100%", marginTop: 14, background: "none", border: `1px solid ${T.border}`, color: T.muted, padding: "10px 0", borderRadius: 10, fontSize: 13, cursor: "pointer", fontFamily: T.sans }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Decision log ─────────────────────────────────────────────────────── */}
      {filter === "resolved" && decisions.length > 0 && (
        <div style={{ padding: "0 14px 24px" }}>
          <div style={{ fontSize: 10, fontFamily: T.mono, color: T.muted, letterSpacing: "0.1em", marginBottom: 12 }}>
            DECISION LOG — {decisions.length} RESOLVED
          </div>
          {decisions.slice().reverse().map(d => {
            const ac = ACTION_COLORS[d.action];
            return (
              <div key={d.id + d.ts} style={{ background: ac.bg, border: `1px solid ${ac.border}`, borderRadius: 12, padding: "12px 14px", marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: ac.text }}>
                    {d.action === "approve" ? "✓ Approved" : d.action === "deny" ? "✗ Denied" : d.action === "escalate" ? "↑ Escalated" : "✦ Baselined"}
                  </span>
                  <span style={{ fontSize: 11, fontFamily: T.mono, color: T.muted }}>{d.ts.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
                <div style={{ fontSize: 12, color: T.text, fontWeight: 600, marginBottom: 2 }}>{d.card.agentLabel} · {d.card.guestRef}</div>
                <div style={{ fontSize: 11, color: T.dim }}>{d.card.proposed.slice(0, 100)}{d.card.proposed.length > 100 ? "…" : ""}</div>
                {d.reason && <div style={{ fontSize: 11, color: T.muted, marginTop: 4, fontStyle: "italic" }}>"{d.reason}"</div>}
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

function StatPill({ label, value, color }) {
  return (
    <div style={{ flex: 1, background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: "6px 10px", textAlign: "center" }}>
      <div style={{ fontSize: 9, fontFamily: T.mono, color: T.muted, letterSpacing: "0.08em", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 800, fontFamily: T.mono, color }}>{value}</div>
    </div>
  );
}

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
        background: hover ? bg.replace("0.12","0.2").replace("0.1","0.18").replace("0.08","0.15") : bg,
        border: `1px solid ${border}`, color,
        padding: small ? "11px 8px" : "14px 8px", borderRadius: 12,
        fontSize: small ? 12 : 15, fontWeight: 700, cursor: "pointer",
        fontFamily: "'Outfit', sans-serif", transition: "all 0.15s",
        textAlign: "center", lineHeight: 1.3,
      }}
    >{label}</button>
  );
}
