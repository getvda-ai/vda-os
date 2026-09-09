/**
 * apaleoOne.ts — the HITL authority surface, as an Apaleo One UI integration.
 *
 * This is the same harness the Stay Agent console drives, addressed differently:
 * the console is a presenter's cockpit that picks its own tenant from a text box,
 * and this is an operator's queue that is TOLD which property it is looking at by
 * the Apaleo One frame it is embedded in.
 *
 * Three things it deliberately does NOT do:
 *
 *  1. It does not re-implement the decision path. `POST /apaleo-one/resolve/:token`
 *     delegates into the existing `/stay/hitl/respond/:token` handler — same
 *     governance evaluation, same executor, same Apaleo MCP write, same seal. A
 *     second code path would drift, and the drift would be invisible until the two
 *     surfaces disagreed about who was allowed to do what.
 *
 *  2. It does not grant authority. Every band it shows is the band Apaleo's own
 *     role model already puts that scope in (see lib/apaleoAuthority.ts). The HITL
 *     layer can only ever be MORE restrictive than the OAuth client's scope set.
 *
 *  3. It does not upgrade the operator's identity to make the demo tidier. Apaleo
 *     One passes `subjectId` as an unsigned query parameter, so the default is
 *     `asserted`, and the UI says so. See lib/apaleoOneContext.ts.
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from 'express';
import { db, hitlTokens, companies } from '@workspace/db';
import { and, eq, desc, sql } from 'drizzle-orm';
import stayRouter from './stay.js';
import { logger } from '../lib/logger.js';
import { readContext, actorHeadersFor, type ApaleoOneContext } from '../lib/apaleoOneContext.js';
import { APALEO_LADDER, scopeAuthority, ungroundedScopes, bandForScope } from '../lib/apaleoAuthority.js';
import { STAY_SCENARIOS, scenarioForClass } from '../lib/stayScopeMap.js';
import { seedStayAgentGovernance } from '../lib/seedStayAgent.js';

const router: IRouter = Router();
const AGENT_SLUG = 'stay-agent';

/**
 * Boot check: every scope the executor can actually reach for must sit on the
 * ladder. An unplaced scope would render as "ungoverned" — a true statement that
 * looks like a bug and, worse, looks like permission. Log it loudly at import so
 * it is found in a deploy log rather than in front of a hotel.
 */
{
  const missing = ungroundedScopes(STAY_SCENARIOS.map((s) => s.scope));
  if (missing.length) {
    logger.error(
      { missing },
      '[apaleoOne] scenario scopes are not placed on the Apaleo authority ladder — they will render as ungoverned',
    );
  }
}

/** Resolve the frame context or answer with the refusal. Returns null when refused. */
function requireContext(req: Request, res: Response): ApaleoOneContext | null {
  // A verified subject would come from a completed auth-code flow held in session
  // state. There is no session layer here yet, so this is null and assurance stays
  // `asserted` — stated rather than quietly assumed. Wiring the flow is the one
  // change that turns every approval in this queue into an authenticated one.
  const verifiedSubject: string | null = null;
  const result = readContext(req.query as Record<string, unknown>, verifiedSubject);
  if (!result.ok) {
    res.status(result.refusal.reason === 'unmapped_property' ? 403 : 400).json(result.refusal);
    return null;
  }
  return result.context;
}

// ── GET /api/apaleo-one/context ──────────────────────────────────────────────
// Who is looking, at which property, with what identity assurance, and on which
// rung of Apaleo's ladder they sit.
router.get('/apaleo-one/context', (req, res) => {
  const ctx = requireContext(req, res);
  if (!ctx) return;
  res.json({
    accountCode: ctx.accountCode,
    propertyId: ctx.propertyId,
    subjectId: ctx.subjectId,
    lang: ctx.lang,
    companyId: ctx.companyId,
    identity: {
      assurance: ctx.assurance,
      // Said plainly because the sealed record will say the same thing, and the
      // operator should not learn the difference from an auditor.
      note:
        ctx.assurance === 'verified'
          ? 'Identity confirmed by Apaleo Identity for this session.'
          : 'Apaleo One passes subjectId as an unsigned query parameter. This decision is sealed as an ASSERTED identity, not an authenticated one.',
      integrationTokenChecked: ctx.integrationTokenChecked,
    },
  });
});

