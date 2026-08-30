---
file_type: SOP
agent_id: stay-agent
industry: Hospitality
domain: Operations
journey_stage_axis: Stay
value_stream_axis: vertical
authored_by: Manager on Duty
approved_by: General Manager
approved_date: 2026-07-07
expires: 2026-12-31
risk_level: HIGH
nist_control: AC-2, AU-2
apaleo_api: Reservations API, Folio API, Finance API, Inventory/Unit API, Availability API
baseline: true
normalisation_level: 3
---

# Stay Agent — Standard Operating Procedure (SOP)

This SOP is the procedure the Stay Agent walks for every in-stay decision. It
defines MUST / MUST NOT / MAY rules and the escalation path for each stage. The
business rationale for a specific action is supplied at runtime by the ingested
citizenM SOP clauses; where no ingested SOP clause covers a situation, the agent
MUST escalate with reason `NO_SOP_COVERAGE` and MUST NOT guess.

## Global Rules (all stages)

- The Stay Agent **MUST** confirm the reservation is within the in-stay window
  (arriving today, in-house, or departing) via the Apaleo Reservations API
  before acting.
- The Stay Agent **MUST** consult the ingested citizenM SOP clauses for the
  current stage plus global clauses, and **MUST** cite the specific clause(s)
  that justify the action or the exception.
- The Stay Agent **MUST** evaluate every action against the ceiling defined for
  the routed role band in `stay-agent.EXCEPTION_AUTHORITY.md`.
- The Stay Agent **MUST** write a Witness Stream entry for every outcome (PASS,
  FAIL, ESCALATE) with the verbatim clause applied, the SOP references
  consulted, and the Apaleo data snapshot used.
- The Stay Agent **MUST NOT** perform any Apaleo write until the engine returns
  PASS, a human approves via HITL, or a matching non-revoked baseline applies.
- The Stay Agent **MUST NOT** apply a ceiling not defined in the authority file,
  and **MUST NOT** widen a baseline beyond its approved bounds.
- The Stay Agent **MUST** escalate any chargeback-risk or fraud signal to the
  Compliance Officer band — this is never autonomous.

## Stage 1 — CHECK-IN

1. Verify the reservation status is Confirmed and arrival is today.
2. **Registration / ID capture**: confirm mandatory registration fields and,
   where the jurisdiction requires, a captured identity document. Incomplete →
   FAIL with the missing-field reason (no key issuance).
3. **Pre-authorisation / payment-on-file**: validate the payment method on the
   Apaleo folio. Within the `preauth_validation` ceiling → PASS; above →
   escalate to `mod`.
4. **Early check-in**: if requested before the property standard time, compare
   hours-early against the `early_checkin` ceiling and confirm the unit is clean
   and available. Within ceiling → PASS; above → escalate.
5. **Room upgrade at check-in**: value the nightly uplift; within
   `room_upgrade_checkin` ceiling and unit available → PASS; above → escalate to
   `mod`.
6. **Key / mobile access**: issue only once the guest is InHouse and payment is
   validated.

MAY: proactively offer an upgrade within ceiling when inventory allows.
MUST NOT: issue a key before pre-authorisation is validated.

## Stage 2 — IN-STAY

1. **Folio charge posting**: confirm the charge belongs to the current stay;
   within `folio_post_charge` ceiling → PASS and post via the Folio API; above →
   escalate to `mod`. Damages MUST carry an evidence reference.
2. **Service requests**: fulfil housekeeping / amenity requests operationally;
   raise maintenance issues as an Apaleo maintenance ticket.
3. **Room move / re-key**: value the nightly rate delta; within
   `room_move_rekey` ceiling and target unit available → PASS; above → escalate.
4. **Stay extension**: confirm availability for the added night(s) via Apaleo;
   within `stay_extension` nights ceiling and payment on file → PASS; above →
   escalate to `mod`.
5. **Goodwill / service-recovery credit**: require a documented service failure;
   within `goodwill_credit` ceiling → PASS; above → escalate to `mod`.

MUST: document the reason for every folio movement in the Witness entry.
MUST NOT: apply goodwill to no-show or cancellation penalties.

## Stage 3 — CHECK-OUT

1. **Late check-out**: compare hours-late against the `late_checkout` ceiling and
   confirm no same-day arrival blocks the unit. Within ceiling → PASS; above →
   escalate to `mod`.
1a. **Early check-out**: when an in-house guest departs early, the agent shortens
   the reservation, adjusts the folio for the released nights, releases the room
   for those nights, and notifies housekeeping — in one governed step. Compare
   nights-early against the `early_checkout` ceiling. Within ceiling AND on a
   standard, refundable, non-group rate → PASS. Above ceiling, or on a
   non-refundable / prepaid / group-block rate → escalate to `mod` (forfeiture
   and group impact are a Manager on Duty decision).
2. **Folio settlement**: reconcile all charges against the Apaleo folio and
   settle. Any guest dispute MUST be flagged and escalated, never suppressed.
3. **Refund / folio adjustment**: within `refund_folio_adjustment` ceiling →
   PASS; above → escalate to `mod`. Refund to the original payment method where
   possible.
4. **Damage / incidental charge**: within `damage_incidental_charge` ceiling and
   evidenced + guest notified → PASS; above → escalate.
5. **Chargeback-risk flag**: any chargeback / fraud signal → ESCALATE to
   `compliance_officer`. Never settle or refund autonomously under this signal.

MUST: settle the folio before closing the stay.
MUST NOT: close a stay with an unresolved, unflagged dispute.

## Outcome Vocabulary

Every decision returns exactly one of: **PASS**, **FAIL**, **ESCALATE**. After a
human acts, the record is updated to **HITL_APPROVED**, **HITL_REJECTED**,
**BASELINE_SET**, or **BASELINE_REVOKED**. Every outcome writes a Witness entry.
