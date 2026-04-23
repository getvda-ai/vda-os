---
file_type: EXCEPTION_AUTHORITY
agent_id: folio-agent
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
      - exception_class: folio_read
        description: Read folio data for an active reservation
        ceiling: null
        ceiling_type: none
        conditions:
          - Reservation must be in Confirmed, InHouse, or CheckedOut status
          - Query scope limited to requesting guest only
        authority: autonomous
        escalate_to: senior_ambassador
        must_log: true

  senior_ambassador:
    exceptions:
      - exception_class: dispute_flag
        description: Flag a folio charge as disputed on behalf of a guest
        ceiling: null
        ceiling_type: none
        conditions:
          - Guest dispute communicated in writing or via Apaleo guest profile
          - Charge must be on a folio in Open or Closed status
          - Finance team notified within 2 hours of flagging
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
  - "Bypassing Apaleo API calls required by governance policy for folio-agent"
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
