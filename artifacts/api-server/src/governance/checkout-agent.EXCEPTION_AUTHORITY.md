---
file_type: EXCEPTION_AUTHORITY
agent_id: checkout-agent
owner: Hotel GM
version: "1.0"
approved_by: Compliance Officer
approved_at: 2026-04-22
domain: Operations
apaleo_api: "Reservations API, Folio API"
nist_control: AC-2
---

role_bands:
  ambassador:
    exceptions:
      - exception_class: late_checkout_fee_waiver
        description: Waive the late checkout fee for a departing guest
        ceiling: "12:00"
        ceiling_type: time
        conditions:
          - Guest must depart by ceiling time
          - No open folio disputes
          - Folio balance settled or valid payment method on file
        authority: autonomous
        escalate_to: senior_ambassador
        must_log: true
      - exception_class: minor_folio_adjustment
        description: Adjust a folio charge within the minor correction window
        ceiling: 15
        ceiling_type: eur
        conditions:
          - Charge must be on the current stay folio only
          - Reason must be documented in Witness Agent entry
        authority: autonomous
        escalate_to: senior_ambassador
        must_log: true

  senior_ambassador:
    exceptions:
      - exception_class: late_checkout_loyalty_extension
        description: Extend late checkout for verified loyalty tier guests
        ceiling: "14:00"
        ceiling_type: time
        conditions:
          - Active loyalty tier verified in Apaleo guest profile
          - Unit availability confirmed via Apaleo Inventory API
          - No same-day group check-in blocking the unit
        authority: autonomous
        escalate_to: hotel_gm
        must_log: true
      - exception_class: rate_discount_standard
        description: Apply a rate discount for service recovery or guest retention
        ceiling: 15
        ceiling_type: percent_below_bar
        conditions:
          - Service recovery documented in Witness Agent entry
          - Original rate must be BAR or above
          - Applies to current reservation only
        authority: autonomous
        escalate_to: hotel_gm
        must_log: true

  hotel_gm:
    exceptions:
      - exception_class: late_checkout_vip
        description: Extend late checkout for VIP or comp guests at GM discretion
        ceiling: "17:00"
        ceiling_type: time
        conditions:
          - VIP flag active in Apaleo guest profile or guest comp approved by Hotel GM this stay
          - Housekeeping notified minimum 2 hours before departure
        authority: hitl_required
        escalate_to: regional_gm
        must_log: true
      - exception_class: guest_comp
        description: Comp a folio charge as a goodwill gesture
        ceiling: 250
        ceiling_type: eur
        conditions:
          - Documented service failure or exceptional circumstance
          - Not applicable to no-show charges
          - Revenue Manager notified when comp exceeds 100 EUR
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
          - Board notification if override exceeds 7 days
        authority: hitl_required
        escalate_to: null
        must_log: true

must_not_override:
  - "Bypassing property management system API calls required by governance policy for checkout-agent"
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
