---
file_type: EXCEPTION_AUTHORITY
agent_id: check-in-agent
owner: Hotel GM
version: "1.0"
approved_by: Compliance Officer
approved_at: 2026-04-22
domain: Operations
apaleo_api: "Reservations API, Folio API, Unit API"
nist_control: AC-2
---

role_bands:
  ambassador:
    exceptions:
      - exception_class: folio_preauth_limit
        description: Authorise a folio pre-authorisation within the autonomous limit
        ceiling: 500
        ceiling_type: eur
        conditions:
          - Payment method confirmed in Apaleo
          - Reservation status is Confirmed
          - No open disputes on guest account
        authority: autonomous
        escalate_to: senior_ambassador
        must_log: true

  senior_ambassador:
    exceptions:
      - exception_class: early_checkin
        description: Permit early check-in before standard check-in time
        ceiling: "12:00"
        ceiling_type: time
        conditions:
          - Unit confirmed clean and available by Housekeeping
          - Guest notified and consent given
          - No group arrival blocking the floor
        authority: autonomous
        escalate_to: hotel_gm
        must_log: true
      - exception_class: unit_upgrade
        description: Upgrade a guest to a higher unit category at no charge
        ceiling: 1
        ceiling_type: category_steps
        conditions:
          - Upgrade unit confirmed available by Apaleo Inventory API
          - Guest loyalty tier is Silver or above
          - Senior Ambassador authorisation documented
        authority: autonomous
        escalate_to: hotel_gm
        must_log: true

  hotel_gm:
    exceptions:
      - exception_class: folio_preauth_override
        description: Override the standard pre-authorisation limit for a specific guest
        ceiling: 2000
        ceiling_type: eur
        conditions:
          - Documented justification (VIP, corporate account, extended stay)
          - Revenue Manager notified if override exceeds 1000 EUR
          - Guest signed acknowledgement on file
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
  - "Bypassing property management system API calls required by governance policy for check-in-agent"
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
