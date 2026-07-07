# VDA-MD System Blueprint
## Value-Driven AI — Governance-as-Markdown Operating System
### Platform: citizenM Hotels × Apaleo PMS

---

## 1. What This System Is

VDA-MD is an **AI governance operating system** built specifically for hotels running on the Apaleo property management system. It governs every AI agent decision using Markdown files stored in a PostgreSQL database — the system's core mandate is **no hardcoded policy**: every rule an agent follows lives in a `.AGENTS.md`, `.SOP.md`, or `.SKILL.md` file that a human can read, edit, and audit.

The platform is designed to satisfy **EU AI Act Article 17** (high-risk AI system governance) and acts as the compliance proof layer between hotel operations and AI automation.

The primary audience is **citizenM Hotels** whose "ambassadors" (front desk staff) and Hotel GMs interact with AI agents in real time via a Human-in-the-Loop (HITL) decision queue.

---

## 2. Repository Structure

```
/ (pnpm workspace monorepo)
├── artifacts/
│   ├── vda-os/               React 19 + Vite frontend (the Operating System UI)
│   ├── api-server/           Express 5 + Node 24 backend
│   └── mockup-sandbox/       Vite component preview server (canvas/design only)
├── packages/
│   └── db/                   Drizzle ORM schema + migrations (shared)
└── scripts/
    └── post-merge.sh         Runs DB migrations after task-agent merges
```

**Tech stack:**
- Frontend: React 19, Vite, plain inline styles (no CSS framework), IBM Plex Mono + Outfit fonts
- Backend: Express 5, TypeScript, Drizzle ORM, Fastify logger (pino)
- Database: PostgreSQL 16 (Replit-managed, accessed via `DATABASE_URL`)
- AI: Anthropic Claude (claude-3-5-haiku / claude-3-5-sonnet) via `/api/ai-proxy`
- PMS: Apaleo REST API + Apaleo MCP (Model Context Protocol) server

---

## 3. Frontend — VDA-OS

Single React app (`artifacts/vda-os/src/VdaOS.jsx` — ~14,700 lines). All screens are rendered as conditional blocks inside a single root component. Screen state machine:

```
screen = "onboarding"   → OnboardingConsole (home/landing)
screen = "hitl-demo"    → HITLDemo standalone (no hotel required)
screen = "directory"    → Hotel picker
screen = "wizard"       → Setup wizard
screen = "hub"          → Hotel Hub (per-property dashboard)
```

**Hub tab navigation (inside a hotel):**
| Tab ID | Name | Role |
|---|---|---|
| `dashboard` | Dashboard | All |
| `onboarding` | Agent Onboarding | CISO / GM |
| `agents` | Live Demo | All |
| `witness` | Witness Agent | All |
| `file-manager` | File Manager | CISO |
| `hitl-demo` | HITL Decisions | Ambassador / GM |
| `value-ledger` | Value Ledger | GM |

**Key frontend components:**
- `OnboardingConsole` — Three-track starting screen with Apaleo status, portfolio revenue, Value Ledger, and HITL Demo button
- `HITLDemo` — Standalone HITL decision queue (works without a hotel; ships with 9 citizenM sample scenarios)
- `WitnessAgent` — Immutable audit log viewer
- `FileManager` — Governance file editor with §3/§4 compliance guards
- `AgentHub` — Live agent scenario runner with MCP tool call visibility

---

## 4. Backend — API Server

**Entry:** `artifacts/api-server/src/app.ts` → registers all routes.

### Route Map

| Prefix | File | Purpose |
|---|---|---|
| `/api/health` | `routes/health.ts` | Liveness + DB check |
| `/api/companies` | `routes/companies.ts` | Hotel company CRUD |
| `/api/onboarding` | `routes/onboarding.ts` (+ orchestrator) | 7-phase agent admission |
| `/api/agents` | `routes/agents.ts` | Live agent scenario execution |
| `/api/hitl/*` | `routes/hitl.ts` | HITL token create/respond/query |
| `/api/fm/*` | `routes/fileManager.ts` | Markdown governance file CRUD |
| `/api/apaleo/*` | `routes/apaleo.ts` | Apaleo REST proxy + status |
| `/api/apaleo/mcp/*` | `routes/mcp-proxy.ts` | Apaleo MCP tool execution proxy |
| `/api/a2a/*` | `routes/a2a.ts` | Google A2A JSON-RPC 2.0 protocol |
| `/api/dashboard/*` | `routes/dashboard.ts` | Phase status, value ledger metrics |
| `/api/witness` | inside agents.ts | Witness stream read |
| `/api/gdpr/*` | `routes/gdpr.ts` | GDPR data subject requests |
| `/api/eu-ai-act/*` | `routes/euAiAct.ts` | EU AI Act Article 17 self-assessment |
| `/api/billing/*` | `routes/billing.ts` | Credit wallet + ledger (x402) |
| `/api/seed` | `routes/seed.ts` | Seed demo data |

