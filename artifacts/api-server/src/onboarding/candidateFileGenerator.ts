/**
 * Candidate File Generator — uses Claude tool_use forcing to produce
 * AGENTS.md, SOP.md, SKILL.md, optional EXCEPTION.md for a new agent.
 */
import { callAIFull } from "../routes/ai-proxy.js";
import { logger } from "../lib/logger.js";
import type { AgentCard, ImpactDeltaReport, EuAiActClassification, GdprAssessment } from "./impactDeltaAnalyser.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FileModification {
  filename: string;
  modification_description: string;
  new_content: string;
}

export interface CandidateFiles {
  agents_md: string;
  sop_md: string;
  skill_md: string;
  exception_md: string | null;
  files_to_modify: FileModification[];
}

export interface ComplianceGuardResult {
  passed: boolean;
  failures: string[];
}

// ─── Compliance guard ─────────────────────────────────────────────────────────

export function validateCandidateFiles(files: CandidateFiles): ComplianceGuardResult {
  const failures: string[] = [];

  // SOP.md: MUST count >= 3
  const mustCount = (files.sop_md.match(/\bMUST\b/g) ?? []).length;
  if (mustCount < 3) {
    failures.push(`SOP.md MUST count is ${mustCount} — minimum 3 required`);
  }

  // SOP.md: MUST NOT count >= 1
  const mustNotCount = (files.sop_md.match(/\bMUST NOT\b/g) ?? []).length;
  if (mustNotCount < 1) {
    failures.push("SOP.md must contain at least one MUST NOT clause");
  }

  // AGENTS.md: NIST control reference
  if (!/nist_control|NIST|SP\s*800/i.test(files.agents_md)) {
    failures.push("AGENTS.md must include a NIST control reference");
  }

  // SKILL.md: NOT permitted section
  if (!/NOT Permitted|MUST NOT|NOT permitted/i.test(files.skill_md)) {
    failures.push("SKILL.md must include a NOT Permitted section");
  }

  // AGENTS.md: EU AI Act reference (§3 immutability — all governance files must contain it)
  if (!/EU AI Act|eu_ai_act_risk_class|Artificial Intelligence Act/i.test(files.agents_md)) {
    failures.push("AGENTS.md must include an EU AI Act risk classification reference (VDA-MD §3)");
  }

  // SOP.md: GDPR reference (§3 immutability)
  if (!/GDPR|General Data Protection|data subject|Article 22/i.test(files.sop_md)) {
    failures.push("SOP.md must include a GDPR compliance clause (VDA-MD §3)");
  }

  // AGENTS.md: GDPR reference (§3 immutability)
  if (!/GDPR|General Data Protection|data subject|Article 22/i.test(files.agents_md)) {
    failures.push("AGENTS.md must include a GDPR reference (VDA-MD §3)");
  }

  return { passed: failures.length === 0, failures };
}

// ─── Tool definition ──────────────────────────────────────────────────────────

const GENERATE_TOOL = {
  name: "generate_candidate_governance_files",
  description: "Generate complete VDA-MD governance files for a new agent joining the framework.",
  input_schema: {
    type: "object",
    required: ["agents_md", "sop_md", "skill_md", "files_to_modify"],
    properties: {
      agents_md: {
        type: "string",
        description: "Complete AGENTS.md content with YAML front matter and governance rules",
      },
      sop_md: {
        type: "string",
        description: "Complete SOP.md content with MUST/MUST NOT/MAY clauses (min 3 MUST, 1 MUST NOT)",
      },
      skill_md: {
        type: "string",
        description: "Complete SKILL.md content with permitted skills (excluding auto-removed) and NOT permitted section",
      },
      exception_md: {
        type: ["string", "null"],
        description: "EXCEPTION.md content if any skill deviates from baseline governance, otherwise null",
      },
      files_to_modify: {
        type: "array",
        description: "List of existing governance files that need cross-reference updates",
        items: {
          type: "object",
          required: ["filename", "modification_description", "new_content"],
          properties: {
            filename: { type: "string" },
            modification_description: { type: "string" },
            new_content: { type: "string" },
          },
        },
      },
    },
  },
};

// ─── Generator ────────────────────────────────────────────────────────────────

