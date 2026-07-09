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
}

// Map (stage, exception_class) → the Apaleo MCP write tool + args extracted from the card.
function pickToolAndArgs(payload: Record<string, unknown>): { tool: string | null; args: Record<string, unknown> } {
  const stage = String(payload.stage ?? "");
  const cls = String(payload.exception_class ?? "");
  const apaleo = (payload.apaleo_data ?? {}) as Record<string, unknown>;
  const reservation = (apaleo.reservation ?? {}) as Record<string, unknown>;
  const reservationId = (apaleo.reservationId ?? reservation.id ?? payload.reservation_id) as string | undefined;
  const folioId = (apaleo.folioId ?? payload.folio_id) as string | undefined;
  const amount = (payload.financial_exposure ?? (payload.ceiling_band as Record<string, unknown>)?.requested_value) as number | undefined;

  const chargeClasses = new Set(["folio_post_charge", "goodwill_credit", "damage_incidental_charge", "refund_folio_adjustment"]);
  const amendClasses = new Set(["room_upgrade_checkin", "room_move_rekey", "stay_extension"]);

  if (stage === "check_in" && (cls === "early_checkin" || cls === "key_issuance" || cls === "registration_id_capture" || cls === "preauth_validation")) {
    return { tool: "CheckIn", args: { reservationId } };
  }
  if (stage === "check_out" && (cls === "late_checkout" || cls === "folio_settlement")) {
    return { tool: "CheckOut", args: { reservationId } };
  }
  if (chargeClasses.has(cls)) {
    return { tool: "CreateFolioCharge", args: { folioId, amount, currency: payload.currency ?? "EUR", name: cls } };
  }
  if (amendClasses.has(cls)) {
    return { tool: "AmendReservation", args: { reservationId } };
  }
  // Service requests etc. have no Apaleo write.
  return { tool: null, args: {} };
}

export async function executeStayAction(payload: Record<string, unknown>): Promise<StayExecution> {
  const { tool, args } = pickToolAndArgs(payload);

  if (!tool) {
    return { status: "SANDBOX_NO_WRITE", tool: null, args: {}, note: "No Apaleo write is required for this exception class (operational only)." };
  }
  if (!isMcpConfigured()) {
    return { status: "SANDBOX_NO_WRITE", tool, args, note: "Apaleo MCP is not configured — intended mutation recorded, not executed." };
  }
  try {
    const tools = await listMcpTools();
    const available = tools.some((t) => t.name === tool);
    if (!available) {
      return { status: "SANDBOX_NO_WRITE", tool, args, note: `Write tool ${tool} is not exposed by the connected Apaleo MCP surface — intended mutation recorded.` };
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
      return { status: "SANDBOX_NO_WRITE", tool, args, result, note: `Apaleo MCP rejected the write: ${detail}` };
    }
    return { status: "EXECUTED", tool, args, result };
  } catch (err) {
    logger.warn({ err, tool, args }, "[stayExecutor] MCP write failed — marking SANDBOX_NO_WRITE");
    return { status: "SANDBOX_NO_WRITE", tool, args, note: `MCP write failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
