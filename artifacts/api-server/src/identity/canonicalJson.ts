/**
 * canonicalJson.ts — deterministic JSON serialization for anything Stay Agent signs.
 *
 * This is a byte-for-byte reimplementation of onboard.getvda.ai's `canonicalJson`
 * (`src/identity/agent-card.ts`). It is duplicated rather than imported because Stay Agent
 * is the OUTSIDE party — it shares no package with the suite, and the verifier must be able
 * to check our signature without trusting our code. If the two ever diverge, every Stay
 * signature fails verification at the admission gate, so treat this as a frozen contract:
 * sort keys, no whitespace, recurse into arrays and objects.
 *
 * `undefined` is the one input this cannot represent (JSON.stringify(undefined) is not a
 * string), so `canonicalBytes` strips undefined-valued keys first — the same thing
 * JSON.stringify does — rather than emitting the literal text "undefined".
 */

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}

/** Canonical UTF-8 bytes of `value`, excluding the top-level keys in `omit`. */
export function canonicalBytes(value: object, omit: string[] = []): Buffer {
  const rest: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  for (const k of omit) delete rest[k];
  return Buffer.from(canonicalJson(rest), "utf8");
}
