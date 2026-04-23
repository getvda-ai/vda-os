/**
 * Admin routes:
 *   GET  /api/admin/onboarding-policy   — returns parsed onboarding-policy.md (60 s cache)
 *   POST /api/admin/seed-governance-files — idempotent seed for platform governance files
 */
import { Router, type IRouter } from "express";
import { db, governanceFiles } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { getOnboardingPolicy } from "../lib/exceptionAuthorityReader.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

// ─── GET /api/admin/onboarding-policy ────────────────────────────────────────

router.get("/admin/onboarding-policy", async (_req, res) => {
  try {
    const policy = await getOnboardingPolicy();
    res.json(policy);
  } catch (err) {
    logger.error({ err }, "admin/onboarding-policy error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load onboarding policy" });
  }
});

// ─── POST /api/admin/seed-governance-files ───────────────────────────────────

router.post("/admin/seed-governance-files", async (_req, res) => {
  try {
    const seeded = await seedPlatformGovernanceFiles();
    res.json({ ok: true, seeded });
  } catch (err) {
    logger.error({ err }, "admin/seed-governance-files error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Seed failed" });
  }
});

// ─── Seed Logic ───────────────────────────────────────────────────────────────

const ONBOARDING_POLICY_CONTENT = `---
file_type: COMPLIANCE
agent_id: onboarding-agent
owner: Compliance Officer
companyId: 0
nist_control: AC-2
---

## VDA-MD Onboarding Policy

### Admission Thresholds

sandbox_pass_threshold: 0.95

crawl_agreement_threshold: 0.95

walk_agreement_threshold: 0.95

### File Integrity Thresholds

minimum_clause_counts:
  AGENTS: { must: 3, must_not: 2, may: 2 }
  SOP: { must: 3, must_not: 1, may: 1 }
  COMPLIANCE: { must: 3, must_not: 2, may: 2 }
  SKILL: { must: 2, must_not: 1, may: 1 }
  EXCEPTION: { must: 1, must_not: 1, may: 1 }
  EXCEPTION_AUTHORITY: { must: 2, must_not: 1, may: 1 }
  CUSTOM: { must: 1, must_not: 0, may: 0 }

### Role Band Classification

front_line_bands:
  - ambassador
  - senior_ambassador
  - hotel_gm

cross_property_bands:
  - regional_gm
  - operations_chief
  - compliance_officer

### Phase Transitions

valid_transitions:
  crawl: walk
  walk: run
`;

const ESCALATION_TARGETS_BLOCK = `---

## Escalation Map

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
`;

const MUST_NOT_OVERRIDE_COMMON = (agentId: string) => `
---

## MUST NOT Override Classes

must_not_override:
  - "Bypassing Apaleo API calls required by governance policy for ${agentId}"
  - "Processing decisions without writing to Witness Agent"
  - "Applying exception ceilings not defined in this EXCEPTION_AUTHORITY.md"
`;

function buildExceptionAuthorityContent(agentId: string, agentName: string, domain: string, apaleoApi: string, bands: string): string {
  return `---
file_type: EXCEPTION_AUTHORITY
agent_id: ${agentId}
owner: Hotel GM
version: 1.0
approved_by: Compliance Officer
approved_at: 2026-04-22
domain: ${domain}
apaleo_api: ${apaleoApi}
nist_control: AC-2
---

## Standing Exception Authority — ${agentName}

This file defines the complete exception authority for each role band.
The platform enforces these ceilings at runtime by reading this file.
No exception limits are hardcoded in platform code (§1 compliance requirement).

${bands}${MUST_NOT_OVERRIDE_COMMON(agentId)}${ESCALATION_TARGETS_BLOCK}`;
}

