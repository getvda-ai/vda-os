/**
 * stayDecisionEngine.ts — the Stay Agent's single, stage-aware decision engine
 * (check-in → in-stay → check-out). No hardcoded policy: every rule comes from
 * the stay-agent governance files, the ingested SOP clauses, and the AP2 mandate.
 *
 * Order of evaluation:
 *   1. Pre-flight   — 4 governance files present OR a valid AP2 mandate, else ESCALATE.
 *   2. Baseline     — a non-revoked, bounds-matching baseline auto-PASSes (phase-independent).  [wired in Phase 5]
 *   3. SOP coverage — load stage+global SOP clauses; none → ESCALATE(NO_SOP_COVERAGE).
 *   4. Authority    — resolve exception class → role band + ceiling from EXCEPTION_AUTHORITY.
 *   5. Live data    — snapshot the reservation/folio from Apaleo (DEMO-DATA fallback if empty).
 *   6. LLM judgment — governed PASS/FAIL/ESCALATE citing the verbatim policy clause + SOP refs.
 *   7. Phase gating — Crawl = all HITL; Walk = auto within ceiling; Run = auto within mandate.
 *   8. Witness      — immutable entry (+ role-routed HITL card on ESCALATE).
 */
import { db, sopClauses, agentPhases, hitlTokens } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { getGovernancePolicyFromFM } from "../routes/agents.js";
import { callAIWithUsage } from "../routes/ai-proxy.js";
import { getExceptionAuthority, type ExceptionRule } from "./exceptionAuthorityReader.js";
import { getActiveMandate } from "./mandateIssuer.js";
import { writeWitnessEntry, type AgentDecision } from "./witnessWriter.js";
import { apaleoFetch, buildQueryString } from "./apaleo.js";
import { matchBaseline } from "./stayBaselines.js";
import { executeStayAction } from "./stayExecutor.js";
import { hasAutonomousBand } from "./stayScopeMap.js";
import { enqueueSeal, buildSealBody, collectGuestPii } from "./sealOutbox.js";
import { stayChainKey } from "./witnessChain.js";
import { logger } from "./logger.js";

export type StayStage = "check_in" | "in_stay" | "check_out";
const VALID_STAGES: StayStage[] = ["check_in", "in_stay", "check_out"];

export interface StayExceptionContext {
  exception_class: string;
  description?: string;
  requested_value?: number;
  unit?: string;
  currency?: string;
  role_band?: string;
  [k: string]: unknown;
}

export interface StayApaleoRef {
  reservationId?: string;
  folioId?: string;
  propertyId?: string;
}

export interface StayDecisionInput {
  companyId: number;
  stage: StayStage;
  exceptionContext: StayExceptionContext;
  apaleoRef?: StayApaleoRef;
  actor?: string;
}

export interface CitedClause {
  anchor: string;
  heading: string;
  text: string;
}

export interface CeilingBand {
  band: string;
  ceiling: string | number | null;
  ceiling_type: string | null;
  requested_value: number | null;
  within_ceiling: boolean;
}

/**
 * The agent failed to produce a governed decision — a fault in US, not a governance
 * outcome. Kept separate from `clause_applied` so it can never be sealed as if the SOP
 * said it: an agent fault must not be able to impersonate a governing rule in permanent,
 * anchored Article-12 evidence.
 */
export interface AgentError {
  kind: "model_output_truncated" | "model_output_unparseable" | "model_output_empty";
  detail: string;
  stopReason: string | null;
}

export interface StayDecisionResult {
  outcome: "PASS" | "FAIL" | "ESCALATE";
  stage: StayStage;
  exception_class: string;
  clause_applied: string;
  /** Set only when the agent could not decide. Null on every genuine governed decision. */
  agent_error?: AgentError | null;
  files_consulted: string[];
  sop_refs: CitedClause[];
  apaleo_data: Record<string, unknown>;
  reasoning: string;
  ceiling_band: CeilingBand;
  phase: string;
  role_band: string | null;
  escalation_target: string | null;
  exception_applied: boolean;
  governance_source: "governance_files" | "mandate" | "baseline";
  no_sop_coverage: boolean;
  demo_data: boolean;
  proposed_action: string;
  witness_entry_id: number | null;
  hitl_token: string | null;
  baseline_id?: string | null;
  apaleo_ref?: StayApaleoRef;
  apaleo_execution?: unknown;
  apaleo_charge_id?: string | null;
  vda_witness?: unknown;
  /** Plain-language Apaleo action plan (e.g. for early check-out). */
  action_plan?: string[];
  /** Scenario details for the HITL card (guest/room/nights/folio delta). */
  scenario?: Record<string, unknown>;
  /** Scope qualifiers (rate_type/refundable/group) — carried so a baseline can pin them. */
  context_attrs?: Record<string, unknown>;
}

