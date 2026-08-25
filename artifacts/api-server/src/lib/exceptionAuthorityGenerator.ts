/**
 * exceptionAuthorityGenerator.ts
 * AI-driven, jurisdiction-aware EXCEPTION_AUTHORITY.md generation.
 * Shared by fileManager routes (generate endpoint) and admin seed endpoint.
 */
import yaml from "js-yaml";
import { callAI } from "../routes/ai-proxy.js";
import { logger } from "./logger.js";

// ─── Company → property code map ─────────────────────────────────────────────

export const COMPANIES_MAP: Record<number, { propertyCode: string; city: string; country: string }> = {
  1: { propertyCode: "BER", city: "Berlin",  country: "Germany" },
  2: { propertyCode: "LND", city: "London",  country: "UK" },
  3: { propertyCode: "MUC", city: "Munich",  country: "Germany" },
  4: { propertyCode: "PAR", city: "Paris",   country: "France" },
  5: { propertyCode: "VIE", city: "Vienna",  country: "Austria" },
};

// ─── Jurisdiction context map ─────────────────────────────────────────────────

export interface JurisdictionLaw {
  name: string;
  relevance: string;
  constraint_type: "ceiling_modifier" | "mandatory_must_not" | "disclosure_required" | "audit_required";
}

export interface JurisdictionContext {
  country: string;
  propertyCode: string;
  laws: JurisdictionLaw[];
  ceiling_modifiers: string[];
  mandatory_must_not_clauses: string[];
}

