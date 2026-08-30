/**
 * stayExecutor.ts — executes an approved Stay Agent action against Apaleo via
 * MCP. Every intended mutation is recorded; when the write tool is unavailable
 * in the connected Apaleo MCP surface (common in sandbox), the action is marked
 * SANDBOX_NO_WRITE rather than faking success (per the brief).
 */
import { isMcpConfigured, listMcpTools, callMcpTool } from "./apaleo-mcp.js";
import { STAY_SCENARIOS, scenarioForClass } from "./stayScopeMap.js";
import { logger } from "./logger.js";

export interface StayExecution {
  status: "EXECUTED" | "SANDBOX_NO_WRITE";
  tool: string | null;
  args: Record<string, unknown>;
  result?: unknown;
  note?: string;
  /** Real Apaleo id returned by the write (e.g. the folio charge id) when EXECUTED. */
  apaleoId?: string;
  /**
   * The Apaleo OAuth scope this write is performed under, and the REST endpoint that
   * scope protects. Carried on the RESULT rather than assumed by the UI, so the console
   * reports the scope that was actually reached for — including when the write staged.
   * null for classes with no property-system call (governance-layer only).
   */
  scope?: string | null;
  endpoint?: string | null;
}

/** Pull the Apaleo entity id out of an MCP result ({content:[{text:'{"data":{"id":...}}'}]}). */
function extractApaleoId(result: unknown): string | undefined {
  try {
    const content = (result as { content?: Array<{ text?: string }> })?.content ?? [];
    const text = content.map((c) => c.text ?? "").join("");
    const parsed = JSON.parse(text);
    return parsed?.data?.id ?? parsed?.id;
  } catch {
    return undefined;
  }
}

// Map (stage, exception_class) → the Apaleo MCP write tool + args extracted from the card.
function pickToolAndArgs(payload: Record<string, unknown>): { tool: string | null; args: Record<string, unknown> } {
  const stage = String(payload.stage ?? "");
  const cls = String(payload.exception_class ?? "");
  const apaleo = (payload.apaleo_data ?? {}) as Record<string, unknown>;
  const ref = (payload.apaleo_ref ?? {}) as Record<string, unknown>;
  const reservation = (apaleo.reservation ?? {}) as Record<string, unknown>;
  const folio = (apaleo.folio ?? {}) as Record<string, unknown>;
  const folios = (apaleo.folios as { folios?: Array<{ id?: string }> } | undefined)?.folios ?? [];
  // MCP param names are snake_case; folio/reservation ids resolved from ref → snapshot.
  const reservationId = (ref.reservationId ?? apaleo.reservationId ?? reservation.id ?? payload.reservation_id) as string | undefined;
  const folioId = (ref.folioId ?? folio.id ?? folios[0]?.id ?? apaleo.folioId ?? payload.folio_id) as string | undefined;
  const amount = (payload.financial_exposure ?? (payload.ceiling_band as Record<string, unknown>)?.requested_value) as number | undefined;
  const currency = (payload.currency as string) ?? "EUR";

  // (stage, class) → Apaleo MCP write tool + exact confirmed args.
  const chargeService: Record<string, string> = {
    folio_post_charge: "FoodAndBeverages",
    damage_incidental_charge: "Other",
    goodwill_credit: "Other",
    refund_folio_adjustment: "Other",
  };
  // Clean, deterministic, guest-facing charge line name (never the LLM's fallback text).
  const chargeLabel: Record<string, string> = {
    folio_post_charge: "F&B / minibar charge",
    damage_incidental_charge: "Damage / incidental charge",
    goodwill_credit: "Goodwill credit",
    refund_folio_adjustment: "Folio adjustment",
  };
  const name = `citizenM — ${chargeLabel[cls] ?? cls} (${currency} ${amount ?? ""})`.trim();

  if (stage === "check_in" && (cls === "early_checkin" || cls === "key_issuance" || cls === "registration_id_capture" || cls === "preauth_validation")) {
    return { tool: "CheckIn", args: { id: reservationId } };
  }
  if (stage === "check_out" && (cls === "late_checkout" || cls === "folio_settlement")) {
    return { tool: "CheckOut", args: { id: reservationId } };
  }
  if (cls in chargeService) {
    return {
      tool: "CreateFolioCharge",
      args: {
        folio_id: folioId,
        body: {
          serviceType: chargeService[cls],
          vatType: "Normal",
          name,
          amount: { amount, currency },
        },
      },
    };
  }
  if (cls === "room_upgrade_checkin" || cls === "room_move_rekey" || cls === "stay_extension" || cls === "early_checkout") {
    // Early checkout = shorten the reservation (folio recalc + night release follow).
    return { tool: "AmendReservation", args: { id: reservationId } };
  }
  // A discount below BAR is a rate write, not a reservation write — a different Apaleo
  // scope (rates.manage) and a different endpoint, which is exactly the point the
  // scenario is making. The rate-plan id is required; without one there is nothing to
  // write to and the action stages rather than guessing at a rate plan.
  if (cls === "rate_override") {
    const ratePlanId = (ref.ratePlanId ?? apaleo.ratePlanId ?? payload.rate_plan_id) as string | undefined;
    return { tool: "UpdateRatePlanRates", args: { id: ratePlanId, body: payload.rate_override_body ?? {} } };
  }
  // Force-manage amends a reservation THROUGH a restriction. Same tool as an ordinary
  // amend, but the authority being exercised is reservations.force-manage, not
  // reservations.manage — the scope is the difference, not the call.
  if (cls === "force_manage_override") {
    return { tool: "AmendReservation", args: { id: reservationId } };
  }
  // feature_enablement is governance-layer only: there is deliberately no property-system
  // write to make. Falls through to `tool: null` with the rest.
  // Service requests etc. have no Apaleo write.
  return { tool: null, args: {} };
}