/** Plain-language, agent-generated Apaleo action plan for an early check-out. */
function buildEarlyCheckoutPlan(ctx: StayExceptionContext): string[] {
  const sc = (ctx.scenario ?? {}) as Record<string, unknown>;
  const booked = Number(sc.nights_booked ?? 0);
  const early = Number(sc.nights_early ?? ctx.requested_value ?? 0);
  const stayed = booked && early ? booked - early : undefined;
  const cur = String(sc.currency ?? ctx.currency ?? "EUR");
  const delta = sc.folio_delta;
  return [
    stayed ? `Shorten reservation to ${stayed} night(s) (was ${booked})` : `Shorten reservation by ${early} night(s)`,
    delta != null ? `Adjust folio ${delta} ${cur} for ${early} released night(s)` : `Recalculate folio for ${early} released night(s)`,
    `Release the room for the ${early} released night(s)`,
    `Notify housekeeping of the early departure`,
  ];
}

/**
 * Plain-language action plan per exception class — the "one governed step" the card
 * shows above the response buttons.
 *
 * These describe the INTENT of the action, in the operator's language. They are not a
 * transcript of the Apaleo call: the call itself, its scope and its endpoint are shown
 * separately in the scope-intercept panel, sourced from the executor's own result so the
 * two can never disagree. A class with no meaningful plan returns undefined and the card
 * simply omits the block, rather than rendering an empty list.
 */
function buildActionPlan(cls: string, ctx: StayExceptionContext): string[] | undefined {
  const sc = (ctx.scenario ?? {}) as Record<string, unknown>;
  const cur = String(sc.currency ?? ctx.currency ?? "EUR");
  const val = ctx.requested_value;
  switch (cls) {
    case "early_checkout":
      return buildEarlyCheckoutPlan(ctx);
    case "rate_override":
      return [
        `Apply a ${val ?? "?"}% discount below the Best Available Rate`,
        `Resolve the governing rate plan and BAR for the requested date range`,
        `Write the adjusted rate to the rate plan`,
        `Record the commercial rationale against the reservation`,
      ];
    case "folio_post_charge":
    case "damage_incidental_charge":
      return [
        `Post a ${cur} ${val ?? "?"} charge to the open guest folio`,
        `Confirm the folio is open for charges before posting`,
        `Record the charge reason in the evidence trail`,
      ];
    case "force_manage_override":
      return [
        `Override the blocking restriction: ${String(sc.restriction ?? ctx.description ?? "rate-plan / availability rule")}`,
        `Amend the reservation through the restriction under reservations.force-manage`,
        `Record the justification and the rule that was overridden`,
      ];
    case "feature_enablement":
      return [
        `Enable: ${String(sc.capability ?? ctx.description ?? "new agent capability")}`,
        `No property-system write — this changes what the agent may do, not a booking`,
        `Record the previous version so it can be reinstated`,
      ];
    default:
      return undefined;
  }
}

const BAND_ORDER = ["ambassador", "mod", "compliance_officer"] as const;
const AGENT_SLUG = "stay-agent";
const AGENT_NAME = "Stay Agent";

// ── Ceiling math ─────────────────────────────────────────────────────────────
function withinCeiling(value: number | undefined, rule: ExceptionRule | undefined): boolean {
  if (!rule) return false;
  const ct = rule.ceiling_type;
  if (rule.ceiling === null || rule.ceiling === undefined || ct === "none" || !ct) return true;
  const ceil = typeof rule.ceiling === "number" ? rule.ceiling : Number(rule.ceiling);
  if (Number.isNaN(ceil)) return true; // non-numeric ceiling (e.g. a clock time) — defer to the LLM
  if (typeof value !== "number" || Number.isNaN(value)) return false; // can't verify a numeric ceiling
  return value <= ceil;
}

function findRule(
  authority: Awaited<ReturnType<typeof getExceptionAuthority>>,
  band: string,
  cls: string,
): ExceptionRule | undefined {
  return authority?.roleBands?.[band]?.exceptions?.find((e) => e.exception_class === cls);
}

// ── SOP clause loading ───────────────────────────────────────────────────────
async function loadSopClauses(companyId: number, stage: StayStage): Promise<CitedClause[]> {
  const query = (cid: number) =>
    db
      .select({ anchor: sopClauses.anchor, heading: sopClauses.heading, text: sopClauses.text, stage: sopClauses.stage })
      .from(sopClauses)
      .where(and(eq(sopClauses.companyId, cid), inArray(sopClauses.stage, [stage, "global"])))
      .orderBy(sopClauses.stage, sopClauses.orderIndex);
  let rows = await query(companyId);
  if (rows.length === 0 && companyId !== 0) rows = await query(0);
  return rows.map((r) => ({ anchor: r.anchor, heading: r.heading, text: r.text }));
}

