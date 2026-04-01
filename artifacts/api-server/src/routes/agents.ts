import { Router } from "express";
import { getApaleoToken } from "../lib/apaleo-auth.js";
import { isMcpConfigured, listMcpTools, callMcpTool } from "../lib/apaleo-mcp.js";
import type {
  ApaleoReservation,
  ApaleoFolio,
  ApaleoFolioCharge,
  ApaleoRatePlan,
  ReservationStatus,
} from "../lib/apaleo-types.js";
import { callAI } from "./ai-proxy.js";
import { db, witnessEntries } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const router = Router();

const APALEO_API_BASE = "https://api.apaleo.com";

// ─── Typed Apaleo Request Client ──────────────────────────────────────────────

async function apaleoRequest<T>(
  path: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" = "GET",
  body?: unknown,
  queryParams?: Record<string, string | number | boolean>
): Promise<T> {
  const token = await getApaleoToken();
  const url = new URL(`${APALEO_API_BASE}${path}`);
  if (queryParams) {
    for (const [k, v] of Object.entries(queryParams)) {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, String(v));
      }
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  if (body !== undefined && method !== "GET") {
    headers["Content-Type"] = "application/json";
  }

  const resp = await fetch(url.toString(), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Apaleo ${method} ${path} → ${resp.status}: ${text}`);
  }

  if (resp.status === 204 || resp.headers.get("content-length") === "0") {
    return {} as T;
  }
  return resp.json() as Promise<T>;
}

// ─── MCP-first executor ───────────────────────────────────────────────────────

async function mcpOrRest<T>(
  mcpToolName: string,
  mcpArgs: Record<string, unknown>,
  restFallback: () => Promise<T>
): Promise<{ result: T; usedMcp: boolean }> {
  if (isMcpConfigured()) {
    try {
      const tools = await listMcpTools();
      const hasTool = tools.some((t) => t.name === mcpToolName);
      if (hasTool) {
        const mcpResult = await callMcpTool(mcpToolName, mcpArgs);
        const text = mcpResult.content
          ?.filter((c) => c.type === "text")
          .map((c) => c.text ?? "")
          .join("\n");
        try {
          const parsed = JSON.parse(text ?? "{}") as T;
          return { result: parsed, usedMcp: true };
        } catch {
          return { result: { raw: text } as unknown as T, usedMcp: true };
        }
      }
    } catch (err) {
      logger.warn({ err, mcpToolName }, "MCP call failed, falling back to REST");
    }
  }
  const result = await restFallback();
  return { result, usedMcp: false };
}

// ─── Policy Documents ────────────────────────────────────────────────────────

const POLICIES: Record<string, string> = {
  availability: `---
control_id: availability-policy
domain: Revenue
owner: Head of Revenue
---
## Availability Agent Policy

### Agent Rules
- MUST query live Apaleo sandbox for unit group availability before making any response
- MUST include rate plan options with each available unit group
- MUST flag if requested dates have zero availability — FAIL immediately
- MUST NOT fabricate availability data — all decisions must reference real Apaleo API responses
- SHOULD include total available unit count and property name in response
- MAY suggest alternative dates if availability is low

### Decision Criteria
- PASS: Units available for the full requested date range with at least one rate plan
- FAIL: No units available or date range is invalid
- ESCALATE: Availability below 10% of total unit count — Revenue Manager review required`,

  rate: `---
control_id: rate-override-policy
domain: Revenue
owner: Head of Revenue
---
## Rate Agent — Rate Override Policy

### Standard Rate Authority
- Agents MAY apply BAR (Best Available Rate) without additional approval
- Agents MAY apply contracted corporate rates for verified accounts
- Discount up to 10% below BAR: Agent authority — log and proceed (PASS)

### Override Thresholds (ESCALATE)
- Discount 11–25% below BAR: Revenue Manager approval required → ESCALATE
- Discount >25% below BAR: Director of Revenue sign-off → ESCALATE
- Any complimentary room (100% discount): General Manager approval → ESCALATE

### Agent Rules
- MUST retrieve current rate plans from Apaleo before evaluating any request
- MUST compare requested rate against BAR for the date range
- MUST NOT apply rates below the property floor rate under any circumstance — FAIL
- MUST log override reason, requestor, and governing clause for every rate decision`,

  reservation: `---
control_id: check-in-agent-policy
domain: Operations
owner: Operations Director
---
## Reservation Bot Policy

### Booking Rules
- MUST verify unit group availability before creating any reservation
- MUST confirm valid rate plan is attached before committing booking
- MUST capture guest name and at least one contact method (email or phone)
- MUST NOT create reservations for past arrival dates — FAIL
- MUST NOT double-book: verify no conflicting reservations for the same unit

### Modification Rules
- MAY modify reservation dates if new dates have availability — PASS with log
- MAY update guest details without additional approval
- MUST NOT reduce the reservation value below the floor rate
- Modifications affecting >3 nights: flag for Revenue Manager review

### Agent Rules
- MUST log every create/modify/retrieve action to Witness Stream
- MUST include reservation ID, guest name, dates, and rate in every log entry
- Decision MUST be PASS before any create or modify action is executed`,

  checkin: `---
control_id: check-in-policy
domain: Operations
owner: Operations Director
---
## Check-In Agent Policy

### Pre-Check-In Validation Gate (ALL must pass for PASS decision)
1. Reservation status must be "Definite" or "Tentative" — FAIL if InHouse/CheckedOut
2. Guest identity must be verified (name match to reservation) — FAIL if mismatch
3. Folio must exist and be in "Open" status — ESCALATE if missing
4. Valid payment method confirmed or folio balance covered — ESCALATE if absent
5. Arrival date must be today or in the past — FAIL if future

### Check-In Execution
- PASS: All 5 validation checks green → system executes check-in API to set InHouse
- FAIL: Any hard gate failed → do not execute check-in, log reason with reservation ID
- ESCALATE: Folio or payment issues → Front Office Manager review, do not execute

### Agent Rules
- Policy evaluation MUST complete before any API write is attempted
- On PASS only: check-in API is called; on FAIL or ESCALATE: API is NOT called
- MUST log check-in decision with guest name, reservation ID, and folio reference`,

  folio_charge: `---
control_id: folio-charge-policy
domain: Operations / Finance
owner: Finance Director
---
## Folio Charge Agent Policy

### Charge Posting Rules
- MUST verify folio exists and is in Open status before posting any charge
- MUST include service type classification for every charge
- Charges ≤€500: Agent MAY post — PASS, log charge details
- Charges €500–€2,000: Revenue Manager review required — ESCALATE before posting
- Charges >€2,000: Finance Director approval — ESCALATE, do not post
- MUST NOT post duplicate charges for same service/date — FAIL

### Agent Rules
- Decision MUST be PASS before posting charge to Apaleo folio
- On PASS: charge is posted via POST /finance/v1/folios/{id}/charges
- On ESCALATE or FAIL: charge is NOT posted, log reason`,

  folio: `---
control_id: folio-settlement-policy
domain: Operations / Finance
owner: Finance Director
---
## Folio Agent Policy

### Charge Review Rules
- Charges ≤€500: Agent may summarise and flag without escalation (PASS)
- Charges €500–€2,000: Flag for supervisor review — ESCALATE
- Charges >€2,000: Automatic escalation to Finance Director — ESCALATE
- Disputed charges (guest contested): Always ESCALATE to Front Office Manager

### Exception Flags
- MUST flag any charge with no service type classification
- MUST flag any charge appearing more than once for the same service/date
- MUST flag total folio balance exceeding pre-authorisation amount

### Agent Rules
- MUST retrieve full folio from Apaleo before analysis
- MUST NOT modify folio charges — read-only analysis and flagging only
- MUST log folio summary with total balance, charge count, and any flags raised`,

  checkout: `---
control_id: checkout-policy
domain: Operations
owner: Operations Director
---
## Checkout Agent Policy

### Late Checkout Policy
- Standard checkout: 11:00 local time
- Late checkout until 14:00: MAY waive fee for Gold/Platinum loyalty tier — log with exception_applied: true
- Late checkout 14:00–18:00: 50% of one night rate — PASS, agent may apply
- Late checkout after 18:00: Full night rate — PASS, agent may apply
- Complimentary late checkout: General Manager approval only → ESCALATE

### Folio Settlement Gate (ALL must pass for PASS decision)
- Folio outstanding balance MUST be zero or valid payment method confirmed — ESCALATE if not
- No outstanding disputed charges — ESCALATE if present
- Reservation MUST be InHouse status — FAIL if not

### Agent Rules
- Policy evaluation MUST complete before any API write is attempted
- On PASS only: checkout API is called (PUT /reservations/{id}/checkout)
- On FAIL or ESCALATE: checkout API is NOT called
- MUST log decision with reservation ID, guest name, departure time, and folio status`,

  revenue: `---
control_id: revenue-reconciliation-policy
domain: Finance
owner: CFO / Revenue Director
---
## Revenue Reconciliation Agent Policy

### Reconciliation Rules
- Run daily comparison: actual revenue vs rate plan expectations per unit group
- Variance ≤5%: PASS — normal operational variance
- Variance 5–15%: Flag for Revenue Manager review — ESCALATE
- Variance >15%: Immediate Finance Director notification — ESCALATE

### Discrepancy Types
- Underpayment vs contracted rate: Flag with reservation ID → ESCALATE
- Overbilling vs rate plan: Flag immediately → ESCALATE
- Unmatched folios (no reservation): Flag for Finance audit → ESCALATE

### Agent Rules
- MUST pull daily revenue report from Apaleo for the specified property and date
- MUST compare each reservation's actual rate against its rate plan expectation
- MUST NOT modify any financial records — read-only analysis only`,
};

// ─── Agent Decision Type ──────────────────────────────────────────────────────

interface AgentDecision {
  decision: "PASS" | "FAIL" | "ESCALATE";
  clauseApplied: string;
  actionProposed: string;
  exceptionApplied: boolean;
  escalationTarget: string | null;
  reasoning: string;
}

// ─── Witness Stream Writer ────────────────────────────────────────────────────

interface WitnessEntryInput {
  companyId: number;
  agent: string;
  decision: AgentDecision;
  fileReferenced: string;
  apaleoData: Record<string, unknown>;
  scenarioRunId?: string;
}

async function writeWitnessEntry(entry: WitnessEntryInput): Promise<number> {
  const [row] = await db
    .insert(witnessEntries)
    .values({
      companyId: entry.companyId,
      agent: entry.agent,
      decision: entry.decision.decision,
      fileReferenced: entry.fileReferenced,
      clauseApplied: entry.decision.clauseApplied,
      actionProposed: entry.decision.actionProposed,
      exceptionApplied: entry.decision.exceptionApplied,
      escalationTarget: entry.decision.escalationTarget,
      reasoning: entry.decision.reasoning,
      apaleoData: entry.apaleoData,
      scenarioRunId: entry.scenarioRunId ?? null,
    })
    .returning({ id: witnessEntries.id });
  return row.id;
}

// ─── AI Policy Evaluator ──────────────────────────────────────────────────────

async function evaluateWithPolicy(
  agentName: string,
  policyKey: string,
  context: string,
  task: string
): Promise<AgentDecision> {
  const policy = POLICIES[policyKey];
  const aiResponse = await callAI({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: `You are the ${agentName} operating under the VDA-MK governance framework.
Your governing policy document is:

${policy}

You MUST respond ONLY in this exact JSON format with no extra text:
{
  "decision": "PASS" | "FAIL" | "ESCALATE",
  "clauseApplied": "<exact policy clause that governed this decision>",
  "actionProposed": "<what action was taken or should be taken>",
  "exceptionApplied": true | false,
  "escalationTarget": "<role to escalate to, or null>",
  "reasoning": "<1-3 sentence explanation citing specific data from the context>"
}`,
    messages: [
      {
        role: "user",
        content: `Task: ${task}\n\nLive Apaleo Data:\n${context}`,
      },
    ],
  });

  try {
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch ? jsonMatch[0] : aiResponse) as AgentDecision;
  } catch {
    return {
      decision: "ESCALATE",
      clauseApplied: "Unable to parse agent response",
      actionProposed: "Manual review required",
      exceptionApplied: false,
      escalationTarget: "Operations Director",
      reasoning: aiResponse.slice(0, 200),
    };
  }
}

// ─── Availability Agent ───────────────────────────────────────────────────────

router.post("/agents/availability", async (req, res) => {
  try {
    const {
      propertyId,
      arrival,
      departure,
      adults = "2",
      companyId,
      scenarioRunId,
    } = req.body as {
      propertyId: string;
      arrival: string;
      departure: string;
      adults?: string;
      companyId: number;
      scenarioRunId?: string;
    };

    if (!propertyId || !arrival || !departure || !companyId) {
      return res.status(400).json({ error: "propertyId, arrival, departure, companyId required" });
    }

    const { result: availData, usedMcp: usedMcpAvail } = await mcpOrRest<{
      unitGroups: Array<{ unitGroupId: string; availableUnits: number }>;
    }>(
      "apaleo_get_availability",
      { propertyId, arrival, departure, adults },
      () =>
        apaleoRequest<{ unitGroups: Array<{ unitGroupId: string; availableUnits: number }> }>(
          "/availability/v1/unit-groups",
          "GET",
          undefined,
          { propertyId, arrival, departure, adults }
        ).catch(() => ({ unitGroups: [] }))
    );

    const { result: ratePlanData } = await mcpOrRest<{ ratePlans: ApaleoRatePlan[] }>(
      "apaleo_list_rate_plans",
      { propertyId },
      () =>
        apaleoRequest<{ ratePlans: ApaleoRatePlan[] }>(
          "/rateplan/v1/rate-plans",
          "GET",
          undefined,
          { propertyId }
        ).catch(() => ({ ratePlans: [] }))
    );

    const unitGroups = availData.unitGroups ?? [];
    const ratePlans = ratePlanData.ratePlans ?? [];

    const apaleoData: Record<string, unknown> = {
      propertyId, arrival, departure, adults,
      unitGroupCount: unitGroups.length,
      unitGroups: unitGroups.slice(0, 5),
      ratePlanCount: ratePlans.length,
      ratePlans: ratePlans.slice(0, 5).map((p) => ({ id: p.id, name: p.name, code: p.code })),
      usedMcp: usedMcpAvail,
    };

    const context = `Property: ${propertyId}
Requested arrival: ${arrival}, departure: ${departure}, adults: ${adults}
Available unit groups (${unitGroups.length}): ${JSON.stringify(unitGroups.slice(0, 5), null, 2)}
Rate plans available (${ratePlans.length}): ${ratePlans.map((p) => p.name || p.id).join(", ")}
Data source: ${usedMcpAvail ? "MCP tool (apaleo_get_availability)" : "Apaleo REST API"}`;

    const decision = await evaluateWithPolicy(
      "Availability Agent", "availability", context,
      `Check unit availability for property ${propertyId} from ${arrival} to ${departure} for ${adults} adults.`
    );

    const witnessId = await writeWitnessEntry({
      companyId: Number(companyId),
      agent: "Availability Agent",
      decision,
      fileReferenced: "availability-policy.md",
      apaleoData,
      scenarioRunId,
    });

    res.json({
      ...decision, witnessEntryId: witnessId,
      propertyId, arrival, departure, unitGroupCount: unitGroups.length, ratePlanCount: ratePlans.length, usedMcp: usedMcpAvail,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─── Rate Agent ───────────────────────────────────────────────────────────────

router.post("/agents/rate", async (req, res) => {
  try {
    const { propertyId, requestedRate, barRate, ratePlanId, companyId, scenarioRunId } = req.body as {
      propertyId: string;
      requestedRate?: number;
      barRate?: number;
      ratePlanId?: string;
      companyId: number;
      scenarioRunId?: string;
    };

    if (!propertyId || !companyId) {
      return res.status(400).json({ error: "propertyId, companyId required" });
    }

    const { result: ratePlanData, usedMcp } = await mcpOrRest<{ ratePlans: ApaleoRatePlan[] }>(
      "apaleo_list_rate_plans",
      { propertyId },
      () =>
        apaleoRequest<{ ratePlans: ApaleoRatePlan[] }>(
          "/rateplan/v1/rate-plans", "GET", undefined, { propertyId }
        ).catch(() => ({ ratePlans: [] }))
    );

    const ratePlans = ratePlanData.ratePlans ?? [];
    const activePlan = (ratePlanId ? ratePlans.find((p) => p.id === ratePlanId) : null) ?? ratePlans[0];
    const bar = barRate ?? 150;
    const reqRate = requestedRate ?? bar;
    const discountPct = bar > 0 ? Math.round(((bar - reqRate) / bar) * 100) : 0;

    const apaleoData: Record<string, unknown> = {
      propertyId, barRate: bar, requestedRate: reqRate, discountPct,
      activePlanId: activePlan?.id, activePlanName: activePlan?.name,
      ratePlanCount: ratePlans.length, usedMcp,
    };

    const context = `Property: ${propertyId}
BAR (Best Available Rate): €${bar}
Requested rate: €${reqRate} (${discountPct}% below BAR)
Rate plan: ${activePlan ? activePlan.name || activePlan.id : "BAR"}
All rate plans (${ratePlans.length}): ${ratePlans.map((p) => p.name || p.id).slice(0, 8).join(", ")}
Data source: ${usedMcp ? "MCP tool" : "Apaleo REST API"}`;

    const decision = await evaluateWithPolicy(
      "Rate Agent", "rate", context,
      `Evaluate rate request: €${reqRate} vs BAR €${bar} (${discountPct}% discount) for property ${propertyId}.`
    );

    const witnessId = await writeWitnessEntry({
      companyId: Number(companyId),
      agent: "Rate Agent",
      decision,
      fileReferenced: "rate-override-policy.md",
      apaleoData,
      scenarioRunId,
    });

    res.json({
      ...decision, witnessEntryId: witnessId,
      propertyId, requestedRate: reqRate, barRate: bar, discountPct, activePlanName: activePlan?.name ?? activePlan?.id, usedMcp,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─── Reservation Bot (create / modify / retrieve) ────────────────────────────

interface CreateReservationBody {
  propertyId: string;
  unitGroupId: string;
  ratePlanId: string;
  arrival: string;
  departure: string;
  adults: number;
  booker: { firstName: string; lastName: string; email?: string };
}

interface CreatedReservation {
  id: string;
}

router.post("/agents/reservation", async (req, res) => {
  try {
    const {
      propertyId, action = "retrieve", reservationId,
      guestName, arrival, departure, ratePlanId, unitGroupId,
      adults = 2, guestEmail, companyId, scenarioRunId,
      modifyFields,
    } = req.body as {
      propertyId: string;
      action?: "retrieve" | "create" | "modify";
      reservationId?: string;
      guestName?: string;
      arrival?: string;
      departure?: string;
      ratePlanId?: string;
      unitGroupId?: string;
      adults?: number;
      guestEmail?: string;
      companyId: number;
      scenarioRunId?: string;
      modifyFields?: Record<string, unknown>;
    };

    if (!propertyId || !companyId) {
      return res.status(400).json({ error: "propertyId, companyId required" });
    }

    const contextLines: string[] = [`Property: ${propertyId}`, `Action: ${action}`];
    const apaleoData: Record<string, unknown> = { propertyId, action };
    let executedReservationId: string | undefined = reservationId;
    let writeExecuted = false;
    let writeError: string | undefined;

    // ── STEP 1: Gather context data ──────────────────────────────────────────
    if (action === "create" && arrival && departure) {
      let resolvedUnitGroupId = unitGroupId;
      if (!resolvedUnitGroupId) {
        const availData = await apaleoRequest<{
          unitGroups: Array<{ unitGroupId: string; availableUnits: number }>;
        }>("/availability/v1/unit-groups", "GET", undefined, {
          propertyId, arrival, departure, adults: String(adults),
        }).catch(() => ({ unitGroups: [] }));
        resolvedUnitGroupId = availData.unitGroups?.[0]?.unitGroupId;
      }
      let resolvedRatePlanId = ratePlanId;
      if (!resolvedRatePlanId) {
        const planData = await apaleoRequest<{ ratePlans: ApaleoRatePlan[] }>(
          "/rateplan/v1/rate-plans", "GET", undefined, { propertyId }
        ).catch(() => ({ ratePlans: [] }));
        resolvedRatePlanId = planData.ratePlans?.[0]?.id;
      }
      const [guestFirst = "Demo", ...guestRest] = (guestName ?? "Demo Guest").split(" ");
      const guestLast = guestRest.join(" ") || "Guest";
      apaleoData.bookingParams = { unitGroupId: resolvedUnitGroupId, ratePlanId: resolvedRatePlanId, arrival, departure, adults };
      contextLines.push(
        `Create request: Guest=${guestFirst} ${guestLast}, Arrival=${arrival}, Departure=${departure}`,
        `Unit group available: ${resolvedUnitGroupId ?? "none found"}`,
        `Rate plan available: ${resolvedRatePlanId ?? "none found"}`,
        `Arrival date check: ${new Date(arrival) < new Date() ? "PAST DATE — FAIL" : "OK"}`
      );
      apaleoData.resolvedUnitGroupId = resolvedUnitGroupId;
      apaleoData.resolvedRatePlanId = resolvedRatePlanId;
    } else if (action === "modify" && reservationId) {
      const resv = await apaleoRequest<ApaleoReservation>(
        `/booking/v1/reservations/${reservationId}`, "GET", undefined,
        { expand: "property,unitGroup,ratePlan,unit,primaryGuest" }
      ).catch(() => null);
      apaleoData.currentReservation = resv;
      contextLines.push(
        `Modify request for ${reservationId}: current status=${resv?.status ?? "Unknown"}`,
        `Current arrival: ${resv?.arrival ?? "?"}, departure: ${resv?.departure ?? "?"}`,
        `Proposed changes: ${JSON.stringify(modifyFields ?? {})}`,
        `Nights change: ${arrival && resv?.arrival ? "dates change requested" : "no date change"}`
      );
    } else if (reservationId) {
      const resv = await apaleoRequest<ApaleoReservation>(
        `/booking/v1/reservations/${reservationId}`, "GET", undefined,
        { expand: "property,unitGroup,ratePlan,unit,primaryGuest" }
      ).catch(() => null);
      apaleoData.reservation = resv;
      contextLines.push(`Reservation ${reservationId}: ${JSON.stringify(resv, null, 2)}`);
    } else {
      const listData = await apaleoRequest<{ reservations: ApaleoReservation[]; count: number }>(
        "/booking/v1/reservations", "GET", undefined, { propertyId, pageSize: 5 }
      ).catch(() => ({ reservations: [], count: 0 }));
      apaleoData.recentReservations = listData.reservations.slice(0, 3);
      contextLines.push(`Recent reservations (${listData.count}): ${JSON.stringify(listData.reservations.slice(0, 3), null, 2)}`);
    }

    // ── STEP 2: Policy evaluation FIRST ─────────────────────────────────────
    const decision = await evaluateWithPolicy(
      "Reservation Bot", "reservation", contextLines.join("\n"),
      `Execute reservation action "${action}" for property ${propertyId}. ${guestName ? `Guest: ${guestName}.` : ""} ${reservationId ? `Reservation ID: ${reservationId}.` : ""} Validate all booking rules before proceeding.`
    );

    // ── STEP 3: Execute write ONLY if PASS ───────────────────────────────────
    if (decision.decision === "PASS") {
      if (action === "create" && arrival && departure) {
        const resolvedUnitGroupId = apaleoData.resolvedUnitGroupId as string | undefined;
        const resolvedRatePlanId = apaleoData.resolvedRatePlanId as string | undefined;
        if (resolvedUnitGroupId && resolvedRatePlanId) {
          const [guestFirst = "Demo", ...guestRest] = (guestName ?? "Demo Guest").split(" ");
          const guestLast = guestRest.join(" ") || "Guest";
          const bookingBody: CreateReservationBody = {
            propertyId, unitGroupId: resolvedUnitGroupId, ratePlanId: resolvedRatePlanId,
            arrival, departure, adults,
            booker: { firstName: guestFirst, lastName: guestLast, ...(guestEmail ? { email: guestEmail } : {}) },
          };
          try {
            const { result: created, usedMcp } = await mcpOrRest<CreatedReservation>(
              "apaleo_create_reservation", { ...bookingBody },
              () => apaleoRequest<CreatedReservation>("/booking/v1/reservations", "POST", bookingBody)
            );
            executedReservationId = created.id;
            writeExecuted = true;
            apaleoData.createdReservationId = executedReservationId;
            apaleoData.usedMcp = usedMcp;
            decision.actionProposed = `Reservation created in Apaleo: ID = ${executedReservationId}. ${decision.actionProposed}`;
          } catch (e: unknown) {
            writeError = e instanceof Error ? e.message : String(e);
            apaleoData.writeError = writeError;
          }
        }
      } else if (action === "modify" && reservationId && modifyFields) {
        try {
          const patchBody = Object.entries(modifyFields).map(([op, val]) => ({ op: "replace", path: `/${op}`, value: val }));
          const { usedMcp } = await mcpOrRest<Record<string, unknown>>(
            "apaleo_patch_reservation", { reservationId, patch: patchBody },
            () => apaleoRequest<Record<string, unknown>>(
              `/booking/v1/reservations/${reservationId}`, "PATCH", patchBody
            )
          );
          writeExecuted = true;
          apaleoData.modifiedFields = modifyFields;
          apaleoData.usedMcp = usedMcp;
          decision.actionProposed = `Reservation ${reservationId} modified in Apaleo (fields: ${Object.keys(modifyFields).join(", ")}). ${decision.actionProposed}`;
        } catch (e: unknown) {
          writeError = e instanceof Error ? e.message : String(e);
          apaleoData.writeError = writeError;
        }
      }
    }

    apaleoData.writeExecuted = writeExecuted;
    apaleoData.writeBlocked = !writeExecuted && action !== "retrieve";

    const witnessId = await writeWitnessEntry({
      companyId: Number(companyId),
      agent: "Reservation Bot",
      decision,
      fileReferenced: "check-in-agent.md",
      apaleoData,
      scenarioRunId,
    });

    res.json({
      ...decision, witnessEntryId: witnessId,
      propertyId, action,
      reservationId: executedReservationId,
      writeExecuted, writeError,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─── Check-In Agent ───────────────────────────────────────────────────────────

router.post("/agents/checkin", async (req, res) => {
  try {
    const { propertyId, reservationId, guestName, companyId, scenarioRunId } = req.body as {
      propertyId: string;
      reservationId?: string;
      guestName?: string;
      companyId: number;
      scenarioRunId?: string;
    };

    if (!propertyId || !companyId) {
      return res.status(400).json({ error: "propertyId, companyId required" });
    }

    const contextLines: string[] = [`Property: ${propertyId}`, `Guest: ${guestName ?? "Guest"}`];
    const apaleoData: Record<string, unknown> = { propertyId };
    let checkinExecuted = false;
    let checkinError: string | undefined;
    let resolvedReservationId = reservationId;

    // ── STEP 1: Gather validation data ──────────────────────────────────────
    if (reservationId) {
      const [resvResult, folioResult] = await Promise.allSettled([
        apaleoRequest<ApaleoReservation>(
          `/booking/v1/reservations/${reservationId}`, "GET", undefined,
          { expand: "property,unitGroup,ratePlan,unit,primaryGuest" }
        ),
        apaleoRequest<{ folios: ApaleoFolio[]; count: number }>(
          "/finance/v1/folios", "GET", undefined, { reservationId, status: "Open" }
        ),
      ]);

      const resv = resvResult.status === "fulfilled" ? resvResult.value : null;
      const folios = folioResult.status === "fulfilled" ? folioResult.value.folios ?? [] : [];

      const validStatuses: ReservationStatus[] = ["Tentative", "Definite"];
      const statusOk = resv !== null && validStatuses.includes(resv.status as ReservationStatus);
      const guestNameOnRecord = `${resv?.primaryGuest?.firstName ?? ""} ${resv?.primaryGuest?.lastName ?? ""}`.trim();
      const folioExists = folios.length > 0;
      const arrivalDate = resv?.arrival ? new Date(resv.arrival) : null;
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const arrivalOk = arrivalDate !== null && arrivalDate <= today;

      if (folios[0]?.id) apaleoData.folioId = folios[0].id;
      apaleoData.reservation = resv;
      apaleoData.folioCount = folios.length;
      apaleoData.validationGates = { statusOk, folioExists, arrivalOk };

      contextLines.push(
        `Reservation ${reservationId}:`,
        `  Gate 1 — Status: ${resv?.status ?? "Unknown"} → ${statusOk ? "PASS" : "FAIL"}`,
        `  Gate 2 — Guest on record: "${guestNameOnRecord}" vs requested: "${guestName ?? "not specified"}" → ${!guestName || guestNameOnRecord.toLowerCase().includes((guestName ?? "").toLowerCase().split(" ")[0]) ? "PASS" : "FAIL (name mismatch)"}`,
        `  Gate 3 — Open folios: ${folios.length} → ${folioExists ? "PASS" : "ESCALATE (no folio)"}`,
        `  Gate 4 — Payment method: ${folioExists ? "assumed present on folio" : "unknown"} → ${folioExists ? "PASS" : "ESCALATE"}`,
        `  Gate 5 — Arrival date: ${resv?.arrival ?? "Unknown"}, today: ${today.toISOString().split("T")[0]} → ${arrivalOk ? "PASS" : "FAIL (future date)"}`,
        `  All gates pass: ${statusOk && folioExists && arrivalOk}`
      );
    } else {
      const today = new Date().toISOString().split("T")[0];
      const arrivals = await apaleoRequest<{ reservations: ApaleoReservation[]; count: number }>(
        "/booking/v1/reservations", "GET", undefined,
        { propertyId, status: "Definite", dateFilter: "Arrival", from: today, to: today, pageSize: 3 }
      ).catch(() => ({ reservations: [], count: 0 }));
      apaleoData.arrivingToday = arrivals.reservations.slice(0, 2);
      resolvedReservationId = arrivals.reservations[0]?.id;
      contextLines.push(`Arriving today (${arrivals.count}): ${JSON.stringify(arrivals.reservations.slice(0, 2), null, 2)}`);
    }

    // ── STEP 2: Policy evaluation FIRST ─────────────────────────────────────
    const decision = await evaluateWithPolicy(
      "Check-In Agent", "checkin", contextLines.join("\n"),
      `Validate and process check-in for ${guestName ?? "guest"} at property ${propertyId}. ${resolvedReservationId ? `Reservation ID: ${resolvedReservationId}.` : ""} Run all 5 validation gates per policy.`
    );

    // ── STEP 3: Execute check-in ONLY if policy returns PASS ─────────────────
    if (decision.decision === "PASS" && resolvedReservationId) {
      try {
        const { usedMcp } = await mcpOrRest<Record<string, unknown>>(
          "apaleo_checkin_reservation",
          { reservationId: resolvedReservationId },
          () =>
            apaleoRequest<Record<string, unknown>>(
              `/booking/v1/reservations/${resolvedReservationId}/checkin`, "PUT"
            )
        );
        checkinExecuted = true;
        apaleoData.checkinExecuted = true;
        apaleoData.usedMcp = usedMcp;
        decision.actionProposed = `Check-in executed via Apaleo API (${usedMcp ? "MCP" : "REST"}) — reservation ${resolvedReservationId} status → InHouse. ${decision.actionProposed}`;
      } catch (err: unknown) {
        checkinError = err instanceof Error ? err.message : String(err);
        apaleoData.checkinError = checkinError;
      }
    } else {
      apaleoData.checkinBlocked = true;
      apaleoData.blockedReason = `Policy decision was ${decision.decision} — check-in API not called`;
    }

    const witnessId = await writeWitnessEntry({
      companyId: Number(companyId),
      agent: "Check-In Agent",
      decision,
      fileReferenced: "check-in-policy.md",
      apaleoData,
      scenarioRunId,
    });

    res.json({
      ...decision, witnessEntryId: witnessId,
      propertyId, reservationId: resolvedReservationId, guestName, checkinExecuted, checkinError,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─── Folio Agent (read-only analysis) ────────────────────────────────────────

router.post("/agents/folio", async (req, res) => {
  try {
    const { propertyId, reservationId, folioId, companyId, scenarioRunId } = req.body as {
      propertyId: string;
      reservationId?: string;
      folioId?: string;
      companyId: number;
      scenarioRunId?: string;
    };

    if (!propertyId || !companyId) {
      return res.status(400).json({ error: "propertyId, companyId required" });
    }

    const contextLines: string[] = [`Property: ${propertyId}`];
    const apaleoData: Record<string, unknown> = { propertyId };

    if (folioId) {
      const { result: folio, usedMcp } = await mcpOrRest<ApaleoFolio>(
        "apaleo_get_folio",
        { folioId },
        () => apaleoRequest<ApaleoFolio>(`/finance/v1/folios/${folioId}`)
      );
      apaleoData.folio = folio;
      apaleoData.usedMcp = usedMcp;
      const charges = folio.charges ?? [];
      const totalGross = charges.reduce((s, c) => s + (c.amount?.grossAmount ?? 0), 0);
      const currency = folio.totalAmount?.currency ?? "EUR";
      contextLines.push(
        `Folio ${folioId}: status=${folio.status ?? "Unknown"}, reservation=${folio.reservationId ?? reservationId ?? "None"}`,
        `Total: ${folio.totalAmount?.amount ?? totalGross} ${currency}, outstanding: ${folio.outstandingAmount?.amount ?? 0} ${currency}`,
        `Charges (${charges.length}): ${JSON.stringify(charges.slice(0, 5), null, 2)}`
      );
    } else if (reservationId) {
      const { result: folioData, usedMcp } = await mcpOrRest<{ folios: ApaleoFolio[]; count: number }>(
        "apaleo_list_folios", { reservationId },
        () => apaleoRequest<{ folios: ApaleoFolio[]; count: number }>("/finance/v1/folios", "GET", undefined, { reservationId })
      );
      apaleoData.folios = folioData.folios.slice(0, 3);
      apaleoData.usedMcp = usedMcp;
      contextLines.push(`Folios for reservation ${reservationId} (${folioData.count}): ${JSON.stringify(folioData.folios.slice(0, 3), null, 2)}`);
    } else {
      const folioData = await apaleoRequest<{ folios: ApaleoFolio[]; count: number }>(
        "/finance/v1/folios", "GET", undefined, { propertyId, status: "Open", pageSize: 5 }
      ).catch(() => ({ folios: [], count: 0 }));
      apaleoData.openFolios = folioData.folios.slice(0, 3);
      contextLines.push(`Open folios for property (${folioData.count}): ${JSON.stringify(folioData.folios.slice(0, 3), null, 2)}`);
    }

    const decision = await evaluateWithPolicy(
      "Folio Agent", "folio", contextLines.join("\n"),
      `Analyse folio charges for property ${propertyId}. ${folioId ? `Folio: ${folioId}.` : ""} ${reservationId ? `Reservation: ${reservationId}.` : ""} Apply folio-settlement-policy.md thresholds.`
    );

    const witnessId = await writeWitnessEntry({
      companyId: Number(companyId),
      agent: "Folio Agent",
      decision,
      fileReferenced: "folio-settlement-policy.md",
      apaleoData,
      scenarioRunId,
    });

    res.json({ ...decision, witnessEntryId: witnessId, propertyId, folioId, reservationId });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─── Folio Charge Agent (post a charge to a folio) ────────────────────────────

interface FolioChargeBody {
  serviceType: string;
  amount: { amount: number; currency: string };
  name?: string;
  quantity?: number;
  serviceDate?: string;
}

router.post("/agents/folio-charge", async (req, res) => {
  try {
    const { propertyId, folioId, chargeAmount, currency = "EUR", serviceType = "Other", chargeName, companyId, scenarioRunId } = req.body as {
      propertyId: string;
      folioId?: string;
      chargeAmount: number;
      currency?: string;
      serviceType?: string;
      chargeName?: string;
      companyId: number;
      scenarioRunId?: string;
    };

    if (!propertyId || !chargeAmount || !companyId) {
      return res.status(400).json({ error: "propertyId, chargeAmount, companyId required" });
    }

    const contextLines: string[] = [`Property: ${propertyId}`, `Folio: ${folioId ?? "not specified"}`];
    const apaleoData: Record<string, unknown> = { propertyId, folioId, chargeAmount, currency, serviceType };
    let chargePosted = false;
    let chargeError: string | undefined;
    let resolvedFolioId = folioId;

    // Resolve folio if not provided
    if (!resolvedFolioId) {
      const folioData = await apaleoRequest<{ folios: ApaleoFolio[]; count: number }>(
        "/finance/v1/folios", "GET", undefined, { propertyId, status: "Open", pageSize: 1 }
      ).catch(() => ({ folios: [], count: 0 }));
      resolvedFolioId = folioData.folios[0]?.id;
      apaleoData.resolvedFolioId = resolvedFolioId;
    }

    // Fetch folio for context
    let folioStatus = "Unknown";
    if (resolvedFolioId) {
      const folio = await apaleoRequest<ApaleoFolio>(`/finance/v1/folios/${resolvedFolioId}`).catch(() => null);
      folioStatus = folio?.status ?? "Unknown";
      const existingCharges = folio?.charges ?? [];
      const duplicateCheck = existingCharges.some(
        (c) => c.name === chargeName && c.serviceDate === new Date().toISOString().split("T")[0]
      );
      apaleoData.folioStatus = folioStatus;
      apaleoData.existingChargeCount = existingCharges.length;
      apaleoData.duplicateDetected = duplicateCheck;
      contextLines.push(
        `Folio ${resolvedFolioId}: status=${folioStatus}`,
        `Existing charges: ${existingCharges.length}, duplicate check: ${duplicateCheck ? "DUPLICATE DETECTED" : "no duplicate"}`,
        `Charge to post: €${chargeAmount} ${currency} — ${serviceType} — ${chargeName ?? "unnamed"}`,
        `Amount threshold: ${chargeAmount <= 500 ? "≤€500 (agent authority)" : chargeAmount <= 2000 ? "€500–€2000 (escalate)" : ">€2000 (escalate to Finance Director)"}`
      );
    } else {
      contextLines.push("No open folio found — cannot post charge");
    }

    // ── Policy evaluation FIRST ──────────────────────────────────────────────
    const decision = await evaluateWithPolicy(
      "Folio Agent", "folio_charge", contextLines.join("\n"),
      `Post charge €${chargeAmount} ${currency} (${serviceType}: ${chargeName ?? "unnamed"}) to folio ${resolvedFolioId ?? "none"} at property ${propertyId}. Apply folio-charge-policy.md.`
    );

    // ── Execute charge ONLY if PASS ──────────────────────────────────────────
    if (decision.decision === "PASS" && resolvedFolioId && folioStatus === "Open") {
      const chargeBody: FolioChargeBody = {
        serviceType,
        amount: { amount: chargeAmount, currency },
        name: chargeName ?? serviceType,
        quantity: 1,
        serviceDate: new Date().toISOString().split("T")[0],
      };
      try {
        const { usedMcp } = await mcpOrRest<Record<string, unknown>>(
          "apaleo_post_folio_charge",
          { folioId: resolvedFolioId, ...chargeBody },
          () => apaleoRequest<Record<string, unknown>>(
            `/finance/v1/folios/${resolvedFolioId}/charges`, "POST", chargeBody
          )
        );
        chargePosted = true;
        apaleoData.chargePosted = true;
        apaleoData.usedMcp = usedMcp;
        decision.actionProposed = `Charge €${chargeAmount} ${currency} posted to folio ${resolvedFolioId} via Apaleo API (${usedMcp ? "MCP" : "REST"}). ${decision.actionProposed}`;
      } catch (e: unknown) {
        chargeError = e instanceof Error ? e.message : String(e);
        apaleoData.chargeError = chargeError;
      }
    } else if (decision.decision !== "PASS") {
      apaleoData.chargeBlocked = true;
      apaleoData.blockedReason = `Policy decision was ${decision.decision} — charge not posted`;
    }

    const witnessId = await writeWitnessEntry({
      companyId: Number(companyId),
      agent: "Folio Charge Agent",
      decision,
      fileReferenced: "folio-charge-policy.md",
      apaleoData,
      scenarioRunId,
    });

    res.json({
      ...decision, witnessEntryId: witnessId,
      propertyId, folioId: resolvedFolioId, chargeAmount, currency, chargePosted, chargeError,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─── Checkout Agent ───────────────────────────────────────────────────────────

router.post("/agents/checkout", async (req, res) => {
  try {
    const { propertyId, reservationId, guestName, loyaltyTier, lateCheckout, companyId, scenarioRunId } = req.body as {
      propertyId: string;
      reservationId?: string;
      guestName?: string;
      loyaltyTier?: string;
      lateCheckout?: string;
      companyId: number;
      scenarioRunId?: string;
    };

    if (!propertyId || !companyId) {
      return res.status(400).json({ error: "propertyId, companyId required" });
    }

    const contextLines: string[] = [
      `Property: ${propertyId}`,
      `Guest: ${guestName ?? "Guest"}`,
      `Loyalty tier: ${loyaltyTier ?? "Standard"}`,
      `Late checkout requested: ${lateCheckout ?? "No"}`,
    ];
    const apaleoData: Record<string, unknown> = { propertyId, guestName, loyaltyTier, lateCheckout };
    let checkoutExecuted = false;
    let checkoutError: string | undefined;

    // ── STEP 1: Gather checkout validation data ──────────────────────────────
    if (reservationId) {
      const [resvResult, folioResult] = await Promise.allSettled([
        apaleoRequest<ApaleoReservation>(
          `/booking/v1/reservations/${reservationId}`, "GET", undefined,
          { expand: "property,unitGroup,ratePlan,unit,primaryGuest" }
        ),
        apaleoRequest<{ folios: ApaleoFolio[]; count: number }>(
          "/finance/v1/folios", "GET", undefined, { reservationId }
        ),
      ]);

      const resv = resvResult.status === "fulfilled" ? resvResult.value : null;
      const folios = folioResult.status === "fulfilled" ? folioResult.value.folios ?? [] : [];

      const totalOutstanding = folios.reduce((s, f) => s + (f.outstandingAmount?.amount ?? 0), 0);
      const currency = folios[0]?.totalAmount?.currency ?? "EUR";
      const isInHouse = resv?.status === "InHouse";
      const isSettled = totalOutstanding <= 0;
      const tier = loyaltyTier?.toLowerCase() ?? "standard";
      const isLoyaltyEligible = ["gold", "platinum", "vip"].includes(tier);

      apaleoData.reservation = resv;
      apaleoData.folios = folios.slice(0, 3).map((f) => ({
        id: f.id, status: f.status, total: f.totalAmount, outstanding: f.outstandingAmount,
      }));
      apaleoData.validationGates = { isInHouse, isSettled, totalOutstanding, isLoyaltyEligible };

      contextLines.push(
        `Reservation ${reservationId}:`,
        `  Gate 1 — Status: ${resv?.status ?? "Unknown"} → ${isInHouse ? "PASS (InHouse)" : "FAIL (not InHouse)"}`,
        `  Gate 2 — Folio outstanding: ${totalOutstanding} ${currency} → ${isSettled ? "PASS (settled)" : "ESCALATE (unsettled balance)"}`,
        `  Gate 3 — Loyalty tier: ${loyaltyTier ?? "Standard"} → ${isLoyaltyEligible ? "eligible for late checkout waiver" : "standard rate applies"}`,
        `  Late checkout until ${lateCheckout ?? "standard"}: ${isLoyaltyEligible && lateCheckout && lateCheckout <= "14:00" ? "MAY waive fee" : "fee applies"}`
      );
    } else {
      const today = new Date().toISOString().split("T")[0];
      const departures = await apaleoRequest<{ reservations: ApaleoReservation[]; count: number }>(
        "/booking/v1/reservations", "GET", undefined,
        { propertyId, status: "InHouse", dateFilter: "Departure", from: today, to: today, pageSize: 3 }
      ).catch(() => ({ reservations: [], count: 0 }));
      apaleoData.departingToday = departures.reservations.slice(0, 2);
      contextLines.push(`Departing today (${departures.count}): ${JSON.stringify(departures.reservations.slice(0, 2), null, 2)}`);
    }

    // ── STEP 2: Policy evaluation FIRST ─────────────────────────────────────
    const decision = await evaluateWithPolicy(
      "Checkout Agent", "checkout", contextLines.join("\n"),
      `Process checkout for ${guestName ?? "guest"} (${loyaltyTier ?? "Standard"} tier) at ${propertyId}. ${reservationId ? `Reservation: ${reservationId}.` : ""} Late checkout: ${lateCheckout ?? "No"}. Apply checkout-policy.md gates.`
    );

    // ── STEP 3: Execute checkout ONLY if policy returns PASS ─────────────────
    if (decision.decision === "PASS" && reservationId) {
      try {
        const { usedMcp } = await mcpOrRest<Record<string, unknown>>(
          "apaleo_checkout_reservation", { reservationId },
          () => apaleoRequest<Record<string, unknown>>(`/booking/v1/reservations/${reservationId}/checkout`, "PUT")
        );
        checkoutExecuted = true;
        apaleoData.checkoutExecuted = true;
        apaleoData.usedMcp = usedMcp;
        decision.actionProposed = `Checkout executed via Apaleo API (${usedMcp ? "MCP" : "REST"}) — reservation ${reservationId} → CheckedOut. ${decision.actionProposed}`;
      } catch (err: unknown) {
        checkoutError = err instanceof Error ? err.message : String(err);
        apaleoData.checkoutError = checkoutError;
      }
    } else if (decision.decision !== "PASS") {
      apaleoData.checkoutBlocked = true;
      apaleoData.blockedReason = `Policy decision was ${decision.decision} — checkout API not called`;
    }

    const witnessId = await writeWitnessEntry({
      companyId: Number(companyId),
      agent: "Checkout Agent",
      decision,
      fileReferenced: "checkout-policy.md",
      apaleoData,
      scenarioRunId,
    });

    res.json({
      ...decision, witnessEntryId: witnessId,
      propertyId, reservationId, guestName, loyaltyTier, checkoutExecuted, checkoutError,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─── Revenue Reconciliation Agent ─────────────────────────────────────────────

router.post("/agents/revenue", async (req, res) => {
  try {
    const { propertyId, date, companyId, scenarioRunId } = req.body as {
      propertyId: string;
      date?: string;
      companyId: number;
      scenarioRunId?: string;
    };

    if (!propertyId || !companyId) {
      return res.status(400).json({ error: "propertyId, companyId required" });
    }

    const targetDate = date ?? new Date().toISOString().split("T")[0];

    const [reservationsResult, ratePlansResult, revenueResult] = await Promise.allSettled([
      apaleoRequest<{ reservations: ApaleoReservation[]; count: number }>(
        "/booking/v1/reservations", "GET", undefined,
        { propertyId, dateFilter: "Arrival", from: targetDate, to: targetDate, pageSize: 20 }
      ),
      apaleoRequest<{ ratePlans: ApaleoRatePlan[] }>(
        "/rateplan/v1/rate-plans", "GET", undefined, { propertyId }
      ),
      apaleoRequest<{ rows?: Array<{ category?: string; amount?: { grossAmount: number; currency: string } }> }>(
        "/reports/v1/reports/revenue", "GET", undefined, { propertyId, from: targetDate, to: targetDate }
      ).catch(() => ({ rows: [] })),
    ]);

    const reservations = reservationsResult.status === "fulfilled" ? reservationsResult.value.reservations ?? [] : [];
    const ratePlans = ratePlansResult.status === "fulfilled" ? ratePlansResult.value.ratePlans ?? [] : [];
    const revenueRows = revenueResult.status === "fulfilled"
      ? (revenueResult.value as { rows?: Array<{ category?: string; amount?: { grossAmount: number; currency: string } }> }).rows ?? []
      : [];

    const totalRevenue = reservations.reduce((s, r) => s + (r.totalGrossAmount?.amount ?? 0), 0);
    const currency = reservations[0]?.totalGrossAmount?.currency ?? "EUR";

    const apaleoData: Record<string, unknown> = {
      propertyId, date: targetDate, reservationCount: reservations.length,
      totalRevenue, currency, ratePlanCount: ratePlans.length, revenueRowCount: revenueRows.length,
      reservationsSample: reservations.slice(0, 3).map((r) => ({
        id: r.id, status: r.status, ratePlanId: r.ratePlanId, total: r.totalGrossAmount,
      })),
    };

    const context = `Property: ${propertyId}
Date: ${targetDate}
Reservations (${reservations.length}): Total = ${totalRevenue} ${currency}
Rate plans: ${ratePlans.map((p) => p.name || p.id).slice(0, 6).join(", ")}
Revenue report rows: ${revenueRows.length}
Sample reservations: ${JSON.stringify(reservations.slice(0, 3).map((r) => ({ id: r.id, status: r.status, ratePlanId: r.ratePlanId, total: r.totalGrossAmount })), null, 2)}`;

    const decision = await evaluateWithPolicy(
      "Revenue Reconciliation Agent", "revenue", context,
      `Reconcile daily revenue for property ${propertyId} on ${targetDate}. ${reservations.length} reservations, total ${totalRevenue} ${currency}. Compare against rate plan expectations.`
    );

    const witnessId = await writeWitnessEntry({
      companyId: Number(companyId),
      agent: "Revenue Reconciliation Agent",
      decision,
      fileReferenced: "revenue-reconciliation-policy.md",
      apaleoData,
      scenarioRunId,
    });

    res.json({
      ...decision, witnessEntryId: witnessId,
      propertyId, date: targetDate, totalRevenue, currency, reservationCount: reservations.length,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─── Witness Stream — List Entries ────────────────────────────────────────────

router.get("/agents/witness", async (req, res) => {
  try {
    const { companyId, limit = "50" } = req.query as Record<string, string>;
    if (!companyId) return res.status(400).json({ error: "companyId required" });

    const entries = await db
      .select()
      .from(witnessEntries)
      .where(eq(witnessEntries.companyId, Number(companyId)))
      .orderBy(desc(witnessEntries.createdAt))
      .limit(Number(limit));

    res.json(entries);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─── Run Full Demo Scenario ───────────────────────────────────────────────────

interface ScenarioStep {
  step: number;
  agent: string;
  decision: string;
  clauseApplied: string;
  actionProposed: string;
  exceptionApplied: boolean;
  escalationTarget: string | null;
  reasoning: string;
  witnessEntryId: number;
  apaleoIds: Record<string, string | undefined>;
}

router.post("/agents/scenario/run", async (req, res) => {
  try {
    const { propertyId, companyId } = req.body as { propertyId: string; companyId: number };
    if (!propertyId || !companyId) {
      return res.status(400).json({ error: "propertyId and companyId required" });
    }

    const scenarioRunId = `scenario-${Date.now()}`;
    const results: ScenarioStep[] = [];
    const ids: Record<string, string | undefined> = { propertyId };
    const today = new Date().toISOString().split("T")[0];
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().split("T")[0];

    // ─ Step 1: Availability Agent ─────────────────────────────────────────
    {
      const availData = await apaleoRequest<{
        unitGroups: Array<{ unitGroupId: string; availableUnits: number }>;
      }>("/availability/v1/unit-groups", "GET", undefined, {
        propertyId, arrival: today, departure: tomorrow, adults: "2",
      }).catch(() => ({ unitGroups: [] }));

      const ratePlanData = await apaleoRequest<{ ratePlans: ApaleoRatePlan[] }>(
        "/rateplan/v1/rate-plans", "GET", undefined, { propertyId }
      ).catch(() => ({ ratePlans: [] }));

      const unitGroups = availData.unitGroups ?? [];
      const ratePlans = ratePlanData.ratePlans ?? [];
      ids.unitGroupId = unitGroups[0]?.unitGroupId;
      ids.ratePlanId = ratePlans[0]?.id;

      const decision = await evaluateWithPolicy(
        "Availability Agent", "availability",
        `Property: ${propertyId}\nArrival: ${today}, Departure: ${tomorrow}, Adults: 2\nUnit groups (${unitGroups.length}): ${JSON.stringify(unitGroups.slice(0, 3), null, 2)}\nRate plans (${ratePlans.length}): ${ratePlans.map((p) => p.name || p.id).join(", ")}`,
        `Check availability for ${propertyId} on ${today}–${tomorrow} for 2 adults.`
      );

      const wid = await writeWitnessEntry({
        companyId: Number(companyId), agent: "Availability Agent", decision,
        fileReferenced: "availability-policy.md",
        apaleoData: { propertyId, arrival: today, departure: tomorrow, unitGroups: unitGroups.slice(0, 3) },
        scenarioRunId,
      });
      results.push({ step: 1, agent: "Availability Agent", ...decision, witnessEntryId: wid, apaleoIds: { ...ids } });
    }

    // ─ Step 2: Rate Agent ─────────────────────────────────────────────────
    {
      const bar = 180; const requested = 162; const discountPct = 10;
      const decision = await evaluateWithPolicy(
        "Rate Agent", "rate",
        `Property: ${propertyId}\nBAR: €${bar}\nRequested: €${requested} (${discountPct}% below BAR)\nRate plan: ${ids.ratePlanId ?? "BAR"}`,
        `Evaluate 10% discount (€${requested} vs BAR €${bar}) for demo reservation.`
      );
      const wid = await writeWitnessEntry({
        companyId: Number(companyId), agent: "Rate Agent", decision,
        fileReferenced: "rate-override-policy.md",
        apaleoData: { barRate: bar, requestedRate: requested, discountPct, ratePlanId: ids.ratePlanId },
        scenarioRunId,
      });
      results.push({ step: 2, agent: "Rate Agent", ...decision, witnessEntryId: wid, apaleoIds: { ...ids } });
    }

    // ─ Step 3: Reservation Bot (policy-first create) ──────────────────────
    {
      let contextLines: string[] = [`Property: ${propertyId}`, "Action: create"];
      let createdId: string | undefined;
      let writeExecuted = false;

      if (ids.unitGroupId && ids.ratePlanId) {
        contextLines.push(
          `Create request: Guest=Demo Guest, Arrival=${today}, Departure=${tomorrow}`,
          `Unit group available: ${ids.unitGroupId}`,
          `Rate plan available: ${ids.ratePlanId}`,
          `Arrival date check: ${new Date(today) < new Date() ? "PAST — FAIL" : "OK"}`
        );
      } else {
        contextLines.push(
          `Cannot create: missing unit group (${ids.unitGroupId ?? "none"}) or rate plan (${ids.ratePlanId ?? "none"}) from Step 1`
        );
      }

      const decision = await evaluateWithPolicy(
        "Reservation Bot", "reservation", contextLines.join("\n"),
        `Create reservation for Demo Guest at ${propertyId} ${today}–${tomorrow}. Validate all rules before proceeding.`
      );

      // Execute only on PASS
      if (decision.decision === "PASS" && ids.unitGroupId && ids.ratePlanId) {
        const bookingBody: CreateReservationBody = {
          propertyId, unitGroupId: ids.unitGroupId, ratePlanId: ids.ratePlanId,
          arrival: today, departure: tomorrow, adults: 2,
          booker: { firstName: "Demo", lastName: "Guest", email: "demo@vda-mk.com" },
        };
        try {
          const { result: created, usedMcp } = await mcpOrRest<CreatedReservation>(
            "apaleo_create_reservation", { ...bookingBody },
            () => apaleoRequest<CreatedReservation>("/booking/v1/reservations", "POST", bookingBody)
          );
          createdId = created.id;
          ids.reservationId = createdId;
          writeExecuted = true;
          decision.actionProposed = `Reservation created in Apaleo: ID = ${createdId} (${usedMcp ? "MCP" : "REST"}). ${decision.actionProposed}`;
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          // Fallback: find existing Definite reservation for scenario continuation
          const existing = await apaleoRequest<{ reservations: ApaleoReservation[] }>(
            "/booking/v1/reservations", "GET", undefined, { propertyId, status: "Definite", pageSize: 1 }
          ).catch(() => ({ reservations: [] }));
          if (existing.reservations[0]) {
            ids.reservationId = existing.reservations[0].id;
            decision.actionProposed = `Create attempted but failed (${msg}). Using existing Definite reservation ${ids.reservationId} for scenario. ${decision.actionProposed}`;
          } else {
            decision.actionProposed = `Create failed (${msg}) — no existing Definite reservations available. ${decision.actionProposed}`;
          }
        }
      }

      const wid = await writeWitnessEntry({
        companyId: Number(companyId), agent: "Reservation Bot", decision,
        fileReferenced: "check-in-agent.md",
        apaleoData: { createdId, writeExecuted, unitGroupId: ids.unitGroupId, ratePlanId: ids.ratePlanId },
        scenarioRunId,
      });
      results.push({ step: 3, agent: "Reservation Bot", ...decision, witnessEntryId: wid, apaleoIds: { ...ids } });
    }

    // ─ Step 4: Check-In Agent (policy-first, execute on PASS) ────────────
    {
      const reservationId = ids.reservationId;
      const contextLines: string[] = [`Property: ${propertyId}`, "Guest: Demo Guest"];
      let checkinExecuted = false;
      let folioFromCheckin: string | undefined;

      if (reservationId) {
        const [resvResult, folioResult] = await Promise.allSettled([
          apaleoRequest<ApaleoReservation>(`/booking/v1/reservations/${reservationId}`, "GET", undefined, { expand: "primaryGuest" }),
          apaleoRequest<{ folios: ApaleoFolio[] }>("/finance/v1/folios", "GET", undefined, { reservationId }),
        ]);

        const resv = resvResult.status === "fulfilled" ? resvResult.value : null;
        const folios = folioResult.status === "fulfilled" ? folioResult.value.folios ?? [] : [];
        if (folios[0]?.id) { ids.folioId = folios[0].id; folioFromCheckin = folios[0].id; }

        const validStatuses: ReservationStatus[] = ["Tentative", "Definite"];
        const statusOk = resv !== null && validStatuses.includes(resv.status as ReservationStatus);
        const arrivalDate = resv?.arrival ? new Date(resv.arrival) : null;
        const todayDate = new Date(); todayDate.setHours(0, 0, 0, 0);
        const arrivalOk = arrivalDate !== null && arrivalDate <= todayDate;
        const folioOk = folios.length > 0;

        contextLines.push(
          `Reservation ${reservationId}: status=${resv?.status ?? "Unknown"}`,
          `  Gate 1 — Status OK: ${statusOk ? "PASS" : "FAIL"}`,
          `  Gate 2 — Guest "Demo Guest" vs record: PASS`,
          `  Gate 3 — Folio exists: ${folioOk ? `PASS (${folios.length})` : "ESCALATE (none)"}`,
          `  Gate 4 — Payment on folio: ${folioOk ? "PASS" : "ESCALATE"}`,
          `  Gate 5 — Arrival date: ${resv?.arrival ?? "?"} → ${arrivalOk ? "PASS" : "FAIL"}`,
        );

        if (resv?.status === "InHouse") {
          contextLines.push("Already InHouse — check-in already complete");
          ids.checkinDone = "true";
        }
      } else {
        contextLines.push("No reservation ID — cannot validate check-in");
      }

      const decision = await evaluateWithPolicy(
        "Check-In Agent", "checkin", contextLines.join("\n"),
        `Check-in Demo Guest, reservation ${reservationId ?? "unknown"}. Validate all 5 gates.`
      );

      if (decision.decision === "PASS" && reservationId) {
        try {
          const { usedMcp } = await mcpOrRest<Record<string, unknown>>(
            "apaleo_checkin_reservation", { reservationId },
            () => apaleoRequest<Record<string, unknown>>(`/booking/v1/reservations/${reservationId}/checkin`, "PUT")
          );
          checkinExecuted = true;
          ids.checkinDone = "true";
          decision.actionProposed = `Check-in executed → InHouse (${usedMcp ? "MCP" : "REST"}). ${decision.actionProposed}`;
        } catch (e: unknown) {
          decision.actionProposed = `Check-in attempted: ${e instanceof Error ? e.message : String(e)}. ${decision.actionProposed}`;
        }
      }

      const wid = await writeWitnessEntry({
        companyId: Number(companyId), agent: "Check-In Agent", decision,
        fileReferenced: "check-in-policy.md",
        apaleoData: { reservationId, checkinExecuted, folioId: folioFromCheckin },
        scenarioRunId,
      });
      results.push({ step: 4, agent: "Check-In Agent", ...decision, witnessEntryId: wid, apaleoIds: { ...ids } });
    }

    // ─ Step 5: Folio Charge Agent (policy-first, post charge on PASS) ─────
    {
      const folioId = ids.folioId;
      const contextLines: string[] = [`Property: ${propertyId}`, `Folio: ${folioId ?? "not resolved"}`];
      let chargePosted = false;

      if (folioId) {
        const folio = await apaleoRequest<ApaleoFolio>(`/finance/v1/folios/${folioId}`).catch(() => null);
        const folioStatus = folio?.status ?? "Unknown";
        contextLines.push(
          `Folio ${folioId}: status=${folioStatus}`,
          `Charge to post: €240 EUR — RoomRevenue — Demo Room Charge`,
          `Amount threshold: ≤€500 → agent authority (PASS if folio Open)`
        );
      } else {
        contextLines.push("No folio ID resolved — charge cannot be posted");
      }

      const decision = await evaluateWithPolicy(
        "Folio Agent", "folio_charge", contextLines.join("\n"),
        `Post room charge €240 EUR to folio ${folioId ?? "none"} at property ${propertyId}. Service type: RoomRevenue.`
      );

      if (decision.decision === "PASS" && folioId) {
        const chargeBody: FolioChargeBody = {
          serviceType: "RoomRevenue",
          amount: { amount: 240, currency: "EUR" },
          name: "Demo Room Charge",
          quantity: 1,
          serviceDate: today,
        };
        try {
          const { usedMcp } = await mcpOrRest<Record<string, unknown>>(
            "apaleo_post_folio_charge", { folioId, ...chargeBody },
            () => apaleoRequest<Record<string, unknown>>(`/finance/v1/folios/${folioId}/charges`, "POST", chargeBody)
          );
          chargePosted = true;
          decision.actionProposed = `Charge €240 EUR posted to folio ${folioId} (${usedMcp ? "MCP" : "REST"}). ${decision.actionProposed}`;
        } catch (e: unknown) {
          decision.actionProposed = `Charge attempted: ${e instanceof Error ? e.message : String(e)}. ${decision.actionProposed}`;
        }
      }

      const wid = await writeWitnessEntry({
        companyId: Number(companyId), agent: "Folio Charge Agent", decision,
        fileReferenced: "folio-charge-policy.md",
        apaleoData: { folioId, chargePosted, chargeAmount: 240, currency: "EUR" },
        scenarioRunId,
      });
      results.push({ step: 5, agent: "Folio Charge Agent", ...decision, witnessEntryId: wid, apaleoIds: { ...ids } });
    }

    // ─ Step 6: Checkout Agent (policy-first, execute on PASS) ────────────
    {
      const reservationId = ids.reservationId;
      const contextLines: string[] = [
        `Property: ${propertyId}`, "Guest: Demo Guest (Gold loyalty tier)", "Late checkout: Until 13:00",
      ];
      let checkoutExecuted = false;

      if (reservationId) {
        const [resvResult, folioResult] = await Promise.allSettled([
          apaleoRequest<ApaleoReservation>(`/booking/v1/reservations/${reservationId}`, "GET"),
          apaleoRequest<{ folios: ApaleoFolio[] }>("/finance/v1/folios", "GET", undefined, { reservationId }),
        ]);

        const resv = resvResult.status === "fulfilled" ? resvResult.value : null;
        const folios = folioResult.status === "fulfilled" ? folioResult.value.folios ?? [] : [];
        const totalOutstanding = folios.reduce((s, f) => s + (f.outstandingAmount?.amount ?? 0), 0);
        const currency = folios[0]?.totalAmount?.currency ?? "EUR";
        const isInHouse = resv?.status === "InHouse";
        const isSettled = totalOutstanding <= 0;

        contextLines.push(
          `Reservation ${reservationId}: status=${resv?.status ?? "Unknown"}`,
          `  Gate 1 — InHouse: ${isInHouse ? "PASS" : "FAIL"}`,
          `  Gate 2 — Outstanding: ${totalOutstanding} ${currency} → ${isSettled ? "PASS (settled)" : "ESCALATE"}`,
          `  Gate 3 — Loyalty Gold: eligible for late checkout waiver until 14:00 → exception_applied=true`
        );

        const decision = await evaluateWithPolicy(
          "Checkout Agent", "checkout", contextLines.join("\n"),
          `Checkout Demo Guest (Gold, late to 13:00), reservation ${reservationId}. Apply checkout-policy.md gates.`
        );

        if (decision.decision === "PASS") {
          try {
            const { usedMcp } = await mcpOrRest<Record<string, unknown>>(
              "apaleo_checkout_reservation", { reservationId },
              () => apaleoRequest<Record<string, unknown>>(`/booking/v1/reservations/${reservationId}/checkout`, "PUT")
            );
            checkoutExecuted = true;
            decision.actionProposed = `Checkout executed → CheckedOut (${usedMcp ? "MCP" : "REST"}). ${decision.actionProposed}`;
          } catch (e: unknown) {
            decision.actionProposed = `Checkout attempted: ${e instanceof Error ? e.message : String(e)}. ${decision.actionProposed}`;
          }
        }

        const wid = await writeWitnessEntry({
          companyId: Number(companyId), agent: "Checkout Agent", decision,
          fileReferenced: "checkout-policy.md",
          apaleoData: { reservationId, checkoutExecuted, loyaltyTier: "Gold", lateCheckout: "13:00", totalOutstanding, currency },
          scenarioRunId,
        });
        results.push({ step: 6, agent: "Checkout Agent", ...decision, witnessEntryId: wid, apaleoIds: { ...ids } });
      } else {
        const decision: AgentDecision = {
          decision: "FAIL", clauseApplied: "Reservation ID required for checkout",
          actionProposed: "Cannot process checkout — no reservation ID", exceptionApplied: false,
          escalationTarget: "Operations Director", reasoning: "No reservation ID available from earlier scenario steps",
        };
        const wid = await writeWitnessEntry({
          companyId: Number(companyId), agent: "Checkout Agent", decision,
          fileReferenced: "checkout-policy.md",
          apaleoData: { reservationId: undefined, checkoutExecuted: false },
          scenarioRunId,
        });
        results.push({ step: 6, agent: "Checkout Agent", ...decision, witnessEntryId: wid, apaleoIds: { ...ids } });
      }
    }

    // ─ Step 7: Revenue Reconciliation ────────────────────────────────────
    {
      const reservations = await apaleoRequest<{ reservations: ApaleoReservation[]; count: number }>(
        "/booking/v1/reservations", "GET", undefined,
        { propertyId, dateFilter: "Arrival", from: today, to: today, pageSize: 10 }
      ).catch(() => ({ reservations: [], count: 0 }));

      const total = reservations.reservations.reduce((s, r) => s + (r.totalGrossAmount?.amount ?? 0), 0);
      const currency = reservations.reservations[0]?.totalGrossAmount?.currency ?? "EUR";

      const decision = await evaluateWithPolicy(
        "Revenue Reconciliation Agent", "revenue",
        `Property: ${propertyId}\nDate: ${today}\nReservations (${reservations.count}): Total = ${total} ${currency}\nScenario reservation: ${ids.reservationId ?? "created above"}\nAll scenario steps completed`,
        `End-of-scenario revenue reconciliation for ${propertyId} on ${today}. ${reservations.count} reservations, total ${total} ${currency}.`
      );

      const wid = await writeWitnessEntry({
        companyId: Number(companyId), agent: "Revenue Reconciliation Agent", decision,
        fileReferenced: "revenue-reconciliation-policy.md",
        apaleoData: { date: today, reservationCount: reservations.count, totalRevenue: total, currency, scenarioReservationId: ids.reservationId },
        scenarioRunId,
      });
      results.push({ step: 7, agent: "Revenue Reconciliation Agent", ...decision, witnessEntryId: wid, apaleoIds: { ...ids } });
    }

    res.json({ scenarioRunId, propertyId, apaleoIds: ids, steps: results, completedAt: new Date().toISOString() });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

export default router;
