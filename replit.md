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

React + Vite frontend. Hospitality-only AI governance operating system for Apaleo-powered properties:
- **Locked to hospitality**: multi-industry configs stripped, Apaleo guest lifecycle hardcoded (Discover & Book → Check-In → In-Stay → Checkout → Post-Stay)
- **Apaleo Property ID field** in setup wizard — connects live sandbox data
- **Live stats bar** in Hub header: Arrivals Today, Departures, In-House, Open Folios, Maintenance
- **Journey stage live badges**: real-time counts from Apaleo API on each stage card
- **Brand context ingestion** from property website via `/api/ingest/website`
- **C2MD Translation Engine**: generates NIST SP 800-53 governance Markdown via Claude AI
- **Exception overlay engine**: baseline vs exception governance policy decisions
- **Witness Agent** audit trail (SOC 2, GDPR, EU AI Act, ISO 42001 compliant)

Entry: `src/VdaOS.jsx` — full self-contained component
Hooks: `src/hooks/use-apaleo.ts` — `useApaleoStats`, `useApaleoReservations`, `useApaleoProperties`, `useApaleoProperty`

All AI API calls go to `/api/ai/messages` (backend proxy), NOT directly to Anthropic.
All Apaleo data calls go to `/api/apaleo/*` (backend proxy), NOT directly to Apaleo.

### `artifacts/api-server` — Express API Server

- `/api/healthz` — health check
- `/api/ai/messages` — Anthropic API proxy (uses Replit AI Integration, no user key needed)
  - Automatically maps model names (e.g. `claude-sonnet-4-20250514` → `claude-sonnet-4-6`)
- **Apaleo API Proxy** (`src/routes/apaleo.ts`) — all calls authenticated via server-side OAuth
  - `GET /api/apaleo/properties` — list all properties
  - `GET /api/apaleo/properties/:id` — single property
  - `GET /api/apaleo/properties/:id/stats` — aggregated dashboard stats (arrivals, departures, in-house, folios, maintenance)
  - `GET /api/apaleo/reservations` — list with filters (propertyId, status, dateFrom, dateTo, page)
  - `GET /api/apaleo/reservations/:id` — single reservation with full expand
  - `GET /api/apaleo/folios` — folios (propertyId, reservationId, status)
  - `GET /api/apaleo/folios/:id` — single folio
  - `GET /api/apaleo/unit-groups` — room categories
  - `GET /api/apaleo/rate-plans` — rate plans
  - `GET /api/apaleo/maintenances` — maintenance tasks
  - `GET /api/apaleo/units` — room inventory (with condition filter)
  - `GET /api/apaleo/availability/unit-groups` — availability by unit group
- **VDA-MD Agent Suite** (`src/routes/agents.ts`) — 7 AI agents + Witness Stream persistence
  - `POST /api/agents/availability` — Availability Agent (live unit group availability query)
  - `POST /api/agents/rate` — Rate Agent (BAR vs requested rate, policy-governed override logic)
  - `POST /api/agents/reservation` — Reservation Bot (create/retrieve/modify reservations)
  - `POST /api/agents/checkin` — Check-In Agent (5-check validation, folio/ID verification)
  - `POST /api/agents/folio` — Folio Agent (charge analysis, threshold flagging)
  - `POST /api/agents/checkout` — Checkout Agent (folio settlement, loyalty late checkout)
  - `POST /api/agents/revenue` — Revenue Reconciliation Agent (daily variance analysis)
  - `GET /api/agents/witness?companyId=N` — retrieve persisted Witness Stream entries
  - `POST /api/agents/scenario/run` — Run Full Scenario (7-step end-to-end guest journey)

