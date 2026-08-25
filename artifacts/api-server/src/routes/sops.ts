/**
 * SOP ingestion — the BUSINESS source of truth the Stay Agent consults per stage.
 *
 *   POST /api/sops/ingest   scan the /sops folder, or ingest an uploaded doc
 *   GET  /api/sops          list ingested documents (per company)
 *   GET  /api/sops/:id      return a document's clauses
 *
 * Documents are split into heading-anchored clauses so the decision engine can
 * cite the specific clause it applied. Stage is inferred from front-matter
 * (`stage: check_in`) or filename, defaulting to `global`. Markdown/txt are
 * first-class; pdf/docx are accepted only when pre-converted to markdown.
 */
import { Router, type IRouter } from "express";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { db, sopDocuments, sopClauses } from "@workspace/db";
import { and, eq, inArray, desc } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

export const TEXT_EXTS = new Set([".md", ".markdown", ".txt"]);

// ── /sops folder resolution (repo root). Operators drop SOP files here. ──────
export function resolveSopsDir(): string | null {
  const candidates = [
    process.env.SOPS_DIR,
    path.join(process.cwd(), "sops"),
    path.resolve(process.cwd(), "../../sops"),
    path.resolve(process.cwd(), "../sops"),
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

// ── Front-matter + stage inference ───────────────────────────────────────────
function parseFrontMatter(content: string): { meta: Record<string, unknown>; body: string } {
  const m = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!m) return { meta: {}, body: content };
  let meta: Record<string, unknown> = {};
  try {
    const loaded = yaml.load(m[1]);
    if (loaded && typeof loaded === "object") meta = loaded as Record<string, unknown>;
  } catch {
    // Malformed front-matter → treat whole file as body.
    return { meta: {}, body: content };
  }
  return { meta, body: content.slice(m[0].length) };
}

const VALID_STAGES = new Set(["check_in", "in_stay", "check_out", "global"]);

function inferStage(filename: string, meta: Record<string, unknown>): string {
  const fromMeta = typeof meta.stage === "string" ? meta.stage.trim().toLowerCase() : "";
  if (VALID_STAGES.has(fromMeta)) return fromMeta;
  const f = filename.toLowerCase();
  if (/check[-_ ]?in|checkin|arrival/.test(f)) return "check_in";
  if (/check[-_ ]?out|checkout|departure/.test(f)) return "check_out";
  if (/in[-_ ]?stay|instay|in-house|inhouse/.test(f)) return "in_stay";
  return "global";
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "clause";
}

interface ParsedClause {
  anchor: string;
  heading: string;
  text: string;
}

// ── Heading-anchored clause chunker ──────────────────────────────────────────
function chunkClauses(body: string, docTitle: string): ParsedClause[] {
  const lines = body.split(/\r?\n/);
  const clauses: ParsedClause[] = [];
  let curHeading = docTitle;
  let curLines: string[] = [];
  const headingRe = /^(#{1,6})\s+(.*)$/;

  const flush = () => {
    const text = curLines.join("\n").trim();
    // Skip empty preamble under the H1 title; keep clauses that have real text.
    if (text.length > 0) {
      clauses.push({ anchor: slugify(curHeading), heading: curHeading.trim(), text });
    }
  };

  for (const line of lines) {
    const h = line.match(headingRe);
    // Any heading of level >= 2 starts a new clause. Level-1 (# Title) sets the
    // document title context but is not itself a clause boundary body.
    if (h && h[1].length >= 2) {
      flush();
      curHeading = h[2];
      curLines = [];
    } else if (h && h[1].length === 1) {
      // H1 — treat as title; do not accumulate the marker itself.
      curHeading = h[2] || docTitle;
      curLines = [];
    } else {
      curLines.push(line);
    }
  }
  flush();
  return clauses;
}

// ── Ingest one document (idempotent per company+filename) ────────────────────
export async function ingestDocument(params: {
  companyId: number;
  filename: string;
  content: string;
  sourceType: string;
  stageOverride?: string;
  titleOverride?: string;
}): Promise<{ documentId: number; stage: string; title: string; clauseCount: number }> {
  const { companyId, filename, content, sourceType } = params;
  const { meta, body } = parseFrontMatter(content);
  const stage = params.stageOverride && VALID_STAGES.has(params.stageOverride)
    ? params.stageOverride
    : inferStage(filename, meta);
  const title =
    params.titleOverride ||
    (typeof meta.title === "string" ? meta.title : "") ||
    (body.match(/^#\s+(.*)$/m)?.[1] ?? filename);
  const version = typeof meta.version === "string" ? meta.version : String(meta.version ?? "1.0");

  const clauses = chunkClauses(body, title);

  // Replace any prior ingest of the same file for this company (idempotent).
  const prior = await db
    .select({ id: sopDocuments.id })
    .from(sopDocuments)
    .where(and(eq(sopDocuments.companyId, companyId), eq(sopDocuments.filename, filename)));
  if (prior.length > 0) {
    const ids = prior.map((p) => p.id);
    await db.delete(sopClauses).where(inArray(sopClauses.sopDocumentId, ids));
    await db.delete(sopDocuments).where(inArray(sopDocuments.id, ids));
  }

  const [doc] = await db
    .insert(sopDocuments)
    .values({
      companyId,
      agentId: "stay-agent",
      stage,
      filename,
      title,
      version,
      sourceType,
      clauseCount: clauses.length,
    })
    .returning({ id: sopDocuments.id });

  if (clauses.length > 0) {
    await db.insert(sopClauses).values(
      clauses.map((c, i) => ({
        sopDocumentId: doc.id,
        companyId,
        stage,
        anchor: c.anchor,
        heading: c.heading,
        text: c.text,
        orderIndex: i,
      })),
    );
  }

  return { documentId: doc.id, stage, title, clauseCount: clauses.length };
}

// ── POST /api/sops/ingest ────────────────────────────────────────────────────
// Body options:
//   {} or { source: "folder", company_id }         → scan the /sops folder
//   { filename, content, company_id, stage?, title? } → ingest an uploaded doc
router.post("/sops/ingest", async (req, res) => {
  try {
    const companyId = Number(req.body?.company_id ?? req.body?.companyId ?? 0);
    if (Number.isNaN(companyId) || companyId < 0) {
      res.status(400).json({ error: "company_id must be a non-negative integer" });
      return;
    }

    // Direct upload path (UI reads file text client-side and posts it).
    if (typeof req.body?.content === "string" && req.body.content.trim().length > 0) {
      const filename: string = String(req.body.filename || "uploaded-sop.md");
      const ext = path.extname(filename).toLowerCase();
      if (ext && !TEXT_EXTS.has(ext) && ext !== ".pdf" && ext !== ".docx") {
        res.status(400).json({ error: `Unsupported file type ${ext}` });
        return;
      }
      const result = await ingestDocument({
        companyId,
        filename,
        content: req.body.content,
        sourceType: ext ? ext.slice(1) : "upload",
        stageOverride: typeof req.body.stage === "string" ? req.body.stage : undefined,
        titleOverride: typeof req.body.title === "string" ? req.body.title : undefined,
      });
      res.json({ ok: true, companyId, ingested: [result] });
      return;
    }

    // Folder scan path.
    const dir = resolveSopsDir();
    if (!dir) {
      res.status(404).json({
        error: "No /sops folder found and no document content provided. Set SOPS_DIR or POST { filename, content }.",
      });
      return;
    }
    const files = readdirSync(dir).filter((f) => TEXT_EXTS.has(path.extname(f).toLowerCase()));
    const ingested = [];
    const skipped = [];
    for (const f of files) {
      try {
        const content = readFileSync(path.join(dir, f), "utf-8");
        const result = await ingestDocument({
          companyId,
          filename: f,
          content,
          sourceType: path.extname(f).slice(1) || "md",
        });
        ingested.push(result);
      } catch (e) {
        skipped.push({ filename: f, reason: e instanceof Error ? e.message : "read/parse error" });
      }
    }
    res.json({ ok: true, companyId, dir, ingested, skipped });
  } catch (err) {
    logger.error({ err }, "sops/ingest error");
    res.status(500).json({ error: err instanceof Error ? err.message : "SOP ingestion failed" });
  }
});

// ── GET /api/sops?company_id= ────────────────────────────────────────────────
router.get("/sops", async (req, res) => {
  try {
    const companyId = Number(req.query.company_id ?? req.query.companyId ?? 0);
    const docs = await db
      .select()
      .from(sopDocuments)
      .where(eq(sopDocuments.companyId, companyId))
      .orderBy(desc(sopDocuments.ingestedAt));
    res.json({ companyId, documents: docs });
  } catch (err) {
    logger.error({ err }, "sops list error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to list SOPs" });
  }
});

// ── GET /api/sops/:id ────────────────────────────────────────────────────────
router.get("/sops/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: "id must be a number" });
      return;
    }
    const [doc] = await db.select().from(sopDocuments).where(eq(sopDocuments.id, id)).limit(1);
    if (!doc) {
      res.status(404).json({ error: "SOP document not found" });
      return;
    }
    const clauses = await db
      .select()
      .from(sopClauses)
      .where(eq(sopClauses.sopDocumentId, id))
      .orderBy(sopClauses.orderIndex);
    res.json({ document: doc, clauses });
  } catch (err) {
    logger.error({ err }, "sops get error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load SOP" });
  }
});

export default router;