---

## 5. Database Schema

All tables live in `packages/db/` via Drizzle ORM.

### Core Tables

**`companies`** — Hotel property tenant record
```
id, name, apaleo_property_id, website_url, industry, created_at
```

**`governance_files`** — The heart of the system. Every agent policy lives here.
```
id, company_id, agent_slug, file_type (AGENTS_MD|SOP_MD|SKILL_MD|EXCEPTION_AUTHORITY_MD|AP2_INTENT_MANDATE),
content (markdown text), version, created_by, created_at, updated_at
```

**`witness_entries`** — Immutable, append-only audit log. Never updated, never deleted.
```
id, company_id, agent, decision (PASS|FAIL|ESCALATE|HITL_APPROVED|HITL_REJECTED|BASELINE_SET),
reasoning, action_proposed, clause_applied, files_consulted, apaleo_data (jsonb),
event_category, created_at
```

**`hitl_tokens`** — Pending human decisions
```
token (uuid PK), onboarding_request_id, phase, card_type, payload (jsonb),
role_band (ambassador|hotel_gm|regional_gm|compliance_officer),
agent_id, company_id, resolved_at, outcome, decided_by, reason, created_at
```

**`onboarding_requests`** — Agent admission state machine
```
id (uuid), company_id, agent_id, status (received|analysing|generating|awaiting_hitl|sandbox|awaiting_hitl_2|committed|rejected),
submitted_at, impact_delta (jsonb), sandbox_results (jsonb), updated_at
```

**`agent_phases`** — Crawl / Walk / Run lifecycle per agent per property
```
id, company_id, agent_slug, phase (crawl|walk|run), promoted_at,
mandate_id (FK), hitl_agreement_rate, hitl_override_rate
```

**`agent_mandates`** — AP2 Intent Mandates (cryptographically signed spending authority)
```
id (uuid), company_id, agent_slug, phase, actions (jsonb array of {action, ceiling, currency}),
signed_by, signature, valid_from, valid_until, revoked, revoked_reason, created_at
```

**`agent_credentials`** — W3C Verifiable Credentials (DID-based agent identity)
```
id, company_id, agent_id, did, credential (jsonb — full VC), issued_at, expires_at, revoked
```

**`exception_baselines`** — Approved "the agent can do this autonomously going forward" records
```
id, company_id, agent_slug, exception_class, authorised_by, role_band,
approved_hitl_token (FK), context_hash, created_at
```

**`value_events`** — Revenue attribution per agent action
```
id, company_id, agent_slug, event_type, amount_eur, reservation_id, description, created_at
```

**`credit_wallets`** — x402 billing credit balance per company
```
company_id (PK), balance_credits (integer), updated_at
```

**`credit_ledger`** — x402 billing transaction log
```
id, company_id, delta_credits, operation_type, ref_id, note, created_at
```

---

## 6. The Governance Model (VDA-MD Framework)

### Core Principle
**"No hardcoded policy."** Every rule an agent must follow is expressed as a clause in a Markdown file. Claude reads the file at runtime and cites the exact clause in its decision.

### Three Mandatory Files Per Agent

| File | Purpose |
|---|---|
| `{agent}.AGENTS.md` | **The law.** MUST/MUST NOT/SHOULD rules, authority ceilings, escalation triggers |
| `{agent}.SOP.md` | Standard Operating Procedure — step-by-step procedure the agent follows |
| `{agent}.SKILL.md` | Capability declaration — what the agent can do, what tools it can call |

### Fourth File (Authority)
| File | Purpose |
|---|---|
| `{agent}.EXCEPTION_AUTHORITY.md` | Exception class definitions — which exceptions need HITL vs. can be autonomous |

### Governance Pre-flight (§2.1)
Before ANY agent executes, the system checks:
1. `AGENTS.md` exists for this agent+company → if missing: hard ESCALATE
2. `SOP.md` exists → if missing: hard ESCALATE
3. `SKILL.md` exists → if missing: hard ESCALATE
4. `EXCEPTION_AUTHORITY.md` OR an active AP2 Intent Mandate exists → if neither: ESCALATE to compliance officer