export async function generateCandidateFiles(
  agentCard: AgentCard,
  impactDelta: ImpactDeltaReport
): Promise<CandidateFiles> {
  const today = new Date().toISOString().split("T")[0];
  const expiresDate = new Date();
  expiresDate.setFullYear(expiresDate.getFullYear() + 1);
  const expires = expiresDate.toISOString().split("T")[0];

  const agentSlug = agentCard.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  // Skills with auto-removed skills excluded
  const permittedSkills = agentCard.skills
    .filter(s => !impactDelta.auto_removed_skills.includes(s.id))
    .map(s => `${s.id}: ${s.description}`)
    .join("\n");

  const autoRemovedNote = impactDelta.auto_removed_skills.length > 0
    ? `\nAUTO-REMOVED SKILLS (duplicates found in existing agents, must NOT appear in SKILL.md): ${impactDelta.auto_removed_skills.join(", ")}`
    : "";

  const raciOwner = impactDelta.raci_exceptions.length > 0
    ? impactDelta.raci_exceptions[0].candidate_owners[0]
    : "Compliance Officer";

  const hasDeviations = impactDelta.conflicts.some(c => c.type === "must_not_boundary" || c.type === "authority_collision");

  const eu = impactDelta.eu_ai_act_classification;
  const gdpr = impactDelta.gdpr_assessment;

  const systemPrompt = `You are a VDA-MD governance architect generating candidate governance files for a new agent joining the framework.
Generate files that follow the exact patterns of existing VDA-MD governance files.

RULES:
- Every YAML front matter MUST include: control_id, domain, owner, nist_control, approved_by: "PENDING", expires, risk_level, eu_ai_act_risk_class, gdpr_art22_scope
- SOP.md MUST have minimum 3 MUST clauses and minimum 1 MUST NOT clause
- SKILL.md MUST have a "NOT Permitted" section listing what the agent cannot do
- EXCEPTION.md: generate ONLY if skills deviate from baseline governance, otherwise return null
- Use ISO date format (YYYY-MM-DD) for dates
- The approved_date field: ${today}
- The expires field: ${expires}
- NIST control: derive closest match from SA-4, AC-2, AU-2, or SI-4 based on the agent's domain
- risk_level: "low" if no conflicts, "medium" if authority_collision, "high" if must_not_boundary
- rollback_instruction: "To roll back: revert the PR that introduced these files. The agent VC expires within 24 hours of revocation."
${autoRemovedNote}

EU AI ACT CLASSIFICATION (pre-computed — embed verbatim in AGENTS.md YAML and compliance section):
- eu_ai_act_risk_class: "${eu.risk_class}"
- Art. 14 human oversight required: ${eu.art_14_human_oversight_required}
- Rationale: ${eu.rationale}
- AGENTS.md MUST contain the phrase "EU AI Act" and the risk class. This is immutable under VDA-MD §3.

GDPR ASSESSMENT (pre-computed — embed verbatim in SOP.md compliance section):
- gdpr_art22_scope: ${gdpr.art22_scope}
- Lawful basis: ${gdpr.lawful_basis} (${gdpr.lawful_basis_article})
- Data categories: ${gdpr.data_categories.join("; ")}
- HITL required: ${gdpr.hitl_required}
- Rationale: ${gdpr.rationale}
- SOP.md MUST contain "GDPR" and "Article 22" references. AGENTS.md MUST reference GDPR. Both are immutable under VDA-MD §3.
- If gdpr_art22_scope is true, SOP.md MUST include: "MUST NOT execute automated decisions above authority ceiling without HITL approval (GDPR Article 22(2)(a))"

EXISTING FILES TO MODIFY (add cross-references for the new agent):
${impactDelta.affected_files.length > 0 ? impactDelta.affected_files.map(f => `- ${f}`).join("\n") : "None"}

You MUST call the generate_candidate_governance_files tool with complete file contents.`;

  const userMessage = `Generate governance files for this new agent:

Name: ${agentCard.name}
Description: ${agentCard.description}
Version: ${agentCard.version}
Endpoint: ${agentCard.url}

Permitted Skills (after auto-removal):
${permittedSkills}

Domain owner (from RACI resolution): ${raciOwner}
Has governance deviations requiring EXCEPTION.md: ${hasDeviations}
Conflicts found: ${impactDelta.conflicts.length}
Auto-removed skills: ${impactDelta.auto_removed_skills.join(", ") || "none"}

Generate complete, production-quality governance files that match VDA-MD conventions.`;

  logger.info({ agentName: agentCard.name }, "Calling Claude for candidate file generation");

  const response = await callAIFull({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
    tools: [GENERATE_TOOL],
  });

  // Extract tool use result
  for (const block of response.content) {
    if (block.type === "tool_use" && block.name === "generate_candidate_governance_files") {
      const input = block.input as CandidateFiles;
      logger.info({ agentName: agentCard.name }, "Candidate files generated via tool_use");
      return {
        agents_md: input.agents_md,
        sop_md: input.sop_md,
        skill_md: input.skill_md,
        exception_md: input.exception_md ?? null,
        files_to_modify: input.files_to_modify ?? [],
      };
    }
  }

  // Fallback if tool was not called
  logger.warn({ agentName: agentCard.name }, "Claude did not call tool — generating minimal fallback files");
  return generateFallbackFiles(agentCard, impactDelta, today, expires, raciOwner, agentSlug);
}

