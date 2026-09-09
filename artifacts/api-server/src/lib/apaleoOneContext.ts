/**
 * apaleoOneContext.ts — the boundary where Apaleo One's iframe context becomes
 * something this service is willing to act on.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT APALEO ACTUALLY GIVES US, AND WHAT IT DOES NOT
 *
 * A UI integration is an iframe. Apaleo appends context to the URL as plain query
 * parameters — `accountCode`, `propertyId`, `subjectId`, `lang` — and its own
 * documentation instructs the app to "check accountCode and subjectId with every
 * request".
 *
 * What Apaleo does NOT provide is a signed assertion of any of it. There is no
 * id_token, no JWT, no postMessage token exchange: the client-side API covers
 * navigation, notifications and language, and nothing else. So `subjectId` arrives
 * as a string a browser sent us. It identifies the user; it does not PROVE them.
 *
 * That distinction is the whole reason this file exists. A HITL approval whose
 * approver identity is a forgeable query parameter is not an approval — it is a
 * record of a claim. Both are legitimate; only one may be called authenticated,
 * and the difference has to survive all the way into the sealed evidence rather
 * than being flattened at the UI.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TWO ASSURANCE LEVELS
 *
 *   asserted   — subjectId came from the iframe URL. We know which Apaleo user
 *                the browser SAYS is looking. Good enough to route a queue and
 *                pre-fill a name; NOT good enough to call the decision theirs.
 *
 *   verified   — the operator completed an OAuth 2.0 authorization-code flow
 *                against identity.apaleo.com in this browser, and the subject it
 *                returned MATCHES the subjectId in the frame. Now the identity is
 *                Apaleo's own answer, not the frame's.
 *
 * `resolveActor()` in routes/stay.ts already models exactly this split
 * (`authenticated` vs `asserted`) and reads `x-authenticated-actor` for the
 * authenticated case — its own comment calls wiring a real session "the tracked
 * follow-up". This is that follow-up: verified context sets the header, asserted
 * context deliberately does not, and the seal tells the truth either way.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TENANCY — WHY THERE IS NO FALLBACK
 *
 * Resolution is an explicit (accountCode, propertyId) → companyId map, and an
 * unmapped pair is REFUSED. It would be a one-liner to default to company 1
 * instead, and that one-liner is a data-leak: two tenants in this database
 * already share the same Apaleo property (both BER), so "resolve by propertyId,
 * fall back to the first match" hands one hotel's decision queue to another. An
 * unconfigured property must look unconfigured.
 */

export type IdentityAssurance = 'asserted' | 'verified';

export interface ApaleoOneContext {
  accountCode: string;
  propertyId: string;
  subjectId: string;
  lang: string;
  companyId: number;
  assurance: IdentityAssurance;
  /** True when a shared integration secret is configured AND matched. */
  integrationTokenChecked: boolean;
}

export type ContextRefusal =
  | { reason: 'missing_context'; message: string; missing: string[] }
  | { reason: 'bad_integration_token'; message: string }
  | { reason: 'unmapped_property'; message: string; accountCode: string; propertyId: string };

export type ContextResult =
  | { ok: true; context: ApaleoOneContext }
  | { ok: false; refusal: ContextRefusal };

/** Apaleo identifiers are short, uppercase-ish codes. Bound them before they reach SQL or HTML. */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * (accountCode, propertyId) → companyId, from APALEO_ONE_TENANT_MAP.
 *
 * Shape: {"ACCT:BER": 40, "ACCT:AMS": 41}. A bare "*:BER" wildcard on the account
 * is accepted for single-account deployments, because during a sandbox demo the
 * account code is a constant and requiring it to be typed twice invites a typo
 * that presents as "unmapped property" in front of an audience.
 */
