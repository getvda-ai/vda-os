import { db, governanceFiles } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const REPLIT_URL = (process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : process.env.REPLIT_URL ?? "http://localhost:8080"
).replace(/\/$/, "");

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
}

export interface AgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
  };
  skills: AgentSkill[];
  authentication: {
    schemes: string[];
  };
}

const AGENT_DEFS: Record<string, { name: string; description: string; defaultSkills: AgentSkill[] }> = {
  "availability-agent": {
    name: "VDA-MD Availability Agent",
    description: "Evaluates room availability and unit group capacity at citizenM properties using Apaleo PMS data, governed by the availability policy file.",
    defaultSkills: [
      { id: "check-availability", name: "Check Availability", description: "Query available unit groups for a property and date range" },
      { id: "availability-decision", name: "Availability Decision", description: "Return governed PASS/FAIL decision on availability requests" },
    ],
  },
  "rate-agent": {
    name: "VDA-MD Rate Agent",
    description: "Evaluates and authorises rate plan overrides at citizenM properties, governed by the rate management policy.",
    defaultSkills: [
      { id: "evaluate-rate", name: "Evaluate Rate", description: "Assess rate plan override requests against policy rules" },
      { id: "list-rate-plans", name: "List Rate Plans", description: "Retrieve available Apaleo rate plans for a property" },
    ],
  },
  "reservation-bot": {
    name: "VDA-MD Reservation Bot",
    description: "Creates and manages guest reservations at citizenM properties via Apaleo, enforcing booking policy.",
    defaultSkills: [
      { id: "create-reservation", name: "Create Reservation", description: "Submit a new reservation to Apaleo after policy validation" },
      { id: "validate-booking", name: "Validate Booking", description: "Run policy check on a reservation creation request" },
    ],
  },
  "check-in-agent": {
    name: "VDA-MD Check-In Agent",
    description: "Governs the 5-gate check-in process at citizenM properties, verifying guest identity, payment, and folio status before check-in.",
    defaultSkills: [
      { id: "process-checkin", name: "Process Check-In", description: "Execute governed 5-gate check-in via Apaleo" },
      { id: "verify-reservation", name: "Verify Reservation", description: "Confirm reservation status before check-in" },
    ],
  },
  "folio-agent": {
    name: "VDA-MD Folio Agent",
    description: "Reads and inspects guest folios at citizenM properties via Apaleo, returning a governed read-only view.",
    defaultSkills: [
      { id: "list-folios", name: "List Folios", description: "Return governed list of open folios for a reservation" },
      { id: "get-folio", name: "Get Folio", description: "Retrieve folio details for a specific reservation" },
    ],
  },
  "folio-charge-agent": {
    name: "VDA-MD Folio Charge Agent",
    description: "Authorises and posts folio charges at citizenM properties, inheriting Finance O2C cross-domain policy for charge thresholds.",
    defaultSkills: [
      { id: "post-charge", name: "Post Folio Charge", description: "Submit a folio charge after O2C policy validation" },
      { id: "evaluate-charge", name: "Evaluate Charge", description: "Run O2C governance check on a proposed charge" },
    ],
  },
  "checkout-agent": {
    name: "VDA-MD Checkout Agent",
    description: "Governs the guest checkout process at citizenM properties, validating folio balance and processing checkout via Apaleo.",
    defaultSkills: [
      { id: "process-checkout", name: "Process Checkout", description: "Execute governed checkout with folio validation" },
      { id: "validate-folio", name: "Validate Folio", description: "Confirm folio is settled before checkout" },
    ],
  },
  "revenue-reconciliation-agent": {
    name: "VDA-MD Revenue Reconciliation Agent",
    description: "Runs end-of-day revenue reconciliation and reporting at citizenM properties, governed by the revenue reconciliation policy.",
    defaultSkills: [
      { id: "run-reconciliation", name: "Run Reconciliation", description: "Execute end-of-day revenue reconciliation" },
      { id: "generate-report", name: "Generate Revenue Report", description: "Produce governed revenue summary from Apaleo data" },
    ],
  },
};

export const AGENT_IDS = Object.keys(AGENT_DEFS);

async function loadSkillsFromDb(companyId: number, agentId: string): Promise<AgentSkill[] | null> {
  try {
    const rows = await db
      .select({ content: governanceFiles.content })
      .from(governanceFiles)
      .where(
        and(
          eq(governanceFiles.companyId, companyId),
          eq(governanceFiles.agentId, agentId),
          eq(governanceFiles.fileType, "SKILL"),
          eq(governanceFiles.isArchived, false)
        )
      )
      .limit(1);

    if (!rows[0]?.content) return null;

    const content = rows[0].content;
    const skills: AgentSkill[] = [];

    // Extract MUST/MAY/SKILL lines from SKILL.md as individual skills
    const lines = content.split("\n");
    for (const line of lines) {
      const m = line.match(/^[-*]\s+\*?\*?(MUST|MAY|CAN|SHALL)\*?\*?\s+(.+)/i);
      if (m && skills.length < 8) {
        const raw = m[2].replace(/\*\*/g, "").trim();
        const id = raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
        skills.push({ id, name: raw.slice(0, 50), description: raw });
      }
    }

    return skills.length >= 2 ? skills : null;
  } catch {
    return null;
  }
}

export async function getAgentCard(companyId: number, agentId: string): Promise<AgentCard | null> {
  const def = AGENT_DEFS[agentId];
  if (!def) return null;

  const dbSkills = await loadSkillsFromDb(companyId, agentId);
  const skills = dbSkills ?? def.defaultSkills;

  return {
    name: def.name,
    description: def.description,
    url: `${REPLIT_URL}/api/a2a/${companyId}/${agentId}`,
    version: "1.0.0",
    capabilities: { streaming: false, pushNotifications: false },
    skills,
    authentication: { schemes: ["bearer"] },
  };
}

export async function getAllAgentCards(companyId: number): Promise<AgentCard[]> {
  const cards = await Promise.all(
    AGENT_IDS.map(id => getAgentCard(companyId, id))
  );
  return cards.filter((c): c is AgentCard => c !== null);
}

export function getPlatformCard(): AgentCard {
  return {
    name: "VDA-MD — Value Driven AI Operating System (citizenM)",
    description: "VDA-MD is a governed multi-agent platform for citizenM hospitality operations. It exposes 8 specialised agents for the full Apaleo guest lifecycle: availability, rate, reservation, check-in, folio, folio charging, checkout, and revenue reconciliation. Every agent decision is governed by W3C Verifiable Credentials, §2.1 mandatory governance files, Witness Agent audit logging, and compliance guards enforcing GDPR, EU AI Act, and ISO 42001.",
    url: `${REPLIT_URL}/api/a2a`,
    version: "1.0.0",
    capabilities: { streaming: false, pushNotifications: false },
    skills: AGENT_IDS.map(id => ({
      id,
      name: AGENT_DEFS[id].name,
      description: AGENT_DEFS[id].description,
    })),
    authentication: { schemes: ["bearer"] },
  };
}

// Reverse map: agentId → policyKey (for evaluateWithPolicy)
export const AGENT_ID_TO_POLICY_KEY: Record<string, string> = {
  "availability-agent":           "availability",
  "rate-agent":                   "rate",
  "reservation-bot":              "reservation",
  "check-in-agent":               "checkin",
  "folio-agent":                  "folio",
  "folio-charge-agent":           "folio_charge",
  "checkout-agent":               "checkout",
  "revenue-reconciliation-agent": "revenue",
};