function generateFallbackFiles(
  agentCard: AgentCard,
  impactDelta: ImpactDeltaReport,
  today: string,
  expires: string,
  owner: string,
  agentSlug: string
): CandidateFiles {
  const permittedSkills = agentCard.skills
    .filter(s => !impactDelta.auto_removed_skills.includes(s.id));

  const eu = impactDelta.eu_ai_act_classification;
  const gdpr = impactDelta.gdpr_assessment;

  const agents_md = `---
control_id: governance-${agentSlug}
domain: Operations
owner: ${owner}
authored_by: Onboarding Agent
nist_control: SA-4
approved_by: PENDING
approved_date: ${today}
expires: ${expires}
risk_level: ${impactDelta.conflicts.length > 0 ? "medium" : "low"}
eu_ai_act_risk_class: ${eu.risk_class}
gdpr_art22_scope: ${gdpr.art22_scope}
rollback_instruction: "To roll back: revert the PR that introduced these files. The agent VC expires within 24 hours of revocation."
---
## ${agentCard.name}
${agentCard.description}

### EU AI Act Compliance
Risk classification: **${eu.risk_class.toUpperCase()}** under EU AI Act.
${eu.rationale}
Art. 14 human oversight required: ${eu.art_14_human_oversight_required ? "YES — HITL mandatory for all above-ceiling decisions" : "NO — within-ceiling decisions may be automated"}.

### GDPR Compliance
Lawful basis: ${gdpr.lawful_basis} (${gdpr.lawful_basis_article}).
GDPR Article 22 scope: ${gdpr.art22_scope ? "IN SCOPE — agent makes automated decisions affecting individual guests" : "OUT OF SCOPE — no significant automated individual decisions"}.
Data categories processed: ${gdpr.data_categories.join("; ")}.

### Agent Rules
- MUST verify VC before accepting any task
- MUST apply declared governance files before acting
- MUST NOT act outside declared skill boundaries
- MUST NOT make decisions without valid governance envelope
- MUST NOT retain guest personal data beyond the operational requirement (GDPR Article 5)
- MAY request human review when context is ambiguous
`;

  const art22Clause = gdpr.art22_scope
    ? `- MUST NOT execute automated decisions above authority ceiling without HITL approval (GDPR Article 22(2)(a))\n- MUST log all automated decisions affecting individual guests with verbatim governing clause (GDPR Article 22(3))\n`
    : "";

  const sop_md = `---
control_id: governance-${agentSlug}-sop
domain: Operations
owner: ${owner}
nist_control: SA-4
approved_by: PENDING
expires: ${expires}
mustCount: ${Math.max(3, permittedSkills.length + 2)}
mustNotCount: ${gdpr.art22_scope ? 3 : 1}
mayCount: 1
---
## ${agentCard.name} SOP

${permittedSkills.map(s => `- MUST validate all inputs before executing ${s.id}`).join("\n")}
- MUST NOT act outside declared skill boundaries
- MUST NOT execute without a valid W3C Verifiable Credential
${art22Clause}- MUST NOT process guest personal data beyond what is strictly necessary for the declared purpose (GDPR Article 6)
- MAY request human review when context is ambiguous

### Compliance Framework
Frameworks: GDPR · EU AI Act · NIST SP 800-53 · ISO 42001
GDPR: Lawful basis ${gdpr.lawful_basis_article} — ${gdpr.lawful_basis}. Data subjects have the right to request human review of any automated decision (GDPR Article 22(3)).
EU AI Act: ${eu.risk_class.toUpperCase()} risk classification. ${eu.art_14_human_oversight_required ? "Art. 14 human oversight (HITL) is mandatory for above-ceiling decisions." : "Art. 14 oversight: recommended but not mandatory for within-ceiling decisions."}
`;

  const skill_md = `---
control_id: governance-${agentSlug}-skill
domain: Operations
owner: ${owner}
---
## Permitted Skills
${permittedSkills.map(s => `- ${s.id}: ${s.description}`).join("\n")}

## NOT Permitted
- direct_push_to_main: under any circumstance
- modify_governance_files: without explicit HITL approval
- self_modification: cannot modify its own governance files
- process_personal_data_beyond_scope: GDPR Article 5 data minimisation applies
`;

  return {
    agents_md,
    sop_md,
    skill_md,
    exception_md: null,
    files_to_modify: [],
  };
}
