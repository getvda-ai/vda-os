---
file_type: EXCEPTION_AUTHORITY
agent_id: stay-agent
owner: Manager on Duty
version: "1.2"
approved_by: Compliance Officer
approved_at: 2026-07-07
# v1.2 is an ANNOTATION revision: it adds apaleo_scope / apaleo_role to existing
# rules and changes no ceiling, condition, authority or escalate_to, so the
# approved decision surface is byte-identical in effect to v1.1. It is recorded
# here rather than folded into the v1.1 approval, because a governance file that
# quietly re-dates its own sign-off is the exact failure this product exists to
# make impossible. The annotation itself still needs a Compliance Officer to
# confirm the scope/role facts before v1.2 is treated as approved.
revision_1_2:
  kind: annotation
  changes: "apaleo_scope and apaleo_role added to all 35 rules; no threshold changed"
  approved_by: PENDING
  approved_at: null
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
#
# ── apaleo_scope / apaleo_role (added in v1.2) ─────────────────────────────
#
# Every rule now names the Apaleo OAuth scope the action is performed under, and
# the Apaleo ROLE that owns that scope in Apaleo's own user-role model. These are
# facts about Apaleo, not policy choices of ours — see lib/apaleoAuthority.ts,
# where each scope is placed with the LOWEST role permitted to exercise it.
#
# READ apaleo_role ON THE AMBASSADOR BAND AS DELEGATION, NOT AS A CLAIM.
#
# A Junior Front Desk user cannot add a custom charge to a folio: in Apaleo that
# is the Senior Reservation Manager's authority. So an ambassador-band rule over
# folios.payment-with-charges does NOT assert that the front line holds that
# scope. It records that the scope owner has DELEGATED a bounded slice of it —
# everything below the ceiling — to the agent, and keeps everything above it.
#
# That is the entire mechanism this product adds. Apaleo grants scopes whole: an
# application either holds folios.payment-with-charges or it does not, and there
# is no native way to say "up to EUR 200 autonomously, above that ask a human".
# The ceiling on an ambassador rule IS that missing sentence, written down and
# approved by a named human. The named human is the role in apaleo_role.
#
# The consequence, which must not be softened: a rule whose apaleo_role is above
# Junior Front Desk is delegated authority, and delegated authority is revocable.
# The console shows both the band governance routed to and the band Apaleo's
# model would put the scope in. When they differ, that is the delegation being
# visible — and if it should not have been delegated, the disagreement is where
# a reviewer sees it.

