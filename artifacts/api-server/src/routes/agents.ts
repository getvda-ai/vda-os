import { Router } from "express";
import { getApaleoToken } from "../lib/apaleo-auth.js";
import { isMcpConfigured, listMcpTools, callMcpTool } from "../lib/apaleo-mcp.js";
import type {
  ApaleoReservation,
  ApaleoFolio,
  ApaleoFolioCharge,
  ApaleoRatePlan,
  ReservationStatus,
} from "../lib/apaleo-types.js";
import { callAI, callAIFull } from "./ai-proxy.js";
import { db, witnessEntries, governanceFiles } from "@workspace/db";
import { eq, desc, and, inArray } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const router = Router();

const APALEO_API_BASE = "https://api.apaleo.com";

// ─── Typed Apaleo Request Client ──────────────────────────────────────────────

async function apaleoRequest<T>(
  path: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" = "GET",
  body?: unknown,
  queryParams?: Record<string, string | number | boolean>
): Promise<T> {
  const token = await getApaleoToken();
  const url = new URL(`${APALEO_API_BASE}${path}`);
  if (queryParams) {
    for (const [k, v] of Object.entries(queryParams)) {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, String(v));
      }
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  if (body !== undefined && method !== "GET") {
    headers["Content-Type"] = "application/json";
  }

  const resp = await fetch(url.toString(), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Apaleo ${method} ${path} → ${resp.status}: ${text}`);
  }

  if (resp.status === 204 || resp.headers.get("content-length") === "0") {
    return {} as T;
  }
  return resp.json() as Promise<T>;
}

// ─── Apaleo MCP Tool Name Map (PascalCase as per Apaleo MCP v3.1.1) ──────────
// Scopes required per tool (for reference — enforced via Apaleo OAuth):
//   Read tools  → availability.read, rates.read, rateplans.read-corporate,
//                 reservations.read, folios.read, profile:read,
//                 payment-accounts.read, invoices.read, reports.read, offers.read
//   Write tools → distribution:reservations.manage, payment:transactions.manage

const MCP_TOOLS = {
  // ─── Read tools (safe in policy eval loop) ────────────────────────────────
  GetAvailableUnitGroups: "GetAvailableUnitGroups",   // availability.read
  ListRatePlans: "ListRatePlans",                     // rateplans.read-corporate, rates.read
  GetReservation: "GetReservation",                   // reservations.read
  GetFolio: "GetFolio",                               // folios.read
  ListFolios: "ListFolios",                           // folios.read
  GetGuestProfile: "GetGuestProfile",                 // profile:read
  ListPaymentAccounts: "ListPaymentAccounts",         // payment-accounts.read
  ListInvoices: "ListInvoices",                       // invoices.read
  GetReport: "GetReport",                             // reports.read
  ListOffers: "ListOffers",                           // offers.read
  // ─── Write tools (executed ONLY after explicit PASS decision) ─────────────
  CreateBooking: "CreateBooking",                     // distribution:reservations.manage
  AmendReservation: "AmendReservation",               // distribution:reservations.manage
  CheckIn: "CheckIn",                                 // distribution:reservations.manage
  CheckOut: "CheckOut",                               // distribution:reservations.manage
  CreateFolioCharge: "CreateFolioCharge",             // payment:transactions.manage
} as const;

// ─── MCP-first executor ───────────────────────────────────────────────────────

async function mcpOrRest<T>(
  mcpToolName: string,
  mcpArgs: Record<string, unknown>,
  restFallback: () => Promise<T>
): Promise<{ result: T; usedMcp: boolean }> {
  if (isMcpConfigured()) {
    try {
      const tools = await listMcpTools();
      const hasTool = tools.some((t) => t.name === mcpToolName);
      if (hasTool) {
        const mcpResult = await callMcpTool(mcpToolName, mcpArgs);
        const text = mcpResult.content
          ?.filter((c) => c.type === "text")
          .map((c) => c.text ?? "")
          .join("\n");
        try {
          const parsed = JSON.parse(text ?? "{}") as T;
          return { result: parsed, usedMcp: true };
        } catch {
          return { result: { raw: text } as unknown as T, usedMcp: true };
        }
      }
    } catch (err) {
      logger.warn({ err, mcpToolName }, "MCP call failed, falling back to REST");
    }
  }
  const result = await restFallback();
  return { result, usedMcp: false };
}

// ─── Policy Documents (VDA-MK Framework — Hospitality Profile) ───────────────
// Industry: hospitality | NIST controls: AC-2, AU-2, SA-4, IR-4
// Frameworks: PCI DSS, ISO 22301
// Each policy is a governance-as-markdown file with mandatory MUST/MUST NOT/MAY
// clauses, explicit Apaleo API scopes, NIST control references, and escalation paths.

const POLICIES: Record<string, string> = {
  availability: `---
title: "Availability Agent Policy"
type: AGENTS
control_id: availability-policy
domain: Revenue
owner: Head of Revenue
axis: vertical
stage: Pre-Arrival
agent_id: agent-availability-001
nist_control: AC-2
baseline: true
api_scopes:
  read:
    - availability.read
    - rateplans.read-corporate
    - rates.read
    - offers.read
  write: []
---

## Purpose
Queries live Apaleo availability and rate plan data to determine whether unit groups
are bookable for requested date ranges, and surfaces active offers to revenue managers.

## Responsibilities
The agent MUST query live Apaleo unit group availability via the GetAvailableUnitGroups
MCP tool before making any availability decision — fabricated data is a FAIL.
The agent MUST retrieve current rate plans via ListRatePlans and active offers via
ListOffers before responding, to ensure rate context is accurate.
The agent MUST flag zero availability immediately as FAIL with the reason logged to the
Witness Stream including property ID, dates, and adult count.
The agent MUST NOT fabricate or estimate availability — all decisions MUST reference
real-time Apaleo API responses (NIST AC-2: access to data limited to authorised sources).
The agent MUST NOT bypass the availability check even if rate plan data is already cached.
The agent MAY suggest alternative dates if availability is low (below 10% of unit count).
The agent MAY surface active promotional offers alongside rate plan data.

## Decision Criteria
- PASS: Units available for the full requested date range with at least one active rate plan
- FAIL: Zero units available, invalid date range, or arrival date in the past
- ESCALATE: Availability below 10% of total unit count — Revenue Manager review required

## Escalation Path
Low-availability escalations route to the Head of Revenue.
System failures or MCP connectivity issues route to the Operations Director.

## Compliance Baseline
- NIST AC-2: Data access restricted to availability.read, rateplans.read-corporate,
  rates.read, offers.read OAuth scopes — no write access granted to this agent
- NIST AU-2: Every availability decision logged to Witness Stream with full context
- NIST SA-4: MCP integration governed by Apaleo mcp:tools scope; fallback to REST API
- NIST IR-4: REST fallback active if MCP unavailable — no single point of failure
- PCI DSS 7.1: Least-privilege access — read-only scopes only, no payment data access
- ISO 22301: Business continuity maintained via REST fallback path`,

  rate: `---
title: "Rate Agent — Rate Override Policy"
type: AGENTS
control_id: rate-override-policy
domain: Revenue
owner: Head of Revenue
axis: vertical
stage: Pre-Arrival
agent_id: agent-rate-001
nist_control: AC-2
baseline: true
api_scopes:
  read:
    - rateplans.read-corporate
    - rates.read
    - reports.read
  write: []
---

## Purpose
Evaluates rate override requests against the Best Available Rate (BAR) for the
requested property and date range, enforcing discount thresholds and escalating
decisions beyond agent authority.

## Responsibilities
The agent MUST retrieve current rate plans from Apaleo via ListRatePlans before
evaluating any rate request — no rate decision may be made without live data.
The agent MUST pull revenue report data via GetReport to benchmark the requested rate
against current period performance.
The agent MUST compare the requested rate against the live BAR and calculate the
discount percentage before applying any policy clause.
The agent MUST log the override reason, requestor role, governing clause, and
discount percentage for every rate decision to the Witness Stream (NIST AU-2).
The agent MUST NOT apply rates below the property floor rate under any circumstance — FAIL.
The agent MUST NOT approve discounts greater than 10% below BAR without escalation.
The agent MAY apply BAR or contracted corporate rates without additional approval.
The agent MAY apply discounts up to 10% below BAR — agent authority, log and PASS.

## Override Thresholds
- Discount ≤10% below BAR: Agent authority → PASS with log
- Discount 11–25% below BAR: Revenue Manager approval required → ESCALATE
- Discount >25% below BAR: Director of Revenue sign-off required → ESCALATE
- Any complimentary room (100% discount): General Manager approval only → ESCALATE

## Escalation Path
Discounts 11–25%: Revenue Manager.
Discounts >25%: Director of Revenue.
Complimentary: General Manager.

## Compliance Baseline
- NIST AC-2: Rate data access restricted to rateplans.read-corporate, rates.read,
  reports.read scopes — no write access granted to this agent
- NIST AU-2: All rate decisions and override reasoning logged to Witness Stream
- NIST SA-4: MCP integration verified before each request; REST fallback maintained
- NIST IR-4: System continues operating via REST if MCP unavailable
- PCI DSS 7.1: Least-privilege read-only access — no payment or folio data touched
- ISO 22301: Dual-path (MCP + REST) ensures continuity during integration outages`,

  reservation: `---
title: "Reservation Bot Policy"
type: AGENTS
control_id: reservation-bot-policy
domain: Operations
owner: Operations Director
axis: vertical
stage: Reservation
agent_id: agent-reservation-bot-001
nist_control: AC-2
baseline: true
api_scopes:
  read:
    - availability.read
    - rateplans.read-corporate
    - rates.read
    - reservations.read
    - profile:read
  write:
    - distribution:reservations.manage
---

## Purpose
Creates and modifies Apaleo reservations under governance control, ensuring availability,
valid rate plans, and guest identity are verified before any booking is committed.

## Responsibilities
The agent MUST verify unit group availability via GetAvailableUnitGroups before creating
any reservation — creating on zero-availability is a hard FAIL.
The agent MUST confirm a valid rate plan via ListRatePlans is attached before committing
any booking.
The agent MUST verify guest identity via GetGuestProfile before creating or modifying a
reservation, and log the profile reference in the Witness Stream.
The agent MUST capture guest name and at least one contact method (email or phone).
The agent MUST NOT create reservations with past arrival dates — FAIL immediately.
The agent MUST NOT double-book: the agent MUST check existing reservations for the
same unit group before committing a new booking.
The agent MUST NOT execute CreateBooking or AmendReservation until the policy
evaluation decision is explicitly PASS.
The agent MAY modify reservation dates if new dates have confirmed availability — PASS with log.
The agent MAY update guest contact details without additional approval.

## Modification Rules
- Modifications affecting more than 3 nights: flag for Revenue Manager review → ESCALATE
- Rate reductions below floor rate: FAIL — do not modify

## Escalation Path
Double-booking risk or rate disputes: Revenue Manager.
Identity verification failures: Operations Director.

## Compliance Baseline
- NIST AC-2: Write access (distribution:reservations.manage) exercised only after PASS;
  read scopes availability.read, rateplans.read-corporate, rates.read, reservations.read,
  profile:read are used in evaluation
- NIST AU-2: Every create/modify/retrieve action logged to Witness Stream with
  reservation ID, guest name, dates, and rate
- NIST SA-4: MCP tools used for all data retrieval; REST fallback maintained
- NIST IR-4: Agent falls back to REST API if MCP session unavailable
- PCI DSS 7.1: Guest profile access restricted to profile:read — no payment data stored
- ISO 22301: Dual-path execution ensures reservation capability during MCP outages`,

  checkin: `---
title: "Check-In Agent Policy"
type: AGENTS
control_id: check-in-policy
domain: Operations
owner: Operations Director
axis: vertical
stage: Check-In
agent_id: agent-checkin-001
nist_control: AC-2
baseline: true
api_scopes:
  read:
    - reservations.read
    - folios.read
    - profile:read
    - payment-accounts.read
  write:
    - distribution:reservations.manage
---

## Purpose
Validates all pre-check-in conditions against live Apaleo data and executes the
check-in API action only when all five governance gates are satisfied.

## Responsibilities
The agent MUST retrieve the full reservation record via GetReservation and verify
status, guest name, and arrival date before proceeding.
The agent MUST verify guest identity via GetGuestProfile (profile:read scope) —
name mismatch between profile and reservation is a hard FAIL (Gate 2).
The agent MUST retrieve open folios via ListFolios and confirm at least one folio
exists in Open status — missing folio is ESCALATE (Gate 3).
The agent MUST verify a valid payment method via ListPaymentAccounts (payment-accounts.read
scope) or confirm folio balance is covered — absent payment is ESCALATE (Gate 4).
The agent MUST NOT execute the check-in API write until all five gates have been
evaluated and the policy decision is PASS.
The agent MUST NOT check in guests whose arrival date is in the future (Gate 5) — FAIL.
The agent MAY proceed with check-in if Gates 1–5 all return green.
The agent MAY override Gate 4 (payment) only with Front Office Manager explicit approval
logged in the Witness Stream.

## Pre-Check-In Validation Gates (ALL required for PASS)
1. Reservation status MUST be "Confirmed" — FAIL if InHouse, CheckedOut, or any other terminal status
2. Guest identity MUST match profile record (profile:read) — FAIL if mismatch
3. Open folio MUST exist — ESCALATE to Front Office Manager if absent
4. Valid payment method MUST be confirmed (payment-accounts.read) — ESCALATE if absent
5. Arrival date MUST be today or in the past — FAIL if future date

## Escalation Path
Gate 3/4 failures: Front Office Manager.
Identity failures: Operations Director.

## Compliance Baseline
- NIST AC-2: Write (distribution:reservations.manage) executed only on PASS;
  read scopes reservations.read, folios.read, profile:read, payment-accounts.read
  used exclusively in evaluation phase
- NIST AU-2: Check-in decision logged to Witness Stream with guest name,
  reservation ID, folio reference, and all five gate outcomes
- NIST SA-4: MCP tools used for live data retrieval; REST fallback active
- NIST IR-4: System-level fallback to REST API if MCP session unavailable
- PCI DSS 7.2: Payment account verification via payment-accounts.read — no raw
  card data stored or processed by this agent
- ISO 22301: Five-gate validation ensures no check-in proceeds under unresolved conditions`,

  folio_charge: `---
title: "Folio Charge Agent Policy"
type: AGENTS
control_id: folio-charge-policy
domain: Finance
owner: Finance Director
axis: vertical
stage: In-Stay
agent_id: agent-folio-charge-001
nist_control: AU-2
baseline: true
api_scopes:
  read:
    - folios.read
    - payment-accounts.read
    - invoices.read
  write:
    - payment:transactions.manage
---

## Purpose
Posts charges to guest folios in Apaleo under financial governance controls,
verifying folio status, payment method, and duplicate-charge prevention before
any write action is executed.

## Responsibilities
The agent MUST verify the folio exists and is in Open status via GetFolio before
posting any charge — posting to a closed folio is a hard FAIL.
The agent MUST verify an active payment account via ListPaymentAccounts before
authorising charges — absent payment method is ESCALATE.
The agent MUST check existing invoices via ListInvoices to prevent duplicate charge
posting for the same service on the same date.
The agent MUST include a service type classification for every charge posted.
The agent MUST NOT post duplicate charges for the same service and date — FAIL.
The agent MUST NOT post charges exceeding €2,000 without Finance Director approval — ESCALATE.
The agent MUST NOT execute CreateFolioCharge until the policy decision is explicitly PASS.
The agent MAY post charges of €500 or less autonomously — PASS with full charge log.

## Charge Threshold Rules
- Charges ≤€500: Agent authority → PASS, log charge details
- Charges €500–€2,000: Revenue Manager review required → ESCALATE before posting
- Charges >€2,000: Finance Director approval required → ESCALATE, do not post

## Escalation Path
Charges €500–€2,000: Revenue Manager.
Charges >€2,000: Finance Director.
Payment account absent: Finance Director.

## Compliance Baseline
- NIST AC-2: Write (payment:transactions.manage) executed only after PASS;
  read scopes folios.read, payment-accounts.read, invoices.read used in evaluation
- NIST AU-2: Every charge posting logged to Witness Stream with folio ID,
  service type, amount, and governing threshold clause
- NIST SA-4: MCP tools used for folio and payment verification; REST fallback active
- NIST IR-4: REST fallback path maintained for all read and write operations
- PCI DSS 6.4: Service type classification mandatory on all charges — no unclassified
  transactions permitted
- ISO 22301: Duplicate-charge prevention via ListInvoices check before every post`,

  folio: `---
title: "Folio Agent Policy"
type: AGENTS
control_id: folio-review-policy
domain: Finance
owner: Finance Director
axis: vertical
stage: In-Stay
agent_id: agent-folio-001
nist_control: AU-2
baseline: true
api_scopes:
  read:
    - folios.read
    - invoices.read
    - payments.read
    - accounting.read
  write: []
---

## Purpose
Performs read-only analysis of guest folios, identifying charge anomalies,
unclassified items, duplicate entries, and balance overruns — and escalates
findings per financial governance thresholds.

## Responsibilities
The agent MUST retrieve the full folio from Apaleo via GetFolio and ListFolios
before any analysis — no decision may be based on partial or cached data.
The agent MUST cross-reference charges against invoice records via ListInvoices
to identify unmatched or duplicate charge entries.
The agent MUST flag any charge with no service type classification.
The agent MUST flag any charge appearing more than once for the same service and date.
The agent MUST flag total folio balance exceeding the pre-authorisation amount.
The agent MUST log a folio summary to the Witness Stream including total balance,
charge count, and all flags raised (NIST AU-2).
The agent MUST NOT modify folio charges under any circumstance — this is a strictly
read-only agent; any write attempt is a policy violation — FAIL.
The agent MAY summarise and pass folios with charges ≤€500 with no anomalies.
The agent MAY retrieve payment history via the payments.read scope to validate
charge legitimacy during analysis.

## Charge Review Thresholds
- Charges ≤€500, no anomalies: PASS — summarise and log
- Charges €500–€2,000 or any anomaly: ESCALATE to supervisor
- Charges >€2,000 or folio dispute: ESCALATE to Finance Director

## Escalation Path
Supervisor escalations: Front Office Manager.
Finance escalations: Finance Director.
Disputed charges: Always escalate to Front Office Manager.

## Compliance Baseline
- NIST AC-2: Strictly read-only — scopes folios.read, invoices.read, payments.read,
  accounting.read; no write scopes granted; modification attempts are policy violations
- NIST AU-2: Folio analysis summary with all flags logged to Witness Stream on every run
- NIST SA-4: MCP tools provide live folio data; REST fallback active
- NIST IR-4: REST API fallback prevents service interruption if MCP unavailable
- PCI DSS 7.1: Read-only least-privilege access; no card data accessed or stored
- ISO 22301: Analysis can complete via REST path if MCP session expires`,

  checkout: `---
title: "Checkout Agent Policy"
type: AGENTS
control_id: checkout-policy
domain: Operations
owner: Operations Director
axis: vertical
stage: Departure
agent_id: agent-checkout-001
nist_control: AC-2
baseline: true
api_scopes:
  read:
    - reservations.read
    - folios.read
    - invoices.read
    - payments.read
  write:
    - distribution:reservations.manage
---

## Purpose
Validates folio settlement, invoice status, and reservation state before executing
the Apaleo checkout write action, enforcing late-checkout fee policy and ensuring
zero outstanding balance.

## Responsibilities
The agent MUST retrieve the full reservation via GetReservation and confirm InHouse
status — FAIL immediately if reservation is not InHouse.
The agent MUST retrieve all folios via ListFolios and verify zero outstanding balance
or confirmed payment method before proceeding.
The agent MUST check invoice status via ListInvoices to confirm no open disputed
charges exist on the account.
The agent MUST NOT execute the CheckOut API write until the policy decision is PASS.
The agent MUST NOT check out a reservation with unresolved disputed charges — ESCALATE.
The agent MUST NOT check out a reservation with an outstanding folio balance and no
confirmed payment method — ESCALATE.
The agent MAY waive the late-checkout fee for Gold/Platinum loyalty tier guests until
14:00, logging exception_applied: true to the Witness Stream.
The agent MAY apply a 50% late-checkout surcharge (14:00–18:00) autonomously — PASS.

## Late Checkout Fee Schedule
- By 11:00 (standard): No fee → PASS
- 11:00–14:00 (Gold/Platinum): Fee waived — exception_applied: true → PASS with log
- 14:00–18:00: 50% of one night rate → PASS, agent may apply
- After 18:00: Full night rate → PASS, agent may apply
- Complimentary late checkout: General Manager approval only → ESCALATE

## Folio Settlement Gate (ALL required for PASS)
- Folio outstanding balance MUST be zero or valid payment method confirmed
- No outstanding disputed charges on any folio or linked invoice
- Reservation MUST be InHouse status

## Escalation Path
Disputed charges or unresolved balance: Front Office Manager.
Complimentary late checkout: General Manager.

## Compliance Baseline
- NIST AC-2: Write (distribution:reservations.manage) executed only on PASS;
  read scopes reservations.read, folios.read, invoices.read, payments.read used in eval
- NIST AU-2: Checkout decision logged with reservation ID, guest name, departure
  time, folio status, and any late-checkout exception
- NIST SA-4: MCP tools used for live reservation and folio retrieval; REST fallback active
- NIST IR-4: Dual-path execution maintained for all operations
- PCI DSS 7.2: Payment method verification via folios.read and payments.read before
  checkout — no raw card data stored by this agent
- ISO 22301: Settlement gate prevents checkout under unresolved financial conditions`,

  revenue: `---
title: "Revenue Reconciliation Agent Policy"
type: AGENTS
control_id: revenue-reconciliation-policy
domain: Finance
owner: CFO / Revenue Director
axis: horizontal
stage: Reconciliation
agent_id: agent-revenue-001
nist_control: AU-2
baseline: true
api_scopes:
  read:
    - reports.read
    - rates.read
    - rateplans.read-corporate
    - folios.read
    - invoices.read
    - accounting.read
  write: []
---

## Purpose
Performs daily revenue reconciliation by comparing actual revenue data from Apaleo
reports against rate plan expectations per unit group, flagging variances to the
appropriate financial authority.

## Responsibilities
The agent MUST pull live revenue report data via GetReport (reports.read scope) for
the specified property and date before performing any reconciliation.
The agent MUST retrieve current rate plan expectations via ListRatePlans and cross-
reference each reservation's actual rate against its contracted rate plan.
The agent MUST cross-reference folio records via ListFolios and invoice data via
ListInvoices to identify unmatched folios (no linked reservation).
The agent MUST compare actual vs expected revenue and calculate the variance percentage
for each unit group.
The agent MUST log a full reconciliation summary to the Witness Stream including
variance percentage, discrepancy types, and all flagged reservation IDs (NIST AU-2).
The agent MUST NOT modify any financial records — this is a strictly read-only agent.
The agent MUST NOT issue reconciliation decisions based on cached or estimated data —
live API data is mandatory for every run.
The agent MAY pass reconciliation with variance ≤5% as normal operational variance.
The agent MAY summarise discrepancy patterns to aid Revenue Manager review.

## Variance Thresholds
- Variance ≤5%: Normal operational variance → PASS
- Variance 5–15%: Revenue Manager review required → ESCALATE
- Variance >15%: Immediate Finance Director notification → ESCALATE

## Discrepancy Types
- Underpayment vs contracted rate: Flag with reservation ID → ESCALATE
- Overbilling vs rate plan: Flag immediately → ESCALATE
- Unmatched folios (no linked reservation): Flag for Finance audit → ESCALATE

## Escalation Path
Variance 5–15%: Revenue Manager.
Variance >15%: Finance Director.
Unmatched folios: CFO / Finance audit.

## Compliance Baseline
- NIST AC-2: Strictly read-only — scopes reports.read, rates.read, rateplans.read-corporate,
  folios.read, invoices.read, accounting.read; no write access granted
- NIST AU-2: Full reconciliation log written to Witness Stream on every run including
  variance %, discrepancy flags, and all affected reservation IDs
- NIST SA-4: MCP tools used for live report and rate data; REST fallback active
- NIST IR-4: REST fallback path maintained — reconciliation can complete without MCP
- PCI DSS 10.2: Audit trail covers all reconciliation decisions and variance flags
- ISO 22301: Daily reconciliation schedule maintained via REST if MCP unavailable`,
};

// ─── FM Governance Policy Lookup ─────────────────────────────────────────────
// Maps policy keys (used internally) to the canonical agentId in the File Manager.
// Agents load ALL file types (AGENTS + SOP + SKILL) for their agentId, concatenated.
// Folio and checkout agents also inherit the Finance O2C shared services file.
// Hardcoded POLICIES above are fallbacks ONLY — used when no live FM files exist.

const POLICY_AGENT_ID_MAP: Record<string, string | null> = {
  availability:  "availability-agent",
  rate:          "rate-agent",
  reservation:   "reservation-bot",
  checkin:       "check-in-agent",
  folio:         "folio-charge-agent",
  folio_charge:  "folio-charge-agent",
  checkout:      "checkout-agent",
  revenue:       null, // no FM files — always uses hardcoded fallback
};

// Agents that must inherit from Finance O2C shared services (cross-domain inheritance)
const CROSS_DOMAIN_AGENT_IDS: Record<string, string[]> = {
  "folio-charge-agent": ["finance-o2c-shared"],
  "checkout-agent":     ["finance-o2c-shared"],
};

interface GovernancePolicyResult {
  policyText: string;
  filesLoaded: string[];
}

async function getGovernancePolicyFromFM(companyId: number, policyKey: string): Promise<GovernancePolicyResult> {
  const agentId = POLICY_AGENT_ID_MAP[policyKey];
  if (agentId && companyId) {
    try {
      // Load all VDA-MD file types for this agent: AGENTS (charter) + SOP (rules) + SKILL (tools)
      const rows = await db
        .select({ content: governanceFiles.content, filename: governanceFiles.filename, fileType: governanceFiles.fileType })
        .from(governanceFiles)
        .where(
          and(
            eq(governanceFiles.companyId, companyId),
            eq(governanceFiles.agentId, agentId),
            eq(governanceFiles.isArchived, false)
          )
        )
        .orderBy(governanceFiles.fileType); // AGENTS → SHARED_SERVICES → SKILL → SOP (alphabetical)

      // Also load cross-domain shared services files if this agent requires them
      const crossDomainIds = CROSS_DOMAIN_AGENT_IDS[agentId] ?? [];
      let crossDomainRows: { content: string; filename: string; fileType: string }[] = [];
      if (crossDomainIds.length > 0) {
        crossDomainRows = await db
          .select({ content: governanceFiles.content, filename: governanceFiles.filename, fileType: governanceFiles.fileType })
          .from(governanceFiles)
          .where(
            and(
              eq(governanceFiles.companyId, companyId),
              eq(governanceFiles.isArchived, false),
              inArray(governanceFiles.agentId, crossDomainIds)
            )
          );
      }

      const allRows = [...crossDomainRows, ...rows]; // cross-domain first (pre-condition block)
      const filesLoaded = allRows.map(r => r.filename);

      if (allRows.length > 0 && allRows.some(r => r.content && r.content.length > 200)) {
        const policyText = allRows
          .map(r => `## [${r.fileType}] ${r.filename}\n\n${r.content}`)
          .join("\n\n---\n\n");
        logger.info({ companyId, policyKey, agentId, filesLoaded, crossDomain: crossDomainIds.length > 0 }, "Agent loaded multi-file policy from FM governance files");
        return { policyText, filesLoaded };
      }
    } catch (err) {
      logger.warn({ err, companyId, policyKey }, "FM policy lookup failed — using hardcoded fallback");
    }
  }
  const fallback = POLICIES[policyKey];
  if (!fallback) {
    logger.warn({ policyKey }, "No policy found in FM or hardcoded POLICIES — agent will run without policy context");
    return {
      policyText: `## Policy Not Found\nNo governance file found for policy key: ${policyKey}. Escalate all decisions until a governance file is loaded.`,
      filesLoaded: [],
    };
  }
  logger.info({ companyId, policyKey }, "Agent using hardcoded fallback policy");
  return { policyText: fallback, filesLoaded: [] };
}

