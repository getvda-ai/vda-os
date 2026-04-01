/**
 * Demo Data Seeder
 * POST /api/admin/seed-demo-data   – creates Apaleo sandbox reservations
 * POST /api/admin/seed-companies   – seeds 5 citizenM hotel entries + governance files
 *
 * Safe to call multiple times — idempotent checks throughout.
 */

import { Router, type IRouter } from "express";
import { apaleoFetch } from "../lib/apaleo.js";
import { db, companies, governanceFiles } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";

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

function buildGovernanceFiles(companyId: number, companyName: string) {
  const files = [
    {
      filename: "rate-override-policy.md",
      filepath: "governance/rate-override-policy.md",
      fileType: "AGENTS",
      axis: "vertical",
      stage: "discover",
      journeyStage: "discover",
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
domain: Revenue Management
owner: Revenue Manager
axis: vertical
journey_stage: discover
normalisation_level: 3
vendor: VDA-MK for Apaleo
baseline: true
nist_control: AC-2
apaleo_api: Rate Plan API
---

## Agent Scope

The Rate Agent governs all automated rate plan decisions for ${companyName} via the Apaleo Rate Plan API.

## Permitted Actions

MUST verify account tier in Apaleo before applying any rate plan override.
MUST log every rate decision to the Witness Agent audit trail before execution.
MUST NOT apply a discount below BAR without a valid exception overlay.
MUST NOT process rate overrides that exceed the Revenue Manager authority ceiling of 18%.
MAY apply standard BAR rates without human approval for direct bookings.
MAY apply up to 5% early-bird discount automatically for bookings >30 days out.

## Rate Override Authority

MUST escalate to Revenue Manager when: discount request is between 10% and 18% below BAR.
MUST escalate to VP Revenue when: discount request exceeds 18% below BAR.
MUST escalate to VP Revenue when: account is not classified as Tier 1 in Apaleo.

## Exception Overlays

MAY apply the \`key-account-rate-exception.md\` overlay for verified Tier 1 accounts (up to 18% discount at Revenue Manager authority).
MUST NOT apply exception overlay without valid account tier verification in Apaleo.

## Compliance Baseline

Inherits: NIST SP 800-53 AC-2, AU-2
Frameworks: PCI DSS, GDPR/CCPA, ISO 22301
`,
    },
    {
      filename: "folio-settlement-policy.md",
      filepath: "governance/folio-settlement-policy.md",
      fileType: "COMPLIANCE",
      axis: "horizontal",
      stage: "checkout",
      journeyStage: "checkout",
      owner: "Operations Director",
      domain: "Folio Management",
      agentId: "folio-settlement-agent",
      normalisationLevel: 3,
      vendor: "VDA-MK for Apaleo",
      baseline: true,
      nistControl: "AU-2",
      content: `---
file_type: COMPLIANCE
agent_id: folio-settlement-agent
domain: Folio Management
owner: Operations Director
axis: horizontal
journey_stage: checkout
normalisation_level: 3
vendor: VDA-MK for Apaleo
baseline: true
nist_control: AU-2
apaleo_api: Folio API
---

## Scope

This policy governs all folio settlement actions performed by the Folio Settlement Agent via the Apaleo Folio API at ${companyName}.

## Mandatory Rules

MUST NOT post folio charges without a matching, confirmed reservation ID in Apaleo Reservations API.
MUST NOT settle a folio where the reservation status is not IN_HOUSE or CHECKED_OUT in Apaleo.
MUST confirm folio balance is zero or a valid payment method is on file before checkout.
MUST log every folio action to the Witness Agent audit trail with Apaleo folio reference.
MUST NOT process refunds — route all refund requests to a human Folio Agent.
MUST escalate folios with disputes or unresolved charges to Operations Director before settlement.

## Late Checkout Fee Policy

MAY waive late checkout fee up to 14:00 for verified Gold or Platinum loyalty tier guests.
MUST confirm loyalty tier in Apaleo guest profile before applying waiver.
MUST NOT waive late checkout fee beyond 14:00 without Front Office Manager approval.

## Overdue Folio Escalation

MUST escalate folio invoices unpaid beyond 30-day payment terms to Credit Control.
MUST send minimum two automated reminders before escalation.

## Compliance Baseline

Inherits: NIST SP 800-53 AU-2, AC-2
Frameworks: PCI DSS, GDPR/CCPA, ISO 22301
PCI DSS: MUST NOT store raw card data in folio records or agent logs.
`,
    },
    {
      filename: "check-in-agent.md",
      filepath: "governance/check-in-agent.md",
      fileType: "AGENTS",
      axis: "vertical",
      stage: "checkin",
      journeyStage: "checkin",
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
domain: Check-In
owner: Front Office Manager
axis: vertical
journey_stage: checkin
normalisation_level: 3
vendor: VDA-MK for Apaleo
baseline: true
nist_control: AC-2
apaleo_api: Reservations API, Unit Management API
---

## Agent Scope

The Check-In Agent automates the digital check-in workflow for arriving guests at ${companyName} using the Apaleo Property Management API.

## Permitted Actions

MUST verify reservation status in Apaleo Reservations API before assigning a property unit.
MUST confirm folio balance is settled or a valid payment method is on file before check-in.
MUST assign a unit using Apaleo Unit Management API — prioritise room-type match to reservation.
MUST update Apaleo reservation status to IN_HOUSE upon successful check-in.
MUST log every check-in decision to the Witness Agent audit trail with Apaleo reservation reference.
MUST NOT check in a guest whose reservation status is CANCELLED or NO_SHOW in Apaleo.
MUST NOT override a unit assignment without a Front Office Manager supervisor token.

## Loyalty Upgrades

MAY apply room-type upgrade for verified Gold or Platinum loyalty tier guests when an equivalent unit is available.
MUST confirm loyalty tier in Apaleo guest profile before applying any upgrade.
MUST NOT apply upgrade if the higher unit type is fully committed for the night.

## Escalation Path

MUST escalate to Front Office Manager when:
- Reservation has a block, dispute, or open folio balance > €500.
- Guest identity cannot be verified.
- No units of the reserved type are available.

## Compliance Baseline

Inherits: NIST SP 800-53 AC-2, AU-2
Frameworks: PCI DSS, GDPR/CCPA
GDPR: MUST NOT retain guest PII beyond the required retention window.
PCI DSS: MUST NOT log raw card data during check-in.
`,
    },
    {
      filename: "availability-agent.md",
      filepath: "governance/availability-agent.md",
      fileType: "AGENTS",
      axis: "vertical",
      stage: "discover",
      journeyStage: "discover",
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
domain: Availability & Inventory
owner: Revenue Manager
axis: vertical
journey_stage: discover
normalisation_level: 3
vendor: VDA-MK for Apaleo
baseline: true
nist_control: AC-2
apaleo_api: Availability API, Rate Plan API
---

## Agent Scope

The Availability Agent governs real-time inventory and availability decisions for ${companyName} via the Apaleo Availability and Rate Plan APIs.

## Permitted Actions

MUST query Apaleo Availability API for live unit inventory before confirming any reservation.
MUST NOT confirm a reservation for a unit type with zero availability in Apaleo.
MUST log every availability decision to the Witness Agent audit trail before execution.
MUST NOT alter inventory blocks without Revenue Manager approval.
MAY apply standard availability rules without human approval for direct bookings.
MAY hold inventory for group bookings up to 24 hours pending deposit confirmation.

## Inventory Management

MUST NOT release a group booking hold without confirmed deposit or signed group agreement.
MUST escalate to Revenue Manager when inventory drops below minimum availability threshold.
MAY apply overbooking policy up to the approved overbooking percentage set by Revenue Manager.

## Post-Stay Invoice Dispatch

MUST generate folio invoice within 24 hours of checkout and dispatch to confirmed billing address.
MUST reference the Apaleo Folio API data when generating post-stay invoices.
MUST NOT dispatch invoice to an unverified billing address.

## Compliance Baseline

Inherits: NIST SP 800-53 AC-2, AU-2
Frameworks: PCI DSS, GDPR/CCPA, ISO 22301
`,
    },
  ];

  return files.map(f => {
    const clauses = countClauses(f.content);
    return {
      companyId,
      filename: f.filename,
      filepath: f.filepath,
      fileType: f.fileType,
      axis: f.axis,
      stage: f.stage ?? null,
      content: f.content,
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
            filesCount: 4,
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
            filesCount: 4,
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
      const CANONICAL = ["rate-override-policy.md", "folio-settlement-policy.md", "check-in-agent.md", "availability-agent.md"];
      for (const name of CANONICAL) {
        await db
          .update(governanceFiles)
          .set({ isArchived: false })
          .where(and(
            eq(governanceFiles.companyId, companyId),
            eq(governanceFiles.filename, name)
          ));
      }
      // Archive any non-canonical files introduced by previous seed versions
      const SUPERSEDED = ["checkout-agent.md", "folio-charge-policy.md", "availability-policy.md", "reservation-bot.md"];
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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.push(`${prop.apaleoPropertyId}: ERROR — ${msg}`);
    }
  }

  // Return exactly the 5 seeded citizenM property records
  const propertyIds = CITIZENM_PROPERTIES.map(p => p.apaleoPropertyId);
  const seededRows = await db
    .select()
    .from(companies)
    .where(inArray(companies.apaleoPropertyId, propertyIds))
    .orderBy(companies.id);

  res.json({ success: true, created, existing, log, companies: seededRows });
});

export default router;