// ── GET /api/apaleo-one/ladder ───────────────────────────────────────────────
// The authority ladder, derived from Apaleo's role model. This is the artefact
// the Munich Day-1 mapping session is meant to produce; serving it from running
// code rather than a slide is the point.
router.get('/apaleo-one/ladder', (_req, res) => {
  res.json({
    source: "Apaleo's published user-role and OAuth-scope model",
    claim:
      'The Ambassador → Manager on Duty boundary is the Junior Front Desk → Senior Reservation Manager boundary. The HITL layer adds a threshold inside a scope Apaleo can only grant wholesale; it never grants authority Apaleo has not.',
    ladder: APALEO_LADDER.map((r) => ({
      apaleoRole: r.role,
      title: r.title,
      band: r.band,
      permits: r.permits,
      scopes: r.scopes,
    })),
    scenarios: STAY_SCENARIOS.map((s) => ({
      key: s.key,
      name: s.name,
      exceptionClass: s.exceptionClass,
      scope: s.scope,
      endpoint: s.endpoint,
      tool: s.tool,
      authority: scopeAuthority(s.scope),
    })),
  });
});

/**
 * A decision card is ACTIONABLE only when its decision basis renders as real content.
 *
 * CLAUDE.md states this as a non-negotiable: "HITL surfaces must never render partial or
 * degraded reasoning — either full context or route to escalation. An Ambassador acting on
 * a card with missing or error-valued reasoning, a missing governing clause, or a blank
 * decision-basis panel is a governance failure, not a display glitch." It is written down
 * because it has already shipped three times, most damagingly as a model-parse marker
 * rendered verbatim IN the governing-clause slot.
 *
 * So the check is made server-side, and the answer travels with the card. A client that
 * forgot to check would otherwise render an approvable card over an empty basis — and the
 * approval would be indistinguishable, in the seal, from an informed one.
 */
const ERROR_MARKERS = [
  'unable to parse',
  'parse failure',
  'agent_error',
  'undefined',
  'null',
  '[object object]',
];

function basisState(statement: string, clause: string): { actionable: boolean; reason: string | null } {
  const bad = (v: string): boolean => {
    const t = v.trim().toLowerCase();
    if (!t) return true;
    return ERROR_MARKERS.some((m) => t.includes(m));
  };
  if (bad(statement)) {
    return { actionable: false, reason: "The decision statement is missing or unreadable." };
  }
  if (bad(clause)) {
    return { actionable: false, reason: "No governing clause is recorded against this decision." };
  }
  return { actionable: true, reason: null };
}

// ── GET /api/apaleo-one/queue ────────────────────────────────────────────────
// Open decisions for THIS property, each annotated with the Apaleo scope it is
// gating and the role that scope belongs to.
router.get('/apaleo-one/queue', async (req, res) => {
  const ctx = requireContext(req, res);
  if (!ctx) return;
  try {
    const rows = await db
      .select()
      .from(hitlTokens)
      .where(
        and(
          eq(hitlTokens.agentId, AGENT_SLUG),
          eq(hitlTokens.companyId, ctx.companyId),
          sql`${hitlTokens.outcome} IS NULL`,
        ),
      )
      .orderBy(desc(hitlTokens.createdAt));

    const items = rows.map((row) => {
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      const exceptionClass = String(payload.exception_class ?? '');
      const statement = String(payload.statement ?? payload.summary ?? '');
      const clause = String(payload.clause_applied ?? '');
      const basis = basisState(statement, clause);
      const scenario = scenarioForClass(exceptionClass);
      const scope = scenario?.scope ?? null;
      return {
        token: row.token,
        createdAt: row.createdAt,
        roleBand: row.roleBand,
        exceptionClass,
        stage: payload.stage ?? null,
        statement: basis.actionable ? statement : null,
        clauseApplied: basis.actionable ? clause : null,
        // Not a rendering hint — a governance verdict. False means this card must
        // not present an Approve control at all; escalation is the only safe move.
        actionable: basis.actionable,
        degradedReason: basis.reason,
        proposedAction: payload.action_plan ?? null,
        financialExposure: payload.financial_exposure ?? null,
        currency: payload.currency ?? null,
        // The Apaleo authority boundary this card sits at. Carried from the scope
        // map, which is asserted against the executor — so the scope shown is the
        // scope that would actually be invoked, not a caption over it.
        apaleo: {
          scope,
          endpoint: scenario?.endpoint ?? null,
          tool: scenario?.tool ?? null,
          authority: scopeAuthority(scope),
          // Where Apaleo's own model says this decision belongs, independent of
          // whatever band the governance file routed it to. When these disagree,
          // that is a finding — surfaced, not smoothed over.
          bandFromApaleoModel: bandForScope(scope),
        },
      };
    });

    res.json({
      propertyId: ctx.propertyId,
      companyId: ctx.companyId,
      count: items.length,
      items,
    });
  } catch (err) {
    logger.error({ err }, '[apaleoOne] queue error');
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load the queue' });
  }
});