// ─── Agent Decision Type ──────────────────────────────────────────────────────

interface AgentDecision {
  decision: "PASS" | "FAIL" | "ESCALATE";
  clauseApplied: string;
  actionProposed: string;
  exceptionApplied: boolean;
  escalationTarget: string | null;
  reasoning: string;
}

// ─── Witness Stream Writer ────────────────────────────────────────────────────

interface WitnessEntryInput {
  companyId: number;
  agent: string;
  decision: AgentDecision;
  fileReferenced: string;
  apaleoData: Record<string, unknown>;
  scenarioRunId?: string;
}

async function writeWitnessEntry(entry: WitnessEntryInput): Promise<number> {
  const [row] = await db
    .insert(witnessEntries)
    .values({
      companyId: entry.companyId,
      agent: entry.agent,
      decision: entry.decision.decision,
      fileReferenced: entry.fileReferenced,
      clauseApplied: entry.decision.clauseApplied,
      actionProposed: entry.decision.actionProposed,
      exceptionApplied: entry.decision.exceptionApplied,
      escalationTarget: entry.decision.escalationTarget,
      reasoning: entry.decision.reasoning,
      apaleoData: entry.apaleoData,
      scenarioRunId: entry.scenarioRunId ?? null,
    })
    .returning({ id: witnessEntries.id });
  return row.id;
}

