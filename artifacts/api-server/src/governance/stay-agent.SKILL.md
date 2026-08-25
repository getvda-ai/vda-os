---
file_type: SKILL
agent_id: stay-agent
industry: Hospitality
domain: Operations
journey_stage_axis: Stay
value_stream_axis: vertical
authored_by: Manager on Duty
approved_by: General Manager
approved_date: 2026-07-07
risk_level: HIGH
nist_control: AC-2
apaleo_api: Reservations API, Folio API, Finance API, Inventory/Unit API, Availability API
baseline: true
normalisation_level: 3
---

# Stay Agent — Capability & Tool Declaration (SKILL)

The Stay Agent may call ONLY the property-system tools listed here, and only for the
in-stay window (check-in → in-stay → check-out). Read tools may be used freely
inside the decision loop. Write tools are executed ONLY after the decision engine
returns PASS, a human approves via HITL, or a matching non-revoked baseline
applies — never before, and never outside the ceilings in
`stay-agent.EXCEPTION_AUTHORITY.md`.

## Read tools (permitted in the evaluation loop)

| Tool | Purpose | property-system scope |
|------|---------|--------------|
| `GetReservation` | Verify reservation status, dates, unit, guest | reservations.read |
| `ListFolios` | List folios for a reservation | folios.read |
| `GetFolio` | Read a folio's charges and balance | folios.read |
| `GetGuestProfile` | Verify guest identity / loyalty tier | profile:read |
| `ListPaymentAccounts` | Confirm payment method / pre-authorisation | payment-accounts.read |
| `ListInvoices` | Detect duplicate charges / prior invoices | invoices.read |
| `GetAvailableUnitGroups` | Confirm unit availability for upgrade / move / extension | availability.read |
| `ListRatePlans` | Value nightly uplift / delta for upgrades and moves | rates.read |
| `GetReport` | Reconcile folio / revenue at settlement | reports.read |

## Write tools (executed ONLY after PASS / approval / baseline)

| Tool | Used for | property-system scope |
|------|----------|--------------|
| `CheckIn` | Complete guest check-in / early check-in | distribution:reservations.manage |
| `CheckOut` | Complete check-out / late check-out settlement | distribution:reservations.manage |
| `AmendReservation` | Room move / re-key, stay extension, upgrade | distribution:reservations.manage |
| `CreateFolioCharge` | Post folio charge, damage/incidental charge | payment:transactions.manage |

## Write discipline (MUST)

- Every MCP tool call is written to the Witness Stream **before** execution.
- If a required write tool is not available in the connected property-system surface,
  the agent records the intended property-system mutation in the Witness entry and marks
  it `SANDBOX_NO_WRITE` rather than fabricating success.
- Refunds and goodwill credits that reverse money are modelled as folio
  adjustments and inherit the Finance O2C controls.

## Prohibited

- MUST NOT call `CreateBooking` or any pre-arrival booking/rate tool — those are
  outside the in-stay window and belong to other agents.
- MUST NOT call any tool not listed above.
- MUST NOT execute a write tool while the decision is FAIL or ESCALATE.
