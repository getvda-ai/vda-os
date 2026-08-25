/**
 * stayExecutor.ts — executes an approved Stay Agent action against Apaleo via
 * MCP. Every intended mutation is recorded; when the write tool is unavailable
 * in the connected Apaleo MCP surface (common in sandbox), the action is marked
 * SANDBOX_NO_WRITE rather than faking success (per the brief).
 */
import { isMcpConfigured, listMcpTools, callMcpTool } from "./apaleo-mcp.js";
import { logger } from "./logger.js";

export interface StayExecution {
  status: "EXECUTED" | "SANDBOX_NO_WRITE";
  tool: string | null;
  args: Record<string, unknown>;
  result?: unknown;
  note?: string;
  /** Real Apaleo id returned by the write (e.g. the folio charge id) when EXECUTED. */
  apaleoId?: string;
}

/** Pull the property management system entity id out of an MCP result ({content:[{text:'{"data":{"id":...}}'}]}). */
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

// Map (stage, exception_class) → the property management system MCP write tool + args extracted from the card.
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
  const name = `A Hotel Berlin — ${chargeLabel[cls] ?? cls} (${currency} ${amount ?? ""})`.trim();

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
  // Service requests etc. have no Apaleo write.
  return { tool: null, args: {} };
}

export async function executeStayAction(payload: Record<string, unknown>): Promise<StayExecution> {
  const { tool, args } = pickToolAndArgs(payload);

  if (!tool) {
    return { status: "SANDBOX_NO_WRITE", tool: null, args: {}, note: "No property-system write is required for this exception class (operational only)." };
  }
  if (!isMcpConfigured()) {
    return { status: "SANDBOX_NO_WRITE", tool, args, note: "The property-system integration is not configured — intended mutation recorded, not executed." };
  }
  try {
    const tools = await listMcpTools();
    const available = tools.some((t) => t.name === tool);
    if (!available) {
      return { status: "SANDBOX_NO_WRITE", tool, args, note: `Write tool ${tool} is not exposed by the connected property-system surface — intended mutation recorded.` };
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
      return { status: "SANDBOX_NO_WRITE", tool, args, result, note: `The property system rejected the write: ${detail}` };
    }
    return { status: "EXECUTED", tool, args, result, apaleoId: extractApaleoId(result) };
  } catch (err) {
    logger.warn({ err, tool, args }, "[stayExecutor] MCP write failed — marking SANDBOX_NO_WRITE");
    return { status: "SANDBOX_NO_WRITE", tool, args, note: `MCP write failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