**Apaleo MCP Proxy** (`src/routes/mcp-proxy.ts`):
- Transparent proxy to `https://mcp.apaleo.com/mcp` (Apaleo MCP v3.1.1, 235 tools)
- Endpoint: `POST /api/mcp` — no client auth needed, proxy handles Apaleo bearer token
- Auto-refreshes Apaleo token using the same cached token service (60 min TTL)
- Forwards `Mcp-Session-Id` headers bidirectionally for session continuity
- Supports SSE streaming and standard JSON responses
- Connect any MCP client (mcpjam, Postman, Claude Desktop) to: `https://<dev-domain>/api/mcp`
- Full MCP protocol: `initialize` → `tools/list` → `tools/call`

**Apaleo OAuth** (`src/lib/apaleo.ts`):
- `client_credentials` flow against `https://identity.apaleo.com/connect/token`
- Token cached in memory with 5-min buffer before expiry
- Secrets: `APALEO_CLIENT_ID`, `APALEO_CLIENT_SECRET` (Replit env secrets)
- Scopes: omit `scope` param → server returns all scopes registered on the app
  (Confirmed: `reservations.read`, `folios.read`, `availability.read`, `rates.read`, `reports.read`, `maintenances.read`, etc.)

## AI Integration

Uses Replit AI Integrations for Anthropic access:
- `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` — auto-set by Replit
- `AI_INTEGRATIONS_ANTHROPIC_API_KEY` — auto-set by Replit
- No user API key required; charges billed to Replit credits

Available models (via proxy):
- `claude-sonnet-4-6` (recommended)
- `claude-opus-4-6`
- `claude-haiku-4-5`

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. Routes in `src/routes/`.
- `health.ts` — `GET /api/healthz`
- `ai-proxy.ts` — `POST /api/ai/messages` (Anthropic proxy)
- `companies.ts` — REST CRUD for companies:
  - `GET /api/companies` — list all (sorted by savedAt DESC)
  - `POST /api/companies` — create a company record
  - `DELETE /api/companies/:id` — delete by integer id

### `lib/integrations-anthropic-ai` (`@workspace/integrations-anthropic-ai`)

Pre-configured Anthropic SDK client using Replit AI Integration env vars.

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL.

**Schema:**

`companies` table:
- `id` — serial primary key
- `company_name`, `website_url`, `industry` — company identity
- `brand_context` — ingested brand text (up to 8000 chars)
- `files_count` — count of uploaded documents
- `saved_at` — user save timestamp (bigint)
- `uploaded_files` — JSONB (currently null, reserved)
- `apaleo_property_id` — optional Apaleo property code (e.g. "BER") for live sandbox data
- `created_at`, `updated_at` — auto-managed timestamps

`witness_entries` table (Task 3 — agent audit trail):
- `id` — serial primary key
- `company_id` — FK to companies
- `agent` — agent name (e.g. "Availability Agent")
- `decision` — PASS / FAIL / ESCALATE
- `file_referenced` — governing policy file
- `clause_applied` — specific policy clause
- `action_proposed` — what the agent proposed to do
- `exception_applied` — boolean flag
- `escalation_target` — role to escalate to (nullable)
- `reasoning` — 1-3 sentence AI explanation
- `apaleo_data` — JSONB raw Apaleo API data used
- `scenario_run_id` — groups entries from a single scenario run
- `created_at` — auto-managed timestamp

`agent_value_events` table (AP2 economic metering — value event ledger):
- `id` — serial primary key
- `agent_id` — agent slug (e.g. "availability-agent")
- `company_id` — FK to companies
- `property_code` — Apaleo property code (e.g. "BER"), nullable
- `action` — event type (e.g. "availability_check", "reservation_create", "folio_charge")
- `revenue_delta` — numeric(12,2), revenue approved by governance decision in EUR
- `cost_cents` — integer, estimated governance cost (LLM + API overhead)
- `currency` — varchar(3), default "EUR"
- `decision_outcome` — varchar(20), default "PASS" (PASS / FAIL / ESCALATE)
- `witness_token` — text, FK-style reference to witness_entries.id
- `governance_phase` — varchar(20), agent's current phase (crawl/walk/run)
- `source_data` — text (JSON stringified), snapshot of inputs used
- `created_at` — timestamp with timezone, auto-set

