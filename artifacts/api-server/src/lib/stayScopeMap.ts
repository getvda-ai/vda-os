/**
 * stayScopeMap.ts — the Apaleo authority surface each exception class sits in front of.
 *
 * This is the "scope intercept" data: for a given exception class, WHICH Apaleo OAuth
 * scope the HITL layer is gating, which REST endpoint that scope protects, and which
 * MCP tool the executor will call if a human approves.
 *
 * WHY IT LIVES HERE AND NOT IN THE CONSOLE. The console must not be able to claim a
 * scope the executor would not actually invoke — a scope panel that says
 * `folios.payment-with-charges` over a code path that calls `AmendReservation` is a
 * lie told in the most load-bearing place in the demo. `stayExecutor.pickToolAndArgs`
 * and this map are asserted to agree — see `assertExecutorAgreement()` in
 * stayExecutor.ts, which fails loudly if the tool named here is not the tool that class
 * actually routes to. The panel is a projection of the real write path, not a caption
 * placed over it.
 *
 * SCOPE ACCURACY. Every scope named below was verified present on the live citizenM
 * sandbox OAuth client (token introspection, 2026-08-30): reservations.manage,
 * reservations.force-manage, rates.manage, rateplans.read-corporate, folios.manage,
 * folios.payment-with-charges. Nothing here claims a scope the client does not hold.
 *
 * The AUTHORITY CHAIN is deliberately NOT here — it is read from
 * stay-agent.EXCEPTION_AUTHORITY.md at runtime (see buildAuthorityChain), because the
 * chain is governance, and governance is the thing this product refuses to hardcode.
 */
import type { ExceptionAuthority, ExceptionRule } from "./exceptionAuthorityReader.js";
import { bandForScope } from "./apaleoAuthority.js";

/** A demo scenario — one authority configuration of the same HITL harness. */
export interface StayScenario {
  key: string;
  name: string;
  icon: string;
  /** The exception class this scenario exercises. The harness keys off this. */
  exceptionClass: string;
  stage: "check_in" | "in_stay" | "check_out";
  /** Apaleo OAuth scope the HITL layer intercepts. null = governance layer only. */
  scope: string | null;
  /** Additional scope the action reads under, shown alongside the primary. */
  readScope?: string;
  /** The REST endpoint that scope protects — what would be called on approval. */
  endpoint: string | null;
  /** The Apaleo MCP tool the executor calls on approval. Must match stayExecutor. */
  tool: string | null;
  /** One line on what the agent is asking to do. */
  summary: string;
  /** How the presenter triggers it. Drives which control the demo drawer renders. */
  trigger: "early_checkout" | "discount_slider" | "charge_amount" | "force_manage" | "feature_toggle";
  /** Unit shown next to the autonomous threshold. */
  unit: string;
}

/**
 * The five scenarios. Each is the SAME harness — propose → evaluate against governance
 * → route past the ceiling → approve/deny/escalate/baseline → seal — with a different
 * authority configuration. That reuse is the whole architectural claim; keep these
 * uniform in shape so a reader can see that nothing scenario-specific exists in the
 * mechanism itself.
 */
export const STAY_SCENARIOS: StayScenario[] = [
  {
    key: "A",
    name: "Early checkout",
    icon: "⏏",
    exceptionClass: "early_checkout",
    stage: "check_out",
    scope: "reservations.manage",
    endpoint: "PATCH /booking/v1/reservations/{id}",
    tool: "AmendReservation",
    summary: "Guest departs before the booked departure date; the reservation is shortened and the folio recalculated.",
    trigger: "early_checkout",
    unit: "nights early",
  },
  {
    key: "B",
    name: "Rate override",
    icon: "%",
    exceptionClass: "rate_override",
    stage: "check_in",
    scope: "rates.manage",
    readScope: "rateplans.read-corporate",
    endpoint: "PUT /rateplan/v1/rate-plans/{id}/rates",
    tool: "UpdateRatePlanRates",
    summary: "Guest or corporate account requests a discount below the Best Available Rate.",
    trigger: "discount_slider",
    unit: "% below BAR",
  },
  {
    key: "C",
    name: "Folio charge",
    icon: "€",
    exceptionClass: "folio_post_charge",
    stage: "in_stay",
    scope: "folios.payment-with-charges",
    readScope: "folios.manage",
    endpoint: "POST /finance/v1/folios/{id}/charges",
    tool: "CreateFolioCharge",
    summary: "A charge is posted to an open guest folio above the front-line limit.",
    trigger: "charge_amount",
    unit: "EUR",
  },
  {
    key: "D",
    name: "Force-manage",
    icon: "⚠",
    exceptionClass: "force_manage_override",
    stage: "check_in",
    scope: "reservations.force-manage",
    endpoint: "POST /booking/v1/bookings (force)",
    tool: "AmendReservation",
    summary: "Book or amend outside rate-plan, availability or restriction rules. Never autonomous, at any phase.",
    trigger: "force_manage",
    unit: "restriction",
  },
  {
    key: "E",
    name: "Feature enablement",
    icon: "⚙",
    exceptionClass: "feature_enablement",
    stage: "in_stay",
    // No Apaleo scope by design. The harness is not an Apaleo wrapper — it gates any
    // authority boundary, including ones the property system knows nothing about.
    scope: null,
    endpoint: null,
    tool: null,
    summary: "Enable a new agent capability or governance rule in production. Governance layer only — no property-system call exists to intercept.",
    trigger: "feature_toggle",
    unit: "capability",
  },
];

