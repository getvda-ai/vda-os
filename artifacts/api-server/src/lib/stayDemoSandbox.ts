/**
 * stayDemoSandbox.ts — put the Apaleo sandbox into the state the seeded demo expects.
 *
 * WHY THIS EXISTS. The Reset seeds HITL cards for invented guests. With no `apaleo_ref`
 * the decision engine has nothing to read, falls back to DEMO-DATA, and every card renders
 * "System of record — Apaleo read unavailable". That message is true but it is the weak
 * version of this demo: in front of Apaleo the system-of-record artifacts ARE the point.
 * So each seeded card is bound to a REAL reservation in the connected sandbox, and the
 * card shows a genuine reservation id, unit, status, folio and balance.
 *
 * IDEMPOTENT BY DESIGN — reuse, repair, then create, in that order. Cancel-and-recreate on
 * every press would be simpler but it writes ~40 records per reset and leaves the sandbox
 * full of this demo's exhaust. Instead every slot carries a stable tag; a second reset is
 * mostly reads plus a few repairs.
 *
 * REPAIR is the half that matters for "reset ready for the HITL transactions": an approved
 * early check-out SHORTENS its reservation and an approved assignment ASSIGNS a unit, so on
 * the next press those records no longer match the story their card tells. Repair restores
 * the departure date and unassigns the unit rather than abandoning the record.
 *
 * TENANCY. The tag carries the company id (`stay-reset:co1:<key>`). citizenM (company 1)
 * and Apaleo One (company 31) point at the SAME Apaleo sandbox, so a tag without the tenant
 * in it would have each demo's reset repairing — and cancelling — the other's reservations.
 * That is the Neon 109-entries incident with a different database.
 *
 * `$force`. Bookings are created through `POST /booking/v1/bookings/$force`. Every BER rate
 * plan in this sandbox carries restrictions that refuse a same-day arrival, and these are
 * demo records for arrivals happening today. The client holds `reservations.force-manage`,
 * which is exactly the authority `$force` requires — the same scope scenario D is about.
 */
import { apaleoFetch, buildQueryString } from "./apaleo.js";
import { logger } from "./logger.js";

const BOOKER_EMAIL = "stay-reset@vda-mk.com";

/** The state a slot's reservation has to be in for its card to make sense. */
type SlotState = "confirmed_unassigned" | "inhouse";

export interface SandboxSlot {
  /** Stable key — matches the `slot` on the console's RESET_SCENARIOS entry. */
  key: string;
  guest: { firstName: string; lastName: string };
  ratePlanId: string;
  nightly: number;
  /** Days from today; negative for a guest already in house. */
  arrivalOffset: number;
  nights: number;
  adults: number;
  childrenAges?: number[];
  state: SlotState;
  /** >1 creates one booking holding that many reservations (a party taking rooms). */
  rooms?: number;
}

/**
 * The slots, one per seeded card that needs a property record. Rate plans are chosen to
 * MATCH THE STORY the card tells: a card that says "non-refundable" is bound to a
 * reservation actually on BER-NONREF-DBL, because the card shows the rate plan and an
 * Apaleo audience reads it. feature_enablement has no slot — it is governance-layer only
 * and there is deliberately no property record to intercept.
 */
