/**
 * Seeds governance files for the Onboarding Agent (platform-level).
 * Called once at startup — idempotent, checks before inserting.
 */
import { db, governanceFiles, companies } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const ONBOARDING_AGENTS_MD = `---
control_id: governance-onboarding-agent
domain: Governance
owner: Compliance Officer
authored_by: Platform Engineering
consulted: [General Counsel, CISO, CFO]
informed: [COO, all Domain Owners]
scope: platform
inherits: [Shared-Services-Legal, Shared-Services-Finance]
baseline: true
nist_control: SA-4
approved_date: 2026-04-11
---
## Onboarding Agent
Governs the addition of external agents to the VDA-MD framework.
Operates at platform scope across all company instances.

### Agent Rules
- MUST verify VC before accepting any onboarding request
- MUST run full impact delta analysis before generating candidate files
- MUST auto-remove duplicate skills from candidate SKILL.md before HITL
- MUST NOT approve agents that claim skills outside their declared domain
- MUST NOT commit governance files without two HITL approvals
- MUST NOT approve its own onboarding requests
- MUST NOT make direct push to main branch under any circumstance
- MUST run sandbox eval (5-scenario governance evaluation) before second HITL gate
- MUST create rollback reference before any production commit
- MUST surface RACI conflicts as named exceptions, not blockers
- MAY auto-generate candidate governance files from Agent Card content
- MAY auto-remove duplicate skills with Witness log entry
`;

const ONBOARDING_SOP_MD = `---
control_id: governance-onboarding-sop
domain: Governance
owner: Compliance Officer
nist_control: SA-4
mustCount: 9
mustNotCount: 5
mayCount: 2
---
## Onboarding Agent SOP

### Phase 1 — Discovery and Validation
- MUST verify the external agent presents a valid W3C VC Bearer token
- MUST extract Agent Card from the A2A tasks/send payload
- MUST validate Agent Card conforms to A2A spec fields: name, description, url, version, capabilities, skills, authentication
- MUST NOT proceed if Agent Card is malformed or VC is invalid

### Phase 2 — Impact Delta Analysis
- MUST analyse all existing agent SKILL.md files for skill overlap
- MUST query witness_entries for ESCALATE events in last 30 days matching any skill the new agent declares
- MUST check all SOP.md MAY clauses for currently unexercised permissions the new agent could activate
- MUST check all cross-domain inheritance gaps the new agent could close
- MUST identify MUST NOT boundary overlaps with existing agents
- MUST identify authority threshold collisions in Shared Services Finance
- MUST auto-remove duplicate skills from candidate SKILL.md
- MUST NOT block onboarding for RACI ambiguity — surface as exception

### Phase 3 — Candidate File Generation
- MUST generate: candidate AGENTS.md, SOP.md, SKILL.md for new agent
- MUST generate: EXCEPTION.md if any requested capability deviates from baseline
- MUST generate: list of all existing files requiring modification
- MUST validate all candidate files pass Compliance Guard before HITL

### Phase 4 — First HITL Gate
- MUST send Decision Card to domain owner + Compliance Officer
- Decision Card MUST include full Impact Delta Report
- MUST NOT proceed to sandbox without both approvals
- Reject: terminate with Witness entry, no files written

### Phase 5 — Sandbox Evaluation
- MUST trigger 5-scenario governance evaluation against candidate governance files
- MUST require pass rate >= sandbox_pass_threshold (read at runtime from platform/onboarding-policy.md) before second HITL
- MUST attach eval report to second HITL card

### Phase 6 — Second HITL Gate and Production
- MUST send second Decision Card with eval results attached
- MUST NOT commit to main without this second approval
- On approval: commit via PR only, issue VC, register Agent Card
- MUST write Witness entry: agent_onboarded with PR reference
`;

const ONBOARDING_SKILL_MD = `---
control_id: governance-onboarding-skill
domain: Governance
owner: Compliance Officer
---
## Permitted Skills
- read_all_governance_files: READ all AGENTS.md, SOP.md, SKILL.md, EXCEPTION.md files across all agents and companies
- read_witness_log: QUERY witness_entries for impact delta analysis
- write_candidate_files: WRITE to staging branch only, never main
- call_eval_pipeline: TRIGGER 5-scenario governance evaluation against candidate files
- trigger_hitl: CALL POST /hitl/escalate for both approval gates
- commit_via_pr: CREATE pull request to governance repo, never direct push
- issue_vc: CALL POST /api/agents/credentials/issue for approved agent
- register_agent_card: ADD new agent to A2A Agent Card registry

## NOT Permitted
- direct_push_to_main: under any circumstance
- modify_must_not_clauses: in any existing governance file
- self_approval: cannot approve its own onboarding or any request where it is the subject
`;

export async function seedOnboardingAgentGovernanceFiles() {
  try {
    // Get all company IDs to seed for each one
    const allCompanies = await db.select({ id: companies.id }).from(companies);
    const companyIds = allCompanies.map(c => c.id);

    // Also seed for platform company (0) for system-level access
    const seedIds = [0, ...companyIds];

    for (const companyId of seedIds) {
      const files = [
        { fileType: "AGENTS", content: ONBOARDING_AGENTS_MD, filename: "AGENTS.md", mustCount: 9, mustNotCount: 5, mayCount: 2 },
        { fileType: "SOP", content: ONBOARDING_SOP_MD, filename: "SOP.md", mustCount: 9, mustNotCount: 5, mayCount: 2 },
        { fileType: "SKILL", content: ONBOARDING_SKILL_MD, filename: "SKILL.md", mustCount: 0, mustNotCount: 3, mayCount: 0 },
      ];

      for (const f of files) {
        const existing = await db
          .select({ id: governanceFiles.id })
          .from(governanceFiles)
          .where(
            and(
              eq(governanceFiles.companyId, companyId),
              eq(governanceFiles.agentId, "onboarding-agent"),
              eq(governanceFiles.fileType, f.fileType as "AGENTS" | "SOP" | "SKILL"),
              eq(governanceFiles.isArchived, false)
            )
          )
          .limit(1);

        if (existing.length === 0) {
          await db.insert(governanceFiles).values({
            companyId,
            agentId: "onboarding-agent",
            filename: f.filename,
            filepath: `governance/platform/onboarding-agent/${f.filename}`,
            fileType: f.fileType,
            axis: "vertical",
            content: f.content,
            status: "active",
            owner: "Compliance Officer",
            domain: "Governance",
            baseline: true,
            nistControl: "SA-4",
            mustCount: f.mustCount,
            mustNotCount: f.mustNotCount,
            mayCount: f.mayCount,
            wordCount: f.content.split(/\s+/).length,
          });
        }
      }
    }

    logger.info("Onboarding Agent governance files seeded successfully");
  } catch (err) {
    logger.warn({ err }, "Failed to seed onboarding-agent governance files — will retry on next start");
  }
}
