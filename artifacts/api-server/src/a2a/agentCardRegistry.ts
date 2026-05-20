import { db, governanceFiles } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { getActiveMandate } from "../lib/mandateIssuer.js";

const REPLIT_URL = (process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : process.env.REPLIT_URL ?? "http://localhost:8080"
).replace(/\/$/, "");

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
}

// ─── A2A v1.0 compliant AgentCard interface ───────────────────────────────────
// Fields: name, description, url, version, provider, documentationUrl,
// inputModes, outputModes, capabilities, skills, authentication
// Ref: https://google.github.io/A2A/specification/
export interface AgentCardMandate {
  mandateId: string;
  phase: string;
  authorizations: Array<{ action: string; ceiling: number | null; unit?: string; currency?: string; description?: string }>;
  validUntil: string;
  issuedAt: string;
}

export interface AgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  provider: {
    organization: string;
    url: string;
  };
  documentationUrl: string;
  inputModes: string[];
  outputModes: string[];
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
  };
  skills: AgentSkill[];
  authentication: {
    schemes: string[];
  };
  /** AP2 Intent Mandate currently active for this agent+property. null = no mandate issued yet. */
  intentMandate: AgentCardMandate | null;
}

const DOCS_URL = "https://vda-md.citizenm.com/docs/agents";

const PLATFORM_PROVIDER = {
  organization: "citizenM Hotels — VDA-MD Platform",
  url: "https://citizenm.com",
};

// Standard A2A v1.0 I/O modes for all VDA-MD agents
const DEFAULT_INPUT_MODES = ["application/json", "text/plain"];
const DEFAULT_OUTPUT_MODES = ["application/json"];

export const AGENT_DEFS: Record<string, { name: string; description: string; defaultSkills: AgentSkill[] }> = {
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
  "onboarding-agent": {
    name: "VDA-MD Onboarding Agent",
    description: "Governs the admission of external agents into the VDA-MD framework. Runs a 7-phase workflow: Agent Card validation, impact delta analysis, candidate governance file generation, dual HITL approval gates, sandbox evaluation, GitHub PR creation, and W3C VC issuance. Platform-scoped across all citizenM properties.",
    defaultSkills: [
      { id: "read_all_governance_files", name: "Read All Governance Files", description: "READ all AGENTS.md, SOP.md, SKILL.md, EXCEPTION.md files across all agents and companies" },
      { id: "read_witness_log", name: "Read Witness Log", description: "QUERY witness_entries for impact delta analysis" },
      { id: "write_candidate_files", name: "Write Candidate Files", description: "WRITE to staging branch only, never main" },
      { id: "call_eval_pipeline", name: "Call Eval Pipeline", description: "TRIGGER 5-scenario governance sandbox evaluation against candidate SOP.md" },
      { id: "trigger_hitl", name: "Trigger HITL", description: "CALL POST /hitl/escalate for both approval gates and RACI notification cards" },
      { id: "commit_via_pr", name: "Commit via PR", description: "CREATE pull request to governance repo, never direct push" },
      { id: "issue_vc", name: "Issue VC", description: "CALL POST /api/agents/credentials/issue for approved agent" },
      { id: "register_agent_card", name: "Register Agent Card", description: "ADD new agent to A2A Agent Card runtime registry" },
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

  const [dbSkills, mandate] = await Promise.all([
    loadSkillsFromDb(companyId, agentId),
    getActiveMandate(agentId, companyId).catch(() => null),
  ]);
  const skills = dbSkills ?? def.defaultSkills;

  const activeMandate: AgentCardMandate | null = mandate
    ? {
        mandateId: mandate.mandateId,
        phase: mandate.phase,
        authorizations: (mandate.authorizations ?? []) as AgentCardMandate["authorizations"],
        validUntil: mandate.validUntil instanceof Date ? mandate.validUntil.toISOString() : String(mandate.validUntil),
        issuedAt: mandate.issuedAt instanceof Date ? mandate.issuedAt.toISOString() : String(mandate.issuedAt),
      }
    : null;

  return {
    name: def.name,
    description: def.description,
    url: `${REPLIT_URL}/api/a2a/${companyId}/${agentId}`,
    version: "1.0.0",
    provider: PLATFORM_PROVIDER,
    documentationUrl: `${DOCS_URL}/${agentId}`,
    inputModes: DEFAULT_INPUT_MODES,
    outputModes: DEFAULT_OUTPUT_MODES,
    capabilities: { streaming: true, pushNotifications: false },
    skills,
    authentication: { schemes: ["bearer"] },
    intentMandate: activeMandate,
  };
}

export async function getAllAgentCards(companyId: number): Promise<AgentCard[]> {
  const cards = await Promise.all(
    AGENT_IDS.map(id => getAgentCard(companyId, id))
  );
  return cards.filter((c): c is AgentCard => c !== null);
}

export function getOnboardingAgentCard(): AgentCard {
  const def = AGENT_DEFS["onboarding-agent"];
  return {
    name: def.name,
    description: def.description,
    url: `${REPLIT_URL}/api/a2a/onboarding`,
    version: "1.0.0",
    provider: PLATFORM_PROVIDER,
    documentationUrl: `${DOCS_URL}/onboarding-agent`,
    inputModes: DEFAULT_INPUT_MODES,
    outputModes: DEFAULT_OUTPUT_MODES,
    capabilities: { streaming: true, pushNotifications: false },
    skills: def.defaultSkills,
    authentication: { schemes: ["bearer"] },
    intentMandate: null,
  };
}

export function getPlatformCard(): AgentCard {
  return {
    name: "VDA-MD — Value Driven AI Operating System (citizenM)",
    description: "VDA-MD is a governed multi-agent platform for citizenM hospitality operations. It exposes 9 specialised agents: 8 for the full Apaleo guest lifecycle (availability, rate, reservation, check-in, folio, folio charging, checkout, revenue reconciliation) and 1 Onboarding Agent for governed external agent admission. Every agent decision is governed by W3C Verifiable Credentials, §2.1 mandatory governance files, Witness Agent audit logging, and compliance guards enforcing GDPR, EU AI Act, and ISO 42001.",
    url: `${REPLIT_URL}/api/a2a`,
    version: "1.0.0",
    provider: PLATFORM_PROVIDER,
    documentationUrl: DOCS_URL,
    inputModes: DEFAULT_INPUT_MODES,
    outputModes: DEFAULT_OUTPUT_MODES,
    capabilities: { streaming: true, pushNotifications: false },
    skills: AGENT_IDS.map(id => ({
      id,
      name: AGENT_DEFS[id].name,
      description: AGENT_DEFS[id].description,
    })),
    authentication: { schemes: ["bearer"] },
    intentMandate: null,
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
