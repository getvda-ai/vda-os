import { Router } from "express";
import { callAI } from "./ai-proxy.js";
import { db, governanceFiles, governanceFileVersions } from "@workspace/db";
import { eq, desc, and, sql, ilike, or } from "drizzle-orm";
import { checkComplianceGuards } from "../lib/complianceGuards.js";
import { writeGovernanceEvent } from "../lib/writeGovernanceEvent.js";
import { getOnboardingPolicy } from "../lib/exceptionAuthorityReader.js";
import yaml from "js-yaml";

/**
 * VDA-MD §10 EXCEPTION_AUTHORITY dilution guard.
 * Parses as a YAML multi-document stream (per-band blocks separated by ---).
 * Blocks updates that weaken agent authority definitions per band:
 *   ceiling_reduction     — a band's ceiling value lowered
 *   authority_downgrade   — a band's authority changed to a less-capable class
 *   escalate_to removal   — a band's escalate_to field removed
 *   must_not_override removal — a global must_not_override item removed
 * Returns a list of violation strings (empty = allowed).
 */
function checkExceptionAuthorityDilution(existingContent: string, newContent: string): string[] {
  const violations: string[] = [];

  // Higher rank = more oversight (hitl_required is most oversight, autonomous is least).
  // Dilution = moving to a lower rank (e.g. hitl_required → autonomous removes human approval).
  const AUTH_RANK: Record<string, number> = {
    hitl_required: 4, advisory: 3, monitor: 2, autonomous: 1, not_applicable: 0,
  };

  type BandDoc = {
    exception_class?: string;
    ceiling?: number | null;
    authority?: string;
    escalate_to?: string;
    [k: string]: unknown;
  };

  type ParsedAuth = {
    bands: Map<string, BandDoc[]>;  // Array to preserve all exception classes per band
    mustNotOverride: string[];
  };

  function parseAuthContent(src: string): ParsedAuth {
    const result: ParsedAuth = { bands: new Map(), mustNotOverride: [] };

    let currentBand: string | null = null;
    const chunks = src.split(/\n---\n/);

    for (const chunk of chunks) {
      const bm = chunk.match(/###\s+role_band:\s*(\S+)/);
      if (bm) currentBand = bm[1];

      const yamlLines = chunk
        .split("\n")
        .filter(l => !/^#{1,6}\s/.test(l) && !/^>\s/.test(l))
        .join("\n")
        .trim();

      if (!yamlLines) continue;

      const yamlWithBand = currentBand ? `role_band: ${currentBand}\n${yamlLines}` : yamlLines;
      let parsed: unknown;
      try { parsed = yaml.load(yamlWithBand); } catch { continue; }
      if (!parsed || typeof parsed !== "object") continue;
      const obj = parsed as Record<string, unknown>;

      if (obj.must_not_override && Array.isArray(obj.must_not_override)) {
        result.mustNotOverride = obj.must_not_override as string[];
      } else if (obj.exception_class !== undefined || obj.authority !== undefined) {
        const band = (obj.role_band as string | undefined) ?? currentBand;
        if (band) {
          if (!result.bands.has(band)) result.bands.set(band, []);
          result.bands.get(band)!.push(obj as BandDoc);
        }
      }
    }
    return result;
  }

  const before = parseAuthContent(existingContent);
  const after  = parseAuthContent(newContent);

  // Per-band, per-exception-class: ceiling_reduction, authority_downgrade, escalate_to removal
  for (const [band, bDocs] of before.bands) {
    const aDocs = after.bands.get(band) ?? [];

    for (const bDoc of bDocs) {
      // Match by exception_class if available; otherwise positional
      const aDoc = aDocs.find(d => d.exception_class === bDoc.exception_class) ?? aDocs[0];
      if (!aDoc) continue;

      // ceiling_reduction
      if (typeof bDoc.ceiling === "number" && typeof aDoc.ceiling === "number" && aDoc.ceiling < bDoc.ceiling) {
        violations.push(
          `DILUTION [§10]: band "${band}" class "${bDoc.exception_class ?? "?"}" ceiling reduced from ${bDoc.ceiling} to ${aDoc.ceiling}. ` +
          "Ceiling can only be increased or unchanged under VDA-MD §10.",
        );
      }

      // authority_downgrade (includes hitl_required → autonomous)
      const rankBefore = AUTH_RANK[String(bDoc.authority ?? "")] ?? -1;
      const rankAfter  = AUTH_RANK[String(aDoc.authority  ?? "")] ?? -1;
      if (rankBefore >= 0 && rankAfter >= 0 && rankAfter < rankBefore) {
        violations.push(
          `DILUTION [§10]: band "${band}" class "${bDoc.exception_class ?? "?"}" authority downgraded from "${bDoc.authority}" to "${aDoc.authority}". ` +
          "Authority class can only be upgraded or left unchanged.",
        );
      }

      // escalate_to removal
      if (bDoc.escalate_to && !aDoc.escalate_to) {
        violations.push(
          `DILUTION [§10]: band "${band}" class "${bDoc.exception_class ?? "?"}" escalate_to removed (was "${bDoc.escalate_to}"). ` +
          "Removing escalation routes reduces oversight coverage.",
        );
      }
    }
  }

  // Global must_not_override removal
  const mnoAfter = new Set(after.mustNotOverride);
  for (const item of before.mustNotOverride) {
    if (!mnoAfter.has(item)) {
      violations.push(
        `DILUTION [§10]: must_not_override item "${item}" removed. ` +
        "Removing override restrictions weakens agent governance boundaries.",
      );
    }
  }

  return violations;
}

const router = Router();

const INDUSTRY_COMPLIANCE_MAP: Record<string, { nistControls: string[]; frameworks: { id: string; label: string; keywords: string[] }[] }> = {
  hospitality: {
    nistControls: ["AC-2", "AU-2", "SA-4", "IR-4"],
    frameworks: [
      { id: "pci-dss", label: "PCI DSS", keywords: ["PCI DSS", "PCI-DSS", "payment card"] },
      { id: "iso-22301", label: "ISO 22301", keywords: ["ISO 22301", "business continuity"] },
    ],
  },
  financial: {
    nistControls: ["AC-2", "AU-2", "SC-28", "RA-5", "IR-4"],
    frameworks: [
      { id: "sox", label: "SOX", keywords: ["SOX", "Sarbanes-Oxley", "financial reporting"] },
      { id: "dora", label: "DORA", keywords: ["DORA", "digital operational resilience"] },
      { id: "mifid", label: "MiFID II", keywords: ["MiFID", "MiFID II", "investment services"] },
    ],
  },
  healthcare: {
    nistControls: ["AC-2", "AU-2", "MP-6", "SC-28", "IA-5"],
    frameworks: [
      { id: "hipaa", label: "HIPAA / UK DSPT", keywords: ["HIPAA", "DSPT", "health data", "patient data"] },
      { id: "nhs-dtac", label: "NHS DTAC", keywords: ["NHS DTAC", "DTAC", "digital technology assessment"] },
      { id: "mdr", label: "MDR", keywords: ["MDR", "medical device regulation"] },
    ],
  },
  retail: {
    nistControls: ["AC-2", "AU-2", "SA-4", "SI-10"],
    frameworks: [
      { id: "pci-dss", label: "PCI DSS", keywords: ["PCI DSS", "PCI-DSS", "payment card"] },
      { id: "consumer-duty", label: "Consumer Duty", keywords: ["Consumer Duty", "FCA"] },
      { id: "gdpr", label: "GDPR / CCPA", keywords: ["GDPR", "CCPA", "consumer data", "data protection"] },
    ],
  },
  professional: {
    nistControls: ["AC-2", "AU-2", "AC-17", "SC-8"],
    frameworks: [
      { id: "iso-27001", label: "ISO 27001", keywords: ["ISO 27001", "information security"] },
      { id: "sra", label: "SRA / Legal", keywords: ["SRA", "regulatory frameworks", "legal"] },
    ],
  },
  manufacturing: {
    nistControls: ["AC-2", "AU-2", "SA-4", "PE-3", "SC-28"],
    frameworks: [
      { id: "iso-9001", label: "ISO 9001", keywords: ["ISO 9001", "quality management"] },
      { id: "itar", label: "ITAR / Export Controls", keywords: ["ITAR", "export controls"] },
      { id: "iec-62443", label: "IEC 62443", keywords: ["IEC 62443", "OT/ICS", "operational technology"] },
    ],
  },
  marina: {
    nistControls: ["AC-2", "AU-2", "SA-4", "SI-10"],
    frameworks: [
      { id: "mca", label: "MCA / MSN Regulations", keywords: ["MCA", "MSN", "maritime safety"] },
      { id: "consumer-duty", label: "Consumer Duty", keywords: ["Consumer Duty", "FCA"] },
      { id: "gdpr", label: "GDPR / CCPA", keywords: ["GDPR", "CCPA", "data protection"] },
      { id: "marine-insurance", label: "Marine Insurance Act", keywords: ["Marine Insurance Act", "vessel cover"] },
    ],
  },
};

const CORE_FILE_TYPES = ["AGENTS", "COMPLIANCE", "SOP"];

// ─── VDA-MD Compliance Guards ─────────────────────────────────────────────────
// §3/§4 guard logic lives in ../lib/complianceGuards.ts and is imported above.
// Both fileManager.ts (PUT file edits) and seed.ts (SOC 2 SD regeneration) share
// the same canonical implementation to prevent drift.

function countClauses(content: string) {
  const must = (content.match(/\bMUST\b(?!\s+NOT)/g) || []).length;
  const mustNot = (content.match(/\bMUST NOT\b/g) || []).length;
  const may = (content.match(/\bMAY\b/g) || []).length;
  const words = content.split(/\s+/).filter(Boolean).length;
  return { mustCount: must, mustNotCount: mustNot, mayCount: may, wordCount: words };
}

function extractFileRefs(content: string): string[] {
  const refs = new Set<string>();
  for (const m of content.matchAll(/\b([A-Za-z][A-Za-z0-9_\-]*\.md)\b/g)) refs.add(m[1]);
  return Array.from(refs);
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
    return res.json({ count: existing.length, initialised: existing.length > 0 });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post("/fm/compliance-check", async (req, res) => {
  try {
    const { content, industry, fileType, savedContent } = req.body;
    if (industry === undefined || industry === null) return res.status(400).json({ error: "industry required" });
    const safeContent: string = (content as string) || "";

    const industryKey = (industry as string).toLowerCase().split(" ")[0];
    const compMap = INDUSTRY_COMPLIANCE_MAP[industryKey] || null;
    const fmPolicy = await getOnboardingPolicy();
    const rawT = fmPolicy.minimum_clause_counts[(fileType as string)?.toUpperCase()]
      ?? fmPolicy.minimum_clause_counts.CUSTOM
      ?? { must: 1, must_not: 0, may: 0 };
    const thresholds = { must: rawT.must, mustNot: rawT.must_not, may: rawT.may };

    const currentClauses = countClauses(safeContent);
    const savedClauses = savedContent ? countClauses(savedContent as string) : null;

    type ElementStatus = "present" | "missing" | "diluted";
    const elements: { id: string; label: string; category: "nist" | "framework" | "clause"; status: ElementStatus }[] = [];

    if (compMap) {
      for (const ctrl of compMap.nistControls) {
        const countInStr = (s: string) => (s.match(new RegExp(ctrl.replace("-", "[\\s\\-]?"), "gi")) || []).length;
        const currentCount = countInStr(safeContent);
        const savedCount = savedContent ? countInStr(savedContent as string) : null;
        let status: ElementStatus;
        if (currentCount > 0) {
          status = (savedCount !== null && currentCount < savedCount) ? "diluted" : "present";
        } else if (savedCount !== null && savedCount > 0) {
          status = "diluted";
        } else {
          status = "missing";
        }
        elements.push({ id: ctrl, label: `NIST ${ctrl}`, category: "nist", status });
      }

      for (const fw of compMap.frameworks) {
        const countFw = (s: string) => fw.keywords.reduce((acc, kw) => acc + (s.toLowerCase().split(kw.toLowerCase()).length - 1), 0);
        const currentCount = countFw(safeContent);
        const savedCount = savedContent ? countFw(savedContent as string) : null;
        let status: ElementStatus;
        if (currentCount > 0) {
          status = (savedCount !== null && currentCount < savedCount) ? "diluted" : "present";
        } else if (savedCount !== null && savedCount > 0) {
          status = "diluted";
        } else {
          status = "missing";
        }
        elements.push({ id: fw.id, label: fw.label, category: "framework", status });
      }
    }

    const mustOk = currentClauses.mustCount >= thresholds.must;
    const mustNotOk = currentClauses.mustNotCount >= thresholds.mustNot;
    const mayOk = currentClauses.mayCount >= thresholds.may;

    const mustDiluted = savedClauses !== null && currentClauses.mustCount < savedClauses.mustCount;
    const mustNotDiluted = savedClauses !== null && currentClauses.mustNotCount < savedClauses.mustNotCount;
    const mayDiluted = savedClauses !== null && currentClauses.mayCount < savedClauses.mayCount;

    elements.push({
      id: "must-clauses",
      label: `MUST clauses (min ${thresholds.must})`,
      category: "clause",
      status: mustOk ? (mustDiluted ? "diluted" : "present") : mustDiluted ? "diluted" : "missing",
    });
    if (thresholds.mustNot > 0) {
      elements.push({
        id: "must-not-clauses",
        label: `MUST NOT clauses (min ${thresholds.mustNot})`,
        category: "clause",
        status: mustNotOk ? (mustNotDiluted ? "diluted" : "present") : mustNotDiluted ? "diluted" : "missing",
      });
    }
    if (thresholds.may > 0) {
      elements.push({
        id: "may-clauses",
        label: `MAY clauses (min ${thresholds.may})`,
        category: "clause",
        status: mayOk ? (mayDiluted ? "diluted" : "present") : mayDiluted ? "diluted" : "missing",
      });
    }

    const total = elements.length;
    const covered = elements.filter(e => e.status === "present").length;
    const hasDilution = elements.some(e => e.status === "diluted");

    return res.json({ elements, total, covered, hasDilution, clauses: currentClauses });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
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
    return res.json(files);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

async function assertFileOwnership(fileId: number, companyId: number | null) {
  const [file] = await db.select({ id: governanceFiles.id, companyId: governanceFiles.companyId })
    .from(governanceFiles).where(eq(governanceFiles.id, fileId));
  if (!file) return null;
  if (companyId !== null && file.companyId !== companyId) return null;
  return file;
}

router.get("/fm/file/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const companyId = req.query.companyId ? parseInt(req.query.companyId as string, 10) : null;
    if (companyId !== null && isNaN(companyId)) return res.status(400).json({ error: "Invalid companyId" });
    const [file] = await db.select().from(governanceFiles)
      .where(companyId !== null
        ? and(eq(governanceFiles.id, id), eq(governanceFiles.companyId, companyId))
        : eq(governanceFiles.id, id));
    if (!file) return res.status(404).json({ error: "Not found" });
    return res.json(file);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
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
    return res.json(file);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.put("/fm/file/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const { content, commitMessage, author, companyId: rawCompanyId, signedOffBy, ...rest } = req.body;
    const companyId = rawCompanyId ? parseInt(String(rawCompanyId), 10) : null;

    // Load existing file for both ownership check and compliance guard baseline comparison
    const [existingFile] = await db
      .select({ id: governanceFiles.id, companyId: governanceFiles.companyId, content: governanceFiles.content, filename: governanceFiles.filename, fileType: governanceFiles.fileType })
      .from(governanceFiles)
      .where(eq(governanceFiles.id, id));
    if (!existingFile) return res.status(404).json({ error: "Not found" });
    if (companyId !== null && existingFile.companyId !== companyId) return res.status(404).json({ error: "Not found" });

    // VDA-MD §3 & §4 compliance guard: enforce immutability and audit change control
    if (content && existingFile.content) {
      const guard = checkComplianceGuards(existingFile.content, content, signedOffBy as string | undefined);
      if (!guard.allowed) {
        writeGovernanceEvent({
          companyId: existingFile.companyId ?? companyId ?? 0,
          agent: "compliance-guard",
          eventCategory: "COMPLIANCE_BOUNDARY",
          decision: "FAIL",
          fileReferenced: `governance-file:${existingFile.id}`,
          clauseApplied: "VDA-MD §3 & §4: Immutability and change control constraints violated",
          actionProposed: `Reject update to governance file ${existingFile.id} — compliance guard triggered`,
          reasoning: guard.violations.join("; "),
          apaleoData: { event_type: "compliance_guard_rejection", fileId: existingFile.id, violations: guard.violations, hint: guard.hint },
        }).catch(err => console.warn("[Witness] compliance_guard_rejection event failed:", err));
        return res.status(409).json({
          error: "VDA-MD compliance guard rejected this update",
          violations: guard.violations,
          hint: guard.hint,
        });
      }
    }

    // VDA-MD §10 EXCEPTION_AUTHORITY dilution guard
    // Dilution requires CO override: send x-co-override: true header to proceed with approval audit trail.
    if (content && existingFile.content && existingFile.fileType === "EXCEPTION_AUTHORITY") {
      const dilutionViolations = checkExceptionAuthorityDilution(existingFile.content, content);
      if (dilutionViolations.length > 0) {
        const coOverride = req.headers["x-co-override"] === "true";
        if (!coOverride) {
          writeGovernanceEvent({
            companyId: existingFile.companyId ?? companyId ?? 0,
            agent: "compliance-guard",
            eventCategory: "COMPLIANCE_BOUNDARY",
            decision: "FAIL",
            fileReferenced: `governance-file:${existingFile.id}`,
            clauseApplied: "VDA-MD §10: EXCEPTION_AUTHORITY.md dilution guard triggered",
            actionProposed: `Reject update to EXCEPTION_AUTHORITY.md ${existingFile.id} — authority dilution detected`,
            reasoning: dilutionViolations.join("; "),
            apaleoData: { event_type: "exception_authority_dilution", fileId: existingFile.id, violations: dilutionViolations },
          }).catch(err => console.warn("[Witness] exception_authority_dilution event failed:", err));
          return res.status(409).json({
            error: "VDA-MD §10: EXCEPTION_AUTHORITY.md dilution guard rejected this update",
            violations: dilutionViolations,
            hint: "Authority dilution requires Compliance Officer approval. Retry with x-co-override: true header to record an approved override.",
            coOverrideRequired: true,
          });
        }
        // CO override path: log the override with full audit trail and continue
        writeGovernanceEvent({
          companyId: existingFile.companyId ?? companyId ?? 0,
          agent: "compliance-guard",
          eventCategory: "COMPLIANCE_BOUNDARY",
          decision: "PASS",
          fileReferenced: `governance-file:${existingFile.id}`,
          clauseApplied: "VDA-MD §10: EXCEPTION_AUTHORITY.md dilution — CO override applied",
          actionProposed: `CO override approved update to EXCEPTION_AUTHORITY.md ${existingFile.id}`,
          reasoning: `Compliance Officer override approved. Dilution violations: ${dilutionViolations.join("; ")}`,
          apaleoData: { event_type: "exception_authority_co_override", fileId: existingFile.id, violations: dilutionViolations },
        }).catch(err => console.warn("[Witness] exception_authority_co_override event failed:", err));
      }
    }

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
      // If audit standard changes were signed off, record the signoff in the commit message for the audit trail
      const auditCommitNote = signedOffBy ? ` [Audit change signed off by: ${signedOffBy}]` : "";
      await db.insert(governanceFileVersions).values({
        fileId: id,
        content,
        commitMessage: (commitMessage || "Updated") + auditCommitNote,
        author: author || "User",
        versionNumber: nextVersion,
        ...clauses,
      });
    }
    return res.json(file);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post("/fm/sign/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const { signedBy, signedRole, companyId: rawCompanyId } = req.body;
    const companyId = rawCompanyId ? parseInt(String(rawCompanyId), 10) : null;
    if (companyId !== null) {
      const owned = await assertFileOwnership(id, companyId);
      if (!owned) return res.status(404).json({ error: "Not found" });
    }
    const [file] = await db.update(governanceFiles).set({
      status: "live",
      signedBy: signedBy || "User",
      signedRole: signedRole || "Owner",
      signedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(governanceFiles.id, id)).returning();
    if (!file) return res.status(404).json({ error: "Not found" });
    return res.json(file);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post("/fm/integrity-check", async (req, res) => {
  try {
    const { companyId: rawCompanyId, content, filename, fileId: rawFileId } = req.body;
    const companyId = rawCompanyId ? parseInt(String(rawCompanyId), 10) : null;
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    const fileId = rawFileId ? parseInt(String(rawFileId), 10) : null;

    const allFiles = await db.select({
      id: governanceFiles.id,
      filename: governanceFiles.filename,
      fileType: governanceFiles.fileType,
      content: governanceFiles.content,
    }).from(governanceFiles)
      .where(and(eq(governanceFiles.companyId, companyId), eq(governanceFiles.isArchived, false)));

    const activeFilenames = new Set(allFiles.map(f => f.filename));
    const presentTypes = new Set(allFiles.map(f => (f.fileType || "").toUpperCase()));

    const outboundRefs: { name: string; status: "intact" | "broken" }[] = [];
    if (content) {
      const refs = extractFileRefs(content as string);
      for (const ref of refs) {
        if (filename && ref === filename) continue;
        outboundRefs.push({ name: ref, status: activeFilenames.has(ref) ? "intact" : "broken" });
      }
    }

    const inboundRefs: { name: string; fileId: number }[] = [];
    if (filename) {
      for (const f of allFiles) {
        if (f.id === fileId) continue;
        if (f.content && extractFileRefs(f.content).includes(filename as string)) {
          inboundRefs.push({ name: f.filename, fileId: f.id });
        }
      }
    }

    const missingCoreTypes = CORE_FILE_TYPES.filter(t => !presentTypes.has(t));

    return res.json({ outboundRefs, inboundRefs, missingCoreTypes });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete("/fm/file/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const companyId = req.query.companyId ? parseInt(req.query.companyId as string, 10) : null;
    if (companyId !== null) {
      const owned = await assertFileOwnership(id, companyId);
      if (!owned) return res.status(404).json({ error: "Not found" });
    }

    const [targetFile] = await db.select({
      fileType: governanceFiles.fileType,
      filename: governanceFiles.filename,
    }).from(governanceFiles).where(eq(governanceFiles.id, id));
    if (!targetFile) return res.status(404).json({ error: "Not found" });

    if (CORE_FILE_TYPES.includes((targetFile.fileType || "").toUpperCase())) {
      return res.status(403).json({
        error: `${targetFile.fileType} is a mandatory core governance file and cannot be archived`,
        reason: "core_file",
        fileType: targetFile.fileType,
      });
    }

    if (companyId) {
      const siblings = await db.select({ id: governanceFiles.id, filename: governanceFiles.filename, content: governanceFiles.content })
        .from(governanceFiles)
        .where(and(eq(governanceFiles.companyId, companyId), eq(governanceFiles.isArchived, false)));
      const referencedBy: string[] = [];
      for (const f of siblings) {
        if (f.id === id) continue;
        if (f.content && extractFileRefs(f.content).includes(targetFile.filename)) {
          referencedBy.push(f.filename);
        }
      }
      if (referencedBy.length > 0) {
        return res.status(409).json({
          error: "File is referenced by other active governance files",
          reason: "referenced",
          referencedBy,
        });
      }
    }

    await db.update(governanceFiles).set({ isArchived: true, updatedAt: new Date() })
      .where(eq(governanceFiles.id, id));
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.get("/fm/history/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const companyId = req.query.companyId ? parseInt(req.query.companyId as string, 10) : null;
    if (companyId !== null) {
      const owned = await assertFileOwnership(id, companyId);
      if (!owned) return res.status(404).json({ error: "Not found" });
    }
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
    return res.json(versions);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.get("/fm/version/:versionId", async (req, res) => {
  try {
    const id = parseInt(req.params.versionId, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const companyId = req.query.companyId ? parseInt(req.query.companyId as string, 10) : null;
    const [version] = await db.select().from(governanceFileVersions).where(eq(governanceFileVersions.id, id));
    if (!version) return res.status(404).json({ error: "Not found" });
    if (companyId !== null) {
      const owned = await assertFileOwnership(version.fileId, companyId);
      if (!owned) return res.status(404).json({ error: "Not found" });
    }
    return res.json(version);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
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
    const companyId = req.query.companyId ? parseInt(req.query.companyId as string, 10) : null;
    if (companyId !== null) {
      const owned = await assertFileOwnership(id, companyId);
      if (!owned) return res.status(404).json({ error: "Not found" });
    }
    const { fromVersion, toVersion } = req.query as { fromVersion?: string; toVersion?: string; companyId?: string };
    const versions = await db.select().from(governanceFileVersions)
      .where(eq(governanceFileVersions.fileId, id))
      .orderBy(desc(governanceFileVersions.versionNumber));
    if (versions.length < 2) return res.json({ diff: [], from: null, to: null });
    let fromV = fromVersion ? versions.find(v => v.id === parseInt(fromVersion)) : versions[1];
    let toV = toVersion ? versions.find(v => v.id === parseInt(toVersion)) : versions[0];
    if (!fromV || !toV) return res.status(404).json({ error: "Version not found" });
    const diff = computeDiff(fromV.content, toV.content);
    return res.json({ diff, from: fromV, to: toV });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
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
    return res.json({
      releaseName: releaseName || `Release ${new Date().toISOString().slice(0, 10)}`,
      liveCount: liveFiles.length,
      draftCount: draftFiles.length,
      totalFiles: files.length,
      liveFiles: liveFiles.map(f => f.filename),
      releaseNotes: releaseNotes || null,
      createdAt: new Date().toISOString(),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
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
      owner: governanceFiles.owner,
      domain: governanceFiles.domain,
      nistControl: governanceFiles.nistControl,
      content: governanceFiles.content,
    }).from(governanceFiles)
      .where(and(
        eq(governanceFiles.companyId, companyId),
        eq(governanceFiles.isArchived, false),
        or(
          ilike(governanceFiles.content, `%${query}%`),
          ilike(governanceFiles.filename, `%${query}%`),
          ilike(governanceFiles.fileType, `%${query}%`),
          ilike(governanceFiles.status, `%${query}%`),
          sql`${governanceFiles.owner} ILIKE ${`%${query}%`}`,
          sql`${governanceFiles.domain} ILIKE ${`%${query}%`}`,
          sql`${governanceFiles.nistControl} ILIKE ${`%${query}%`}`,
          sql`${governanceFiles.axis} ILIKE ${`%${query}%`}`,
        )
      ));
    const results = files.map(f => ({
      ...f,
      snippet: (() => {
        const idx = f.content.toLowerCase().indexOf(query.toLowerCase());
        if (idx < 0) {
          return [f.owner, f.domain, f.nistControl, f.fileType, f.status].filter(Boolean).join(" · ");
        }
        return f.content.slice(Math.max(0, idx - 60), idx + 120);
      })(),
    }));
    return res.json(results.map(r => ({ ...r, content: undefined })));
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post("/fm/agent/suggest", async (req, res) => {
  try {
    const { fileType, axis, companyName, industry, existingFiles, brandContext, existingContent, filename } = req.body;
    if (!fileType) return res.status(400).json({ error: "fileType required" });

    if (existingContent) {
      const systemPrompt = `You are a VDA-MD Governance Improvement Engine. Analyse the governance file and return a JSON object with:
{
  "overallScore": 0-100,
  "strengths": ["strength 1", "strength 2"],
  "improvements": [
    { "priority": "HIGH|MEDIUM|LOW", "issue": "short description", "suggestion": "specific rewrite or addition", "reason": "why this matters" }
  ],
  "nistGaps": ["missing control or coverage gap"],
  "summary": "one paragraph summary"
}
Respond with ONLY the JSON object, no markdown fences.`;
      const raw = await callAI({
        model: "claude-sonnet-4-6",
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: "user", content: `Company: ${companyName || "the organisation"}\nIndustry: ${industry || "general"}\nFile: ${filename || fileType}\n\n${(existingContent as string).slice(0, 4000)}` }],
      });
      try {
        const clean = raw.replace(/^```json[\r\n]*/i, "").replace(/^```[\r\n]*/i, "").replace(/[\r\n]*```\s*$/i, "").trim();
        return res.json(JSON.parse(clean));
      } catch {
        return res.json({ overallScore: 0, summary: raw, improvements: [], nistGaps: [], strengths: [] });
      }
    }

    const industryKey = ((industry || "") as string).toLowerCase().split(" ")[0];
    const compMap = INDUSTRY_COMPLIANCE_MAP[industryKey] || null;
    const genPolicy = await getOnboardingPolicy();
    const genRawT = genPolicy.minimum_clause_counts[(fileType as string)?.toUpperCase()]
      ?? genPolicy.minimum_clause_counts.CUSTOM
      ?? { must: 1, must_not: 0, may: 0 };
    const thresholds = { must: genRawT.must, mustNot: genRawT.must_not, may: genRawT.may };

    const mandatoryNist = compMap ? compMap.nistControls.join(", ") : "AC-2, AU-2";
    const mandatoryFrameworks = compMap ? compMap.frameworks.map(f => f.label).join(", ") : "applicable regulatory frameworks";

    const systemPrompt = `You are a governance file drafting assistant for AI operating systems using the VDA-MD framework. 
You generate concise, structured governance documents using MUST/MUST NOT/MAY clause language. 
CRITICAL: You MUST include ALL mandatory compliance elements listed in the user prompt. Omitting any required NIST control or regulatory framework reference is a compliance violation.
Return only the markdown content with YAML front matter. Do not include any explanation or preamble.`;
    const userPrompt = `Generate a governance file for:
- Company: ${companyName || "the organisation"}
- Industry: ${industry || "general"}
- File Type: ${fileType}
- Axis: ${axis || "shared"}
- Brand context: ${brandContext ? (brandContext as string).slice(0, 500) : "not provided"}
- Existing files: ${existingFiles ? (existingFiles as string[]).join(", ") : "none"}

MANDATORY COMPLIANCE REQUIREMENTS — ALL must appear explicitly in the file:
- NIST SP 800-53 controls required: ${mandatoryNist}
  → Reference each control by ID (e.g. "AC-2", "AU-2") in the Compliance Baseline section
- Regulatory frameworks required: ${mandatoryFrameworks}
  → Reference each framework by name in the file content

MANDATORY CLAUSE MINIMUMS:
- At least ${thresholds.must} MUST clauses
- At least ${thresholds.mustNot} MUST NOT clauses
- At least ${thresholds.may} MAY clauses

OTHER REQUIREMENTS:
- Begin with YAML front matter (---)
- Keep it under 500 words
- Make it specific to the industry and company context
- Include a "## Compliance Baseline" section listing all required NIST controls and frameworks`;
    const content = await callAI({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    const clauses = countClauses(content);
    const meta = parseYamlFrontMatter(content);

    const complianceWarnings: string[] = [];
    if (compMap) {
      for (const ctrl of compMap.nistControls) {
        const countInStr = (s: string) => (s.match(new RegExp(ctrl.replace("-", "[\\s\\-]?"), "gi")) || []).length;
        if (countInStr(content) === 0) complianceWarnings.push(`NIST ${ctrl} not referenced in generated file`);
      }
      for (const fw of compMap.frameworks) {
        const present = fw.keywords.some(kw => content.toLowerCase().includes(kw.toLowerCase()));
        if (!present) complianceWarnings.push(`${fw.label} not referenced in generated file`);
      }
    }
    if (clauses.mustCount < thresholds.must) complianceWarnings.push(`Generated file has ${clauses.mustCount} MUST clauses (minimum ${thresholds.must})`);
    if (thresholds.mustNot > 0 && clauses.mustNotCount < thresholds.mustNot) complianceWarnings.push(`Generated file has ${clauses.mustNotCount} MUST NOT clauses (minimum ${thresholds.mustNot})`);
    if (thresholds.may > 0 && clauses.mayCount < thresholds.may) complianceWarnings.push(`Generated file has ${clauses.mayCount} MAY clauses (minimum ${thresholds.may})`);

    return res.json({ content, ...clauses, meta, complianceWarnings });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
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
- LIVE files included (${(liveFiles as string[]).length}): ${(liveFiles as string[]).join(", ")}
- DRAFT files excluded (${((draftFiles || []) as string[]).length}): ${((draftFiles || []) as string[]).join(", ")}

Write professional release notes under 300 words. Include a compliance summary and any recommended next steps.`;
    const notes = await callAI({
      model: "claude-sonnet-4-6",
      max_tokens: 768,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    return res.json({ releaseNotes: notes });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