// ── Apaleo live snapshot (DEMO-DATA fallback when the sandbox is empty) ───────
async function fetchApaleoSnapshot(
  ref: StayApaleoRef | undefined,
): Promise<{ data: Record<string, unknown>; demo: boolean }> {
  if (!process.env.APALEO_CLIENT_ID || !process.env.APALEO_CLIENT_SECRET) {
    return { data: { note: "DEMO-DATA — Apaleo credentials not configured", ref }, demo: true };
  }
  const data: Record<string, unknown> = {};
  try {
    if (ref?.reservationId) {
      data.reservation = await apaleoFetch(`/booking/v1/reservations/${encodeURIComponent(ref.reservationId)}`);
    }
    if (ref?.folioId) {
      data.folio = await apaleoFetch(`/finance/v1/folios/${encodeURIComponent(ref.folioId)}`);
    } else if (ref?.reservationId) {
      const qs = buildQueryString({ reservationId: ref.reservationId });
      data.folios = await apaleoFetch(`/finance/v1/folios${qs}`);
    }
    if (Object.keys(data).length === 0) {
      return { data: { note: "DEMO-DATA — no apaleo_ref supplied", ref }, demo: true };
    }
    return { data, demo: false };
  } catch (err) {
    logger.warn({ err, ref }, "[stayEngine] Apaleo snapshot failed — using DEMO-DATA fallback");
    return { data: { note: "DEMO-DATA — Apaleo read failed", error: String(err), ref }, demo: true };
  }
}

// ── Phase lookup ─────────────────────────────────────────────────────────────
async function getStayPhase(companyId: number): Promise<string> {
  try {
    const [row] = await db
      .select({ phase: agentPhases.phase })
      .from(agentPhases)
      .where(and(eq(agentPhases.companyId, companyId), eq(agentPhases.agentId, AGENT_SLUG)))
      .limit(1);
    const phase = row?.phase;
    if (phase === "walk" || phase === "run" || phase === "crawl") return phase;
    return "crawl"; // not_activated / absent → most conservative
  } catch {
    return "crawl";
  }
}

// ── Role-routed HITL card ────────────────────────────────────────────────────
async function createStayHitlCard(params: {
  companyId: number;
  roleBand: string;
  phase: string;
  witnessEntryId: number;
  result: StayDecisionResult;
}): Promise<string | null> {
  try {
    const { companyId, roleBand, phase, witnessEntryId, result } = params;
    const [row] = await db
      .insert(hitlTokens)
      .values({
        cardType: "operational_exception",
        phase: 0,
        agentId: AGENT_SLUG,
        companyId,
        roleBand,
        witnessEntryId: String(witnessEntryId),
        payload: {
          type: "operational_exception",
          agent_name: AGENT_NAME,
          agent_id: AGENT_SLUG,
          company_id: companyId,
          current_phase: phase,
          stage: result.stage,
          exception_class: result.exception_class,
          decision: result.outcome,
          proposed_action: result.proposed_action,
          action_plan: result.action_plan ?? null,
          scenario: result.scenario ?? null,
          context_attrs: result.context_attrs ?? null,
          clause_applied: result.clause_applied,
          sop_refs: result.sop_refs,
          reasoning: result.reasoning,
          ceiling_band: result.ceiling_band,
          financial_exposure: result.ceiling_band.requested_value,
          currency: (result.apaleo_data?.folio as { currency?: string })?.currency ?? (result.apaleo_data?.currency as string) ?? "EUR",
          escalation_target: result.escalation_target,
          role_band: roleBand,
          apaleo_data: result.apaleo_data,
          apaleo_ref: result.apaleo_ref ?? null,
          witness_entry_id: witnessEntryId,
          no_sop_coverage: result.no_sop_coverage,
        },
        context: {
          agent_id: AGENT_SLUG,
          company_id: companyId,
          stage: result.stage,
          exception_class: result.exception_class,
          witness_entry_id: witnessEntryId,
        },
      })
      .returning({ token: hitlTokens.token });
    return row?.token ?? null;
  } catch (err) {
    logger.warn({ err }, "[stayEngine] Failed to create Stay HITL card");
    return null;
  }
}

// ── LLM governance judgment ──────────────────────────────────────────────────
interface LlmDecision {
  decision: "PASS" | "FAIL" | "ESCALATE";
  clauseApplied: string;
  sopRefs: string[];
  actionProposed: string;
  exceptionApplied: boolean;
  escalationTarget: string | null;
  reasoning: string;
  noSopCoverage: boolean;
  /** Set only when the agent could not decide — never on a real governed decision. */
  agentError?: AgentError | null;
}

/**
 * The model's answer shares the token budget with its own reasoning: Gemini bills thinking
 * tokens against max_tokens. At 2048 the reasoning consumed ~1962 of them and left ~80 for
 * the answer, so every decision came back as a JSON object cut off mid-string — parsed as
 * "unparseable", escalated, and sealed with a fabricated governing clause. The model was
 * right all along; the budget was not. 8192 leaves room for both (measured: ~1600 thinking
 * + ~150 answer), and a truncated answer is now retried once with double the budget rather
 * than being mistaken for nonsense.
 */