// ── POST /api/apaleo-one/provision ───────────────────────────────────────────
// One-time tenant bootstrap for a deployment of this integration. Idempotent.
//
// Resolves the tenant BY NAME and creates it if absent. Deliberately NOT by
// apaleoPropertyId: several tenants in this database already share one Apaleo
// property, so a property-id lookup finds SOMEONE ELSE'S tenant and renames it —
// editing the original instead of creating a new one. That has happened before.
//
// Guarded by the integration secret. It writes to a shared database from a public
// host; an unguarded provisioning route is a tenant-creation endpoint for anyone
// who guesses the path.
router.post('/apaleo-one/provision', async (req, res) => {
  const secret = process.env.APALEO_ONE_INTEGRATION_TOKEN;
  if (!secret) {
    res.status(503).json({
      error: 'provisioning_disabled',
      message: 'Set APALEO_ONE_INTEGRATION_TOKEN before provisioning. An unguarded provisioning route is not offered.',
    });
    return;
  }
  if (req.headers['x-provision-secret'] !== secret) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const name = String(body.companyName ?? process.env.APALEO_ONE_COMPANY_NAME ?? '').trim();
  const propertyId = String(body.propertyId ?? '').trim();
  if (!name) {
    res.status(400).json({ error: 'companyName required (or set APALEO_ONE_COMPANY_NAME)' });
    return;
  }
  try {
    const found = await db.select().from(companies).where(eq(companies.companyName, name)).limit(1);
    let companyId: number;
    let created = false;
    if (found.length) {
      companyId = found[0].id;
    } else {
      const [row] = await db
        .insert(companies)
        .values({
          companyName: name,
          industry: 'Hospitality',
          apaleoPropertyId: propertyId || null,
          x402Exempt: true,
        })
        .returning({ id: companies.id });
      companyId = row.id;
      created = true;
    }
    const seeded = await seedStayAgentGovernance(companyId);
    res.json({
      ok: true,
      companyId,
      companyName: name,
      created,
      governanceSeeded: seeded,
      next: `Set APALEO_ONE_COMPANY_ID=${companyId} (or add "<ACCOUNT>:<PROPERTY>": ${companyId} to APALEO_ONE_TENANT_MAP) and redeploy.`,
    });
  } catch (err) {
    logger.error({ err }, '[apaleoOne] provision error');
    res.status(500).json({ error: err instanceof Error ? err.message : 'Provisioning failed' });
  }
});

// ── POST /api/apaleo-one/resolve/:token ──────────────────────────────────────
// Delegates into the existing respond handler so the decision path, the Apaleo
// write and the seal are literally the same code the console uses. The only thing
// added here is WHO decided, sourced from the frame rather than from the body.
router.post('/apaleo-one/resolve/:token', (req: Request, res: Response, next: NextFunction) => {
  const ctx = requireContext(req, res);
  if (!ctx) return;

  const token = String(req.params.token);
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(token)) {
    res.status(400).json({ error: 'invalid_token' });
    return;
  }

  // Identity into the seal. `decided_by` is the asserted path resolveActor() falls
  // back to; the header is the authenticated path it prefers. We set exactly one,
  // server-side, so the browser cannot promote its own assurance level.
  const body = (req.body ?? {}) as Record<string, unknown>;
  req.body = {
    ...body,
    decided_by: `apaleo:${ctx.subjectId}`,
    apaleo_context: {
      accountCode: ctx.accountCode,
      propertyId: ctx.propertyId,
      subjectId: ctx.subjectId,
      identity_assurance: ctx.assurance,
    },
  };
  for (const [k, v] of Object.entries(actorHeadersFor(ctx))) req.headers[k] = v;

  req.url = `/stay/hitl/respond/${encodeURIComponent(token)}`;
  (stayRouter as unknown as (rq: Request, rs: Response, nx: NextFunction) => void)(req, res, next);
});

export default router;
