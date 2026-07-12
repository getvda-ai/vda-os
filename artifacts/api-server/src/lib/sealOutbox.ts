/**
 * sealOutbox.ts — durable, fail-open, off-critical-path sealing to VDA Witness.
 *
 * A governed decision does NOT wait on Witness. It enqueues a PII-minimized seal
 * row (a fast local write) and returns; a background drain seals it with bounded
 * retry. Witness down → the hotel op still completed, the seal lands later from
 * the outbox, nothing is lost, and exhausted rows go to a visible dead-letter.
 *
 * Idempotency: the outbox is UNIQUE on (companyId, decisionId) and Witness itself
 * dedups on (account, decisionId) — replaying a decision never double-seals.
 *
 * GDPR: minimizeInputs() is the ONLY thing that shapes what gets sealed. Witness
 * records are immutable + externally anchored → un-erasable, so we seal ONLY
 * pseudonymous ids + decision facts. Raw guest PII stays in the operational DB.
 */
import { createHash } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { db, sealOutbox, witnessEntries } from "@workspace/db";
import { sealRecord, verifyOffline, isWitnessEnabled, type SealBody } from "./witnessClient.js";
import { logger } from "./logger.js";

const MAX_ATTEMPTS = 6;

/** Stable, non-reversible pseudonym for a guest/reservation identifier. */
export function pseudonymize(value: unknown, ns = "res"): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return `${ns}:${createHash("sha256").update(String(value)).digest("hex").slice(0, 16)}`;
}

// Keys that carry raw PII and must NEVER reach a seal.
const PII_KEYS = /name|email|phone|guest|first|last|passport|document|dob|birth|address|street|card|iban|note|comment|free.?text/i;

/**
 * Reduce raw engine decision facts to a PII-free, seal-safe input object.
 * Reservation/guest ids are pseudonymized; anything PII-shaped is dropped.
 */
export function minimizeInputs(raw: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {
    reservation_ref: pseudonymize(raw.reservationId ?? raw.reservation_id ?? raw.bookingId),
    folio_id: raw.folioId ?? raw.folio_id,
    property: raw.propertyId ?? raw.property,
    unit_group: raw.unitGroup ?? raw.unit_group,
    stage: raw.stage ?? raw.phase,
    exception_class: raw.exception_class ?? raw.class,
    amount: raw.amount,
    requested_value: raw.requested_value,
    ceiling_evaluated: raw.ceiling_evaluated ?? raw.ceiling,
    ceiling_type: raw.ceiling_type,
    ceiling_band: raw.ceiling_band,
    within_ceiling: raw.within_ceiling,
    currency: raw.currency,
    nights: raw.nights,
    governance_source: raw.governance_source ?? raw.governanceRef,
    phase: raw.phase,
    role_band: raw.role_band,
    apaleo_charge_id: raw.apaleo_charge_id ?? raw.chargeId,
    outcome: raw.outcome ?? raw.verdict,
  };
  // Belt-and-braces: strip undefined + any accidentally-PII-shaped keys/values.
  for (const k of Object.keys(out)) {
    if (out[k] === undefined || PII_KEYS.test(k)) delete out[k];
  }
  return out;
}