export const SCENARIO_BY_CLASS: Record<string, StayScenario> = Object.fromEntries(
  STAY_SCENARIOS.map((s) => [s.exceptionClass, s]),
) as Record<string, StayScenario>;

export function scenarioForClass(exceptionClass: string | null | undefined): StayScenario | null {
  return (exceptionClass && SCENARIO_BY_CLASS[exceptionClass]) || null;
}

/**
 * Apaleo's role names → the citizenM title that holds the same authority.
 *
 * BOTH names are always shown in the UI. The mapping is the artefact Apaleo needs to
 * see: it is what makes "our role model" and "your role model" the same conversation.
 */
export const CITIZENM_TITLE: Record<string, string> = {
  "Account Admin": "Operations Chief",
  "Property Admin": "Hotel GM",
  "Senior Reservation Manager": "Manager on Duty",
  "Revenue Manager": "Revenue Manager",
  Accountant: "Finance Controller",
};

/** The citizenM title for an internal role band, when no Apaleo role is named. */
export const BAND_TITLE: Record<string, string> = {
  ambassador: "Ambassador",
  mod: "Manager on Duty",
  compliance_officer: "Compliance Officer",
};

export interface ChainNode {
  /** Internal role band — this is what is written into the sealed evidence. */
  band: string;
  /** Apaleo role holding the equivalent authority, or null at the front line. */
  apaleoRole: string | null;
  /**
   * The Apaleo OAuth scope this rung acts under, verbatim from governance (v1.2).
   * Null means no property-system call exists to intercept — a governance-layer-only
   * rung, which must render as such rather than as an unnamed scope.
   */
  apaleoScope: string | null;
  /**
   * The band Apaleo's OWN role model puts that scope in, independent of the band
   * governance routed to. Equal in the ordinary case; different when governance has
   * delegated a slice of a higher role's scope down to the front line. Surfacing the
   * difference is the point — a delegation nobody can see is indistinguishable from
   * a permissions bug.
   */
  bandFromApaleoModel: string | null;
  /** citizenM title shown to the operator. */
  title: string;
  /** Ceiling for this class at this band, verbatim from governance. */
  ceiling: string | number | null;
  ceilingType: string | null;
  /** autonomous | hitl_required, verbatim from governance. */
  authority: string;
}

/**
 * Build the escalation chain for one exception class by WALKING `escalate_to` through
 * the governance file — the ladder is not hardcoded here, and adding a band to
 * EXCEPTION_AUTHORITY.md extends the chain with no code change.
 *
 * The walk is cycle-guarded and depth-capped: a governance file is human-authored and
 * an `escalate_to` loop must degrade to a short honest chain, never hang the console.
 */
export function buildAuthorityChain(
  authority: ExceptionAuthority | null,
  exceptionClass: string,
): ChainNode[] {
  if (!authority) return [];
  const findRule = (band: string): ExceptionRule | undefined =>
    authority.roleBands?.[band]?.exceptions?.find((e) => e.exception_class === exceptionClass);

  // Start at the lowest band that actually holds this class — a class with no
  // ambassador rule starts its chain at the MoD, which is exactly what "never
  // autonomous at the front line" looks like when drawn.
  const order = ["ambassador", "mod", "compliance_officer"];
  let band = order.find((b) => findRule(b));
  const nodes: ChainNode[] = [];
  const seen = new Set<string>();
  while (band && !seen.has(band) && nodes.length < 8) {
    seen.add(band);
    const rule = findRule(band);
    if (!rule) break;
    const apaleoRole = (rule as { apaleo_role?: string | null }).apaleo_role ?? null;
    const apaleoScope = (rule as { apaleo_scope?: string | null }).apaleo_scope ?? null;
    nodes.push({
      band,
      apaleoRole,
      apaleoScope,
      bandFromApaleoModel: bandForScope(apaleoScope),
      title: (apaleoRole && CITIZENM_TITLE[apaleoRole]) || BAND_TITLE[band] || band,
      ceiling: rule.ceiling ?? null,
      ceilingType: rule.ceiling_type ?? null,
      authority: rule.authority,
    });
    band = rule.escalate_to ?? undefined;
  }
  return nodes;
}

/**
 * Does any band hold this class autonomously? A class with no autonomous rule anywhere
 * can never auto-execute — not in Walk, and not in Run either. Scenarios D and E depend
 * on this being true rather than merely claimed.
 */
export function hasAutonomousBand(authority: ExceptionAuthority | null, exceptionClass: string): boolean {
  if (!authority) return false;
  return Object.values(authority.roleBands ?? {}).some((b) =>
    (b.exceptions ?? []).some((e) => e.exception_class === exceptionClass && e.authority === "autonomous"),
  );
}
