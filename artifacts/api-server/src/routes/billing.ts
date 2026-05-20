/**
 * Billing routes — x402 credit wallet management.
 *
 * GET  /api/billing/balance/:companyId  — current credit balance
 * GET  /api/billing/ledger/:companyId   — recent ledger entries
 * POST /api/billing/topup               — add credits (Stripe or dev mode)
 * POST /api/billing/grant               — admin grant (no payment, dev/test only)
 * GET  /api/billing/packages            — topup package catalog
 * GET  /api/billing/all-balances        — all companies with balances (admin panel)
 */

import { Router } from "express";
import { db, companies } from "@workspace/db";
import { addCredits, getBalance, getLedger, RATE_CARD } from "../lib/creditManager.js";
import { TOPUP_PACKAGES } from "../lib/x402Middleware.js";
import { logger } from "../lib/logger.js";
import { eq } from "drizzle-orm";

const router = Router();

// ─── GET /api/billing/balance/:companyId ──────────────────────────────────────
router.get("/billing/balance/:companyId", async (req, res) => {
  try {
    const companyId = parseInt(req.params.companyId, 10);
    if (isNaN(companyId)) return res.status(400).json({ error: "Invalid companyId" });

    const [company] = await db
      .select({ id: companies.id, companyName: companies.companyName, x402Exempt: companies.x402Exempt })
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1);

    if (!company) return res.status(404).json({ error: "Company not found" });

    const balance = await getBalance(companyId);
    return res.json({
      companyId,
      companyName: company.companyName,
      x402Exempt: company.x402Exempt,
      balance,
      rateCard: RATE_CARD,
    });
  } catch (err) {
    logger.error({ err }, "[billing] balance error");
    return res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─── GET /api/billing/ledger/:companyId ───────────────────────────────────────
router.get("/billing/ledger/:companyId", async (req, res) => {
  try {
    const companyId = parseInt(req.params.companyId, 10);
    if (isNaN(companyId)) return res.status(400).json({ error: "Invalid companyId" });

    const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 200);
    const entries = await getLedger(companyId, limit);
    return res.json({ companyId, entries });
  } catch (err) {
    logger.error({ err }, "[billing] ledger error");
    return res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─── GET /api/billing/packages ────────────────────────────────────────────────
router.get("/billing/packages", (_req, res) => {
  res.json({ packages: TOPUP_PACKAGES });
});

// ─── GET /api/billing/all-balances ────────────────────────────────────────────
// Admin: returns all companies with their current credit balance and exempt flag.
router.get("/billing/all-balances", async (_req, res) => {
  try {
    const allCompanies = await db
      .select({
        id: companies.id,
        companyName: companies.companyName,
        industry: companies.industry,
        x402Exempt: companies.x402Exempt,
      })
      .from(companies)
      .orderBy(companies.id);

    const rows = await Promise.all(
      allCompanies.map(async (c) => ({
        ...c,
        balance: await getBalance(c.id),
      }))
    );

    return res.json({ companies: rows, rateCard: RATE_CARD, packages: TOPUP_PACKAGES });
  } catch (err) {
    logger.error({ err }, "[billing] all-balances error");
    return res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─── POST /api/billing/topup ──────────────────────────────────────────────────
/**
 * Top-up a company's credit wallet.
 *
 * In dev/demo mode (no STRIPE_SECRET_KEY): credits are added directly.
 * In production with STRIPE_SECRET_KEY: validates Stripe payment intent before crediting.
 *
 * Body: { companyId, packageId } or { companyId, credits, stripePaymentIntentId? }
 */
router.post("/billing/topup", async (req, res) => {
  try {
    const { companyId, packageId, credits: customCredits, stripePaymentIntentId } = req.body as {
      companyId?: number;
      packageId?: string;
      credits?: number;
      stripePaymentIntentId?: string;
    };

    if (!companyId) return res.status(400).json({ error: "companyId is required" });

    const [company] = await db
      .select({ id: companies.id, companyName: companies.companyName })
      .from(companies)
      .where(eq(companies.id, Number(companyId)))
      .limit(1);
    if (!company) return res.status(404).json({ error: "Company not found" });

    let creditsToAdd: number;
    let priceUsd: number | null = null;
    let packageLabel: string;

    if (packageId) {
      const pkg = TOPUP_PACKAGES.find((p) => p.id === packageId);
      if (!pkg) return res.status(400).json({ error: `Unknown packageId: ${packageId}`, packages: TOPUP_PACKAGES });
      creditsToAdd = pkg.credits;
      priceUsd = pkg.priceUsd;
      packageLabel = pkg.label;
    } else if (customCredits && Number(customCredits) > 0) {
      creditsToAdd = Math.floor(Number(customCredits));
      packageLabel = `Custom: ${creditsToAdd} credits`;
    } else {
      return res.status(400).json({ error: "packageId or credits is required" });
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    let operation: "topup_stripe" | "topup_admin" = "topup_admin";
    let sourceRef = stripePaymentIntentId ?? "admin_direct";

    if (stripeKey && stripePaymentIntentId) {
      // Production path: verify Stripe payment intent before adding credits.
      const stripeModule = await import("stripe").catch(() => null);
      if (stripeModule) {
        const Stripe = stripeModule.default;
        const stripe = new Stripe(stripeKey, { apiVersion: "2025-01-27.acacia" } as Parameters<typeof Stripe>[1]);
        const intent = await stripe.paymentIntents.retrieve(stripePaymentIntentId);
        if (intent.status !== "succeeded") {
          return res.status(402).json({
            error: "Payment intent not succeeded",
            status: intent.status,
            paymentIntentId: stripePaymentIntentId,
          });
        }
        operation = "topup_stripe";
        sourceRef = stripePaymentIntentId;
        logger.info({ companyId, stripePaymentIntentId, creditsToAdd }, "[billing] Stripe payment verified");
      }
    } else if (stripeKey && !stripePaymentIntentId) {
      return res.status(400).json({
        error: "stripePaymentIntentId is required when STRIPE_SECRET_KEY is configured",
        message: "Complete Stripe checkout and provide the resulting paymentIntentId",
      });
    }
    // No STRIPE_SECRET_KEY = dev/demo mode — credits added directly.

    const balanceAfter = await addCredits(
      Number(companyId),
      creditsToAdd,
      operation,
      `Topup: ${packageLabel}${priceUsd ? ` ($${priceUsd})` : ""}`,
      sourceRef
    );

    logger.info({ companyId, creditsToAdd, operation, balanceAfter }, "[billing] Topup complete");
    return res.json({
      ok: true,
      companyId: Number(companyId),
      companyName: company.companyName,
      creditsAdded: creditsToAdd,
      balanceAfter,
      operation,
      message: `${creditsToAdd} credits added to ${company.companyName}`,
    });
  } catch (err) {
    logger.error({ err }, "[billing] topup error");
    return res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─── POST /api/billing/grant ──────────────────────────────────────────────────
// Admin-only grant (dev/test). Blocked in production via NODE_ENV check.
router.post("/billing/grant", async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(404).json({ error: "Not found" });
  }
  try {
    const { companyId, credits, reason } = req.body as {
      companyId?: number;
      credits?: number;
      reason?: string;
    };

    if (!companyId || !credits || credits <= 0) {
      return res.status(400).json({ error: "companyId and positive credits are required" });
    }

    const balanceAfter = await addCredits(
      Number(companyId),
      Number(credits),
      "initial_grant",
      reason ?? `Admin grant: ${credits} credits`,
      "admin_grant"
    );

    return res.json({ ok: true, companyId: Number(companyId), creditsAdded: Number(credits), balanceAfter });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

export default router;