const DECISION_MAX_TOKENS = 8192;

/** Robustly extract the first balanced JSON object from an LLM response
 *  (handles ```json fences, leading/trailing prose, and braces inside strings). */
function extractJsonObject(text: string): string {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  if (start === -1) return cleaned;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return cleaned.slice(start, i + 1); }
  }
  return cleaned.slice(start); // unbalanced (truncated) — let JSON.parse throw
}

async function llmEvaluate(params: {
  policyText: string;
  clauses: CitedClause[];
  input: StayDecisionInput;
  ceiling: CeilingBand;
  snapshot: Record<string, unknown>;
}): Promise<LlmDecision> {
  const { policyText, clauses, input, ceiling, snapshot } = params;
  const clauseBlock = clauses
    .map((c) => `[${c.anchor}] ${c.heading}: ${c.text}`)
    .join("\n\n");

  const system = `You are the citizenM Stay Agent operating under the VDA-MD governance framework, deciding a ${input.stage.toUpperCase()} exception of class "${input.exceptionContext.exception_class}".

GOVERNING POLICY (the law — authority ceilings, MUST/MUST NOT):
${policyText}

BUSINESS SOP CLAUSES (the reason — you MUST justify your decision against these; cite the anchors you rely on in sop_refs):
${clauseBlock}

CEILING CONTEXT (from EXCEPTION_AUTHORITY): the request is being measured against the ${ceiling.band} band ceiling of ${ceiling.ceiling ?? "none"} (${ceiling.ceiling_type ?? "n/a"}); requested value = ${ceiling.requested_value ?? "n/a"}; within_ceiling = ${ceiling.within_ceiling}.

RULES:
- For "clauseApplied", copy the exact verbatim sentence/clause from the GOVERNING POLICY that governs this decision. Do not paraphrase.
- For "sopRefs", list the anchors (e.g. "late-check-out") of the SOP clause(s) that justify the action or the exception.
- If NONE of the SOP clauses cover this situation, you MUST set "noSopCoverage": true, "decision": "ESCALATE", "escalationTarget" to the appropriate band, and begin "reasoning" with "NO_SOP_COVERAGE". Never guess.
- Respect the ceiling: if within_ceiling is false you should not PASS autonomously — ESCALATE.
- Any chargeback-risk or fraud signal MUST ESCALATE.

Respond ONLY with this JSON (no extra text):
{
  "decision": "PASS" | "FAIL" | "ESCALATE",
  "clauseApplied": "<verbatim policy clause>",
  "sopRefs": ["<anchor>", ...],
  "actionProposed": "<the Apaleo action to take>",
  "exceptionApplied": true | false,
  "escalationTarget": "ambassador" | "mod" | "compliance_officer" | null,
  "reasoning": "<1-3 sentences citing the SOP and the live data>",
  "noSopCoverage": true | false
}`;

  const user = `Request context:\n${JSON.stringify(input.exceptionContext, null, 2)}\n\nLive Apaleo snapshot:\n${JSON.stringify(snapshot, null, 2)}`;

  let resp = await callAIWithUsage({ max_tokens: DECISION_MAX_TOKENS, system, messages: [{ role: "user", content: user }] });
  // A truncated answer is a BUDGET failure, not a bad answer. Retry once with more room
  // before giving up — silently escalating a decision the model was in the middle of
  // getting right is how a working agent looks broken.
  if (resp.stopReason === "max_tokens") {
    logger.warn({ stopReason: resp.stopReason, outputTokens: resp.outputTokens }, "[stayEngine] model answer truncated (thinking consumed the budget) — retrying with double");
    resp = await callAIWithUsage({ max_tokens: DECISION_MAX_TOKENS * 2, system, messages: [{ role: "user", content: user }] });
  }

  try {
    if (!resp.text.trim()) throw new Error("empty");
    const parsed = JSON.parse(extractJsonObject(resp.text)) as Partial<LlmDecision>;
    // reasoning must be the model's PROSE, never a raw completion dump. If the model
    // returned no reasoning field, mark it — do not fall back to the raw text (which
    // would carry ```json fences into a permanent, anchored record).
    const prose = typeof parsed.reasoning === "string" ? parsed.reasoning.trim() : "";
    if (!prose) logger.warn({ raw: resp.text.slice(0, 300) }, "[stayEngine] model output parsed but had no reasoning field — sealing a marker, not raw");
    return {
      decision: (parsed.decision as LlmDecision["decision"]) ?? "ESCALATE",
      clauseApplied: parsed.clauseApplied ?? "Unable to determine governing clause",
      sopRefs: Array.isArray(parsed.sopRefs) ? parsed.sopRefs : [],
      actionProposed: parsed.actionProposed ?? "Manual review",
      exceptionApplied: Boolean(parsed.exceptionApplied),
      escalationTarget: parsed.escalationTarget ?? null,
      reasoning: prose || "[model returned no reasoning field — routed to human review]",
      noSopCoverage: Boolean(parsed.noSopCoverage),
      agentError: null,
    };
  } catch {
    // The agent could not produce a governed decision. NEVER seal the raw blob, and never
    // dress the failure as a clause: "Unable to parse agent response" was being sealed as
    // governingRule.ruleText — the verbatim text of the SOP — so an agent fault impersonated
    // a governing rule in permanent, anchored evidence. It is reported as what it is: an
    // agent_error. The governed outcome is the FAIL-SAFE (escalate to a human), which is a
    // real rule and is cited as such at the seal.
    const kind = resp.stopReason === "max_tokens" ? "model_output_truncated" : !resp.text.trim() ? "model_output_empty" : "model_output_unparseable";
    logger.warn({ raw: resp.text.slice(0, 300), stopReason: resp.stopReason, kind }, "[stayEngine] no governed decision — escalating as an agent fault");
    return {
      decision: "ESCALATE",
      clauseApplied: "", // no clause was applied — do not invent one
      sopRefs: [],
      actionProposed: "Manual review required",
      exceptionApplied: false,
      escalationTarget: "mod",
      reasoning: "The Stay Agent could not produce a governed decision from the model output. No SOP clause was applied. Fail-safe: routed to human review.",
      noSopCoverage: false,
      agentError: { kind, detail: `model output ${kind.replace("model_output_", "")} (stop_reason=${resp.stopReason ?? "none"}, ${resp.outputTokens} output tokens)`, stopReason: resp.stopReason },
    };
  }
}