const AGENT_EXCEPTION_AUTHORITY: Array<{
  agentId: string;
  agentName: string;
  domain: string;
  apaleoApi: string;
  bands: string;
}> = [
  {
    agentId: "availability-agent",
    agentName: "Availability Agent",
    domain: "Revenue",
    apaleoApi: "Inventory API, Unit Groups API",
    bands: `---

### role_band: ambassador

exception_class: unit_group_hold
description: Place a temporary hold on a unit group to reserve availability
ceiling: 2
ceiling_type: units
conditions:
  - Hold must not exceed 2 units for more than 4 hours
  - No active group block conflicts in Apaleo
authority: autonomous
escalate_to: senior_ambassador
must_log: true

---

### role_band: senior_ambassador

exception_class: restricted_inventory_access
description: Access restricted inventory categories for special allocation
ceiling: 5
ceiling_type: units
conditions:
  - Senior Ambassador supervisor approval documented
  - Inventory category verified as restricted in Apaleo
  - Allocation purpose recorded in Witness Agent entry
authority: autonomous
escalate_to: hotel_gm
must_log: true

---

### role_band: hotel_gm

authority: not_applicable

---

### role_band: regional_gm

authority: not_applicable

---

### role_band: operations_chief

authority: not_applicable

---

### role_band: compliance_officer

exception_class: policy_override
description: Override a MUST NOT clause for a documented exceptional circumstance
ceiling: null
ceiling_type: none
conditions:
  - Written justification logged in governance file
  - Time-limited — maximum 30 days without formal policy amendment
authority: hitl_required
escalate_to: null
must_log: true`,
  },
  {
    agentId: "rate-agent",
    agentName: "Rate Agent",
    domain: "Revenue",
    apaleoApi: "Rate Plans API, Revenue Reports API",
    bands: `---

### role_band: ambassador

exception_class: rate_discount_autonomous
description: Apply a rate discount within the autonomous authority band
ceiling: 9
ceiling_type: percent_below_bar
conditions:
  - Rate plan is confirmed active in Apaleo
  - Discount does not breach floor rate
  - No competing promotional rate applies
authority: autonomous
escalate_to: senior_ambassador
must_log: true

---

### role_band: senior_ambassador

exception_class: rate_discount_standard
description: Apply a rate discount for service recovery or key account retention
ceiling: 15
ceiling_type: percent_below_bar
conditions:
  - Service recovery or key account rationale documented
  - Original rate must be BAR or above
  - Applies to current reservation only
authority: autonomous
escalate_to: hotel_gm
must_log: true

---

### role_band: hotel_gm

exception_class: rate_discount_gm
description: Apply a deep discount or rate plan override at GM discretion
ceiling: 20
ceiling_type: percent_below_bar
conditions:
  - GM written authorisation documented in Witness Agent entry
  - Revenue Manager notified when override exceeds 15%
  - Rate parity obligations verified
authority: hitl_required
escalate_to: regional_gm
must_log: true

---

exception_class: rate_plan_override
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

---

### role_band: regional_gm

exception_class: cross_property_rate_exception
description: Apply a rate exception across multiple citizenM properties
ceiling: 20
ceiling_type: percent_below_bar
conditions:
  - Corporate or key account verified in CRM
  - Minimum 3-night stay across portfolio
  - Rate parity obligations checked
authority: hitl_required
escalate_to: operations_chief
must_log: true

---

### role_band: operations_chief

authority: not_applicable

---

### role_band: compliance_officer

exception_class: policy_override
description: Override a MUST NOT clause for a documented exceptional circumstance
ceiling: null
ceiling_type: none
conditions:
  - Written justification logged in governance file
  - Time-limited — maximum 30 days without formal policy amendment
authority: hitl_required
escalate_to: null
must_log: true`,
  },
  {
    agentId: "reservation-bot",
    agentName: "Reservation Bot",
    domain: "Revenue",
    apaleoApi: "Reservations API, Booking API",
    bands: `---

### role_band: ambassador

exception_class: reservation_create
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

---

### role_band: senior_ambassador

exception_class: reservation_modify
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

---

### role_band: hotel_gm

exception_class: group_booking_threshold
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

---

### role_band: regional_gm

authority: not_applicable

---

### role_band: operations_chief

authority: not_applicable

---

### role_band: compliance_officer

exception_class: policy_override
description: Override a MUST NOT clause for a documented exceptional circumstance
ceiling: null
ceiling_type: none
conditions:
  - Written justification logged in governance file
  - Time-limited — maximum 30 days without formal policy amendment
authority: hitl_required
escalate_to: null
must_log: true`,
  },
  {
    agentId: "check-in-agent",
    agentName: "Check-In Agent",
    domain: "Operations",
    apaleoApi: "Reservations API, Folio API, Unit API",
    bands: `---

### role_band: ambassador

exception_class: folio_preauth_limit
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

---

### role_band: senior_ambassador

exception_class: early_checkin
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

---

exception_class: unit_upgrade
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

---

### role_band: hotel_gm

exception_class: folio_preauth_override
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

---

### role_band: regional_gm

authority: not_applicable

---

### role_band: operations_chief

authority: not_applicable

---

### role_band: compliance_officer

exception_class: policy_override
description: Override a MUST NOT clause for a documented exceptional circumstance
ceiling: null
ceiling_type: none
conditions:
  - Written justification logged in governance file
  - Time-limited — maximum 30 days without formal policy amendment
authority: hitl_required
escalate_to: null
must_log: true`,
  },
  {
    agentId: "folio-charge-agent",
    agentName: "Folio Charge Agent",
    domain: "Operations",
    apaleoApi: "Folio API, Finance API",
    bands: `---

### role_band: ambassador

exception_class: charge_ceiling_autonomous
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

---

### role_band: senior_ambassador

exception_class: charge_ceiling_senior
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

---

exception_class: fee_waiver
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

---

### role_band: hotel_gm

exception_class: charge_ceiling_gm
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

---

### role_band: regional_gm

authority: not_applicable

---

### role_band: operations_chief

authority: not_applicable

---

### role_band: compliance_officer

exception_class: policy_override
description: Override a MUST NOT clause for a documented exceptional circumstance
ceiling: null
ceiling_type: none
conditions:
  - Written justification logged in governance file
  - Time-limited — maximum 30 days without formal policy amendment
authority: hitl_required
escalate_to: null
must_log: true`,
  },
  {
    agentId: "folio-agent",
    agentName: "Folio Agent",
    domain: "Operations",
    apaleoApi: "Folio API, Finance API",
    bands: `---

### role_band: ambassador

exception_class: folio_read
description: Read folio data for an active reservation
ceiling: null
ceiling_type: none
conditions:
  - Reservation must be in Confirmed, InHouse, or CheckedOut status
  - Query scope limited to requesting guest only
authority: autonomous
escalate_to: senior_ambassador
must_log: true

---

### role_band: senior_ambassador

exception_class: dispute_flag
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

---

### role_band: hotel_gm

authority: not_applicable

---

### role_band: regional_gm

authority: not_applicable

---

### role_band: operations_chief

authority: not_applicable

---

### role_band: compliance_officer

exception_class: policy_override
description: Override a MUST NOT clause for a documented exceptional circumstance
ceiling: null
ceiling_type: none
conditions:
  - Written justification logged in governance file
  - Time-limited — maximum 30 days without formal policy amendment
authority: hitl_required
escalate_to: null
must_log: true`,
  },
  {
    agentId: "checkout-agent",
    agentName: "Checkout Agent",
    domain: "Operations",
    apaleoApi: "Reservations API, Folio API",
    bands: `---

### role_band: ambassador

exception_class: late_checkout_fee_waiver
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

---

exception_class: minor_folio_adjustment
description: Adjust a folio charge within the minor correction window
ceiling: 15
ceiling_type: eur
conditions:
  - Charge must be on the current stay folio only
  - Reason must be documented in Witness Agent entry
authority: autonomous
escalate_to: senior_ambassador
must_log: true

---

### role_band: senior_ambassador

exception_class: late_checkout_loyalty_extension
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

---

exception_class: rate_discount_standard
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

---

### role_band: hotel_gm

exception_class: late_checkout_vip
description: Extend late checkout for VIP or comp guests at GM discretion
ceiling: "17:00"
ceiling_type: time
conditions:
  - VIP flag active in Apaleo guest profile or guest comp approved by Hotel GM this stay
  - Housekeeping notified minimum 2 hours before departure
authority: hitl_required
escalate_to: regional_gm
must_log: true

---

exception_class: guest_comp
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

---

### role_band: regional_gm

exception_class: cross_property_rate_exception
description: Apply a rate exception across multiple citizenM properties
ceiling: 20
ceiling_type: percent_below_bar
conditions:
  - Corporate or key account verified in CRM
  - Minimum 3-night stay across portfolio
  - Rate parity obligations checked
authority: hitl_required
escalate_to: operations_chief
must_log: true

---

### role_band: operations_chief

authority: not_applicable

---

### role_band: compliance_officer

exception_class: policy_override
description: Override a MUST NOT clause for a documented exceptional circumstance
ceiling: null
ceiling_type: none
conditions:
  - Written justification logged in governance file
  - Time-limited — maximum 30 days without formal policy amendment
  - Board notification if override exceeds 7 days
authority: hitl_required
escalate_to: null
must_log: true`,
  },
  {
    agentId: "revenue-reconciliation-agent",
    agentName: "Revenue Reconciliation Agent",
    domain: "Revenue",
    apaleoApi: "Revenue Reports API, Finance API",
    bands: `---

### role_band: ambassador

authority: not_applicable

---

### role_band: senior_ambassador

authority: not_applicable

---

### role_band: hotel_gm

exception_class: variance_threshold
description: Accept a revenue variance within the Hotel GM tolerance band
ceiling: 5
ceiling_type: percent
conditions:
  - Variance reason documented in Witness Agent entry
  - Finance team notified for variances above 3%
  - Applies to daily reconciliation report only
authority: autonomous
escalate_to: regional_gm
must_log: true

---

### role_band: regional_gm

exception_class: reconciliation_override
description: Override a reconciliation discrepancy requiring multi-property review
ceiling: 10
ceiling_type: percent
conditions:
  - CFO notification required for overrides above 5%
  - Cross-property scope requires Regional GM written approval
  - Audit trail must include original Apaleo revenue report reference
authority: hitl_required
escalate_to: operations_chief
must_log: true

---

### role_band: operations_chief

authority: not_applicable

---

### role_band: compliance_officer

exception_class: policy_override
description: Override a MUST NOT clause for a documented exceptional circumstance
ceiling: null
ceiling_type: none
conditions:
  - Written justification logged in governance file
  - Time-limited — maximum 30 days without formal policy amendment
authority: hitl_required
escalate_to: null
must_log: true`,
  },
];

