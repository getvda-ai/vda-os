import { Router } from "express";
import { db, companies } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router = Router();

router.get("/companies", async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(companies)
      .orderBy(desc(companies.savedAt));
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/companies", async (req, res) => {
  try {
    const {
      companyName,
      websiteUrl,
      industry,
      brandContext,
      filesCount,
      savedAt,
      uploadedFiles,
      apaleoPropertyId,
    } = req.body;

    if (!companyName || !industry) {
      return res.status(400).json({ error: "companyName and industry are required" });
    }

    const [row] = await db
      .insert(companies)
      .values({
        companyName,
        websiteUrl: websiteUrl || null,
        industry,
        brandContext: brandContext ? brandContext.slice(0, 8000) : null,
        filesCount: filesCount || 0,
        savedAt: savedAt || Date.now(),
        uploadedFiles: uploadedFiles || null,
        apaleoPropertyId: apaleoPropertyId || null,
      })
      .returning();

    return res.json(row);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete("/companies/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    await db.delete(companies).where(eq(companies.id, id));
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