`agent_mandates` table (AP2 Signed Intent Mandates):
- `id` — serial primary key
- `mandate_id` — text unique, HMAC-SHA256 signed mandate identifier
- `company_id` — integer FK to companies
- `agent_id` — text agent slug
- `phase` — varchar(10) crawl/walk/run
- `authorizations` — JSONB array of `{ action, ceiling, currency }` authorization tiers
- `issued_at` — timestamp with timezone
- `valid_until` — timestamp with timezone (90-day validity)
- `issuer_did` — text issuer DID
- `signature` — text HMAC-SHA256 signature over canonical JSON
- `revoked` — boolean default false
- `revoked_at` — timestamp, nullable

**CRITICAL — Two-step schema change workflow:**
1. `cd lib/db && npm run push-force` — pushes Drizzle schema to PostgreSQL (NOT `npm run db:push`)
2. `cd lib/db && npx tsc --build` — regenerates `lib/db/dist/*.d.ts` type declarations

**Both steps are mandatory every time a schema file is added or changed.** Skipping step 2 leaves stale `.d.ts` files in `lib/db/dist/`. esbuild (the API server bundler) reads source `.ts` files directly and works fine, but TypeScript project references in `artifacts/api-server/tsconfig.json` resolve to the compiled `.d.ts` files. Stale declarations cause `tsc --noEmit` to report exports like `agentValueEvents` as non-existent even though they are bundled correctly at runtime. This creates invisible type debt that breaks future compile-time checks.

**DB schema files live in:** `lib/db/src/schema/` — every new schema file must be `export *`'d from `lib/db/src/schema/index.ts`

### `lib/api-spec` (`@workspace/api-spec`)

OpenAPI spec + Orval codegen config.

Run codegen: `pnpm --filter @workspace/api-spec run codegen`

## Compliance Reporting API

Compliance Officer role has a dedicated view (`ComplianceOfficerView.jsx`) with three tabs:

### Gate Approvals tab
HITL task queues (Gate 1 / Gate 2), pending/approved/rejected counts, per-task approve/reject UI.

### EU AI Act tab (`src/routes/euAiAct.ts`)
- `GET /api/eu-ai-act/register` — AI System Register (Art. 60/63), per-agent risk class, prohibited-use check, market status
- `GET /api/eu-ai-act/monitoring` — Post-market monitoring (Art. 72), decision rates, anomalies, model version check
- `GET /api/eu-ai-act/incidents` — Serious incident register (Art. 73), 90-day window, COMPLIANCE_BOUNDARY/FAIL + FRAMEWORK_INTEGRITY/FAIL events
- `GET /api/eu-ai-act/declaration` — Declaration of Conformity (Art. 47), structured conformity fields
Article-by-article checklist (Art. 9/10/12/13/14/17/26/47/49/72/73) with tri-state status (green/amber/red).

### GDPR tab (`src/routes/gdpr.ts`)
- `GET /api/gdpr/ropa` — Records of Processing Activities (Art. 30): 8 per-agent activities, lawful basis, data categories, Art. 22 scope flag, retention
- `GET /api/gdpr/article22` — Automated decision-making register (Art. 22): 5 in-scope agents, HITL engagement rate, automated vs human-reviewed counts (last 30 days)
- `GET /api/gdpr/checklist` — Article-by-article gap assessment (Art. 5/6/13-14/22/25/30/32/33/35) with tri-state status derived from live DB data
- `GET /api/gdpr/breaches` — Data breach/near-miss register (Art. 33): 90-day window, COMPLIANCE_BOUNDARY/FAIL (regulatory near-miss) + FRAMEWORK_INTEGRITY/FAIL (security events)