export async function seedPlatformGovernanceFiles(): Promise<string[]> {
  const seeded: string[] = [];

  // 1. Seed onboarding-policy.md
  const existingPolicy = await db
    .select({ id: governanceFiles.id })
    .from(governanceFiles)
    .where(
      and(
        eq(governanceFiles.agentId, "onboarding-agent"),
        eq(governanceFiles.companyId, 0),
        eq(governanceFiles.fileType, "COMPLIANCE"),
        eq(governanceFiles.isArchived, false)
      )
    )
    .limit(1);

  if (!existingPolicy[0]) {
    await db.insert(governanceFiles).values({
      companyId: 0,
      filename: "onboarding-policy.md",
      filepath: "platform/onboarding-policy.md",
      fileType: "COMPLIANCE",
      axis: "shared",
      agentId: "onboarding-agent",
      content: ONBOARDING_POLICY_CONTENT,
      status: "approved",
      owner: "Compliance Officer",
      domain: "Platform",
      nistControl: "AC-2",
      baseline: true,
      mustCount: 0,
      mustNotCount: 0,
      mayCount: 0,
      wordCount: ONBOARDING_POLICY_CONTENT.split(/\s+/).filter(Boolean).length,
    });
    seeded.push("onboarding-policy.md");
    logger.info("Seeded onboarding-policy.md at companyId=0");
  }

  // 2. Seed EXCEPTION_AUTHORITY.md for each native agent
  for (const agent of AGENT_EXCEPTION_AUTHORITY) {
    const existing = await db
      .select({ id: governanceFiles.id })
      .from(governanceFiles)
      .where(
        and(
          eq(governanceFiles.agentId, agent.agentId),
          eq(governanceFiles.companyId, 0),
          eq(governanceFiles.fileType, "EXCEPTION_AUTHORITY"),
          eq(governanceFiles.isArchived, false)
        )
      )
      .limit(1);

    if (!existing[0]) {
      const content = buildExceptionAuthorityContent(
        agent.agentId,
        agent.agentName,
        agent.domain,
        agent.apaleoApi,
        agent.bands
      );
      await db.insert(governanceFiles).values({
        companyId: 0,
        filename: `${agent.agentId}-EXCEPTION_AUTHORITY.md`,
        filepath: `platform/${agent.agentId}-EXCEPTION_AUTHORITY.md`,
        fileType: "EXCEPTION_AUTHORITY",
        axis: "shared",
        agentId: agent.agentId,
        content,
        status: "approved",
        owner: "Compliance Officer",
        domain: agent.domain,
        nistControl: "AC-2",
        baseline: true,
        mustCount: (content.match(/\bMUST\b(?!\s+NOT)/g) || []).length,
        mustNotCount: (content.match(/\bMUST NOT\b/g) || []).length,
        mayCount: (content.match(/\bMAY\b/g) || []).length,
        wordCount: content.split(/\s+/).filter(Boolean).length,
      });
      seeded.push(`${agent.agentId}-EXCEPTION_AUTHORITY.md`);
      logger.info({ agentId: agent.agentId }, "Seeded EXCEPTION_AUTHORITY.md");
    }
  }

  return seeded;
}

export default router;