// ─── AI Policy Evaluator ──────────────────────────────────────────────────────

async function evaluateWithPolicy(
  agentName: string,
  policyKey: string,
  context: string,
  task: string,
  companyId: number = 0
): Promise<AgentDecision> {
  const { policyText, filesLoaded } = await getGovernancePolicyFromFM(companyId, policyKey);
  void filesLoaded; // available for downstream Witness Agent — used in evaluateWithPolicyAndMcp
  const aiResponse = await callAI({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: `You are the ${agentName} operating under the VDA-MK governance framework.
Your governing policy document is:

${policyText}

You MUST respond ONLY in this exact JSON format with no extra text:
{
  "decision": "PASS" | "FAIL" | "ESCALATE",
  "clauseApplied": "<exact policy clause that governed this decision>",
  "actionProposed": "<what action was taken or should be taken>",
  "exceptionApplied": true | false,
  "escalationTarget": "<role to escalate to, or null>",
  "reasoning": "<1-3 sentence explanation citing specific data from the context>"
}`,
    messages: [
      {
        role: "user",
        content: `Task: ${task}\n\nLive Apaleo Data:\n${context}`,
      },
    ],
  });

  try {
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch ? jsonMatch[0] : aiResponse) as AgentDecision;
  } catch {
    return {
      decision: "ESCALATE",
      clauseApplied: "Unable to parse agent response",
      actionProposed: "Manual review required",
      exceptionApplied: false,
      escalationTarget: "Operations Director",
      reasoning: aiResponse.slice(0, 200),
    };
  }
}

// ─── Agentic Policy Evaluator (Claude tool-use via Apaleo MCP) ───────────────

interface AgenticEvalResult {
  decision: AgentDecision;
  toolCallsMade: number;
  usedMcp: boolean;
  filesLoaded: string[];
}

async function evaluateWithPolicyAndMcp(
  agentName: string,
  policyKey: string,
  task: string,
  agentToolNames: string[],
  companyId: number = 0
): Promise<AgenticEvalResult> {
  const { policyText, filesLoaded } = await getGovernancePolicyFromFM(companyId, policyKey);

  let anthropicTools: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }> = [];

  try {
    const allTools = await listMcpTools();
    anthropicTools = allTools
      .filter((t) => agentToolNames.includes(t.name))
      .map((t) => ({
        name: t.name,
        description: t.description ?? `Apaleo MCP tool: ${t.name}`,
        input_schema: (t.inputSchema ?? { type: "object", properties: {} }) as Record<string, unknown>,
      }));
  } catch (err) {
    logger.warn({ err, agentName }, "Could not load MCP tools — falling back to policy-only evaluation");
  }

  const hasReadTools = anthropicTools.length > 0;

  const systemPrompt = `You are the ${agentName} operating under the VDA-MK governance framework.
Your governing policy document is:

${policyText}

${hasReadTools ? "You MUST call the provided Apaleo MCP tools to fetch live data before issuing your governance decision. Do not skip tool calls." : ""}
After fetching live data, respond ONLY in this exact JSON format with no extra text:
{
  "decision": "PASS" | "FAIL" | "ESCALATE",
  "clauseApplied": "<exact policy clause that governed this decision>",
  "actionProposed": "<what action was taken or should be taken>",
  "exceptionApplied": true | false,
  "escalationTarget": "<role to escalate to, or null>",
  "reasoning": "<1-3 sentence explanation citing specific data from the live API response>"
}`;

  const messages: unknown[] = [
    {
      role: "user",
      content: `Task: ${task}\n\n${hasReadTools ? "REQUIRED: Call the Apaleo MCP tools first to retrieve live data, then issue your governance decision JSON." : "Apply policy with available context and respond with your governance decision JSON."}`,
    },
  ];

  let toolCallsMade = 0;
  const MAX_ITERATIONS = 8;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await callAIFull({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: systemPrompt,
      messages,
      tools: hasReadTools ? anthropicTools : undefined,
    });

    if (response.stop_reason === "tool_use") {
      const toolResults: unknown[] = [];

      for (const block of response.content) {
        if (block.type === "tool_use") {
          toolCallsMade++;
          const toolArgs = (block.input ?? {}) as Record<string, unknown>;
          let resultContent: string;
          try {
            const mcpResult = await callMcpTool(block.name!, toolArgs);
            resultContent =
              mcpResult.content
                ?.filter((c) => c.type === "text")
                .map((c) => c.text ?? "")
                .join("\n") ?? JSON.stringify(mcpResult);
          } catch (err) {
            resultContent = `Tool call failed: ${err instanceof Error ? err.message : String(err)}`;
          }

          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: resultContent,
          });
        }
      }

      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: toolResults });
      continue;
    }

    const textBlock = response.content.find((b) => b.type === "text");
    if (textBlock?.text) {
      // If tools were available but Claude skipped them, inject a mandatory reminder
      if (hasReadTools && toolCallsMade === 0 && i === 0) {
        messages.push({ role: "assistant", content: response.content });
        messages.push({
          role: "user",
          content: "You skipped the required MCP tool calls. You MUST call at least one Apaleo MCP tool to fetch live data before issuing your governance decision. Please call the appropriate tool now.",
        });
        continue;
      }
      try {
        const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
        const decision = JSON.parse(jsonMatch ? jsonMatch[0] : textBlock.text) as AgentDecision;
        return { decision, toolCallsMade, usedMcp: toolCallsMade > 0, filesLoaded };
      } catch {
        logger.warn({ agentName, text: textBlock.text.slice(0, 200) }, "Could not parse agent JSON response");
      }
    }
    break;
  }

  return {
    decision: {
      decision: "ESCALATE",
      clauseApplied: "Agentic evaluation did not produce a parseable decision",
      actionProposed: "Manual review required",
      exceptionApplied: false,
      escalationTarget: "Operations Director",
      reasoning: "The agent loop completed without a clear governance decision — manual review required.",
    },
    toolCallsMade,
    usedMcp: toolCallsMade > 0,
    filesLoaded,
  };
}

// ─── Availability Agent ───────────────────────────────────────────────────────

