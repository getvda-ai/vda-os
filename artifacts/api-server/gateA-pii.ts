/* GATE A — free-text PII scrub. Feeds known guest PII into EVERY free-text field,
 * builds the exact seal body that would be transmitted, and asserts on the built
 * payload WITHOUT transmitting. Hard stop: any surviving PII fails the gate. */
import { buildSealBody, collectGuestPii, scrubText } from "./src/lib/sealOutbox.js";

const PII = {
  name: "Jane Smith",
  email: "jane.smith@example.com",
  passport: "X1234",
  phone: "+49 170 1234567",
  reservation: "BER-2026-88231",
};
const FORBIDDEN = [PII.name, "Jane", "Smith", PII.email, PII.passport, PII.phone.replace(/\s/g, ""), PII.reservation];

function assertClean(label: string, body: unknown): boolean {
  const blob = JSON.stringify(body);
  const leaks = FORBIDDEN.filter((t) => blob.replace(/\s/g, "").includes(t.replace(/\s/g, "")));
  console.log(`\n[${label}]`);
  console.log("  payload:", blob);
  if (leaks.length) { console.log("  LEAKED:", JSON.stringify(leaks), "→ FAIL"); return false; }
  console.log("  no PII in name/email/passport/phone/raw-reservation → PASS");
  return true;
}

let ok = true;

// Case 1 — production path: guest PII lives in the Apaleo data (denylist source)
// AND is echoed into every free-text field. This mirrors a real sealed decision.
const apaleoData = {
  reservation: { id: PII.reservation, primaryGuest: { firstName: "Jane", lastName: "Smith", email: PII.email, phone: PII.phone, nationalId: PII.passport } },
  folio: { currency: "EUR" },
};
const body1 = buildSealBody({
  agent: "Stay Agent",
  verdict: "PASS",
  reasoning: `guest ${PII.name} (${PII.email}), passport ${PII.passport}, phone ${PII.phone}, asked for late checkout — within ceiling`,
  actionProposed: `Amend reservation ${PII.reservation} for ${PII.name} to depart 2026-07-11`,
  inputsRaw: { reservationId: PII.reservation, folioId: "FOL-9", propertyId: "BER", amount: 120, currency: "EUR", stage: "in_stay", verdict: "PASS", guestName: PII.name, email: PII.email },
  ruleId: "stay-agent.SOP.md",
  ruleText: `Late-checkout exception for ${PII.name} (${PII.email}) auto-approves within the ceiling.`,
  piiDenylist: collectGuestPii(apaleoData),
});
ok = assertClean("Case 1 — production path (denylist from Apaleo data)", body1) && ok;
// Also confirm the decision facts survived (evidence value retained).
const facts = body1.decision.inputs as Record<string, unknown>;
console.log("  facts retained:", facts.amount === 120 && facts.currency === "EUR" && facts.stage === "in_stay" ? "PASS" : "FAIL", "| reservation pseudonymized:", String(facts.reservation_ref).startsWith("res:") ? "PASS" : "FAIL");

// Case 2 — backstop: NO denylist supplied (unknown guest). Structural regex +
// name-trigger heuristics must still catch email/passport/phone/name.
const body2 = buildSealBody({
  agent: "Stay Agent",
  verdict: "ESCALATE",
  reasoning: `guest ${PII.name} emailed ${PII.email} from ${PII.phone}; passport ${PII.passport}. Requests early checkout.`,
  actionProposed: `Contact ${PII.email}`,
  inputsRaw: { stage: "check_out", amount: 0 },
  ruleId: "stay-agent.EXCEPTION_AUTHORITY.md",
  ruleText: `Escalate refunds above ceiling; note guest ${PII.name}.`,
  piiDenylist: [], // deliberately empty — prove the backstop
});
ok = assertClean("Case 2 — backstop (no denylist; regex + name-trigger only)", body2) && ok;

// Case 3 — unit: scrubText directly on the raw free-text field.
const scrubbed = scrubText(`guest ${PII.name} (${PII.email}) passport ${PII.passport} tel ${PII.phone}`, [PII.reservation]);
ok = assertClean("Case 3 — scrubText unit", { s: scrubbed }) && ok;

console.log(`\n=== GATE A: ${ok ? "GREEN (no PII survives any free-text field)" : "RED — PII leaked, DO NOT DEPLOY"} ===`);
process.exit(ok ? 0 : 1);
