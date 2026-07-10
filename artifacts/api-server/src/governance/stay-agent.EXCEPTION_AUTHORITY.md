---
file_type: EXCEPTION_AUTHORITY
agent_id: stay-agent
owner: Manager on Duty
version: "1.0"
approved_by: Compliance Officer
approved_at: 2026-07-07
domain: Operations
journey_stage_axis: Stay
apaleo_api: "Reservations API, Folio API, Finance API, Inventory/Unit API, Availability API"
nist_control: AC-2
risk_level: HIGH
---

# Stay Agent — Exception Authority (Check-in → In-stay → Check-out)
#
# Two operating role bands govern the in-stay journey:
#   ambassador → low-risk operational exceptions (front-desk discretion)
#   mod        → Manager on Duty: financial / higher-risk exceptions
# Escalation ladder: ambassador → mod → compliance_officer.
# Ceilings below are the AUTONOMOUS limit for that band; anything above the
# band ceiling, or any class marked authority: hitl_required, routes to HITL.

role_bands:
  ambassador:
    exceptions:
      # ── CHECK-IN ──────────────────────────────────────────────────────────
      - exception_class: early_checkin
        stage: check_in
        description: Permit early check-in before the property standard check-in time
        ceiling: 3
        ceiling_type: hours
        conditions:
          - Unit confirmed clean and available by Housekeeping in Apaleo
          - No same-day group arrival blocking the floor
        authority: autonomous
        escalate_to: mod
        must_log: true
      - exception_class: room_upgrade_checkin
        stage: check_in
        description: Complimentary room upgrade at check-in, measured by nightly rate uplift
        ceiling: 40
        ceiling_type: eur_per_night
        conditions:
          - Upgrade unit confirmed available via Apaleo Inventory/Unit API
          - Original reservation status is Confirmed or InHouse
        authority: autonomous
        escalate_to: mod
        must_log: true
      - exception_class: registration_id_capture
        stage: check_in
        description: Complete guest registration and ID capture completeness check
        ceiling: null
        ceiling_type: none
        conditions:
          - Mandatory registration fields present on the Apaleo reservation
          - Identity document captured where jurisdiction requires it
        authority: autonomous
        escalate_to: mod
        must_log: true
      - exception_class: preauth_validation
        stage: check_in
        description: Validate a pre-authorisation / payment-on-file within the autonomous limit
        ceiling: 500
        ceiling_type: eur
        conditions:
          - Payment method confirmed on the Apaleo folio
          - No open folio disputes on the guest account
        authority: autonomous
        escalate_to: mod
        must_log: true
      - exception_class: key_issuance
        stage: check_in
        description: Issue physical key or mobile access for a checked-in guest
        ceiling: null
        ceiling_type: none
        conditions:
          - Reservation status is InHouse (guest checked in)
          - Pre-authorisation validated or valid payment method on file
        authority: autonomous
        escalate_to: mod
        must_log: true

      # ── IN-STAY ───────────────────────────────────────────────────────────
      - exception_class: folio_post_charge
        stage: in_stay
        description: Post a charge to the guest folio (F&B, minibar, amenity)
        ceiling: 75
        ceiling_type: eur
        conditions:
          - Charge relates to the current in-house stay only
          - Reason documented in the Witness entry
        authority: autonomous
        escalate_to: mod
        must_log: true
      - exception_class: service_request
        stage: in_stay
        description: Fulfil a guest service request (housekeeping, amenity, maintenance ticket)
        ceiling: null
        ceiling_type: none
        conditions:
          - Request is operational and non-financial
          - Maintenance issues raised as an Apaleo maintenance ticket
        authority: autonomous
        escalate_to: mod
        must_log: true
      - exception_class: room_move_rekey
        stage: in_stay
        description: Move a guest to another room and re-key, measured by nightly rate delta
        ceiling: 25
        ceiling_type: eur_per_night
        conditions:
          - Target unit confirmed available via Apaleo Inventory/Unit API
          - Move reason documented (maintenance, guest request, operational)
        authority: autonomous
        escalate_to: mod
        must_log: true
      - exception_class: stay_extension
        stage: in_stay
        description: Extend the stay by additional nights at the confirmed rate
        ceiling: 1
        ceiling_type: nights
        conditions:
          - Unit availability confirmed for the added night(s) via Apaleo
          - Valid payment method on file for the incremental amount
        authority: autonomous
        escalate_to: mod
        must_log: true
      - exception_class: goodwill_credit
        stage: in_stay
        description: Apply a goodwill / service-recovery credit to the folio
        ceiling: 30
        ceiling_type: eur
        conditions:
          - Documented service failure or exceptional circumstance
          - Not applied to no-show or cancellation penalties
        authority: autonomous
        escalate_to: mod
        must_log: true

      # ── CHECK-OUT ─────────────────────────────────────────────────────────
      - exception_class: late_checkout
        stage: check_out
        description: Permit late check-out beyond the property standard departure time
        ceiling: 2
        ceiling_type: hours
        conditions:
          - No same-day arrival blocking the unit
          - Folio balance settled or valid payment method on file
        authority: autonomous
        escalate_to: mod
        must_log: true
      - exception_class: early_checkout
        stage: check_out
        description: Shorten an in-house stay for an early departure (shorten reservation, adjust folio, release nights, notify housekeeping)
        ceiling: 2
        ceiling_type: nights
        conditions:
          - Rate plan is a standard, refundable rate (not non-refundable/prepaid)
          - Not part of a group or corporate block
          - Folio settled or valid payment method on file
        authority: autonomous
        escalate_to: mod
        must_log: true
      - exception_class: refund_folio_adjustment
        stage: check_out
        description: Refund or adjust a folio line within the minor correction window
        ceiling: 25
        ceiling_type: eur
        conditions:
          - Adjustment is on the current stay folio only
          - Reason documented in the Witness entry
        authority: autonomous
        escalate_to: mod
        must_log: true
      - exception_class: folio_settlement
        stage: check_out
        description: Settle the folio at check-out and flag any dispute
        ceiling: null
        ceiling_type: none
        conditions:
          - All charges reconciled against the Apaleo folio
          - Any guest dispute flagged and escalated, never suppressed
        authority: autonomous
        escalate_to: mod
        must_log: true
      - exception_class: damage_incidental_charge
        stage: check_out
        description: Post a damage / incidental charge at or after check-out
        ceiling: 50
        ceiling_type: eur
        conditions:
          - Damage documented with evidence reference
          - Guest notified of the charge
        authority: autonomous
        escalate_to: mod
        must_log: true

  mod:
    exceptions:
      - exception_class: room_upgrade_checkin
        stage: check_in
        description: Higher-value complimentary upgrade at check-in (MoD discretion)
        ceiling: 120
        ceiling_type: eur_per_night
        conditions:
          - Upgrade unit confirmed available via Apaleo Inventory/Unit API
          - Documented justification (VIP, loyalty, service recovery)
        authority: hitl_required
        escalate_to: compliance_officer
        must_log: true
      - exception_class: preauth_validation
        stage: check_in
        description: Override the standard pre-authorisation limit for a specific guest
        ceiling: 2000
        ceiling_type: eur
        conditions:
          - Documented justification (VIP, corporate account, extended stay)
          - Guest acknowledgement on file
        authority: hitl_required
        escalate_to: compliance_officer
        must_log: true
      - exception_class: folio_post_charge
        stage: in_stay
        description: Post a higher-value or damages charge to the folio (MoD authority)
        ceiling: 750
        ceiling_type: eur
        conditions:
          - Charge relates to the current stay and is evidenced
          - Guest notified where the charge is a damage/incidental
        authority: hitl_required
        escalate_to: compliance_officer
        must_log: true
      - exception_class: room_move_rekey
        stage: in_stay
        description: Room move with a larger nightly rate delta (MoD authority)
        ceiling: 150
        ceiling_type: eur_per_night
        conditions:
          - Target unit confirmed available via Apaleo Inventory/Unit API
          - Move reason documented
        authority: hitl_required
        escalate_to: compliance_officer
        must_log: true
      - exception_class: stay_extension
        stage: in_stay
        description: Extend the stay by multiple additional nights (MoD authority)
        ceiling: 5
        ceiling_type: nights
        conditions:
          - Unit availability confirmed for all added nights via Apaleo
          - Valid payment method on file for the incremental amount
        authority: hitl_required
        escalate_to: compliance_officer
        must_log: true
      - exception_class: goodwill_credit
        stage: in_stay
        description: Apply a larger goodwill / service-recovery credit (MoD authority)
        ceiling: 250
        ceiling_type: eur
        conditions:
          - Documented service failure or exceptional circumstance
          - Revenue Manager notified when credit exceeds 100 EUR
        authority: hitl_required
        escalate_to: compliance_officer
        must_log: true
      - exception_class: late_checkout
        stage: check_out
        description: Extend late check-out beyond the front-desk limit (MoD / VIP)
        ceiling: 5
        ceiling_type: hours
        conditions:
          - Housekeeping notified at least 2 hours before revised departure
          - No same-day arrival blocking the unit
        authority: hitl_required
        escalate_to: compliance_officer
        must_log: true
      - exception_class: early_checkout
        stage: check_out
        description: Approve an early departure of more nights, or on a non-refundable/group rate (MoD authority)
        ceiling: 7
        ceiling_type: nights
        conditions:
          - Non-refundable/prepaid forfeiture or group-block impact reviewed and documented
          - Revenue impact acknowledged
        authority: hitl_required
        escalate_to: compliance_officer
        must_log: true
      - exception_class: refund_folio_adjustment
        stage: check_out
        description: Refund or adjust a folio balance above the front-desk window (MoD authority)
        ceiling: 500
        ceiling_type: eur
        conditions:
          - Reason documented and reconciled against the Apaleo folio
          - Original payment method used for refunds where possible
        authority: hitl_required
        escalate_to: compliance_officer
        must_log: true

  compliance_officer:
    exceptions:
      - exception_class: chargeback_risk_flag
        stage: check_out
        description: A settlement or refund carries chargeback / fraud risk
        ceiling: null
        ceiling_type: none
        conditions:
          - Any chargeback-risk or suspected-fraud signal is present
        authority: hitl_required
        escalate_to: null
        must_log: true
      - exception_class: policy_override
        stage: global
        description: Override a MUST NOT clause for a documented exceptional circumstance
        ceiling: null
        ceiling_type: none
        conditions:
          - Written justification logged in the governance file
          - Time-limited — maximum 30 days without formal policy amendment
        authority: hitl_required
        escalate_to: null
        must_log: true

must_not_override:
  - "Bypassing Apaleo API calls required by governance policy for stay-agent"
  - "Processing any decision without writing a Witness Agent entry"
  - "Applying exception ceilings not defined in this EXCEPTION_AUTHORITY.md"
  - "Auto-approving any decision carrying a chargeback-risk or fraud signal — these ALWAYS escalate"
  - "Acting before an arrival (pre-check-in) or after a departure (post-check-out) — out of the in-stay window"

escalation_targets:
  "Revenue Manager": mod
  "Housekeeping Manager": mod
  "Operations Director": mod
  "Credit Control team": mod
  "Duty Manager": mod
  "Front Desk": ambassador
  "CFO": compliance_officer
  "CISO": compliance_officer
  "Fraud/Chargeback team": compliance_officer
  "first_hitl_approval": mod
  "second_hitl_approval": compliance_officer