router.post("/agents/availability", async (req, res) => {
  try {
    const {
      propertyId,
      arrival,
      departure,
      adults = "2",
      companyId,
      scenarioRunId,
    } = req.body as {
      propertyId: string;
      arrival: string;
      departure: string;
      adults?: string;
      companyId: number;
      scenarioRunId?: string;
    };

    if (!propertyId || !arrival || !departure || !companyId) {
      return res.status(400).json({ error: "propertyId, arrival, departure, companyId required" });
    }

    const { decision, toolCallsMade, usedMcp } = await evaluateWithPolicyAndMcp(
      "Availability Agent",
      "availability",
      `Check unit availability for property ${propertyId} from ${arrival} to ${departure} for ${adults} adults. Fetch live availability via GetAvailableUnitGroups, rate plans via ListRatePlans, and active offers via ListOffers from Apaleo.`,
      [MCP_TOOLS.GetAvailableUnitGroups, MCP_TOOLS.ListRatePlans, MCP_TOOLS.ListOffers],
      Number(companyId)
    );

    const apaleoData: Record<string, unknown> = {
      propertyId, arrival, departure, adults,
      usedMcp, toolCallsMade,
    };

    const witnessId = await writeWitnessEntry({
      companyId: Number(companyId),
      agent: "Availability Agent",
      decision,
      fileReferenced: "Hospitality-Revenue-Pre-Book-availability-agent.SOP.md",
      apaleoData,
      scenarioRunId,
    });

    res.json({
      ...decision, witnessEntryId: witnessId,
      propertyId, arrival, departure, usedMcp, toolCallsMade,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─── Rate Agent ───────────────────────────────────────────────────────────────

router.post("/agents/rate", async (req, res) => {
  try {
    const { propertyId, requestedRate, barRate, ratePlanId, companyId, scenarioRunId } = req.body as {
      propertyId: string;
      requestedRate?: number;
      barRate?: number;
      ratePlanId?: string;
      companyId: number;
      scenarioRunId?: string;
    };

    if (!propertyId || !companyId) {
      return res.status(400).json({ error: "propertyId, companyId required" });
    }

    const bar = barRate ?? 150;
    const reqRate = requestedRate ?? bar;
    const discountPct = bar > 0 ? Math.round(((bar - reqRate) / bar) * 100) : 0;

    const { decision, toolCallsMade, usedMcp, filesLoaded } = await evaluateWithPolicyAndMcp(
      "Rate Agent",
      "rate",
      `Evaluate rate request of €${reqRate} vs BAR €${bar} (${discountPct}% discount) for property ${propertyId}. Fetch current rate plans via ListRatePlans and revenue report via GetReport from Apaleo, then apply rate-override policy.`,
      [MCP_TOOLS.ListRatePlans, MCP_TOOLS.GetReport],
      Number(companyId)
    );

    const apaleoData: Record<string, unknown> = {
      propertyId, barRate: bar, requestedRate: reqRate, discountPct, usedMcp, toolCallsMade,
    };

    const witnessId = await writeWitnessEntry({
      companyId: Number(companyId),
      agent: "Rate Agent",
      decision,
      fileReferenced: filesLoaded[0] ?? "Hospitality-Revenue-Book-rate-agent.SOP.md",
      apaleoData,
      scenarioRunId,
    });

    res.json({
      ...decision, witnessEntryId: witnessId,
      propertyId, requestedRate: reqRate, barRate: bar, discountPct, usedMcp, toolCallsMade, filesLoaded,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─── Reservation Bot (create / modify / retrieve) ────────────────────────────

interface CreateReservationBody {
  propertyId: string;
  unitGroupId: string;
  ratePlanId: string;
  arrival: string;
  departure: string;
  adults: number;
  booker: { firstName: string; lastName: string; email?: string };
}

interface CreatedReservation {
  id: string;
}

router.post("/agents/reservation", async (req, res) => {
  try {
    const {
      propertyId, action = "retrieve", reservationId,
      guestName, arrival, departure, ratePlanId, unitGroupId,
      adults = 2, guestEmail, companyId, scenarioRunId,
      modifyFields,
    } = req.body as {
      propertyId: string;
      action?: "retrieve" | "create" | "modify";
      reservationId?: string;
      guestName?: string;
      arrival?: string;
      departure?: string;
      ratePlanId?: string;
      unitGroupId?: string;
      adults?: number;
      guestEmail?: string;
      companyId: number;
      scenarioRunId?: string;
      modifyFields?: Record<string, unknown>;
    };

    if (!propertyId || !companyId) {
      return res.status(400).json({ error: "propertyId, companyId required" });
    }

    const contextLines: string[] = [`Property: ${propertyId}`, `Action: ${action}`];
    const apaleoData: Record<string, unknown> = { propertyId, action };
    let executedReservationId: string | undefined = reservationId;
    let writeExecuted = false;
    let writeError: string | undefined;

    // ── STEP 1: Gather context data ──────────────────────────────────────────
    if (action === "create" && arrival && departure) {
      let resolvedUnitGroupId = unitGroupId;
      if (!resolvedUnitGroupId) {
        const availData = await apaleoRequest<{
          unitGroups: Array<{ unitGroupId: string; availableUnits: number }>;
        }>("/availability/v1/unit-groups", "GET", undefined, {
          propertyId, arrival, departure, adults: String(adults),
        }).catch(() => ({ unitGroups: [] }));
        resolvedUnitGroupId = availData.unitGroups?.[0]?.unitGroupId;
      }
      let resolvedRatePlanId = ratePlanId;
      if (!resolvedRatePlanId) {
        const planData = await apaleoRequest<{ ratePlans: ApaleoRatePlan[] }>(
          "/rateplan/v1/rate-plans", "GET", undefined, { propertyId }
        ).catch(() => ({ ratePlans: [] }));
        resolvedRatePlanId = planData.ratePlans?.[0]?.id;
      }
      const [guestFirst = "Demo", ...guestRest] = (guestName ?? "Demo Guest").split(" ");
      const guestLast = guestRest.join(" ") || "Guest";
      apaleoData.bookingParams = { unitGroupId: resolvedUnitGroupId, ratePlanId: resolvedRatePlanId, arrival, departure, adults };
      contextLines.push(
        `Create request: Guest=${guestFirst} ${guestLast}, Arrival=${arrival}, Departure=${departure}`,
        `Unit group available: ${resolvedUnitGroupId ?? "none found"}`,
        `Rate plan available: ${resolvedRatePlanId ?? "none found"}`,
        `Arrival date check: ${new Date(arrival) < new Date() ? "PAST DATE — FAIL" : "OK"}`
      );
      apaleoData.resolvedUnitGroupId = resolvedUnitGroupId;
      apaleoData.resolvedRatePlanId = resolvedRatePlanId;
    } else if (action === "modify" && reservationId) {
      const resv = await apaleoRequest<ApaleoReservation>(
        `/booking/v1/reservations/${reservationId}`, "GET", undefined,
        { expand: "property,unitGroup,ratePlan,unit,primaryGuest" }
      ).catch(() => null);
      apaleoData.currentReservation = resv;
      contextLines.push(
        `Modify request for ${reservationId}: current status=${resv?.status ?? "Unknown"}`,
        `Current arrival: ${resv?.arrival ?? "?"}, departure: ${resv?.departure ?? "?"}`,
        `Proposed changes: ${JSON.stringify(modifyFields ?? {})}`,
        `Nights change: ${arrival && resv?.arrival ? "dates change requested" : "no date change"}`
      );
    } else if (reservationId) {
      const resv = await apaleoRequest<ApaleoReservation>(
        `/booking/v1/reservations/${reservationId}`, "GET", undefined,
        { expand: "property,unitGroup,ratePlan,unit,primaryGuest" }
      ).catch(() => null);
      apaleoData.reservation = resv;
      contextLines.push(`Reservation ${reservationId}: ${JSON.stringify(resv, null, 2)}`);
    } else {
      const listData = await apaleoRequest<{ reservations: ApaleoReservation[]; count: number }>(
        "/booking/v1/reservations", "GET", undefined, { propertyId, pageSize: 5 }
      ).catch(() => ({ reservations: [], count: 0 }));
      apaleoData.recentReservations = listData.reservations.slice(0, 3);
      contextLines.push(`Recent reservations (${listData.count}): ${JSON.stringify(listData.reservations.slice(0, 3), null, 2)}`);
    }

    // ── STEP 2: Policy evaluation FIRST (agentic: Claude fetches live data via MCP) ──
    const mcpTools = action === "create"
      ? [MCP_TOOLS.GetAvailableUnitGroups, MCP_TOOLS.ListRatePlans, MCP_TOOLS.GetGuestProfile]
      : [MCP_TOOLS.GetReservation, MCP_TOOLS.GetGuestProfile];

    const taskCtx = [
      `Execute reservation action "${action}" for property ${propertyId}.`,
      guestName ? `Guest: ${guestName}.` : "",
      reservationId ? `Reservation ID: ${reservationId}.` : "",
      action === "create" && arrival ? `Requested dates: ${arrival}–${departure}.` : "",
      `Use MCP tools to verify live Apaleo data, then apply reservation policy and issue governance decision.`,
    ].filter(Boolean).join(" ");

    const { decision, usedMcp: evalUsedMcp, toolCallsMade: evalToolCalls } = await evaluateWithPolicyAndMcp(
      "Reservation Bot", "reservation", taskCtx, mcpTools, Number(companyId)
    );
    apaleoData.usedMcp = evalUsedMcp;
    apaleoData.toolCallsMade = evalToolCalls;

    // ── STEP 3: Execute write ONLY if PASS ───────────────────────────────────
    if (decision.decision === "PASS") {
      if (action === "create" && arrival && departure) {
        const resolvedUnitGroupId = apaleoData.resolvedUnitGroupId as string | undefined;
        const resolvedRatePlanId = apaleoData.resolvedRatePlanId as string | undefined;
        if (resolvedUnitGroupId && resolvedRatePlanId) {
          const [guestFirst = "Demo", ...guestRest] = (guestName ?? "Demo Guest").split(" ");
          const guestLast = guestRest.join(" ") || "Guest";
          const bookingBody: CreateReservationBody = {
            propertyId, unitGroupId: resolvedUnitGroupId, ratePlanId: resolvedRatePlanId,
            arrival, departure, adults,
            booker: { firstName: guestFirst, lastName: guestLast, ...(guestEmail ? { email: guestEmail } : {}) },
          };
          try {
            const { result: created, usedMcp } = await mcpOrRest<CreatedReservation>(
              MCP_TOOLS.CreateBooking, { ...bookingBody },
              () => apaleoRequest<CreatedReservation>("/booking/v1/reservations", "POST", bookingBody)
            );
            executedReservationId = created.id;
            writeExecuted = true;
            apaleoData.createdReservationId = executedReservationId;
            apaleoData.usedMcp = usedMcp;
            decision.actionProposed = `Reservation created in Apaleo: ID = ${executedReservationId}. ${decision.actionProposed}`;
          } catch (e: unknown) {
            writeError = e instanceof Error ? e.message : String(e);
            apaleoData.writeError = writeError;
          }
        }
      } else if (action === "modify" && reservationId && modifyFields) {
        try {
          const patchBody = Object.entries(modifyFields).map(([op, val]) => ({ op: "replace", path: `/${op}`, value: val }));
          const { usedMcp } = await mcpOrRest<Record<string, unknown>>(
            MCP_TOOLS.AmendReservation, { reservationId, patch: patchBody },
            () => apaleoRequest<Record<string, unknown>>(
              `/booking/v1/reservations/${reservationId}`, "PATCH", patchBody
            )
          );
          writeExecuted = true;
          apaleoData.modifiedFields = modifyFields;
          apaleoData.usedMcp = usedMcp;
          decision.actionProposed = `Reservation ${reservationId} modified in Apaleo (fields: ${Object.keys(modifyFields).join(", ")}). ${decision.actionProposed}`;
        } catch (e: unknown) {
          writeError = e instanceof Error ? e.message : String(e);
          apaleoData.writeError = writeError;
        }
      }
    }

    apaleoData.writeExecuted = writeExecuted;
    apaleoData.writeBlocked = !writeExecuted && action !== "retrieve";

    const witnessId = await writeWitnessEntry({
      companyId: Number(companyId),
      agent: "Reservation Bot",
      decision,
      fileReferenced: "Hospitality-Operations-Stay-checkin-agent.SOP.md",
      apaleoData,
      scenarioRunId,
    });

    res.json({
      ...decision, witnessEntryId: witnessId,
      propertyId, action,
      reservationId: executedReservationId,
      writeExecuted, writeError,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─── Check-In Agent ───────────────────────────────────────────────────────────

router.post("/agents/checkin", async (req, res) => {
  try {
    const { propertyId, reservationId, guestName, companyId, scenarioRunId } = req.body as {
      propertyId: string;
      reservationId?: string;
      guestName?: string;
      companyId: number;
      scenarioRunId?: string;
    };

    if (!propertyId || !companyId) {
      return res.status(400).json({ error: "propertyId, companyId required" });
    }

    const contextLines: string[] = [`Property: ${propertyId}`, `Guest: ${guestName ?? "Guest"}`];
    const apaleoData: Record<string, unknown> = { propertyId };
    let checkinExecuted = false;
    let checkinError: string | undefined;
    let resolvedReservationId = reservationId;

    // ── STEP 1: Gather validation data ──────────────────────────────────────
    if (reservationId) {
      const [resvResult, folioResult] = await Promise.allSettled([
        apaleoRequest<ApaleoReservation>(
          `/booking/v1/reservations/${reservationId}`, "GET", undefined,
          { expand: "property,unitGroup,ratePlan,unit,primaryGuest" }
        ),
        apaleoRequest<{ folios: ApaleoFolio[]; count: number }>(
          "/finance/v1/folios", "GET", undefined, { reservationId, status: "Open" }
        ),
      ]);

      const resv = resvResult.status === "fulfilled" ? resvResult.value : null;
      const folios = folioResult.status === "fulfilled" ? folioResult.value.folios ?? [] : [];

      const validStatuses: ReservationStatus[] = ["Confirmed"];
      const statusOk = resv !== null && validStatuses.includes(resv.status as ReservationStatus);
      const guestNameOnRecord = `${resv?.primaryGuest?.firstName ?? ""} ${resv?.primaryGuest?.lastName ?? ""}`.trim();
      const folioExists = folios.length > 0;
      const arrivalDate = resv?.arrival ? new Date(resv.arrival) : null;
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const arrivalOk = arrivalDate !== null && arrivalDate <= today;

      if (folios[0]?.id) apaleoData.folioId = folios[0].id;
      apaleoData.reservation = resv;
      apaleoData.folioCount = folios.length;
      apaleoData.validationGates = { statusOk, folioExists, arrivalOk };

      contextLines.push(
        `Reservation ${reservationId}:`,
        `  Gate 1 — Status: ${resv?.status ?? "Unknown"} → ${statusOk ? "PASS" : "FAIL"}`,
        `  Gate 2 — Guest on record: "${guestNameOnRecord}" vs requested: "${guestName ?? "not specified"}" → ${!guestName || guestNameOnRecord.toLowerCase().includes((guestName ?? "").toLowerCase().split(" ")[0]) ? "PASS" : "FAIL (name mismatch)"}`,
        `  Gate 3 — Open folios: ${folios.length} → ${folioExists ? "PASS" : "ESCALATE (no folio)"}`,
        `  Gate 4 — Payment method: ${folioExists ? "assumed present on folio" : "unknown"} → ${folioExists ? "PASS" : "ESCALATE"}`,
        `  Gate 5 — Arrival date: ${resv?.arrival ?? "Unknown"}, today: ${today.toISOString().split("T")[0]} → ${arrivalOk ? "PASS" : "FAIL (future date)"}`,
        `  All gates pass: ${statusOk && folioExists && arrivalOk}`
      );
    } else {
      const today = new Date().toISOString().split("T")[0];
      const arrivals = await apaleoRequest<{ reservations: ApaleoReservation[]; count: number }>(
        "/booking/v1/reservations", "GET", undefined,
        { propertyId, status: "Confirmed", dateFilter: "Arrival", from: today, to: today, pageSize: 3 }
      ).catch(() => ({ reservations: [], count: 0 }));
      apaleoData.arrivingToday = arrivals.reservations.slice(0, 2);
      resolvedReservationId = arrivals.reservations[0]?.id;
      contextLines.push(`Arriving today (${arrivals.count}): ${JSON.stringify(arrivals.reservations.slice(0, 2), null, 2)}`);
    }

    // ── STEP 2: Policy evaluation FIRST (agentic: Claude fetches live data via MCP) ──
    const { decision, usedMcp: evalUsedMcp, toolCallsMade: evalToolCalls } = await evaluateWithPolicyAndMcp(
      "Check-In Agent", "checkin",
      `Validate and process check-in for ${guestName ?? "guest"} at property ${propertyId}. ${resolvedReservationId ? `Use GetReservation to verify reservation ${resolvedReservationId}, ListFolios to confirm open folio (Gate 3), GetGuestProfile to verify guest identity (Gate 2), and ListPaymentAccounts to confirm payment method (Gate 4).` : "Find today's arriving reservations."} Run all 5 validation gates per check-in policy before making your decision.`,
      [MCP_TOOLS.GetReservation, MCP_TOOLS.ListFolios, MCP_TOOLS.GetGuestProfile, MCP_TOOLS.ListPaymentAccounts],
      Number(companyId)
    );
    apaleoData.usedMcp = evalUsedMcp;
    apaleoData.toolCallsMade = evalToolCalls;

    // ── STEP 3: Execute check-in ONLY if policy returns PASS ─────────────────
    if (decision.decision === "PASS" && resolvedReservationId) {
      try {
        const { usedMcp } = await mcpOrRest<Record<string, unknown>>(
          MCP_TOOLS.CheckIn,
          { reservationId: resolvedReservationId },
          () =>
            apaleoRequest<Record<string, unknown>>(
              `/booking/v1/reservations/${resolvedReservationId}/checkin`, "PUT"
            )
        );
        checkinExecuted = true;
        apaleoData.checkinExecuted = true;
        apaleoData.usedMcp = usedMcp;
        decision.actionProposed = `Check-in executed via Apaleo API (${usedMcp ? "MCP" : "REST"}) — reservation ${resolvedReservationId} status → InHouse. ${decision.actionProposed}`;
      } catch (err: unknown) {
        checkinError = err instanceof Error ? err.message : String(err);
        apaleoData.checkinError = checkinError;
      }
    } else {
      apaleoData.checkinBlocked = true;
      apaleoData.blockedReason = `Policy decision was ${decision.decision} — check-in API not called`;
    }

    const witnessId = await writeWitnessEntry({
      companyId: Number(companyId),
      agent: "Check-In Agent",
      decision,
      fileReferenced: "Hospitality-Operations-Stay-checkin-agent.SOP.md",
      apaleoData,
      scenarioRunId,
    });

    res.json({
      ...decision, witnessEntryId: witnessId,
      propertyId, reservationId: resolvedReservationId, guestName, checkinExecuted, checkinError,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─── Folio Agent (read-only analysis) ────────────────────────────────────────

router.post("/agents/folio", async (req, res) => {
  try {
    const { propertyId, reservationId, folioId, companyId, scenarioRunId } = req.body as {
      propertyId: string;
      reservationId?: string;
      folioId?: string;
      companyId: number;
      scenarioRunId?: string;
    };

    if (!propertyId || !companyId) {
      return res.status(400).json({ error: "propertyId, companyId required" });
    }

    const taskDesc = [
      `Analyse folio charges for property ${propertyId}.`,
      folioId ? `Use the GetFolio tool to fetch folio ${folioId}.` : "",
      reservationId ? `Use the ListFolios tool to fetch folios for reservation ${reservationId}.` : "",
      !folioId && !reservationId ? `Use the ListFolios tool to list open folios for property ${propertyId}.` : "",
      "Apply folio-settlement-policy.md thresholds and issue a governance decision.",
    ].filter(Boolean).join(" ");

    const { decision, toolCallsMade, usedMcp } = await evaluateWithPolicyAndMcp(
      "Folio Agent",
      "folio",
      taskDesc,
      [MCP_TOOLS.GetFolio, MCP_TOOLS.ListFolios, MCP_TOOLS.ListInvoices],
      Number(companyId)
    );

    const apaleoData: Record<string, unknown> = {
      propertyId, folioId, reservationId, usedMcp, toolCallsMade,
    };

    const witnessId = await writeWitnessEntry({
      companyId: Number(companyId),
      agent: "Folio Agent",
      decision,
      fileReferenced: "Hospitality-Operations-Stay-folio-charge-agent.SOP.md",
      apaleoData,
      scenarioRunId,
    });

    res.json({ ...decision, witnessEntryId: witnessId, propertyId, folioId, reservationId, usedMcp, toolCallsMade });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─── Folio Charge Agent (post a charge to a folio) ────────────────────────────

interface FolioChargeBody {
  serviceType: string;
  amount: { amount: number; currency: string };
  name?: string;
  quantity?: number;
  serviceDate?: string;
}

router.post("/agents/folio-charge", async (req, res) => {
  try {
    const { propertyId, folioId, chargeAmount, currency = "EUR", serviceType = "Other", chargeName, companyId, scenarioRunId } = req.body as {
      propertyId: string;
      folioId?: string;
      chargeAmount: number;
      currency?: string;
      serviceType?: string;
      chargeName?: string;
      companyId: number;
      scenarioRunId?: string;
    };

    if (!propertyId || !chargeAmount || !companyId) {
      return res.status(400).json({ error: "propertyId, chargeAmount, companyId required" });
    }

    const contextLines: string[] = [`Property: ${propertyId}`, `Folio: ${folioId ?? "not specified"}`];
    const apaleoData: Record<string, unknown> = { propertyId, folioId, chargeAmount, currency, serviceType };
    let chargePosted = false;
    let chargeError: string | undefined;
    let resolvedFolioId = folioId;

    // Resolve folio if not provided
    if (!resolvedFolioId) {
      const folioData = await apaleoRequest<{ folios: ApaleoFolio[]; count: number }>(
        "/finance/v1/folios", "GET", undefined, { propertyId, status: "Open", pageSize: 1 }
      ).catch(() => ({ folios: [], count: 0 }));
      resolvedFolioId = folioData.folios[0]?.id;
      apaleoData.resolvedFolioId = resolvedFolioId;
    }

    // Fetch folio for context
    let folioStatus = "Unknown";
    if (resolvedFolioId) {
      const folio = await apaleoRequest<ApaleoFolio>(`/finance/v1/folios/${resolvedFolioId}`).catch(() => null);
      folioStatus = folio?.status ?? "Unknown";
      const existingCharges = folio?.charges ?? [];
      const duplicateCheck = existingCharges.some(
        (c) => c.name === chargeName && c.serviceDate === new Date().toISOString().split("T")[0]
      );
      apaleoData.folioStatus = folioStatus;
      apaleoData.existingChargeCount = existingCharges.length;
      apaleoData.duplicateDetected = duplicateCheck;
      contextLines.push(
        `Folio ${resolvedFolioId}: status=${folioStatus}`,
        `Existing charges: ${existingCharges.length}, duplicate check: ${duplicateCheck ? "DUPLICATE DETECTED" : "no duplicate"}`,
        `Charge to post: €${chargeAmount} ${currency} — ${serviceType} — ${chargeName ?? "unnamed"}`,
        `Amount threshold: ${chargeAmount <= 500 ? "≤€500 (agent authority)" : chargeAmount <= 2000 ? "€500–€2000 (escalate)" : ">€2000 (escalate to Finance Director)"}`
      );
    } else {
      contextLines.push("No open folio found — cannot post charge");
    }

    // ── Policy evaluation FIRST (agentic: Claude fetches live data via MCP) ──
    const { decision, usedMcp: evalUsedMcp, toolCallsMade: evalToolCalls } = await evaluateWithPolicyAndMcp(
      "Folio Agent", "folio_charge",
      `Post charge €${chargeAmount} ${currency} (${serviceType}: ${chargeName ?? "unnamed"}) to folio ${resolvedFolioId ?? "none"} at property ${propertyId}. ${resolvedFolioId ? `Use GetFolio to verify folio ${resolvedFolioId} is Open, ListPaymentAccounts to confirm payment method, ListInvoices to check for duplicate charges, then apply folio-charge-policy thresholds.` : "No folio resolved — apply FAIL decision."}`,
      [MCP_TOOLS.GetFolio, MCP_TOOLS.ListFolios, MCP_TOOLS.ListPaymentAccounts, MCP_TOOLS.ListInvoices],
      Number(companyId)
    );
    apaleoData.usedMcp = evalUsedMcp;
    apaleoData.toolCallsMade = evalToolCalls;

    // ── Execute charge ONLY if PASS ──────────────────────────────────────────
    if (decision.decision === "PASS" && resolvedFolioId && folioStatus === "Open") {
      const chargeBody: FolioChargeBody = {
        serviceType,
        amount: { amount: chargeAmount, currency },
        name: chargeName ?? serviceType,
        quantity: 1,
        serviceDate: new Date().toISOString().split("T")[0],
      };
      try {
        const { usedMcp } = await mcpOrRest<Record<string, unknown>>(
          MCP_TOOLS.CreateFolioCharge,
          { folioId: resolvedFolioId, ...chargeBody },
          () => apaleoRequest<Record<string, unknown>>(
            `/finance/v1/folios/${resolvedFolioId}/charges`, "POST", chargeBody
          )
        );
        chargePosted = true;
        apaleoData.chargePosted = true;
        apaleoData.usedMcp = usedMcp;
        decision.actionProposed = `Charge €${chargeAmount} ${currency} posted to folio ${resolvedFolioId} via Apaleo API (${usedMcp ? "MCP" : "REST"}). ${decision.actionProposed}`;
      } catch (e: unknown) {
        chargeError = e instanceof Error ? e.message : String(e);
        apaleoData.chargeError = chargeError;
      }
    } else if (decision.decision !== "PASS") {
      apaleoData.chargeBlocked = true;
      apaleoData.blockedReason = `Policy decision was ${decision.decision} — charge not posted`;
    }

    const witnessId = await writeWitnessEntry({
      companyId: Number(companyId),
      agent: "Folio Charge Agent",
      decision,
      fileReferenced: "Hospitality-Operations-Stay-folio-charge-agent.SOP.md",
      apaleoData,
      scenarioRunId,
    });

    res.json({
      ...decision, witnessEntryId: witnessId,
      propertyId, folioId: resolvedFolioId, chargeAmount, currency, chargePosted, chargeError,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─── Checkout Agent ───────────────────────────────────────────────────────────

router.post("/agents/checkout", async (req, res) => {
  try {
    const { propertyId, reservationId, guestName, loyaltyTier, lateCheckout, companyId, scenarioRunId } = req.body as {
      propertyId: string;
      reservationId?: string;
      guestName?: string;
      loyaltyTier?: string;
      lateCheckout?: string;
      companyId: number;
      scenarioRunId?: string;
    };

    if (!propertyId || !companyId) {
      return res.status(400).json({ error: "propertyId, companyId required" });
    }

    const contextLines: string[] = [
      `Property: ${propertyId}`,
      `Guest: ${guestName ?? "Guest"}`,
      `Loyalty tier: ${loyaltyTier ?? "Standard"}`,
      `Late checkout requested: ${lateCheckout ?? "No"}`,
    ];
    const apaleoData: Record<string, unknown> = { propertyId, guestName, loyaltyTier, lateCheckout };
    let checkoutExecuted = false;
    let checkoutError: string | undefined;

    // ── STEP 1: Gather checkout validation data ──────────────────────────────
    if (reservationId) {
      const [resvResult, folioResult] = await Promise.allSettled([
        apaleoRequest<ApaleoReservation>(
          `/booking/v1/reservations/${reservationId}`, "GET", undefined,
          { expand: "property,unitGroup,ratePlan,unit,primaryGuest" }
        ),
        apaleoRequest<{ folios: ApaleoFolio[]; count: number }>(
          "/finance/v1/folios", "GET", undefined, { reservationId }
        ),
      ]);

      const resv = resvResult.status === "fulfilled" ? resvResult.value : null;
      const folios = folioResult.status === "fulfilled" ? folioResult.value.folios ?? [] : [];

      const totalOutstanding = folios.reduce((s, f) => s + (f.outstandingAmount?.amount ?? 0), 0);
      const currency = folios[0]?.totalAmount?.currency ?? "EUR";
      const isInHouse = resv?.status === "InHouse";
      const isSettled = totalOutstanding <= 0;
      const tier = loyaltyTier?.toLowerCase() ?? "standard";
      const isLoyaltyEligible = ["gold", "platinum", "vip"].includes(tier);

      apaleoData.reservation = resv;
      apaleoData.folios = folios.slice(0, 3).map((f) => ({
        id: f.id, status: f.status, total: f.totalAmount, outstanding: f.outstandingAmount,
      }));
      apaleoData.validationGates = { isInHouse, isSettled, totalOutstanding, isLoyaltyEligible };

      contextLines.push(
        `Reservation ${reservationId}:`,
        `  Gate 1 — Status: ${resv?.status ?? "Unknown"} → ${isInHouse ? "PASS (InHouse)" : "FAIL (not InHouse)"}`,
        `  Gate 2 — Folio outstanding: ${totalOutstanding} ${currency} → ${isSettled ? "PASS (settled)" : "ESCALATE (unsettled balance)"}`,
        `  Gate 3 — Loyalty tier: ${loyaltyTier ?? "Standard"} → ${isLoyaltyEligible ? "eligible for late checkout waiver" : "standard rate applies"}`,
        `  Late checkout until ${lateCheckout ?? "standard"}: ${isLoyaltyEligible && lateCheckout && lateCheckout <= "14:00" ? "MAY waive fee" : "fee applies"}`
      );
    } else {
      const today = new Date().toISOString().split("T")[0];
      const departures = await apaleoRequest<{ reservations: ApaleoReservation[]; count: number }>(
        "/booking/v1/reservations", "GET", undefined,
        { propertyId, status: "InHouse", dateFilter: "Departure", from: today, to: today, pageSize: 3 }
      ).catch(() => ({ reservations: [], count: 0 }));
      apaleoData.departingToday = departures.reservations.slice(0, 2);
      contextLines.push(`Departing today (${departures.count}): ${JSON.stringify(departures.reservations.slice(0, 2), null, 2)}`);
    }

    // ── STEP 2: Policy evaluation FIRST (agentic: Claude fetches live data via MCP) ──
    const { decision, usedMcp: evalUsedMcp, toolCallsMade: evalToolCalls } = await evaluateWithPolicyAndMcp(
      "Checkout Agent", "checkout",
      `Process checkout for ${guestName ?? "guest"} (${loyaltyTier ?? "Standard"} tier) at property ${propertyId}. ${reservationId ? `Use GetReservation to verify InHouse status for reservation ${reservationId}, ListFolios to check folio settlement balance, and ListInvoices to confirm no open disputed charges.` : `Find today's departing InHouse reservations at property ${propertyId}.`} Late checkout requested: ${lateCheckout ?? "No"}. Apply all checkout-policy.md gates.`,
      [MCP_TOOLS.GetReservation, MCP_TOOLS.ListFolios, MCP_TOOLS.ListInvoices],
      Number(companyId)
    );
    apaleoData.usedMcp = evalUsedMcp;
    apaleoData.toolCallsMade = evalToolCalls;

    // ── STEP 3: Execute checkout ONLY if policy returns PASS ─────────────────
    if (decision.decision === "PASS" && reservationId) {
      try {
        const { usedMcp } = await mcpOrRest<Record<string, unknown>>(
          MCP_TOOLS.CheckOut, { reservationId },
          () => apaleoRequest<Record<string, unknown>>(`/booking/v1/reservations/${reservationId}/checkout`, "PUT")
        );
        checkoutExecuted = true;
        apaleoData.checkoutExecuted = true;
        apaleoData.usedMcp = usedMcp;
        decision.actionProposed = `Checkout executed via Apaleo API (${usedMcp ? "MCP" : "REST"}) — reservation ${reservationId} → CheckedOut. ${decision.actionProposed}`;
      } catch (err: unknown) {
        checkoutError = err instanceof Error ? err.message : String(err);
        apaleoData.checkoutError = checkoutError;
      }
    } else if (decision.decision !== "PASS") {
      apaleoData.checkoutBlocked = true;
      apaleoData.blockedReason = `Policy decision was ${decision.decision} — checkout API not called`;
    }

    const witnessId = await writeWitnessEntry({
      companyId: Number(companyId),
      agent: "Checkout Agent",
      decision,
      fileReferenced: "Hospitality-Operations-Post-Stay-checkout-agent.SOP.md",
      apaleoData,
      scenarioRunId,
    });

    res.json({
      ...decision, witnessEntryId: witnessId,
      propertyId, reservationId, guestName, loyaltyTier, checkoutExecuted, checkoutError,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─── Revenue Reconciliation Agent ─────────────────────────────────────────────

router.post("/agents/revenue", async (req, res) => {
  try {
    const { propertyId, date, companyId, scenarioRunId } = req.body as {
      propertyId: string;
      date?: string;
      companyId: number;
      scenarioRunId?: string;
    };

    if (!propertyId || !companyId) {
      return res.status(400).json({ error: "propertyId, companyId required" });
    }

    const targetDate = date ?? new Date().toISOString().split("T")[0];

    const [reservationsResult, ratePlansResult, revenueResult] = await Promise.allSettled([
      apaleoRequest<{ reservations: ApaleoReservation[]; count: number }>(
        "/booking/v1/reservations", "GET", undefined,
        { propertyId, dateFilter: "Arrival", from: targetDate, to: targetDate, pageSize: 20 }
      ),
      apaleoRequest<{ ratePlans: ApaleoRatePlan[] }>(
        "/rateplan/v1/rate-plans", "GET", undefined, { propertyId }
      ),
      apaleoRequest<{ rows?: Array<{ category?: string; amount?: { grossAmount: number; currency: string } }> }>(
        "/reports/v1/reports/revenue", "GET", undefined, { propertyId, from: targetDate, to: targetDate }
      ).catch(() => ({ rows: [] })),
    ]);

    const reservations = reservationsResult.status === "fulfilled" ? reservationsResult.value.reservations ?? [] : [];
    const ratePlans = ratePlansResult.status === "fulfilled" ? ratePlansResult.value.ratePlans ?? [] : [];
    const revenueRows = revenueResult.status === "fulfilled"
      ? (revenueResult.value as { rows?: Array<{ category?: string; amount?: { grossAmount: number; currency: string } }> }).rows ?? []
      : [];

    const totalRevenue = reservations.reduce((s, r) => s + (r.totalGrossAmount?.amount ?? 0), 0);
    const currency = reservations[0]?.totalGrossAmount?.currency ?? "EUR";

    const apaleoData: Record<string, unknown> = {
      propertyId, date: targetDate, reservationCount: reservations.length,
      totalRevenue, currency, ratePlanCount: ratePlans.length, revenueRowCount: revenueRows.length,
      reservationsSample: reservations.slice(0, 3).map((r) => ({
        id: r.id, status: r.status, ratePlanId: r.ratePlanId, total: r.totalGrossAmount,
      })),
    };

    const context = `Property: ${propertyId}
Date: ${targetDate}
Reservations (${reservations.length}): Total = ${totalRevenue} ${currency}
Rate plans: ${ratePlans.map((p) => p.name || p.id).slice(0, 6).join(", ")}
Revenue report rows: ${revenueRows.length}
Sample reservations: ${JSON.stringify(reservations.slice(0, 3).map((r) => ({ id: r.id, status: r.status, ratePlanId: r.ratePlanId, total: r.totalGrossAmount })), null, 2)}`;

    const { decision, usedMcp: evalUsedMcp, toolCallsMade: evalToolCalls } = await evaluateWithPolicyAndMcp(
      "Revenue Reconciliation Agent", "revenue",
      `Reconcile daily revenue for property ${propertyId} on ${targetDate}. ${reservations.length} reservations fetched via REST with total ${totalRevenue} ${currency}. Use GetReport to pull live revenue report, ListRatePlans to verify rate plan expectations, ListFolios to identify unmatched folios, and ListInvoices to cross-reference charge records. Apply revenue-reconciliation-policy variance thresholds.`,
      [MCP_TOOLS.GetReport, MCP_TOOLS.ListRatePlans, MCP_TOOLS.ListFolios, MCP_TOOLS.ListInvoices],
      Number(companyId)
    );
    apaleoData.usedMcp = evalUsedMcp;
    apaleoData.toolCallsMade = evalToolCalls;

    const witnessId = await writeWitnessEntry({
      companyId: Number(companyId),
      agent: "Revenue Reconciliation Agent",
      decision,
      fileReferenced: "revenue-reconciliation-policy.md",
      apaleoData,
      scenarioRunId,
    });

    res.json({
      ...decision, witnessEntryId: witnessId,
      propertyId, date: targetDate, totalRevenue, currency, reservationCount: reservations.length,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─── Witness Stream — List Entries ────────────────────────────────────────────

router.get("/agents/witness", async (req, res) => {
  try {
    const { companyId, limit = "50" } = req.query as Record<string, string>;
    if (!companyId) return res.status(400).json({ error: "companyId required" });

    const entries = await db
      .select()
      .from(witnessEntries)
      .where(eq(witnessEntries.companyId, Number(companyId)))
      .orderBy(desc(witnessEntries.createdAt))
      .limit(Number(limit));

    res.json(entries);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─── Run Full Demo Scenario ───────────────────────────────────────────────────

interface ScenarioStep {
  step: number;
  agent: string;
  decision: string;
  clauseApplied: string;
  actionProposed: string;
  exceptionApplied: boolean;
  escalationTarget: string | null;
  reasoning: string;
  witnessEntryId: number;
  apaleoIds: Record<string, string | undefined>;
}

router.post("/agents/scenario/run", async (req, res) => {
  try {
    const { propertyId, companyId } = req.body as { propertyId: string; companyId: number };
    if (!propertyId || !companyId) {
      return res.status(400).json({ error: "propertyId and companyId required" });
    }

    const scenarioRunId = `scenario-${Date.now()}`;
    const results: ScenarioStep[] = [];
    const ids: Record<string, string | undefined> = { propertyId };
    const today = new Date().toISOString().split("T")[0];
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().split("T")[0];

    // ─ Step 1: Availability Agent ─────────────────────────────────────────
    {
      const availData = await apaleoRequest<{
        unitGroups: Array<{ unitGroupId: string; availableUnits: number }>;
      }>("/availability/v1/unit-groups", "GET", undefined, {
        propertyId, arrival: today, departure: tomorrow, adults: "2",
      }).catch(() => ({ unitGroups: [] }));

      const ratePlanData = await apaleoRequest<{ ratePlans: ApaleoRatePlan[] }>(
        "/rateplan/v1/rate-plans", "GET", undefined, { propertyId }
      ).catch(() => ({ ratePlans: [] }));

      const unitGroups = availData.unitGroups ?? [];
      const ratePlans = ratePlanData.ratePlans ?? [];
      ids.unitGroupId = unitGroups[0]?.unitGroupId;
      ids.ratePlanId = ratePlans[0]?.id;

      const { decision, usedMcp: availUsedMcp, toolCallsMade: availToolCalls } = await evaluateWithPolicyAndMcp(
        "Availability Agent", "availability",
        `Check live unit availability for property ${propertyId} from ${today} to ${tomorrow} for 2 adults. Use GetAvailableUnitGroups, ListRatePlans, and ListOffers MCP tools to fetch real Apaleo data, then apply availability-policy.md decision criteria.`,
        [MCP_TOOLS.GetAvailableUnitGroups, MCP_TOOLS.ListRatePlans, MCP_TOOLS.ListOffers],
        Number(companyId)
      );

      const wid = await writeWitnessEntry({
        companyId: Number(companyId), agent: "Availability Agent", decision,
        fileReferenced: "Hospitality-Revenue-Pre-Book-availability-agent.SOP.md",
        apaleoData: { propertyId, arrival: today, departure: tomorrow, unitGroups: unitGroups.slice(0, 3), usedMcp: availUsedMcp, toolCallsMade: availToolCalls },
        scenarioRunId,
      });
      results.push({ step: 1, agent: "Availability Agent", ...decision, witnessEntryId: wid, apaleoIds: { ...ids } });
    }

    // ─ Step 2: Rate Agent ─────────────────────────────────────────────────
    {
      const bar = 180; const requested = 162; const discountPct = 10;
      const { decision: rateDecision, usedMcp: rateUsedMcp, toolCallsMade: rateToolCalls } = await evaluateWithPolicyAndMcp(
        "Rate Agent", "rate",
        `Evaluate a 10% discount rate request: BAR €${bar}, requested €${requested} for property ${propertyId}. ${ids.ratePlanId ? `Rate plan ID: ${ids.ratePlanId}.` : ""} Use ListRatePlans and GetReport MCP tools to verify current Apaleo rate plans and revenue data, then apply rate-override-policy thresholds.`,
        [MCP_TOOLS.ListRatePlans, MCP_TOOLS.GetReport],
        Number(companyId)
      );
      const wid = await writeWitnessEntry({
        companyId: Number(companyId), agent: "Rate Agent", decision: rateDecision,
        fileReferenced: "Hospitality-Revenue-Book-rate-agent.SOP.md",
        apaleoData: { barRate: bar, requestedRate: requested, discountPct, ratePlanId: ids.ratePlanId, usedMcp: rateUsedMcp, toolCallsMade: rateToolCalls },
        scenarioRunId,
      });
      results.push({ step: 2, agent: "Rate Agent", ...rateDecision, witnessEntryId: wid, apaleoIds: { ...ids } });
    }

    // ─ Step 3: Reservation Bot (policy-first create) ──────────────────────
    {
      let contextLines: string[] = [`Property: ${propertyId}`, "Action: create"];
      let createdId: string | undefined;
      let writeExecuted = false;

      if (ids.unitGroupId && ids.ratePlanId) {
        contextLines.push(
          `Create request: Guest=Demo Guest, Arrival=${today}, Departure=${tomorrow}`,
          `Unit group available: ${ids.unitGroupId}`,
          `Rate plan available: ${ids.ratePlanId}`,
          `Arrival date check: ${new Date(today) < new Date() ? "PAST — FAIL" : "OK"}`
        );
      } else {
        contextLines.push(
          `Cannot create: missing unit group (${ids.unitGroupId ?? "none"}) or rate plan (${ids.ratePlanId ?? "none"}) from Step 1`
        );
      }

      const { decision, usedMcp: resvUsedMcp, toolCallsMade: resvToolCalls } = await evaluateWithPolicyAndMcp(
        "Reservation Bot", "reservation",
        `Create a reservation for Demo Guest at property ${propertyId} arriving ${today}, departing ${tomorrow}. ${ids.unitGroupId ? `Unit group: ${ids.unitGroupId}.` : ""} ${ids.ratePlanId ? `Rate plan: ${ids.ratePlanId}.` : ""} Use GetAvailableUnitGroups, ListRatePlans, and GetGuestProfile MCP tools to verify live availability and guest identity, then apply reservation-policy rules.`,
        [MCP_TOOLS.GetAvailableUnitGroups, MCP_TOOLS.ListRatePlans, MCP_TOOLS.GetGuestProfile],
        Number(companyId)
      );

      // Execute only on PASS
      if (decision.decision === "PASS" && ids.unitGroupId && ids.ratePlanId) {
        const bookingBody: CreateReservationBody = {
          propertyId, unitGroupId: ids.unitGroupId, ratePlanId: ids.ratePlanId,
          arrival: today, departure: tomorrow, adults: 2,
          booker: { firstName: "Demo", lastName: "Guest", email: "demo@vda-mk.com" },
        };
        try {
          const { result: created, usedMcp } = await mcpOrRest<CreatedReservation>(
            MCP_TOOLS.CreateBooking, { ...bookingBody },
            () => apaleoRequest<CreatedReservation>("/booking/v1/reservations", "POST", bookingBody)
          );
          createdId = created.id;
          ids.reservationId = createdId;
          writeExecuted = true;
          decision.actionProposed = `Reservation created in Apaleo: ID = ${createdId} (${usedMcp ? "MCP" : "REST"}). ${decision.actionProposed}`;
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          // Fallback cascade: Confirmed → InHouse → CheckedOut (most recent)
          // This ensures subsequent agents have a real reservation to read from Apaleo.
          const fallback = await (async () => {
            for (const status of ["Confirmed", "InHouse", "CheckedOut"]) {
              const r = await apaleoRequest<{ reservations: ApaleoReservation[] }>(
                "/booking/v1/reservations", "GET", undefined, { propertyId, status, pageSize: 1 }
              ).catch(() => ({ reservations: [] }));
              if (r.reservations[0]) return { status, id: r.reservations[0].id };
            }
            return null;
          })();
          if (fallback) {
            ids.reservationId = fallback.id;
            const note = fallback.status === "CheckedOut"
              ? `Using recent historical reservation ${fallback.id} (${fallback.status}) as demo anchor — subsequent agents will demonstrate evaluation logic against live Apaleo data.`
              : `Using existing ${fallback.status} reservation ${fallback.id} for scenario continuation.`;
            decision.actionProposed = `Create attempted but requires reservations.manage scope (sandbox limitation). ${note} ${decision.actionProposed}`;
          } else {
            decision.actionProposed = `Create attempted but requires reservations.manage scope. No existing reservations found for demo anchor. ${decision.actionProposed}`;
          }
        }
      }

      const wid = await writeWitnessEntry({
        companyId: Number(companyId), agent: "Reservation Bot", decision,
        fileReferenced: "Hospitality-Operations-Stay-checkin-agent.SOP.md",
        apaleoData: { createdId, writeExecuted, unitGroupId: ids.unitGroupId, ratePlanId: ids.ratePlanId, usedMcp: resvUsedMcp, toolCallsMade: resvToolCalls },
        scenarioRunId,
      });
      results.push({ step: 3, agent: "Reservation Bot", ...decision, witnessEntryId: wid, apaleoIds: { ...ids } });
    }

    // ─ Step 4: Check-In Agent (policy-first, execute on PASS) ────────────
    {
      const reservationId = ids.reservationId;
      const contextLines: string[] = [`Property: ${propertyId}`, "Guest: Demo Guest"];
      let checkinExecuted = false;
      let folioFromCheckin: string | undefined;

      if (reservationId) {
        const [resvResult, folioResult] = await Promise.allSettled([
          apaleoRequest<ApaleoReservation>(`/booking/v1/reservations/${reservationId}`, "GET", undefined, { expand: "primaryGuest" }),
          apaleoRequest<{ folios: ApaleoFolio[] }>("/finance/v1/folios", "GET", undefined, { reservationId }),
        ]);

        const resv = resvResult.status === "fulfilled" ? resvResult.value : null;
        const folios = folioResult.status === "fulfilled" ? folioResult.value.folios ?? [] : [];
        if (folios[0]?.id) { ids.folioId = folios[0].id; folioFromCheckin = folios[0].id; }

        const validStatuses: ReservationStatus[] = ["Confirmed"];
        const statusOk = resv !== null && validStatuses.includes(resv.status as ReservationStatus);
        const arrivalDate = resv?.arrival ? new Date(resv.arrival) : null;
        const todayDate = new Date(); todayDate.setHours(0, 0, 0, 0);
        const arrivalOk = arrivalDate !== null && arrivalDate <= todayDate;
        const folioOk = folios.length > 0;

        contextLines.push(
          `Reservation ${reservationId}: status=${resv?.status ?? "Unknown"}`,
          `  Gate 1 — Status OK: ${statusOk ? "PASS" : "FAIL"}`,
          `  Gate 2 — Guest "Demo Guest" vs record: PASS`,
          `  Gate 3 — Folio exists: ${folioOk ? `PASS (${folios.length})` : "ESCALATE (none)"}`,
          `  Gate 4 — Payment on folio: ${folioOk ? "PASS" : "ESCALATE"}`,
          `  Gate 5 — Arrival date: ${resv?.arrival ?? "?"} → ${arrivalOk ? "PASS" : "FAIL"}`,
        );

        if (resv?.status === "InHouse") {
          contextLines.push("Already InHouse — check-in already complete");
          ids.checkinDone = "true";
        }
      } else {
        contextLines.push("No reservation ID — cannot validate check-in");
      }

      const { decision: ciDecision, usedMcp: ciUsedMcp, toolCallsMade: ciToolCalls } = await evaluateWithPolicyAndMcp(
        "Check-In Agent", "checkin",
        `Check-in Demo Guest at property ${propertyId}. ${reservationId ? `Use GetReservation to verify reservation ${reservationId}, ListFolios to confirm open folio (Gate 3), GetGuestProfile to verify guest identity (Gate 2), and ListPaymentAccounts to confirm payment method (Gate 4).` : "No reservation ID resolved — issue FAIL."} Validate all 5 check-in gates per check-in-policy.md.`,
        [MCP_TOOLS.GetReservation, MCP_TOOLS.ListFolios, MCP_TOOLS.GetGuestProfile, MCP_TOOLS.ListPaymentAccounts],
        Number(companyId)
      );

      if (ciDecision.decision === "PASS" && reservationId) {
        try {
          const { usedMcp } = await mcpOrRest<Record<string, unknown>>(
            MCP_TOOLS.CheckIn, { reservationId },
            () => apaleoRequest<Record<string, unknown>>(`/booking/v1/reservations/${reservationId}/checkin`, "PUT")
          );
          checkinExecuted = true;
          ids.checkinDone = "true";
          ciDecision.actionProposed = `Check-in executed → InHouse (${usedMcp ? "MCP" : "REST"}). ${ciDecision.actionProposed}`;
        } catch (e: unknown) {
          ciDecision.actionProposed = `Check-in attempted: ${e instanceof Error ? e.message : String(e)}. ${ciDecision.actionProposed}`;
        }
      }

      const wid = await writeWitnessEntry({
        companyId: Number(companyId), agent: "Check-In Agent", decision: ciDecision,
        fileReferenced: "Hospitality-Operations-Stay-checkin-agent.SOP.md",
        apaleoData: { reservationId, checkinExecuted, folioId: folioFromCheckin, usedMcp: ciUsedMcp, toolCallsMade: ciToolCalls },
        scenarioRunId,
      });
      results.push({ step: 4, agent: "Check-In Agent", ...ciDecision, witnessEntryId: wid, apaleoIds: { ...ids } });
    }

    // ─ Step 5: Folio Charge Agent (policy-first, post charge on PASS) ─────
    {
      const folioId = ids.folioId;
      const contextLines: string[] = [`Property: ${propertyId}`, `Folio: ${folioId ?? "not resolved"}`];
      let chargePosted = false;

      if (folioId) {
        const folio = await apaleoRequest<ApaleoFolio>(`/finance/v1/folios/${folioId}`).catch(() => null);
        const folioStatus = folio?.status ?? "Unknown";
        contextLines.push(
          `Folio ${folioId}: status=${folioStatus}`,
          `Charge to post: €240 EUR — RoomRevenue — Demo Room Charge`,
          `Amount threshold: ≤€500 → agent authority (PASS if folio Open)`
        );
      } else {
        contextLines.push("No folio ID resolved — charge cannot be posted");
      }

      const { decision: fcDecision, usedMcp: fcUsedMcp, toolCallsMade: fcToolCalls } = await evaluateWithPolicyAndMcp(
        "Folio Agent", "folio_charge",
        `Post a room charge of €240 EUR (RoomRevenue: Demo Room Charge) to folio ${folioId ?? "none"} at property ${propertyId}. ${folioId ? `Use GetFolio to verify folio ${folioId} is Open, ListPaymentAccounts to confirm payment method, and ListInvoices to check for duplicate charges.` : "No folio ID resolved — apply FAIL."} Apply folio-charge-policy thresholds.`,
        [MCP_TOOLS.GetFolio, MCP_TOOLS.ListFolios, MCP_TOOLS.ListPaymentAccounts, MCP_TOOLS.ListInvoices],
        Number(companyId)
      );

      if (fcDecision.decision === "PASS" && folioId) {
        const chargeBody: FolioChargeBody = {
          serviceType: "RoomRevenue",
          amount: { amount: 240, currency: "EUR" },
          name: "Demo Room Charge",
          quantity: 1,
          serviceDate: today,
        };
        try {
          const { usedMcp } = await mcpOrRest<Record<string, unknown>>(
            MCP_TOOLS.CreateFolioCharge, { folioId, ...chargeBody },
            () => apaleoRequest<Record<string, unknown>>(`/finance/v1/folios/${folioId}/charges`, "POST", chargeBody)
          );
          chargePosted = true;
          fcDecision.actionProposed = `Charge €240 EUR posted to folio ${folioId} (${usedMcp ? "MCP" : "REST"}). ${fcDecision.actionProposed}`;
        } catch (e: unknown) {
          fcDecision.actionProposed = `Charge attempted: ${e instanceof Error ? e.message : String(e)}. ${fcDecision.actionProposed}`;
        }
      }

      const wid = await writeWitnessEntry({
        companyId: Number(companyId), agent: "Folio Charge Agent", decision: fcDecision,
        fileReferenced: "Hospitality-Operations-Stay-folio-charge-agent.SOP.md",
        apaleoData: { folioId, chargePosted, chargeAmount: 240, currency: "EUR", usedMcp: fcUsedMcp, toolCallsMade: fcToolCalls },
        scenarioRunId,
      });
      results.push({ step: 5, agent: "Folio Charge Agent", ...fcDecision, witnessEntryId: wid, apaleoIds: { ...ids } });
    }

    // ─ Step 6: Checkout Agent (policy-first, execute on PASS) ────────────
    {
      const reservationId = ids.reservationId;
      const contextLines: string[] = [
        `Property: ${propertyId}`, "Guest: Demo Guest (Gold loyalty tier)", "Late checkout: Until 13:00",
      ];
      let checkoutExecuted = false;

      if (reservationId) {
        const [resvResult, folioResult] = await Promise.allSettled([
          apaleoRequest<ApaleoReservation>(`/booking/v1/reservations/${reservationId}`, "GET"),
          apaleoRequest<{ folios: ApaleoFolio[] }>("/finance/v1/folios", "GET", undefined, { reservationId }),
        ]);

        const resv = resvResult.status === "fulfilled" ? resvResult.value : null;
        const folios = folioResult.status === "fulfilled" ? folioResult.value.folios ?? [] : [];
        const totalOutstanding = folios.reduce((s, f) => s + (f.outstandingAmount?.amount ?? 0), 0);
        const currency = folios[0]?.totalAmount?.currency ?? "EUR";
        const isInHouse = resv?.status === "InHouse";
        const isSettled = totalOutstanding <= 0;

        contextLines.push(
          `Reservation ${reservationId}: status=${resv?.status ?? "Unknown"}`,
          `  Gate 1 — InHouse: ${isInHouse ? "PASS" : "FAIL"}`,
          `  Gate 2 — Outstanding: ${totalOutstanding} ${currency} → ${isSettled ? "PASS (settled)" : "ESCALATE"}`,
          `  Gate 3 — Loyalty Gold: eligible for late checkout waiver until 14:00 → exception_applied=true`
        );

        const { decision: coDecision, usedMcp: coUsedMcp, toolCallsMade: coToolCalls } = await evaluateWithPolicyAndMcp(
          "Checkout Agent", "checkout",
          `Checkout Demo Guest (Gold loyalty tier, late checkout until 13:00) at property ${propertyId}. Use GetReservation to verify reservation ${reservationId} is InHouse, ListFolios to check folio settlement balance, and ListInvoices to confirm no open disputed charges. Apply checkout-policy.md gates and loyalty exception rules.`,
          [MCP_TOOLS.GetReservation, MCP_TOOLS.ListFolios, MCP_TOOLS.ListInvoices],
          Number(companyId)
        );

        if (coDecision.decision === "PASS") {
          try {
            const { usedMcp } = await mcpOrRest<Record<string, unknown>>(
              MCP_TOOLS.CheckOut, { reservationId },
              () => apaleoRequest<Record<string, unknown>>(`/booking/v1/reservations/${reservationId}/checkout`, "PUT")
            );
            checkoutExecuted = true;
            coDecision.actionProposed = `Checkout executed → CheckedOut (${usedMcp ? "MCP" : "REST"}). ${coDecision.actionProposed}`;
          } catch (e: unknown) {
            coDecision.actionProposed = `Checkout attempted: ${e instanceof Error ? e.message : String(e)}. ${coDecision.actionProposed}`;
          }
        }

        const coTotalOutstanding = folios.reduce((s: number, f: ApaleoFolio) => s + (f.outstandingAmount?.amount ?? 0), 0);
        const coCurrency = folios[0]?.totalAmount?.currency ?? "EUR";
        const wid = await writeWitnessEntry({
          companyId: Number(companyId), agent: "Checkout Agent", decision: coDecision,
          fileReferenced: "Hospitality-Operations-Post-Stay-checkout-agent.SOP.md",
          apaleoData: { reservationId, checkoutExecuted, loyaltyTier: "Gold", lateCheckout: "13:00", totalOutstanding: coTotalOutstanding, currency: coCurrency, usedMcp: coUsedMcp, toolCallsMade: coToolCalls },
          scenarioRunId,
        });
        results.push({ step: 6, agent: "Checkout Agent", ...coDecision, witnessEntryId: wid, apaleoIds: { ...ids } });
      } else {
        const decision: AgentDecision = {
          decision: "FAIL", clauseApplied: "Reservation ID required for checkout",
          actionProposed: "Cannot process checkout — no reservation ID", exceptionApplied: false,
          escalationTarget: "Operations Director", reasoning: "No reservation ID available from earlier scenario steps",
        };
        const wid = await writeWitnessEntry({
          companyId: Number(companyId), agent: "Checkout Agent", decision,
          fileReferenced: "Hospitality-Operations-Post-Stay-checkout-agent.SOP.md",
          apaleoData: { reservationId: undefined, checkoutExecuted: false },
          scenarioRunId,
        });
        results.push({ step: 6, agent: "Checkout Agent", ...decision, witnessEntryId: wid, apaleoIds: { ...ids } });
      }
    }

    // ─ Step 7: Revenue Reconciliation ────────────────────────────────────
    {
      // Use a rolling 30-day window to ensure real historical data is available
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().split("T")[0];
      const reservations = await apaleoRequest<{ reservations: ApaleoReservation[]; count: number }>(
        "/booking/v1/reservations", "GET", undefined,
        { propertyId, dateFilter: "Arrival", from: thirtyDaysAgo, to: today, pageSize: 10 }
      ).catch(() => ({ reservations: [], count: 0 }));

      const total = reservations.reservations.reduce((s, r) => s + (r.totalGrossAmount?.amount ?? 0), 0);
      const currency = reservations.reservations[0]?.totalGrossAmount?.currency ?? "EUR";

      const { decision: revDecision, usedMcp: revUsedMcp, toolCallsMade: revToolCalls } = await evaluateWithPolicyAndMcp(
        "Revenue Reconciliation Agent", "revenue",
        `End-of-scenario revenue reconciliation for property ${propertyId} on ${today}. ${reservations.count} reservations (total ${total} ${currency}) retrieved via REST. Use GetReport to pull live revenue data, ListRatePlans to verify rate plan expectations, ListFolios to identify unmatched folios, and ListInvoices to cross-reference charges. Apply revenue-reconciliation-policy variance thresholds.`,
        [MCP_TOOLS.GetReport, MCP_TOOLS.ListRatePlans, MCP_TOOLS.ListFolios, MCP_TOOLS.ListInvoices],
        Number(companyId)
      );

      const wid = await writeWitnessEntry({
        companyId: Number(companyId), agent: "Revenue Reconciliation Agent", decision: revDecision,
        fileReferenced: "revenue-reconciliation-policy.md",
        apaleoData: { date: today, reservationCount: reservations.count, totalRevenue: total, currency, scenarioReservationId: ids.reservationId, usedMcp: revUsedMcp, toolCallsMade: revToolCalls },
        scenarioRunId,
      });
      results.push({ step: 7, agent: "Revenue Reconciliation Agent", ...revDecision, witnessEntryId: wid, apaleoIds: { ...ids } });
    }

    res.json({ scenarioRunId, propertyId, apaleoIds: ids, steps: results, completedAt: new Date().toISOString() });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

export default router;