role_bands:
  ambassador:
    exceptions:
      # ── CHECK-IN ──────────────────────────────────────────────────────────
      - exception_class: early_checkin
        apaleo_scope: reservations.manage
        apaleo_role: "Junior Front Desk"
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
        apaleo_scope: reservations.manage
        apaleo_role: "Junior Front Desk"
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
        apaleo_scope: reservations.manage
        apaleo_role: "Junior Front Desk"
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
        apaleo_scope: folios.read
        apaleo_role: "Junior Front Desk"
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
        apaleo_scope: null
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
        apaleo_scope: folios.payment-with-charges
        apaleo_role: "Senior Reservation Manager"
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
        apaleo_scope: null
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
        apaleo_scope: reservations.manage
        apaleo_role: "Junior Front Desk"
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
        apaleo_scope: reservations.manage
        apaleo_role: "Junior Front Desk"
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
        apaleo_scope: folios.manage
        apaleo_role: "Senior Reservation Manager"
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
        apaleo_scope: reservations.manage
        apaleo_role: "Junior Front Desk"
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
        apaleo_scope: reservations.manage
        apaleo_role: "Junior Front Desk"
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
        apaleo_scope: folios.manage
        apaleo_role: "Senior Reservation Manager"
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
        apaleo_scope: folios.manage
        apaleo_role: "Senior Reservation Manager"
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
        apaleo_scope: folios.payment-with-charges
        apaleo_role: "Senior Reservation Manager"
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

      # ── RATE / COMMERCIAL ─────────────────────────────────────────────────
      - exception_class: rate_override
        apaleo_scope: rates.manage
        apaleo_role: "Senior Reservation Manager"
        stage: check_in
        description: Apply a discount below the Best Available Rate for a guest or corporate request
        ceiling: 9
        ceiling_type: percent_below_bar
        conditions:
          - Rate plan resolved from Apaleo and the BAR for the date range is known
          - Discount does not breach a negotiated or corporate rate agreement
        authority: autonomous
        escalate_to: mod
        must_log: true

  mod:
    exceptions:
      - exception_class: room_upgrade_checkin
        apaleo_scope: reservations.manage
        stage: check_in
        description: Higher-value complimentary upgrade at check-in (MoD discretion)
        ceiling: 120
        ceiling_type: eur_per_night
        conditions:
          - Upgrade unit confirmed available via Apaleo Inventory/Unit API
          - Documented justification (VIP, loyalty, service recovery)
        authority: hitl_required
        escalate_to: compliance_officer
        apaleo_role: "Senior Reservation Manager"
        must_log: true
      - exception_class: preauth_validation
        apaleo_scope: folios.read
        stage: check_in
        description: Override the standard pre-authorisation limit for a specific guest
        ceiling: 2000
        ceiling_type: eur
        conditions:
          - Documented justification (VIP, corporate account, extended stay)
          - Guest acknowledgement on file
        authority: hitl_required
        escalate_to: compliance_officer
        apaleo_role: "Accountant"
        must_log: true
      - exception_class: folio_post_charge
        apaleo_scope: folios.payment-with-charges
        stage: in_stay
        description: Post a higher-value or damages charge to the folio (MoD authority)
        ceiling: 750
        ceiling_type: eur
        conditions:
          - Charge relates to the current stay and is evidenced
          - Guest notified where the charge is a damage/incidental
        authority: hitl_required
        escalate_to: compliance_officer
        apaleo_role: "Accountant"
        must_log: true
      - exception_class: room_move_rekey
        apaleo_scope: reservations.manage
        stage: in_stay
        description: Room move with a larger nightly rate delta (MoD authority)
        ceiling: 150
        ceiling_type: eur_per_night
        conditions:
          - Target unit confirmed available via Apaleo Inventory/Unit API
          - Move reason documented
        authority: hitl_required
        escalate_to: compliance_officer
        apaleo_role: "Senior Reservation Manager"
        must_log: true
      - exception_class: stay_extension
        apaleo_scope: reservations.manage
        stage: in_stay
        description: Extend the stay by multiple additional nights (MoD authority)
        ceiling: 5
        ceiling_type: nights
        conditions:
          - Unit availability confirmed for all added nights via Apaleo
          - Valid payment method on file for the incremental amount
        authority: hitl_required
        escalate_to: compliance_officer
        apaleo_role: "Senior Reservation Manager"
        must_log: true
      - exception_class: goodwill_credit
        apaleo_scope: folios.manage
        stage: in_stay
        description: Apply a larger goodwill / service-recovery credit (MoD authority)
        ceiling: 250
        ceiling_type: eur
        conditions:
          - Documented service failure or exceptional circumstance
          - Revenue Manager notified when credit exceeds 100 EUR
        authority: hitl_required
        escalate_to: compliance_officer
        apaleo_role: "Accountant"
        must_log: true
      - exception_class: late_checkout
        apaleo_scope: reservations.manage
        stage: check_out
        description: Extend late check-out beyond the front-desk limit (MoD / VIP)
        ceiling: 5
        ceiling_type: hours
        conditions:
          - Housekeeping notified at least 2 hours before revised departure
          - No same-day arrival blocking the unit
        authority: hitl_required
        escalate_to: compliance_officer
        apaleo_role: "Senior Reservation Manager"
        must_log: true
      - exception_class: early_checkout
        apaleo_scope: reservations.manage
        stage: check_out
        description: Approve an early departure of more nights, or on a non-refundable/group rate (MoD authority)
        ceiling: 7
        ceiling_type: nights
        conditions:
          - Non-refundable/prepaid forfeiture or group-block impact reviewed and documented
          - Revenue impact acknowledged
        authority: hitl_required
        escalate_to: compliance_officer
        apaleo_role: "Senior Reservation Manager"
        must_log: true
      - exception_class: refund_folio_adjustment
        apaleo_scope: folios.manage
        stage: check_out
        description: Refund or adjust a folio balance above the front-desk window (MoD authority)
        ceiling: 500
        ceiling_type: eur
        conditions:
          - Reason documented and reconciled against the Apaleo folio
          - Original payment method used for refunds where possible
        authority: hitl_required
        escalate_to: compliance_officer
        apaleo_role: "Accountant"
        must_log: true

      # ── RATE / COMMERCIAL ─────────────────────────────────────────────────
      - exception_class: rate_override
        apaleo_scope: rates.manage
        stage: check_in
        description: Approve a discount below BAR beyond the front-line autonomous limit
        ceiling: 25
        ceiling_type: percent_below_bar
        conditions:
          - Commercial rationale recorded (corporate account, service recovery, occupancy)
          - Discount reviewed against the property's rate strategy for the date range
        authority: hitl_required
        escalate_to: compliance_officer
        apaleo_role: "Revenue Manager"
        must_log: true

      # ── OVERRIDE CLASSES — never autonomous at any band ───────────────────
      # No ambassador rule exists for these two by design. A class with no
      # `authority: autonomous` rule at ANY band can never auto-PASS, in any
      # phase including Run — see stayDecisionEngine.ts step 7.
      - exception_class: force_manage_override
        apaleo_scope: reservations.force-manage
        stage: check_in
        description: Book or amend a reservation outside rate-plan, availability or restriction rules
        ceiling: null
        ceiling_type: none
        conditions:
          - The blocking restriction is named explicitly in the request
          - Commercial or operational justification recorded before the override
        authority: hitl_required
        escalate_to: compliance_officer
        apaleo_role: "Senior Reservation Manager"
        must_log: true
      - exception_class: feature_enablement
        apaleo_scope: null
        stage: global
        description: Enable a new agent capability or governance rule in production
        ceiling: null
        ceiling_type: none
        conditions:
          - The change is described in full before it is applied
          - The previous version is identified so it can be reinstated
        authority: hitl_required
        escalate_to: compliance_officer
        apaleo_role: "Property Admin"
        must_log: true

  compliance_officer:
    exceptions:
      - exception_class: chargeback_risk_flag
        apaleo_scope: payments.manage
        stage: check_out
        description: A settlement or refund carries chargeback / fraud risk
        ceiling: null
        ceiling_type: none
        conditions:
          - Any chargeback-risk or suspected-fraud signal is present
        authority: hitl_required
        escalate_to: null
        apaleo_role: "Account Admin"
        must_log: true
      - exception_class: policy_override
        apaleo_scope: null
        stage: global
        description: Override a MUST NOT clause for a documented exceptional circumstance
        ceiling: null
        ceiling_type: none
        conditions:
          - Written justification logged in the governance file
          - Time-limited — maximum 30 days without formal policy amendment
        authority: hitl_required
        escalate_to: null
        apaleo_role: "Account Admin"
        must_log: true

      # ── TERMINAL AUTHORITY — the top of each escalation chain ─────────────
      # These carry no ceiling of their own: reaching this band means every
      # lower ceiling was already exceeded. They exist so an escalation chain
      # terminates at a named authority instead of trailing off.
      - exception_class: early_checkout
        apaleo_scope: reservations.manage
        stage: check_out
        description: Early departure beyond the Manager on Duty ceiling
        ceiling: null
        ceiling_type: none
        authority: hitl_required
        escalate_to: null
        apaleo_role: "Property Admin"
        must_log: true
      - exception_class: folio_post_charge
        apaleo_scope: folios.payment-with-charges
        stage: in_stay
        description: Folio charge beyond the Manager on Duty ceiling
        ceiling: null
        ceiling_type: none
        authority: hitl_required
        escalate_to: null
        apaleo_role: "Account Admin"
        must_log: true
      - exception_class: rate_override
        apaleo_scope: rates.manage
        stage: check_in
        description: Discount below BAR beyond the Revenue Manager ceiling
        ceiling: null
        ceiling_type: none
        authority: hitl_required
        escalate_to: null
        apaleo_role: "Property Admin"
        must_log: true
      - exception_class: force_manage_override
        apaleo_scope: reservations.force-manage
        stage: check_in
        description: Force-manage override escalated beyond the Senior Reservation Manager
        ceiling: null
        ceiling_type: none
        authority: hitl_required
        escalate_to: null
        apaleo_role: "Property Admin"
        must_log: true
      - exception_class: feature_enablement
        apaleo_scope: null
        stage: global
        description: Capability enablement escalated beyond the property
        ceiling: null
        ceiling_type: none
        authority: hitl_required
        escalate_to: null
        apaleo_role: "Account Admin"
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
