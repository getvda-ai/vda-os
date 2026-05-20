/**
 * UCP (Universal Commerce Protocol) 2026 routes.
 *
 * POST /api/ucp/negotiate — validates a counter-offer from an external booking agent
 *   against the Rate Agent's active mandate ceilings.
 *
 * Trust model: the caller MUST supply the `originalOffer` block they received from
 * the Rate Agent (offerId + barRate + validUntil + serverToken). The endpoint verifies
 * the HMAC-signed serverToken so the barRate cannot be manipulated client-side.
 * Mandate ceiling is then applied against the verified barRate.
 *
 * Responses:
 *   - "accept"  — counter-offer is within mandate ceilings, returns a confirmed UCP offer
 *   - "counter" — proposal exceeds ceilings, returns the maximum offer the platform can accept
 *   - "reject"  — invalid/expired token, no active mandate, or non-negotiable type
 */

import { Router } from "express";
import { getActiveMandate, checkMandateCeiling } from "../lib/mandateIssuer.js";
import { buildRateOffer, verifyOfferToken, type UcpOffer } from "../lib/ucpOffer.js";
import { logger } from "../lib/logger.js";
import { verifyAgentCredentialMiddleware } from "../lib/verifyAgentCredential.js";

const router = Router();

// ─── POST /api/ucp/negotiate ──────────────────────────────────────────────────
/**
 * Counter-offer negotiation against the Rate Agent's active mandate.
 *
 * Authentication: Authorization: Bearer <vcBase64url>
 *   Any valid VDA-MD agent VC is accepted. The VC's company_id must match
 *   the companyId in the request body (tenant binding enforced by middleware).
 *
 * Request body:
 * {
 *   offerType: "lodging.rate_override",   // only rate_override is negotiable
 *   companyId: 1,
 *   propertyId: "MUC",
 *   originalOffer: {                      // the UCP offer received from the Rate Agent
 *     offerId: "uuid",
 *     barRate: 150,                       // authoritative BAR — verified via serverToken
 *     validUntil: "ISO timestamp",
 *     serverToken: "hmac-token"           // serverToken from the Rate Agent's ucpOffer
 *   },
 *   counter: {
 *     price: { amount: 120, currency: "EUR" },
 *     ratePlanId?: "RPC-MUC-CORP"
 *   }
 * }
 */
router.post("/ucp/negotiate", verifyAgentCredentialMiddleware, async (req, res) => {
  try {
    const { offerType, companyId, propertyId, originalOffer, counter } = req.body as {
      offerType?: string;
      companyId?: number;
      propertyId?: string;
      originalOffer?: {
        offerId?: string;
        barRate?: number;
        validUntil?: string;
        serverToken?: string;
      };
      counter?: {
        price?: { amount?: number; currency?: string };
        ratePlanId?: string;
      };
    };

    if (!companyId || !propertyId || !counter?.price?.amount) {
      return res.status(400).json({
        error: "companyId, propertyId, and counter.price.amount are required",
      });
    }

    if (offerType && offerType !== "lodging.rate_override") {
      return res.status(400).json({
        error: `offerType '${offerType}' is not negotiable. Only lodging.rate_override supports counter-offers.`,
        result: "reject",
        reason: "offer_type_not_negotiable",
      });
    }

    // ── Verify originalOffer serverToken ────────────────────────────────────
    // Require callers to present the signed token from the Rate Agent's original offer.
    // This prevents barRate manipulation: the token cryptographically binds offerId,
    // barRate, propertyId, companyId, and validUntil.
    if (!originalOffer?.offerId || !originalOffer.serverToken || !originalOffer.barRate || !originalOffer.validUntil) {
      return res.status(400).json({
        error: "originalOffer (with offerId, barRate, validUntil, serverToken) is required. " +
          "Include the full ucpOffer you received from the Rate Agent in your counter-offer request.",
        result: "reject",
        reason: "missing_original_offer",
      });
    }

    const tokenValid = verifyOfferToken(
      originalOffer.offerId,
      Number(originalOffer.barRate),
      propertyId,
      Number(companyId),
      originalOffer.validUntil,
      originalOffer.serverToken
    );

    if (!tokenValid) {
      logger.warn({ companyId, propertyId, offerId: originalOffer.offerId }, "[UCP] Negotiate — offer token invalid");
      return res.status(400).json({
        result: "reject",
        reason: "offer_token_invalid",
        error: "originalOffer.serverToken is invalid. The offer fields may have been tampered with.",
      });
    }

    // Check offer expiry (validUntil from the original offer — Rate Agent sets 30min)
    if (new Date(originalOffer.validUntil) < new Date()) {
      return res.status(400).json({
        result: "reject",
        reason: "offer_expired",
        error: "The original offer has expired. Request a fresh rate from the Rate Agent.",
      });
    }

    // ── Compute discount against verified barRate ────────────────────────────
    const counterAmount = Number(counter.price.amount);
    const barRate = Number(originalOffer.barRate);  // verified via token — trust this
    const ratePlanId = counter.ratePlanId ?? null;
    const currency = counter.price.currency ?? "EUR";

    if (counterAmount <= 0 || isNaN(counterAmount)) {
      return res.status(400).json({ error: "counter.price.amount must be a positive number" });
    }

    const discountPct = barRate > 0
      ? Math.round(((barRate - counterAmount) / barRate) * 100)
      : 0;

    // ── Check mandate ceiling ────────────────────────────────────────────────
    const mandate = await getActiveMandate("rate-agent", Number(companyId)).catch(() => null);

    if (!mandate) {
      logger.info({ companyId, propertyId, counterAmount }, "[UCP] Negotiate — no active mandate, reject");
      return res.json({
        result: "reject",
        reason: "no_active_mandate",
        message: "No active Rate Agent mandate for this company. Issue an Intent Mandate before negotiating.",
      });
    }

    const ceiling = checkMandateCeiling(mandate, "discount", discountPct);

    if (ceiling.allowed) {
      const ucpOffer: UcpOffer = buildRateOffer({
        propertyId,
        companyId: Number(companyId),
        requestedRate: counterAmount,
        barRate,
        ratePlanId,
        discountPct,
        mandateId: mandate.mandateId,
      });

      logger.info(
        { companyId, propertyId, counterAmount, discountPct, mandateId: mandate.mandateId },
        "[UCP] Negotiate — accepted"
      );
      return res.json({
        result: "accept",
        ucpOffer,
        mandateId: mandate.mandateId,
      });
    }

    // Counter-offer exceeds mandate ceiling — respond with the maximum allowed rate.
    const maxDiscountPct = ceiling.ceiling ?? 0;
    const maxAllowedRate = barRate > 0
      ? Math.round(barRate * (1 - maxDiscountPct / 100))
      : barRate;

    const counterOffer: UcpOffer = buildRateOffer({
      propertyId,
      companyId: Number(companyId),
      requestedRate: maxAllowedRate,
      barRate,
      ratePlanId,
      discountPct: maxDiscountPct,
      mandateId: mandate.mandateId,
    });

    logger.info(
      { companyId, propertyId, counterAmount, discountPct, maxDiscountPct, mandateId: mandate.mandateId },
      "[UCP] Negotiate — counter (ceiling exceeded)"
    );
    return res.json({
      result: "counter",
      ucpOffer: counterOffer,
      mandateId: mandate.mandateId,
      reason: `Requested discount (${discountPct}%) exceeds mandate ceiling (${maxDiscountPct}%). Counter-offer at maximum allowed rate.`,
    });
  } catch (err: unknown) {
    logger.error({ err }, "[UCP] Negotiate error");
    return res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

export default router;