### Decision Outcomes
Every agent call returns exactly one of:
- `PASS` — action taken autonomously within policy
- `FAIL` — action blocked by policy
- `ESCALATE` — routed to HITL queue with role_band targeting
- `HITL_APPROVED` / `HITL_REJECTED` / `BASELINE_SET` — logged after human decision

### Witness Stream
Every decision (PASS, FAIL, ESCALATE) writes a `witness_entry` record containing:
- The verbatim policy clause cited
- Which files were consulted
- The Apaleo data snapshot used to make the decision
- The agent's full reasoning chain
- EU AI Act Article 17 compliance metadata

---

## 7. The Eight Governed Agents

All agents operate on the **guest lifecycle** at a citizenM property:

| Agent Slug | Role | Key Authority |
|---|---|---|
| `availability-agent` | Check room inventory | Read-only, no write actions |
| `rate-agent` | Rate overrides and discounts | Autonomous ≤9%; HITL for 10–15%; GM approval for >15% |
| `reservation-bot` | Create/modify bookings | Autonomous for standard bookings; HITL for >3-night modifications |
| `check-in-agent` | Early check-in, upgrades | Autonomous for standard; HITL if upgrade value >£40 |
| `folio-charge-agent` | Post charges to guest folio | Autonomous ≤£50; HITL above ceiling |
| `checkout-agent` | Late checkout, refunds | Autonomous ≤£100 refund; HITL for >£100 |
| `revenue-reconciliation-agent` | Daily revenue variance | Flags variances >5% to GM |
| `witness-agent` | Audit logging only | No decision authority — observation only |

Plus the **Onboarding Agent** (platform-level, handles the 7-phase admission process).

---

## 8. Agent Lifecycle — Crawl → Walk → Run

Each agent at each property progresses through three phases, controlled by **AP2 Intent Mandates**:

```
CRAWL: Agent proposes actions. All proposals go to HITL. No autonomous execution.
WALK:  Agent executes within mandate ceilings. Exceptions still go to HITL.
RUN:   Agent operates fully autonomously within mandate. HITL only for ceiling breaches.
```

**Phase promotion criteria:**
- HITL agreement rate >85% over last 30 decisions
- HITL override rate <10%
- No compliance boundary violations in last 7 days
- Manual GM sign-off required for CRAWL→WALK

---

## 9. AP2 Intent Mandates

A signed JSON document stored in `governance_files` as `AP2_INTENT_MANDATE` type.

```json
{
  "agentSlug": "rate-agent",
  "companyId": 1,
  "phase": "walk",
  "actions": [
    { "action": "discount", "ceiling": 150, "currency": "GBP" },
    { "action": "rate_override", "ceiling": 200, "currency": "GBP" }
  ],
  "signedBy": "hotel_gm",
  "signature": "<HMAC-SHA256>",
  "validFrom": "2026-01-01T00:00:00Z",
  "validUntil": "2026-12-31T23:59:59Z"
}
```

The `requireValidMandate` middleware validates the signature and checks the action falls within ceiling before allowing execution. If the mandate is expired, revoked, or missing the action type → automatic ESCALATE.

---

## 10. HITL System (Human-in-the-Loop)

### Token Flow
```
Agent returns ESCALATE
  → POST /api/hitl/escalate  (creates hitl_token with role_band)
  → Dashboard polls GET /api/hitl/pending?role_band=ambassador&company_id=1
  → Human sees card, taps Approve/Deny/Escalate/Baseline
  → POST /api/hitl/respond/:token { outcome, reason, decided_by }
  → If onboarding: advances orchestrator phase
  → Writes witness_entry (HITL_APPROVED or HITL_REJECTED)
  → If authoriseAsBaseline: inserts exception_baseline record
```

### Role Bands (routing targets)
| Band | Who sees it |
|---|---|
| `ambassador` | Front desk staff — low-risk operational decisions |
| `hotel_gm` | Hotel General Manager — financial decisions, rate overrides |
| `regional_gm` | Regional GM — group rates, multi-property decisions |
| `compliance_officer` / `ciso` | Compliance team — policy changes, EU AI Act items |

### Baselining
When a human approves an exception and marks it "Set as baseline", the system writes an `exception_baseline` record. Future identical requests from the same agent are auto-PASS without HITL. The Witness Agent logs baseline applications.

---

