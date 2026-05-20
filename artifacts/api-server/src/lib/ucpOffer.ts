/**
 * UCP (Universal Commerce Protocol) 2026 offer schema helpers.
 *
 * UCP is the inter-agent commerce standard (2026, Shopify/Google/payment processors)
 * that allows external booking agents (Booking.com AI, Google Travel Agent, corporate
 * travel platforms) to discover and transact with hospitality providers.
 *
 * Availability Agent PASS → `buildAvailabilityOffer()` (offer type: lodging.unit_group)
 * Rate Agent PASS         → `buildRateOffer()`         (offer type: lodging.rate_override)
 *
 * Conformance: UCP v2026.1 JSON offer schema.
 */

import { randomUUID } from "node:crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export type UcpOfferType = "lodging.unit_group" | "lodging.rate_override";

export interface UcpOfferItem {
  type: UcpOfferType;
  propertyId: string;
  /** Apaleo unit group code, e.g. "STD". Null when not resolved at offer time. */
  unitGroup: string | null;
  /** Apaleo rate plan ID. Null when not resolved at offer time. */
  ratePlanId: string | null;
}

export interface UcpOfferPrice {
  /** Monetary amount in the given currency. Null for availability offers (price via Rate Agent). */
  amount: number | null;
  currency: string;
  unit: "per_night" | "total" | "per_pct_discount";
}

export interface UcpOfferValidity {
  /** ISO 8601 expiry timestamp. */
  validUntil: string;
}

export interface UcpOfferTerms {
  cancellationPolicy: string;
  /** Human-readable reference to the governance policy that governs this offer. */
  governedBy: string;
  /** True = caller must present an active AP2 Intent Mandate to transact. */
  mandateRequired: boolean;
  /** The active Intent Mandate ID if known at offer time. */
  mandateId: string | null;
}

export interface UcpOffer {
  "@context": "https://ucp.spec/v2026";
  specVersion: "2026.1";
  offerId: string;
  item: UcpOfferItem;
  price: UcpOfferPrice;
  validity: UcpOfferValidity;
  terms: UcpOfferTerms;
  /** True = caller may submit a counter-offer to POST /api/ucp/negotiate. */
  negotiable: boolean;
}

// ─── Builder Options ──────────────────────────────────────────────────────────

export interface BuildAvailabilityOfferOpts {
  propertyId: string;
  arrival: string;
  departure: string;
  mandateId: string | null;
}

export interface BuildRateOfferOpts {
  propertyId: string;
  requestedRate: number;
  barRate: number;
  ratePlanId: string | null;
  discountPct: number;
  mandateId: string | null;
}

// ─── Builders ─────────────────────────────────────────────────────────────────

/**
 * Builds a UCP offer for an Availability Agent PASS decision.
 *
 * Apaleo data used: `propertyId` (from PMS), `arrival`/`departure` (from request),
 * which are the same values passed to `GetAvailableUnitGroups` via MCP.
 *
 * `item.unitGroup` is null by design at this phase: the Availability Agent evaluates
 * aggregate unit capacity at the property level (not a specific unit reservation).
 * Unit group selection and commitment happen at the Reservation Bot phase. This is
 * consistent with UCP phase semantics — the availability offer is a "can-fulfill"
 * signal; `unitGroup` is resolved and committed by the reservation flow.
 *
 * The offer is non-negotiable: units are either available or they aren't.
 * Pricing negotiation is handled by the Rate Agent offer (`lodging.rate_override`).
 */
export function buildAvailabilityOffer(opts: BuildAvailabilityOfferOpts): UcpOffer {
  const validUntil = opts.departure
    ? new Date(`${opts.departure}T12:00:00Z`).toISOString()
    : new Date(Date.now() + 30 * 60_000).toISOString();

  return {
    "@context": "https://ucp.spec/v2026",
    specVersion: "2026.1",
    offerId: randomUUID(),
    item: {
      type: "lodging.unit_group",
      propertyId: opts.propertyId,
      // null by design: the Availability Agent evaluates capacity at property level
      // via Apaleo GetAvailableUnitGroups. Unit group is committed at reservation phase.
      unitGroup: null,
      ratePlanId: null,
    },
    price: {
      // Price is not determined at availability-check time — caller must invoke
      // the Rate Agent (POST /api/agents/rate) or negotiate via POST /api/ucp/negotiate.
      amount: null,
      currency: "EUR",
      unit: "per_night",
    },
    validity: { validUntil },
    terms: {
      cancellationPolicy: "citizenM standard cancellation terms apply",
      governedBy: `${opts.propertyId} Availability Agent governance policy (Apaleo GetAvailableUnitGroups)`,
      mandateRequired: true,
      mandateId: opts.mandateId,
    },
    negotiable: false,
  };
}

