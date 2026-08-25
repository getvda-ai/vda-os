---
file_type: EXCEPTION_AUTHORITY
agent_id: reservation-bot
owner: Hotel GM
version: "1.0"
approved_by: Compliance Officer
approved_at: 2026-04-22
domain: Revenue
apaleo_api: "Reservations API, Booking API"
nist_control: AC-2
---

role_bands:
  ambassador:
    exceptions:
      - exception_class: reservation_create
        description: Create a reservation within standard booking parameters
        ceiling: 7
        ceiling_type: nights
        conditions:
          - Rate plan is confirmed active in Apaleo
          - Unit group has availability confirmed
          - Guest identity verified
        authority: autonomous
        escalate_to: senior_ambassador
        must_log: true

  senior_ambassador:
    exceptions:
      - exception_class: reservation_modify
        description: Modify an existing confirmed reservation
        ceiling: null
        ceiling_type: none
        conditions:
          - Original reservation must be in Confirmed or InHouse status
          - Modification must not reduce folio balance without GM approval
          - Guest consent documented
        authority: autonomous
        escalate_to: hotel_gm
        must_log: true

  hotel_gm:
    exceptions:
      - exception_class: group_booking_threshold
        description: Accept a group booking above the standard threshold
        ceiling: 10
        ceiling_type: rooms
        conditions:
          - Group contract verified and signed
          - Deposit policy applied
          - Revenue Manager notified for groups above ceiling
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
  - "Bypassing property management system API calls required by governance policy for reservation-bot"
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
