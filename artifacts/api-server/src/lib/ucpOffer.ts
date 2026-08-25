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

import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";

// ─── Offer Token (HMAC-signed BAR binding) ────────────────────────────────────
//
// Rate offers include a `serverToken` — an HMAC-SHA256 of the authoritative
// offer fields (offerId, barRate, propertyId, companyId, validUntil).
// The negotiate endpoint verifies this token before trusting the client-supplied
// barRate. This prevents callers from manipulating barRate to bypass discount ceilings.
//
// Secret: OFFER_HMAC_SECRET env var (required in production).
// If unset in non-production environments a random per-process secret is generated
// so tokens are still unpredictable and tamper-proof, but they do not survive
// server restarts (acceptable for dev/test sessions).
function resolveHmacSecret(): string {
  const envSecret = process.env.OFFER_HMAC_SECRET;
  if (envSecret) return envSecret;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "OFFER_HMAC_SECRET environment variable must be set in production. " +
      "Generate with: openssl rand -base64 32"
    );
  }

  // Non-production: generate a random per-process secret.
  // Tokens cannot be forged externally but are ephemeral (invalid after restart).
  const generated = randomUUID() + randomUUID();
  console.warn(
    "[ucpOffer] OFFER_HMAC_SECRET is not set. Using a random per-process secret. " +
    "UCP offer tokens will expire on server restart. Set OFFER_HMAC_SECRET for persistent sessions."
  );
  return generated;
}

const OFFER_HMAC_SECRET = resolveHmacSecret();

export function signOffer(
  offerId: string,
  barRate: number,
  propertyId: string,
  companyId: number,
  validUntil: string
): string {
  return createHmac("sha256", OFFER_HMAC_SECRET)
    .update(JSON.stringify({ offerId, barRate, propertyId, companyId, validUntil }))
    .digest("base64url");
}

export function verifyOfferToken(
  offerId: string,
  barRate: number,
  propertyId: string,
  companyId: number,
  validUntil: string,
  token: string
): boolean {
  const expected = signOffer(offerId, barRate, propertyId, companyId, validUntil);
  // Constant-time comparison prevents HMAC timing oracle attacks.
  try {
    return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(token, "utf8"));
  } catch {
    return false;
  }
}

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
  /**
   * Top-level shorthand: true = an active Intent Mandate is required to transact.
   * Mirrors terms.mandateRequired for external UCP consumers that check the root schema.
   */
  mandateRequired: boolean;
  /**
   * HMAC-SHA256 token binding offerId, barRate, propertyId, companyId, and validUntil.
   * Present only on negotiable offers (lodging.rate_override).
   * The negotiate endpoint requires this token to prevent barRate manipulation.
   * Include the full offer (or at minimum offerId + serverToken + barRate + validUntil)
   * in `originalOffer` when submitting a counter-offer.
   */
  serverToken?: string;
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
  companyId: number;
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
      // via the property management system GetAvailableUnitGroups. Unit group is committed at reservation phase.
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
      cancellationPolicy: "A Hotel Berlin standard cancellation terms apply",
      governedBy: `${opts.propertyId} Availability Agent governance policy (Apaleo GetAvailableUnitGroups)`,
      mandateRequired: true,
      mandateId: opts.mandateId,
    },
    negotiable: false,
    mandateRequired: true,
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
  const offerId = randomUUID();
  const validUntil = new Date(Date.now() + 30 * 60_000).toISOString();

  // Cryptographically bind the authoritative barRate to this offer.
  // The negotiate endpoint verifies this token so callers cannot manipulate
  // barRate to bypass discount-ceiling checks.
  const serverToken = signOffer(offerId, opts.barRate, opts.propertyId, opts.companyId, validUntil);

  return {
    "@context": "https://ucp.spec/v2026",
    specVersion: "2026.1",
    offerId,
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
      cancellationPolicy: "A Hotel Berlin standard cancellation terms apply",
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
    mandateRequired: true,
    serverToken,
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
      organization: "AI Hospitality Alliance — VDA-MD Platform",
      url: "https://aihospitalityalliance.com",
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
    documentation: `${baseUrl}/.well-known/agent.json`,
  };
}