/**
 * Builds a UCP offer for a Rate Agent PASS decision.
 *
 * Apaleo data used:
 *   - `barRate` — live BAR fetched from Apaleo ListRatePlans / GetReport by the Rate Agent
 *   - `requestedRate` — the proposed rate (may equal BAR or be a discount)
 *   - `ratePlanId` — Apaleo rate plan identifier (e.g. "RPC-MUC-CORP")
 *
 * The rate offer commits the platform to the approved rate for 30 minutes.
 * It is negotiable — the caller may submit a counter-offer via POST /api/ucp/negotiate,
 * which validates the counter against the Rate Agent's active mandate ceilings.
 */
export function buildRateOffer(opts: BuildRateOfferOpts): UcpOffer {
  const validUntil = new Date(Date.now() + 30 * 60_000).toISOString();

  return {
    "@context": "https://ucp.spec/v2026",
    specVersion: "2026.1",
    offerId: randomUUID(),
    item: {
      type: "lodging.rate_override",
      propertyId: opts.propertyId,
      // null: unit group is resolved at reservation phase, not rate phase
      unitGroup: null,
      // Apaleo rate plan identifier — populated from caller's Apaleo data
      ratePlanId: opts.ratePlanId,
    },
    price: {
      // Approved rate sourced from Apaleo: requestedRate vs BAR from ListRatePlans/GetReport
      amount: opts.requestedRate,
      currency: "EUR",
      unit: "per_night",
    },
    validity: { validUntil },
    terms: {
      cancellationPolicy: "citizenM standard cancellation terms apply",
      governedBy: [
        `${opts.propertyId} Rate Agent governance policy`,
        `Approved: €${opts.requestedRate}/night`,
        opts.discountPct > 0
          ? `(${opts.discountPct}% discount vs Apaleo BAR €${opts.barRate})`
          : "(BAR rate — no discount)",
      ].join(" "),
      mandateRequired: true,
      mandateId: opts.mandateId,
    },
    negotiable: true,
  };
}

// ─── Service Descriptor ───────────────────────────────────────────────────────

export interface UcpServiceDescriptor {
  "@context": "https://ucp.spec/v2026";
  specVersion: "2026.1";
  provider: { organization: string; url: string };
  offerTypes: UcpOfferType[];
  agents: {
    availability: { agentCardTemplate: string; offerType: UcpOfferType; description: string };
    rate: { agentCardTemplate: string; offerType: UcpOfferType; description: string };
  };
  negotiationEndpoint: string;
  authSchemes: string[];
  documentation: string;
}

export function buildUcpServiceDescriptor(baseUrl: string): UcpServiceDescriptor {
  return {
    "@context": "https://ucp.spec/v2026",
    specVersion: "2026.1",
    provider: {
      organization: "citizenM Hotels — VDA-MD Platform",
      url: "https://citizenm.com",
    },
    offerTypes: ["lodging.unit_group", "lodging.rate_override"],
    agents: {
      availability: {
        agentCardTemplate: `${baseUrl}/api/a2a/{companyId}/availability-agent/agent.json`,
        offerType: "lodging.unit_group",
        description: "Returns governed PASS/FAIL availability decisions with UCP offer blocks for available unit groups.",
      },
      rate: {
        agentCardTemplate: `${baseUrl}/api/a2a/{companyId}/rate-agent/agent.json`,
        offerType: "lodging.rate_override",
        description: "Returns governed rate override decisions with negotiable UCP offer blocks. Counter-offers accepted via negotiationEndpoint.",
      },
    },
    negotiationEndpoint: `${baseUrl}/api/ucp/negotiate`,
    authSchemes: ["bearer"],
    documentation: `${baseUrl}/api/well-known/agent.json`,
  };
}
