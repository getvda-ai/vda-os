---
file_type: COMPLIANCE
agent_id: onboarding-agent
owner: Compliance Officer
companyId: 0
nist_control: AC-2
---

sandbox_pass_threshold: 0.95

crawl_agreement_threshold: 0.95

walk_agreement_threshold: 0.95

minimum_clause_counts:
  AGENTS: { must: 3, must_not: 2, may: 2 }
  SOP: { must: 3, must_not: 1, may: 1 }
  COMPLIANCE: { must: 3, must_not: 2, may: 2 }
  SKILL: { must: 2, must_not: 1, may: 1 }
  EXCEPTION: { must: 1, must_not: 1, may: 1 }
  EXCEPTION_AUTHORITY: { must: 2, must_not: 1, may: 1 }
  CUSTOM: { must: 1, must_not: 0, may: 0 }

front_line_bands:
  - ambassador
  - senior_ambassador
  - hotel_gm

cross_property_bands:
  - regional_gm
  - operations_chief
  - compliance_officer

valid_transitions:
  crawl: walk
  walk: run
