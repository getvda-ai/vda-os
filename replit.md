# Workspace

## VDA-MD Framework Principles

VDA-MD (Value Driven AI — Market Knowledge) is the governance framework for this platform. Markdown files are the **sole source of truth** for all agent behaviour. No hardcoded policy fallbacks exist anywhere in the codebase.

### Core Axioms

| § | Principle | Enforcement |
|---|-----------|-------------|
| §1 | **Markdown is Law** | Every agent decision is governed entirely by VDA-MD files stored in the database. Hardcoded policy objects are prohibited. |
| §2.1 | **Mandatory Governance Files** | An agent cannot execute any decision — no AI call, no MCP tool call, no Apaleo API interaction — until all three file types are present: `AGENTS.md`, `SOP.md`, `SKILL.md`. Missing files → immediate ESCALATE enforced at route-level preflight. |
| §2.2 | **Three-File Architecture** | `AGENTS.md` — agent charter, scope, and RACI matrix. `SOP.md` — operational MUST/MUST NOT/MAY rules with escalation paths. `SKILL.md` — permitted Apaleo MCP tool list and authority limits. |
| §3 | **Compliance Immutability** | GDPR, EU AI Act, and ISO 42001 references are **immutable** in all governance files. Any edit that reduces the count of these references is rejected at the API layer with HTTP 409. This is enforced in `PUT /fm/file/:id` via `checkComplianceGuards()`. |
| §4 | **Audit Standard Change Control** | Audit standard references (NIST SP 800-53, SOC 2, ISO 27001) may only be reduced when the **accountable owner** provides a `signedOffBy` field in the save request. Unsigned reductions are rejected with HTTP 409. Approved reductions are recorded verbatim in the version commit message. |
| §5 | **Witness Agent Non-Negotiable** | Every agent decision — PASS, FAIL, or ESCALATE — writes a tamper-evident Witness Stream entry containing: verbatim `clauseApplied`, `filesConsulted` array, `crossDomainInheritance` flag, and the Apaleo data snapshot used. Governance failure entries carry `fileReferenced: "VDA-MD §2.1 — No governance file"`. |
| §6 | **Exception Overlay Pattern** | Exceptions extend (never replace) the SOP baseline. An `EXCEPTION.md` file activates only when all stated conditions are met and is cited in the Witness Stream with `exceptionApplied: true` and the verbatim exception clause. |
| §7 | **Cross-Domain Inheritance** | Agents requiring shared services policy (e.g. Finance O2C) inherit those files as a pre-condition block. Cross-domain files are loaded **only after** the agent's own AGENTS/SOP/SKILL prerequisite is fully satisfied — they cannot substitute for missing agent-specific governance. |

### File Naming Convention

```
Hospitality-[Domain]-[Stage]-[AgentName].[FileType].md
```

| Segment | Examples |
|---------|----------|
| Domain | Revenue, Operations, Finance |
| Stage | Pre-Book, Book, Stay, Post-Stay, Reconciliation |
| AgentName | availability-agent, checkin-agent, RevenueReconciliation |
| FileType | AGENTS, SOP, SKILL, EXCEPTION |

### 23 Canonical Files per Hotel (5 hotels × 23 = 115 total)

7 agents × 3 file types (AGENTS + SOP + SKILL) = 21, plus 1 Finance O2C Shared, plus 1 EXCEPTION overlay = **23 files**.

| Agent | Domain | Stage |
|-------|--------|-------|
| Availability Agent | Revenue | Pre-Book |
| Rate Agent | Revenue | Book |
| Reservation Bot | Revenue | Book |
| Check-In Agent | Operations | Stay |
| Folio Charge Agent | Operations | Stay |
| Checkout Agent | Operations | Post-Stay |
| Revenue Reconciliation Agent | Finance | Reconciliation |

### Compliance Guard Reference

**§3 — Immutable legal terms (hard block, HTTP 409 on reduction):**
- `GDPR` / General Data Protection Regulation / data subject rights / Article 22
- `EU AI Act` / Artificial Intelligence Act / GPAI / high-risk AI / prohibited AI
- `ISO 42001` / AI management system