export const JURISDICTION_CONTEXT: Record<string, JurisdictionContext> = {
  BER: {
    country: "Germany",
    propertyCode: "BER",
    laws: [
      { name: "Preisangabenverordnung (PAngV)", relevance: "Mandatory price transparency for advertised rates; AI rate agents must not apply hidden surcharges", constraint_type: "mandatory_must_not" },
      { name: "BGB §305–310 (AGB-Recht)", relevance: "Standard terms and conditions — automated rate overrides must not breach consumer contract terms", constraint_type: "mandatory_must_not" },
      { name: "DSGVO / GDPR (German implementation)", relevance: "Data minimisation for guest rate profiling; automated pricing decisions require lawful basis", constraint_type: "audit_required" },
      { name: "Beherbergungsvertrag (German hospitality contract law)", relevance: "Rate exceptions above 15% require documented guest consent under German hospitality norms", constraint_type: "ceiling_modifier" },
    ],
    ceiling_modifiers: [
      "Germany PAngV: rate exceptions displayed to guests must include VAT (MwSt 7% reduced rate for accommodation)",
      "BGB §305: automated discounts above 20% below BAR require documented exceptional circumstance log",
    ],
    mandatory_must_not_clauses: [
      "MUST NOT apply automated price surcharges without transparent disclosure to the guest (Preisangabenverordnung §1)",
      "MUST NOT store guest rate preference profiles beyond the stay period without explicit consent (DSGVO Art. 6)",
    ],
  },
  MUC: {
    country: "Germany",
    propertyCode: "MUC",
    laws: [
      { name: "Preisangabenverordnung (PAngV)", relevance: "Mandatory price transparency — same as BER property", constraint_type: "mandatory_must_not" },
      { name: "BGB §305–310 (AGB-Recht)", relevance: "Standard terms enforcement — Munich properties apply same federal AGB law", constraint_type: "mandatory_must_not" },
      { name: "DSGVO / GDPR (German implementation)", relevance: "Bavarian DPA (BayLDA) oversight applies; rate automation must document lawful basis", constraint_type: "audit_required" },
      { name: "Bayerisches Tourismusgesetz", relevance: "Bavarian tourism licensing imposes additional disclosure obligations for automated pricing", constraint_type: "disclosure_required" },
    ],
    ceiling_modifiers: [
      "Germany PAngV: rate exceptions must include MwSt 7% reduced rate for accommodation",
      "Bavarian tourism law: promotional rate exceptions require documentation in hotel licensing register",
    ],
    mandatory_must_not_clauses: [
      "MUST NOT apply automated price surcharges without transparent disclosure to the guest (Preisangabenverordnung §1)",
      "MUST NOT retain guest rate preference data beyond legal retention period without BayLDA-compliant consent (DSGVO Art. 6)",
    ],
  },
  LND: {
    country: "UK",
    propertyCode: "LND",
    laws: [
      { name: "UK Consumer Rights Act 2015", relevance: "Rate exception ceilings are bounded by unfair terms provisions; exceptions above 25% below BAR require justification", constraint_type: "ceiling_modifier" },
      { name: "UK Consumer Contracts Regulations 2013", relevance: "Automated rate changes must be disclosed to consumers before booking confirmation", constraint_type: "disclosure_required" },
      { name: "UK GDPR / Data Protection Act 2018", relevance: "ICO oversight; automated pricing profiling requires Art. 22 safeguards if solely automated decisions", constraint_type: "audit_required" },
      { name: "FCA Consumer Duty (where applicable)", relevance: "Fair value outcomes — AI rate agents must not apply discriminatory exception ceilings", constraint_type: "mandatory_must_not" },
    ],
    ceiling_modifiers: [
      "UK Consumer Rights Act: exception ceilings above 25% below BAR require explicit written GM justification",
      "Consumer Contracts Regulations 2013: rate exception confirmation email required when discount exceeds £50 equivalent",
    ],
    mandatory_must_not_clauses: [
      "MUST NOT apply automated rate decisions without pre-contractual disclosure to the guest (Consumer Contracts Regulations 2013 Reg. 13)",
      "MUST NOT use guest nationality as a rate exception factor — UK Equality Act 2010 protected characteristic",
    ],
  },
  PAR: {
    country: "France",
    propertyCode: "PAR",
    laws: [
      { name: "Loi Informatique et Libertés (amended by RGPD)", relevance: "CNIL oversight; automated guest rate profiling requires consent or legitimate interest assessment", constraint_type: "audit_required" },
      { name: "Code de la consommation Art. L121-11", relevance: "Aggressive commercial practices — automated rate pressure tactics are prohibited", constraint_type: "mandatory_must_not" },
      { name: "Loi Hamon (Consumer Law 2014)", relevance: "14-day cooling-off period does not apply to hotel stays but rate accuracy obligations apply", constraint_type: "disclosure_required" },
      { name: "Loi Elan — transparency in hospitality pricing", relevance: "Exception ceilings must be documented and available for regulatory inspection", constraint_type: "audit_required" },
    ],
    ceiling_modifiers: [
      "France CNIL: automated profiling for rate personalisation requires DPIA if large-scale processing",
      "Code de la consommation: documented rationale required for exceptions exceeding 15% below rack rate",
    ],
    mandatory_must_not_clauses: [
      "MUST NOT use automated rate exception logic constituting aggressive commercial practices (Code de la consommation Art. L121-11)",
      "MUST NOT apply rate personalisation based on inferred personal data without CNIL-compliant lawful basis (Loi Informatique et Libertés Art. 6)",
    ],
  },
  VIE: {
    country: "Austria",
    propertyCode: "VIE",
    laws: [
      { name: "Österreichisches Datenschutzgesetz (DSG 2018)", relevance: "Austrian DPA (DSB) oversight; automated rate decisions affecting guests require Art. 22 GDPR assessment", constraint_type: "audit_required" },
      { name: "Konsumentenschutzgesetz (KSchG)", relevance: "Consumer protection — automated rate exceptions must not disadvantage protected consumer groups", constraint_type: "mandatory_must_not" },
      { name: "UWG (Unlauterer Wettbewerb)", relevance: "Unfair competition law — AI rate agents must not use guest data for anti-competitive personalised pricing", constraint_type: "mandatory_must_not" },
      { name: "Preisauszeichnungsgesetz (PrAG)", relevance: "Price labelling law — displayed rates must match the exception authority applied by AI agents", constraint_type: "disclosure_required" },
    ],
    ceiling_modifiers: [
      "Austria KSchG: consumer-facing exception discounts above 20% require documented business justification",
      "PrAG: any AI-applied rate modification must be traceable to a displayed price record",
    ],
    mandatory_must_not_clauses: [
      "MUST NOT apply automated rate exceptions that produce unlabelled price changes (Preisauszeichnungsgesetz §1)",
      "MUST NOT use guest profile scoring as a sole basis for rate denial (DSG 2018 Art. 22 GDPR implementation)",
    ],
  },
};

