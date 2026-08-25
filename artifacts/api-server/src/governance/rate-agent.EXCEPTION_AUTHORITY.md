---
file_type: EXCEPTION_AUTHORITY
agent_id: rate-agent
owner: Hotel GM
version: "2.0"
approved_by: Compliance Officer
approved_at: 2026-04-28
domain: Revenue
apaleo_api: "Rate Plans API, Revenue Reports API"
nist_control: AC-2
---

role_bands:
  ambassador:
    exceptions:
      - exception_class: rate_discount_standard
        description: Apply a standard rate discount within the autonomous authority band (0–9% below BAR)
        ceiling: 9
        ceiling_type: percent_below_bar
        conditions:
          - Rate plan is confirmed active in Apaleo
          - Discount does not breach floor rate
          - No competing promotional rate applies
        authority: autonomous
        escalate_to: senior_ambassador
        must_log: true

  senior_ambassador:
    exceptions:
      - exception_class: rate_discount_extended
        description: Apply an extended rate discount for service recovery or key account retention (9–15% below BAR)
        ceiling: 15
        ceiling_type: percent_below_bar
        conditions:
          - Service recovery or key account rationale documented
          - Original rate must be BAR or above
          - Applies to current reservation only
        authority: autonomous
        escalate_to: hotel_gm
        must_log: true

  hotel_gm:
    exceptions:
      - exception_class: rate_discount_exceptional
        description: Apply an exceptional deep discount at GM discretion (above 15% below BAR)
        ceiling: 20
        ceiling_type: percent_below_bar
        conditions:
          - GM written authorisation documented in Witness Agent entry
          - Revenue Manager notified when override exceeds 15%
          - Rate parity obligations verified
        authority: hitl_required
        escalate_to: regional_gm
        must_log: true
      - exception_class: rate_plan_override
        description: Override the active rate plan for a specific reservation
        ceiling: null
        ceiling_type: none
        conditions:
          - Documented exceptional circumstance
          - Revenue Manager co-approval required
          - Single reservation scope only
        authority: hitl_required
        escalate_to: regional_gm
        must_log: true

  regional_gm:
    exceptions:
      - exception_class: cross_property_rate_exception
        description: Apply a rate exception across multiple A Hotel Berlin properties
        ceiling: 20
        ceiling_type: percent_below_bar
        conditions:
          - Corporate or key account verified in CRM
          - Minimum 3-night stay across portfolio
          - Rate parity obligations checked
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
  - "Bypassing property management system API calls required by governance policy for rate-agent"
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