// ── Main entry ───────────────────────────────────────────────────────────────
export async function decideStay(input: StayDecisionInput): Promise<StayDecisionResult> {
  const { companyId, stage, exceptionContext } = input;
  const exceptionClass = exceptionContext.exception_class;

  // Skeleton result populated as we go.
  const base: StayDecisionResult = {
    outcome: "ESCALATE",
    stage,
    exception_class: exceptionClass,
    clause_applied: "",
    files_consulted: [],
    sop_refs: [],
    apaleo_data: {},
    reasoning: "",
    ceiling_band: { band: exceptionContext.role_band ?? "ambassador", ceiling: null, ceiling_type: null, requested_value: exceptionContext.requested_value ?? null, within_ceiling: false },
    phase: "crawl",
    role_band: null,
    escalation_target: null,
    exception_applied: false,
    governance_source: "governance_files",
    no_sop_coverage: false,
    demo_data: false,
    proposed_action: exceptionContext.description ?? `${stage} ${exceptionClass}`,
    witness_entry_id: null,
    hitl_token: null,
    baseline_id: null,
    apaleo_ref: input.apaleoRef,
    scenario: (exceptionContext.scenario as Record<string, unknown>) ?? undefined,
    context_attrs: { rate_type: exceptionContext.rate_type, refundable: exceptionContext.refundable, group: exceptionContext.group },
    action_plan: buildActionPlan(exceptionClass, exceptionContext),
  };

  if (!VALID_STAGES.includes(stage)) {
    base.reasoning = `Invalid stage "${stage}". Stay Agent handles only check_in, in_stay, check_out.`;
    return base;
  }

  const phase = await getStayPhase(companyId);
  base.phase = phase;

  // 1. Pre-flight — governance files OR a valid AP2 mandate.
  const gov = await getGovernancePolicyFromFM(companyId, "stay");
  let mandate: Awaited<ReturnType<typeof getActiveMandate>> = null;
  try {
    mandate = await getActiveMandate(AGENT_SLUG, companyId);
  } catch { /* mandate optional */ }
  const hasMandate = Boolean(mandate && !mandate.revoked);

  if (gov.mandatoryEscalate && !hasMandate) {
    base.outcome = "ESCALATE";
    base.clause_applied = "VDA-MD §2.1 — No governance file. All decisions suspended until AGENTS.md, SOP.md, and SKILL.md are present, or a valid AP2 mandate is issued.";
    base.reasoning = "Pre-flight failed: neither the four stay-agent governance files nor a valid AP2 mandate are present for this company. Hard ESCALATE to compliance.";
    base.escalation_target = "compliance_officer";
    base.role_band = "compliance_officer";
    base.governance_source = "governance_files";
    await finalize(base, { companyId, roleBand: "compliance_officer", phase, eventCategory: "preflight_governance_failure", fileReferenced: "VDA-MD §2.1 — No governance file" });
    return base;
  }
  base.governance_source = gov.mandatoryEscalate ? "mandate" : "governance_files";
  base.files_consulted = gov.filesLoaded;

  // 2. Baseline fast-path — a non-revoked, bounds-matching baseline auto-PASSes.
  const scopeContext: Record<string, unknown> = {
    rate_type: exceptionContext.rate_type,
    refundable: exceptionContext.refundable,
    group: exceptionContext.group,
  };
  const baseline = await matchBaseline({
    companyId,
    stage,
    exceptionClass,
    requestedValue: exceptionContext.requested_value,
    apaleoRef: input.apaleoRef,
    context: scopeContext,
  });
  if (baseline) {
    base.outcome = "PASS";
    base.governance_source = "baseline";
    base.baseline_id = baseline.id;
    base.clause_applied = `Baseline ${baseline.id} — "${baseline.exceptionClass}" authorised going forward within bounds ${JSON.stringify(baseline.bounds)} by ${baseline.authorisedBy ?? "a human reviewer"}.`;
    base.reasoning = `A non-revoked baseline matches this request (stage=${stage}, class=${exceptionClass}); auto-PASS without HITL per the approved bounds.`;
    base.role_band = baseline.roleBand ?? null;
    base.exception_applied = true;
    const snap = await fetchApaleoSnapshot(input.apaleoRef);
    base.apaleo_data = snap.data;
    base.demo_data = snap.demo;
    await finalize(base, { companyId, roleBand: baseline.roleBand ?? "ambassador", phase, eventCategory: "baseline_applied", fileReferenced: `baseline:${baseline.id}` });
    return base;
  }

  // 3. SOP coverage — no clauses for this stage → NO_SOP_COVERAGE.
  const clauses = await loadSopClauses(companyId, stage);
  if (clauses.length === 0) {
    const snap = await fetchApaleoSnapshot(input.apaleoRef);
    base.outcome = "ESCALATE";
    base.no_sop_coverage = true;
    base.apaleo_data = snap.data;
    base.demo_data = snap.demo;
    base.clause_applied = "Stay Agent SOP — If no procedure covers a situation, do not improvise; escalate for a human decision.";
    base.reasoning = "NO_SOP_COVERAGE — no ingested SOP clauses were found for this stage. Escalating to the Manager on Duty rather than guessing.";
    base.escalation_target = "mod";
    base.role_band = "mod";
    await finalize(base, { companyId, roleBand: "mod", phase, eventCategory: "no_sop_coverage", fileReferenced: "stay-agent.SOP.md" });
    return base;
  }

  // 4. Authority — resolve exception class → band + ceiling.
  const authority = await getExceptionAuthority(AGENT_SLUG, companyId);
  const ambRule = findRule(authority, "ambassador", exceptionClass);
  const modRule = findRule(authority, "mod", exceptionClass);
  const compRule = findRule(authority, "compliance_officer", exceptionClass);
  const val = exceptionContext.requested_value;
  const withinAmb = withinCeiling(val, ambRule);
  const withinMod = withinCeiling(val, modRule);
  const isComplianceClass = Boolean(compRule) && !ambRule && !modRule;

  const measuredRule = ambRule ?? modRule ?? compRule;
  const measuredBand = ambRule ? "ambassador" : modRule ? "mod" : "compliance_officer";
  const ceiling: CeilingBand = {
    band: measuredBand,
    ceiling: measuredRule?.ceiling ?? null,
    ceiling_type: measuredRule?.ceiling_type ?? null,
    requested_value: val ?? null,
    within_ceiling: isComplianceClass ? false : withinAmb || withinMod,
  };
  base.ceiling_band = ceiling;

  // 5. Live Apaleo snapshot.
  const snap = await fetchApaleoSnapshot(input.apaleoRef);
  base.apaleo_data = snap.data;
  base.demo_data = snap.demo;

  // 6. LLM governance judgment.
  const llm = await llmEvaluate({ policyText: gov.policyText, clauses, input, ceiling, snapshot: snap.data });
  base.clause_applied = llm.clauseApplied;
  base.agent_error = llm.agentError ?? null;
  base.reasoning = llm.reasoning;
  base.exception_applied = llm.exceptionApplied;
  base.proposed_action = llm.actionProposed;
  base.no_sop_coverage = llm.noSopCoverage;
  base.sop_refs = clauses.filter((c) => llm.sopRefs.includes(c.anchor));
  // If the model cited nothing usable, attach the stage clauses it was given for traceability.
  if (base.sop_refs.length === 0 && !llm.noSopCoverage) {
    base.sop_refs = clauses.filter((c) => c.anchor).slice(0, 2);
  }

  // 7. Phase gating + ceiling enforcement.
  const hardEscalate = isComplianceClass || exceptionClass === "chargeback_risk_flag" || exceptionClass === "policy_override";
  // A class no band holds with `authority: autonomous` can NEVER auto-execute — not in
  // Walk, and not in Run either, where the ceiling test alone would otherwise let a
  // null-ceiling hitl_required rule through as "within ceiling". Scenarios D
  // (force-manage) and E (feature enablement) declare "autonomous: never" on the card;
  // this is what makes that a property of the engine rather than a caption.
  //
  // Behaviourally inert for every pre-existing class: all of them hold an `autonomous`
  // ambassador rule, so `neverAutonomous` is false and this branch is not reached.
  const neverAutonomous = !hasAutonomousBand(authority, exceptionClass);
  const lowestBandHolding = ambRule ? "ambassador" : modRule ? "mod" : "compliance_officer";
  let outcome: StayDecisionResult["outcome"] = llm.decision;
  let routeBand: string;

  if (llm.decision === "FAIL") {
    outcome = "FAIL";
    routeBand = "ambassador";
  } else if (llm.decision === "ESCALATE" || hardEscalate) {
    outcome = "ESCALATE";
    routeBand = hardEscalate ? "compliance_officer" : withinAmb ? "ambassador" : withinMod ? "mod" : "compliance_officer";
  } else if (neverAutonomous) {
    // Route to the LOWEST band that actually holds the class — "always HITL" means a
    // named human decides, not that everything jumps to compliance.
    outcome = "ESCALATE";
    routeBand = lowestBandHolding;
    base.reasoning = `[${phase.toUpperCase()}] ${base.reasoning} No role band holds "${exceptionClass}" autonomously — this class requires a human decision at every phase, including Run.`;
  } else {
    // LLM says PASS — apply phase gating.
    if (phase === "crawl") {
      outcome = "ESCALATE";
      routeBand = withinAmb ? "ambassador" : withinMod ? "mod" : "compliance_officer";
      base.reasoning = `[CRAWL] ${base.reasoning} Every proposal is routed to HITL during the Crawl phase.`;
    } else if (phase === "walk") {
      if (withinAmb && ambRule?.authority === "autonomous") {
        outcome = "PASS";
        routeBand = "ambassador";
      } else {
        outcome = "ESCALATE";
        routeBand = withinMod ? "mod" : "compliance_officer";
        base.reasoning = `[WALK] ${base.reasoning} Above the autonomous ceiling — routed to HITL.`;
      }
    } else {
      // run — autonomous within the highest defined ceiling (mandate scope).
      if (withinAmb || withinMod) {
        outcome = "PASS";
        routeBand = withinAmb ? "ambassador" : "mod";
      } else {
        outcome = "ESCALATE";
        routeBand = "compliance_officer";
        base.reasoning = `[RUN] ${base.reasoning} Above mandate ceiling — routed to HITL.`;
      }
    }
  }

  base.outcome = outcome;
  base.escalation_target = outcome === "ESCALATE" ? (llm.escalationTarget ?? routeBand) : null;
  base.role_band = outcome === "ESCALATE" ? routeBand : outcome === "PASS" ? (withinAmb ? "ambassador" : "mod") : "ambassador";

  const eventCategory =
    outcome === "PASS" ? "governed_pass" : outcome === "FAIL" ? "governed_fail" : "governed_escalate";
  await finalize(base, { companyId, roleBand: routeBand, phase, eventCategory, fileReferenced: pickSopFile(gov.filesLoaded) });
  return base;
}

