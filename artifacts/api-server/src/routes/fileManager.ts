import { Router } from "express";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { db, governanceFiles, governanceFileVersions } from "@workspace/db";
import { eq, desc, and, sql, ilike, or } from "drizzle-orm";

const router = Router();

function countClauses(content: string) {
  const must = (content.match(/\bMUST\b(?!\s+NOT)/g) || []).length;
  const mustNot = (content.match(/\bMUST NOT\b/g) || []).length;
  const may = (content.match(/\bMAY\b/g) || []).length;
  const words = content.split(/\s+/).filter(Boolean).length;
  return { mustCount: must, mustNotCount: mustNot, mayCount: may, wordCount: words };
}

function parseYamlFrontMatter(content: string) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};
  const yaml = match[1];
  const result: Record<string, string> = {};
  for (const line of yaml.split("\n")) {
    const m = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (m) result[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
  }
  return result;
}

router.post("/fm/init", async (req, res) => {
  try {
    const { companyId } = req.body;
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    const existing = await db.select({ id: governanceFiles.id }).from(governanceFiles)
      .where(and(eq(governanceFiles.companyId, companyId), eq(governanceFiles.isArchived, false)));
    res.json({ count: existing.length, initialised: existing.length > 0 });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/fm/files/:companyId", async (req, res) => {
  try {
    const companyId = parseInt(req.params.companyId, 10);
    if (isNaN(companyId)) return res.status(400).json({ error: "Invalid companyId" });
    const files = await db.select({
      id: governanceFiles.id,
      filename: governanceFiles.filename,
      filepath: governanceFiles.filepath,
      fileType: governanceFiles.fileType,
      axis: governanceFiles.axis,
      stage: governanceFiles.stage,
      status: governanceFiles.status,
      owner: governanceFiles.owner,
      domain: governanceFiles.domain,
      agentId: governanceFiles.agentId,
      journeyStage: governanceFiles.journeyStage,
      normalisationLevel: governanceFiles.normalisationLevel,
      vendor: governanceFiles.vendor,
      baseline: governanceFiles.baseline,
      expiresAt: governanceFiles.expiresAt,
      exceptionReason: governanceFiles.exceptionReason,
      signedBy: governanceFiles.signedBy,
      signedRole: governanceFiles.signedRole,
      signedAt: governanceFiles.signedAt,
      nistControl: governanceFiles.nistControl,
      mustCount: governanceFiles.mustCount,
      mustNotCount: governanceFiles.mustNotCount,
      mayCount: governanceFiles.mayCount,
      wordCount: governanceFiles.wordCount,
      createdAt: governanceFiles.createdAt,
      updatedAt: governanceFiles.updatedAt,
    }).from(governanceFiles)
      .where(and(eq(governanceFiles.companyId, companyId), eq(governanceFiles.isArchived, false)))
      .orderBy(governanceFiles.axis, governanceFiles.filename);
    res.json(files);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/fm/file/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const [file] = await db.select().from(governanceFiles).where(eq(governanceFiles.id, id));
    if (!file) return res.status(404).json({ error: "Not found" });
    res.json(file);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/fm/file", async (req, res) => {
  try {
    const {
      companyId, filename, filepath, fileType, axis, stage, content,
      status, owner, domain, agentId, journeyStage, normalisationLevel,
      vendor, baseline, expiresAt, exceptionReason, nistControl,
    } = req.body;
    if (!companyId || !filename || !content) {
      return res.status(400).json({ error: "companyId, filename, content required" });
    }
    const clauses = countClauses(content);
    const meta = parseYamlFrontMatter(content);
    const [file] = await db.insert(governanceFiles).values({
      companyId,
      filename: filename || meta.filename || "untitled.md",
      filepath: filepath || meta.filepath || filename,
      fileType: fileType || meta.file_type || "CUSTOM",
      axis: axis || meta.axis || "shared",
      stage: stage || meta.stage || null,
      content,
      status: status || "draft",
      owner: owner || meta.owner || null,
      domain: domain || meta.domain || null,
      agentId: agentId || meta.agent_id || null,
      journeyStage: journeyStage || meta.journey_stage || null,
      normalisationLevel: normalisationLevel != null ? normalisationLevel : (meta.normalisation_level ? parseInt(meta.normalisation_level) : null),
      vendor: vendor || meta.vendor || null,
      baseline: baseline != null ? baseline : (meta.baseline === "true"),
      expiresAt: expiresAt || meta.expires_at || null,
      exceptionReason: exceptionReason || meta.exception_reason || null,
      nistControl: nistControl || meta.nist_control || null,
      ...clauses,
    }).returning();
    await db.insert(governanceFileVersions).values({
      fileId: file.id,
      content,
      commitMessage: "Initial version",
      author: "User",
      versionNumber: 1,
      ...clauses,
    });
    res.json(file);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/fm/file/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const { content, commitMessage, author, ...rest } = req.body;
    const clauses = content ? countClauses(content) : {};
    const meta = content ? parseYamlFrontMatter(content) : {};
    const updateData: Record<string, any> = {
      updatedAt: new Date(),
      ...clauses,
    };
    if (content) updateData.content = content;
    if (rest.status) updateData.status = rest.status;
    if (rest.owner) updateData.owner = rest.owner;
    if (rest.expiresAt !== undefined) updateData.expiresAt = rest.expiresAt;
    if (content && meta.owner) updateData.owner = meta.owner;
    if (content && meta.expires_at) updateData.expiresAt = meta.expires_at;
    const [file] = await db.update(governanceFiles).set(updateData)
      .where(eq(governanceFiles.id, id)).returning();
    if (!file) return res.status(404).json({ error: "Not found" });
    if (content) {
      const versions = await db.select({ versionNumber: governanceFileVersions.versionNumber })
        .from(governanceFileVersions).where(eq(governanceFileVersions.fileId, id))
        .orderBy(desc(governanceFileVersions.versionNumber)).limit(1);
      const nextVersion = (versions[0]?.versionNumber ?? 0) + 1;
      await db.insert(governanceFileVersions).values({
        fileId: id,
        content,
        commitMessage: commitMessage || "Updated",
        author: author || "User",
        versionNumber: nextVersion,
        ...clauses,
      });
    }
    res.json(file);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/fm/sign/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const { signedBy, signedRole } = req.body;
    const [file] = await db.update(governanceFiles).set({
      status: "live",
      signedBy: signedBy || "User",
      signedRole: signedRole || "Owner",
      signedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(governanceFiles.id, id)).returning();
    if (!file) return res.status(404).json({ error: "Not found" });
    res.json(file);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/fm/file/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    await db.update(governanceFiles).set({ isArchived: true, updatedAt: new Date() })
      .where(eq(governanceFiles.id, id));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/fm/history/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const versions = await db.select({
      id: governanceFileVersions.id,
      fileId: governanceFileVersions.fileId,
      versionNumber: governanceFileVersions.versionNumber,
      commitMessage: governanceFileVersions.commitMessage,
      author: governanceFileVersions.author,
      mustCount: governanceFileVersions.mustCount,
      mustNotCount: governanceFileVersions.mustNotCount,
      mayCount: governanceFileVersions.mayCount,
      createdAt: governanceFileVersions.createdAt,
    }).from(governanceFileVersions)
      .where(eq(governanceFileVersions.fileId, id))
      .orderBy(desc(governanceFileVersions.versionNumber));
    res.json(versions);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/fm/version/:versionId", async (req, res) => {
  try {
    const id = parseInt(req.params.versionId, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const [version] = await db.select().from(governanceFileVersions).where(eq(governanceFileVersions.id, id));
    if (!version) return res.status(404).json({ error: "Not found" });
    res.json(version);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

function computeDiff(oldContent: string, newContent: string) {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const result: { type: "same" | "added" | "removed"; line: string; lineNo: number }[] = [];
  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];
    if (oldLine === newLine) {
      result.push({ type: "same", line: oldLine ?? "", lineNo: i + 1 });
    } else {
      if (oldLine !== undefined) result.push({ type: "removed", line: oldLine, lineNo: i + 1 });
      if (newLine !== undefined) result.push({ type: "added", line: newLine, lineNo: i + 1 });
    }
  }
  return result;
}

router.get("/fm/diff/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const { fromVersion, toVersion } = req.query as { fromVersion?: string; toVersion?: string };
    const versions = await db.select().from(governanceFileVersions)
      .where(eq(governanceFileVersions.fileId, id))
      .orderBy(desc(governanceFileVersions.versionNumber));
    if (versions.length < 2) return res.json({ diff: [], from: null, to: null });
    let fromV = fromVersion ? versions.find(v => v.id === parseInt(fromVersion)) : versions[1];
    let toV = toVersion ? versions.find(v => v.id === parseInt(toVersion)) : versions[0];
    if (!fromV || !toV) return res.status(404).json({ error: "Version not found" });
    const diff = computeDiff(fromV.content, toV.content);
    res.json({ diff, from: fromV, to: toV });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/fm/release/:companyId", async (req, res) => {
  try {
    const companyId = parseInt(req.params.companyId, 10);
    if (isNaN(companyId)) return res.status(400).json({ error: "Invalid companyId" });
    const { releaseName, releaseNotes } = req.body;
    const files = await db.select({ id: governanceFiles.id, filename: governanceFiles.filename, status: governanceFiles.status })
      .from(governanceFiles)
      .where(and(eq(governanceFiles.companyId, companyId), eq(governanceFiles.isArchived, false)));
    const liveFiles = files.filter(f => f.status === "live");
    const draftFiles = files.filter(f => f.status === "draft");
    res.json({
      releaseName: releaseName || `Release ${new Date().toISOString().slice(0, 10)}`,
      liveCount: liveFiles.length,
      draftCount: draftFiles.length,
      totalFiles: files.length,
      liveFiles: liveFiles.map(f => f.filename),
      releaseNotes: releaseNotes || null,
      createdAt: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/fm/search/:companyId", async (req, res) => {
  try {
    const companyId = parseInt(req.params.companyId, 10);
    if (isNaN(companyId)) return res.status(400).json({ error: "Invalid companyId" });
    const { query } = req.body;
    if (!query) return res.json([]);
    const files = await db.select({
      id: governanceFiles.id,
      filename: governanceFiles.filename,
      filepath: governanceFiles.filepath,
      fileType: governanceFiles.fileType,
      axis: governanceFiles.axis,
      status: governanceFiles.status,
      content: governanceFiles.content,
    }).from(governanceFiles)
      .where(and(
        eq(governanceFiles.companyId, companyId),
        eq(governanceFiles.isArchived, false),
        or(
          ilike(governanceFiles.content, `%${query}%`),
          ilike(governanceFiles.filename, `%${query}%`),
        )
      ));
    const results = files.map(f => ({
      ...f,
      snippet: (() => {
        const idx = f.content.toLowerCase().indexOf(query.toLowerCase());
        if (idx < 0) return "";
        return f.content.slice(Math.max(0, idx - 60), idx + 120);
      })(),
    }));
    res.json(results.map(r => ({ ...r, content: undefined })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/fm/agent/suggest", async (req, res) => {
  try {
    const { fileType, axis, companyName, industry, existingFiles, brandContext } = req.body;
    if (!fileType) return res.status(400).json({ error: "fileType required" });
    const systemPrompt = `You are a governance file drafting assistant for AI operating systems using the VDA-MD framework. 
You generate concise, structured governance documents using MUST/MUST NOT/MAY clause language. 
Return only the markdown content with YAML front matter. Do not include any explanation or preamble.`;
    const userPrompt = `Generate a governance file for:
- Company: ${companyName || "the organisation"}
- Industry: ${industry || "general"}
- File Type: ${fileType}
- Axis: ${axis || "shared"}
- Brand context: ${brandContext ? brandContext.slice(0, 500) : "not provided"}
- Existing files: ${existingFiles ? (existingFiles as string[]).join(", ") : "none"}

Requirements:
- Begin with YAML front matter (---)
- Include at least 3 MUST clauses, 2 MUST NOT clauses, and 2 MAY clauses
- Keep it under 400 words
- Make it specific to the industry and company context`;
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    const content = response.content[0]?.type === "text" ? response.content[0].text : "";
    const clauses = countClauses(content);
    const meta = parseYamlFrontMatter(content);
    res.json({ content, ...clauses, meta, model: response.model });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/fm/agent/release-notes", async (req, res) => {
  try {
    const { releaseName, companyName, industry, liveFiles, draftFiles, releaseDate } = req.body;
    if (!liveFiles || !Array.isArray(liveFiles)) {
      return res.status(400).json({ error: "liveFiles array required" });
    }
    const systemPrompt = `You are an AI governance release manager. Write concise, professional release notes for governance file bundles. 
Format as structured markdown with sections: Summary, Files Included, Key Changes, Compliance Notes.`;
    const userPrompt = `Write release notes for:
- Release name: ${releaseName || "Governance Release"}
- Company: ${companyName || "the organisation"}
- Industry: ${industry || "general"}
- Release date: ${releaseDate || new Date().toISOString().slice(0, 10)}
- LIVE files included (${liveFiles.length}): ${liveFiles.join(", ")}
- DRAFT files excluded (${(draftFiles || []).length}): ${(draftFiles || []).join(", ")}

Write professional release notes under 300 words. Include a compliance summary and any recommended next steps.`;
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 768,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    const notes = response.content[0]?.type === "text" ? response.content[0].text : "";
    res.json({ releaseNotes: notes, model: response.model });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