// ─── Source clause type ───────────────────────────────────────────────────────

export interface SourceClause {
  exception_class: string;
  traced_to_clause: string;
}

// ─── Generate function params ─────────────────────────────────────────────────

export interface GenerateExceptionAuthorityParams {
  agentId: string;
  companyId: number;
  agentsMd: string;
  sopMd: string;
  skillMd: string;
  brandContext?: string;
  companyName?: string;
  industry?: string;
  jurisdiction: JurisdictionContext | null;
}

export interface GenerateExceptionAuthorityResult {
  content: string;
  sourceClauses: SourceClause[];
  missingTraceability: string[];
  jurisdictionApplied: string | null;
}

// ─── Main generator ───────────────────────────────────────────────────────────

export async function generateExceptionAuthorityFile(
  params: GenerateExceptionAuthorityParams
): Promise<GenerateExceptionAuthorityResult> {
  const {
    agentId,
    companyId,
    agentsMd,
    sopMd,
    skillMd,
    brandContext,
    companyName,
    industry,
    jurisdiction,
  } = params;

  const today = new Date().toISOString().split("T")[0];
  const jurisdictionBlock = jurisdiction
    ? `
JURISDICTION: ${jurisdiction.country} (${jurisdiction.propertyCode})
Applicable laws:
${jurisdiction.laws.map(l => `- ${l.name}: ${l.relevance} [${l.constraint_type}]`).join("\n")}
Ceiling modifiers:
${jurisdiction.ceiling_modifiers.map(m => `- ${m}`).join("\n")}
Mandatory MUST NOT clauses to include verbatim:
${jurisdiction.mandatory_must_not_clauses.map(c => `- ${c}`).join("\n")}`
    : "JURISDICTION: Platform-level (no hotel-specific jurisdiction context — use generic EU hospitality norms)";

  const systemPrompt = `You are a VDA-MD governance architect generating a jurisdiction-aware EXCEPTION_AUTHORITY.md for a hospitality AI agent operating under A Hotel Berlin's governance framework.

OUTPUT FORMAT — produce EXACTLY this structure:
1. YAML front matter (--- ... ---) containing:
   - file_type, agent_id, owner, version, approved_by, approved_at, domain, apaleo_api, nist_control
   - source_clauses: array of { exception_class: string, traced_to_clause: string } — each exception class MUST be traced to the SOP.md MAY clause that produced it
2. YAML body (single document after the front matter) with:
   - role_bands: { [band]: { exceptions: [ { exception_class, description, ceiling, ceiling_type, conditions: [], authority, escalate_to, must_log } ] } }
   - must_not_override: string[] — include jurisdiction-specific MUST NOT clauses verbatim
   - escalation_targets: { [label]: band }
3. A ## Jurisdiction Notes section at the end (markdown, not YAML) citing the applicable laws

ROLE BANDS to generate: ambassador, senior_ambassador, hotel_gm, regional_gm, operations_chief, compliance_officer

IMPORTANT:
- Every exception_class in the body MUST also appear in source_clauses in the front matter
- Jurisdiction-specific MUST NOT clauses MUST appear verbatim in must_not_override
- Ceilings must be numeric (percent_below_bar) or null for unlimited-hitl entries
- authority: either "autonomous" (within ceiling, no HITL) or "hitl_required"
- Respond with ONLY the file content — no explanation, no markdown fences`;

  const userPrompt = `Generate EXCEPTION_AUTHORITY.md for:
Agent ID: ${agentId}
Company: ${companyName || "A Hotel Berlin Hotels"}
Industry: ${industry || "hospitality"}
Brand context: ${brandContext ? brandContext.slice(0, 300) : "A Hotel Berlin — tech-forward affordable luxury hotels"}

${jurisdictionBlock}

Source files to derive exception classes from:

--- AGENTS.md ---
${agentsMd.slice(0, 1500)}

--- SOP.md (MAY clauses are exception class sources) ---
${sopMd.slice(0, 2000)}

--- SKILL.md ---
${skillMd.slice(0, 800)}

Generate the complete EXCEPTION_AUTHORITY.md. Trace every exception class to the SOP.md MAY clause that permits it. Include ${jurisdiction ? jurisdiction.country + "-specific" : "EU-standard"} jurisdiction notes.`;

  logger.info({ agentId, companyId, jurisdictionApplied: jurisdiction?.propertyCode ?? null }, "[exceptionAuthorityGenerator] Calling AI");

  const raw = await callAI({
    model: "claude-sonnet-4-6",
    max_tokens: 3500,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const content = raw.trim();

  const sourceClauses = extractSourceClauses(content);
  const jurisdictionApplied = jurisdiction?.propertyCode ?? null;

  // Post-generation validation: every exception_class in role_bands must have a source_clause entry
  const missingTraceability: string[] = [];
  try {
    const bodyMatch = content.match(/^---[\s\S]*?---\s*\n([\s\S]*)$/);
    if (bodyMatch) {
      const bodyDoc = yaml.load(bodyMatch[1]) as Record<string, unknown> | null;
      const roleBands = (bodyDoc?.role_bands ?? {}) as Record<string, { exceptions?: Array<{ exception_class?: string }> }>;
      const tracedClasses = new Set(sourceClauses.map(c => c.exception_class));
      for (const [band, bandDef] of Object.entries(roleBands)) {
        for (const exc of bandDef?.exceptions ?? []) {
          if (exc.exception_class && !tracedClasses.has(exc.exception_class)) {
            missingTraceability.push(`${band}/${exc.exception_class}`);
          }
        }
      }
    }
  } catch { /* parse error — skip validation */ }

  if (missingTraceability.length > 0) {
    logger.warn({ agentId, companyId, missingTraceability }, "[exceptionAuthorityGenerator] Some exception classes lack source_clause traceability");
  }

  logger.info({ agentId, companyId, sourceClauses: sourceClauses.length, missingTraceability: missingTraceability.length, jurisdictionApplied }, "[exceptionAuthorityGenerator] Generated OK");

  return { content, sourceClauses, missingTraceability, jurisdictionApplied };
}

// ─── Helper: parse source_clauses from YAML front matter using js-yaml ────────
// Uses js-yaml for reliable multi-line YAML list parsing. Falls back to regex
// line walk if the front matter is not valid YAML.

function extractSourceClauses(content: string): SourceClause[] {
  try {
    const frontMatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!frontMatterMatch) return [];

    // Primary path: js-yaml parse of the front matter block
    const parsed = yaml.load(frontMatterMatch[1]) as Record<string, unknown> | null;
    const rawClauses = parsed?.source_clauses;
    if (Array.isArray(rawClauses)) {
      return rawClauses
        .filter(
          (c): c is Record<string, string> =>
            typeof c === "object" &&
            c !== null &&
            typeof (c as Record<string, unknown>).exception_class === "string" &&
            typeof (c as Record<string, unknown>).traced_to_clause === "string"
        )
        .map(c => ({
          exception_class: String(c.exception_class).trim(),
          traced_to_clause: String(c.traced_to_clause).trim(),
        }));
    }

    // Fallback: regex line-walk (handles malformed YAML where js-yaml fails)
    const fm = frontMatterMatch[1];
    const scBlock = fm.match(/source_clauses:\s*\n((?:[ \t][^\n]+\n?)*)/);
    if (!scBlock) return [];

    const clauses: SourceClause[] = [];
    const lines = scBlock[1].split("\n");
    let current: Partial<SourceClause> = {};
    for (const line of lines) {
      const classMatch = line.match(/exception_class:\s*["']?([^"'\n]+?)["']?\s*$/);
      const clauseMatch = line.match(/traced_to_clause:\s*["']?([^"'\n]+?)["']?\s*$/);
      if (classMatch) {
        if (current.exception_class && current.traced_to_clause) clauses.push(current as SourceClause);
        current = { exception_class: classMatch[1].trim() };
      } else if (clauseMatch && current.exception_class) {
        current.traced_to_clause = clauseMatch[1].trim();
        clauses.push(current as SourceClause);
        current = {};
      }
    }
    if (current.exception_class && current.traced_to_clause) clauses.push(current as SourceClause);
    return clauses;
  } catch {
    return [];
  }
}