// ── Free-text PII scrubbing ────────────────────────────────────────────────
// A sealed record is immutable + externally anchored → un-erasable. minimizeInputs
// handles the structured `inputs`, but the free-text fields (reasoning,
// actionProposed, governingRule.ruleText) are LLM/authoring output that can carry a
// guest name/email/doc number. buildSealBody() routes EVERY seal through here so no
// free-text PII can ever reach Witness. Two layers: (1) an exact denylist of the
// guest identifiers we actually hold (the production guarantee), and (2) structural
// regex + name-trigger heuristics (the backstop for values we don't know about).
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const PHONE_RE = /(?<!\d)\+?\d[\d\s().-]{7,}\d(?!\d)/g;
// Mixed alphanumeric token with >=1 letter and >=1 digit, length >=5 (passport /
// document / card-ish). Pure-digit amounts and pure-letter words are left alone.
const DOCNUM_RE = /\b(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{5,}\b/g;
const NAME_TRIGGER_RE = /\b(guests?|mr|mrs|ms|miss|dr|prof|name|customer|travell?er)\b[:.\s]+([A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){0,2})/g;
const REDACTED = "[redacted]";

function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/** Redact known guest identifiers (denylist) + structural PII from a free-text field. */
export function scrubText(text: unknown, denylist: string[] = []): string {
  let s = typeof text === "string" ? text : text == null ? "" : String(text);
  if (!s) return s;
  // Layer 1 — exact denylist (whole phrase + each name token of length >=3).
  const terms = new Set<string>();
  for (const raw of denylist) {
    const v = String(raw ?? "").trim();
    if (v.length >= 3) terms.add(v);
    for (const tok of v.split(/\s+/)) if (tok.length >= 3) terms.add(tok);
  }
  for (const t of [...terms].sort((a, b) => b.length - a.length)) {
    s = s.replace(new RegExp(escapeRe(t), "gi"), REDACTED);
  }
  // Layer 2 — structural patterns.
  s = s.replace(EMAIL_RE, REDACTED).replace(PHONE_RE, REDACTED).replace(DOCNUM_RE, REDACTED);
  s = s.replace(NAME_TRIGGER_RE, (_m, trig) => `${trig} ${REDACTED}`);
  return s;
}

// Belt-and-braces guard: a sealed record is permanent + anchored, so `reasoning`
// must be clean PROSE — never a fenced code block or a raw JSON completion dump. The
// engine already parses the model output; this is the last line of defence at the
// seal choke point.
let sanitizedReasonings = 0;
export function reasoningSanitizedCount(): number { return sanitizedReasonings; }
export function cleanReasoning(text: unknown): string {
  const original = (typeof text === "string" ? text : text == null ? "" : String(text)).trim();
  if (!original) return original;
  // If it IS a raw JSON envelope, try to pull the prose out of it, else mark.
  if (/^[[{]/.test(original) && /[}\]]$/.test(original)) {
    try {
      const o = JSON.parse(original) as Record<string, unknown>;
      const prose = (o.reasoning ?? o.rationale ?? o.explanation);
      if (typeof prose === "string" && prose.trim()) { sanitizedReasonings++; return prose.trim(); }
    } catch { /* not valid JSON — fall through */ }
    sanitizedReasonings++;
    return "[unparsed model output — not sealed raw]";
  }
  // Strip any fenced code blocks; if that removes everything, mark it.
  const stripped = original.replace(/```[\s\S]*?```/g, " ").replace(/```/g, " ").replace(/\s+/g, " ").trim();
  if (stripped !== original) sanitizedReasonings++;
  return stripped || "[unparsed model output — not sealed raw]";
}

/** Recursively collect guest-identity values from an Apaleo data blob for the denylist. */
export function collectGuestPii(obj: unknown, acc: string[] = [], depth = 0): string[] {
  if (!obj || depth > 6) return acc;
  if (Array.isArray(obj)) { for (const v of obj) collectGuestPii(v, acc, depth + 1); return acc; }
  if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim() && /email|phone|mobile|firstname|lastname|middlename|surname|fullname|\bname\b|document|passport|nationalid|national_id|taxid|dateofbirth|dob/i.test(k)) {
        acc.push(v.trim());
      } else if (v && typeof v === "object") {
        collectGuestPii(v, acc, depth + 1);
      }
    }
  }
  return acc;
}

export interface SealBodyArgs {
  agent: string;
  verdict: string;
  reasoning: string;
  actionProposed?: string;
  inputsRaw?: Record<string, unknown>;
  ruleId: string;
  ruleText: string;
  ruleRef?: string;
  ruleHash?: string;
  /** Raw guest identifiers to redact exactly from free-text (name/email/doc/phone/raw ids). */
  piiDenylist?: string[];
}

/**
 * The ONE place a Stay-Agent seal body is constructed. Guarantees: inputs are
 * minimized, every free-text field is PII-scrubbed, and the raw reservation id is
 * never emitted verbatim (only its pseudonym survives, in inputs).
 */
export function buildSealBody(a: SealBodyArgs): { decision: SealBody["decision"]; governingRule: SealBody["governingRule"] } {
  const deny = [...(a.piiDenylist ?? [])];
  // Ensure the raw reservation id (if present in inputs) is scrubbed from free-text.
  const rawRes = a.inputsRaw?.reservationId ?? a.inputsRaw?.reservation_id ?? a.inputsRaw?.bookingId;
  if (rawRes) deny.push(String(rawRes));
  return {
    decision: {
      agent: a.agent,
      verdict: a.verdict,
      // cleanReasoning() FIRST (strip fences / raw JSON → prose or marker), then scrub PII.
      reasoning: scrubText(cleanReasoning(a.reasoning), deny),
      actionProposed: a.actionProposed ? scrubText(a.actionProposed, deny) : undefined,
      inputs: minimizeInputs(a.inputsRaw ?? {}),
    },
    governingRule: {
      ruleId: a.ruleId,
      ruleText: scrubText(a.ruleText, deny),
      governanceRef: a.ruleRef,
      governanceHash: a.ruleHash,
    },
  };
}

export interface EnqueueArgs {
  companyId: number;
  chainKey: string;
  decisionId: string;
  decision: SealBody["decision"];
  governingRule: SealBody["governingRule"];
  localWitnessId?: number | null;
}

/** Idempotent enqueue (never throws — enqueue must not break the hotel op). */
export async function enqueueSeal(args: EnqueueArgs): Promise<void> {
  try {
    await db
      .insert(sealOutbox)
      .values({
        companyId: args.companyId,
        chainKey: args.chainKey,
        decisionId: args.decisionId,
        payload: { decision: args.decision, governingRule: args.governingRule },
        localWitnessId: args.localWitnessId ?? null,
        status: "pending",
      })
      .onConflictDoNothing({ target: [sealOutbox.companyId, sealOutbox.decisionId] });
    if (args.localWitnessId) {
      await db.update(witnessEntries).set({ witnessState: "pending" }).where(eq(witnessEntries.id, args.localWitnessId));
    }
  } catch (err) {
    // Even the enqueue is best-effort: a governed op must never fail on sealing.
    logger.warn({ err, decisionId: args.decisionId }, "[outbox] enqueue failed (op unaffected)");
  }
}

export interface DrainResult { processed: number; sealed: number; failed: number; dead: number }

/** Drain pending rows to Witness. Safe to call from a cron, a request, or a test. */
export async function drainSealOutbox(limit = 25): Promise<DrainResult> {
  if (!isWitnessEnabled()) return { processed: 0, sealed: 0, failed: 0, dead: 0 };
  const rows = await db
    .select()
    .from(sealOutbox)
    .where(and(eq(sealOutbox.status, "pending"), lt(sealOutbox.attempts, MAX_ATTEMPTS)))
    .orderBy(sealOutbox.id)
    .limit(limit);

  let sealed = 0, failed = 0, dead = 0;
  for (const row of rows) {
    const payload = row.payload as { decision: SealBody["decision"]; governingRule: SealBody["governingRule"] };
    const res = await sealRecord({
      decision: payload.decision,
      governingRule: payload.governingRule,
      chainKey: row.chainKey,
      decisionId: row.decisionId,
    });

    if (res.ok && res.record) {
      const rec = res.record;
      const ref = {
        recordId: rec.recordId ?? rec.id,
        seq: rec.seq,
        chainKey: row.chainKey,
        decisionId: row.decisionId,
        record: rec,
      };
      let state = "SIGNED_PENDING";
      try { const v = await verifyOffline(rec, [rec]); state = (v as { state?: string }).state ?? state; } catch { /* verify is advisory */ }
      await db.update(sealOutbox).set({ status: "sealed", recordRef: ref, sealedAt: new Date(), lastError: null }).where(eq(sealOutbox.id, row.id));
      if (row.localWitnessId) {
        await db.update(witnessEntries).set({ witnessSealRef: ref, witnessState: state }).where(eq(witnessEntries.id, row.localWitnessId));
      }
      sealed++;
    } else {
      // TERMINAL errors (configured_key_rejected / account_mismatch) fail LOUD and
      // immediately — no bounded retry, no re-mint, no reseal into another account.
      // The seal is a visible dead-letter (an evidence gap), NOT a silent wrong-
      // account "success". The hotel operation already completed (fail-open).
      const attempts = row.attempts + 1;
      const isDead = res.terminal === true || attempts >= MAX_ATTEMPTS;
      const lastError = res.code ? `${res.code}: ${res.error ?? ""}`.trim() : (res.error ?? "unknown");
      await db.update(sealOutbox).set({ attempts, lastError, status: isDead ? "dead" : "pending" }).where(eq(sealOutbox.id, row.id));
      if (row.localWitnessId && isDead) {
        await db.update(witnessEntries).set({ witnessState: "unsealed" }).where(eq(witnessEntries.id, row.localWitnessId));
      }
      if (isDead) dead++; else failed++;
      // A key/renewal problem is systemic — it affects EVERY pending row. Stop
      // draining this cycle rather than hammering the same failure (and, for
      // renewal, rather than triggering a 429 storm). Remaining rows stay pending
      // (recover on the next drain once the key/renewal is healthy) or dead-letter.
      if (res.code === "configured_key_rejected" || res.code === "account_mismatch" || res.code === "renewal_failed") {
        logger.error({ code: res.code }, "[outbox] halting drain — key/renewal problem is systemic; remaining seals stay pending");
        break;
      }
    }
  }
  return { processed: rows.length, sealed, failed, dead };
}

/** Outbox status counts (for the Witness tab + health checks). */
export async function outboxHealth(companyId?: number): Promise<Record<string, number>> {
  const rows = await db
    .select({ status: sealOutbox.status, n: sql<number>`count(*)::int` })
    .from(sealOutbox)
    .where(companyId ? eq(sealOutbox.companyId, companyId) : sql`true`)
    .groupBy(sealOutbox.status);
  const out: Record<string, number> = { pending: 0, sealed: 0, dead: 0 };
  for (const r of rows) out[r.status] = r.n;
  out.reasoning_sanitized = sanitizedReasonings; // seals whose reasoning was fence/JSON-stripped or marked
  return out;
}
