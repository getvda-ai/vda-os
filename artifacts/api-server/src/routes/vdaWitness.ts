/**
 * VDA Witness routes — proxy the deployed external witness (witness.getvda.ai).
 *   GET  /api/vda-witness/status   — enabled? endpoint + card summary
 *   POST /api/vda-witness/verify   — independently verify a record/chain (keyless)
 *   GET  /api/vda-witness/report   — EU AI Act Article 12 report (needs WITNESS_API_KEY)
 */
import { Router, type IRouter } from "express";
import { vdaWitnessInfo, verifyRecord, verifyChain, generateReport, fetchWitnessCard, isVdaWitnessEnabled } from "../lib/vdaWitness.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

router.get("/vda-witness/status", async (_req, res) => {
  try {
    const card = await fetchWitnessCard();
    res.json({
      ...vdaWitnessInfo(),
      card: card ? { name: card.name, description: card.description, version: card.version, skills: (card.skills as Array<{ id: string }> | undefined)?.map((s) => s.id) } : null,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "status failed" });
  }
});

router.post("/vda-witness/verify", async (req, res) => {
  try {
    const { record, records } = req.body ?? {};
    const result = Array.isArray(records) ? await verifyChain(records) : await verifyRecord(record);
    res.json({ ok: true, result });
  } catch (err) {
    logger.error({ err }, "vda-witness/verify error");
    res.status(502).json({ error: err instanceof Error ? err.message : "verify failed" });
  }
});

router.get("/vda-witness/report", async (_req, res) => {
  try {
    if (!isVdaWitnessEnabled()) {
      res.status(400).json({ error: "WITNESS_API_KEY not set — the Article 12 report requires a Witness API key." });
      return;
    }
    const report = await generateReport();
    res.json({ ok: true, report });
  } catch (err) {
    logger.error({ err }, "vda-witness/report error");
    res.status(502).json({ error: err instanceof Error ? err.message : "report failed" });
  }
});

export default router;