export const SANDBOX_SLOTS: SandboxSlot[] = [
  // Room assignment — Confirmed and DELIBERATELY UNASSIGNED. A reservation with no unit is
  // precisely what makes "assign a room" a real action rather than a caption.
  { key: "ra_pass",     guest: { firstName: "Lea", lastName: "Ferrand" },   ratePlanId: "BER-FLEX-DBL",   nightly: 145, arrivalOffset: 0,  nights: 2, adults: 1, state: "confirmed_unassigned" },
  { key: "ra_family",   guest: { firstName: "Jonas", lastName: "Ravensberg" }, ratePlanId: "BER-FLEX-DBL", nightly: 155, arrivalOffset: 0, nights: 3, adults: 2, childrenAges: [8, 11], state: "confirmed_unassigned", rooms: 3 },
  { key: "ra_okonkwo",  guest: { firstName: "Dayo", lastName: "Okonkwo" },  ratePlanId: "BER-FLEX-DBL",   nightly: 140, arrivalOffset: 0,  nights: 2, adults: 1, state: "confirmed_unassigned" },
  { key: "ra_tanaka",   guest: { firstName: "Ben", lastName: "Tanaka" },    ratePlanId: "BER-FLEX-DBL",   nightly: 140, arrivalOffset: 0,  nights: 1, adults: 1, state: "confirmed_unassigned" },
  { key: "ra_mbeki",    guest: { firstName: "Sipho", lastName: "Mbeki" },   ratePlanId: "BER-FLEX-DBL",   nightly: 135, arrivalOffset: 0,  nights: 2, adults: 1, state: "confirmed_unassigned" },
  // Early checkout — InHouse, and departure must still be in the FUTURE or "leaving early"
  // is not a thing that can be asked for.
  //
  // arrivalOffset is 0 for every in-house slot, not negative: Apaleo refuses to CREATE a
  // booking whose arrival is in the past ("Arrival is too far in the past", and yesterday
  // fails too once check-out time has passed). So these guests arrive today and are checked
  // in; what makes an early departure askable is that the DEPARTURE is still in the future,
  // which `nights` supplies. The cards say "night 1 of N" for the same reason.
  { key: "ec_pass",     guest: { firstName: "Kunle", lastName: "Adeyemi" }, ratePlanId: "BER-FLEX-DBL",   nightly: 150, arrivalOffset: 0, nights: 4, adults: 1, state: "inhouse" },
  { key: "ec_moreau",   guest: { firstName: "Remi", lastName: "Moreau" },   ratePlanId: "BER-NONREF-DBL", nightly: 135, arrivalOffset: 0, nights: 6, adults: 1, state: "inhouse" },
  { key: "ec_nowak",    guest: { firstName: "Piotr", lastName: "Nowak" },   ratePlanId: "BER-FLEX-DBL",   nightly: 130, arrivalOffset: 0, nights: 5, adults: 1, state: "inhouse" },
  { key: "ec_bianchi",  guest: { firstName: "Alessia", lastName: "Bianchi" }, ratePlanId: "BER-NONREF-DBL", nightly: 150, arrivalOffset: 0, nights: 3, adults: 1, state: "inhouse" },
  { key: "ec_block",    guest: { firstName: "Conference", lastName: "Block" }, ratePlanId: "BER-FLEX-DBL", nightly: 144, arrivalOffset: 0, nights: 8, adults: 2, state: "inhouse" },
  // Folio charge — InHouse with an open guest folio to post against.
  { key: "fo_pass",     guest: { firstName: "Tove", lastName: "Lindqvist" }, ratePlanId: "BER-IBRKF-DBL", nightly: 160, arrivalOffset: 0, nights: 3, adults: 1, state: "inhouse" },
  { key: "fo_ibrahim",  guest: { firstName: "Hana", lastName: "Ibrahim" },  ratePlanId: "BER-FLEX-DBL",   nightly: 140, arrivalOffset: 0, nights: 3, adults: 1, state: "inhouse" },
  { key: "fo_costa",    guest: { firstName: "Mateus", lastName: "Costa" },  ratePlanId: "BER-FLEX-DBL",   nightly: 155, arrivalOffset: 0, nights: 3, adults: 2, state: "inhouse" },
  // Rate override — a corporate account, on the corporate rate plan the story names.
  { key: "ro_corporate", guest: { firstName: "Katrin", lastName: "Hasenclever" }, ratePlanId: "BER-APALEO-DBL", nightly: 165, arrivalOffset: 1, nights: 3, adults: 1, state: "confirmed_unassigned" },
  // Force-manage — the corporate partner asking for one night inside a closure.
  { key: "fm_weber",    guest: { firstName: "Jan", lastName: "Weber" },     ratePlanId: "BER-APALEO-DBL", nightly: 170, arrivalOffset: 1, nights: 1, adults: 1, state: "confirmed_unassigned" },
];

export interface SandboxBinding {
  reservationId: string;
  folioId: string | null;
  propertyId: string;
  /** Every reservation in the party — a 3-room family books three. */
  partyReservationIds: string[];
  status: string;
  unitName: string | null;
  arrival: string;
  departure: string;
}

