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

export interface StayDecisionResult {
  outcome: "PASS" | "FAIL" | "ESCALATE";
  stage: StayStage;
  exception_class: string;
  clause_applied: string;
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

  const resp = await callAIWithUsage({ max_tokens: 1024, system, messages: [{ role: "user", content: user }] });
  try {
    const m = resp.text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(m ? m[0] : resp.text) as Partial<LlmDecision>;
    return {
      decision: (parsed.decision as LlmDecision["decision"]) ?? "ESCALATE",
      clauseApplied: parsed.clauseApplied ?? "Unable to determine governing clause",
      sopRefs: Array.isArray(parsed.sopRefs) ? parsed.sopRefs : [],
      actionProposed: parsed.actionProposed ?? "Manual review",
      exceptionApplied: Boolean(parsed.exceptionApplied),
      escalationTarget: parsed.escalationTarget ?? null,
      reasoning: parsed.reasoning ?? resp.text.slice(0, 200),
      noSopCoverage: Boolean(parsed.noSopCoverage),
    };
  } catch {
    return {
      decision: "ESCALATE",
      clauseApplied: "Unable to parse agent response",
      sopRefs: [],
      actionProposed: "Manual review required",
      exceptionApplied: false,
      escalationTarget: "mod",
      reasoning: resp.text.slice(0, 200),
      noSopCoverage: false,
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
  const baseline = await matchBaseline({
    companyId,
    stage,
    exceptionClass,
    requestedValue: exceptionContext.requested_value,
    apaleoRef: input.apaleoRef,
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
  let outcome: StayDecisionResult["outcome"] = llm.decision;
  let routeBand: string;

  if (llm.decision === "FAIL") {
    outcome = "FAIL";
    routeBand = "ambassador";
  } else if (llm.decision === "ESCALATE" || hardEscalate) {
    outcome = "ESCALATE";
    routeBand = hardEscalate ? "compliance_officer" : withinAmb ? "ambassador" : withinMod ? "mod" : "compliance_officer";
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
  } catch (err) {
    logger.error({ err }, "[stayEngine] finalize (witness) failed");
  }
}
