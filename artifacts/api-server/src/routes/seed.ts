/**
 * Demo Data Seeder
 * POST /api/admin/seed-demo-data
 *
 * Creates Definite + InHouse reservations across BER, LND, MUC, PAR, VIE
 * so agent demo journeys have live data to act on.
 *
 * Safe to call multiple times — checks existing counts first.
 */

import { Router, type IRouter } from "express";
import { apaleoFetch } from "../lib/apaleo.js";

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

export default router;