**§4 — Audit standard terms (require `signedOffBy` to reduce, HTTP 409 if unsigned):**
- `NIST` / SP 800-53 / any control reference (AC-*, AU-*, IR-*, SA-*, SC-*, RA-*, SI-*)
- `SOC 2` / SOC2 / AICPA SOC / Trust Service Criteria
- `ISO 27001` / ISMS / information security management

---

## Iron Onboarding — Gate-Enforced CO→GM→Crawl→Walk Flow

The "Iron Onboarding" flow (#67) governs how a new Rate Agent is admitted into production across the citizenM hotel portfolio. It is a mandatory multi-gate process that ensures governance compliance at every stage.

### Gate Flow

```
CO (Compliance Officer) creates Rate Agent record
  └─ Status: pre_admitted (INVISIBLE to all other roles)
       ↓
CO reviews & admits → status: admitted
  └─ Failure path: CO rejects → status: rejected_co (terminal)
       ↓
GM activates Crawl phase → activation/start (409 if duplicate)
  └─ Crawl: operational_exception HITL cards appear per-band
  └─ Bands: ambassador (rate_discount_standard ≤9%)
             senior_ambassador (rate_discount_extended ≤15%)
             hotel_gm (rate_discount_exceptional >15%)
       ↓
All bands baselined (crawl-status: all pending=0)
  └─ Baseline: HITL card approved with authoriseAsBaseline=true
               → exception_baselines row written
               → 60s cache invalidated → class suppressed from queue
       ↓
GM promotes to Walk (promote-to-walk gate: crawlComplete=true required)
  └─ New mandate issued for walk phase
       ↓
CO cosigns Run (cosign-run: signs off portfolio-wide)
  └─ Agent enters autonomous Run phase
```

### Key Files — Iron Onboarding

| File | Purpose |
|------|---------|
| `artifacts/api-server/src/onboarding/onboardingRollback.ts` | CO gate: pre_admitted visibility, admit/reject endpoints |
| `artifacts/api-server/src/routes/dashboard.ts` | activation/start, crawl-status, promote-to-walk, portfolio-status, cosign-run |
| `artifacts/api-server/src/lib/exceptionAuthorityReader.ts` | `getRejectedOrBaselinedClasses` (60s TTL cache), `getRoleBandAuthority` |
| `artifacts/api-server/src/governance/rate-agent.EXCEPTION_AUTHORITY.md` | 3-class model (see below) |
| `artifacts/api-server/src/routes/hitl.ts` | HITL respond endpoint: `authoriseAsBaseline` upserts `exception_baselines` |
| `artifacts/vda-os/src/dashboard/DecisionCard.jsx` | HITL decision card with crawl-phase baseline checkbox |
| `artifacts/vda-os/src/dashboard/AmbassadorView.jsx` | Passes real `p.cardType` to DecisionCard (not hardcoded) |
| `artifacts/vda-os/src/dashboard/SeniorAmbassadorView.jsx` | Same as AmbassadorView |
| `artifacts/vda-os/src/VdaOS.jsx` | CO Pending Admission in Approvals tab (not Queue) |

### EXCEPTION_AUTHORITY.md — 3-Class Rate Agent Model (v2.0)

```
ambassador        → rate_discount_standard   (≤9% discount)
senior_ambassador → rate_discount_extended   (≤15% discount)
hotel_gm          → rate_discount_exceptional (>15% discount) + rate_plan_override
```

Source files: `artifacts/api-server/src/governance/rate-agent.EXCEPTION_AUTHORITY.md`
             (auto-copied to `dist/governance/` during API server build)

### Crawl-Status Per-Band Resolution Logic

`GET /api/dashboard/activation/:agentId/crawl-status` computes resolved counts by **exception_class slug** matched against the authority file definition per band — NOT by the `roleBand` column stored in `exception_baselines` (which can be misattributed via escalation-target heuristics). This makes `crawlComplete` reliable.

```typescript
// Per-band resolution: authority-file-driven
const resolvedClassSet = new Set(baselineRows.map(r => r.exceptionClass));
// For each band, count how many of its defined classes are in resolvedClassSet
const resolved = classes.filter(cls => resolvedClassSet.has(cls)).length;
```

### Baseline Fast-Path (Rate Agent)

Before writing a HITL card, `agents.ts` checks `getRejectedOrBaselinedClasses()` (60s TTL cache in `exceptionAuthorityReader.ts`). If the exception class is already baselined, the decision is returned as `PASS` with `governance_source: "exception_baseline"` and no HITL card is written.

```typescript
const baselined = await getRejectedOrBaselinedClasses(companyId, "rate-agent");
if (baselined.has(exceptionClass)) {
  // Fast-path: suppress HITL, return PASS with governance_source tag
}
```

### TERMINAL_STATUSES for Onboarding State Machine

`rejected` and `rejected_co` are terminal statuses. `vda_native` is NOT a terminal status (it is a phase label, not a state).

---

## Phase 1 Protocol Build — AP2 Economic & Mandate Layer

### T001 — A2A v1.0 Agent Card Fields

All agent cards now expose full A2A v1.0 compliant fields via `agentCardRegistry.ts`:

```typescript
{
  inputModes: ["application/json", "text/plain"],
  outputModes: ["application/json"],
  provider: { organization: "citizenM Hotels — VDA-MD Platform", url: "https://citizenm.com" },
  documentationUrl: "https://vda-md.citizenm.com/docs/agents/<agentId>",
  capabilities: { streaming: true, pushNotifications: false },
  activeMandate: { mandateId, phase, authorizations, validUntil, issuedAt } | null,
}
```

Source: `artifacts/api-server/src/a2a/agentCardRegistry.ts`

### T002 — Agent Value Ledger + ROI Dashboard

Every PASS decision writes an `agent_value_events` row via `writeValueEvent()` (fire-and-forget, non-blocking). The Operations Chief view shows the **ValueLedgerPanel** ROI dashboard:

- Total revenue delta, governance cost, net value, ROI multiple per agent
- Time-filtered (default 30 days), per-agent breakdown
- Source: `artifacts/vda-os/src/dashboard/OperationsChiefView.jsx` (Section D)

**API endpoints:**
- `GET /api/dashboard/value-ledger?companyId=N&since=ISO` — per-agent + platform totals (companyId=0 supported)
- `GET /api/dashboard/value-ledger/events?companyId=N&limit=N&agentId=slug` — raw event log
- `POST /api/admin/seed-value-events` `{ companyId }` — idempotent baseline seed (≥50 events skips)

**Two call paths write value events:**
1. Individual agent routes (`/api/agents/*`) — lines 754–1541 in `agents.ts`
2. Scenario runner (`POST /api/agents/scenario/run`) — inline writes at lines 1993–2432

Source: `artifacts/api-server/src/lib/valueEventWriter.ts`, `artifacts/api-server/src/routes/admin.ts`

### T003 — AP2 Signed Intent Mandates

Intent Mandates are HMAC-SHA256-signed spending authority grants issued at:
- Onboarding completion (crawl phase)
- Each phase promotion (Crawl→Walk, Walk→Run)

Validity windows: crawl=7 days, walk=30 days, run=90 days.

**Authorization tiers by phase** (`PHASE_AUTHORIZATION_TIERS` in `lib/db/src/schema/agentMandates.ts`):
- `crawl` — no standing authority (all actions require HITL)
- `walk` — standard action ceilings defined per agent type
- `run` — elevated ceilings, portfolio-wide scope

Mandates are surfaced in the A2A Agent Card as `activeMandate` and via:
- `GET /api/mandates?companyId=N` — all active mandates
- `GET /api/dashboard/mandates?companyId=N` — alias

Source: `artifacts/api-server/src/lib/mandateIssuer.ts`

### T004 — AP2 Mandate Validator Middleware

`requireValidMandate(agentId, action?, valueExtractor?, mode?)` — Express middleware:
- `"enforce"` mode (default): returns `{ decision: "ESCALATE", hitlRequired: true }` on breach
- `"annotate"` mode: attaches `req.mandateCtx` but never blocks (used on Rate Agent during crawl)

All 8 agent routes now carry `requireValidMandate`:

| Agent | Action | Mode |
|-------|--------|------|
| availability-agent | — | annotate |
| rate-agent | discount | annotate |
| reservation-bot | — | annotate |
| check-in-agent | — | annotate |
| folio-agent | — | annotate |
| folio-charge-agent | folio_charge | **enforce** |
| checkout-agent | refund | annotate |
| revenue-reconciliation-agent | — | annotate |

`"enforce"` on folio-charge-agent returns ESCALATE on ceiling breach (hard block). All others annotate `req.mandateCtx` for downstream use without blocking.

Source: `artifacts/api-server/src/lib/mandateValidator.ts`

---

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **AI**: Anthropic Claude via Replit AI Integrations (no user API key required)

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   ├── api-server/         # Express API server
│   └── vda-os/             # Value Driven AI Operating System (React + Vite)
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   ├── db/                 # Drizzle ORM schema + DB connection
│   └── integrations-anthropic-ai/  # Anthropic AI integration via Replit proxy
├── scripts/                # Utility scripts (single workspace package)
├── pnpm-workspace.yaml     # pnpm workspace
├── tsconfig.base.json      # Shared TS options
├── tsconfig.json           # Root TS project references
└── package.json            # Root package with hoisted devDeps
```

## Apaleo Integration

Apaleo sandbox integration via OAuth 2.0 client credentials flow. All credentials stored as secrets.

**Required secrets:**
- `APALEO_CLIENT_ID` — Apaleo OAuth client ID (set)
- `APALEO_CLIENT_SECRET` — Apaleo OAuth client secret (set)
- `APALEO_MCP_URL` — Apaleo MCP server URL (optional, for agent tool use)
- `APALEO_MCP_TOKEN` — Apaleo MCP server bearer token (optional)

**Apaleo API routes** (all under `/api/apaleo/`):
- `GET /api/apaleo/status` — connectivity check, lists reachable sandbox properties
- `GET /api/apaleo/properties` — list all properties
- `GET /api/apaleo/reservations` — list reservations (filter: propertyId, status, from, to, dateFilter, pageSize, pageNumber)
- `GET /api/apaleo/guests` — deduplicated guest list extracted from reservations
- `GET /api/apaleo/folios` — financial folios (filter: reservationId, propertyId)
- `GET /api/apaleo/rate-plans` — rate plans (filter: propertyId, unitGroupId, channelCode, isArchived)
- `GET /api/apaleo/reports/revenue` — revenue report (filter: propertyId, from, to)
- `GET /api/apaleo/mcp/tools` — list available MCP tools (requires APALEO_MCP_URL + APALEO_MCP_TOKEN)
- `POST /api/apaleo/mcp/tools/:toolName` — call a specific MCP tool

**Source files:**
- `src/lib/apaleo-types.ts` — TypeScript interfaces for all Apaleo resources
- `src/lib/apaleo-auth.ts` — OAuth token management with in-memory cache + auto-refresh
- `src/lib/apaleo-client.ts` — Apaleo REST API fetch helpers
- `src/lib/apaleo-mcp.ts` — MCP server connection management
- `src/routes/apaleo.ts` — Express router for all `/api/apaleo/*` routes

## Applications

### `artifacts/vda-os` — VDA-MD for Apaleo

React + Vite frontend. Hospitality-only AI governance operating system for Apaleo-powered properties. Entry point: `src/VdaOS.jsx`.

**Main navigation tabs:**
- `dashboard` — Role-based view switcher (see Role Views below)
- `onboarding` — Agent Onboarding pipeline with Iron Onboarding gate flow
- `journey` — Journey Map
- `demo` — Live Demo (7-step scenario runner)
- `c2md` — C2MD Studio (governance file generator)
- `exception` — Exception Engine
- `witness` — Witness Agent audit trail
- `a2md` — A2MD Normaliser
- `soc2` — SOC 2 SD
- `credentials` — Agent Credentials
- `a2a` — A2A Protocol
- `filemanager` — File Manager

**Role Views** (rendered inside the `dashboard` tab, `src/dashboard/`):

| File | Role | Key Sections |
|------|------|--------------|
| `AmbassadorView.jsx` | `ambassador` | HITL pending decisions (passes real `cardType` from token), shift stats |
| `SeniorAmbassadorView.jsx` | `senior_ambassador` | HITL pending decisions (passes real `cardType` from token), band metrics |
| `HotelGMView.jsx` | `hotel_gm` | Crawl/Walk activation, portfolio health, exception class progress |
| `RegionalGMView.jsx` | `regional_gm` | Multi-property overview |
| `OperationsChiefView.jsx` | `operations_chief` | Platform overview, mandate status, ValueLedgerPanel ROI (Section D) |
| `ComplianceOfficerView.jsx` | `compliance_officer` | Approvals tab (CO Pending Admission cards), EU AI Act tab, GDPR tab |
| `DecisionCard.jsx` | All | HITL decision card with baseline checkbox (shown when `cardType === "operational_exception"` AND `currentPhase === "crawl"` AND `exceptionClass` present) |

**CRITICAL — DecisionCard cardType wiring:**
Both `AmbassadorView.jsx` and `SeniorAmbassadorView.jsx` MUST pass `cardType={p.cardType ?? "ESCALATE"}` (from the HITL token), NOT hardcoded `"ESCALATE"`. The baseline checkbox only appears when `cardType === "operational_exception"`.

**CRITICAL — Compliance Gate (iron-clad, do not remove):**
- Default `globalRole` is `"compliance_officer"` — the first screen when entering any hub is always the CO view.
- `DashboardTab` fetches `GET /api/dashboard/phases?companyId=N` on mount.
- `HOTEL_ROLE_IDS = {"ambassador","senior_ambassador","hotel_gm","regional_gm","operations_chief"}` are ALL locked when `agentPhases.length === 0` (no agents activated).
- Locked buttons show a red `NO AGENT` badge, are disabled with `cursor: not-allowed`, and any click routes back to `compliance_officer`.
- An iron-clad `useEffect` snap-redirects to CO if a gated role is somehow active when phases load.
- An amber warning banner shows when agents exist only in crawl phase (no walk/run live yet).
- `compliance_officer` role is NEVER gated — it is the gate itself.
- The gate unlocks when at least one `agent_phases` record exists (GM has activated crawl). Amber warning clears when at least one agent reaches walk or run phase.

**Other features:**
- **Live stats bar** in Hub header: Arrivals Today, Departures, In-House, Open Folios, Maintenance
- **Journey stage live badges**: real-time counts from Apaleo API on each stage card
- **Brand context ingestion** from property website via `/api/ingest/website`
- **C2MD Translation Engine**: generates NIST SP 800-53 governance Markdown via Claude AI
- **Exception overlay engine**: baseline vs exception governance policy decisions

All AI API calls go to `/api/ai/messages` (backend proxy), NOT directly to Anthropic.
All Apaleo data calls go to `/api/apaleo/*` (backend proxy), NOT directly to Apaleo.

Hooks: `src/hooks/use-apaleo.ts` — `useApaleoStats`, `useApaleoReservations`, `useApaleoProperties`, `useApaleoProperty`

### `artifacts/api-server` — Express API Server

All routes are in `src/routes/`. Key route groups:

**Core:**
- `GET /api/healthz` — health check
- `POST /api/ai/messages` — Anthropic API proxy (uses Replit AI Integration, no user key needed)

**VDA-MD Agent Suite** (`src/routes/agents.ts`):
- `POST /api/agents/availability` — Availability Agent
- `POST /api/agents/rate` — Rate Agent (3-class exception: standard/extended/exceptional; annotate mandate mode)
- `POST /api/agents/reservation` — Reservation Bot
- `POST /api/agents/checkin` — Check-In Agent
- `POST /api/agents/folio` — Folio Agent
- `POST /api/agents/folio-charge` — Folio Charge Agent (enforce mandate mode)
- `POST /api/agents/checkout` — Checkout Agent
- `POST /api/agents/revenue` — Revenue Reconciliation Agent
- `GET /api/agents/witness?companyId=N` — retrieve persisted Witness Stream entries
- `POST /api/agents/scenario/run` — Run Full Scenario (7-step end-to-end guest journey)

**Iron Onboarding — Activation & Crawl** (`src/routes/dashboard.ts`):
- `POST /api/dashboard/activation/start` — GM activates crawl phase; returns 409 if already active
- `GET /api/dashboard/activation/:agentId/crawl-status?companyId=N` — per-band baseline progress (resolves by exception_class slug from authority file)
- `POST /api/dashboard/activation/:agentId/promote-to-walk` — GM promotes to walk (requires crawlComplete=true)
- `GET /api/dashboard/activation/:agentId/portfolio-status?companyId=N` — full portfolio view
- `POST /api/dashboard/activation/:agentId/cosign-run` — CO cosigns Run phase portfolio-wide

**Dashboard / Phases** (`src/routes/dashboard.ts`):
- `GET /api/dashboard/phases?companyId=N` — all agent phases for a company
- `GET /api/dashboard/phases/portfolio` — portfolio-wide phase summary
- `POST /api/dashboard/phases/promote` — promote agent to next phase
- `POST /api/dashboard/phases/promote-band` — promote specific role band
- `GET /api/dashboard/value-ledger?companyId=N&since=ISO` — AP2 ROI summary
- `GET /api/dashboard/value-ledger/events?companyId=N` — raw value event log

**Mandates** (`src/routes/dashboard.ts`):
- `GET /api/mandates?companyId=N` — active mandates
- `GET /api/dashboard/mandates?companyId=N` — alias

**HITL** (`src/routes/hitl.ts`):
- `POST /api/hitl/escalate` — create HITL card (operational_exception, raci_notification, approval)
- `POST /api/hitl/respond/:token` — resolve HITL card; `authoriseAsBaseline=true` writes `exception_baselines` row and busts 60s cache
- `GET /api/hitl/pending?companyId=N` — pending HITL tokens
- `GET /api/hitl/resolved?companyId=N` — resolved HITL tokens

**Onboarding Gate** (`src/onboarding/onboardingRollback.ts`):
- `GET /api/onboarding?role_band=compliance_officer` — CO sees `pre_admitted` records; others do not
- `POST /api/onboarding/:id/admit` — CO admits agent (status → admitted), returns full updated record
- `POST /api/onboarding/:id/reject` — CO rejects agent (status → rejected_co, reason required), returns full updated record

**Admin / Seeding** (`src/routes/admin.ts`):
- `POST /api/admin/seed-governance-files` — seed all governance Markdown files from `src/governance/` into DB
- `POST /api/admin/seed-rate-agent` — idempotent seed for Rate Agent governance files
- `POST /api/admin/quick-submit?agentSlug=rate-agent&agentName=Rate Agent` — start onboarding pipeline for a new external agent (agentCard.id = slug, not DID)

**A2A Protocol** (`src/routes/a2a.ts`):
- `GET /api/a2a` — platform agent card (`getPlatformCard`)
- `GET /api/a2a/:companyId/:agentId` — per-company agent card (includes `activeMandate`)
- `GET /.well-known/agent.json` — public agent card

**Compliance** (`src/routes/euAiAct.ts`, `src/routes/gdpr.ts`):
- `GET /api/eu-ai-act/register|monitoring|incidents|declaration`
- `GET /api/gdpr/ropa|article22|checklist|breaches`

**Apaleo MCP Proxy** (`src/routes/mcp-proxy.ts`):
- `POST /api/mcp` — transparent proxy to Apaleo MCP v3.1.1 (235 tools)

**Key lib files:**
- `src/lib/exceptionAuthorityReader.ts` — `getRejectedOrBaselinedClasses(companyId, agentId)` with 60s TTL, `getRoleBandAuthority(agentId, companyId, band)`
- `src/lib/mandateIssuer.ts` — `issueMandate`, `getActiveMandate`, `checkMandateCeiling`, `revokeMandate`
- `src/lib/mandateValidator.ts` — `requireValidMandate(agentId, action?, valueExtractor?, mode?)` Express middleware
- `src/lib/valueEventWriter.ts` — `writeValueEvent(input)` fire-and-forget value ledger writer
- `src/lib/witnessWriter.ts` — `writeWitnessEntry`, `writeGovernanceEvent`
- `src/lib/agentCredentialIssuer.ts` — W3C VC issuance, platform issuer DID, `computeGovernanceHash`
- `src/a2a/agentCardRegistry.ts` — A2A v1.0 agent cards (all 9 agents + platform card)

---

## Database Schema

**CRITICAL — Two-step schema change workflow:**
1. `cd lib/db && npm run push-force` — pushes Drizzle schema to PostgreSQL
2. `cd lib/db && npx tsc --build` — regenerates `lib/db/dist/*.d.ts` type declarations

**Both steps are mandatory every time a schema file is added or changed.**

**DB schema files:** `lib/db/src/schema/` — every new file must be `export *`'d from `lib/db/src/schema/index.ts`

### Core Tables

**`companies`** — hotel company records
- `id` serial PK, `company_name`, `website_url`, `industry`, `brand_context`, `apaleo_property_id`

**`witness_entries`** — immutable agent decision audit trail
- `id`, `company_id`, `agent`, `decision` (PASS/FAIL/ESCALATE), `file_referenced`, `clause_applied`, `action_proposed`, `exception_applied`, `escalation_target`, `reasoning`, `apaleo_data` (JSONB), `scenario_run_id`, `created_at`

**`governance_files`** — VDA-MD Markdown files stored per company+agent
- `id`, `company_id`, `agent_id`, `file_type` (AGENTS/SOP/SKILL/EXCEPTION/EXCEPTION_AUTHORITY), `file_name`, `content`, `version`, `is_archived`, `created_at`

**`hitl_tokens`** — HITL decision cards
- `id`, `token` (UUID), `company_id`, `agent_id`, `card_type` (`operational_exception`/`approval`/`raci_notification`), `role_band`, `phase`, `payload` (JSONB), `outcome`, `decided_by`, `decided_at`, `witness_entry_id`, `exception_class`, `created_at`

**`exception_baselines`** — approved baseline exception classes per agent+company+band
- `id`, `agent_id`, `company_id`, `role_band`, `exception_class`, `accepted` (bool), `rejected` (bool), `decided_by`, `decided_at`, `created_at`
- Used by `getRejectedOrBaselinedClasses()` (60s TTL cache) to suppress recurring HITL cards

**`agent_phases`** — current onboarding phase per agent+company
- `id`, `agent_id`, `company_id`, `phase` (crawl/walk/run), `agreement_rate` (numeric), `override_rate` (numeric), `role_band_phases` (JSONB — per-band phase + rates), `promoted_at`, `created_at`

**`agent_value_events`** — AP2 economic metering (value event ledger)
- `id`, `agent_id`, `company_id`, `property_code`, `action`, `revenue_delta` (numeric 12,2), `cost_cents` (int), `currency` (default EUR), `decision_outcome` (PASS/FAIL/ESCALATE), `witness_token`, `governance_phase`, `source_data` (JSON text), `created_at`

**`agent_mandates`** — AP2 Signed Intent Mandates
- `id`, `mandate_id` (unique, signed), `company_id`, `agent_id`, `agent_did`, `issuer_did`, `phase` (crawl/walk/run), `authorizations` (JSONB `[{action, ceiling, unit, currency}]`), `linked_governance_hash`, `signature` (HMAC-SHA256), `issued_at`, `valid_until`, `revoked` (bool), `revoked_at`, `revoked_reason`, `onboarding_id`

---

## AI Integration

Uses Replit AI Integrations for Anthropic access:
- `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` — auto-set by Replit
- `AI_INTEGRATIONS_ANTHROPIC_API_KEY` — auto-set by Replit
- No user API key required; charges billed to Replit credits

Available models (via proxy):
- `claude-sonnet-4-6` (recommended)
- `claude-opus-4-6`
- `claude-haiku-4-5`

---

## Compliance Reporting API

Compliance Officer role has a dedicated view (`ComplianceOfficerView.jsx`) with:

### Approvals tab
- **CO Pending Admission** — `pre_admitted` onboarding records awaiting CO review; Admit/Reject buttons call `/api/onboarding/:id/admit` and `/api/onboarding/:id/reject`
- HITL Gate 1 / Gate 2 task queues, pending/approved/rejected counts

### EU AI Act tab (`src/routes/euAiAct.ts`)
- `GET /api/eu-ai-act/register` — AI System Register (Art. 60/63)
- `GET /api/eu-ai-act/monitoring` — Post-market monitoring (Art. 72)
- `GET /api/eu-ai-act/incidents` — Serious incident register (Art. 73)
- `GET /api/eu-ai-act/declaration` — Declaration of Conformity (Art. 47)

### GDPR tab (`src/routes/gdpr.ts`)
- `GET /api/gdpr/ropa` — Records of Processing Activities (Art. 30)
- `GET /api/gdpr/article22` — Automated decision-making register (Art. 22)
- `GET /api/gdpr/checklist` — Article-by-article gap assessment
- `GET /api/gdpr/breaches` — Data breach/near-miss register (Art. 33)

---

## Testing & Verification

### TypeScript type check

```bash
cd lib/db && npx tsc --build          # regenerates lib/db/dist/ types
cd artifacts/api-server && npx tsc --noEmit  # zero errors expected (except pre-existing admin.ts AgentCard.capabilities)
```

### API smoke tests (server on port 8080)

```bash
# Health
curl http://localhost:8080/api/healthz

# Iron Onboarding — crawl flow
curl "http://localhost:8080/api/dashboard/activation/rate-agent/crawl-status?companyId=1"
curl -X POST http://localhost:8080/api/dashboard/activation/rate-agent/promote-to-walk \
  -H "Content-Type: application/json" -d '{"companyId":1,"promotedBy":"Hotel GM"}'

# Value ledger (AP2 economic metering)
curl "http://localhost:8080/api/dashboard/value-ledger?companyId=1"
curl "http://localhost:8080/api/dashboard/value-ledger/events?companyId=1&limit=10"

# Mandates (AP2 Signed Intent Mandates) — registered at BOTH paths
curl "http://localhost:8080/api/mandates?companyId=1"
curl "http://localhost:8080/api/dashboard/mandates?companyId=1"

# A2A agent card (with mandate)
curl "http://localhost:8080/api/a2a/1/rate-agent"
curl "http://localhost:8080/.well-known/agent.json"

# CO onboarding gate
curl "http://localhost:8080/api/onboarding?role_band=compliance_officer&companyId=1"

# DB tables
psql $DATABASE_URL -c "\dt agent_value*"       # must show agent_value_events
psql $DATABASE_URL -c "\dt agent_mandate*"     # must show agent_mandates
psql $DATABASE_URL -c "\dt exception_baselines*" # must show exception_baselines
psql $DATABASE_URL -c "\dt agent_phases*"      # must show agent_phases
```

### Value event write verification

```bash
psql $DATABASE_URL -c "SELECT agent_id, action, revenue_delta, decision_outcome, created_at FROM agent_value_events ORDER BY created_at DESC LIMIT 10;"
```

### Mandate issuance verification

```bash
psql $DATABASE_URL -c "SELECT mandate_id, agent_id, phase, issued_at, valid_until, revoked FROM agent_mandates ORDER BY issued_at DESC LIMIT 5;"
```

### Exception baseline verification

```bash
psql $DATABASE_URL -c "SELECT agent_id, company_id, role_band, exception_class, accepted, decided_at FROM exception_baselines ORDER BY decided_at DESC LIMIT 10;"
```

### After any schema change — full checklist

1. Edit `lib/db/src/schema/<NewTable>.ts`
2. Add `export * from "./<NewTable>";` to `lib/db/src/schema/index.ts`
3. `cd lib/db && npm run push-force` — sync to PostgreSQL
4. `cd lib/db && npx tsc --build` — regenerate type declarations
5. Restart the API server workflow to pick up the new bundle
6. Run `cd artifacts/api-server && npx tsc --noEmit` — confirm zero type errors
7. Smoke test the new endpoint with `curl`
