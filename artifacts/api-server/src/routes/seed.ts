/**
 * Demo Data Seeder
 * POST /api/admin/seed-demo-data   – creates Apaleo sandbox reservations
 * POST /api/admin/seed-companies   – seeds 5 citizenM hotel entries + governance files
 *
 * Safe to call multiple times — idempotent checks throughout.
 */

import { Router, type IRouter } from "express";
import { apaleoFetch } from "../lib/apaleo.js";
import { db, companies, governanceFiles, witnessEntries, agentPhases } from "@workspace/db";
import { eq, and, inArray, desc } from "drizzle-orm";
import { callAI } from "./ai-proxy.js";
import { checkComplianceGuards } from "../lib/complianceGuards.js";

const router: IRouter = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dateOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

/** Build one time slice per night between arrival and departure */
function buildTimeSlices(
  arrival: string,
  departure: string,
  ratePlanId: string,
  unitGroupId: string
): Array<{ ratePlanId: string; unitGroupId: string; from: string; to: string; count: number }> {
  const slices = [];
  const start = new Date(arrival);
  const end = new Date(departure);
  const curr = new Date(start);
  while (curr < end) {
    const next = new Date(curr);
    next.setDate(next.getDate() + 1);
    slices.push({
      ratePlanId,
      unitGroupId,
      from: curr.toISOString().split("T")[0],
      to: next.toISOString().split("T")[0],
      count: 1,
    });
    curr.setDate(curr.getDate() + 1);
  }
  return slices;
}

interface TimeSlice {
  ratePlanId: string;
  unitGroupId: string;
  from: string;
  to: string;
  count: number;
}

interface PaymentAccount {
  accountNumber: string;
  accountHolder: string;
  expiryMonth: string;
  expiryYear: string;
  paymentMethod: string;
  payerEmail: string;
}

interface BookingPayload {
  booker: { firstName: string; lastName: string; email: string };
  reservations: Array<{
    arrival: string;
    departure: string;
    adults: number;
    channelCode: string;
    ratePlanId: string;
    guaranteeType: string;
    paymentAccount: PaymentAccount;
    travelPurpose?: string;
    timeSlices: TimeSlice[];
  }>;
}

interface BookingResult {
  id?: string;
  reservations?: Array<{ id: string }>;
}