function pickSopFile(files: string[]): string {
  return files.find((f) => f.endsWith(".SOP.md")) ?? files[0] ?? "stay-agent.SOP.md";
}

// ── Witness write (+ HITL card on ESCALATE) ──────────────────────────────────
async function finalize(
  result: StayDecisionResult,
  opts: { companyId: number; roleBand: string; phase: string; eventCategory: string; fileReferenced: string },
): Promise<void> {
  // Autonomous PASS (baseline fast-path, or Walk/Run within ceiling) executes the
  // Apaleo write here — no HITL. A real write returns an id → charge_posted.
  let eventCategory = opts.eventCategory;
  if (result.outcome === "PASS") {
    const execPayload = {
      stage: result.stage,
      exception_class: result.exception_class,
      apaleo_data: result.apaleo_data,
      apaleo_ref: result.apaleo_ref,
      ceiling_band: result.ceiling_band,
      financial_exposure: result.ceiling_band.requested_value,
      currency: (result.apaleo_data?.folio as { currency?: string })?.currency ?? "EUR",
      proposed_action: result.proposed_action,
    };
    const execution = await executeStayAction(execPayload);
    result.apaleo_execution = execution;
    result.apaleo_charge_id = execution.apaleoId ?? null;
    if (execution.apaleoId) eventCategory = "charge_posted";
  }

  const decision: AgentDecision = {
    decision: result.outcome,
    clauseApplied: result.clause_applied,
    actionProposed: result.proposed_action,
    exceptionApplied: result.exception_applied,
    escalationTarget: result.escalation_target,
    reasoning: result.reasoning,
    exceptionClass: result.exception_class,
  };
  try {
    const witnessId = await writeWitnessEntry({
      companyId: opts.companyId,
      agent: AGENT_NAME,
      decision,
      fileReferenced: opts.fileReferenced,
      apaleoData: {
        ...result.apaleo_data,
        // EU AI Act Art.17 record-keeping metadata surfaced on every entry.
        art17: {
          stage: result.stage,
          exception_class: result.exception_class,
          ceiling_band: result.ceiling_band,
          governance_source: result.governance_source,
          phase: opts.phase,
          sop_refs: result.sop_refs.map((c) => c.anchor),
          role_band: opts.roleBand,
          no_sop_coverage: result.no_sop_coverage,
          demo_data: result.demo_data,
          apaleo_charge_id: result.apaleo_charge_id ?? null,
        },
        ...(result.apaleo_execution ? { apaleo_execution: result.apaleo_execution } : {}),
      },
      filesConsulted: result.files_consulted,
      eventCategory,
      mandateId: null,
      suppressAutoHitl: true, // we create our own role-routed card below
      skipC2pa: true, // evidence of record is the real VDA Witness seal, not internal C2PA
    });
    result.witness_entry_id = witnessId;

    if (result.outcome === "ESCALATE" && opts.companyId > 0) {
      result.hitl_token = await createStayHitlCard({
        companyId: opts.companyId,
        roleBand: opts.roleBand,
        phase: opts.phase,
        witnessEntryId: witnessId,
        result,
      });
    }

    // Enqueue the external seal into the durable, PII-minimized outbox. This is a
    // fast local write OFF the critical path — the decision (and any Apaleo write)
    // has already happened. A background drain seals to VDA Witness with retry, so
    // a Witness outage delays the seal, it never blocks or loses the operation.
    // Build the seal body through the single choke point: inputs minimized AND
    // every free-text field (reasoning/actionProposed/ruleText) PII-scrubbed,
    // using an exact denylist of guest identifiers pulled from the Apaleo data.
    const sealBody = buildSealBody({
      agent: AGENT_NAME,
      verdict: result.outcome,
      reasoning: result.reasoning,
      actionProposed: result.proposed_action,
      // PII-minimized decision FACTS — what the agent saw when it decided, so an
      // auditor reading get_record can reconstruct the decision. Pseudonymous ids +
      // facts only; buildSealBody's scrub still applies to every field.
      inputsRaw: {
        reservationId: result.apaleo_ref?.reservationId,
        folioId: result.apaleo_ref?.folioId,
        propertyId: result.apaleo_ref?.propertyId,
        stage: result.stage,
        exception_class: result.exception_class,
        amount: result.ceiling_band?.requested_value,
        requested_value: result.ceiling_band?.requested_value,
        ceiling_evaluated: result.ceiling_band?.ceiling,
        ceiling_type: result.ceiling_band?.ceiling_type,
        ceiling_band: result.ceiling_band?.band,
        within_ceiling: result.ceiling_band?.within_ceiling,
        currency: (result.apaleo_data?.folio as { currency?: string })?.currency,
        nights: (result.scenario as { nights_booked?: number } | undefined)?.nights_booked,
        governance_source: result.governance_source,
        phase: opts.phase,
        role_band: opts.roleBand,
        apaleo_charge_id: result.apaleo_charge_id ?? null,
        verdict: result.outcome,
        // An agent fault is sealed as a FACT ABOUT THE AGENT, never as governance.
        ...(result.agent_error ? { agent_error: result.agent_error.kind } : {}),
      },
      // The governing rule must be a rule that actually governed. When the agent could not
      // decide, no SOP clause was applied — sealing the failure text here published it as
      // the verbatim text of stay-agent.SOP.md, so the trail asserted the SOP said "Unable
      // to parse agent response". It never did. The rule that genuinely applied is the
      // fail-safe: an agent that cannot produce a governed decision escalates to a human.
      ruleId: result.agent_error ? `${opts.fileReferenced}#fail-safe` : opts.fileReferenced,
      ruleText: result.agent_error
        ? `FAIL-SAFE: the Stay Agent could not produce a governed decision (${result.agent_error.detail}). No SOP clause was applied; the request was escalated to a human (MoD). This record documents an agent fault, not a governance ruling.`
        : result.clause_applied,
      ruleRef: "stay-agent",
      piiDenylist: collectGuestPii(result.apaleo_data),
    });
    await enqueueSeal({
      companyId: opts.companyId,
      chainKey: stayChainKey(result.apaleo_ref?.propertyId, opts.companyId),
      decisionId: `stay-${opts.companyId}-${witnessId}`,
      decision: sealBody.decision,
      governingRule: sealBody.governingRule,
      localWitnessId: witnessId,
    });
  } catch (err) {
    logger.error({ err }, "[stayEngine] finalize (witness) failed");
  }
}