## 11. Onboarding Flow — 7-Phase Agent Admission

New AI agents request admission via `POST /api/a2a/onboarding` (A2A protocol). The orchestrator drives them through:

| Phase | What Happens |
|---|---|
| 1 RECEIVED | Agent Card (DID, capabilities, .well-known/agent.json) submitted |
| 2 ANALYSING | Impact Delta Analysis — Claude assesses conflicts, value add, risk |
| 3 GENERATING | System auto-generates AGENTS.md, SOP.md, SKILL.md, EXCEPTION_AUTHORITY.md |
| 4 AWAITING HITL | Compliance Officer reviews and approves generated governance files |
| 5 SANDBOX | Adversarial evaluation — Claude Haiku acts as a bad actor to probe the agent's SOPs |
| 6 AWAITING HITL 2 | Final review: sandbox results, pass rate, any policy gaps found |
| 7 COMMITTED | W3C VC issued, AP2 Mandate signed, agent is live at CRAWL phase |

---

## 12. A2A Protocol (Agent-to-Agent)

VDA-MD implements **Google A2A / JSON-RPC 2.0** for agent-to-agent communication.

**Discovery endpoints:**
```
GET /.well-known/agent.json           → Platform Agent Card
GET /api/a2a/onboarding/agent.json    → Onboarding Agent Card
GET /api/a2a/:companyId/agents        → All 9 agent cards for a property
GET /api/a2a/:companyId/:agentId/agent.json → Single agent card
```

**Execution:**
```
POST /api/a2a/:companyId/:agentId     → JSON-RPC 2.0 task request
  Body: { jsonrpc: "2.0", method: "tasks/send", params: { message, sessionId } }
  Auth: Requires valid W3C VC in Authorization header + valid AP2 mandate
  Response: { id, status: "completed"|"escalated"|"failed", artifacts: [...] }
```

**Security layers on A2A execution:**
1. `requireAgentCredential` — validates W3C VC signature and expiry
2. `requireValidMandate` — validates AP2 mandate, checks action ceiling
3. `x402Middleware` — deducts credits from company wallet (1 credit per governance decision)
4. Governance pre-flight — checks all 3 mandatory files exist

---

## 13. Apaleo Integration

### Authentication
OAuth 2.0 Client Credentials flow. Credentials:
- `APALEO_CLIENT_ID` (Replit secret)
- `APALEO_CLIENT_SECRET` (Replit secret)
- Token cached in-memory, auto-refreshed before expiry

### REST Proxy
`GET|POST /api/apaleo/*` proxies to `https://api.apaleo.com` with Bearer token injection. Used for:
- Property inventory (`/inventory/v1/properties`)
- Reservations (`/booking/v1/reservations`)
- Folios and charges (`/finance/v1/folios`)
- Rate plans (`/rateplan/v1/rate-plans`)

### MCP (Model Context Protocol)
Apaleo exposes a JSON-RPC MCP server at `mcp.apaleo.com`. The system:
1. Lists available tools: `GET /api/apaleo/mcp/tools`
2. Calls tools: `POST /api/apaleo/mcp/call { tool, params }`
3. Injects Bearer token for each call
4. Claude agents use these tools (CreateReservation, PostCharge, UpdateReservation, etc.) within their mandate ceilings

MCP governance: every MCP tool call is logged to the Witness Stream before execution.

---

## 14. Value Ledger

Tracks the financial value generated by AI agents, per property and per agent.

**Value events are written when:**
- An agent books a reservation (revenue credited)
- A rate agent closes a walk-in at a higher rate than initially offered
- A checkout agent recovers a potential chargeback
- A check-in agent upsells a room upgrade

**Portfolio view:** The `OnboardingConsole` header shows total attributed revenue across all properties (30-day rolling).

---

## 15. EU AI Act Compliance Features

The system is purpose-built for **EU AI Act Article 17** (governance of high-risk AI systems):

| Requirement | Implementation |
|---|---|
| Article 17(1)(a) — Risk management | `AGENTS.md` risk classification per agent |
| Article 17(1)(b) — Data governance | GDPR routes (`/api/gdpr/*`), data subject request log |
| Article 17(1)(d) — Record keeping | Witness Stream — immutable, tamper-evident logs |
| Article 17(1)(e) — Transparency | File Manager — all governance files human-readable |
| Article 17(1)(f) — Human oversight | HITL system — every exception requires human sign-off |
| Article 17(1)(g) — Accuracy/robustness | Sandbox phase in onboarding — adversarial testing |

