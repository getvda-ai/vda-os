/**
 * apaleoAuthority.ts — the authority ladder, DERIVED FROM APALEO'S OWN ROLE MODEL.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CLAIM THIS FILE EXISTS TO MAKE
 *
 * We did not invent an escalation ladder for hospitality and then look for places
 * to bolt it onto Apaleo. We read Apaleo's role model and wrote down where its
 * own permission boundaries fall. The Ambassador → Manager-on-Duty boundary in
 * this product IS the Junior Front Desk → Senior Reservation Manager boundary in
 * Apaleo. Nothing about it is ours.
 *
 * That matters because of the structural gap Apaleo's model has for agents:
 * scopes are BINARY. An application either holds `folios.payment-with-charges`
 * or it does not. There is no "up to €200 autonomously, above that ask a human",
 * and no escalation path inside the scope model. So an agent granted a scope in
 * order to do the routine 95% necessarily also holds the authority to do the
 * dangerous 5%.
 *
 * The HITL layer adds exactly one thing: a THRESHOLD inside a scope Apaleo can
 * only grant wholesale. It does not replace the role model, does not re-implement
 * permissions, and never grants authority Apaleo has not already granted. It can
 * only ever be MORE restrictive than the OAuth client's scope set — never less.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE THE FACTS COME FROM
 *
 * The role → permission mapping below is Apaleo's published user-role model, as
 * mapped against citizenM's operational hierarchy in the Munich workshop material
 * (Day 1, "Apaleo's Existing Authority Model"). The scope → role assignments are
 * Apaleo's OAuth scopes as documented, assigned to the LOWEST role that holds the
 * equivalent authority for a human user.
 *
 * "Lowest role that holds it" is the load-bearing rule. A scope is not owned by
 * every role senior enough to use it — it is owned by the first rung on the ladder
 * that may exercise it, because that rung is where an agent's autonomy must stop
 * and a human's judgement must start.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE MUST NEVER BECOME
 *
 * It must not acquire ceilings, amounts, or conditions. Those are GOVERNANCE and
 * they live in EXCEPTION_AUTHORITY.md, read at runtime, versioned in git, approved
 * by a named human. This file answers one question only — "which rung of Apaleo's
 * ladder holds this scope?" — and the answer is a fact about Apaleo, not a policy
 * choice of ours. The moment a number appears here, the product has started
 * hardcoding governance, which is the one thing it exists not to do.
 */

/** The internal role bands, narrowest first. Order IS the escalation path. */
export const BANDS = ['ambassador', 'mod', 'compliance_officer'] as const;
export type Band = (typeof BANDS)[number];

export interface ApaleoRole {
  /** Apaleo's own name for the role, exactly as it appears in Apaleo One. */
  readonly role: string;
  /** The citizenM title holding the same authority. Both are always shown. */
  readonly title: string;
  /** The band this role's authority corresponds to. */
  readonly band: Band;
  /** What Apaleo's documentation says this role may do. Verbatim in spirit. */
  readonly permits: string;
  /**
   * OAuth scopes whose authority this role is the LOWEST holder of.
   * A scope appears exactly once across the whole ladder.
   */
  readonly scopes: readonly string[];
}

/**
 * The ladder. Ordered from the front line upward — the same order the escalation
 * walk in EXCEPTION_AUTHORITY.md follows.
 *
 * Junior Front Desk is deliberately FIRST and deliberately holds the smallest set:
 * Apaleo's own note on it is "standard permissions only — execution level, no HITL
 * authority". An Ambassador executes; an Ambassador does not approve. Every scope
 * beyond that set is, by Apaleo's own model, somebody else's decision.
 */
