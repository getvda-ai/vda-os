/**
 * Impact Delta Analyser — deterministic, no Claude API.
 * Reads governance files and witness entries from DB only.
 */
import { db, governanceFiles, witnessEntries } from "@workspace/db";
import { eq, and, gte, ne } from "drizzle-orm";
import { logger } from "../lib/logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  capabilities: { streaming: boolean; pushNotifications: boolean };
  skills: Array<{ id: string; name: string; description: string }>;
  authentication?: { schemes: string[] };
}

export interface ConflictEntry {
  type: "duplication" | "must_not_boundary" | "authority_collision";
  skill: string;
  existing_agent: string;
  existing_file: string;
  resolution: "auto_removed" | "hitl_exception" | "blocks_onboarding";
}

export interface FrictionRemoved {
  escalation_count: number;
  escalations_per_week: number;
  clause: string;
  affected_agent: string;
  resolving_skill: string;
}

export interface ValueAdded {
  type: "may_clause_activated" | "cross_domain_gap_closed";
  description: string;
  governance_file: string;
  activating_skill: string;
}

export interface RaciException {
  intersection: string;
  candidate_owners: string[];
  resolution: "both_notified";
}

export interface ImpactDeltaReport {
  friction_removed: FrictionRemoved[];
  value_added: ValueAdded[];
  conflicts: ConflictEntry[];
  raci_exceptions: RaciException[];
  auto_removed_skills: string[];
  affected_files: string[];
  files_to_create: number;
  files_to_modify: number;
  rollback_scope: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const KNOWN_AGENTS = [
  "availability-agent", "rate-agent", "reservation-bot", "check-in-agent",
  "folio-agent", "folio-charge-agent", "checkout-agent", "revenue-reconciliation-agent",
];

function parseSkillNames(content: string): string[] {
  const skills: string[] = [];
  const lines = content.split("\n");
  for (const line of lines) {
    // Match "- skill_name: DESCRIPTION" or "- MUST use_skill: ..." or "- skill_name"
    const m = line.match(/^[-*]\s+([a-z_][a-z0-9_-]*)\s*(?::|—|-|$)/i);
    if (m) skills.push(m[1].toLowerCase().replace(/[-\s]+/g, "_"));
    // Also match "- **SKILL_NAME**" pattern
    const m2 = line.match(/^[-*]\s+\*?\*?([a-z_][a-z0-9_-]*)\*?\*?/i);
    if (m2 && !skills.includes(m2[1].toLowerCase().replace(/[-\s]+/g, "_"))) {
      skills.push(m2[1].toLowerCase().replace(/[-\s]+/g, "_"));
    }
  }
  return [...new Set(skills)];
}

function parseMustNotClauses(content: string): string[] {
  const clauses: string[] = [];
  const lines = content.split("\n");
  for (const line of lines) {
    if (/MUST NOT/i.test(line)) clauses.push(line.trim());
  }
  return clauses;
}

function parseMayClauses(content: string): string[] {
  const clauses: string[] = [];
  const lines = content.split("\n");
  for (const line of lines) {
    if (/\bMAY\b/.test(line) && /^[-*]/.test(line.trim())) {
      clauses.push(line.trim());
    }
  }
  return clauses;
}

function parseOwnerFromYaml(content: string): string | null {
  const m = content.match(/^owner:\s*(.+)$/m);
  return m ? m[1].trim() : null;
}

function parseDomainFromYaml(content: string): string | null {
  const m = content.match(/^domain:\s*(.+)$/m);
  return m ? m[1].trim() : null;
}

function skillSimilarity(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[-_\s]+/g, "");
  return norm(a) === norm(b) || norm(a).includes(norm(b)) || norm(b).includes(norm(a));
}

// ─── Main analyser ────────────────────────────────────────────────────────────

