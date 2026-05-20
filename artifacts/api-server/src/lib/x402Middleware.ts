/**
 * x402 Billing Middleware
 *
 * HTTP 402 Payment Required — the standard billing rail for AI agent economies.
 * Applied to governance API routes for non-exempt tenants.
 *
 * Flow:
 *   1. Extract companyId from route params (or request body)
 *   2. If tenant is x402Exempt → pass through (citizenM primary tenant)
 *   3. Check credit balance
 *   4. If balance < cost → return 402 with structured payment body
 *   5. Deduct credits → continue to route handler
 *
 * The 402 body follows the emerging x402 standard:
 *   { paymentRequired: true, amount, currency, paymentEndpoint, supportedMethods, … }
 */

import { type Request, type Response, type NextFunction } from "express";
import { isX402Exempt, deductCredits, getBalance, type CreditOperation } from "./creditManager.js";
import { logger } from "./logger.js";

export interface X402Options {
  /** Number of credits to deduct for this operation. */
  cost: number;
  /** Rate card key for ledger entry. */
  operation: CreditOperation;
  /** Human-readable description recorded in the ledger. */
  description: string;
  /**
   * How to resolve the companyId from the request.
   * Defaults to req.params.companyId → req.body.companyId.
   */
  getCompanyId?: (req: Request) => number | null;
}

/**
 * Returns an Express middleware that enforces x402 billing for the given operation.
 */
export function x402Middleware(opts: X402Options) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const companyId = opts.getCompanyId
      ? opts.getCompanyId(req)
      : resolveCompanyId(req);

    if (companyId === null || isNaN(companyId)) {
      next();
      return;
    }

    try {
      // Exempt tenants (citizenM primary tenant) pass through unconditionally.
      const exempt = await isX402Exempt(companyId);
      if (exempt) {
        next();
        return;
      }

      // Non-exempt tenant: deduct credits.
      const result = await deductCredits(
        companyId,
        opts.cost,
        opts.operation,
        opts.description,
        `${req.method} ${req.path}`
      );

      if (!result.ok) {
        const balance = result.balance;
        logger.info(
          { companyId, path: req.path, required: opts.cost, balance },
          "[x402] 402 Payment Required"
        );
        res.status(402).json({
          paymentRequired: true,
          amount: opts.cost,
          currency: "credits",
          balance,
          required: opts.cost,
          paymentEndpoint: "/api/billing/topup",
          supportedMethods: ["credits", "stripe"],
          message: `Insufficient credits. Balance: ${balance}, required: ${opts.cost}. Top up at /api/billing/topup.`,
          topupPackages: TOPUP_PACKAGES,
        });
        return;
      }

      // Attach debit context for downstream route handlers.
      (req as Request & { x402Deducted?: number }).x402Deducted = opts.cost;
      next();
    } catch (err) {
      logger.error({ err, companyId, path: req.path }, "[x402] Middleware error");
      // On unexpected error, fail open (don't block governance calls over a billing glitch).
      next();
    }
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveCompanyId(req: Request): number | null {
  const fromParams = req.params?.companyId;
  if (fromParams) {
    const n = parseInt(fromParams, 10);
    if (!isNaN(n)) return n;
  }
  const fromBody = (req.body as { companyId?: unknown })?.companyId;
  if (fromBody !== undefined && fromBody !== null) {
    const n = Number(fromBody);
    if (!isNaN(n)) return n;
  }
  return null;
}

// ─── Topup Packages (shown in 402 body) ──────────────────────────────────────

export const TOPUP_PACKAGES = [
  { id: "starter", credits: 100, priceUsd: 9, label: "Starter — 100 credits ($9)" },
  { id: "growth", credits: 500, priceUsd: 39, label: "Growth — 500 credits ($39)" },
  { id: "enterprise", credits: 2000, priceUsd: 129, label: "Enterprise — 2,000 credits ($129)" },
];
