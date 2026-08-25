---
file_type: EXCEPTION_AUTHORITY
agent_id: revenue-reconciliation-agent
owner: Hotel GM
version: "1.0"
approved_by: Compliance Officer
approved_at: 2026-04-22
domain: Revenue
apaleo_api: "Revenue Reports API, Finance API"
nist_control: AC-2
---

role_bands:
  ambassador:
    exceptions: []

  senior_ambassador:
    exceptions: []

  hotel_gm:
    exceptions:
      - exception_class: variance_threshold
        description: Accept a revenue variance within the Hotel GM tolerance band
        ceiling: 5
        ceiling_type: percent
        conditions:
          - Variance reason documented in Witness Agent entry
          - Finance team notified for variances above 3%
          - Applies to daily reconciliation report only
        authority: autonomous
        escalate_to: regional_gm
        must_log: true

  regional_gm:
    exceptions:
      - exception_class: reconciliation_override
        description: Override a reconciliation discrepancy requiring multi-property review
        ceiling: 10
        ceiling_type: percent
        conditions:
          - CFO notification required for overrides above 5%
          - Cross-property scope requires Regional GM written approval
          - Audit trail must include original Apaleo revenue report reference
        authority: hitl_required
        escalate_to: operations_chief
        must_log: true

  operations_chief:
    exceptions: []

  compliance_officer:
    exceptions:
      - exception_class: policy_override
        description: Override a MUST NOT clause for a documented exceptional circumstance
        ceiling: null
        ceiling_type: none
        conditions:
          - Written justification logged in governance file
          - Time-limited — maximum 30 days without formal policy amendment
        authority: hitl_required
        escalate_to: null
        must_log: true

must_not_override:
  - "Bypassing property management system API calls required by governance policy for revenue-reconciliation-agent"
  - "Processing decisions without writing to Witness Agent"
  - "Applying exception ceilings not defined in this EXCEPTION_AUTHORITY.md"

escalation_targets:
  "Revenue Manager": hotel_gm
  "Operations Director": hotel_gm
  "Credit Control team": hotel_gm
  "Housekeeping Manager": hotel_gm
  "VP Revenue": regional_gm
  "CFO": regional_gm
  "CISO": operations_chief
  "first_hitl_approval": compliance_officer
  "second_hitl_approval": compliance_officer