function tenantMap(): Record<string, number> {
  const raw = process.env.APALEO_ONE_TENANT_MAP;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const n = Number(v);
      if (Number.isInteger(n) && n >= 0) out[k.toUpperCase()] = n;
    }
    return out;
  } catch {
    // A malformed map must not silently become an empty map that then refuses
    // every property with "unmapped" — that misdiagnoses a config typo as a
    // provisioning gap. Surface it as its own refusal via the sentinel below.
    return { __malformed__: -1 };
  }
}

export function resolveCompanyId(accountCode: string, propertyId: string): number | null {
  const map = tenantMap();
  if (map.__malformed__ === -1) return null;
  const exact = map[`${accountCode}:${propertyId}`.toUpperCase()];
  if (Number.isInteger(exact)) return exact;
  const wildcard = map[`*:${propertyId}`.toUpperCase()];
  if (Number.isInteger(wildcard)) return wildcard;
  const single = Number(process.env.APALEO_ONE_COMPANY_ID);
  return Number.isInteger(single) && single >= 0 ? single : null;
}

/**
 * Read the Apaleo One frame context off a request.
 *
 * `verifiedSubject` is the subject returned by a completed auth-code flow for this
 * browser session, or null. Assurance is `verified` only when it is present AND
 * equals the frame's subjectId — a mismatch means the frame is describing a
 * different user than the one who actually logged in, which is downgraded rather
 * than resolved in the operator's favour.
 */
export function readContext(
  query: Record<string, unknown>,
  verifiedSubject: string | null,
): ContextResult {
  const str = (k: string): string => {
    const v = query[k];
    return typeof v === 'string' ? v.trim() : '';
  };
  const accountCode = str('accountCode');
  const propertyId = str('propertyId');
  const subjectId = str('subjectId');
  const lang = str('lang') || 'en';

  const missing = [
    ['accountCode', accountCode],
    ['propertyId', propertyId],
    ['subjectId', subjectId],
  ]
    .filter(([, v]) => !v || !ID_RE.test(v))
    .map(([k]) => k as string);

  if (missing.length) {
    return {
      ok: false,
      refusal: {
        reason: 'missing_context',
        missing,
        message:
          `Open this from Apaleo One. It needs ${missing.join(', ')} in the frame URL — ` +
          `Apaleo appends these automatically to a registered UI integration.`,
      },
    };
  }

  // Apaleo's own guidance for a private integration: put a long secret in the
  // registered URL so the service knows the request came from the integration it
  // configured. It is not user authentication and is not treated as such here —
  // it only establishes that the frame URL is ours.
  const expected = process.env.APALEO_ONE_INTEGRATION_TOKEN;
  let integrationTokenChecked = false;
  if (expected) {
    if (str('token') !== expected) {
      return {
        ok: false,
        refusal: {
          reason: 'bad_integration_token',
          message: 'This integration URL is not the one registered for this deployment.',
        },
      };
    }
    integrationTokenChecked = true;
  }

  const companyId = resolveCompanyId(accountCode, propertyId);
  if (companyId === null) {
    return {
      ok: false,
      refusal: {
        reason: 'unmapped_property',
        accountCode,
        propertyId,
        message:
          `Property ${propertyId} on account ${accountCode} is not provisioned for HITL authority. ` +
          `No queue is shown rather than one belonging to a different property.`,
      },
    };
  }

  return {
    ok: true,
    context: {
      accountCode,
      propertyId,
      subjectId,
      lang,
      companyId,
      assurance: verifiedSubject && verifiedSubject === subjectId ? 'verified' : 'asserted',
      integrationTokenChecked,
    },
  };
}

/**
 * How the approver is described in the seal. Verified identity flows through the
 * `x-authenticated-actor` seam that resolveActor() already honours; asserted
 * identity deliberately does not, so provenance lands as "asserted" in the record
 * without anyone having to remember to downgrade it.
 */
export function actorHeadersFor(ctx: ApaleoOneContext): Record<string, string> {
  return ctx.assurance === 'verified'
    ? { 'x-authenticated-actor': `apaleo:${ctx.subjectId}` }
    : {};
}