export const APALEO_LADDER: readonly ApaleoRole[] = [
  {
    role: 'Junior Front Desk',
    title: 'Ambassador',
    band: 'ambassador',
    permits: 'Reservations — standard permissions only. Execution level, no approval authority.',
    scopes: [
      // Standard reservation handling: create, read, amend within rate-plan and
      // availability rules. The moment a restriction must be overridden it is
      // force-manage, which is not here — it is the MoD's.
      'reservations.manage',
      'reservations.read',
      'availability.read',
      'folios.read',
      'rateplans.read',
      'rateplans.read-corporate',
      // Room state within housekeeping rules. Night audit is NOT here: Apaleo's
      // model puts operations.trigger-night-audit with the Property Admin.
      'operations.change-room-state',
    ],
  },
  {
    role: 'Senior Reservation Manager',
    title: 'Manager on Duty',
    band: 'mod',
    permits:
      'Cancel or no-show reservations. Book outside restrictions. Change prices. Process refunds. Add custom charges to folios.',
    scopes: [
      // "Book outside restrictions" — the single most consequential scope in the
      // hospitality surface, and the reason this rung exists. Apaleo grants it as
      // one binary flag; the threshold that makes it safe is ours to add.
      'reservations.force-manage',
      // "Add custom charges to folios" and "process refunds".
      'folios.manage',
      'folios.payment-with-charges',
      // "Change prices."
      'rates.manage',
    ],
  },
  {
    role: 'Revenue Manager',
    title: 'Revenue Manager',
    band: 'mod',
    permits: 'Rate plans and pricing. Read-only reservations.',
    scopes: ['rateplans.manage'],
  },
  {
    role: 'Accountant',
    title: 'Finance Controller',
    band: 'mod',
    permits:
      'Accounting section. Folios and financial data. Alongside admins, the only role with financial data access.',
    scopes: ['payments.manage', 'authorizations.manage', 'accounting.read', 'invoices.manage'],
  },
  {
    role: 'Property Admin',
    title: 'Hotel GM',
    band: 'compliance_officer',
    permits: 'Full permissions at a single property.',
    scopes: ['operations.trigger-night-audit', 'properties.manage', 'units.manage'],
  },
  {
    role: 'Account Admin',
    title: 'Operations Chief',
    band: 'compliance_officer',
    permits: 'Full permissions across the account. Invite and deactivate users.',
    scopes: ['accounts.manage', 'setup.manage'],
  },
];

/** Apaleo role name → citizenM title. Both names are always shown in the UI. */
export const TITLE_FOR_ROLE: Record<string, string> = Object.fromEntries(
  APALEO_LADDER.map((r) => [r.role, r.title]),
);

const ROLE_FOR_SCOPE: Record<string, ApaleoRole> = (() => {
  const m: Record<string, ApaleoRole> = {};
  for (const role of APALEO_LADDER) {
    for (const scope of role.scopes) {
      // A scope owned twice would make "the lowest role that holds it" ambiguous,
      // and the ladder would silently depend on array order. Fail at import.
      if (m[scope]) {
        throw new Error(
          `apaleoAuthority: scope '${scope}' is claimed by both '${m[scope].role}' and '${role.role}'. ` +
            `Each scope must be owned by exactly one rung — the lowest that holds it.`,
        );
      }
      m[scope] = role;
    }
  }
  return m;
})();

/**
 * The Apaleo role that owns a scope — i.e. the lowest rung permitted to exercise it.
 * Returns null for a scope we have not placed on the ladder, which is NOT the same
 * as "anyone may do it". Callers must treat null as unknown, never as permitted.
 */
export function roleForScope(scope: string | null | undefined): ApaleoRole | null {
  if (!scope) return null;
  return ROLE_FOR_SCOPE[scope] ?? null;
}

/**
 * The band that owns a scope. Null when the scope is not on the ladder.
 *
 * This is the function that makes the ladder derived rather than declared: given
 * the Apaleo scope an action must be performed under, it answers who in Apaleo's
 * own model is allowed to make that call.
 */
export function bandForScope(scope: string | null | undefined): Band | null {
  return roleForScope(scope)?.band ?? null;
}

/** Is `a` at least as wide as `b`? Bands nest: a wider band may decide narrower items. */
export function bandAtLeast(a: Band, b: Band): boolean {
  return BANDS.indexOf(a) >= BANDS.indexOf(b);
}

/**
 * Everything the ladder knows about one scope, for rendering next to a decision.
 * `governed: false` means "we hold no position on this scope" — which the console
 * must render as ungoverned rather than as approved.
 */
export interface ScopeAuthority {
  scope: string;
  governed: boolean;
  role: string | null;
  title: string | null;
  band: Band | null;
  permits: string | null;
}

export function scopeAuthority(scope: string | null | undefined): ScopeAuthority | null {
  if (!scope) return null;
  const role = roleForScope(scope);
  return {
    scope,
    governed: role !== null,
    role: role?.role ?? null,
    title: role?.title ?? null,
    band: role?.band ?? null,
    permits: role?.permits ?? null,
  };
}

/**
 * Assert that every scope the executor can actually reach for is placed on the
 * ladder. Called at boot (see routes/apaleoOne.ts) so a scenario added with an
 * unplaced scope fails loudly at startup rather than rendering as "ungoverned"
 * in front of a hotel.
 *
 * Returns the offending scopes rather than throwing, so the caller can decide
 * whether an unplaced scope is a boot failure or a logged warning.
 */
export function ungroundedScopes(scopes: readonly (string | null)[]): string[] {
  return scopes.filter((s): s is string => typeof s === 'string' && !ROLE_FOR_SCOPE[s]);
}