GDPR agent coverage:
- Art. 22 scope (5 agents): rate-agent, reservation-bot, check-in-agent, folio-charge-agent, checkout-agent
- Art. 22 out of scope (3 agents): availability-agent, folio-agent, revenue-reconciliation-agent
- Lawful basis: Art. 6(1)(b) — performance of contract for guest-facing; Art. 6(1)(f) — legitimate interests for folio + revenue-reconciliation
- Controller: citizenM Hotels · Processor: Rawson Consulting BV — VDA-MD Platform
- Privacy by Design (Art. 25): Microsoft Presidio PII scrubbing layer before LLM inference

---

## Testing

### TypeScript type check (run after any schema or import change)

```bash
cd lib/db && npx tsc --build          # must run first — regenerates lib/db/dist/ types
cd artifacts/api-server && npx tsc --noEmit  # should produce zero errors
```

If `tsc --noEmit` reports `Module '"@workspace/db"' has no exported member 'X'`, the fix is always `cd lib/db && npx tsc --build`. This regenerates the stale `.d.ts` files. esbuild bundles from source so the runtime is fine, but TypeScript checks against the compiled declarations.

### API endpoint smoke tests (server must be running on port 8080)

```bash
# Health check
curl http://localhost:8080/api/healthz

# Value ledger (AP2 economic metering)
curl "http://localhost:8080/api/dashboard/value-ledger?companyId=1"
curl "http://localhost:8080/api/dashboard/value-ledger/events?companyId=1&limit=10"

# Mandates (AP2 Signed Intent Mandates) — registered at BOTH paths
curl "http://localhost:8080/api/mandates?companyId=1"
curl "http://localhost:8080/api/dashboard/mandates?companyId=1"

# Dashboard phases
curl "http://localhost:8080/api/dashboard/phases?companyId=1"

# Agent card (public A2A)
curl "http://localhost:8080/.well-known/agent.json"

# DB table existence check
psql $DATABASE_URL -c "\dt agent_value*"     # must show agent_value_events
psql $DATABASE_URL -c "\dt agent_mandate*"   # must show agent_mandates
```

### Value event write verification

After running the Live Demo or scenario runner, verify events were persisted:

```bash
psql $DATABASE_URL -c "SELECT agent_id, action, revenue_delta, decision_outcome, created_at FROM agent_value_events ORDER BY created_at DESC LIMIT 10;"
```

If the table is empty after a demo run, check server logs for `[ValueLedger] FAILED to write value event` (logged at ERROR level with full context: agentId, companyId, action, error message).

**Architecture note — dual call paths:** There are two code paths that invoke agents:
1. **Individual agent routes** — `/api/agents/availability`, `/api/agents/rate`, etc. — each protected by `requireAgentCredential` middleware. These have `writeValueEvent` wired at lines 754–1541.
2. **Scenario runner** — `POST /api/agents/scenario/run` — called by `DemoShowreel.jsx`. This has its own **inline** implementation for all 7 steps and bypasses `requireAgentCredential`. `writeValueEvent` was added to all 7 steps (lines 1993–2432) on 2026-04-27. Prior to that date, only `writeWitnessEntry` was called by the scenario runner — which is why `agent_value_events` was empty while `witness_entries` had data.

### Mandate issuance verification

After onboarding a hotel to the Walk or Run phase:

```bash
psql $DATABASE_URL -c "SELECT mandate_id, agent_id, phase, issued_at, valid_until, revoked FROM agent_mandates ORDER BY issued_at DESC LIMIT 5;"
```

### After any schema change — full checklist

1. Edit `lib/db/src/schema/<NewTable>.ts`
2. Add `export * from "./<NewTable>";` to `lib/db/src/schema/index.ts`
3. `cd lib/db && npm run push-force` — sync to PostgreSQL
4. `cd lib/db && npx tsc --build` — regenerate type declarations
5. Restart the API server workflow to pick up the new bundle
6. Run `cd artifacts/api-server && npx tsc --noEmit` — confirm zero type errors
7. Smoke test the new endpoint with `curl`