/**
 * Fail loudly if the scope panel would name a tool this executor does not actually call.
 * The console renders `STAY_SCENARIOS[].tool` as "the Apaleo call this approval makes";
 * if that ever drifts from `pickToolAndArgs`, the demo asserts an integration point that
 * does not exist — in front of the people who built the integration. Called at boot.
 */
export function assertExecutorAgreement(): void {
  for (const sc of STAY_SCENARIOS) {
    const { tool } = pickToolAndArgs({ stage: sc.stage, exception_class: sc.exceptionClass });
    if (tool !== sc.tool) {
      throw new Error(
        `[stayExecutor] scope map disagrees with the executor for "${sc.exceptionClass}": ` +
          `stayScopeMap says ${sc.tool ?? "null"}, pickToolAndArgs routes to ${tool ?? "null"}.`,
      );
    }
  }
}

export async function executeStayAction(payload: Record<string, unknown>): Promise<StayExecution> {
  const { tool, args } = pickToolAndArgs(payload);
  // The scope is a property of the CLASS, not of whether the write succeeded — a blocked
  // or staged action still names the boundary it was stopped at. Resolved once here so
  // every return path below carries it.
  const sc = scenarioForClass(String(payload.exception_class ?? ""));
  const scope = sc?.scope ?? null;
  const endpoint = sc?.endpoint ?? null;

  if (!tool) {
    return { status: "SANDBOX_NO_WRITE", tool: null, args: {}, scope, endpoint, note: "No Apaleo write is required for this exception class (operational only)." };
  }
  if (!isMcpConfigured()) {
    return { status: "SANDBOX_NO_WRITE", tool, args, scope, endpoint, note: "Apaleo MCP is not configured — intended mutation recorded, not executed." };
  }
  try {
    const tools = await listMcpTools();
    const available = tools.some((t) => t.name === tool);
    if (!available) {
      return { status: "SANDBOX_NO_WRITE", tool, args, scope, endpoint, note: `Write tool ${tool} is not exposed by the connected Apaleo MCP surface — intended mutation recorded.` };
    }
    const result = await callMcpTool(tool, args);
    // An MCP tool can return a structured error result without throwing. That is
    // NOT a successful mutation — record the intended write and mark it so, rather
    // than claiming EXECUTED.
    const isError = (result as { isError?: boolean } | null)?.isError === true;
    if (isError) {
      const detail = ((result as { content?: Array<{ text?: string }> })?.content ?? [])
        .map((c) => c.text ?? "")
        .join(" ")
        .slice(0, 300);
      return { status: "SANDBOX_NO_WRITE", tool, args, result, scope, endpoint, note: `Apaleo MCP rejected the write: ${detail}` };
    }
    return { status: "EXECUTED", tool, args, result, scope, endpoint, apaleoId: extractApaleoId(result) };
  } catch (err) {
    logger.warn({ err, tool, args }, "[stayExecutor] MCP write failed — marking SANDBOX_NO_WRITE");
    return { status: "SANDBOX_NO_WRITE", tool, args, scope, endpoint, note: `MCP write failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
