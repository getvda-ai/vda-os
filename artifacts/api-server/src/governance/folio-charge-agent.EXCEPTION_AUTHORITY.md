---
file_type: EXCEPTION_AUTHORITY
agent_id: folio-charge-agent
owner: Hotel GM
version: "1.0"
approved_by: Compliance Officer
approved_at: 2026-04-22
domain: Operations
apaleo_api: "Folio API, Finance API"
nist_control: AC-2
---

role_bands:
  ambassador:
    exceptions:
      - exception_class: charge_ceiling_autonomous
        description: Post a folio charge within the autonomous agent authority ceiling
        ceiling: 500
        ceiling_type: eur
        conditions:
          - Folio status is Open in Apaleo Finance API
          - No duplicate charge detected on same service date
          - Payment method confirmed — no unsecured balance
          - Open disputes NONE
        authority: autonomous
        escalate_to: senior_ambassador
        must_log: true

  senior_ambassador:
    exceptions:
      - exception_class: charge_ceiling_senior
        description: Post a folio charge above the autonomous limit
        ceiling: 2000
        ceiling_type: eur
        conditions:
          - Folio status is Open
          - No open disputes
          - Senior Ambassador approval documented in Witness Agent entry
        authority: hitl_required
        escalate_to: hotel_gm
        must_log: true
      - exception_class: fee_waiver
        description: Waive a folio fee below the senior authority ceiling
        ceiling: 200
        ceiling_type: eur
        conditions:
          - Service failure documented in Witness Agent entry
          - Original charge verified in Apaleo Folio API
          - Applies to current stay folio only
        authority: autonomous
        escalate_to: hotel_gm
        must_log: true

  hotel_gm:
    exceptions:
      - exception_class: charge_ceiling_gm
        description: Post a folio charge above the Senior Ambassador ceiling
        ceiling: null
        ceiling_type: eur
        conditions:
          - Finance Director notification required above 2000 EUR
          - Revenue Manager co-approval documented
          - Single folio scope only
        authority: hitl_required
        escalate_to: regional_gm
        must_log: true

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
  - "Bypassing property management system API calls required by governance policy for folio-charge-agent"
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