export interface SandboxResult {
  propertyId: string;
  companyId: number;
  bindings: Record<string, SandboxBinding>;
  created: string[];
  reused: string[];
  repaired: string[];
  orphansCancelled: string[];
  errors: Array<{ key: string; error: string }>;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
function dayOffset(days: number): string {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
}

function tagFor(companyId: number, key: string): string {
  return `stay-reset:co${companyId}:${key}`;
}

interface ApaleoReservation {
  id: string;
  status?: string;
  arrival?: string;
  departure?: string;
  guestComment?: string;
  unit?: { id?: string; name?: string };
  bookingId?: string;
}

/** Every reservation at the property, paged, so tagged ones can be found by comment. */
async function listReservations(propertyId: string): Promise<ApaleoReservation[]> {
  const out: ApaleoReservation[] = [];
  for (let offset = 0; offset < 500; offset += 100) {
    const qs = buildQueryString({ propertyIds: propertyId, pageSize: 100, offset, expand: "timeSlices" });
    const page = await apaleoFetch<{ reservations?: ApaleoReservation[] }>(`/booking/v1/reservations${qs}`);
    const rs = page.reservations ?? [];
    out.push(...rs);
    if (rs.length < 100) break;
  }
  return out;
}

async function mainFolioId(reservationId: string): Promise<string | null> {
  try {
    // `reservationIds`, PLURAL. The singular spelling is not rejected — it is ignored, and
    // the endpoint returns all 230 folios in the account, so every slot bound to whichever
    // folio happened to sort first. A filter that silently does nothing is worse than one
    // that errors, and this one cost a full provisioning run.
    const qs = buildQueryString({ reservationIds: reservationId });
    const r = await apaleoFetch<{ folios?: Array<{ id: string; type?: string; isMainFolio?: boolean }> }>(`/finance/v1/folios${qs}`);
    const folios = r.folios ?? [];
    const main = folios.find((f) => f.isMainFolio) ?? folios.find((f) => f.type === "Guest") ?? folios[0];
    return main?.id ?? null;
  } catch {
    return null;
  }
}

async function createSlot(slot: SandboxSlot, companyId: number, propertyId: string): Promise<string[]> {
  const arrival = dayOffset(slot.arrivalOffset);
  const departure = dayOffset(slot.arrivalOffset + slot.nights);
  const timeSlices = Array.from({ length: slot.nights }, () => ({
    ratePlanId: slot.ratePlanId,
    totalAmount: { amount: slot.nightly, currency: "EUR" },
  }));
  const one = (suffix: string) => ({
    arrival,
    departure,
    adults: slot.adults,
    ...(slot.childrenAges?.length ? { childrenAges: slot.childrenAges } : {}),
    channelCode: "Direct",
    guaranteeType: "Prepayment",
    primaryGuest: { firstName: slot.guest.firstName, lastName: slot.guest.lastName + suffix },
    guestComment: tagFor(companyId, slot.key),
    timeSlices,
  });
  const reservations = slot.rooms && slot.rooms > 1
    ? Array.from({ length: slot.rooms }, (_, i) => one(i === 0 ? "" : ` (room ${i + 1})`))
    : [one("")];

  const booking = await apaleoFetch<{ reservationIds?: Array<{ id: string }> }>(
    `/booking/v1/bookings/$force`,
    {
      method: "POST",
      body: JSON.stringify({
        booker: { firstName: "VDA", lastName: "Stay Agent demo", email: BOOKER_EMAIL },
        comment: `VDA Stay Agent demo — ${tagFor(companyId, slot.key)} — property ${propertyId}`,
        reservations,
      }),
    },
  );
  return (booking.reservationIds ?? []).map((r) => r.id);
}

const action = (id: string, verb: string) =>
  apaleoFetch(`/booking/v1/reservation-actions/${encodeURIComponent(id)}/${verb}`, { method: "PUT" });

/** Drive one reservation to the state its slot needs. Returns what had to change. */
async function driveToState(res: ApaleoReservation, slot: SandboxSlot): Promise<string[]> {
  const changed: string[] = [];
  const id = res.id;
  const wantDeparture = dayOffset(slot.arrivalOffset + slot.nights);

  // An approved early check-out SHORTENS the reservation. Put the nights back, or the card
  // that says "4 nights early" is pointing at a stay that no longer has them.
  if (res.departure && res.departure.slice(0, 10) !== wantDeparture) {
    await apaleoFetch(`/booking/v1/reservations/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify([{ op: "replace", path: "/departure", value: wantDeparture }]),
    });
    changed.push("departure");
  }

  if (slot.state === "confirmed_unassigned") {
    // An approved assignment ASSIGNS a unit. Hand it back so the card has something to ask for.
    if (res.unit?.id) {
      await action(id, "unassign-units");
      changed.push("unassigned");
    }
  } else {
    if (!res.unit?.id) { await action(id, "assign-unit"); changed.push("assigned"); }
    if (res.status !== "InHouse") { await action(id, "checkin"); changed.push("checked-in"); }
  }
  return changed;
}

/**
 * Make the sandbox match SANDBOX_SLOTS and return the id bindings the seeded cards use.
 * Never throws for one bad slot — a sandbox failure must degrade the panel, not take the
 * whole reset down, so failures are collected and reported.
 */
export async function ensureStayDemoSandbox(companyId: number, propertyId: string): Promise<SandboxResult> {
  const result: SandboxResult = {
    propertyId, companyId, bindings: {}, created: [], reused: [], repaired: [], orphansCancelled: [], errors: [],
  };

  const all = await listReservations(propertyId);
  const byKey = new Map<string, ApaleoReservation[]>();
  const wanted = new Set(SANDBOX_SLOTS.map((s) => s.key));
  const prefix = `stay-reset:co${companyId}:`;

  for (const r of all) {
    const c = String(r.guestComment ?? "");
    if (!c.startsWith(prefix)) continue;
    if (r.status === "Cancelled" || r.status === "CheckedOut" || r.status === "NoShow") continue;
    const key = c.slice(prefix.length).trim();
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(r);
  }

  // A tagged reservation whose key is no longer in the slot list is this demo's own
  // leftover. Cancel it rather than leaving the sandbox to accumulate them.
  for (const [key, rs] of byKey) {
    if (wanted.has(key)) continue;
    for (const r of rs) {
      try {
        if (r.status === "Confirmed") { await action(r.id, "cancel"); result.orphansCancelled.push(r.id); }
      } catch (err) {
        logger.warn({ err, id: r.id }, "[stayDemoSandbox] orphan cancel failed");
      }
    }
  }

  for (const slot of SANDBOX_SLOTS) {
    try {
      let party = (byKey.get(slot.key) ?? []).sort((a, b) => a.id.localeCompare(b.id));
      const needRooms = slot.rooms ?? 1;

      if (party.length < needRooms) {
        const ids = await createSlot(slot, companyId, propertyId);
        result.created.push(slot.key);
        party = [];
        for (const id of ids) {
          party.push(await apaleoFetch<ApaleoReservation>(`/booking/v1/reservations/${encodeURIComponent(id)}`));
        }
      } else {
        result.reused.push(slot.key);
      }

      const changed: string[] = [];
      for (const r of party.slice(0, needRooms)) changed.push(...await driveToState(r, slot));
      if (changed.length && !result.created.includes(slot.key)) result.repaired.push(`${slot.key}(${changed.join("+")})`);

      const head = await apaleoFetch<ApaleoReservation>(`/booking/v1/reservations/${encodeURIComponent(party[0].id)}`);
      result.bindings[slot.key] = {
        reservationId: head.id,
        folioId: await mainFolioId(head.id),
        propertyId,
        partyReservationIds: party.slice(0, needRooms).map((r) => r.id),
        status: String(head.status ?? ""),
        unitName: head.unit?.name ?? null,
        arrival: String(head.arrival ?? "").slice(0, 10),
        departure: String(head.departure ?? "").slice(0, 10),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ err, key: slot.key }, "[stayDemoSandbox] slot failed");
      result.errors.push({ key: slot.key, error: msg.slice(0, 300) });
    }
  }

  return result;
}
