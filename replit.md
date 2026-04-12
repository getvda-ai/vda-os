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

Run `pnpm --filter @workspace/db run push` to sync schema changes to the database.

### `lib/api-spec` (`@workspace/api-spec`)

OpenAPI spec + Orval codegen config.

Run codegen: `pnpm --filter @workspace/api-spec run codegen`