async function createBooking(payload: BookingPayload): Promise<{ bookingId: string; reservationId: string }> {
  const result = await apaleoFetch<BookingResult>("/booking/v1/bookings", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const bookingId = result.id ?? "";
  const reservationId = result.reservations?.[0]?.id ?? "";
  return { bookingId, reservationId };
}

async function checkInReservation(reservationId: string): Promise<void> {
  await apaleoFetch(`/operations/v1/reservations/${reservationId}/check-in`, {
    method: "PUT",
  });
}

// ─── Demo Guest Pool ──────────────────────────────────────────────────────────

const GUESTS = [
  { firstName: "Emma",   lastName: "Schulz",    email: "emma.schulz@demo-vdamk.com" },
  { firstName: "Luca",   lastName: "Ferrari",   email: "luca.ferrari@demo-vdamk.com" },
  { firstName: "Amara",  lastName: "Osei",      email: "amara.osei@demo-vdamk.com" },
  { firstName: "Felix",  lastName: "Wagner",    email: "felix.wagner@demo-vdamk.com" },
  { firstName: "Yuki",   lastName: "Tanaka",    email: "yuki.tanaka@demo-vdamk.com" },
  { firstName: "Carlos", lastName: "Mendez",    email: "carlos.mendez@demo-vdamk.com" },
  { firstName: "Sophie", lastName: "Bernard",   email: "sophie.bernard@demo-vdamk.com" },
  { firstName: "Omar",   lastName: "Al-Rashid", email: "omar.rashid@demo-vdamk.com" },
];

const PAYMENT_ACCOUNT: PaymentAccount = {
  accountNumber: "4111111111111111",
  accountHolder: "Demo Guest",
  expiryMonth: "12",
  expiryYear: "2027",
  paymentMethod: "Visa",
  payerEmail: "demo@demo-vdamk.com",
};

// Property config: ratePlanId → unitGroupId mapping
const PROPERTY_CONFIG: Record<string, { definiteRp: string; inhouseRp: string; unitGroupId: string }> = {
  BER: { definiteRp: "BER-FLEX-DBL",  inhouseRp: "BER-APALEO-DBL",  unitGroupId: "BER-DBL" },
  LND: { definiteRp: "LND-FLEX-DBL",  inhouseRp: "LND-APALEO-DBL",  unitGroupId: "LND-DBL" },
  MUC: { definiteRp: "MUC-FLEX-DBL",  inhouseRp: "MUC-APALEO-DBL",  unitGroupId: "MUC-DBL" },
  PAR: { definiteRp: "PAR-FLEX-DBL",  inhouseRp: "PAR-APALEO-DBL",  unitGroupId: "PAR-DBL" },
  VIE: { definiteRp: "VIE-FLEX-DBL",  inhouseRp: "VIE-APALEO-DBL",  unitGroupId: "VIE-DBL" },
};

// ─── Count check ──────────────────────────────────────────────────────────────

async function countReservationsByStatus(propertyId: string, status: string): Promise<number> {
  try {
    const r = await apaleoFetch<{ count?: number }>(
      `/booking/v1/reservations?propertyId=${propertyId}&status=${status}&pageSize=1`
    );
    return r.count ?? 0;
  } catch {
    return 0;
  }
}

// ─── Seed Route ───────────────────────────────────────────────────────────────

router.post("/admin/seed-demo-data", async (req, res) => {
  const log: string[] = [];
  const errors: string[] = [];
  const created: { property: string; type: string; reservationId: string; guest: string }[] = [];

  const targetProps = ((req.query.properties as string) || "BER,LND,MUC,PAR,VIE").split(",");
  log.push(`Seeding demo data for: ${targetProps.join(", ")}`);

  let guestIndex = 0;
  const nextGuest = () => GUESTS[guestIndex++ % GUESTS.length];

  for (const pid of targetProps) {
    const cfg = PROPERTY_CONFIG[pid];
    if (!cfg) {
      errors.push(`Unknown property: ${pid}`);
      continue;
    }

    const [existingDefinite, existingInHouse] = await Promise.all([
      countReservationsByStatus(pid, "Confirmed"),
      countReservationsByStatus(pid, "InHouse"),
    ]);

    log.push(`${pid}: existing Confirmed=${existingDefinite}, InHouse=${existingInHouse}`);

    // ── Definite reservations (arriving tomorrow, 2-night stay) ───────────
    const wantDefinite = 3;
    const needDefinite = Math.max(0, wantDefinite - existingDefinite);

    for (let i = 0; i < needDefinite; i++) {
      const guest = nextGuest();
      const arrival = dateOffset(1 + i);
      const departure = dateOffset(3 + i);
      const timeSlices = buildTimeSlices(arrival, departure, cfg.definiteRp, cfg.unitGroupId);

      try {
        const { reservationId } = await createBooking({
          booker: { firstName: guest.firstName, lastName: guest.lastName, email: guest.email },
          reservations: [{
            arrival,
            departure,
            adults: 2,
            channelCode: "Direct",
            ratePlanId: cfg.definiteRp,
            guaranteeType: "CreditCard",
            paymentAccount: {
              ...PAYMENT_ACCOUNT,
              accountHolder: `${guest.firstName} ${guest.lastName}`,
              payerEmail: guest.email,
            },
            travelPurpose: "Business",
            timeSlices,
          }],
        });

        created.push({ property: pid, type: "Definite", reservationId, guest: `${guest.firstName} ${guest.lastName}` });
        log.push(`✓ ${pid} Definite: ${reservationId} (${guest.firstName} ${guest.lastName}, ${arrival}→${departure})`);
      } catch (err) {
        const msg = err instanceof Error ? err.message.slice(0, 300) : String(err);
        errors.push(`${pid} Definite failed: ${msg}`);
        log.push(`✗ ${pid} Definite FAILED: ${msg}`);
      }
    }

    // ── InHouse reservations (arriving today, check in immediately) ────────
    const wantInHouse = 2;
    const needInHouse = Math.max(0, wantInHouse - existingInHouse);

    for (let i = 0; i < needInHouse; i++) {
      const guest = nextGuest();
      const arrival = dateOffset(0);
      const departure = dateOffset(2 + i);
      const timeSlices = buildTimeSlices(arrival, departure, cfg.inhouseRp, cfg.unitGroupId);

      try {
        const { reservationId } = await createBooking({
          booker: { firstName: guest.firstName, lastName: guest.lastName, email: guest.email },
          reservations: [{
            arrival,
            departure,
            adults: 1,
            channelCode: "Direct",
            ratePlanId: cfg.inhouseRp,
            guaranteeType: "CreditCard",
            paymentAccount: {
              ...PAYMENT_ACCOUNT,
              accountHolder: `${guest.firstName} ${guest.lastName}`,
              payerEmail: guest.email,
            },
            travelPurpose: "Leisure",
            timeSlices,
          }],
        });

        log.push(`  → Checking in ${reservationId}…`);
        try {
          await checkInReservation(reservationId);
          created.push({ property: pid, type: "InHouse", reservationId, guest: `${guest.firstName} ${guest.lastName}` });
          log.push(`✓ ${pid} InHouse checked-in: ${reservationId} (${guest.firstName} ${guest.lastName})`);
        } catch (ciErr) {
          created.push({ property: pid, type: "Definite(checkin-deferred)", reservationId, guest: `${guest.firstName} ${guest.lastName}` });
          const ciMsg = ciErr instanceof Error ? ciErr.message.slice(0, 150) : String(ciErr);
          log.push(`⚠ ${pid} booking OK but check-in deferred: ${ciMsg}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message.slice(0, 300) : String(err);
        errors.push(`${pid} InHouse failed: ${msg}`);
        log.push(`✗ ${pid} InHouse FAILED: ${msg}`);
      }
    }

    if (needDefinite === 0 && needInHouse === 0) {
      log.push(`${pid}: sufficient demo data exists, skipped`);
    }
  }

  // Final counts
  const finalCounts: Record<string, { Confirmed: number; InHouse: number }> = {};
  await Promise.all(
    targetProps.map(async (pid) => {
      const [d, ih] = await Promise.all([
        countReservationsByStatus(pid, "Confirmed"),
        countReservationsByStatus(pid, "InHouse"),
      ]);
      finalCounts[pid] = { Confirmed: d, InHouse: ih };
    })
  );

  res.json({
    success: errors.length === 0,
    created,
    finalCounts,
    log,
    errors: errors.length > 0 ? errors : undefined,
  });
});

// ─── Demo Reservation Resolver ────────────────────────────────────────────────
// Finds the best available reservation per property for demo purposes.
// Priority: InHouse > Definite > CheckedOut (most recent).

router.get("/admin/demo-reservations", async (req, res) => {
  const properties = ["BER", "LND", "MUC", "PAR", "VIE"];

  interface DemoReservation {
    reservationId: string;
    status: string;
    arrival?: string;
    departure?: string;
    guest?: string;
    folioId?: string;
  }

  const results: Record<string, DemoReservation | null> = {};

  // Sequential per property to avoid Apaleo rate limiting + ensure correct property filtering
  for (const pid of properties) {
    let found = false;
    for (const status of ["InHouse", "Confirmed", "CheckedOut"]) {
      try {
        const r = await apaleoFetch<{
          reservations?: Array<{
            id: string; status: string; arrival?: string; departure?: string;
            property?: { id: string };
            primaryGuest?: { firstName?: string; lastName?: string };
          }>;
          count?: number;
        }>(`/booking/v1/reservations?propertyId=${pid}&status=${status}&pageSize=1`);

        const resv = r.reservations?.find(x => !x.property || x.property.id === pid) ?? r.reservations?.[0];
        if (resv) {
          // Try to get a folio for this reservation
          let folioId: string | undefined;
          try {
            const folios = await apaleoFetch<{ folios?: Array<{ id: string }> }>(
              `/finance/v1/folios?reservationId=${resv.id}&pageSize=1`
            );
            folioId = folios.folios?.[0]?.id;
          } catch { /* folioId stays undefined */ }

          results[pid] = {
            reservationId: resv.id,
            status: resv.status,
            arrival: resv.arrival?.split("T")[0],
            departure: resv.departure?.split("T")[0],
            guest: [resv.primaryGuest?.firstName, resv.primaryGuest?.lastName].filter(Boolean).join(" ") || "Unknown Guest",
            folioId,
          };
          found = true;
          break;
        }
      } catch { /* try next status */ }
    }
    if (!found) results[pid] = null;
  }

  const anyReady = Object.values(results).some(Boolean);
  res.json({ anyReady, reservations: results });
});

// ─── Idempotent Status Check ──────────────────────────────────────────────────

router.get("/admin/seed-status", async (req, res) => {
  const properties = ["BER", "LND", "MUC", "PAR", "VIE"];

  const counts: Record<string, Record<string, number>> = {};
  await Promise.all(
    properties.map(async (pid) => {
      const statuses = ["Confirmed", "InHouse", "CheckedOut", "Canceled", "NoShow"];
      counts[pid] = {};
      for (const s of statuses) {
        counts[pid][s] = await countReservationsByStatus(pid, s);
      }
    })
  );

  const demoReady = properties.some(
    (pid) => (counts[pid]?.Confirmed ?? 0) >= 1 || (counts[pid]?.InHouse ?? 0) >= 1 || (counts[pid]?.CheckedOut ?? 0) >= 1
  );

  const scopeLimitations = {
    "reservations.manage": false,
    "folios.write": false,
    note: "Sandbox client credentials have reservations.read scope only. Demo uses historical CheckedOut reservations as data anchors. Write operations (CreateBooking, CheckIn, CheckOut, FolioCharge) are evaluated against policy but require scope upgrade to execute.",
  };

  res.json({ demoReady, counts, scopeLimitations });
});

// ─── Seed Companies ───────────────────────────────────────────────────────────
// POST /api/admin/seed-companies
// Idempotently creates 5 citizenM hotel entries (BER/LND/MUC/PAR/VIE) with
// governance files pre-seeded so all 7 demo agents have policy to evaluate against.

function countClauses(content: string) {
  const mustCount = (content.match(/\bMUST\b(?!\s+NOT)/g) || []).length;
  const mustNotCount = (content.match(/\bMUST NOT\b/g) || []).length;
  const mayCount = (content.match(/\bMAY\b/g) || []).length;
  const wordCount = content.split(/\s+/).filter(Boolean).length;
  return { mustCount, mustNotCount, mayCount, wordCount };
}

const CITIZENM_PROPERTIES = [
  {
    apaleoPropertyId: "BER",
    companyName: "citizenM Berlin",
    websiteUrl: "https://www.citizenm.com/hotels/europe/berlin/berlin-checkpoint-charlie-hotel",
    brandContext: "citizenM is a global hotel chain renowned for affordable luxury — bold Vitra design, fast self check-in kiosks, and an API-first tech stack powered by Apaleo. citizenM Berlin (Checkpoint Charlie) sits at the historic heart of Berlin. Brand values: technology-first, bold design, affordable luxury, Apaleo PMS at the core. Self check-in kiosks, mobile key, tablet-controlled moodpad room settings. All guest touchpoints driven by Apaleo open API integrations. Operational language: English-first, German signage. Role titles: citizenM Ambassador, Revenue Manager, Operations Director. Rooms not suites. Guests are called 'citizens'. VDA-MK governance covers the full Apaleo guest lifecycle: availability, rate override, reservation creation, check-in, folio charge, and checkout.",
  },
  {
    apaleoPropertyId: "LND",
    companyName: "citizenM London",
    websiteUrl: "https://www.citizenm.com/hotels/europe/london/london-bankside-hotel",
    brandContext: "citizenM is a global hotel chain renowned for affordable luxury — bold Vitra design, fast self check-in kiosks, and an API-first tech stack powered by Apaleo. citizenM London (Bankside) is on the South Bank, steps from Tate Modern and the Globe Theatre. Brand values: technology-first, bold design, affordable luxury, Apaleo PMS at the core. Self check-in kiosks, mobile key, tablet-controlled moodpad room settings. All guest touchpoints driven by Apaleo open API integrations. Operational language: English. Role titles: citizenM Ambassador, Revenue Manager, Operations Director. Guests are called 'citizens'. VDA-MK governance covers the full Apaleo guest lifecycle: availability, rate override, reservation creation, check-in, folio charge, and checkout.",
  },
  {
    apaleoPropertyId: "MUC",
    companyName: "citizenM Munich",
    websiteUrl: "https://www.citizenm.com/hotels/europe/munich/munich-hotel",
    brandContext: "citizenM is a global hotel chain renowned for affordable luxury — bold Vitra design, fast self check-in kiosks, and an API-first tech stack powered by Apaleo. citizenM Munich is near the main train station with quick access to the city centre and trade fair grounds. Brand values: technology-first, bold design, affordable luxury, Apaleo PMS at the core. Operational language: English and German. Role titles: citizenM Ambassador (Gastgeber), Revenue Manager, Operations Director. Guests are called 'citizens'. VDA-MK governance covers the full Apaleo guest lifecycle: availability, rate override, reservation creation, check-in, folio charge, and checkout.",
  },
  {
    apaleoPropertyId: "PAR",
    companyName: "citizenM Paris",
    websiteUrl: "https://www.citizenm.com/hotels/europe/paris/paris-gare-de-lyon-hotel",
    brandContext: "citizenM is a global hotel chain renowned for affordable luxury — bold Vitra design, fast self check-in kiosks, and an API-first tech stack powered by Apaleo. citizenM Paris (Gare de Lyon) is steps from the iconic station. Brand values: technology-first, bold design, affordable luxury, Apaleo PMS at the core. Operational language: English and French. Role titles: citizenM Ambassador (Ambassadeur), Revenue Manager, Directeur des opérations. Guests are called 'citizens'. VDA-MK governance covers the full Apaleo guest lifecycle: availability, rate override, reservation creation, check-in, folio charge, and checkout.",
  },
  {
    apaleoPropertyId: "VIE",
    companyName: "citizenM Vienna",
    websiteUrl: "https://www.citizenm.com/hotels/europe/vienna/vienna-hotel",
    brandContext: "citizenM is a global hotel chain renowned for affordable luxury — bold Vitra design, fast self check-in kiosks, and an API-first tech stack powered by Apaleo. citizenM Vienna is in the heart of the Austrian capital, close to Stephansdom and the Ringstrasse. Brand values: technology-first, bold design, affordable luxury, Apaleo PMS at the core. Operational language: English and German. Role titles: citizenM Ambassador (Gastgeber), Revenue Manager, Operations Director. Guests are called 'citizens'. VDA-MK governance covers the full Apaleo guest lifecycle: availability, rate override, reservation creation, check-in, folio charge, and checkout.",
  },
];

// ─── Agent Phase Progression — differentiated per hotel ───────────────────────
// Scratchpad canon: BER=3 (most advanced), LND=4 (mid), MUC=5 (two crawl),
//                   PAR=6 (blank slate), VIE=7 (run/walk/crawl progression).
// CANONICAL_ORDER: availability-agent, rate-agent, revenue-reconciliation-agent,
//   checkout-agent, folio-agent, check-in-agent, reservation-bot,
//   folio-charge-agent, onboarding-agent.
//
// agreementRate: numeric, null = not yet enough data to compute.
// This seed is idempotent — existing rows for a (company, agent) pair are NOT overwritten.

const PHASE_SEED: Record<string, Array<{ agentId: string; phase: string; agreementRate: string | null }>> = {
  BER: [
    { agentId: "availability-agent",            phase: "run",   agreementRate: "97" },
    { agentId: "rate-agent",                    phase: "run",   agreementRate: "95" },
    { agentId: "revenue-reconciliation-agent",  phase: "run",   agreementRate: "93" },
    { agentId: "checkout-agent",                phase: "run",   agreementRate: "96" },
    { agentId: "folio-agent",                   phase: "run",   agreementRate: "94" },
    { agentId: "check-in-agent",                phase: "run",   agreementRate: "95" },
    { agentId: "reservation-bot",               phase: "walk",  agreementRate: "91" },
    { agentId: "folio-charge-agent",            phase: "crawl", agreementRate: "83" },
    { agentId: "onboarding-agent",              phase: "crawl", agreementRate: "78" },
  ],
  LND: [
    { agentId: "availability-agent",            phase: "run",   agreementRate: "95" },
    { agentId: "rate-agent",                    phase: "walk",  agreementRate: "90" },
    { agentId: "revenue-reconciliation-agent",  phase: "walk",  agreementRate: "88" },
    { agentId: "checkout-agent",                phase: "crawl", agreementRate: "82" },
    { agentId: "folio-agent",                   phase: "crawl", agreementRate: "79" },
  ],
  MUC: [
    { agentId: "availability-agent",            phase: "crawl", agreementRate: "77" },
    { agentId: "rate-agent",                    phase: "crawl", agreementRate: "74" },
  ],
  PAR: [], // blank slate — no agents activated
  VIE: [
    { agentId: "availability-agent",            phase: "run",   agreementRate: "94" },
    { agentId: "rate-agent",                    phase: "run",   agreementRate: "92" },
    { agentId: "revenue-reconciliation-agent",  phase: "walk",  agreementRate: "89" },
    { agentId: "checkout-agent",                phase: "walk",  agreementRate: "87" },
    { agentId: "folio-agent",                   phase: "crawl", agreementRate: "81" },
    { agentId: "check-in-agent",                phase: "crawl", agreementRate: "76" },
  ],
};

// Marker written into YAML frontmatter by the C2MD enrichment pass.
// Used for idempotency — files that already contain this string are skipped.
const C2MD_MARKER = "c2md_generated: true";

/**
 * Calls Claude to enrich a static governance file with citizenM brand voice.
 * Uses the shared citizenM brandContext; hotel-specific companyName is injected
 * by the caller via a simple string replace after generation.
 */
async function generateC2MDContent(
  filename: string,
  staticContent: string,
  brandContext: string,
): Promise<string> {
  const brandSnippet = brandContext.slice(0, 1200);

  const system = `You are the C2MD (Compliance-to-Markdown) Translation Engine for citizenM, an Apaleo-powered hospitality brand.

BRAND CONTEXT:
${brandSnippet}

Rules:
- Use "citizen" (lowercase) instead of "guest", "customer", or "user"
- Use "citizenM Ambassador" instead of "staff" or "employee"
- Reference Apaleo API names explicitly (Rate Plan API, Reservations API, Folio API, Unit Management API, Availability API)
- Add exactly this line to the YAML frontmatter block: c2md_generated: true
- Keep all other existing YAML frontmatter fields intact
- Expand the MUST / MUST NOT / MAY rules with citizenM-specific operational context — add 2-4 more clauses where they add genuine value
- Add a "## citizenM Operational Notes" section at the end with 2-3 brand-specific observations about this agent's role in the Apaleo stack
- Output ONLY the enriched markdown — no preamble, no commentary, no code fences`;

  const user = `Enrich this governance file for citizenM's Apaleo-powered properties.

Keep the YAML frontmatter (add c2md_generated: true inside the frontmatter block), expand the MUST/MUST NOT/MAY rules with citizenM brand voice and Apaleo operational context, and add a citizenM Operational Notes section.

GOVERNANCE FILE (${filename}):
${staticContent}

Return ONLY the enriched markdown.`;

  return callAI({
    model: "claude-sonnet-4-6",
    max_tokens: 2500,
    system,
    messages: [{ role: "user", content: user }],
  });
}

function buildGovernanceFiles(companyId: number, companyName: string) {
  // VDA-MD file naming convention: Hospitality-[Domain]-[Stage]-[AgentName].[FileType].md
  // Each agent produces 3 files: AGENTS (charter), SOP (rules), SKILL (tools).
  // Plus one Finance Shared Services O2C file for cross-domain inheritance.
  const files = [

    // ──────────────────────────────────────────────────────────────────────────
    // RATE AGENT — Revenue · Book
    // ──────────────────────────────────────────────────────────────────────────
    {
      filename: "Hospitality-Revenue-Book-rate-agent.AGENTS.md",
      filepath: "governance/Hospitality-Revenue-Book-rate-agent.AGENTS.md",
      fileType: "AGENTS",
      axis: "vertical",
      stage: "book",
      journeyStage: "Book",
      owner: "Revenue Manager",
      domain: "Revenue Management",
      agentId: "rate-agent",
      normalisationLevel: 3,
      vendor: "VDA-MK for Apaleo",
      baseline: true,
      nistControl: "AC-2",
      content: `---
file_type: AGENTS
agent_id: rate-agent
industry: Hospitality
domain: Revenue Management
journey_stage_axis: Book
value_stream_axis: vertical
authored_by: Revenue Manager
consulted: Finance Director, Operations Director
informed: General Manager, VP Revenue, Head of Revenue
approved_by: General Manager
approved_date: 2026-03-01
expires: 2026-12-31
risk_level: HIGH
c2md_confidence: 0.94
nist_control: AC-2, AU-2
apaleo_api: Rate Plan API
vendor: VDA-MK for Apaleo
baseline: true
normalisation_level: 3
---

# Rate Agent — Agent Charter (AGENTS)

## Agent Identity

The Rate Agent is the sole autonomous authority for rate plan evaluation and override decisions at ${companyName}. It operates on the Book journey stage (vertical axis) under Revenue Management domain ownership.

## Scope of Authority

This agent governs all automated rate plan decisions via the Apaleo Rate Plan API. Autonomous authority is bounded by the Revenue Manager ceiling of 18% below BAR. Decisions outside this ceiling require human escalation.

## RACI

- **Responsible**: Rate Agent (autonomous execution)
- **Accountable**: Revenue Manager
- **Consulted**: Finance Director, Operations Director
- **Informed**: General Manager, VP Revenue, Head of Revenue

## Inheritance Hierarchy

This agent inherits governance from:
1. NIST SP 800-53 AC-2 — Account Management baseline
2. NIST SP 800-53 AU-2 — Event Logging baseline
3. ISO/IEC 42001 — AI Management System controls
4. EU AI Act — Consequential decision transparency requirements
5. ${companyName} Revenue Policy (see SOP file)

## Escalation Authority Matrix

| Condition | Escalation Target |
|-----------|------------------|
| Discount 10–18% below BAR | Revenue Manager |
| Discount >18% below BAR | VP Revenue |
| Account not Tier 1 in Apaleo | VP Revenue |
| Exception overlay disputed | Revenue Manager + Legal |

## Cross-Domain Inheritance

This agent is bounded to the vertical (Revenue) domain. It MUST NOT trigger payment transactions or post folio charges — those actions require O2C Finance cross-domain inheritance.
`,
    },
    {
      filename: "Hospitality-Revenue-Book-rate-agent.SOP.md",
      filepath: "governance/Hospitality-Revenue-Book-rate-agent.SOP.md",
      fileType: "SOP",
      axis: "vertical",
      stage: "book",
      journeyStage: "Book",
      owner: "Revenue Manager",
      domain: "Revenue Management",
      agentId: "rate-agent",
      normalisationLevel: 3,
      vendor: "VDA-MK for Apaleo",
      baseline: true,
      nistControl: "AC-2",
      content: `---
file_type: SOP
agent_id: rate-agent
industry: Hospitality
domain: Revenue Management
journey_stage_axis: Book
value_stream_axis: vertical
authored_by: Revenue Manager
consulted: Finance Director, Operations Director
informed: General Manager, VP Revenue
approved_by: General Manager
approved_date: 2026-03-01
expires: 2026-12-31
risk_level: HIGH
c2md_confidence: 0.94
nist_control: AC-2, AU-2
---

# Rate Agent — Standard Operating Procedure (SOP)

## Scope

This SOP governs all automated rate plan evaluation and override decisions at ${companyName} via the Apaleo Rate Plan API. This is the canonical policy file read by the Rate Agent at runtime.

## Mandatory Rules

MUST retrieve current rate plans from Apaleo via the Rate Plan API before evaluating any rate request — no rate decision may be made without live API data.
MUST compare the requested rate against the live Best Available Rate (BAR) and calculate the discount percentage before issuing any decision.
MUST verify account tier in Apaleo guest profile before applying any rate plan override.
MUST log every rate decision to the Witness Agent audit trail with the verbatim policy clause that governed it, before execution.
MUST NOT apply a discount below BAR without a valid active exception overlay on file.
MUST NOT process rate overrides that exceed the Revenue Manager authority ceiling of 18% below BAR.
MUST NOT apply the property floor rate as the BAR — the floor rate is a hard minimum, not a baseline.
MUST NOT process personal data beyond what is strictly necessary for the rate decision (GDPR Article 6).

## Discretionary Rules

MAY apply standard BAR rates without human approval for direct channel bookings.
MAY apply up to 5% early-bird discount automatically for bookings placed more than 30 days before arrival.
MAY surface promotional rate plans alongside the standard BAR when active offers exist in Apaleo.

## Rate Override Authority

MUST escalate to Revenue Manager when: discount request is between 10% and 18% below BAR.
MUST escalate to VP Revenue when: discount request exceeds 18% below BAR.
MUST escalate to VP Revenue when: account is not classified as Tier 1 in Apaleo.

## Exception Overlay Protocol

MAY apply the key-account rate exception overlay for verified Tier 1 accounts, permitting up to 18% discount at Revenue Manager authority.
MUST NOT apply exception overlay without confirmed account tier verification in Apaleo at the time of the decision.
MUST record exception_applied: true in the Witness Agent entry when an exception overlay governs the outcome.

## Compliance Baseline

Inherits: NIST SP 800-53 AC-2 (Account Management), AU-2 (Event Logging)
Frameworks: PCI DSS, GDPR/CCPA, ISO 22301, EU AI Act
GDPR: MUST NOT retain guest PII beyond the required retention window or beyond the scope of this rate decision.
PCI DSS 7.1: Read-only access to rate data — this agent MUST NOT access or log payment card data.
`,
    },
    {
      filename: "Hospitality-Revenue-Book-rate-agent.SKILL.md",
      filepath: "governance/Hospitality-Revenue-Book-rate-agent.SKILL.md",
      fileType: "SKILL",
      axis: "vertical",
      stage: "book",
      journeyStage: "Book",
      owner: "Revenue Manager",
      domain: "Revenue Management",
      agentId: "rate-agent",
      normalisationLevel: 3,
      vendor: "VDA-MK for Apaleo",
      baseline: true,
      nistControl: "AC-2",
      content: `---
file_type: SKILL
agent_id: rate-agent
industry: Hospitality
domain: Revenue Management
journey_stage_axis: Book
value_stream_axis: vertical
authored_by: Revenue Manager
consulted: Finance Director, Operations Director
informed: General Manager, VP Revenue, Head of Revenue
approved_by: General Manager
approved_date: 2026-03-01
expires: 2026-12-31
risk_level: HIGH
c2md_confidence: 0.96
nist_control: AC-2
---

# Rate Agent — Skill Manifest (SKILL)

## Permitted Apaleo MCP Tools

| Tool | OAuth Scope | Purpose |
|------|-------------|---------|
| ListRatePlans | rateplans.read-corporate, rates.read | Retrieve active rate plans and BAR for evaluation |
| GetReport | reports.read | Pull revenue benchmark data for rate comparison |

## Execution Rules

MUST call ListRatePlans before issuing any rate evaluation — no cached or assumed rate data.
MUST use GetReport to benchmark requested rates against live revenue data when available.
MUST NOT call any write-capable MCP tool — this agent is read-only.
MUST NOT invoke tools outside this manifest. Any tool not listed here is explicitly prohibited.

## Prohibited Tools

The following tools are explicitly NOT permitted for this agent:
- CreateBooking (write — Reservation Bot only)
- AmendReservation (write — Reservation Bot only)
- CheckIn / CheckOut (write — dedicated check-in/checkout agents only)
- GetFolio / ListFolios (folio data — Finance O2C domain, not Revenue domain)
- ListPaymentAccounts (payment data — requires Finance O2C cross-domain inheritance)
`,
    },

    // ──────────────────────────────────────────────────────────────────────────
    // CHECK-IN AGENT — Operations · Stay
    // ──────────────────────────────────────────────────────────────────────────
    {
      filename: "Hospitality-Operations-Stay-checkin-agent.AGENTS.md",
      filepath: "governance/Hospitality-Operations-Stay-checkin-agent.AGENTS.md",
      fileType: "AGENTS",
      axis: "vertical",
      stage: "checkin",
      journeyStage: "Stay",
      owner: "Front Office Manager",
      domain: "Check-In",
      agentId: "check-in-agent",
      normalisationLevel: 3,
      vendor: "VDA-MK for Apaleo",
      baseline: true,
      nistControl: "AC-2",
      content: `---
file_type: AGENTS
agent_id: check-in-agent
industry: Hospitality
domain: Check-In
journey_stage_axis: Stay
value_stream_axis: vertical
authored_by: Front Office Manager
consulted: Revenue Manager, CISO, Operations Director
informed: General Manager, Head of Security
approved_by: Operations Director
approved_date: 2026-03-01
expires: 2026-12-31
risk_level: HIGH
c2md_confidence: 0.96
nist_control: AC-2, AU-2
apaleo_api: Reservations API, Unit Management API
vendor: VDA-MK for Apaleo
baseline: true
normalisation_level: 3
---

# Check-In Agent — Agent Charter (AGENTS)

## Agent Identity

The Check-In Agent automates the digital check-in workflow for arriving guests at ${companyName}. It operates on the Stay journey stage (vertical axis) under Operations domain ownership.

## Scope of Authority

This agent governs all automated check-in actions via the Apaleo Reservations and Unit Management APIs. It has write authority limited to: reservation status updates (→ IN_HOUSE) and unit assignment. All other write actions require human escalation.

## RACI

- **Responsible**: Check-In Agent (autonomous execution)
- **Accountable**: Front Office Manager
- **Consulted**: Revenue Manager, CISO, Operations Director
- **Informed**: General Manager, Head of Security

## Inheritance Hierarchy

1. NIST SP 800-53 AC-2 — Account Management (identity verification gates)
2. NIST SP 800-53 AU-2 — Event Logging (full audit trail required)
3. ISO/IEC 42001 — AI Management System (human oversight for disputed check-ins)
4. GDPR Article 5 — Data minimisation during identity verification
5. PCI DSS — Payment verification before key issuance
6. EU AI Act — Consequential automated decision transparency

## Escalation Authority Matrix

| Condition | Escalation Target |
|-----------|------------------|
| Folio balance > €500 or open dispute | Front Office Manager |
| Guest identity cannot be verified | Front Office Manager |
| No available units of reserved type | Front Office Manager |
| Reservation status CANCELLED or NO_SHOW | Front Office Manager (do not check in) |
| Loyalty upgrade request, higher type unavailable | Revenue Manager |
`,
    },
    {
      filename: "Hospitality-Operations-Stay-checkin-agent.SOP.md",
      filepath: "governance/Hospitality-Operations-Stay-checkin-agent.SOP.md",
      fileType: "SOP",
      axis: "vertical",
      stage: "checkin",
      journeyStage: "Stay",
      owner: "Front Office Manager",
      domain: "Check-In",
      agentId: "check-in-agent",
      normalisationLevel: 3,
      vendor: "VDA-MK for Apaleo",
      baseline: true,
      nistControl: "AC-2",
      content: `---
file_type: SOP
agent_id: check-in-agent
industry: Hospitality
domain: Check-In
journey_stage_axis: Stay
value_stream_axis: vertical
authored_by: Front Office Manager
consulted: Revenue Manager, CISO, Operations Director
informed: General Manager, Head of Security
approved_by: Operations Director
approved_date: 2026-03-01
expires: 2026-12-31
risk_level: HIGH
c2md_confidence: 0.96
nist_control: AC-2, AU-2
---

# Check-In Agent — Standard Operating Procedure (SOP)

## Scope

This SOP governs all automated check-in decisions at ${companyName} via the Apaleo Reservations and Unit Management APIs. This is the canonical policy file read by the Check-In Agent at runtime.

## Mandatory Rules

MUST verify reservation status in Apaleo Reservations API before assigning any property unit — fabricated or assumed status is a FAIL.
MUST confirm folio balance is settled OR a valid payment method is on file in Apaleo before completing check-in.
MUST assign a unit using Apaleo Unit Management API, prioritising the reserved unit type.
MUST update Apaleo reservation status to IN_HOUSE upon successful check-in.
MUST log every check-in decision to the Witness Agent audit trail with the Apaleo reservation reference and verbatim governing clause.
MUST NOT check in a guest whose reservation status is CANCELLED or NO_SHOW in Apaleo.
MUST NOT override a unit assignment without a Front Office Manager supervisor authorisation.
MUST NOT process personal data beyond what is strictly necessary for identity verification (GDPR Article 5).
MUST NOT log raw card data during check-in at any point (PCI DSS).

## Loyalty Upgrade Rules

MAY apply a room-type upgrade for verified Gold or Platinum loyalty tier guests when an equivalent or higher unit type is available.
MUST confirm loyalty tier in Apaleo guest profile before applying any upgrade — loyalty tier assumption is prohibited.
MUST NOT apply upgrade if the higher unit type has zero remaining availability for the stay period.

## Escalation Conditions

MUST escalate to Front Office Manager when: reservation has a hold, open dispute, or folio balance > €500.
MUST escalate to Front Office Manager when: guest identity cannot be verified against Apaleo profile.
MUST escalate to Front Office Manager when: no units of the reserved type are available for assignment.
MUST NOT proceed with check-in if any escalation condition is unresolved.

## Compliance Baseline

Inherits: NIST SP 800-53 AC-2 (Account Management), AU-2 (Event Logging)
Frameworks: PCI DSS, GDPR/CCPA, ISO 22301, EU AI Act
GDPR: MUST NOT retain guest PII beyond the required legal retention window.
PCI DSS: MUST NOT log raw card data during check-in or in any audit log entry.
`,
    },
    {
      filename: "Hospitality-Operations-Stay-checkin-agent.SKILL.md",
      filepath: "governance/Hospitality-Operations-Stay-checkin-agent.SKILL.md",
      fileType: "SKILL",
      axis: "vertical",
      stage: "checkin",
      journeyStage: "Stay",
      owner: "Front Office Manager",
      domain: "Check-In",
      agentId: "check-in-agent",
      normalisationLevel: 3,
      vendor: "VDA-MK for Apaleo",
      baseline: true,
      nistControl: "AC-2",
      content: `---
file_type: SKILL
agent_id: check-in-agent
industry: Hospitality
domain: Check-In
journey_stage_axis: Stay
value_stream_axis: vertical
authored_by: Front Office Manager
consulted: Revenue Manager, CISO, Operations Director
informed: General Manager, Head of Security
approved_by: Operations Director
approved_date: 2026-03-01
expires: 2026-12-31
risk_level: HIGH
c2md_confidence: 0.97
nist_control: AC-2
---

# Check-In Agent — Skill Manifest (SKILL)

## Permitted Apaleo MCP Tools

| Tool | OAuth Scope | Purpose |
|------|-------------|---------|
| GetReservation | reservations.read | Verify reservation status before check-in |
| GetGuestProfile | profile:read | Confirm guest identity and loyalty tier |
| GetFolio | folios.read | Verify folio balance is settled |
| ListFolios | folios.read | List all folios linked to reservation |
| ListPaymentAccounts | payment:accounts.read | Confirm valid payment method on file |
| CheckIn | distribution:reservations.manage | Execute check-in and update status to IN_HOUSE |

## Execution Rules

MUST call GetReservation first — no check-in action may proceed without confirmed reservation status.
MUST call GetGuestProfile to verify identity and loyalty tier before executing CheckIn.
MUST call GetFolio or ListFolios to verify folio balance before executing CheckIn.
MUST use CheckIn to update reservation status — direct API status manipulation is prohibited.
MUST NOT call any tool not listed in this manifest.

## Prohibited Tools

- CreateBooking / AmendReservation — Reservation Bot only
- CheckOut — Checkout Agent only
- ListRatePlans / GetReport — Revenue domain tools, not permitted here
`,
    },

    // ──────────────────────────────────────────────────────────────────────────
    // CHECKOUT AGENT — Operations · Post-Stay
    // ──────────────────────────────────────────────────────────────────────────
    {
      filename: "Hospitality-Operations-Post-Stay-checkout-agent.AGENTS.md",
      filepath: "governance/Hospitality-Operations-Post-Stay-checkout-agent.AGENTS.md",
      fileType: "AGENTS",
      axis: "vertical",
      stage: "checkout",
      journeyStage: "Post-Stay",
      owner: "Front Office Manager",
      domain: "Checkout",
      agentId: "checkout-agent",
      normalisationLevel: 3,
      vendor: "VDA-MK for Apaleo",
      baseline: true,
      nistControl: "AU-2",
      content: `---
file_type: AGENTS
agent_id: checkout-agent
industry: Hospitality
domain: Checkout
journey_stage_axis: Post-Stay
value_stream_axis: O2C
authored_by: Front Office Manager
consulted: Finance Director, Operations Director
informed: General Manager, CFO, Credit Control
approved_by: Operations Director
approved_date: 2026-03-01
expires: 2026-12-31
risk_level: MEDIUM
c2md_confidence: 0.95
nist_control: AU-2, AC-2
apaleo_api: Reservations API, Folio API
vendor: VDA-MK for Apaleo
baseline: true
normalisation_level: 3
---

# Checkout Agent — Agent Charter (AGENTS)

## Agent Identity

The Checkout Agent governs the automated checkout workflow at ${companyName}. It operates on the Post-Stay journey stage with cross-domain presence in the O2C (Order-to-Cash) value stream.

## Scope of Authority

This agent governs automated checkout via the Apaleo Reservations and Folio APIs. Write authority: reservation status update (→ CHECKED_OUT) and folio finalisation. Late checkout fee waiver requires Finance O2C cross-domain authority for fees above €50.

## RACI

- **Responsible**: Checkout Agent (autonomous execution)
- **Accountable**: Front Office Manager
- **Consulted**: Finance Director, Operations Director
- **Informed**: General Manager, CFO, Credit Control

## Inheritance Hierarchy

1. NIST SP 800-53 AU-2 — Event Logging (full checkout audit required)
2. NIST SP 800-53 AC-2 — Account Management (access credential deactivation)
3. Finance Shared Services O2C — Folio settlement authority (cross-domain inheritance required for charges >€50)
4. ISO/IEC 42001 — Human oversight for disputed checkout decisions
5. GDPR — Data retention obligations post-checkout
6. EU AI Act — Consequential decision transparency

## Exception Overlay Files

This agent reads active EXCEPTION.md files in addition to this SOP. Exception overlays for loyalty tier benefits (e.g., late checkout fee waivers) are applied when all conditions in the EXCEPTION.md are satisfied.

## Escalation Authority Matrix

| Condition | Escalation Target |
|-----------|------------------|
| Open folio disputes | Operations Director |
| Folio settlement failure | Front Office Manager |
| Late checkout request beyond 14:00 | Front Office Manager |
| Fee waiver request >€50 | Finance Director |
`,
    },
    {
      filename: "Hospitality-Operations-Post-Stay-checkout-agent.SOP.md",
      filepath: "governance/Hospitality-Operations-Post-Stay-checkout-agent.SOP.md",
      fileType: "SOP",
      axis: "vertical",
      stage: "checkout",
      journeyStage: "Post-Stay",
      owner: "Front Office Manager",
      domain: "Checkout",
      agentId: "checkout-agent",
      normalisationLevel: 3,
      vendor: "VDA-MK for Apaleo",
      baseline: true,
      nistControl: "AU-2",
      content: `---
file_type: SOP
agent_id: checkout-agent
industry: Hospitality
domain: Checkout
journey_stage_axis: Post-Stay
value_stream_axis: O2C
authored_by: Front Office Manager
consulted: Finance Director, Operations Director
informed: General Manager, CFO
approved_by: Operations Director
approved_date: 2026-03-01
expires: 2026-12-31
risk_level: MEDIUM
c2md_confidence: 0.95
nist_control: AU-2, AC-2
---

# Checkout Agent — Standard Operating Procedure (SOP)

## Scope

This SOP governs all automated checkout decisions at ${companyName} via the Apaleo Reservations and Folio APIs. This is the canonical baseline policy file read by the Checkout Agent at runtime. Active EXCEPTION.md overlays are read in addition and take precedence where conditions are met.

## Mandatory Rules

MUST verify reservation status is IN_HOUSE in Apaleo Reservations API before initiating checkout.
MUST confirm all folio charges are settled or a valid payment method is on file before completing checkout.
MUST update Apaleo reservation status to CHECKED_OUT upon successful completion.
MUST log every checkout decision to the Witness Agent audit trail with the Apaleo reservation reference and verbatim governing clause.
MUST NOT process checkout if the folio has open disputes or unresolved charges in Apaleo.
MUST NOT check out a guest whose reservation shows CANCELLED or NO_SHOW status in Apaleo.
MUST NOT retain room access credentials in active state after CHECKED_OUT status is confirmed.
MUST NOT process personal data beyond what is strictly necessary for folio settlement (GDPR Article 6).

## Late Checkout Baseline Rules

MAY approve late checkout up to 12:00 without manager approval for Standard, Silver, and Gold loyalty tier guests.
MUST escalate late checkout requests beyond 14:00 to Front Office Manager — this is a hard gate.
MUST NOT waive the late checkout fee beyond 14:00 without Front Office Manager written approval.
MUST apply the standard late checkout fee (€30 per hour or part thereof) unless a valid EXCEPTION.md overlay is active.

## Post-Checkout Obligations

MUST trigger folio invoice dispatch to the confirmed billing address within 1 hour of checkout confirmation.
MUST reference the Apaleo Folio API data when generating the post-stay invoice — no manual invoice data.

## Compliance Baseline

Inherits: NIST SP 800-53 AU-2 (Event Logging), AC-2 (Account Management)
Frameworks: PCI DSS, GDPR/CCPA, ISO 22301, EU AI Act
PCI DSS: MUST NOT retain full payment card data in checkout records or audit logs.
GDPR: MUST NOT process guest PII beyond the legal retention period post-checkout.
`,
    },
    {
      filename: "Hospitality-Operations-Post-Stay-checkout-agent.SKILL.md",
      filepath: "governance/Hospitality-Operations-Post-Stay-checkout-agent.SKILL.md",
      fileType: "SKILL",
      axis: "vertical",
      stage: "checkout",
      journeyStage: "Post-Stay",
      owner: "Front Office Manager",
      domain: "Checkout",
      agentId: "checkout-agent",
      normalisationLevel: 3,
      vendor: "VDA-MK for Apaleo",
      baseline: true,
      nistControl: "AU-2",
      content: `---
file_type: SKILL
agent_id: checkout-agent
industry: Hospitality
domain: Checkout
journey_stage_axis: Post-Stay
value_stream_axis: O2C
authored_by: Front Office Manager
consulted: Finance Director, Operations Director
informed: General Manager, CFO, Credit Control
approved_by: Operations Director
approved_date: 2026-03-01
expires: 2026-12-31
risk_level: MEDIUM
c2md_confidence: 0.97
nist_control: AU-2
---

# Checkout Agent — Skill Manifest (SKILL)

## Permitted Apaleo MCP Tools

| Tool | OAuth Scope | Purpose |
|------|-------------|---------|
| GetReservation | reservations.read | Verify reservation is IN_HOUSE before checkout |
| GetFolio | folios.read | Verify folio balance is settled |
| ListFolios | folios.read | List all folios linked to reservation |
| ListPaymentAccounts | payment:accounts.read | Confirm payment method on file |
| CheckOut | distribution:reservations.manage | Execute checkout and update status to CHECKED_OUT |

## Execution Rules

MUST call GetReservation first to verify IN_HOUSE status — no checkout without live status confirmation.
MUST call GetFolio or ListFolios to confirm folio settlement before executing CheckOut.
MUST use CheckOut to update reservation status — no direct API manipulation.
MUST NOT call any tool not listed in this manifest.

## Prohibited Tools

- CheckIn — Check-In Agent only
- CreateBooking / AmendReservation — Reservation Bot only
- ListRatePlans / GetReport — Revenue domain tools, not permitted at checkout stage
`,
    },

    // ──────────────────────────────────────────────────────────────────────────
    // FOLIO CHARGE AGENT — Operations · Stay (horizontal: O2C Finance)
    // ──────────────────────────────────────────────────────────────────────────
    {
      filename: "Hospitality-Operations-Stay-folio-charge-agent.AGENTS.md",
      filepath: "governance/Hospitality-Operations-Stay-folio-charge-agent.AGENTS.md",
      fileType: "AGENTS",
      axis: "horizontal",
      stage: "stay",
      journeyStage: "Stay",
      owner: "Operations Director",
      domain: "Folio Management",
      agentId: "folio-charge-agent",
      normalisationLevel: 3,
      vendor: "VDA-MK for Apaleo",
      baseline: true,
      nistControl: "AU-2",
      content: `---
file_type: AGENTS
agent_id: folio-charge-agent
industry: Hospitality
domain: Folio Management
journey_stage_axis: Stay
value_stream_axis: O2C
authored_by: Operations Director
consulted: CFO, Finance Director, Front Office Manager
informed: General Manager, CISO, Credit Control
approved_by: CFO
approved_date: 2026-03-01
expires: 2026-12-31
risk_level: HIGH
c2md_confidence: 0.93
nist_control: AU-2, AC-2
apaleo_api: Folio API
vendor: VDA-MK for Apaleo
baseline: true
normalisation_level: 3
---

# Folio Charge Agent — Agent Charter (AGENTS)

## Agent Identity

The Folio Charge Agent governs all folio charge and settlement actions at ${companyName} via the Apaleo Folio API. This agent crosses from the Operations (Stay) vertical domain into the O2C (Order-to-Cash) horizontal Finance domain — cross-domain inheritance is mandatory before any charge execution.

## Scope of Authority

Write authority: post folio charges against confirmed reservations, trigger settlement for settled folios. This agent MUST NOT process refunds — all refunds route to a human Folio Agent. Any charge above €200 with a dispute requires Operations Director escalation.

## RACI

- **Responsible**: Folio Charge Agent (autonomous execution)
- **Accountable**: Operations Director
- **Consulted**: CFO, Finance Director, Front Office Manager
- **Informed**: General Manager, CISO, Credit Control

## Cross-Domain Inheritance (MANDATORY)

This agent crosses from Operations (Stay) into Finance (O2C). Before executing any folio charge, this agent MUST inherit authority from:
- \`Hospitality-Finance-Shared-O2C-folio-charge-authority.md\`

Without this inheritance check, all charge actions are prohibited.

## Inheritance Hierarchy

1. Finance Shared Services O2C — folio charge authority (cross-domain, mandatory)
2. NIST SP 800-53 AU-2 — Event Logging (all charge actions logged)
3. NIST SP 800-53 AC-2 — Account Management (reservation linkage required)
4. PCI DSS — Card data handling in folio records
5. GDPR — Guest financial data handling obligations

## Escalation Authority Matrix

| Condition | Escalation Target |
|-----------|------------------|
| Folio dispute or unresolved charge > €200 | Operations Director |
| Refund request | Human Folio Agent |
| Invoice unpaid > 30 days | Credit Control |
| Missing reservation ID | Operations Director |
`,
    },
    {
      filename: "Hospitality-Operations-Stay-folio-charge-agent.SOP.md",
      filepath: "governance/Hospitality-Operations-Stay-folio-charge-agent.SOP.md",
      fileType: "SOP",
      axis: "horizontal",
      stage: "stay",
      journeyStage: "Stay",
      owner: "Operations Director",
      domain: "Folio Management",
      agentId: "folio-charge-agent",
      normalisationLevel: 3,
      vendor: "VDA-MK for Apaleo",
      baseline: true,
      nistControl: "AU-2",
      content: `---
file_type: SOP
agent_id: folio-charge-agent
industry: Hospitality
domain: Folio Management
journey_stage_axis: Stay
value_stream_axis: O2C
authored_by: Operations Director
consulted: CFO, Finance Director, Front Office Manager
informed: General Manager, CISO
approved_by: CFO
approved_date: 2026-03-01
expires: 2026-12-31
risk_level: HIGH
c2md_confidence: 0.93
nist_control: AU-2, AC-2
cross_domain_inheritance: Hospitality-Finance-Shared-O2C-folio-charge-authority.md
---

# Folio Charge Agent — Standard Operating Procedure (SOP)

## Scope

This SOP governs all folio charge and settlement actions at ${companyName} via the Apaleo Folio API. Cross-domain inheritance from the Finance O2C shared services file is mandatory before charge execution.

## Cross-Domain Pre-Condition

MUST verify cross-domain inheritance from \`Hospitality-Finance-Shared-O2C-folio-charge-authority.md\` before executing any folio charge. This is a hard gate — no charge action may proceed without this inheritance check.

## Mandatory Rules

MUST NOT post folio charges without a matching, confirmed reservation ID in Apaleo Reservations API.
MUST NOT settle a folio where the reservation status is not IN_HOUSE or CHECKED_OUT in Apaleo.
MUST confirm folio balance is zero or a valid payment method is on file before triggering settlement.
MUST log every folio charge to the Witness Agent audit trail with the Apaleo folio reference and verbatim governing clause.
MUST NOT process refunds — route all refund requests immediately to a human Folio Agent.
MUST escalate folios with disputes or unresolved charges exceeding €200 to Operations Director before any further action.
MUST NOT process personal data beyond what is strictly necessary for folio settlement (GDPR Article 6).

## Late Checkout Fee

MAY waive the late checkout fee up to 14:00 for verified Gold or Platinum loyalty tier guests.
MUST confirm loyalty tier in Apaleo guest profile before applying any fee waiver.
MUST NOT waive late checkout fee beyond 14:00 without Front Office Manager written approval.

## Overdue Folio Escalation

MUST escalate folio invoices unpaid beyond 30-day payment terms to Credit Control.
MUST send a minimum of two automated payment reminders before escalation.

## Compliance Baseline

Inherits: Finance Shared Services O2C (cross-domain, mandatory), NIST SP 800-53 AU-2, AC-2
Frameworks: PCI DSS, GDPR/CCPA, ISO 22301, EU AI Act
PCI DSS: MUST NOT store raw card data in folio records, charge logs, or audit trail entries.
GDPR: MUST NOT process guest financial PII beyond the required legal retention window.
`,
    },
    {
      filename: "Hospitality-Operations-Stay-folio-charge-agent.SKILL.md",
      filepath: "governance/Hospitality-Operations-Stay-folio-charge-agent.SKILL.md",
      fileType: "SKILL",
      axis: "horizontal",
      stage: "stay",
      journeyStage: "Stay",
      owner: "Operations Director",
      domain: "Folio Management",
      agentId: "folio-charge-agent",
      normalisationLevel: 3,
      vendor: "VDA-MK for Apaleo",
      baseline: true,
      nistControl: "AU-2",
      content: `---
file_type: SKILL
agent_id: folio-charge-agent
industry: Hospitality
domain: Folio Management
journey_stage_axis: Stay
value_stream_axis: O2C
authored_by: Operations Director
consulted: CFO, Finance Director, Front Office Manager
informed: General Manager, CISO, Credit Control
approved_by: CFO
approved_date: 2026-03-01
expires: 2026-12-31
risk_level: HIGH
c2md_confidence: 0.95
nist_control: AU-2
---

# Folio Charge Agent — Skill Manifest (SKILL)

## Permitted Apaleo MCP Tools

| Tool | OAuth Scope | Purpose |
|------|-------------|---------|
| GetFolio | folios.read | Retrieve folio details and current balance |
| ListFolios | folios.read | List all folios for a reservation |
| GetReservation | reservations.read | Verify reservation status before charge |
| ListPaymentAccounts | payment:accounts.read | Confirm payment method on file |

## Execution Rules

MUST call GetReservation to verify reservation status before any folio action.
MUST call GetFolio or ListFolios to retrieve current folio state before posting charges.
MUST NOT call any write tool — this agent has read-only MCP access. Charge posting uses the Apaleo REST Folio API directly, governed by the Finance O2C shared services authority.
MUST NOT call any tool not listed in this manifest.

## Prohibited Tools

- CheckIn / CheckOut — dedicated agents only
- CreateBooking / AmendReservation — Reservation Bot only
- ListRatePlans / GetReport — Revenue domain, not permitted for folio operations
`,
    },

    // ──────────────────────────────────────────────────────────────────────────
    // FOLIO AGENT (READ-ONLY) — Operations · Stay
    // Read-only folio analysis; distinct identity from folio-charge-agent
    // ──────────────────────────────────────────────────────────────────────────
    {
      filename: "Hospitality-Operations-Stay-folio-agent.AGENTS.md",
      filepath: "governance/Hospitality-Operations-Stay-folio-agent.AGENTS.md",
      fileType: "AGENTS",
      axis: "horizontal",
      stage: "stay",
      journeyStage: "Stay",
      owner: "Operations Director",
      domain: "Folio Management",
      agentId: "folio-agent",
      normalisationLevel: 3,
      vendor: "VDA-MK for Apaleo",
      baseline: true,
      nistControl: "AU-2",
      content: `---
file_type: AGENTS
agent_id: folio-agent
industry: Hospitality
domain: Folio Management
journey_stage_axis: Stay
value_stream_axis: O2C
authored_by: Operations Director
consulted: CFO, Finance Director, Front Office Manager
informed: General Manager, CISO
approved_by: CFO
approved_date: 2026-03-01
expires: 2026-12-31
risk_level: MEDIUM
c2md_confidence: 0.93
nist_control: AU-2, AC-2
apaleo_api: Folio API
vendor: VDA-MK for Apaleo
baseline: true
normalisation_level: 3
property_code: ${companyId}
property_name: ${companyName}
---

# Folio Agent — Agent Charter (AGENTS)

## Agent Identity

The Folio Agent provides read-only folio analysis at ${companyName} via the Apaleo Folio API. This agent retrieves and analyses folio data but does NOT post charges or trigger settlement — those actions are reserved for the Folio Charge Agent.

## Scope of Authority

Read-only: retrieve folio details, list folios for a reservation, verify folio balance and payment method status. This agent MUST NOT use any write tools.

## RACI

- **Responsible**: Folio Agent (read-only analysis)
- **Accountable**: Operations Director
- **Consulted**: Finance Director, Front Office Manager
- **Informed**: General Manager

## Escalation Authority Matrix

| Condition | Escalation Target |
|-----------|------------------|
| Folio dispute or unresolved charge | Operations Director |
| Write action required | Route to Folio Charge Agent |
`,
    },
    {
      filename: "Hospitality-Operations-Stay-folio-agent.SKILL.md",
      filepath: "governance/Hospitality-Operations-Stay-folio-agent.SKILL.md",
      fileType: "SKILL",
      axis: "horizontal",
      stage: "stay",
      journeyStage: "Stay",
      owner: "Operations Director",
      domain: "Folio Management",
      agentId: "folio-agent",
      normalisationLevel: 3,
      vendor: "VDA-MK for Apaleo",
      baseline: true,
      nistControl: "AU-2",
      content: `---
file_type: SKILL
agent_id: folio-agent
industry: Hospitality
domain: Folio Management
journey_stage_axis: Stay
value_stream_axis: O2C
authored_by: Operations Director
consulted: CFO, Finance Director, Front Office Manager
informed: General Manager, CISO
approved_by: CFO
approved_date: 2026-03-01
expires: 2026-12-31
risk_level: MEDIUM
c2md_confidence: 0.95
nist_control: AU-2
property_code: ${companyId}
property_name: ${companyName}
---

# Folio Agent — Skill Manifest (SKILL)

## Permitted Apaleo MCP Tools

| Tool | OAuth Scope | Purpose |
|------|-------------|---------|
| GetFolio | folios.read | Retrieve folio details and current balance |
| ListFolios | folios.read | List all folios for a reservation |
| GetReservation | reservations.read | Verify reservation status |

## Execution Rules

MUST call GetReservation to verify reservation status before any folio retrieval.
MUST call GetFolio or ListFolios to retrieve current folio state.
MUST NOT call any write tool — this agent has read-only MCP access.
MUST NOT call any tool not listed in this manifest.

## Prohibited Tools

- CreateFolioCharge — Folio Charge Agent only
- CheckIn / CheckOut — dedicated agents only
- CreateBooking / AmendReservation — Reservation Bot only
`,
    },

    // ──────────────────────────────────────────────────────────────────────────
    // AVAILABILITY AGENT — Revenue · Pre-Book
    // ──────────────────────────────────────────────────────────────────────────
    {
      filename: "Hospitality-Revenue-Pre-Book-availability-agent.AGENTS.md",
      filepath: "governance/Hospitality-Revenue-Pre-Book-availability-agent.AGENTS.md",
      fileType: "AGENTS",
      axis: "vertical",
      stage: "prebook",
      journeyStage: "Pre-Book",
      owner: "Revenue Manager",
      domain: "Availability & Inventory",
      agentId: "availability-agent",
      normalisationLevel: 3,
      vendor: "VDA-MK for Apaleo",
      baseline: true,
      nistControl: "AC-2",
      content: `---
file_type: AGENTS
agent_id: availability-agent
industry: Hospitality
domain: Availability & Inventory
journey_stage_axis: Pre-Book
value_stream_axis: vertical
authored_by: Revenue Manager
consulted: Operations Director, Head of Revenue
informed: General Manager, Front Office Manager, Finance Director
approved_by: General Manager
approved_date: 2026-03-01
expires: 2026-12-31
risk_level: MEDIUM
c2md_confidence: 0.95
nist_control: AC-2, AU-2
apaleo_api: Availability API, Rate Plan API
vendor: VDA-MK for Apaleo
baseline: true
normalisation_level: 3
---

# Availability Agent — Agent Charter (AGENTS)

## Agent Identity

The Availability Agent governs real-time inventory and availability decisions at ${companyName}. It operates on the Pre-Book journey stage (vertical axis) under Revenue Management domain ownership.

## Scope of Authority

Read-only authority against the Apaleo Availability and Rate Plan APIs. This agent surfaces availability data and rate context — it MUST NOT confirm reservations or commit inventory. Reservation commitment is the Reservation Bot's scope.

## RACI

- **Responsible**: Availability Agent (autonomous read-only execution)
- **Accountable**: Revenue Manager
- **Consulted**: Operations Director, Head of Revenue
- **Informed**: General Manager, Front Office Manager, Finance Director

## Inheritance Hierarchy

1. NIST SP 800-53 AC-2 — Account Management (read-only scope enforcement)
2. NIST SP 800-53 AU-2 — Event Logging (all availability decisions logged)
3. ISO 22301 — Business continuity (inventory threshold management)

## Escalation Authority Matrix

| Condition | Escalation Target |
|-----------|------------------|
| Inventory below minimum threshold | Revenue Manager |
| Group booking hold requested | Revenue Manager |
| Zero availability across all unit types | Revenue Manager + Operations Director |
`,
    },
    {
      filename: "Hospitality-Revenue-Pre-Book-availability-agent.SOP.md",
      filepath: "governance/Hospitality-Revenue-Pre-Book-availability-agent.SOP.md",
      fileType: "SOP",
      axis: "vertical",
      stage: "prebook",
      journeyStage: "Pre-Book",
      owner: "Revenue Manager",
      domain: "Availability & Inventory",
      agentId: "availability-agent",
      normalisationLevel: 3,
      vendor: "VDA-MK for Apaleo",
      baseline: true,
      nistControl: "AC-2",
      content: `---
file_type: SOP
agent_id: availability-agent
industry: Hospitality
domain: Availability & Inventory
journey_stage_axis: Pre-Book
value_stream_axis: vertical
authored_by: Revenue Manager
consulted: Operations Director, Head of Revenue
informed: General Manager, Front Office Manager
approved_by: General Manager
approved_date: 2026-03-01
expires: 2026-12-31
risk_level: MEDIUM
c2md_confidence: 0.95
nist_control: AC-2, AU-2
---

# Availability Agent — Standard Operating Procedure (SOP)

## Scope

This SOP governs all real-time inventory and availability decisions at ${companyName} via the Apaleo Availability and Rate Plan APIs. This is the canonical policy file read by the Availability Agent at runtime.

## Mandatory Rules

MUST query Apaleo Availability API for live unit inventory before confirming any availability response — fabricated or cached data is a FAIL.
MUST NOT confirm a reservation or commit inventory — availability surfacing only, not reservation commitment.
MUST log every availability decision to the Witness Agent audit trail before returning results.
MUST NOT alter inventory blocks or holds without Revenue Manager written approval.
MUST NOT process personal data beyond what is required for the availability query (GDPR Article 6).

## Discretionary Rules

MAY apply standard availability rules without human approval for direct channel queries.
MAY hold inventory for group bookings up to 24 hours pending confirmed deposit.
MAY surface active promotional rate plans alongside standard BAR when available in Apaleo.
MAY suggest alternative date ranges when availability is low (below 10% of unit count for the requested unit type).

## Inventory Management

MUST NOT release a group booking hold without confirmed deposit or signed group agreement.
MUST escalate to Revenue Manager when inventory for any unit type drops below the defined minimum availability threshold.
MAY apply the overbooking policy up to the percentage approved by Revenue Manager.

## Compliance Baseline

Inherits: NIST SP 800-53 AC-2 (Account Management), AU-2 (Event Logging)
Frameworks: PCI DSS, GDPR/CCPA, ISO 22301
`,
    },
    {
      filename: "Hospitality-Revenue-Pre-Book-availability-agent.SKILL.md",
      filepath: "governance/Hospitality-Revenue-Pre-Book-availability-agent.SKILL.md",
      fileType: "SKILL",
      axis: "vertical",
      stage: "prebook",
      journeyStage: "Pre-Book",
      owner: "Revenue Manager",
      domain: "Availability & Inventory",
      agentId: "availability-agent",
      normalisationLevel: 3,
      vendor: "VDA-MK for Apaleo",
      baseline: true,
      nistControl: "AC-2",
      content: `---
file_type: SKILL
agent_id: availability-agent
industry: Hospitality
domain: Availability & Inventory
journey_stage_axis: Pre-Book
value_stream_axis: vertical
authored_by: Revenue Manager
consulted: Operations Director, Head of Revenue
informed: General Manager, Front Office Manager, Finance Director
approved_by: General Manager
approved_date: 2026-03-01
expires: 2026-12-31
risk_level: MEDIUM
c2md_confidence: 0.97
nist_control: AC-2
---

# Availability Agent — Skill Manifest (SKILL)

## Permitted Apaleo MCP Tools

| Tool | OAuth Scope | Purpose |
|------|-------------|---------|
| GetAvailableUnitGroups | availability.read | Query live unit inventory for date ranges |
| ListRatePlans | rateplans.read-corporate, rates.read | Surface active rate plans alongside availability |

## Execution Rules

MUST call GetAvailableUnitGroups for every availability query — no estimated or cached inventory responses.
MUST call ListRatePlans to surface rate context alongside availability data.
MUST NOT call any write-capable tool — this agent is strictly read-only.
MUST NOT call any tool not listed in this manifest.

## Prohibited Tools

- CreateBooking / AmendReservation — Reservation Bot only (booking commitment is not this agent's scope)
- CheckIn / CheckOut — dedicated check-in and checkout agents only
- GetFolio / ListFolios — Finance O2C domain, not permitted at Pre-Book stage
- ListPaymentAccounts — payment data, not required for availability decisions
`,
    },

    // ──────────────────────────────────────────────────────────────────────────
    // RESERVATION BOT — Revenue · Book
    // ──────────────────────────────────────────────────────────────────────────
    {
      filename: "Hospitality-Revenue-Book-reservation-bot.AGENTS.md",
      filepath: "governance/Hospitality-Revenue-Book-reservation-bot.AGENTS.md",
      fileType: "AGENTS",
      axis: "vertical",
      stage: "book",
      journeyStage: "Book",
      owner: "Revenue Manager",
      domain: "Reservations",
      agentId: "reservation-bot",
      normalisationLevel: 3,
      vendor: "VDA-MK for Apaleo",
      baseline: true,
      nistControl: "AC-2",
      content: `---
file_type: AGENTS
agent_id: reservation-bot
industry: Hospitality
domain: Reservations
journey_stage_axis: Book
value_stream_axis: vertical
authored_by: Revenue Manager
consulted: Operations Director, Finance Director, CISO
informed: General Manager, Head of Revenue, VP Revenue
approved_by: General Manager
approved_date: 2026-03-01
expires: 2026-12-31
risk_level: HIGH
c2md_confidence: 0.95
nist_control: AC-2, AU-2
apaleo_api: Reservations API, Rate Plan API, Availability API
vendor: VDA-MK for Apaleo
baseline: true
normalisation_level: 3
---

# Reservation Bot — Agent Charter (AGENTS)

## Agent Identity

The Reservation Bot automates new reservation creation at ${companyName} via the Apaleo Reservations, Rate Plan, and Availability APIs. It is the only agent authorised to create booking records in Apaleo.

## Scope of Authority

Write authority: CreateBooking and AmendReservation. All bookings must pass pre-conditions: confirmed availability, active rate plan, and validated guest identity. The bot MUST NOT bypass rate plan restrictions or create duplicate bookings without explicit confirmation.

## RACI

- **Responsible**: Reservation Bot (autonomous execution)
- **Accountable**: Revenue Manager
- **Consulted**: Operations Director, Finance Director, CISO
- **Informed**: General Manager, Head of Revenue, VP Revenue

## Inheritance Hierarchy

1. NIST SP 800-53 AC-2 — Account Management (booking authority controls)
2. NIST SP 800-53 AU-2 — Event Logging (all bookings logged before commitment)
3. GDPR Article 6 — Legal basis for guest PII processing at booking
4. PCI DSS — Payment account handling during booking creation
5. ISO 22301 — Booking continuity and API fallback

## Escalation Authority Matrix

| Condition | Escalation Target |
|-----------|------------------|
| Duplicate reservation detected | Revenue Manager |
| Rate plan restriction override | Revenue Manager |
| Unauthorised booking channel | Revenue Manager |
| Guest identity cannot be validated | Front Office Manager |
`,
    },
    {
      filename: "Hospitality-Revenue-Book-reservation-bot.SOP.md",
      filepath: "governance/Hospitality-Revenue-Book-reservation-bot.SOP.md",
      fileType: "SOP",
      axis: "vertical",
      stage: "book",
      journeyStage: "Book",
      owner: "Revenue Manager",
      domain: "Reservations",
      agentId: "reservation-bot",
      normalisationLevel: 3,
      vendor: "VDA-MK for Apaleo",
      baseline: true,
      nistControl: "AC-2",
      content: `---
file_type: SOP
agent_id: reservation-bot
industry: Hospitality
domain: Reservations
journey_stage_axis: Book
value_stream_axis: vertical
authored_by: Revenue Manager
consulted: Operations Director, Finance Director, CISO
informed: General Manager, Head of Revenue
approved_by: General Manager
approved_date: 2026-03-01
expires: 2026-12-31
risk_level: HIGH
c2md_confidence: 0.95
nist_control: AC-2, AU-2
---

# Reservation Bot — Standard Operating Procedure (SOP)

## Scope

This SOP governs all automated reservation creation at ${companyName} via the Apaleo Reservations, Rate Plan, and Availability APIs. This is the canonical policy file read by the Reservation Bot at runtime.

## Mandatory Rules

MUST verify unit type availability via Apaleo Availability API before creating or committing any reservation.
MUST verify the requested rate plan exists and is active in Apaleo Rate Plan API before booking.
MUST log every reservation creation attempt to the Witness Agent audit trail — including failures — with verbatim governing clause, before commitment.
MUST NOT create a reservation for a unit type with zero availability in Apaleo.
MUST NOT apply a rate plan that is expired, suspended, or not active in Apaleo.
MUST NOT override rate plan restrictions (minimum stay, closed to arrival, closed to departure) without Revenue Manager written approval.
MUST NOT create a duplicate reservation for the same guest, dates, and unit type without explicit confirmation.
MUST NOT process guest PII beyond what is strictly necessary for the reservation creation (GDPR Article 6).

## Guest Validation

MUST collect and validate guest name, email address, and arrival/departure dates before submitting any reservation.
MUST verify guest identity is not flagged in Apaleo guest profile before creating a booking.
MAY auto-apply the loyalty rate for verified loyalty programme members when a loyalty rate plan is active.

## Channel Policy

MUST stamp the booking source channel on each reservation in Apaleo at the time of creation.
MUST NOT create reservations via channels not explicitly authorised by the Revenue Manager.

## Compliance Baseline

Inherits: NIST SP 800-53 AC-2 (Account Management), AU-2 (Event Logging)
Frameworks: PCI DSS, GDPR/CCPA, ISO 22301, EU AI Act
GDPR: MUST NOT store guest PII beyond the required legal retention window.
PCI DSS: MUST NOT log raw payment card data during reservation creation.
`,
    },
    {
      filename: "Hospitality-Revenue-Book-reservation-bot.SKILL.md",
      filepath: "governance/Hospitality-Revenue-Book-reservation-bot.SKILL.md",
      fileType: "SKILL",
      axis: "vertical",
      stage: "book",
      journeyStage: "Book",
      owner: "Revenue Manager",
      domain: "Reservations",
      agentId: "reservation-bot",
      normalisationLevel: 3,
      vendor: "VDA-MK for Apaleo",
      baseline: true,
      nistControl: "AC-2",
      content: `---
file_type: SKILL
agent_id: reservation-bot
industry: Hospitality
domain: Reservations
journey_stage_axis: Book
value_stream_axis: vertical
authored_by: Revenue Manager
consulted: Operations Director, Finance Director, CISO
informed: General Manager, Head of Revenue, VP Revenue
approved_by: General Manager
approved_date: 2026-03-01
expires: 2026-12-31
risk_level: HIGH
c2md_confidence: 0.96
nist_control: AC-2
---

# Reservation Bot — Skill Manifest (SKILL)

## Permitted Apaleo MCP Tools

| Tool | OAuth Scope | Purpose |
|------|-------------|---------|
| GetAvailableUnitGroups | availability.read | Verify unit availability before booking |
| ListRatePlans | rateplans.read-corporate, rates.read | Verify rate plan exists and is active |
| GetReservation | reservations.read | Check for existing reservations (duplicate prevention) |
| GetGuestProfile | profile:read | Validate guest identity before booking |
| CreateBooking | distribution:reservations.manage | Create the reservation in Apaleo |
| AmendReservation | distribution:reservations.manage | Modify an existing reservation |

## Execution Rules

MUST call GetAvailableUnitGroups before CreateBooking — availability confirmation is mandatory.
MUST call ListRatePlans to confirm rate plan is active before using it in CreateBooking.
MUST call GetGuestProfile to validate guest identity before committing a reservation.
MUST NOT call CheckIn or CheckOut — those are scoped to dedicated agents.
MUST NOT call any tool not listed in this manifest.

## Prohibited Tools

- CheckIn / CheckOut — dedicated agents only
- GetFolio / ListFolios — Finance O2C domain, not a booking-stage tool
- ListPaymentAccounts — payment data not required at booking stage
- GetReport — Revenue reconciliation scope, not booking scope
`,
    },

    // ──────────────────────────────────────────────────────────────────────────
    // REVENUE RECONCILIATION AGENT — Finance · Reconciliation
    // ──────────────────────────────────────────────────────────────────────────
    {
      filename: "Hospitality-Finance-Reconciliation-RevenueReconciliation.AGENTS.md",
      filepath: "governance/Hospitality-Finance-Reconciliation-RevenueReconciliation.AGENTS.md",
      fileType: "AGENTS",
      axis: "horizontal",
      stage: "reconciliation",
      journeyStage: "Reconciliation",
      owner: "CFO",
      domain: "Finance",
      agentId: "revenue-reconciliation-agent",
      normalisationLevel: 3,
      vendor: "VDA-MK for Apaleo",
      baseline: true,
      nistControl: "AU-2",
      content: `---
file_type: AGENTS
agent_id: revenue-reconciliation-agent
industry: Hospitality
domain: Finance
journey_stage_axis: Reconciliation
value_stream_axis: horizontal
authored_by: CFO
consulted: Finance Director, Revenue Manager, Head of Revenue
informed: General Manager, VP Revenue, CISO
approved_by: CFO
approved_date: 2026-03-01
expires: 2026-12-31
risk_level: HIGH
c2md_confidence: 0.93
nist_control: AU-2, AC-2
apaleo_api: Reports API, Rate Plan API, Folio API, Invoices API
---

# Revenue Reconciliation Agent — Charter (AGENTS)

## Purpose

Performs daily revenue reconciliation by comparing actual revenue data from the Apaleo Reports API against rate plan expectations per unit group, flagging variances to the appropriate financial authority. This is a strictly read-only, cross-domain, horizontal agent.

## RACI

| Role | Assignment |
|------|-----------|
| Responsible | Revenue Reconciliation Agent |
| Accountable | CFO / Revenue Director |
| Consulted | Finance Director, Revenue Manager |
| Informed | General Manager, Head of Revenue, CISO |

## Agent Scope

- **Domain**: Finance — reconciliation and variance reporting only
- **Axis**: Horizontal — cross-property, cross-period analysis
- **Write authority**: NONE — this agent has zero write scopes
- **Escalation authority**: Revenue Manager (variance 5–15%), Finance Director (variance >15%), CFO (unmatched folios)

## Responsibilities

The agent MUST pull live revenue report data via the Apaleo Reports API (reports.read scope) for the specified property and date before performing any reconciliation.
The agent MUST retrieve current rate plan expectations via the Rate Plan API (ListRatePlans) and cross-reference each reservation's actual rate against its contracted rate plan.
The agent MUST cross-reference folio records via the Folio API (ListFolios) and invoice data via the Invoices API (ListInvoices) to identify unmatched folios.
The agent MUST compare actual vs expected revenue and calculate the variance percentage for each unit group.
The agent MUST log a full reconciliation summary to the Witness Agent including variance percentage, discrepancy types, and all flagged reservation IDs (NIST AU-2).
The agent MUST NOT modify any financial records — this is a strictly read-only agent with no write scopes.
The agent MUST NOT issue reconciliation decisions based on cached or estimated data — live Apaleo API data is mandatory for every run.
The agent MAY pass reconciliation with variance ≤5% as normal operational variance.
The agent MAY summarise discrepancy patterns to aid Revenue Manager review.

## Escalation Path

- Variance 5–15%: Revenue Manager
- Variance >15%: Finance Director (immediate notification)
- Unmatched folios: CFO / Finance audit
- System unavailable: Operations Director

## Compliance Baseline

- NIST AC-2: Strictly read-only — scopes reports.read, rates.read, rateplans.read-corporate, folios.read, invoices.read, accounting.read; no write access
- NIST AU-2: Full reconciliation log written to Witness Agent on every run including variance %, discrepancy flags, and all affected reservation IDs
- PCI DSS 10.2: Audit trail covers all reconciliation decisions and variance flags
- ISO 22301: Daily reconciliation maintained via REST if MCP unavailable
`,
    },
    {
      filename: "Hospitality-Finance-Reconciliation-RevenueReconciliation.SOP.md",
      filepath: "governance/Hospitality-Finance-Reconciliation-RevenueReconciliation.SOP.md",
      fileType: "SOP",
      axis: "horizontal",
      stage: "reconciliation",
      journeyStage: "Reconciliation",
      owner: "CFO",
      domain: "Finance",
      agentId: "revenue-reconciliation-agent",
      normalisationLevel: 3,
      vendor: "VDA-MK for Apaleo",
      baseline: true,
      nistControl: "AU-2",
      content: `---
file_type: SOP
agent_id: revenue-reconciliation-agent
industry: Hospitality
domain: Finance
journey_stage_axis: Reconciliation
value_stream_axis: horizontal
authored_by: CFO
consulted: Finance Director, Revenue Manager
informed: General Manager, VP Revenue
approved_by: CFO
approved_date: 2026-03-01
expires: 2026-12-31
risk_level: HIGH
c2md_confidence: 0.93
nist_control: AU-2
---

# Revenue Reconciliation Agent — Standard Operating Procedure (SOP)

## Reconciliation Gate (ALL steps mandatory before any decision)

1. Pull live revenue report from Apaleo Reports API (reports.read) for the target property and date
2. Retrieve all active rate plans via ListRatePlans (rateplans.read-corporate, rates.read)
3. Retrieve folio records via ListFolios (folios.read) and cross-reference against reservation IDs
4. Retrieve invoice data via ListInvoices (invoices.read) to validate charge records
5. Calculate actual vs expected variance per unit group
6. Write full reconciliation summary to the Witness Agent (NIST AU-2)

## Mandatory MUST Rules

The agent MUST call GetReport before making any variance calculation — estimated data is a policy violation.
The agent MUST call ListRatePlans to retrieve the current contracted rate for each unit group before calculating variance.
The agent MUST cross-reference ListFolios output against reservation IDs — any folio with no linked reservation MUST be flagged for CFO audit.
The agent MUST write a complete reconciliation summary to the Witness Agent including variance %, date, property ID, rate plan count, and any flagged items.
The agent MUST NOT modify, post, or delete any financial record — all write operations are outside this agent's scope.
The agent MUST NOT make a reconciliation decision based on data older than the current run — cached or stale data is a FAIL.

## Variance Threshold Decision Matrix

| Variance | Decision | Action |
|----------|----------|--------|
| ≤5% | PASS | Log summary to Witness Agent; no escalation |
| 5–15% | ESCALATE | Route to Revenue Manager for review |
| >15% | ESCALATE | Immediate Finance Director notification |
| Unmatched folios | ESCALATE | CFO / Finance audit required |
| Overbilling vs rate plan | ESCALATE | Flag reservation IDs immediately |
| Underpayment vs contracted rate | ESCALATE | Flag with reservation ID |

## Discrepancy Classification

- **Underpayment**: Actual rate < contracted rate plan rate — flag with reservation ID
- **Overbilling**: Charge exceeds rate plan cap — flag immediately
- **Unmatched folio**: Folio exists with no linked reservation — CFO audit required
- **Data unavailable**: Apaleo API returns no data — ESCALATE to Operations Director

## Witness Agent Requirement

MUST record clauseApplied as the exact verbatim rule from this SOP that governed the decision.
MUST record the variance percentage, discrepancy count, and property ID in the Witness Agent entry.
MUST record fileReferenced as this SOP filename.
`,
    },
    {
      filename: "Hospitality-Finance-Reconciliation-RevenueReconciliation.SKILL.md",
      filepath: "governance/Hospitality-Finance-Reconciliation-RevenueReconciliation.SKILL.md",
      fileType: "SKILL",
      axis: "horizontal",
      stage: "reconciliation",
      journeyStage: "Reconciliation",
      owner: "CFO",
      domain: "Finance",
      agentId: "revenue-reconciliation-agent",
      normalisationLevel: 3,
      vendor: "VDA-MK for Apaleo",
      baseline: true,
      nistControl: "AU-2",
      content: `---
file_type: SKILL
agent_id: revenue-reconciliation-agent
industry: Hospitality
domain: Finance
journey_stage_axis: Reconciliation
value_stream_axis: horizontal
authored_by: CFO
consulted: Finance Director, Revenue Manager, CISO
informed: General Manager, Head of Revenue
approved_by: CFO
approved_date: 2026-03-01
expires: 2026-12-31
risk_level: HIGH
c2md_confidence: 0.93
nist_control: AU-2
---

# Revenue Reconciliation Agent — Skill Manifest (SKILL)

## Permitted Apaleo MCP Tools

| Tool | OAuth Scope | Purpose |
|------|-------------|---------|
| GetReport | reports.read | Pull live revenue report data for reconciliation |
| ListRatePlans | rateplans.read-corporate, rates.read | Retrieve contracted rate plan expectations |
| ListFolios | folios.read | Identify unmatched folios (no linked reservation) |
| ListInvoices | invoices.read | Cross-reference charge records against folios |

## Execution Rules

MUST call GetReport before any variance calculation — fabricated or estimated data is a policy violation.
MUST call ListRatePlans to verify current rate plan expectations before comparing against actual revenue.
MUST call ListFolios to identify all folios for the target property and date range.
MUST call ListInvoices to cross-reference charge records before issuing any discrepancy flag.
MUST NOT call any write tool — CreateFolioCharge, CheckIn, CheckOut, CreateBooking, or any tool with a write scope is prohibited.
MUST NOT call any tool not listed in this manifest.

## Prohibited Tools

- CreateFolioCharge — write scope, prohibited for read-only reconciliation agent
- CheckIn / CheckOut — operations domain, not finance reconciliation scope
- CreateBooking / AmendReservation — reservations domain, outside scope
- ListPaymentAccounts — payment data not required for reconciliation
- GetAvailableUnitGroups — availability domain, not reconciliation scope

## Read-Only Enforcement

This agent operates with zero write scopes. Any attempt to call a write tool MUST be treated as a policy violation and immediately logged to the Witness Agent as FAIL with escalation to the CFO.
`,
    },

    // ──────────────────────────────────────────────────────────────────────────
    // FINANCE SHARED SERVICES — O2C Cross-Domain Authority
    // ──────────────────────────────────────────────────────────────────────────
    {
      filename: "Hospitality-Finance-Shared-O2C-folio-charge-authority.md",
      filepath: "governance/Hospitality-Finance-Shared-O2C-folio-charge-authority.md",
      fileType: "SHARED_SERVICES",
      axis: "horizontal",
      stage: "shared",
      journeyStage: "Shared",
      owner: "CFO",
      domain: "Finance O2C",
      agentId: "finance-o2c-shared",
      normalisationLevel: 3,
      vendor: "VDA-MK for Apaleo",
      baseline: true,
      nistControl: "AU-2",
      content: `---
file_type: SHARED_SERVICES
agent_id: finance-o2c-shared
industry: Hospitality
domain: Finance O2C
journey_stage_axis: Shared
value_stream_axis: O2C
authored_by: CFO
consulted: Finance Director, Operations Director, General Manager
informed: CISO, Head of Revenue, Legal
approved_by: CFO
approved_date: 2026-03-01
expires: 2026-12-31
risk_level: HIGH
c2md_confidence: 0.92
nist_control: AU-2, AC-2
applies_to: folio-charge-agent, checkout-agent
---

# Finance Shared Services — O2C Folio Charge Authority

## Purpose

This Shared Services file defines the Order-to-Cash (O2C) cross-domain authority that vertical operations agents must inherit before executing folio charge actions. Any agent crossing from the Operations (Stay) domain into the Finance domain MUST reference this file as a pre-condition.

## Cross-Domain Inheritance Rule

The following agents are authorised to inherit O2C folio charge authority from this file, subject to the conditions below:
- **folio-charge-agent** — all folio charge actions
- **checkout-agent** — folio settlement and fee waiver actions

## Authorised Charge Actions

MUST confirm a valid Apaleo reservation ID is linked before posting any folio charge.
MUST confirm the reservation status is IN_HOUSE or CHECKED_OUT before settlement.
MUST post charges only against confirmed unit types and active service codes in Apaleo.
MUST log every cross-domain charge action to the Witness Agent with cross_domain_inheritance: true.
MUST NOT post charges without a confirmed payment method on file.
MUST NOT process refunds autonomously — all refund requests route to the human Finance team.

## Charge Authority Thresholds

| Charge Value | Autonomous Authority | Approval Required |
|-------------|---------------------|------------------|
| < €50 | Folio Charge Agent / Checkout Agent | None (autonomous) |
| €50 – €200 | Folio Charge Agent / Checkout Agent | Operations Director review |
| €200 – €500 | Escalate | Operations Director sign-off |
| > €500 | Escalate | CFO approval required |

## Fee Waiver Authority

MAY waive charges below €50 without Finance Director approval, subject to exception overlay conditions.
MUST escalate fee waivers above €50 to Finance Director.
MUST NOT waive late checkout fees > €100 without CFO written approval.

## Compliance Baseline

Inherits: NIST SP 800-53 AU-2 (Event Logging), AC-2 (Account Management)
Frameworks: PCI DSS, GDPR/CCPA, ISO 22301, EU AI Act
PCI DSS: MUST NOT store raw card data in any folio charge record or audit log.
GDPR: Guest financial data MUST NOT be retained beyond the legal retention period.
SOC 2 Type II: All cross-domain charge actions contribute to the continuous evidence trail.
`,
    },

    // ──────────────────────────────────────────────────────────────────────────
    // EXCEPTION OVERLAY — Checkout Agent · Gold Loyalty Late Checkout
    // ──────────────────────────────────────────────────────────────────────────
    {
      filename: "Hospitality-Operations-Post-Stay-checkout-gold-loyalty.EXCEPTION.md",
      filepath: "governance/Hospitality-Operations-Post-Stay-checkout-gold-loyalty.EXCEPTION.md",
      fileType: "EXCEPTION",
      axis: "vertical",
      stage: "checkout",
      journeyStage: "Post-Stay",
      owner: "Front Office Manager",
      domain: "Checkout",
      agentId: "checkout-agent",
      normalisationLevel: 3,
      vendor: "VDA-MK for Apaleo",
      baseline: false,
      nistControl: "AC-2",
      content: `---
file_type: EXCEPTION
exception_type: loyalty-override
agent_id: checkout-agent
industry: Hospitality
domain: Checkout
journey_stage_axis: Post-Stay
value_stream_axis: O2C
authored_by: Front Office Manager
consulted: Revenue Manager, Finance Director
informed: General Manager, Operations Director
approved_by: General Manager
approved_date: 2026-03-01
expires: 2026-12-31
risk_level: LOW
c2md_confidence: 0.97
nist_control: AC-2, AU-2
conditions:
  - loyalty_tier: Gold
  - folio_balance: "<€50"
exception_overrides:
  - late_checkout_fee: "€0 (waived)"
  - checkout_extension_time: "13:00"
  - finance_approval_required: false
vendor: VDA-MK for Apaleo
---

# Gold Loyalty Late Checkout Exception Overlay (EXCEPTION)

## Exception Purpose

This EXCEPTION.md overrides the baseline late checkout fee clause in the Checkout Agent SOP for Gold loyalty tier guests. It is an active exception overlay read by the Checkout Agent at runtime alongside the SOP baseline.

## Exception Clause

Gold loyalty tier guests are permitted a complimentary late checkout extension to 13:00, waiving the standard €30 late checkout fee. Finance approval is not required for folios with a balance < €50. This exception applies only to verified Gold tier accounts in the Apaleo guest profile.

## Conditions for Activation

This exception applies ONLY when ALL of the following conditions are met:
1. Guest loyalty tier is verified as **Gold** in the Apaleo guest profile at the time of checkout.
2. Folio balance at the time of checkout is **less than €50** (confirmed via Apaleo Folio API).
3. Late checkout request is for **13:00 or earlier** (not beyond).

## Clause Superseded

This exception overrides the following clause in the Checkout Agent SOP:
> "MUST apply the standard late checkout fee (€30 per hour or part thereof) unless a valid EXCEPTION.md overlay is active."

The standard €30 fee is waived when this exception's conditions are satisfied.

## Witness Agent Requirement

MUST record exception_applied: true in the Witness Agent entry when this exception governs the checkout outcome.
MUST record fileReferenced as this EXCEPTION.md filename in the Witness Agent entry.
MUST cite the exact exception clause verbatim in the clauseApplied field of the Witness entry.

## RACI

- **Responsible**: Checkout Agent (evaluates conditions and applies exception)
- **Accountable**: Front Office Manager
- **Consulted**: Revenue Manager, Finance Director
- **Informed**: General Manager, Operations Director

## Expiry and Governance

This exception expires: 2026-12-31. A new EXCEPTION.md must be authored and approved before renewal.
Exception override must be re-approved by General Manager if conditions change.
Finance approval is explicitly not required for fee waivers within the conditions above (folio < €50).
`,
    },

    // ──────────────────────────────────────────────────────────────────────────
    // SA-4 — System & Services Acquisition (Apaleo / AI vendor governance)
    // ──────────────────────────────────────────────────────────────────────────
    {
      filename: "Hospitality-Governance-Acquisition-sa4-agent.AGENTS.md",
      filepath: "governance/Hospitality-Governance-Acquisition-sa4-agent.AGENTS.md",
      fileType: "AGENTS",
      axis: "horizontal",
      stage: "governance",
      journeyStage: "Governance",
      owner: "CISO",
      domain: "System & Services Acquisition",
      agentId: "sa4-acquisition-agent",
      normalisationLevel: 4,
      vendor: "VDA-MK for Apaleo",
      baseline: true,
      nistControl: "SA-4",
      content: `---
file_type: AGENTS
agent_id: sa4-acquisition-agent
industry: Hospitality
domain: System & Services Acquisition
journey_stage_axis: Governance
value_stream_axis: horizontal
authored_by: CISO
consulted: General Manager, Finance Director, Legal Counsel
informed: Operations Director, Head of Technology
approved_by: General Manager
approved_date: 2026-03-01
expires: 2026-12-31
risk_level: HIGH
c2md_confidence: 0.95
nist_control: SA-4
apaleo_api: All APIs (acquisition scope)
vendor: VDA-MK for Apaleo
baseline: true
---

# SA-4 Acquisition Process Agent Charter

## Agent Purpose

Governs the acquisition of all systems, services, and AI components used within the ${companyName} VDA-MK framework. Ensures all third-party integrations — including Apaleo PMS, AI models, and external APIs — meet security, privacy, and governance requirements before activation.

## Scope

All technology acquisitions that interface with citizen data, Apaleo APIs, or AI decision-making pipelines — including vendor onboarding, API integrations, AI model selection, and cloud service procurement.

## Agent Rules

- MUST require security and privacy impact assessment before onboarding any new vendor or API integration
- MUST verify that all acquired systems support GDPR-compliant data processing agreements (DPA)
- MUST validate that AI system vendors comply with EU AI Act risk classification requirements before deployment
- MUST NOT activate any third-party API access to Apaleo data without documented security review
- MUST maintain a vendor register updated at least annually
- MUST require contractual security obligations (pen testing, incident notification, data retention limits) for all vendors handling citizen data
- MUST NOT onboard high-risk AI systems (EU AI Act Article 6) without CISO and General Manager dual sign-off
- MAY grant provisional access for pilot integrations under a defined 30-day evaluation window with monitoring

## RACI

- **Responsible**: CISO
- **Accountable**: General Manager
- **Consulted**: Finance Director, Legal Counsel
- **Informed**: Operations Director, Head of Technology

## Compliance References

- NIST SP 800-53 SA-4 (Acquisition Process)
- EU AI Act Article 6 (High-Risk AI Classification)
- GDPR Article 28 (Processor Agreements)
- ISO 27001 A.15 (Supplier Relationships)
`,
    },
    {
      filename: "Hospitality-Governance-Acquisition-sa4-agent.SOP.md",
      filepath: "governance/Hospitality-Governance-Acquisition-sa4-agent.SOP.md",
      fileType: "SOP",
      axis: "horizontal",
      stage: "governance",
      journeyStage: "Governance",
      owner: "CISO",
      domain: "System & Services Acquisition",
      agentId: "sa4-acquisition-agent",
      normalisationLevel: 4,
      vendor: "VDA-MK for Apaleo",
      baseline: true,
      nistControl: "SA-4",
      content: `---
file_type: SOP
agent_id: sa4-acquisition-agent
industry: Hospitality
domain: System & Services Acquisition
journey_stage_axis: Governance
value_stream_axis: horizontal
authored_by: CISO
approved_by: General Manager
approved_date: 2026-03-01
expires: 2026-12-31
risk_level: HIGH
nist_control: SA-4
vendor: VDA-MK for Apaleo
baseline: true
---

# SA-4 Acquisition Process — Standard Operating Procedure

## Step 1: Initiation

When a new system, vendor, or AI component is proposed, the initiating team MUST submit an acquisition request including: proposed vendor, data scope, Apaleo API access required, AI risk classification, and business justification.

## Step 2: Security Review

CISO MUST conduct a security review covering:
1. Data flows — what citizen data is accessed or stored
2. Apaleo API permissions required (minimum necessary scope)
3. EU AI Act risk classification (prohibited / high-risk / limited / minimal)
4. GDPR Article 28 processor agreement status
5. Vendor security posture (ISO 27001 / SOC 2 certification)

## Step 3: Contract Requirements

All vendor contracts MUST include:
- Data Processing Agreement (DPA) compliant with GDPR
- Security breach notification within 72 hours (GDPR Article 33)
- Annual penetration testing obligation for systems handling citizen data
- Right to audit clause
- Data retention and deletion obligations

## Step 4: Approval

- Standard integrations: CISO approval
- High-risk AI systems (EU AI Act Article 6): CISO + General Manager dual sign-off
- Apaleo API write-access: CISO + Operations Director sign-off

## Step 5: Activation and Monitoring

After approval:
- MUST log vendor in the ${companyName} Vendor Register
- MUST configure minimum-scope API credentials only
- MUST set a review date (maximum 12 months)
- MUST NOT grant production Apaleo access before security review is complete

## Violation Definition

Activating any third-party system or AI component without completing the SA-4 acquisition review = compliance violation requiring immediate CISO notification and access revocation.
`,
    },
    {
      filename: "Hospitality-Governance-Acquisition-sa4-agent.SKILL.md",
      filepath: "governance/Hospitality-Governance-Acquisition-sa4-agent.SKILL.md",
      fileType: "SKILL",
      axis: "horizontal",
      stage: "governance",
      journeyStage: "Governance",
      owner: "CISO",
      domain: "System & Services Acquisition",
      agentId: "sa4-acquisition-agent",
      normalisationLevel: 4,
      vendor: "VDA-MK for Apaleo",
      baseline: true,
      nistControl: "SA-4",
      content: `---
file_type: SKILL
agent_id: sa4-acquisition-agent
industry: Hospitality
domain: System & Services Acquisition
journey_stage_axis: Governance
value_stream_axis: horizontal
authored_by: CISO
approved_by: General Manager
nist_control: SA-4
vendor: VDA-MK for Apaleo
baseline: true
---

# SA-4 Acquisition Agent — Skill Manifest

## Tool Access

- **Vendor Register API**: Read/write access to the ${companyName} vendor registry
- **Apaleo Admin Console**: Read-only audit of active API credentials and OAuth scopes
- **Document Repository**: Read/write access to DPAs, security assessments, and contracts
- **Witness Agent**: Write access to log all acquisition decisions and sign-offs

## Decision Capabilities

- EU AI Act risk classification lookup (prohibited / high-risk / limited / minimal)
- GDPR Article 28 DPA compliance check
- Apaleo API scope analysis (minimum-necessary principle verification)
- Vendor security posture scoring (ISO 27001 / SOC 2 certification validation)

## Escalation Paths

- High-risk AI acquisition → CISO + General Manager dual sign-off required
- Apaleo write-access request → CISO + Operations Director sign-off required
- Vendor DPA missing or expired → Procurement blocked, Legal Counsel notified

## Witness Agent Logging

Every acquisition decision MUST be logged to the Witness Agent with:
- Vendor name and system scope
- EU AI Act risk classification applied
- Approval path taken (standard / dual sign-off)
- NIST SA-4 clause cited verbatim
`,
    },

    // ──────────────────────────────────────────────────────────────────────────
    // IR-4 — Incident Response (Apaleo operational and security incidents)
    // ──────────────────────────────────────────────────────────────────────────
    {
      filename: "Hospitality-Governance-IncidentResponse-ir4-agent.AGENTS.md",
      filepath: "governance/Hospitality-Governance-IncidentResponse-ir4-agent.AGENTS.md",
      fileType: "AGENTS",
      axis: "horizontal",
      stage: "governance",
      journeyStage: "Governance",
      owner: "CISO",
      domain: "Incident Response",
      agentId: "ir4-incident-agent",
      normalisationLevel: 4,
      vendor: "VDA-MK for Apaleo",
      baseline: true,
      nistControl: "IR-4",
      content: `---
file_type: AGENTS
agent_id: ir4-incident-agent
industry: Hospitality
domain: Incident Response
journey_stage_axis: Governance
value_stream_axis: horizontal
authored_by: CISO
consulted: General Manager, Data Protection Officer, Operations Director
informed: All VDA-MK Agent Owners
approved_by: General Manager
approved_date: 2026-03-01
expires: 2026-12-31
risk_level: CRITICAL
c2md_confidence: 0.96
nist_control: IR-4
apaleo_api: All APIs (incident scope)
vendor: VDA-MK for Apaleo
baseline: true
---

# IR-4 Incident Handling Agent Charter

## Agent Purpose

Governs detection, containment, eradication, and recovery from security incidents, Apaleo API failures, AI agent errors, and citizen data breaches at ${companyName}. Ensures all incidents are handled consistently, with mandatory GDPR Article 33 notification within 72 hours for data breaches.

## Incident Categories

1. **Security breach**: Unauthorised access to citizen data or Apaleo systems
2. **AI agent malfunction**: Agent producing incorrect decisions at scale
3. **Apaleo API failure**: PMS unavailability affecting guest lifecycle operations
4. **Data integrity failure**: Corrupted folios, reservation records, or governance files
5. **GDPR violation event**: Citizen data processed without lawful basis

## Agent Rules

- MUST activate incident response within 1 hour of confirmed incident detection
- MUST notify CISO and General Manager within 2 hours of any Category 1 or 5 incident
- MUST notify Data Protection Officer (DPO) within 24 hours of any potential GDPR breach
- MUST submit GDPR Article 33 notification to supervisory authority within 72 hours of confirmed data breach
- MUST NOT allow affected AI agents to resume autonomous operation until root cause is identified and remediated
- MUST log all incident timeline entries to the Witness Agent with timestamps
- MUST NOT delete or modify incident logs — audit trail is immutable
- MUST conduct post-incident review within 7 days and update relevant governance files
- MAY impose temporary manual review requirement on affected agent decisions during containment

## RACI

- **Responsible**: CISO
- **Accountable**: General Manager
- **Consulted**: Data Protection Officer, Legal Counsel
- **Informed**: All VDA-MK agent owners, Operations Director

## Compliance References

- NIST SP 800-53 IR-4 (Incident Handling)
- GDPR Article 33 (Data Breach Notification)
- EU AI Act Article 9 (Risk Management for High-Risk AI)
- ISO 27001 A.16 (Information Security Incident Management)
`,
    },
    {
      filename: "Hospitality-Governance-IncidentResponse-ir4-agent.SOP.md",
      filepath: "governance/Hospitality-Governance-IncidentResponse-ir4-agent.SOP.md",
      fileType: "SOP",
      axis: "horizontal",
      stage: "governance",
      journeyStage: "Governance",
      owner: "CISO",
      domain: "Incident Response",
      agentId: "ir4-incident-agent",
      normalisationLevel: 4,
      vendor: "VDA-MK for Apaleo",
      baseline: true,
      nistControl: "IR-4",
      content: `---
file_type: SOP
agent_id: ir4-incident-agent
industry: Hospitality
domain: Incident Response
journey_stage_axis: Governance
value_stream_axis: horizontal
authored_by: CISO
approved_by: General Manager
approved_date: 2026-03-01
expires: 2026-12-31
risk_level: CRITICAL
nist_control: IR-4
vendor: VDA-MK for Apaleo
baseline: true
---

# IR-4 Incident Handling — Standard Operating Procedure

## Phase 1: Detection & Reporting (0–1 hour)

Any ${companyName} Ambassador or AI agent observing an anomaly MUST:
1. Log the observation immediately in the Witness Agent with timestamp and description
2. Notify CISO via emergency contact channel
3. Preserve all relevant system logs — MUST NOT delete or overwrite

Detection sources include: Witness Agent audit trail anomalies, Apaleo API error rate spikes, citizen complaints, automated monitoring alerts.

## Phase 2: Classification & Containment (1–2 hours)

CISO MUST classify the incident and initiate containment:

| Category | Action |
|---|---|
| Security breach (Cat 1) | Revoke affected API credentials, isolate affected systems |
| AI malfunction (Cat 2) | Suspend affected agents, enable manual review mode |
| Apaleo API failure (Cat 3) | Activate manual operations fallback, notify Apaleo support |
| Data integrity (Cat 4) | Freeze affected records, initiate reconciliation |
| GDPR violation (Cat 5) | Suspend data processing, notify DPO within 24h |

MUST notify General Manager within 2 hours of confirmed Category 1 or 5 incident.

## Phase 3: GDPR Notification (within 72 hours of breach discovery)

For any incident involving citizen personal data:
1. DPO MUST assess breach risk to citizens' rights and freedoms
2. If risk is not low: MUST submit GDPR Article 33 notification to supervisory authority
3. MUST document: nature of breach, categories of data, number of citizens affected, likely consequences, remedial measures

## Phase 4: Eradication & Recovery

- MUST identify and remediate root cause before restoring agent autonomy
- MUST validate remediation with CISO sign-off
- MUST restore from last known good governance file version (VDA-MD version control)
- Apaleo API credentials MUST be rotated after any credential compromise

## Phase 5: Post-Incident Review (within 7 days)

MUST conduct structured post-incident review including:
- Timeline reconstruction from Witness Agent audit trail
- Root cause analysis
- Governance file updates (if policy gaps identified)
- NIST IR-4 lessons-learned documentation

## Violation Definition

Failure to notify CISO within 1 hour of confirmed incident, or failure to submit GDPR Article 33 notification within 72 hours of a confirmed data breach = regulatory and governance violation.
`,
    },
    {
      filename: "Hospitality-Governance-IncidentResponse-ir4-agent.SKILL.md",
      filepath: "governance/Hospitality-Governance-IncidentResponse-ir4-agent.SKILL.md",
      fileType: "SKILL",
      axis: "horizontal",
      stage: "governance",
      journeyStage: "Governance",
      owner: "CISO",
      domain: "Incident Response",
      agentId: "ir4-incident-agent",
      normalisationLevel: 4,
      vendor: "VDA-MK for Apaleo",
      baseline: true,
      nistControl: "IR-4",
      content: `---
file_type: SKILL
agent_id: ir4-incident-agent
industry: Hospitality
domain: Incident Response
journey_stage_axis: Governance
value_stream_axis: horizontal
authored_by: CISO
approved_by: General Manager
nist_control: IR-4
vendor: VDA-MK for Apaleo
baseline: true
---

# IR-4 Incident Response Agent — Skill Manifest

## Tool Access

- **Witness Agent**: Read/write — full audit trail access for incident timeline reconstruction
- **Apaleo Admin Console**: Credential revocation, API rate monitoring, system health status
- **Governance File Manager**: Read/write — update governance files post-incident
- **Alert System**: Write — trigger escalation notifications to CISO, DPO, General Manager
- **Version Control**: Read — access historical governance file versions for rollback

## Decision Capabilities

- Incident classification (Category 1–5) based on data scope and Apaleo impact
- GDPR breach risk assessment (likelihood and severity to citizen rights)
- AI agent suspension trigger (pause autonomous decisions, enable manual mode)
- Apaleo credential revocation (emergency access termination)
- Post-incident governance file amendment (with CISO sign-off)

## Escalation Paths

- Category 1/5 incident → CISO + General Manager immediate notification
- GDPR breach suspected → DPO notification within 24 hours
- Confirmed GDPR breach → Supervisory authority notification within 72 hours (Article 33)
- AI agent malfunction at scale → All affected agents suspended, manual review mandatory

## Witness Agent Logging

Every incident phase transition MUST be logged to the Witness Agent with:
- Incident category and severity
- Actions taken and by whom
- NIST IR-4 clause cited verbatim
- Timestamps at each phase boundary
- Post-incident review outcome and governance file changes made
`,
    },
  ];

  return files.map(f => {
    // Inject hotel-specific identifiers into every YAML frontmatter block
    // so governance hash is always unique per hotel, even for identical policy text
    const hotelContent = f.content.replace(
      /^---\n/,
      `---\nproperty_code: ${companyId}\nproperty_name: ${companyName}\n`
    );
    const clauses = countClauses(hotelContent);
    return {
      companyId,
      filename: f.filename,
      filepath: f.filepath,
      fileType: f.fileType,
      axis: f.axis,
      stage: f.stage ?? null,
      content: hotelContent,
      status: "live" as const,
      owner: f.owner ?? null,
      domain: f.domain ?? null,
      agentId: f.agentId ?? null,
      journeyStage: f.journeyStage ?? null,
      normalisationLevel: f.normalisationLevel ?? null,
      vendor: f.vendor ?? null,
      baseline: f.baseline ?? null,
      nistControl: f.nistControl ?? null,
      mustCount: clauses.mustCount,
      mustNotCount: clauses.mustNotCount,
      mayCount: clauses.mayCount,
      wordCount: clauses.wordCount,
    };
  });
}

router.post("/admin/seed-companies", async (_req, res) => {
  const log: string[] = [];
  const errors: string[] = [];
  const created: { apaleoPropertyId: string; companyName: string; companyId: number; filesSeeded: number }[] = [];
  const existing: { apaleoPropertyId: string; companyName: string; companyId: number }[] = [];

  for (const prop of CITIZENM_PROPERTIES) {
    try {
      // Check if company already exists by apaleoPropertyId
      const existingRows = await db
        .select({ id: companies.id, companyName: companies.companyName })
        .from(companies)
        .where(eq(companies.apaleoPropertyId, prop.apaleoPropertyId));

      let companyId: number;

      if (existingRows.length > 0) {
        companyId = existingRows[0].id;
        // Update name/URL/brandContext in case it's stale (e.g. old stub entry)
        await db
          .update(companies)
          .set({
            companyName: prop.companyName,
            websiteUrl: prop.websiteUrl,
            brandContext: prop.brandContext,
            filesCount: 23,
          })
          .where(eq(companies.id, companyId));
        existing.push({ apaleoPropertyId: prop.apaleoPropertyId, companyName: prop.companyName, companyId });
        log.push(`${prop.apaleoPropertyId}: company already exists (id=${companyId}), updated name & files…`);
      } else {
        const [inserted] = await db
          .insert(companies)
          .values({
            companyName: prop.companyName,
            websiteUrl: prop.websiteUrl,
            industry: "hospitality",
            brandContext: prop.brandContext,
            filesCount: 23,
            savedAt: Date.now(),
            uploadedFiles: null,
            apaleoPropertyId: prop.apaleoPropertyId,
          })
          .returning({ id: companies.id });

        companyId = inserted.id;
        log.push(`${prop.apaleoPropertyId}: created company "${prop.companyName}" (id=${companyId})`);
      }

      // Seed governance files — idempotent per filename
      const fileDefs = buildGovernanceFiles(companyId, prop.companyName);
      const requiredFilenames = fileDefs.map(f => f.filename);
      let filesInserted = 0;

      // Restore any canonical files that were previously archived
      const CANONICAL = [
        "Hospitality-Revenue-Book-rate-agent.AGENTS.md",
        "Hospitality-Revenue-Book-rate-agent.SOP.md",
        "Hospitality-Revenue-Book-rate-agent.SKILL.md",
        "Hospitality-Operations-Stay-checkin-agent.AGENTS.md",
        "Hospitality-Operations-Stay-checkin-agent.SOP.md",
        "Hospitality-Operations-Stay-checkin-agent.SKILL.md",
        "Hospitality-Operations-Post-Stay-checkout-agent.AGENTS.md",
        "Hospitality-Operations-Post-Stay-checkout-agent.SOP.md",
        "Hospitality-Operations-Post-Stay-checkout-agent.SKILL.md",
        "Hospitality-Operations-Stay-folio-charge-agent.AGENTS.md",
        "Hospitality-Operations-Stay-folio-charge-agent.SOP.md",
        "Hospitality-Operations-Stay-folio-charge-agent.SKILL.md",
        "Hospitality-Revenue-Pre-Book-availability-agent.AGENTS.md",
        "Hospitality-Revenue-Pre-Book-availability-agent.SOP.md",
        "Hospitality-Revenue-Pre-Book-availability-agent.SKILL.md",
        "Hospitality-Revenue-Book-reservation-bot.AGENTS.md",
        "Hospitality-Revenue-Book-reservation-bot.SOP.md",
        "Hospitality-Revenue-Book-reservation-bot.SKILL.md",
        "Hospitality-Finance-Reconciliation-RevenueReconciliation.AGENTS.md",
        "Hospitality-Finance-Reconciliation-RevenueReconciliation.SOP.md",
        "Hospitality-Finance-Reconciliation-RevenueReconciliation.SKILL.md",
        "Hospitality-Finance-Shared-O2C-folio-charge-authority.md",
        "Hospitality-Operations-Post-Stay-checkout-gold-loyalty.EXCEPTION.md",
        "Hospitality-Governance-Acquisition-sa4-agent.AGENTS.md",
        "Hospitality-Governance-Acquisition-sa4-agent.SOP.md",
        "Hospitality-Governance-Acquisition-sa4-agent.SKILL.md",
        "Hospitality-Governance-IncidentResponse-ir4-agent.AGENTS.md",
        "Hospitality-Governance-IncidentResponse-ir4-agent.SOP.md",
        "Hospitality-Governance-IncidentResponse-ir4-agent.SKILL.md",
      ];
      for (const name of CANONICAL) {
        await db
          .update(governanceFiles)
          .set({ isArchived: false })
          .where(and(
            eq(governanceFiles.companyId, companyId),
            eq(governanceFiles.filename, name)
          ));
      }
      // Archive any legacy files from prior seed versions not in the canonical set
      const SUPERSEDED = [
        "rate-override-policy.md", "check-in-agent.md", "checkout-agent.md",
        "folio-charge-policy.md", "availability-policy.md", "reservation-bot.md",
        "folio-settlement-policy.md", "availability-agent.md",
      ];
      for (const oldName of SUPERSEDED) {
        await db
          .update(governanceFiles)
          .set({ isArchived: true })
          .where(and(
            eq(governanceFiles.companyId, companyId),
            eq(governanceFiles.filename, oldName)
          ));
      }

      // Upsert required files — insert if missing, skip if already present
      for (const fileDef of fileDefs) {
        const existingFile = await db
          .select({ id: governanceFiles.id })
          .from(governanceFiles)
          .where(and(
            eq(governanceFiles.companyId, companyId),
            eq(governanceFiles.filename, fileDef.filename)
          ));

        if (existingFile.length === 0) {
          await db.insert(governanceFiles).values(fileDef);
          filesInserted++;
        }
      }

      if (existingRows.length > 0) {
        log.push(`${prop.apaleoPropertyId}: ${filesInserted} new governance files seeded (${requiredFilenames.length} canonical)`);
      } else {
        created.push({ apaleoPropertyId: prop.apaleoPropertyId, companyName: prop.companyName, companyId, filesSeeded: filesInserted });
        log.push(`${prop.apaleoPropertyId}: ${filesInserted} governance files seeded`);
      }

      // Seed agent_phases — idempotent: skip existing (company_id, agent_id) pairs
      const phasesToSeed = PHASE_SEED[prop.apaleoPropertyId] ?? [];
      let phasesInserted = 0;
      for (const p of phasesToSeed) {
        const existing = await db
          .select({ id: agentPhases.id })
          .from(agentPhases)
          .where(and(
            eq(agentPhases.companyId, companyId),
            eq(agentPhases.agentId, p.agentId),
          ));
        if (existing.length === 0) {
          await db.insert(agentPhases).values({
            companyId,
            agentId: p.agentId,
            phase: p.phase,
            activatedAt: new Date(),
            phaseChangedAt: new Date(),
            agreementRate: p.agreementRate,
            overrideRate: null,
            notes: `Seeded by seed-companies (${prop.apaleoPropertyId})`,
          });
          phasesInserted++;
        }
      }
      if (phasesToSeed.length > 0) {
        log.push(`${prop.apaleoPropertyId}: ${phasesInserted} agent_phases seeded (${phasesToSeed.length - phasesInserted} already existed)`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.push(`${prop.apaleoPropertyId}: ERROR — ${msg}`);
      errors.push(`${prop.apaleoPropertyId}: ${msg}`);
    }
  }

  // ── C2MD ENRICHMENT PASS ─────────────────────────────────────────────────────
  // Generate brand-adapted markdown for each of the 23 VDA-MD governance files using
  // Claude (up to 19 calls, shared across all 5 citizenM hotels since they share a brand).
  // Idempotent: files containing C2MD_MARKER are skipped.
  const c2mdLog: string[] = [];

  try {
    const allPropertyIds = CITIZENM_PROPERTIES.map(p => p.apaleoPropertyId);
    const companyRows = await db
      .select({ id: companies.id, apaleoPropertyId: companies.apaleoPropertyId, brandContext: companies.brandContext })
      .from(companies)
      .where(inArray(companies.apaleoPropertyId, allPropertyIds));

    const companyIds = companyRows.map(c => c.id);
    // Read brandContext from DB (source of truth, just upserted above)
    const citizenMBrandContext = companyRows[0]?.brandContext ?? CITIZENM_PROPERTIES[0].brandContext;
    const canonicalFilenames = [
      "Hospitality-Revenue-Book-rate-agent.AGENTS.md",
      "Hospitality-Revenue-Book-rate-agent.SOP.md",
      "Hospitality-Revenue-Book-rate-agent.SKILL.md",
      "Hospitality-Operations-Stay-checkin-agent.AGENTS.md",
      "Hospitality-Operations-Stay-checkin-agent.SOP.md",
      "Hospitality-Operations-Stay-checkin-agent.SKILL.md",
      "Hospitality-Operations-Post-Stay-checkout-agent.AGENTS.md",
      "Hospitality-Operations-Post-Stay-checkout-agent.SOP.md",
      "Hospitality-Operations-Post-Stay-checkout-agent.SKILL.md",
      "Hospitality-Operations-Stay-folio-charge-agent.AGENTS.md",
      "Hospitality-Operations-Stay-folio-charge-agent.SOP.md",
      "Hospitality-Operations-Stay-folio-charge-agent.SKILL.md",
      "Hospitality-Revenue-Pre-Book-availability-agent.AGENTS.md",
      "Hospitality-Revenue-Pre-Book-availability-agent.SOP.md",
      "Hospitality-Revenue-Pre-Book-availability-agent.SKILL.md",
      "Hospitality-Revenue-Book-reservation-bot.AGENTS.md",
      "Hospitality-Revenue-Book-reservation-bot.SOP.md",
      "Hospitality-Revenue-Book-reservation-bot.SKILL.md",
      "Hospitality-Finance-Reconciliation-RevenueReconciliation.AGENTS.md",
      "Hospitality-Finance-Reconciliation-RevenueReconciliation.SOP.md",
      "Hospitality-Finance-Reconciliation-RevenueReconciliation.SKILL.md",
      "Hospitality-Finance-Shared-O2C-folio-charge-authority.md",
      "Hospitality-Operations-Post-Stay-checkout-gold-loyalty.EXCEPTION.md",
      "Hospitality-Governance-Acquisition-sa4-agent.AGENTS.md",
      "Hospitality-Governance-Acquisition-sa4-agent.SOP.md",
      "Hospitality-Governance-Acquisition-sa4-agent.SKILL.md",
      "Hospitality-Governance-IncidentResponse-ir4-agent.AGENTS.md",
      "Hospitality-Governance-IncidentResponse-ir4-agent.SOP.md",
      "Hospitality-Governance-IncidentResponse-ir4-agent.SKILL.md",
    ];

    // Load all canonical governance files for all 5 hotels
    const existingFiles = await db
      .select({ id: governanceFiles.id, companyId: governanceFiles.companyId, filename: governanceFiles.filename, content: governanceFiles.content })
      .from(governanceFiles)
      .where(and(
        inArray(governanceFiles.companyId, companyIds),
        inArray(governanceFiles.filename, canonicalFilenames),
      ));

    // Enriched if file has the C2MD marker AND content is substantively long (>800 chars).
    // Dual check prevents partial/malformed model output from masking a re-enrichment need.
    const unenrichedFiles = existingFiles.filter(
      f => !f.content?.includes(C2MD_MARKER) || (f.content?.length ?? 0) <= 800
    );

    if (unenrichedFiles.length === 0) {
      c2mdLog.push("C2MD: all governance files already enriched — skipped");
    } else {
      c2mdLog.push(`C2MD: ${unenrichedFiles.length} file(s) need enrichment — generating (up to 19 shared calls)…`);

      // Build static template content using generic "citizenM" brand (no city)
      const templateFiles = buildGovernanceFiles(0, "citizenM");
      const enrichedByFilename = new Map<string, string>();

      // Up to 19 sequential Claude calls — one per VDA-MD file (AGENTS/SOP/SKILL × 6 agents + Shared Services).
      // Sequential to avoid API burst-rate risk and to maintain governance determinism.
      const filesToEnrich = templateFiles.filter(
        tmpl => unenrichedFiles.some(f => f.filename === tmpl.filename)
      );
      for (const tmpl of filesToEnrich) {
        try {
          const enriched = await generateC2MDContent(tmpl.filename, tmpl.content, citizenMBrandContext);
          if (enriched && enriched.length > 400) {
            enrichedByFilename.set(tmpl.filename, enriched);
            c2mdLog.push(`C2MD: ✓ ${tmpl.filename} — ${enriched.length} chars`);
          } else {
            c2mdLog.push(`C2MD: ✗ ${tmpl.filename} — response too short, kept static`);
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          c2mdLog.push(`C2MD: ERROR ${tmpl.filename} — ${msg}`);
        }
      }

      // Write enriched content to all un-enriched file rows
      let updatedCount = 0;
      for (const file of unenrichedFiles) {
        const enriched = enrichedByFilename.get(file.filename);
        if (!enriched) continue;
        const clauses = countClauses(enriched);
        await db
          .update(governanceFiles)
          .set({
            content: enriched,
            mustCount: clauses.mustCount,
            mustNotCount: clauses.mustNotCount,
            mayCount: clauses.mayCount,
            wordCount: clauses.wordCount,
          })
          .where(eq(governanceFiles.id, file.id));
        updatedCount++;
      }
      c2mdLog.push(`C2MD: wrote enriched content to ${updatedCount} file(s) across ${companyIds.length} hotel(s)`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    c2mdLog.push(`C2MD: enrichment pass failed — ${msg}`);
  }

  // Return exactly the 5 seeded citizenM property records
  const propertyIds = CITIZENM_PROPERTIES.map(p => p.apaleoPropertyId);
  const seededRows = await db
    .select()
    .from(companies)
    .where(inArray(companies.apaleoPropertyId, propertyIds))
    .orderBy(companies.id);

  const success = errors.length === 0 && seededRows.length === CITIZENM_PROPERTIES.length;
  res.json({ success, created, existing, errors: errors.length > 0 ? errors : undefined, log: [...log, ...c2mdLog], companies: seededRows });
});

// ─── POST /api/admin/enrich-c2md ─────────────────────────────────────────────
// Runs the C2MD enrichment pass in parallel batches (up to 5 concurrent calls).
// Idempotent: files already containing c2md_generated: true are skipped unless force=true.
// Call this after seed to ensure all governance files have brand-adapted compliance English.

router.post("/admin/enrich-c2md", async (req, res) => {
  const force = Boolean((req.body as { force?: boolean }).force);
  const log: string[] = [];
  const errors: string[] = [];

  try {
    const allPropertyIds = CITIZENM_PROPERTIES.map(p => p.apaleoPropertyId);
    const companyRows = await db
      .select({ id: companies.id, apaleoPropertyId: companies.apaleoPropertyId, brandContext: companies.brandContext })
      .from(companies)
      .where(inArray(companies.apaleoPropertyId, allPropertyIds));

    if (companyRows.length === 0) {
      return res.status(400).json({ error: "No citizenM companies found. Run /admin/seed-companies first." });
    }

    const companyIds = companyRows.map(c => c.id);
    const citizenMBrandContext = companyRows[0]?.brandContext ?? CITIZENM_PROPERTIES[0].brandContext;

    const canonicalFilenames = [
      "Hospitality-Revenue-Book-rate-agent.AGENTS.md",
      "Hospitality-Revenue-Book-rate-agent.SOP.md",
      "Hospitality-Revenue-Book-rate-agent.SKILL.md",
      "Hospitality-Operations-Stay-checkin-agent.AGENTS.md",
      "Hospitality-Operations-Stay-checkin-agent.SOP.md",
      "Hospitality-Operations-Stay-checkin-agent.SKILL.md",
      "Hospitality-Operations-Post-Stay-checkout-agent.AGENTS.md",
      "Hospitality-Operations-Post-Stay-checkout-agent.SOP.md",
      "Hospitality-Operations-Post-Stay-checkout-agent.SKILL.md",
      "Hospitality-Operations-Stay-folio-charge-agent.AGENTS.md",
      "Hospitality-Operations-Stay-folio-charge-agent.SOP.md",
      "Hospitality-Operations-Stay-folio-charge-agent.SKILL.md",
      "Hospitality-Revenue-Pre-Book-availability-agent.AGENTS.md",
      "Hospitality-Revenue-Pre-Book-availability-agent.SOP.md",
      "Hospitality-Revenue-Pre-Book-availability-agent.SKILL.md",
      "Hospitality-Revenue-Book-reservation-bot.AGENTS.md",
      "Hospitality-Revenue-Book-reservation-bot.SOP.md",
      "Hospitality-Revenue-Book-reservation-bot.SKILL.md",
      "Hospitality-Finance-Reconciliation-RevenueReconciliation.AGENTS.md",
      "Hospitality-Finance-Reconciliation-RevenueReconciliation.SOP.md",
      "Hospitality-Finance-Reconciliation-RevenueReconciliation.SKILL.md",
      "Hospitality-Finance-Shared-O2C-folio-charge-authority.md",
      "Hospitality-Operations-Post-Stay-checkout-gold-loyalty.EXCEPTION.md",
      "Hospitality-Governance-Acquisition-sa4-agent.AGENTS.md",
      "Hospitality-Governance-Acquisition-sa4-agent.SOP.md",
      "Hospitality-Governance-Acquisition-sa4-agent.SKILL.md",
      "Hospitality-Governance-IncidentResponse-ir4-agent.AGENTS.md",
      "Hospitality-Governance-IncidentResponse-ir4-agent.SOP.md",
      "Hospitality-Governance-IncidentResponse-ir4-agent.SKILL.md",
    ];

    const allFiles = await db
      .select({ id: governanceFiles.id, companyId: governanceFiles.companyId, filename: governanceFiles.filename, content: governanceFiles.content })
      .from(governanceFiles)
      .where(and(
        inArray(governanceFiles.companyId, companyIds),
        inArray(governanceFiles.filename, canonicalFilenames),
      ));

    const targets = force
      ? allFiles
      : allFiles.filter(f => !f.content?.includes(C2MD_MARKER) || (f.content?.length ?? 0) <= 800);

    if (targets.length === 0) {
      return res.json({ success: true, enriched: 0, skipped: allFiles.length, log: ["All files already enriched — pass force=true to re-enrich"] });
    }

    log.push(`${targets.length} file(s) need enrichment across ${companyIds.length} hotel(s)`);

    // Generate enriched content once per unique filename (shared brand across hotels)
    const templateFiles = buildGovernanceFiles(0, "citizenM");
    const uniqueFilenames = [...new Set(targets.map(f => f.filename))];
    const enrichedByFilename = new Map<string, string>();

    // Parallel batches of 5 to avoid API burst limits
    const BATCH = 5;
    for (let i = 0; i < uniqueFilenames.length; i += BATCH) {
      const batch = uniqueFilenames.slice(i, i + BATCH);
      await Promise.all(batch.map(async (filename) => {
        const tmpl = templateFiles.find(t => t.filename === filename);
        if (!tmpl) return;
        try {
          const enriched = await generateC2MDContent(filename, tmpl.content, citizenMBrandContext);
          if (enriched && enriched.length > 400) {
            enrichedByFilename.set(filename, enriched);
            log.push(`✓ ${filename} — ${enriched.length} chars`);
          } else {
            errors.push(`✗ ${filename} — response too short`);
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`✗ ${filename} — ${msg}`);
        }
      }));
    }

    // Write enriched content to all target rows
    let updatedCount = 0;
    for (const file of targets) {
      const enriched = enrichedByFilename.get(file.filename);
      if (!enriched) continue;
      const clauses = countClauses(enriched);
      await db
        .update(governanceFiles)
        .set({
          content: enriched,
          mustCount: clauses.mustCount,
          mustNotCount: clauses.mustNotCount,
          mayCount: clauses.mayCount,
          wordCount: clauses.wordCount,
        })
        .where(eq(governanceFiles.id, file.id));
      updatedCount++;
    }

    log.push(`Wrote enriched content to ${updatedCount} file row(s) across ${companyIds.length} hotel(s)`);
    res.json({ success: errors.length === 0, enriched: updatedCount, skipped: allFiles.length - targets.length, uniqueCalls: enrichedByFilename.size, log, errors: errors.length ? errors : undefined });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

// ─── POST /api/admin/seed-company-governance ─────────────────────────────────
// Seeds 23 VDA-MD canonical governance files for a single company (wizard flow).
// Idempotent — existing canonical files are updated, legacy files archived.

router.post("/admin/seed-company-governance", async (req, res) => {
  const { companyId, companyName } = req.body as { companyId: number; companyName: string };

  if (!companyId || !companyName) {
    return res.status(400).json({ error: "companyId and companyName required" });
  }

  const log: string[] = [];
  const errors: string[] = [];
  let filesSeeded = 0;

  try {
    const fileDefs = buildGovernanceFiles(Number(companyId), companyName);

    // Unarchive any existing canonical files for this company
    const canonicalFilenames = fileDefs.map(f => f.filename);
    await db
      .update(governanceFiles)
      .set({ isArchived: false })
      .where(and(
        eq(governanceFiles.companyId, Number(companyId)),
        inArray(governanceFiles.filename, canonicalFilenames)
      ));

    for (const fileDef of fileDefs) {
      try {
        const existing = await db
          .select({ id: governanceFiles.id })
          .from(governanceFiles)
          .where(and(
            eq(governanceFiles.companyId, Number(companyId)),
            eq(governanceFiles.filename, fileDef.filename)
          ));

        if (existing.length > 0) {
          await db
            .update(governanceFiles)
            .set({ ...fileDef, isArchived: false, updatedAt: new Date() })
            .where(eq(governanceFiles.id, existing[0].id));
          log.push(`updated: ${fileDef.filename}`);
        } else {
          await db.insert(governanceFiles).values({ ...fileDef, isArchived: false });
          log.push(`created: ${fileDef.filename}`);
          filesSeeded++;
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`${fileDef.filename}: ${msg}`);
      }
    }

    log.push(`Seeded ${fileDefs.length} VDA-MD governance files for company ${companyId} (${companyName})`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`seed-company-governance failed: ${msg}`);
  }

  res.json({
    success: errors.length === 0,
    companyId,
    companyName,
    filesSeeded,
    log,
    errors: errors.length > 0 ? errors : undefined,
  });
});

// ─── POST /api/admin/generate-soc2-sd ─────────────────────────────────────────
// Generates an AICPA-compliant SOC 2 System Description for a hotel.
// Stored as governance_files row (fileType: "system-description", nistControl: "SOC2-SD").
// Witness Agent entry written for every generation — provides Type II provenance trail.
// Safe to call multiple times — idempotent (upserts by filename+companyId).
// §3/§4 guards enforced on regeneration: reducing compliance references blocks unless signedOffBy.

router.post("/admin/generate-soc2-sd", async (req, res) => {
  const { companyId: rawCompanyId, signedOffBy } = req.body as { companyId: unknown; signedOffBy?: string };
  const companyId = parseInt(String(rawCompanyId), 10);
  if (isNaN(companyId)) return res.status(400).json({ error: "companyId required" });

  try {
    const [company] = await db
      .select()
      .from(companies)
      .where(eq(companies.id, companyId));
    if (!company) return res.status(404).json({ error: "Company not found" });

    const hotelCode   = company.apaleoPropertyId ?? "UNK";
    const companyName = company.companyName;
    const brandContext = company.brandContext ?? "";

    const filename = `SOC2-SystemDescription-${hotelCode}.SYSTEM-DESC.md`;

    // Fetch existing SD content early (needed for §3/§4 guard on regeneration)
    const [existingRow] = await db
      .select({ id: governanceFiles.id, content: governanceFiles.content })
      .from(governanceFiles)
      .where(and(eq(governanceFiles.companyId, companyId), eq(governanceFiles.filename, filename), eq(governanceFiles.isArchived, false)));

    // Load all active governance files for this hotel
    const govFiles = await db
      .select({
        filename: governanceFiles.filename,
        fileType: governanceFiles.fileType,
        nistControl: governanceFiles.nistControl,
        agentId: governanceFiles.agentId,
        domain: governanceFiles.domain,
        owner: governanceFiles.owner,
        content: governanceFiles.content,
        wordCount: governanceFiles.wordCount,
      })
      .from(governanceFiles)
      .where(and(eq(governanceFiles.companyId, companyId), eq(governanceFiles.isArchived, false)))
      .orderBy(governanceFiles.nistControl, governanceFiles.filename);

    // Agent definitions: AGENTS.md files represent the canonical agent definitions in VDA-MK
    const agentDefFiles = govFiles.filter(f => f.fileType === "AGENTS" && f.content && f.content.length > 50);
    const agentDefSummary = agentDefFiles
      .map(f => `### ${f.filename} (agentId: ${f.agentId ?? "N/A"})\n${f.content.slice(0, 600)}`)
      .join("\n\n---\n\n");

    // Build structured excerpts for remaining file types (SOP, SKILL, COMPLIANCE, etc.)
    const governanceSummary = govFiles
      .filter(f => f.content && f.content.length > 100 && f.fileType !== "system-description" && f.fileType !== "AGENTS")
      .map(f => `### ${f.filename} (${f.fileType} | NIST: ${f.nistControl ?? "N/A"} | Owner: ${f.owner ?? "N/A"})\n${f.content.slice(0, 600)}`)
      .join("\n\n---\n\n");

    const uniqueAgents  = [...new Set(agentDefFiles.map(f => f.agentId).filter(Boolean))];
    const uniqueDomains = [...new Set(govFiles.map(f => f.domain).filter(Boolean))];
    const uniqueOwners  = [...new Set(govFiles.map(f => f.owner).filter(Boolean))];
    const nistControls  = [...new Set(govFiles.map(f => f.nistControl).filter(Boolean))];

    const systemPrompt = `You are an AICPA-certified SOC 2 Type II report specialist.
Write formal, complete SOC 2 System Descriptions that will satisfy an external CPA audit.
Use precise professional language — this is a legal/audit document.
Every section must contain substantive narrative, not bullet points.
Include explicit SOC 2 / AICPA / Trust Service Criteria references throughout.
Output ONLY valid markdown with YAML frontmatter — no preamble, no commentary, no code fences.`;

    const nowIso = new Date().toISOString();
    const userPrompt = `Generate a complete AICPA SOC 2 System Description for ${companyName} (Property ID: ${hotelCode}).

ENTITY CONTEXT:
${brandContext.slice(0, 900)}

GOVERNANCE SYSTEM FACTS:
- Total governance files: ${govFiles.length}
- AI agent definitions loaded: ${agentDefFiles.length} (canonical AGENTS.md files)
- AI agents governed: ${uniqueAgents.join(", ")}
- Operating domains: ${uniqueDomains.join(", ")}
- NIST SP 800-53 controls: ${nistControls.join(", ")}
- Named accountable roles: ${uniqueOwners.join(", ")}
- Core technology stack: Apaleo PMS (API-first), Anthropic Claude (AI), VDA-MK governance framework
- Compliance framework: GDPR, EU AI Act, ISO 42001, NIST SP 800-53, SOC 2 Type II, ISO 27001
- Change control: §4 audit signoff enforcement (SOC 2 and NIST standard reductions require named signoff)
- Audit trail: Witness Agent logs every AI agent decision before execution (tamper-evident)
- Mandatory file triplet: every agent requires AGENTS.md + SOP.md + SKILL.md (§2.1 enforcement)

AGENT DEFINITIONS (canonical AGENTS.md files — each agent's formal identity, capabilities, and constraints):
${agentDefSummary.slice(0, 3000)}

GOVERNANCE FILE EXCERPTS (SOP/SKILL/COMPLIANCE — representative samples):
${governanceSummary.slice(0, 4000)}

Generate the following exact structure — write each section as formal audit narrative prose:

---
filename: SOC2-SystemDescription-${hotelCode}.SYSTEM-DESC.md
file_type: system-description
nist_control: SOC2-SD
company: ${companyName}
property_id: ${hotelCode}
doc_version: 1.0
generated_at: ${nowIso}
framework: SOC 2 Type II (AICPA Trust Service Criteria 2017)
status: draft
owner: CISO
soc2_generated: true
---

# SOC 2 System Description
## ${companyName} (${hotelCode}) — VDA-MK AI Governance Platform

*Prepared for SOC 2 Type II audit purposes. All information current as of ${nowIso.slice(0, 10)}.*

---

## Section 1: Overview of the Entity and its Services

[Write 3-4 paragraphs describing ${companyName} as a citizenM hotel property, the VDA-MK AI governance platform purpose, the Apaleo PMS as core system, and the principal service commitments to guests]

## Section 2: Principal Service Commitments and System Requirements

[Write 2-3 paragraphs covering: (a) AICPA Trust Service Criteria commitments — Security (CC), Availability (A1); (b) Apaleo API service commitments; (c) VDA-MK governance obligations including mandatory file enforcement]

## Section 3: Components of the System

### 3.1 Infrastructure
[Apaleo GmbH cloud-hosted PMS infrastructure, Replit cloud hosting, TLS/HTTPS transport, no on-premises data storage]

### 3.2 Software
[VDA-MK governance framework version, AI agent runtime — Anthropic Claude via API, Apaleo REST APIs (Availability, Reservations, Folio, Unit Management), governance file management system]

### 3.3 People
[Formal description of ${uniqueOwners.join(", ")} roles and their accountability within the VDA-MK framework — who can approve governance files, who signs off on audit standard changes, who receives ESCALATE decisions]

### 3.4 Procedures
[VDA-MD §2.1 mandatory file triplet (AGENTS+SOP+SKILL), §3 immutability enforcement for GDPR/EU AI Act/ISO 42001, §4 accountable owner signoff for NIST/SOC 2/ISO 27001 reductions, Witness Agent pre-execution logging]

### 3.5 Data
[Guest PII (name, email, payment card data) handled via Apaleo; reservation/folio data; Witness Agent audit log entries; governance file versions — classification, retention, and protection rules]

## Section 4: System Boundaries

[Formal description of what is IN scope: AI agent decision layer, governance file system, Apaleo API integrations for ${hotelCode}, Witness Agent audit trail. OUT of scope: physical hotel infrastructure, room hardware, external guest-facing booking channels, payroll systems]

## Section 5: Control Environment

[Narrative describing VDA-MK as the control framework: how governance markdown files function as the sole source of truth, how §3 and §4 guards technically enforce immutability and change control, how the Witness Agent provides pre-execution audit evidence, how the mandatory 3-file enforcement ensures no agent operates without documented policy, and how escalation paths maintain human-in-the-loop accountability]

## Section 6: Trust Service Criteria Controls

### CC6: Logical and Physical Access Controls
[How AC-2 governance files enforce access control for Apaleo API credentials; minimum-privilege API scope restrictions per agent; CISO escalation paths for access anomalies; audit log of all access decisions via Witness Agent]

### CC7: System Operations and Monitoring
[How AU-2 event logging governance files specify what the Witness Agent must log; every AI agent decision logged before execution; anomaly escalation paths to Operations Director; SOC 2 Type II operational evidence generated continuously]

### CC8: Change Management
[How SA-4 acquisition governance files govern all system and vendor changes; §4 signoff enforcement — any reduction of SOC 2 or NIST references requires named accountable owner, recorded in commit history; version history maintained for all governance files]

### CC9: Risk Mitigation
[How IR-4 incident response governance files govern breach detection, containment, GDPR Article 33 72-hour notification obligation, Apaleo API incident handling, post-incident review requirements]

## Section 7: Complementary User Entity Controls (CUECs)

[Formal list of what ${companyName} operations team MUST do: maintain named CISO and Operations Director; review and approve all governance file changes; provide §4 signoffs for audit standard reductions; monitor Witness Agent audit trail; respond to ESCALATE decisions within defined SLA; ensure Apaleo credentials are rotated per SA-4 policy; conduct quarterly governance file review]

## Section 8: Complementary Subservice Organization Controls

### Apaleo GmbH (Property Management System — Subservice Provider)
[Apaleo's obligations as data processor under GDPR Article 28: API availability SLA, GDPR-compliant data processing, security certifications, encryption in transit and at rest, access credential management, incident notification obligations]

### Anthropic PBC (AI Model Provider — Subservice Provider)
[Anthropic's obligations: EU AI Act Article 53 compliance for general-purpose AI models, data processing agreements, model safety commitments, API availability SLA, no training on ${companyName} guest data per terms of service]

## Compliance Baseline

| Trust Service Criterion | VDA-MK Control | NIST SP 800-53 |
|------------------------|---------------|----------------|
| CC6 — Logical Access | AC-2 governance files + §4 signoff | AC-2 Account Management |
| CC7 — System Operations | AU-2 governance files + Witness Agent | AU-2 Event Logging |
| CC8 — Change Management | SA-4 governance files + §4 enforcement | SA-4 Acquisition Process |
| CC9 — Risk Mitigation | IR-4 governance files + GDPR Article 33 | IR-4 Incident Handling |

## Audit Evidence References

The following constitute the Type II operational evidence trail:
- **Witness Agent log**: Tamper-evident record of every AI agent decision, governance clause cited, and decision outcome — logged before execution per VDA-MK §2.1
- **§4 signoff commit history**: Every reduction of SOC 2, NIST, or ISO 27001 references in governance files is blocked unless a named accountable owner provides explicit signoff, recorded as \`[Audit change signed off by: <name>]\` in the version history
- **Governance file versions**: Full version history of all AGENTS/SOP/SKILL files with authorship and timestamps
- **Escalation records**: All ESCALATE decisions recorded in Witness Agent with escalation target, reasoning, and governing clause cited`;

    const content = await callAI({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    const wordCount    = content.split(/\s+/).filter(Boolean).length;
    const mustCount    = (content.match(/\bMUST\b(?!\s+NOT)/g) || []).length;
    const mustNotCount = (content.match(/\bMUST NOT\b/g) || []).length;
    const mayCount     = (content.match(/\bMAY\b/g) || []).length;
    const contentHash  = `${content.length}-${content.slice(0, 24).replace(/\W/g, "")}`;

    const filepath = `governance/${filename}`;

    // §3/§4 compliance guard — applied when regenerating an existing document
    if (existingRow?.content) {
      const guard = checkComplianceGuards(existingRow.content, content, signedOffBy);
      if (!guard.allowed) {
        return res.status(409).json({ error: "Compliance guard blocked regeneration", violations: guard.violations, hint: guard.hint });
      }
    }

    // Upsert into governance_files (idempotent)
    let fileId: number;
    if (existingRow) {
      const [updated] = await db
        .update(governanceFiles)
        .set({ content, status: "draft", wordCount, mustCount, mustNotCount, mayCount, isArchived: false, updatedAt: new Date() })
        .where(eq(governanceFiles.id, existingRow.id))
        .returning({ id: governanceFiles.id });
      fileId = updated.id;
    } else {
      const [inserted] = await db
        .insert(governanceFiles)
        .values({
          companyId, filename, filepath,
          fileType: "system-description",
          axis: "compliance",
          content,
          status: "draft",
          owner: "CISO",
          domain: "Compliance",
          agentId: "soc2-sd-agent",
          normalisationLevel: 3,
          vendor: "VDA-MK for Apaleo",
          baseline: true,
          nistControl: "SOC2-SD",
          mustCount, mustNotCount, mayCount, wordCount,
          isArchived: false,
        })
        .returning({ id: governanceFiles.id });
      fileId = inserted.id;
    }

    // Write Witness Agent provenance entry
    await db.insert(witnessEntries).values({
      companyId,
      agent: "Witness Agent",
      decision: "PASS",
      fileReferenced: filename,
      clauseApplied: "SOC 2 Trust Service Criteria — AICPA System Description generated per SOC 2 Type II requirements. CC6/CC7/CC8/CC9 controls documented.",
      actionProposed: `SOC 2 System Description generated and stored for ${companyName} (${hotelCode}). File: ${filename}.`,
      exceptionApplied: false,
      escalationTarget: null,
      reasoning: `System Description generated by ${signedOffBy || "System"} on ${new Date().toISOString()}. Hash: ${contentHash}. ${wordCount} words. ${govFiles.length} governance files consulted across ${uniqueAgents.length} agents (${agentDefFiles.length} AGENTS.md definitions loaded).`,
      apaleoData: {
        event: "soc2_system_description_generated",
        modelUsed: "claude-sonnet-4-6",
        fileHash: contentHash,
        signedOffBy: signedOffBy || "System",
        wordCount,
        govFilesUsed: govFiles.length,
        uniqueAgentsCount: uniqueAgents.length,
        nistControlsCovered: nistControls,
        hotelCode,
        fileId,
      },
      scenarioRunId: `soc2-sd-${hotelCode}-${Date.now()}`,
      filesConsulted: govFiles.map(f => f.filename).slice(0, 20),
      crossDomainInheritance: false,
    });

    res.json({ success: true, fileId, filename, wordCount, hotelCode, companyName });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ─── GET /api/admin/soc2-sd-status/:companyId ─────────────────────────────────
// Returns staleness info for the hotel's SOC 2 System Description.
// isStale = true when the document has not been regenerated/reviewed in >90 days.

router.get("/admin/soc2-sd-status/:companyId", async (req, res) => {
  const companyId = parseInt(req.params.companyId, 10);
  if (isNaN(companyId)) return res.status(400).json({ error: "Invalid companyId" });

  try {
    const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
    if (!company) return res.status(404).json({ error: "Company not found" });

    const hotelCode = company.apaleoPropertyId ?? "UNK";
    const filename = `SOC2-SystemDescription-${hotelCode}.SYSTEM-DESC.md`;

    const [sdFile] = await db
      .select({
        id: governanceFiles.id, filename: governanceFiles.filename,
        wordCount: governanceFiles.wordCount, updatedAt: governanceFiles.updatedAt,
        status: governanceFiles.status, signedBy: governanceFiles.signedBy,
        signedRole: governanceFiles.signedRole, signedAt: governanceFiles.signedAt,
      })
      .from(governanceFiles)
      .where(and(
        eq(governanceFiles.companyId, companyId),
        eq(governanceFiles.filename, filename),
        eq(governanceFiles.isArchived, false)
      ));

    const recentWitnessEntries = await db
      .select({
        id: witnessEntries.id, reasoning: witnessEntries.reasoning,
        createdAt: witnessEntries.createdAt, apaleoData: witnessEntries.apaleoData,
        clauseApplied: witnessEntries.clauseApplied,
      })
      .from(witnessEntries)
      .where(and(
        eq(witnessEntries.companyId, companyId),
        eq(witnessEntries.fileReferenced, filename)
      ))
      .orderBy(desc(witnessEntries.createdAt))
      .limit(5);

    const lastGeneratedAt = recentWitnessEntries[0]?.createdAt ?? null;
    const daysSinceGeneration = lastGeneratedAt
      ? Math.floor((Date.now() - new Date(lastGeneratedAt).getTime()) / 86400000)
      : null;
    const isStale = daysSinceGeneration === null ? true : daysSinceGeneration > 90;

    res.json({
      exists: !!sdFile,
      fileId: sdFile?.id ?? null,
      filename,
      wordCount: sdFile?.wordCount ?? 0,
      status: sdFile?.status ?? null,
      signedBy: sdFile?.signedBy ?? null,
      signedRole: sdFile?.signedRole ?? null,
      signedAt: sdFile?.signedAt ?? null,
      lastGeneratedAt,
      daysSinceGeneration,
      isStale,
      recentWitnessEntries,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

export default router;