export async function analyseImpactDelta(
  agentCard: AgentCard,
  _companyId: number
): Promise<ImpactDeltaReport> {
  const incomingSkills = agentCard.skills.map(s => s.id);
  const agentName = agentCard.name;

  logger.info({ agentName, incomingSkills }, "Impact delta analysis started");

  // Load all SKILL.md files for existing property agents.
  // Exclude companyId=0 (platform sentinel) — the Onboarding Agent's own SKILL.md
  // lives there and must not appear as a conflict candidate against incoming skills.
  const skillFiles = await db
    .select({
      agentId: governanceFiles.agentId,
      content: governanceFiles.content,
      filename: governanceFiles.filename,
      filepath: governanceFiles.filepath,
      owner: governanceFiles.owner,
      domain: governanceFiles.domain,
    })
    .from(governanceFiles)
    .where(
      and(
        eq(governanceFiles.fileType, "SKILL"),
        eq(governanceFiles.isArchived, false),
        ne(governanceFiles.companyId, 0)   // exclude platform sentinel
      )
    );

  // Load all SOP.md files for MAY clause analysis.
  // Exclude companyId=0 — Onboarding Agent SOP MAY clauses (commit_via_pr, etc.)
  // are platform-internal and must not activate as "unexercised permissions" for
  // incoming property agents.
  const sopFiles = await db
    .select({
      agentId: governanceFiles.agentId,
      content: governanceFiles.content,
      filename: governanceFiles.filename,
      filepath: governanceFiles.filepath,
      owner: governanceFiles.owner,
      domain: governanceFiles.domain,
    })
    .from(governanceFiles)
    .where(
      and(
        eq(governanceFiles.fileType, "SOP"),
        eq(governanceFiles.isArchived, false),
        ne(governanceFiles.companyId, 0)   // exclude platform sentinel
      )
    );

  // Load all AGENTS.md files for RACI analysis.
  // Exclude companyId=0 — the Onboarding Agent's domain is "Governance" (platform),
  // not a property domain, so it must not pollute domain-owner intersection detection.
  const agentsMdFiles = await db
    .select({
      agentId: governanceFiles.agentId,
      content: governanceFiles.content,
      owner: governanceFiles.owner,
      domain: governanceFiles.domain,
    })
    .from(governanceFiles)
    .where(
      and(
        eq(governanceFiles.fileType, "AGENTS"),
        eq(governanceFiles.isArchived, false),
        ne(governanceFiles.companyId, 0)   // exclude platform sentinel
      )
    );

  // Witness entries — ESCALATE decisions in last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const recentEscalations = await db
    .select({
      agent: witnessEntries.agent,
      clauseApplied: witnessEntries.clauseApplied,
      createdAt: witnessEntries.createdAt,
    })
    .from(witnessEntries)
    .where(
      and(
        eq(witnessEntries.decision, "ESCALATE"),
        gte(witnessEntries.createdAt, thirtyDaysAgo)
      )
    );

  // All clause_applied values ever logged (for MAY clause exercise detection)
  const allLoggedClauses = await db
    .select({ clauseApplied: witnessEntries.clauseApplied })
    .from(witnessEntries);
  const loggedClauseSet = new Set(
    allLoggedClauses.map(r => r.clauseApplied?.toLowerCase() ?? "")
  );

  // ─── a. Skill overlap detection ───────────────────────────────────────────

  const conflicts: ConflictEntry[] = [];
  const autoRemovedSkills: string[] = [];
  const seenDomains = new Map<string, string[]>(); // domain → owners

  for (const skill of incomingSkills) {
    for (const sf of skillFiles) {
      if (!sf.agentId || !KNOWN_AGENTS.includes(sf.agentId)) continue;
      const existingSkills = parseSkillNames(sf.content);

      // Check for duplication
      const duplicate = existingSkills.find(es => skillSimilarity(skill, es));
      if (duplicate) {
        conflicts.push({
          type: "duplication",
          skill,
          existing_agent: sf.agentId,
          existing_file: sf.filepath ?? sf.filename,
          resolution: "auto_removed",
        });
        if (!autoRemovedSkills.includes(skill)) autoRemovedSkills.push(skill);
      }

      // Check for MUST NOT boundary overlap via SOP
      const agentSop = sopFiles.find(s => s.agentId === sf.agentId);
      if (agentSop) {
        const mustNotClauses = parseMustNotClauses(agentSop.content);
        for (const clause of mustNotClauses) {
          if (skill.split("_").some(part => clause.toLowerCase().includes(part) && part.length > 3)) {
            conflicts.push({
              type: "must_not_boundary",
              skill,
              existing_agent: sf.agentId,
              existing_file: agentSop.filepath ?? agentSop.filename,
              resolution: "hitl_exception",
            });
          }
        }
      }
    }

    // Authority collision check (finance domain)
    if (/charge|payment|fee|invoice|billing|revenue/.test(skill)) {
      const financeSop = sopFiles.find(s => s.domain?.toLowerCase().includes("finance"));
      if (financeSop) {
        conflicts.push({
          type: "authority_collision",
          skill,
          existing_agent: financeSop.agentId ?? "shared-finance",
          existing_file: financeSop.filepath ?? financeSop.filename,
          resolution: "hitl_exception",
        });
      }
    }
  }

  // ─── b. Friction reduction detection ─────────────────────────────────────

  const frictionRemoved: FrictionRemoved[] = [];
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const windowMs = 30 * 24 * 60 * 60 * 1000;

  for (const skill of incomingSkills) {
    // Group escalations by clause where skill keyword appears
    const matchingEscalations = recentEscalations.filter(e => {
      const clause = e.clauseApplied?.toLowerCase() ?? "";
      return skill.split("_").some(part => clause.includes(part) && part.length > 3);
    });

    if (matchingEscalations.length > 0) {
      // Group by agent
      const agentCounts = new Map<string, { count: number; clause: string; agent: string }>();
      for (const e of matchingEscalations) {
        const key = e.agent;
        if (!agentCounts.has(key)) {
          agentCounts.set(key, { count: 0, clause: e.clauseApplied ?? "", agent: e.agent });
        }
        agentCounts.get(key)!.count++;
      }
      for (const [, entry] of agentCounts) {
        frictionRemoved.push({
          escalation_count: entry.count,
          escalations_per_week: parseFloat((entry.count / (windowMs / weekMs)).toFixed(2)),
          clause: entry.clause,
          affected_agent: entry.agent,
          resolving_skill: skill,
        });
      }
    }
  }

  // ─── c. Value addition detection ─────────────────────────────────────────

  const valueAdded: ValueAdded[] = [];

  for (const sop of sopFiles) {
    const mayClauses = parseMayClauses(sop.content);
    for (const clause of mayClauses) {
      // Check if this MAY clause has ever appeared in witness_entries
      const isExercised = [...loggedClauseSet].some(logged =>
        logged.includes(clause.toLowerCase().slice(0, 40))
      );
      if (!isExercised) {
        // Check if any incoming skill could activate this MAY clause
        const activatingSkill = incomingSkills.find(skill =>
          skill.split("_").some(part => clause.toLowerCase().includes(part) && part.length > 3)
        );
        if (activatingSkill) {
          valueAdded.push({
            type: "may_clause_activated",
            description: `Activates unexercised MAY permission: "${clause.slice(0, 100)}"`,
            governance_file: sop.filepath ?? sop.filename,
            activating_skill: activatingSkill,
          });
        }
      }
    }
  }

  // ─── d. RACI exception detection ─────────────────────────────────────────

  const raciExceptions: RaciException[] = [];

  // Determine incoming domain from agent card description
  const incomingDomain = agentCard.description?.match(/\b(finance|operations|compliance|hr|legal|it|security|revenue)\b/i)?.[1] ?? "Unknown";

  // Find existing owners in this domain
  const existingOwners = new Set<string>();
  for (const am of agentsMdFiles) {
    const fileDomain = am.domain ?? parseDomainFromYaml(am.content ?? "");
    const fileOwner = am.owner ?? parseOwnerFromYaml(am.content ?? "");
    if (fileDomain?.toLowerCase() === incomingDomain.toLowerCase() && fileOwner) {
      existingOwners.add(fileOwner);
    }
    // Track domains
    const key = fileDomain ?? "Unknown";
    if (!seenDomains.has(key)) seenDomains.set(key, []);
    if (fileOwner) seenDomains.get(key)!.push(fileOwner);
  }

  if (existingOwners.size > 1) {
    raciExceptions.push({
      intersection: `${incomingDomain} × ${agentCard.skills[0]?.id ?? "unknown-skill"}`,
      candidate_owners: [...existingOwners],
      resolution: "both_notified",
    });
  }

  // ─── e. Affected files list ───────────────────────────────────────────────

  const affectedFiles: string[] = [];

  // SOP.md files where incoming skills activate MAY clauses
  for (const vAdd of valueAdded) {
    if (!affectedFiles.includes(vAdd.governance_file)) {
      affectedFiles.push(vAdd.governance_file);
    }
  }

  // AGENTS.md files in the same domain (need cross-reference updates)
  for (const am of agentsMdFiles) {
    const fileDomain = am.domain ?? parseDomainFromYaml(am.content ?? "");
    if (fileDomain?.toLowerCase() === incomingDomain.toLowerCase()) {
      const path = `governance/${fileDomain}/AGENTS.md`;
      if (!affectedFiles.includes(path)) affectedFiles.push(path);
    }
  }

  const agentSlug = agentCard.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const filesToCreate = 3 + (conflicts.some(c => c.type !== "duplication") ? 1 : 0); // AGENTS.md, SOP.md, SKILL.md, optional EXCEPTION.md
  const filesToModify = affectedFiles.length;

  const report: ImpactDeltaReport = {
    friction_removed: frictionRemoved,
    value_added: valueAdded,
    conflicts,
    raci_exceptions: raciExceptions,
    auto_removed_skills: autoRemovedSkills,
    affected_files: affectedFiles,
    files_to_create: filesToCreate,
    files_to_modify: filesToModify,
    rollback_scope: `Remove ${agentSlug} governance files, revoke VC, remove Agent Card registration`,
  };

  logger.info(
    {
      agentName,
      friction: frictionRemoved.length,
      value: valueAdded.length,
      conflicts: conflicts.length,
      autoRemoved: autoRemovedSkills.length,
      raci: raciExceptions.length,
    },
    "Impact delta analysis complete"
  );

  return report;
}
