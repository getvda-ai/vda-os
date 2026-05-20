/**
 * UCP (Universal Commerce Protocol) 2026 routes.
 *
 * POST /api/ucp/negotiate — validates a counter-offer from an external booking agent
 *   against the Rate Agent's active mandate ceilings and responds with:
 *   - "accept"  — counter-offer is within mandate ceilings, returns a confirmed UCP offer
 *   - "counter" — proposal exceeds ceilings, returns the maximum offer the platform can accept
 *   - "reject"  — no active mandate or mandate revoked/expired
 */

import { Router } from "express";
import { getActiveMandate, checkMandateCeiling } from "../lib/mandateIssuer.js";
import { buildRateOffer, type UcpOffer } from "../lib/ucpOffer.js";
import { logger } from "../lib/logger.js";

const router = Router();

// ─── POST /api/ucp/negotiate ──────────────────────────────────────────────────
/**
 * Counter-offer negotiation against the Rate Agent's active mandate.
 *
 * Request body:
 * {
 *   offerType: "lodging.rate_override",   // only rate_override is negotiable
 *   companyId: 1,
 *   propertyId: "MUC",
 *   counter: {
 *     price: { amount: 120, currency: "EUR" },
 *     barRate: 150,                        // original BAR rate (to compute discount %)
 *     ratePlanId?: "RPC-MUC-CORP"          // optional Apaleo rate plan
 *   }
 * }
 *
 * Response:
 * {
 *   result: "accept" | "counter" | "reject",
 *   ucpOffer?: UcpOffer,   // present on accept or counter
 *   reason?: string,
 *   mandateId?: string
 * }
 */
router.post("/ucp/negotiate", async (req, res) => {
  try {
    const { offerType, companyId, propertyId, counter } = req.body as {
      offerType?: string;
      companyId?: number;
      propertyId?: string;
      counter?: {
        price?: { amount?: number; currency?: string };
        barRate?: number;
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

    const counterAmount = Number(counter.price.amount);
    const barRate = Number(counter.barRate ?? 150);
    const ratePlanId = counter.ratePlanId ?? null;
    const currency = counter.price.currency ?? "EUR";

    if (counterAmount <= 0 || isNaN(counterAmount)) {
      return res.status(400).json({ error: "counter.price.amount must be a positive number" });
    }

    const discountPct = barRate > 0
      ? Math.round(((barRate - counterAmount) / barRate) * 100)
      : 0;

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
      // Counter-offer is within mandate ceilings — accept it.
      const ucpOffer: UcpOffer = buildRateOffer({
        propertyId,
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