The `GET /api/eu-ai-act/self-assessment` endpoint generates a structured Article 17 compliance report for each property.

---

## 16. x402 Billing (Credit System)

Each company has a credit wallet. Operations cost credits:
- 1 credit per governance decision (`/api/a2a/:companyId/:agentId`)

The `x402Middleware` deducts credits before execution. If wallet balance is 0, returns HTTP 402 Payment Required. Admin routes:
```
GET  /api/billing/balance/:companyId
GET  /api/billing/ledger/:companyId
POST /api/billing/topup { companyId, credits }
```

---

## 17. Key Environment Variables

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | Replit managed | PostgreSQL connection string |
| `APALEO_CLIENT_ID` | Replit secret | Apaleo OAuth client ID |
| `APALEO_CLIENT_SECRET` | Replit secret | Apaleo OAuth client secret |
| `OFFER_HMAC_SECRET` | Replit shared env | HMAC key for signing UCP offer tokens |
| `PORT` | Runtime injected | Each artifact binds to this port |
| `REPLIT_DEV_DOMAIN` | Runtime injected | Used to construct callback URLs |

---

## 18. File Manager — Compliance Guards

The File Manager at `/api/fm/*` has two hard-coded guard layers that cannot be bypassed:

**§3 GDPR Guard:** Rejects any edit that reduces GDPR/data-subject protection terms. Checked by Claude before save. Returns HTTP 409 if triggered.

**§4 Audit Guard:** Rejects any edit that removes NIST, SOC 2, or ISO 27001 controls without an explicit "accountable owner" override. Returns HTTP 409 if triggered.

Both guards write a `witness_entry` when triggered, regardless of whether the edit was allowed.

---

## 19. HITL Demo — Sample Scenarios

The standalone HITL demo (`screen = "hitl-demo"`, accessible from home page) ships with 9 pre-built citizenM scenarios covering every major decision type. No database or Apaleo connection required.

| # | Agent | Property | Type | Risk | Exposure |
|---|---|---|---|---|---|
| 1 | Rate Agent | London Bankside | Approval | Med | €56 |
| 2 | Check-in Agent | Amsterdam City | Approval | Low | — |
| 3 | Revenue Optimizer | Paris La Défense | Op. Exception | High | €1,400 |
| 4 | Checkout Agent | London Tower | Op. Exception | High | €135 |
| 5 | Reservation Bot | Munich Airport | Approval | Med | €65 |
| 6 | Fraud Detection | New York Times Sq | Compliance Flag | High | $3,840 |
| 7 | Rate Agent | Amsterdam Schiphol | Approval | High | €1,255 |
| 8 | Housekeeping Agent | Rotterdam | Op. Exception | Low | — |
| 9 | Witness Agent | London Shoreditch | Compliance Flag | Med | — |

Each card includes: proposed action, full agent reasoning chain, policy clause triggered, financial exposure, AI confidence %, pre-written approve/deny rationale for ambassadors.

---

## 20. Working With This Codebase (Claude CLI Notes)

### Adding a new agent
1. Add agent slug to `AGENT_IDS` in `artifacts/api-server/src/a2a/agentCardRegistry.ts`
2. Create governance files via File Manager or seed: AGENTS.md, SOP.md, SKILL.md, EXCEPTION_AUTHORITY.md
3. The agent is now callable via `/api/a2a/:companyId/{new-slug}` and will enforce pre-flight

### Adding a new HITL card type
Add to the `cardType` enum in `packages/db/schema.ts` and handle in `artifacts/vda-os/src/demo/HITLDemo.jsx` `CARD_TYPE_LABEL` map.

### Modifying governance rules
Edit the relevant `.AGENTS.md` file via the File Manager UI or direct DB update. The §3/§4 guards will validate the change. All changes are logged to the Witness Stream.

### Running a scenario
`POST /api/agents/:companyId/scenario` with `{ scenario: "full_guest_lifecycle" }` — runs all 8 agents in sequence against live Apaleo data.

### Database migrations
`pnpm --filter @workspace/db run migrate` — runs Drizzle migrations. Run after any schema change.

### API base URLs (development)
- Frontend: `https://${REPLIT_DEV_DOMAIN}/`
- API: `https://${REPLIT_DEV_DOMAIN}/api/`
- A2A: `https://${REPLIT_DEV_DOMAIN}/api/a2a/`

---

*Blueprint version: July 2026 · VDA-MD v5.0 · citizenM / Apaleo*
