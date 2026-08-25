---
file_type: EXCEPTION_AUTHORITY
agent_id: availability-agent
owner: Hotel GM
version: "1.0"
approved_by: Compliance Officer
approved_at: 2026-04-22
domain: Revenue
apaleo_api: "Inventory API, Unit Groups API"
nist_control: AC-2
---

role_bands:
  ambassador:
    exceptions:
      - exception_class: unit_group_hold
        description: Place a temporary hold on a unit group to reserve availability
        ceiling: 2
        ceiling_type: units
        conditions:
          - Hold must not exceed 2 units for more than 4 hours
          - No active group block conflicts in Apaleo
        authority: autonomous
        escalate_to: senior_ambassador
        must_log: true

  senior_ambassador:
    exceptions:
      - exception_class: restricted_inventory_access
        description: Access restricted inventory categories for special allocation
        ceiling: 5
        ceiling_type: units
        conditions:
          - Senior Ambassador supervisor approval documented
          - Inventory category verified as restricted in Apaleo
          - Allocation purpose recorded in Witness Agent entry
        authority: autonomous
        escalate_to: hotel_gm
        must_log: true

  hotel_gm:
    exceptions: []

  regional_gm:
    exceptions: []

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
  - "Bypassing property management system API calls required by governance policy for availability-agent"
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
