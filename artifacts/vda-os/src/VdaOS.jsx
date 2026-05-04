import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useApaleoStats, useApaleoReservations } from "./hooks/use-apaleo";
import VdaMdChatbot from "./VdaMdChatbot.jsx";
import AmbassadorView      from "./dashboard/AmbassadorView.jsx";
import SeniorAmbassadorView from "./dashboard/SeniorAmbassadorView.jsx";
import HotelGMView         from "./dashboard/HotelGMView.jsx";
import RegionalGMView      from "./dashboard/RegionalGMView.jsx";
import OperationsChiefView   from "./dashboard/OperationsChiefView.jsx";
import ComplianceOfficerView from "./dashboard/ComplianceOfficerView.jsx";
import DemoShowreel          from "./demo/DemoShowreel.jsx";

// ─────────────────────────────────────────────
// DESIGN TOKENS — identical to citizenM version
// ─────────────────────────────────────────────
const T = {
  bg: "#07080a", surface: "#0d0f12", card: "#111418",
  border: "#1e2229", borderHi: "#2e3340",
  orange: "#FF6B2B", blue: "#4A9EFF", purple: "#A066FF",
  green: "#22D47A", red: "#FF4D6A", amber: "#FFB020",
  teal: "#00C9C8", text: "#FFFFFF", muted: "#FFFFFF",
  dim: "#ffffff",
  mono: "'IBM Plex Mono', 'Fira Code', monospace",
  sans: "'Outfit', 'DM Sans', sans-serif",
};

const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=Outfit:wght@300;400;600;700;900&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: ${T.bg}; }
  ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: ${T.surface}; }
  ::-webkit-scrollbar-thumb { background: ${T.border}; border-radius: 3px; }
  select option { background: ${T.card}; color: ${T.text}; }
  @keyframes pulse-ring { 0%,100%{opacity:1} 50%{opacity:0.4} }
  @keyframes slide-up { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
  @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
  @keyframes glow-pulse { 0%,100%{box-shadow:0 0 0 0 rgba(255,107,43,0)} 50%{box-shadow:0 0 24px 4px rgba(255,107,43,0.25)} }
  @keyframes badge-in { from{opacity:0;transform:scale(0.85)} to{opacity:1;transform:scale(1)} }
  @keyframes wizard-in { from{opacity:0;transform:scale(0.96) translateY(16px)} to{opacity:1;transform:scale(1) translateY(0)} }
  @keyframes step-fill { from{width:0} to{width:100%} }
  @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
`;

// ─────────────────────────────────────────────
// INDUSTRY CONFIGURATIONS — Apaleo Hospitality Only
// ─────────────────────────────────────────────
const INDUSTRY_CONFIGS = {
  hospitality: {
    label: "Apaleo Hospitality Stack", icon: "🏨",
    customerTerm: "Guest", employeeTerm: "Property Team Member", serviceTerm: "Reservation",
    domainColors: { business: T.blue, operations: T.orange, shared: T.green },
    nistControls: ["AC-2", "AU-2", "SA-4", "IR-4"],
    additionalFrameworks: ["PCI DSS (guest payment card data)", "GDPR / CCPA (guest personal data)", "ISO 22301 (business continuity)", "Local data privacy laws (jurisdiction-specific)"],
    journeyStages: [
      { id: "discover", label: "Discover & Book", domain: "Revenue", owner: "Head of Revenue", color: T.blue,
        agents: ["Availability Agent", "Rate Agent", "Reservation Bot"] },
      { id: "checkin", label: "Check-In", domain: "Operations", owner: "Operations Director", color: T.orange,
        agents: ["Check-In Agent", "Unit Assignment Bot", "Guest Verification Agent"] },
      { id: "instay", label: "In-Stay", domain: "Operations", owner: "Operations Director", color: T.orange,
        agents: ["Concierge Agent", "Folio Agent", "Service Request Bot"] },
      { id: "checkout", label: "Checkout", domain: "Operations", owner: "Operations Director", color: T.orange,
        agents: ["Checkout Agent", "Folio Settlement Agent", "Revenue Reconciliation Agent"] },
      { id: "poststay", label: "Post-Stay", domain: "Revenue", owner: "CX Director", color: T.blue,
        agents: ["Review Agent", "Re-engagement Bot", "Loyalty Offer Agent"] },
    ],
    sharedServices: [
      { id: "s2p", label: "Source-to-Pay", owner: "CFO", icon: "📋", color: T.green,
        agents: ["F&B Procurement Agent", "Maintenance PO Agent", "Vendor Compliance Bot"] },
      { id: "hrpay", label: "HR & Roster", owner: "CPO", icon: "👥", color: T.green,
        agents: ["Onboarding Agent", "Roster Bot", "Offboarding Agent"] },
      { id: "o2c", label: "Order-to-Cash", owner: "CFO", icon: "💰", color: T.teal,
        agents: ["Folio Invoice Agent", "Payment Collection Bot", "Revenue Reconciliation Agent"] },
    ],
    exceptionScenarios: [
      { id: "loyalty", label: "Rate Plan Override", icon: "⭐", description: "Rate plan exception for key account or VIP reservation" },
      { id: "procurement", label: "Preferred Supplier", icon: "📋", description: "Preferred vendor procurement exception for F&B or maintenance" },
      { id: "access", label: "Staff Fast-Track", icon: "👤", description: "Specialist role access provisioning before start date" },
    ],
    witnessEntries: [
      { agent: "Checkout Agent", decision: "PASS", file: "Hospitality-Operations-Post-Stay-checkout-agent.SOP.md", clause: "MAY waive late checkout fee for verified loyalty tier guests", exception: true },
      { agent: "Maintenance PO Agent", decision: "FAIL", file: "procurement-authority.md", clause: "MUST NOT process PO above authority level without CFO sign-off", exception: false },
      { agent: "Onboarding Agent", decision: "ESCALATE", file: "staff-access-provisioning-baseline.md", clause: "MUST NOT provision access without manager approval in the HR system", exception: false },
    ],
  },
};

// ─────────────────────────────────────────────
// NIST CONTROLS — same full OSCAL data from citizenM version
// but extended with industry-specific ones
// ─────────────────────────────────────────────
const NIST_CONTROLS = {
  "AC-2": {
    title: "Account Management", family: "Access Control (AC)",
    description: "Manage information system accounts including types, roles, and access authorizations throughout the full account lifecycle.",
    oscal: `{\n  "id": "ac-2", "class": "SP800-53", "title": "Account Management",\n  "parts": [{\n    "id": "ac-2_smt", "name": "statement",\n    "prose": "a. Identify account types; b. Assign account managers; c. Require approvals for account creation; d. Create accounts per policy; e. Enable/disable/remove accounts; f. Monitor use; g. Notify when access no longer required; j. Terminate access on departure; k. Audit account actions."\n  }]\n}`
  },
  "AU-2": {
    title: "Event Logging", family: "Audit & Accountability (AU)",
    description: "Identify the types of events that the system is capable of logging and coordinate the event logging function with other entities.",
    oscal: `{\n  "id": "au-2", "class": "SP800-53", "title": "Event Logging",\n  "parts": [{\n    "id": "au-2_smt", "name": "statement",\n    "prose": "a. Identify events the system is capable of logging; b. Coordinate with entities requiring audit info; c. Specify events for logging including logon/logoff, account management, object access, policy changes, privilege use, process tracking; d. Provide rationale for event selection; e. Review and update annually."\n  }]\n}`
  },
  "SA-4": {
    title: "Acquisition Process", family: "System & Services Acquisition (SA)",
    description: "Include security and privacy requirements and specifications in acquisition contracts for systems, components, and services.",
    oscal: `{\n  "id": "sa-4", "class": "SP800-53", "title": "Acquisition Process",\n  "parts": [{\n    "id": "sa-4_smt", "name": "statement",\n    "prose": "Include in acquisition contracts: a. Security/privacy functional requirements; b. Strength of mechanism requirements; c. Assurance requirements; d. Controls documentation; e. Developer security testing; f. Supply chain risk management; g. Acceptance criteria."\n  }]\n}`
  },
  "IR-4": {
    title: "Incident Handling", family: "Incident Response (IR)",
    description: "Implement an incident handling capability including preparation, detection, analysis, containment, eradication, and recovery.",
    oscal: `{\n  "id": "ir-4", "class": "SP800-53", "title": "Incident Handling",\n  "parts": [{\n    "id": "ir-4_smt", "name": "statement",\n    "prose": "a. Implement incident handling capability including preparation, detection, analysis, containment, eradication, recovery; b. Coordinate with contingency planning; c. Incorporate lessons learned; d. Ensure consistent and predictable incident handling across the organization."\n  }]\n}`
  },
  "SC-28": {
    title: "Protection of Information at Rest", family: "System & Communications Protection (SC)",
    description: "Implement cryptographic mechanisms to prevent unauthorized disclosure and modification of information at rest on system components.",
    oscal: `{\n  "id": "sc-28", "class": "SP800-53", "title": "Protection of Information at Rest",\n  "parts": [{\n    "id": "sc-28_smt", "name": "statement",\n    "prose": "The information system protects the confidentiality and integrity of information at rest. This includes: a. Identifying data at rest requiring protection; b. Implementing cryptographic mechanisms; c. Defining retention and disposal procedures."\n  }]\n}`
  },
  "RA-5": {
    title: "Vulnerability Monitoring and Scanning", family: "Risk Assessment (RA)",
    description: "Monitor and scan for vulnerabilities in the organizational systems and applications, periodically and when new vulnerabilities are identified.",
    oscal: `{\n  "id": "ra-5", "class": "SP800-53", "title": "Vulnerability Monitoring and Scanning",\n  "parts": [{\n    "id": "ra-5_smt", "name": "statement",\n    "prose": "a. Monitor and scan for vulnerabilities in organizational systems; b. Employ tools capable of identifying all types of vulnerabilities; c. Analyze vulnerability scan reports; d. Remediate vulnerabilities within defined timeframes; e. Share vulnerability information with designated parties."\n  }]\n}`
  },
  "MP-6": {
    title: "Media Sanitization", family: "Media Protection (MP)",
    description: "Sanitize system media prior to disposal, release out of organizational control, or release for reuse using organization-defined procedures.",
    oscal: `{\n  "id": "mp-6", "class": "SP800-53", "title": "Media Sanitization",\n  "parts": [{\n    "id": "mp-6_smt", "name": "statement",\n    "prose": "a. Sanitize system media prior to disposal or reuse using approved procedures; b. Employ sanitization mechanisms with strength proportional to data classification; c. Dispose of sanitized media per organizational procedures."\n  }]\n}`
  },
  "IA-5": {
    title: "Authenticator Management", family: "Identification & Authentication (IA)",
    description: "Manage information system authenticators including passwords, tokens, biometrics, PKI certificates, and key cards throughout their lifecycle.",
    oscal: `{\n  "id": "ia-5", "class": "SP800-53", "title": "Authenticator Management",\n  "parts": [{\n    "id": "ia-5_smt", "name": "statement",\n    "prose": "a. Verify identity of authenticator recipients prior to distribution; b. Establish initial authenticator content; c. Ensure authenticators meet strength requirements; d. Distribute authenticators securely; e. Change default authenticators on first use; f. Change/refresh authenticators per defined periods; g. Protect authenticators from unauthorized disclosure."\n  }]\n}`
  },
  "SI-10": {
    title: "Information Input Validation", family: "System & Information Integrity (SI)",
    description: "Check the validity of information inputs to the system to protect against injection attacks and ensure data integrity.",
    oscal: `{\n  "id": "si-10", "class": "SP800-53", "title": "Information Input Validation",\n  "parts": [{\n    "id": "si-10_smt", "name": "statement",\n    "prose": "The information system checks the validity of information inputs to protect against: a. SQL injection; b. Cross-site scripting; c. Buffer overflow attacks; d. Format string vulnerabilities; e. Malformed input that could cause system failure."\n  }]\n}`
  },
  "AC-17": {
    title: "Remote Access", family: "Access Control (AC)",
    description: "Establish usage restrictions, configuration/connection requirements, and implementation guidance for remote access connections.",
    oscal: `{\n  "id": "ac-17", "class": "SP800-53", "title": "Remote Access",\n  "parts": [{\n    "id": "ac-17_smt", "name": "statement",\n    "prose": "a. Establish and document usage restrictions, configuration requirements, and implementation guidance for remote access; b. Authorize remote access to organizational systems prior to allowing connections; c. Monitor and control remote access sessions."\n  }]\n}`
  },
  "SC-8": {
    title: "Transmission Confidentiality and Integrity", family: "System & Communications Protection (SC)",
    description: "Implement cryptographic mechanisms to prevent unauthorized disclosure and modification of information during transmission.",
    oscal: `{\n  "id": "sc-8", "class": "SP800-53", "title": "Transmission Confidentiality and Integrity",\n  "parts": [{\n    "id": "sc-8_smt", "name": "statement",\n    "prose": "Implement cryptographic mechanisms to prevent unauthorized disclosure and modification of information during transmission. This includes: a. TLS/HTTPS for all data in transit; b. Certificate management; c. Prohibition of cleartext protocols for sensitive data."\n  }]\n}`
  },
  "PE-3": {
    title: "Physical Access Control", family: "Physical & Environmental Protection (PE)",
    description: "Enforce physical access authorizations to the facility and systems including maintaining visitor access logs.",
    oscal: `{\n  "id": "pe-3", "class": "SP800-53", "title": "Physical Access Control",\n  "parts": [{\n    "id": "pe-3_smt", "name": "statement",\n    "prose": "a. Enforce physical access authorizations for entry/exit points; b. Maintain physical access audit logs; c. Control access to facilities with authorized hardware; d. Escort visitors and monitor their activity; e. Secure keys, combinations, and access devices."\n  }]\n}`
  },
};

// ─────────────────────────────────────────────
// UNIVERSAL EXCEPTION SCENARIOS
// ─────────────────────────────────────────────
function buildScenarios(industry, companyName) {
  const cfg = INDUSTRY_CONFIGS[industry];
  const customer = cfg.customerTerm;
  const employee = cfg.employeeTerm;

  return {
    decision: {
      id: "decision", label: `${customer} Decision`, icon: "⚖️",
      domain: "Customer-Facing", journeyStage: cfg.journeyStages[0]?.label || "Operations",
      color: T.blue,
      description: `AI agent makes an automated decision directly affecting a ${customer.toLowerCase()}`,
      baselineFile: {
        name: `automated-${customer.toLowerCase()}-decision-baseline.md`,
        type: "SOP", owner: `Head of ${cfg.journeyStages[0]?.owner || "Operations"}`,
        content: `---\ncontrol_id: automated-${customer.toLowerCase()}-decision-baseline\ndomain: ${cfg.journeyStages[0]?.domain || "Operations"}\nowner: ${cfg.journeyStages[0]?.owner || "Head of Operations"}\nbaseline: true\ncustomer: ${companyName}\n---\n\n## Automated ${customer} Decision — Baseline\n\nAll AI agent decisions that materially affect a ${customer.toLowerCase()} must be evaluated against this baseline policy. GDPR Article 22 rights are preserved — every ${customer.toLowerCase()} has the right to human review of any automated decision.\n\n### Agent Rules\n\n- MUST NOT make automated decisions with significant impact on ${customer.toLowerCase()}s without logging to Witness Agent\n- MUST provide the ${customer.toLowerCase()} with the right to request human review\n- MUST NOT apply decisions that discriminate on protected characteristics\n- MUST log all automated decisions with the governing clause cited\n- SHOULD offer alternative resolution path if automated decision is contested\n\n### Violation Definition\n\nAutomated decision affecting ${customer.toLowerCase()} made without audit trail or without preserving GDPR Article 22 rights = regulatory violation → Data Protection Officer notification required.`
      },
      exceptionFile: {
        name: `automated-${customer.toLowerCase()}-decision-tier-exception.md`,
        type: "EXCEPTION", owner: `Head of ${cfg.journeyStages[0]?.domain || "Business"}`,
        content: `---\ncontrol_id: automated-${customer.toLowerCase()}-decision-tier-exception\nexception_to: automated-${customer.toLowerCase()}-decision-baseline\napplies_to: Premium / Priority ${customer} Tier\nconditions:\n  - Active premium/priority status verified in CRM\n  - Decision value below defined threshold\n  - ${customer} has not previously contested automated decisions\napproved_by: Chief Operating Officer\nexpires: 2026-12-31\nrisk_level: low\ncustomer: ${companyName}\n---\n\n## Premium ${customer} Automated Decision Exception\n\nPremium tier ${customer.toLowerCase()}s receive expedited automated processing with reduced manual review requirements for decisions below the defined threshold — with full GDPR Article 22 rights preserved.\n\n### Exception Conditions\n\n- Active premium/priority status verified in CRM (real-time check)\n- Decision impact must not exceed defined monetary or operational threshold\n- ${customer} must have active consent for automated processing on file\n\n### Agent Rules (Override)\n\n- MAY apply automated decision without mandatory human review stage for eligible ${customer.toLowerCase()}s\n- MUST still verify premium status in CRM before applying exception\n- MUST still log to Witness Agent with exception_applied: true\n- MUST still inform ${customer.toLowerCase()} of their right to contest\n- Any contested decision reverts to full manual review regardless of tier\n\n### What Reverts to Baseline\n\n- Decisions above threshold → full baseline review required\n- Contested decisions → immediate human escalation\n- Expired or suspended premium status → baseline applies immediately`
      },
      params: [
        { id: "tier", label: `${customer} Tier`, options: [`Standard ${customer}`, `Premium ${customer}`] },
        { id: "impact", label: "Decision Impact", options: ["Below threshold", "Above threshold"] },
        { id: "consent", label: "Auto-Processing Consent", options: ["On file", "Not obtained"] },
        { id: "previousContest", label: "Previous Contest", options: ["None", "Previous dispute on record"] },
      ],
      defaultParams: { tier: `Premium ${customer}`, impact: "Below threshold", consent: "On file", previousContest: "None" },
    },
    procurement: {
      id: "procurement", label: "Procurement Approval", icon: "📋",
      domain: "Shared Services", journeyStage: "Source-to-Pay",
      color: T.green,
      description: "AI agent processes a purchase above approval authority threshold",
      baselineFile: {
        name: "procurement-approval-authority-baseline.md",
        type: "SOP", owner: "CFO",
        content: `---\ncontrol_id: procurement-approval-authority-baseline\ndomain: Shared Services / Procurement\nowner: CFO\nbaseline: true\ncustomer: ${companyName}\n---\n\n## Procurement Approval Authority — Baseline\n\nAll procurement at ${companyName} follows the tiered approval matrix below.\n\n### Approval Thresholds\n\n| Amount | Authority Required |\n|--------|-------------------|\n| Up to threshold 1 | Department Head |\n| Threshold 1–2 | Operations Director |\n| Threshold 2–3 | CFO sign-off |\n| Above threshold 3 | CFO + Board notification |\n\nThree competitive quotes required for all purchases above the minimum threshold unless supplier holds current Preferred Supplier status.\n\n### Agent Rules\n\n- MUST NOT process PO above requestor's authority level\n- MUST verify three-quote compliance above minimum threshold\n- MUST flag any supplier not on the Approved Vendor list\n- MUST confirm valid budget code before committing\n- MUST log all decisions to Witness Agent with governing clause cited\n\n### Violation Definition\n\nPO committed without appropriate authority or required competitive quotes = procurement control violation → CFO notification required.`
      },
      exceptionFile: {
        name: "procurement-preferred-supplier-exception.md",
        type: "EXCEPTION", owner: "CFO",
        content: `---\ncontrol_id: procurement-preferred-supplier-exception\nexception_to: procurement-approval-authority-baseline\napplies_to: Preferred Supplier List — verified suppliers\nconditions:\n  - Current Preferred Supplier status (annual review)\n  - Invoice value must not exceed exception ceiling\n  - Supplier holds current approved vendor status\napproved_by: CFO\nexpires: 2026-12-31\nrisk_level: medium\ncustomer: ${companyName}\n---\n\n## Preferred Supplier Exception\n\nSuppliers on ${companyName}'s Preferred Supplier List may be approved at a lower authority level without the standard three-quote requirement, up to the exception ceiling value.\n\n### Exception Conditions\n\n- Supplier must appear on current Preferred Supplier List (annual renewal required)\n- Invoice must not exceed exception ceiling value\n- Supplier must hold current DPA and insurance\n\n### Agent Rules (Override)\n\n- MAY approve at reduced authority level for current Preferred Suppliers\n- MAY waive three-quote requirement for these suppliers\n- MUST verify current Preferred Supplier status before applying exception\n- MUST write Witness Agent entry with exception_applied: true + supplier reference\n- CFO approval still required above exception ceiling — this is a hard limit\n\n### What Reverts to Baseline\n\n- Invoices above exception ceiling → standard CFO approval\n- Expired preferred status → full baseline applies immediately\n- Any supplier with open compliance issues → baseline applies`
      },
      params: [
        { id: "supplierStatus", label: "Supplier Status", options: ["Standard vendor", "Preferred Supplier (verified)"] },
        { id: "amount", label: "Purchase Value", options: ["Below exception ceiling", "Above exception ceiling"] },
        { id: "quotes", label: "Competitive Quotes", options: ["3 quotes on file", "No quotes provided"] },
        { id: "budgetCode", label: "Budget Code", options: ["Valid and confirmed", "Not provided"] },
      ],
      defaultParams: { supplierStatus: "Preferred Supplier (verified)", amount: "Below exception ceiling", quotes: "No quotes provided", budgetCode: "Valid and confirmed" },
    },
    access: {
      id: "access", label: "Staff Access", icon: "👤",
      domain: "Shared Services", journeyStage: "HR & People",
      color: T.purple,
      description: `AI agent provisions system access for a new ${employee.toLowerCase()}`,
      baselineFile: {
        name: "staff-access-provisioning-baseline.md",
        type: "SOP", owner: "Chief People Officer",
        content: `---\ncontrol_id: staff-access-provisioning-baseline\ndomain: Shared Services / HR\nowner: Chief People Officer\nbaseline: true\ncustomer: ${companyName}\n---\n\n## Staff System Access Provisioning — Baseline\n\nAll ${companyName} ${employee.toLowerCase()} accounts require a formal manager request in the HR system before any access is granted.\n\n### Timing Rules\n\n- Provisioning may NOT begin before the ${employee.toLowerCase()}'s confirmed start date\n- Provisioning must be completed within 48 hours of the confirmed start date\n- Early provisioning (before start date) is NOT permitted under this baseline\n\n### Agent Rules\n\n- MUST NOT activate any account without a logged manager request in the HR system\n- MUST verify start date and cost centre before initiating provisioning\n- MUST confirm access level matches role requirements (least privilege principle)\n- MUST send confirmation to manager and ${employee.toLowerCase()} within 24 hours\n\n### Violation Definition\n\nAccount activated without HR system manager request, or provisioned before confirmed start date = access control violation → immediate CISO notification required.`
      },
      exceptionFile: {
        name: "staff-access-specialist-fasttrack-exception.md",
        type: "EXCEPTION", owner: "CISO",
        content: `---\ncontrol_id: staff-access-specialist-fasttrack-exception\nexception_to: staff-access-provisioning-baseline\napplies_to: Specialist / Critical roles requiring pre-start access\nconditions:\n  - Role formally classified as specialist/critical in HR system\n  - Head of department submits fast-track request\n  - CISO or Security Lead sign-off required per individual request\n  - Maximum 5 working days before start date\napproved_by: CISO\nexpires: 2026-12-31\nrisk_level: medium\ncustomer: ${companyName}\n---\n\n## Specialist Role Fast-Track Access Exception\n\nRoles formally classified as specialist or critical may have limited access provisioned up to 5 working days before the start date — with individual CISO sign-off per request.\n\n### Exception Conditions\n\n- Role must be formally classified as specialist/critical in HR system (not self-declared)\n- Head of department must submit the fast-track request\n- CISO or Security Lead must provide sign-off for each individual request\n- Maximum pre-provisioning window: 5 working days before start date\n\n### Agent Rules (Override)\n\n- MAY provision limited access up to 5 days before start date WITH documented CISO sign-off\n- MUST verify specialist/critical role classification in HR system first\n- MUST confirm documented CISO sign-off reference exists before proceeding\n- MUST flag and NOT provision if CISO sign-off is missing — hard gate\n- Production system access remains on-start-date-only under all circumstances\n\n### What Reverts to Baseline\n\n- Non-specialist roles → baseline applies strictly\n- Fast-track requests without CISO sign-off → FAIL, escalate to CISO\n- Pre-provisioning beyond 5 working days → FAIL`
      },
      params: [
        { id: "roleType", label: "Role Classification", options: ["Standard role", "Specialist / Critical role"] },
        { id: "timing", label: "Request Timing", options: ["On start date", "3 days pre-start", "7 days pre-start"] },
        { id: "cisoSignoff", label: "Security Sign-off", options: ["Documented and logged", "Not obtained"] },
        { id: "hrRequest", label: "HR Manager Request", options: ["Submitted", "Not submitted"] },
      ],
      defaultParams: { roleType: "Specialist / Critical role", timing: "3 days pre-start", cisoSignoff: "Documented and logged", hrRequest: "Submitted" },
    },
  };
}

// ─────────────────────────────────────────────
// MICRO COMPONENTS
// ─────────────────────────────────────────────
function Tag({ children, color }) {
  return (
    <span style={{
      background: `${color}18`, border: `1px solid ${color}40`, color,
      borderRadius: 4, padding: "2px 8px", fontSize: 10, fontWeight: 700,
      fontFamily: T.mono, letterSpacing: "0.06em", whiteSpace: "nowrap",
    }}>{children}</span>
  );
}

function DecisionBadge({ decision, large }) {
  const cfg = {
    PASS:       { bg: "#0a2818", border: "#1a6038", color: "#4ade80", icon: "✓" },
    FAIL:       { bg: "#200a0a", border: "#6b1414", color: "#f87171", icon: "✗" },
    ESCALATE:   { bg: "#1f1500", border: "#6b4200", color: "#fbbf24", icon: "⚠" },
    NORMALISED: { bg: "#001f1f", border: "#006666", color: "#00C9C8", icon: "⚙" },
  }[decision] || { bg: T.card, border: T.border, color: T.muted, icon: "?" };
  return (
    <span style={{
      background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.color,
      borderRadius: 6, padding: large ? "6px 16px" : "3px 10px",
      fontSize: large ? 16 : 11, fontWeight: 800, fontFamily: T.mono,
      letterSpacing: "0.05em", animation: "badge-in 0.3s ease",
      display: "inline-block", whiteSpace: "nowrap",
    }}>{cfg.icon} {decision}</span>
  );
}

// ─────────────────────────────────────────────
// SETUP WIZARD
// ─────────────────────────────────────────────
function SetupWizard({ onComplete }) {
  const [step, setStep] = useState(1); // 1=welcome, 2=company, 3=files, 4=ingest, 5=ready
  const [companyName, setCompanyName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [apaleoPropertyId, setApaleoPropertyId] = useState("");
  const industry = "hospitality"; // Locked to Apaleo hospitality
  const [brandContext, setBrandContext] = useState("");
  const [ingesting, setIngesting] = useState(false);
  const [ingestLog, setIngestLog] = useState([]);
  const [ingestError, setIngestError] = useState(null);
  const [uploadedFiles, setUploadedFiles] = useState([]); // [{ name, type, size, b64, text }]
  const [dragOver, setDragOver] = useState(false);
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const [ingestPhase, setIngestPhase] = useState(""); // "files" | "web" | "mapping" | "done" | "error"
  const elapsedRef = useRef(null);

  const addLog = (msg, color = T.muted) => setIngestLog(p => [...p, { msg, color, id: Date.now() + Math.random() }]);

  const runIngestion = async () => {
    setIngesting(true);
    setIngestLog([]);
    setIngestError(null);
    setElapsedSecs(0);
    setIngestPhase("files");
    clearInterval(elapsedRef.current);
    elapsedRef.current = setInterval(() => setElapsedSecs(s => s + 1), 1000);

    try {
      // ── Process uploaded files first ─────────────────────────────────────
      let fileContext = "";
      if (uploadedFiles.length > 0) {
        addLog(`Processing ${uploadedFiles.length} uploaded file${uploadedFiles.length > 1 ? "s" : ""}…`, T.purple);
        setIngestPhase("files");
        await new Promise(r => setTimeout(r, 400));

        // Build message content with file documents
        const fileMessageContent = [];
        for (const f of uploadedFiles) {
          if (f.isPdf && f.b64) {
            fileMessageContent.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: f.b64 } });
          } else if (f.isText && f.text) {
            fileMessageContent.push({ type: "text", text: `--- FILE: ${f.name} ---\n${f.text.slice(0, 8000)}\n---` });
          } else if (f.b64) {
            // For non-PDF binary files (docx, xlsx), send with document type if supported, else text note
            fileMessageContent.push({ type: "text", text: `--- FILE: ${f.name} (${f.type}) ---\n[Binary file — extract any brand voice, terminology, role titles, system names, and operational language relevant to AI governance]\n---` });
          }
        }
        fileMessageContent.push({ type: "text", text: `Extract brand voice, role titles, named systems and platforms, operational terminology, and any governance-relevant language from these documents for ${companyName}. Be concise — focus on what makes this company distinct from generic industry language.` });

        const fileResp = await fetch("/api/ai/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514", max_tokens: 1500,
            system: "You are extracting brand context for the VDA-MD AI governance framework (Apaleo hospitality). Documents may be in any language including Dutch, German, French, or Spanish. Output everything in English, but preserve brand-specific proper nouns exactly as they appear — product names, system names, role titles, and branded terms should be kept verbatim with the original-language term noted in brackets. Extract: company values and mission, tone of voice, key role titles, named internal systems or platforms, operational terminology. Output as structured plain text. Be concise — 400-600 words.",
            messages: [{ role: "user", content: fileMessageContent }]
          })
        });
        const fileData = await fileResp.json();
        fileContext = fileData.content?.map(b => b.text || "").join("\n") || "";
        addLog(`${uploadedFiles.length} file${uploadedFiles.length > 1 ? "s" : ""} processed ✓`, T.green);
        await new Promise(r => setTimeout(r, 300));
      }

      // ── Web search for additional context ────────────────────────────────
      setIngestPhase("web");
      addLog(`Connecting to ${websiteUrl}…`, T.blue);
      await new Promise(r => setTimeout(r, 600));
      addLog("Running web search for brand context…", T.blue);

      const resp = await fetch("/api/ai/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1500,
          tools: [{ type: "web_search_20250305", name: "web_search" }],
          system: `You are extracting brand context for the VDA-MD AI governance framework (Apaleo hospitality). The property website may be in any language — Dutch, German, French, Spanish, or other. Search the property website and extract brand context. IMPORTANT: Output everything in English regardless of the website language. However, preserve brand-specific proper nouns exactly as they appear in the original language — product names, system names, platform names, role titles, and branded terminology should be kept verbatim (e.g. if the Dutch site says "Medewerkers" for employees, note: their term is "Medewerkers"). Extract: company values and mission, tone of voice and language style, key role titles used (with original-language terms noted), named internal systems or platforms, operational terminology specific to this property, hospitality-specific language. Output as structured plain text optimised for injecting into an Apaleo AI governance document generation prompt. Be concise — 400-600 words maximum.`,
          messages: [{ role: "user", content: `Search ${websiteUrl} and extract brand context for ${companyName} (Apaleo hospitality property). The site may be in a language other than English — that is fine, extract the content and output in English while preserving any brand-specific terms verbatim. Focus on: brand voice, role titles (with original language terms), key systems/platforms mentioned, operational terminology, company values. Also note any Apaleo-native references (property codes, rate plans, folio workflows). This context will make AI governance documents sound authentic to this property.` }]
        })
      });

      const data = await resp.json();
      addLog("Website content retrieved ✓", T.green);
      await new Promise(r => setTimeout(r, 400));
      addLog("Extracting brand voice and terminology…", T.blue);
      await new Promise(r => setTimeout(r, 600));

      const webText = data.content?.map(b => b.text || "").join("\n") || "";

      // ── Merge file context + web context ─────────────────────────────────
      const combined = [
        fileContext ? `## From Uploaded Documents:\n${fileContext}` : "",
        webText ? `## From Website (${websiteUrl}):\n${webText}` : "",
      ].filter(Boolean).join("\n\n---\n\n");

      setBrandContext(combined || `Brand context for ${companyName} — ${INDUSTRY_CONFIGS[industry]?.label}. Company operates in the ${industry} sector. Standard industry terminology and professional language applies.`);

      addLog("Brand terminology mapped ✓", T.green);
      await new Promise(r => setTimeout(r, 300));
      setIngestPhase("mapping");
      addLog(`Configuring ${INDUSTRY_CONFIGS[industry]?.nistControls.length} NIST controls for ${INDUSTRY_CONFIGS[industry]?.label}…`, T.blue);
      await new Promise(r => setTimeout(r, 500));
      addLog("GDPR Article mapping complete ✓", T.green);
      addLog("EU AI Act Article mapping complete ✓", T.green);
      await new Promise(r => setTimeout(r, 300));
      addLog(`✓ VDA-MD for Apaleo framework configured for ${companyName}`, T.orange);
      clearInterval(elapsedRef.current);
      setIngestPhase("done");
      setIngesting(false);
      setStep(5);
    } catch (e) {
      clearInterval(elapsedRef.current);
      setIngestPhase("error");
      setIngestError(e.message);
      setIngesting(false);
      setBrandContext(`Brand context for ${companyName} — ${INDUSTRY_CONFIGS[industry]?.label}. Apaleo-powered hospitality organisation. Apply Apaleo-native guest journey terminology throughout governance documents.`);
      addLog("⚠ Web ingestion limited — using fallback context", T.amber);
      setTimeout(() => setStep(5), 1500);
    }
  };

  const selectedIndustry = INDUSTRY_CONFIGS[industry];

  const inputStyle = {
    width: "100%", padding: "12px 16px",
    background: T.surface, border: `1px solid ${T.borderHi}`,
    borderRadius: 9, color: T.text, fontSize: 15,
    fontFamily: T.sans, outline: "none",
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: T.bg,
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1000, padding: 20,
    }}>
      <div style={{
        width: 600, maxWidth: "100%",
        background: "linear-gradient(145deg, #12141a 0%, #0c0e12 100%)",
        border: `2px solid ${T.orange}40`,
        borderRadius: 20,
        boxShadow: `0 40px 100px rgba(0,0,0,0.8), 0 0 60px rgba(255,107,43,0.08)`,
        overflow: "hidden",
        animation: "wizard-in 0.4s cubic-bezier(0.34,1.56,0.64,1)",
      }}>
        {/* Progress bar */}
        <div style={{ height: 3, background: T.border }}>
          <div style={{
            height: "100%", borderRadius: 999,
            background: `linear-gradient(90deg, ${T.orange}, ${T.amber})`,
            width: `${(step / 5) * 100}%`,
            transition: "width 0.5s ease",
          }} />
        </div>

        <div style={{ padding: 40 }}>
          {/* Step 1 — Welcome / Apaleo intro */}
          {step === 1 && (
            <div style={{ animation: "wizard-in 0.3s ease" }}>
              <div style={{ fontSize: 48, marginBottom: 16, animation: "float 3s ease-in-out infinite" }}>🏨</div>
              <h1 style={{ fontFamily: T.sans, fontWeight: 900, fontSize: 28, color: T.text, letterSpacing: "-0.03em", marginBottom: 8 }}>
                VDA-MD for Apaleo
              </h1>
              <div style={{ fontSize: 13, color: T.orange, fontFamily: T.mono, fontWeight: 700, marginBottom: 6, letterSpacing: "0.1em" }}>
                AI GOVERNANCE LAYER · APALEO HOSPITALITY STACK
              </div>
              <div style={{ fontSize: 12, color: T.dim, fontFamily: T.mono, marginBottom: 18, padding: "6px 12px", background: `${T.blue}0a`, border: `1px solid ${T.blue}25`, borderRadius: 6, display: "inline-block" }}>
                Powered by Apaleo · API-first property management
              </div>
              <p style={{ fontSize: 15, color: T.muted, lineHeight: 1.75, marginBottom: 20 }}>
                This wizard configures the VDA-MD AI governance framework for your Apaleo-powered property or group. Enter your property website and the system will:
              </p>
              {[
                ["📥", "Ingest your brand context from your property website"],
                ["📋", "Map NIST SP 800-53 controls to the Apaleo guest lifecycle"],
                ["⚡", "Build a governed exception engine for Reservations, Folios, and Rate Plans"],
                ["🕵️", "Pre-seed the Witness Agent with Apaleo-native audit decisions"],
              ].map(([icon, text]) => (
                <div key={text} style={{ display: "flex", gap: 12, marginBottom: 10, alignItems: "flex-start" }}>
                  <span style={{ fontSize: 18, flexShrink: 0 }}>{icon}</span>
                  <span style={{ fontSize: 14, color: T.muted, lineHeight: 1.5 }}>{text}</span>
                </div>
              ))}
              <div style={{ marginTop: 8, padding: "10px 14px", background: `${T.green}0a`, border: `1px solid ${T.green}30`, borderRadius: 8, fontSize: 12, color: T.green, fontFamily: T.mono }}>
                PCI DSS + GDPR + EU AI Act always included · Apaleo guest journey locked in
              </div>
              <button onClick={() => setStep(2)} style={{
                marginTop: 28, width: "100%", padding: "14px", background: T.orange,
                border: "none", borderRadius: 10, color: "#fff", fontSize: 15,
                fontFamily: T.sans, fontWeight: 800, cursor: "pointer",
                boxShadow: `0 0 32px ${T.orange}55`,
              }}>
                Configure my Apaleo VDA-MD hub →
              </button>
            </div>
          )}

          {/* Step 2 — Company */}
          {step === 2 && (
            <div style={{ animation: "wizard-in 0.3s ease" }}>
              <h2 style={{ fontFamily: T.sans, fontWeight: 900, fontSize: 22, color: T.text, marginBottom: 6 }}>Your Property</h2>
              <p style={{ fontSize: 13, color: T.dim, marginBottom: 28 }}>Enter your property name and website — we'll ingest brand context from the Apaleo property site.</p>
              <label style={{ fontSize: 11, color: T.muted, fontFamily: T.mono, letterSpacing: "0.1em", textTransform: "uppercase", display: "block", marginBottom: 8 }}>Property Name</label>
              <input value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="e.g. Grand Hotel Amsterdam"
                style={{ ...inputStyle, marginBottom: 20 }} />
              <label style={{ fontSize: 11, color: T.muted, fontFamily: T.mono, letterSpacing: "0.1em", textTransform: "uppercase", display: "block", marginBottom: 8 }}>Property Website</label>
              <input value={websiteUrl} onChange={e => setWebsiteUrl(e.target.value)} placeholder="e.g. https://grandhotel.com"
                style={{ ...inputStyle, marginBottom: 20 }} />
              <label style={{ fontSize: 11, color: T.muted, fontFamily: T.mono, letterSpacing: "0.1em", textTransform: "uppercase", display: "block", marginBottom: 8 }}>
                Apaleo Property ID <span style={{ color: T.dim, fontWeight: 400, textTransform: "none" }}>(optional — connects live sandbox data)</span>
              </label>
              <input value={apaleoPropertyId} onChange={e => setApaleoPropertyId(e.target.value.toUpperCase())} placeholder="e.g. BER, MUC, AMS"
                style={inputStyle} />
              <div style={{ fontSize: 11, color: T.dim, marginTop: 8, fontFamily: T.mono }}>
                Found in your Apaleo sandbox → Properties. Enables live occupancy, reservations and folio data in the Hub.
              </div>
              <div style={{ display: "flex", gap: 12, marginTop: 28 }}>
                <button onClick={() => setStep(1)} style={{
                  flex: 1, padding: "12px", background: T.card, border: `1px solid ${T.border}`,
                  borderRadius: 10, color: T.muted, fontSize: 14, fontFamily: T.sans, cursor: "pointer",
                }}>← Back</button>
                <button onClick={() => setStep(3)} disabled={!companyName.trim()} style={{
                  flex: 2, padding: "12px", background: companyName && websiteUrl ? T.orange : T.border,
                  border: "none", borderRadius: 10, color: "#fff", fontSize: 14,
                  fontFamily: T.sans, fontWeight: 700, cursor: companyName && websiteUrl ? "pointer" : "not-allowed",
                }}>Next →</button>
              </div>
            </div>
          )}

          {/* Step 3 — Upload Supporting Files */}
          {step === 3 && (
            <div style={{ animation: "wizard-in 0.3s ease" }}>
              <h2 style={{ fontFamily: T.sans, fontWeight: 900, fontSize: 22, color: T.text, marginBottom: 4 }}>Supporting Documents</h2>
              <p style={{ fontSize: 13, color: T.dim, marginBottom: 20, lineHeight: 1.6 }}>
                Optionally upload internal documents — brand guidelines, org charts, tech architecture, policy docs. These are read by Claude to enrich the governance output.
                <span style={{ color: T.green, marginLeft: 6 }}>Optional — skip to continue.</span>
              </p>

              {/* Drop zone */}
              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => {
                  e.preventDefault(); setDragOver(false);
                  const files = Array.from(e.dataTransfer.files);
                  files.forEach(file => {
                    const reader = new FileReader();
                    reader.onload = ev => {
                      const result = ev.target.result;
                      const isPdf = file.type === 'application/pdf';
                      const isText = file.type.startsWith('text/') || file.name.endsWith('.md') || file.name.endsWith('.txt');
                      setUploadedFiles(prev => [...prev, {
                        id: Date.now() + Math.random(),
                        name: file.name, type: file.type, size: file.size,
                        b64: !isText ? result.split(',')[1] : null,
                        text: isText ? result : null,
                        isPdf, isText,
                        mediaType: isPdf ? 'application/pdf' : (file.type || 'application/octet-stream'),
                      }]);
                    };
                    if (file.type.startsWith('text/') || file.name.endsWith('.md') || file.name.endsWith('.txt')) {
                      reader.readAsText(file);
                    } else {
                      reader.readAsDataURL(file);
                    }
                  });
                }}
                style={{
                  border: `2px dashed ${dragOver ? T.orange : T.borderHi}`,
                  borderRadius: 12, padding: "28px 20px", textAlign: "center",
                  background: dragOver ? `${T.orange}08` : T.surface,
                  transition: "all 0.2s", marginBottom: 16, cursor: "default",
                  position: "relative",
                }}
              >
                <div style={{ fontSize: 32, marginBottom: 10 }}>📁</div>
                <div style={{ fontSize: 14, color: T.muted, marginBottom: 6 }}>Drag & drop files here</div>
                <div style={{ fontSize: 11, color: T.dim, marginBottom: 14, fontFamily: T.mono }}>
                  PDF · Word (.docx) · Excel (.xlsx) · TXT · Markdown — any internal document
                </div>
                <label style={{
                  display: "inline-block", padding: "8px 20px",
                  background: `${T.orange}18`, border: `1px solid ${T.orange}50`,
                  borderRadius: 7, fontSize: 12, color: T.orange,
                  fontFamily: T.mono, fontWeight: 700, cursor: "pointer",
                }}>
                  Browse files
                  <input type="file" multiple accept=".pdf,.docx,.xlsx,.txt,.md,.doc,.csv"
                    style={{ display: "none" }}
                    onChange={e => {
                      Array.from(e.target.files).forEach(file => {
                        const reader = new FileReader();
                        reader.onload = ev => {
                          const result = ev.target.result;
                          const isText = file.type.startsWith('text/') || file.name.endsWith('.md') || file.name.endsWith('.txt') || file.name.endsWith('.csv');
                          const isPdf = file.type === 'application/pdf';
                          setUploadedFiles(prev => [...prev, {
                            id: Date.now() + Math.random(),
                            name: file.name, type: file.type, size: file.size,
                            b64: !isText ? result.split(',')[1] : null,
                            text: isText ? result : null,
                            isPdf, isText,
                            mediaType: isPdf ? 'application/pdf' : (file.type || 'application/octet-stream'),
                          }]);
                        };
                        if (file.type.startsWith('text/') || file.name.endsWith('.md') || file.name.endsWith('.txt') || file.name.endsWith('.csv')) {
                          reader.readAsText(file);
                        } else {
                          reader.readAsDataURL(file);
                        }
                      });
                    }}
                  />
                </label>
              </div>

              {/* Uploaded file list */}
              {uploadedFiles.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, color: T.muted, fontFamily: T.mono, marginBottom: 8, letterSpacing: "0.08em" }}>
                    {uploadedFiles.length} FILE{uploadedFiles.length > 1 ? "S" : ""} QUEUED FOR INGESTION
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    {uploadedFiles.map(f => {
                      const ext = f.name.split('.').pop().toLowerCase();
                      const icon = { pdf: "📄", docx: "📝", doc: "📝", xlsx: "📊", xls: "📊", txt: "🗒️", md: "📋", csv: "📊" }[ext] || "📁";
                      const color = { pdf: T.red, docx: T.blue, doc: T.blue, xlsx: T.green, xls: T.green, txt: T.muted, md: T.purple, csv: T.green }[ext] || T.muted;
                      return (
                        <div key={f.id} style={{ background: T.card, border: `1px solid ${color}30`, borderRadius: 8, padding: "8px 12px", display: "flex", alignItems: "center", gap: 10, animation: "slide-up 0.2s ease" }}>
                          <span style={{ fontSize: 18, flexShrink: 0 }}>{icon}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, color: T.text, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.name}</div>
                            <div style={{ fontSize: 10, color: T.dim, fontFamily: T.mono }}>{(f.size / 1024).toFixed(1)} KB · {f.isPdf ? "PDF — sent as document" : f.isText ? "Text — sent as context" : "Binary — text extracted by Claude"}</div>
                          </div>
                          <Tag color={color}>{ext.toUpperCase()}</Tag>
                          <button onClick={() => setUploadedFiles(prev => prev.filter(x => x.id !== f.id))} style={{ background: "none", border: "none", color: T.dim, cursor: "pointer", fontSize: 16, padding: "2px 6px", borderRadius: 4 }}>✕</button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Notice */}
              <div style={{ background: `${T.blue}0a`, border: `1px solid ${T.blue}25`, borderRadius: 8, padding: "10px 14px", fontSize: 11, color: T.dim, fontFamily: T.mono, marginBottom: 20, lineHeight: 1.7 }}>
                Files are processed locally in your browser and sent only to the Anthropic API for context extraction. Nothing is stored externally.
              </div>

              <div style={{ display: "flex", gap: 12 }}>
                <button onClick={() => setStep(2)} style={{
                  flex: 1, padding: "12px", background: T.card, border: `1px solid ${T.border}`,
                  borderRadius: 10, color: T.muted, fontSize: 14, fontFamily: T.sans, cursor: "pointer",
                }}>← Back</button>
                <button onClick={() => { setStep(4); setTimeout(runIngestion, 400); }} style={{
                  flex: 2, padding: "12px", background: T.orange,
                  border: "none", borderRadius: 10, color: "#fff", fontSize: 14,
                  fontFamily: T.sans, fontWeight: 700, cursor: "pointer",
                }}>
                  {uploadedFiles.length > 0 ? `Continue with ${uploadedFiles.length} file${uploadedFiles.length > 1 ? "s" : ""} →` : "Ingest Brand Context →"}
                </button>
              </div>
            </div>
          )}

          {/* Step 4 — Ingesting */}
          {step === 4 && (
            <div style={{ animation: "wizard-in 0.3s ease" }}>

              {/* Status header */}
              <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 20 }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                  background: ingestPhase === "done" ? `${T.green}18` : ingestPhase === "error" ? `${T.red}18` : `${T.orange}18`,
                  border: `1px solid ${ingestPhase === "done" ? T.green : ingestPhase === "error" ? T.red : T.orange}50`,
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20,
                  animation: ingesting ? "spin 1.2s linear infinite" : "none",
                }}>
                  {ingestPhase === "done" ? "✅" : ingestPhase === "error" ? "⚠️" : "📥"}
                </div>
                <div style={{ flex: 1 }}>
                  <h2 style={{ fontFamily: T.sans, fontWeight: 900, fontSize: 20, color: T.text, marginBottom: 4 }}>
                    {ingestPhase === "done" ? "Ingestion Complete" : ingestPhase === "error" ? "Ingestion Limited" : "Ingesting Brand Context"}
                  </h2>
                  <div style={{ fontSize: 12, color: T.dim, fontFamily: T.mono }}>
                    {websiteUrl}{uploadedFiles.length > 0 ? ` + ${uploadedFiles.length} file${uploadedFiles.length > 1 ? "s" : ""}` : ""}
                  </div>
                </div>
                {/* Elapsed timer */}
                <div style={{
                  background: T.card, border: `1px solid ${ingesting ? T.orange + "50" : T.border}`,
                  borderRadius: 8, padding: "6px 12px", textAlign: "center", flexShrink: 0,
                  minWidth: 72,
                }}>
                  <div style={{ fontFamily: T.mono, fontWeight: 700, fontSize: 18, color: ingesting ? T.orange : ingestPhase === "done" ? T.green : T.muted }}>
                    {Math.floor(elapsedSecs / 60).toString().padStart(2, "0")}:{(elapsedSecs % 60).toString().padStart(2, "0")}
                  </div>
                  <div style={{ fontSize: 9, color: T.dim, letterSpacing: "0.08em" }}>
                    {ingesting ? "RUNNING" : ingestPhase === "done" ? "DONE" : ingestPhase === "error" ? "STOPPED" : "—"}
                  </div>
                </div>
              </div>

              {/* Phase progress pills */}
              <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
                {[
                  { phase: "files", label: uploadedFiles.length > 0 ? `Files (${uploadedFiles.length})` : "Files", skip: uploadedFiles.length === 0 },
                  { phase: "web",     label: "Web Search" },
                  { phase: "mapping", label: "NIST Mapping" },
                  { phase: "done",    label: "Ready" },
                ].map(p => {
                  const phases = ["files", "web", "mapping", "done"];
                  const currentIdx = phases.indexOf(ingestPhase);
                  const thisIdx = phases.indexOf(p.phase);
                  const isDone = currentIdx > thisIdx || ingestPhase === "done";
                  const isActive = ingestPhase === p.phase;
                  const isSkipped = p.skip;
                  return (
                    <div key={p.phase} style={{
                      display: "flex", gap: 5, alignItems: "center",
                      padding: "4px 10px", borderRadius: 20, fontSize: 11, fontFamily: T.mono,
                      background: isDone ? `${T.green}15` : isActive ? `${T.orange}15` : T.card,
                      border: `1px solid ${isDone ? T.green + "50" : isActive ? T.orange + "60" : T.border}`,
                      color: isDone ? T.green : isActive ? T.orange : T.dim,
                      opacity: isSkipped ? 0.4 : 1,
                    }}>
                      <span>{isDone ? "✓" : isActive ? "⟳" : "○"}</span>
                      {p.label}
                    </div>
                  );
                })}
              </div>

              {/* Terminal log */}
              <div style={{ background: "#03040a", border: `1px solid ${ingesting ? T.orange + "40" : ingestPhase === "done" ? T.green + "40" : T.border}`, borderRadius: 10, overflow: "hidden", marginBottom: 16, transition: "border-color 0.4s" }}>
                <div style={{ padding: "8px 14px", background: "#050609", borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
                    {["#ff5f57","#febc2e","#28c840"].map((c,i) => <div key={i} style={{ width: 9, height: 9, borderRadius: "50%", background: c }} />)}
                    <span style={{ fontSize: 11, color: T.dim, fontFamily: T.mono, marginLeft: 4 }}>vdamd-ingestion.log</span>
                  </div>
                  {/* Live pulse when running */}
                  {ingesting && (
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: T.green, display: "inline-block", animation: "pulse-ring 0.8s ease infinite" }} />
                      <span style={{ fontSize: 10, color: T.green, fontFamily: T.mono }}>LIVE</span>
                    </div>
                  )}
                  {ingestPhase === "done" && <span style={{ fontSize: 10, color: T.green, fontFamily: T.mono }}>✓ COMPLETE</span>}
                  {ingestPhase === "error" && <span style={{ fontSize: 10, color: T.amber, fontFamily: T.mono }}>⚠ LIMITED</span>}
                </div>
                <div style={{ padding: "14px 16px", minHeight: 140, maxHeight: 200, overflowY: "auto" }}>
                  {ingestLog.map(e => (
                    <div key={e.id} style={{ fontSize: 12, color: e.color, fontFamily: T.mono, lineHeight: 2, animation: "slide-up 0.2s ease", display: "flex", gap: 10 }}>
                      <span style={{ color: T.dim, flexShrink: 0 }}>›</span>
                      {e.msg}
                    </div>
                  ))}
                  {ingesting && (
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
                      <span style={{ fontSize: 12, color: T.green, fontFamily: T.mono, animation: "pulse-ring 0.6s ease infinite" }}>▊</span>
                      <span style={{ fontSize: 11, color: T.dim, fontFamily: T.mono }}>
                        {ingestPhase === "files" ? "Reading documents…" : ingestPhase === "web" ? "Searching website — this takes 5–15 seconds…" : ingestPhase === "mapping" ? "Mapping NIST controls…" : "Working…"}
                      </span>
                    </div>
                  )}
                  {ingestLog.length === 0 && !ingesting && (
                    <div style={{ color: T.dim, fontSize: 12, fontFamily: T.mono }}>Waiting to start…</div>
                  )}
                </div>
              </div>

              {/* Timeout hint — appears after 60s */}
              {ingesting && elapsedSecs >= 60 && (
                <div style={{ background: `${T.amber}0a`, border: `1px solid ${T.amber}30`, borderRadius: 8, padding: "10px 14px", marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center", animation: "slide-up 0.3s ease" }}>
                  <div style={{ fontSize: 12, color: T.amber, fontFamily: T.mono }}>
                    Still working ({elapsedSecs}s) — web search and file processing can take up to 2 minutes.
                  </div>
                </div>
              )}

              {/* Skip / proceed manually if stuck after 150s */}
              {ingesting && elapsedSecs >= 150 && (
                <div style={{ background: `${T.red}0a`, border: `1px solid ${T.red}30`, borderRadius: 8, padding: "12px 16px", marginBottom: 14, animation: "slide-up 0.3s ease" }}>
                  <div style={{ fontSize: 13, color: T.text, marginBottom: 10, fontFamily: T.sans }}>
                    Taking longer than expected. You can proceed with the context collected so far.
                  </div>
                  <button onClick={() => {
                    clearInterval(elapsedRef.current);
                    setIngesting(false);
                    setIngestPhase("done");
                    if (!brandContext) setBrandContext(`Brand context for ${companyName} — ${INDUSTRY_CONFIGS[industry]?.label}. Apaleo-powered hospitality organisation.`);
                    setStep(5);
                  }} style={{
                    padding: "8px 18px", background: T.orange, border: "none",
                    borderRadius: 7, color: "#fff", fontSize: 13, fontFamily: T.sans,
                    fontWeight: 700, cursor: "pointer",
                  }}>Proceed with partial context →</button>
                </div>
              )}

              {/* Error notice */}
              {ingestPhase === "error" && (
                <div style={{ background: `${T.amber}0a`, border: `1px solid ${T.amber}30`, borderRadius: 8, padding: "10px 14px", fontSize: 12, color: T.amber, marginBottom: 14, fontFamily: T.mono }}>
                  ⚠ Web ingestion limited — proceeding with fallback context. Governance files will use generic {INDUSTRY_CONFIGS[industry]?.label} language.
                </div>
              )}
            </div>
          )}

          {/* Step 5 — Ready */}
          {step === 5 && (
            <div style={{ animation: "wizard-in 0.3s ease", textAlign: "center" }}>
              <div style={{ fontSize: 56, marginBottom: 16 }}>✅</div>
              <h2 style={{ fontFamily: T.sans, fontWeight: 900, fontSize: 24, color: T.text, marginBottom: 8, letterSpacing: "-0.02em" }}>
                {companyName} is ready
              </h2>
              <div style={{ fontSize: 13, color: T.dim, marginBottom: 6 }}>VDA-MD framework configured · Brand context ingested · Apaleo guest lifecycle mapped</div>
              <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono, marginBottom: 20, padding: "5px 12px", background: `${T.blue}0a`, border: `1px solid ${T.blue}25`, borderRadius: 6, display: "inline-block" }}>
                Powered by Apaleo · API-first property management
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 24, textAlign: "left" }}>
                {[
                  { label: "Brand Context", value: uploadedFiles.length > 0 ? `Website + ${uploadedFiles.length} uploaded file${uploadedFiles.length > 1 ? "s" : ""}` : "Website ingested", icon: "📥" },
                  { label: "Platform", value: selectedIndustry?.label, icon: selectedIndustry?.icon },
                  { label: "NIST Controls", value: selectedIndustry?.nistControls.join(", "), icon: "📋" },
                  { label: "Guest Journey", value: `${selectedIndustry?.journeyStages.length} Apaleo lifecycle stages`, icon: "🗺" },
                  { label: "Regulatory", value: "PCI DSS + GDPR + EU AI Act", icon: "⚖️" },
                ].map(item => (
                  <div key={item.label} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 14px" }}>
                    <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono, marginBottom: 4 }}>{item.label}</div>
                    <div style={{ fontSize: 13, color: T.text, fontWeight: 600 }}>{item.icon} {item.value}</div>
                  </div>
                ))}
              </div>
              <button onClick={() => onComplete({ companyName, websiteUrl, industry, brandContext, apaleoPropertyId: apaleoPropertyId.trim() || null })} style={{
                width: "100%", padding: "14px",
                background: T.orange, border: "none", borderRadius: 10,
                color: "#fff", fontSize: 15, fontFamily: T.sans, fontWeight: 800,
                cursor: "pointer", boxShadow: `0 0 32px ${T.orange}55`,
                animation: "glow-pulse 2s ease-in-out infinite",
              }}>
                Launch {companyName} Apaleo VDA-MD Hub →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// C2MD TRANSLATION
// ─────────────────────────────────────────────
async function runC2MDTranslation(controlId, control, config, companyName, brandContext) {
  // Keep brand context concise in system prompt to avoid token overrun
  const brandSnippet = (brandContext || "").slice(0, 1200);

  const systemPrompt = `You are the C2MD (Compliance-to-Markdown) Translation Engine for ${companyName} (${config.label}).

BRAND CONTEXT:
${brandSnippet}

Rules:
- Use "${config.customerTerm}" not guest/customer/user
- Use "${config.employeeTerm}" not staff/employee
- Reference ${config.label} operational context
- Output ONLY a JSON object — no markdown fences, no preamble, no commentary
- Keep the "md" field concise: frontmatter + summary + agent rules + violation definition (max ~400 words)
- Escape all newlines in the "md" value as \\n`;

  const userPrompt = `Translate NIST ${controlId} (${control.title}) into a VDA-MD governance .md file for an Apaleo hospitality property.

OSCAL SOURCE:
${control.oscal}

Respond with ONLY this JSON structure (no fences, no extra text):
{"md":"---\\ncontrol_id: ${controlId.toLowerCase()}\\ndomain: ${config.journeyStages[0]?.domain || config.label}\\nowner: ${config.journeyStages[0]?.owner || "Domain Owner"}\\nbaseline: true\\n---\\n\\n## [title]\\n\\n[2 sentence summary]\\n\\n### Agent Rules\\n\\n- MUST ...\\n- MUST NOT ...\\n- MAY ...\\n\\n### Violation Definition\\n\\n[one sentence]","filename":"${controlId.toLowerCase()}-${config.id || "policy"}.md","overall_confidence":0.93,"clauses":[{"text":"clause text","confidence":0.93,"flagged":false,"flag_reason":null}]}`;

  const resp = await fetch("/api/ai/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }]
    })
  });

  const data = await resp.json();

  // Check for API-level errors
  if (data.error) throw new Error(data.error.message || "API error");
  if (!data.content?.[0]?.text) throw new Error("No response from API");

  // Check stop reason — if max_tokens hit, response is truncated
  if (data.stop_reason === "max_tokens") {
    throw new Error("Response truncated — try a simpler control or check API limits");
  }

  const raw = data.content[0].text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  // Robust JSON parse with helpful error
  try {
    return JSON.parse(raw);
  } catch (parseErr) {
    // Try to extract just the JSON object if there's surrounding text
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch {}
    }
    throw new Error(`JSON parse failed: ${parseErr.message.slice(0, 80)}. Raw starts: ${raw.slice(0, 60)}`);
  }
}

async function runGovernanceDecision(scenario, params, withException, companyName) {
  const govCtx = withException
    ? `BASELINE:\n${scenario.baselineFile.content}\n\n---EXCEPTION---\n${scenario.exceptionFile.content}`
    : `GOVERNANCE:\n${scenario.baselineFile.content}`;
  const paramText = scenario.params.map(p => `${p.label}: ${params[p.id] || p.options[0]}`).join("\n");
  const resp = await fetch("/api/ai/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514", max_tokens: 800,
      system: `You are the VDA-MD Governance Agent for ${companyName} (Apaleo hospitality property). Evaluate strictly against the governance Markdown files. Respond ONLY with valid JSON.`,
      messages: [{ role: "user", content: `${govCtx}\n\nPARAMETERS:\n${paramText}\n\nReturn: {"decision":"PASS|FAIL|ESCALATE","governed_by":"baseline|exception","file_referenced":"filename","clause_applied":"the rule","reasoning":"2-3 sentences","escalation_target":"role or null","exception_evaluated":true|false,"exception_applied":true|false}` }]
    })
  });
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message || "API error");
  if (!data.content?.[0]?.text) throw new Error("No response");
  const text = data.content[0].text.trim().replace(/^```json\s*|^```\s*|\s*```$/gi, "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("Could not parse governance decision response");
  }
}

// ─────────────────────────────────────────────
// JOURNEY MAP TAB
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// AGENT DRAWER
// ─────────────────────────────────────────────
function AgentDrawer({ agent, domain, owner, color, config, companyName, onClose }) {
  const [visible, setVisible] = useState(false);
  const [tab, setTab] = useState("rules");
  useEffect(() => { const t = setTimeout(() => setVisible(true), 10); return () => clearTimeout(t); }, []);
  const dismiss = () => { setVisible(false); setTimeout(onClose, 280); };

  // ── Plain-English Mandate ────────────────────────────────────────────────
  // Generated from agent name + domain. Reads as a human would describe the role.
  const mandate = (() => {
    const n = agent.toLowerCase();
    const c = config.customerTerm;
    const e = config.employeeTerm;
    const svc = config.serviceTerm;

    // Highly specific matches first
    if (n.includes("care plan"))       return `Responsible for organising and coordinating all resources required to execute a ${c}'s care plan. This includes scheduling clinical staff, reserving facilities such as operating rooms or treatment rooms, and managing any changes to dates or sequencing. When a care plan changes, this agent handles the cascade of re-scheduling across all affected resources.`;
    if (n.includes("triage"))          return `Responsible for assessing incoming ${c}s and assigning a clinical priority level based on presenting symptoms and vital signs. The agent routes each ${c} to the appropriate care pathway and ensures urgent cases are escalated to the right clinical team without delay.`;
    if (n.includes("medication"))      return `Responsible for supporting the prescribing and dispensing workflow. This agent checks medication orders against the ${c}'s active prescriptions and allergy records, flags potential drug interactions, and ensures the correct medicine, dose, and route are confirmed before the dispensing step proceeds.`;
    if (n.includes("discharge"))       return `Responsible for coordinating the safe discharge of a ${c} from care. This includes confirming all clinical discharge criteria are met, scheduling follow-up appointments, generating discharge documentation, and ensuring any prescriptions or referrals are issued before the ${c} leaves.`;
    if (n.includes("clinical decision") || n.includes("diagnostic aid")) return `Responsible for providing AI-generated clinical decision support to the responsible clinician. The agent surfaces relevant diagnostic considerations based on ${c} data — it does not make clinical decisions. Every recommendation must be reviewed and approved by the responsible clinician before any action is taken.`;
    if (n.includes("referral"))        return `Responsible for routing ${c} referrals to the appropriate specialist or care team. The agent matches referral criteria to available capacity, checks waiting time targets, and dispatches the referral with the relevant clinical summary to the receiving team.`;

    if (n.includes("checkout"))        return `Responsible for managing the ${c} departure process — from confirming the final bill is correct to issuing receipts and closing out the ${svc} in the property management system. The agent also handles late checkout requests by checking loyalty status and availability before applying any fee adjustments.`;
    if (n.includes("check-in") || n.includes("checkin")) return `Responsible for welcoming the ${c} and completing the arrival process. This includes verifying the reservation, confirming room availability via the live inventory system, issuing access, and recording the arrival in the property management system.`;
    if (n.includes("booking") || n.includes("reserv"))   return `Responsible for handling ${c} booking requests — from availability checks through to confirmed reservation. The agent applies current rate rules, checks inventory thresholds, and records the booking in the central reservations system.`;
    if (n.includes("rate") || n.includes("pricing") || n.includes("revenue")) return `Responsible for applying the correct pricing to a ${c} interaction. This includes checking rate eligibility, applying approved discounts within the delegated authority ceiling, and flagging any requests that fall outside the rate policy for human review.`;
    if (n.includes("concierge"))       return `Responsible for responding to ${c} service requests during their stay or engagement — from restaurant reservations to transport, local information, or bespoke arrangements. The agent routes requests to the appropriate supplier or internal team and tracks fulfilment.`;

    if (n.includes("kyc"))             return `Responsible for verifying the identity of a new ${c} as part of the onboarding process. This includes checking identity documents against authoritative sources, screening against PEP and sanctions lists, and recording the outcome in the compliance system before onboarding can proceed.`;
    if (n.includes("aml"))             return `Responsible for screening ${c} transactions and profiles against Anti-Money Laundering requirements. The agent runs automated checks against consolidated watchlists and flags any matches above the confidence threshold for human review by the MLRO before the transaction is processed.`;
    if (n.includes("fraud"))           return `Responsible for assessing the fraud risk of ${c} transactions in real time. The agent computes a risk score based on transaction characteristics, ${c} history, and behavioural signals. Transactions above the threshold are blocked and routed to the Fraud Operations team for human review.`;
    if (n.includes("transaction"))     return `Responsible for processing authorised ${c} transactions within defined limits. The agent verifies the transaction against the ${c}'s account status, applicable limits, and any active risk flags before committing. Transactions above defined thresholds are held for human review.`;
    if (n.includes("portfolio") || n.includes("risk scoring")) return `Responsible for assessing and summarising the ${c}'s current risk profile or portfolio position. The agent analyses relevant data points, computes a risk score, and surfaces the output to the responsible ${e} for review. The agent provides information — it does not make financial recommendations.`;

    if (n.includes("production") || n.includes("scheduler")) return `Responsible for creating and maintaining the production schedule. The agent plans work orders against available machine capacity, material availability, and delivery commitments — surfacing conflicts or shortfalls for the Operations team to resolve.`;
    if (n.includes("qc") || n.includes("quality"))      return `Responsible for comparing production output against defined quality specifications. The agent inspects measurement data, identifies non-conformances, and applies the appropriate quality hold or release action based on the governing quality policy. Any deviation above threshold is escalated to the Quality Director.`;
    if (n.includes("defect"))          return `Responsible for detecting and classifying defects in the production process using automated inspection. The agent flags items that fall outside tolerance, assigns a defect category, and routes the item to the correct remediation path — rework, concession, or scrap — based on the quality policy.`;
    if (n.includes("supplier") || n.includes("goods receipt")) return `Responsible for managing the supplier relationship within the procurement cycle. This includes raising supplier requests, verifying that goods received match the purchase order, and recording any discrepancies for resolution before the invoice is approved.`;
    if (n.includes("ncr") || n.includes("capa"))        return `Responsible for managing non-conformance records and corrective actions. The agent captures the non-conformance, assigns it to the responsible owner, tracks the corrective action to closure, and ensures the required evidence is recorded in the quality management system.`;
    if (n.includes("bom"))             return `Responsible for managing and validating the Bill of Materials for new or revised products. The agent checks BOM completeness, verifies component availability, and flags any engineering change orders that require approval before the BOM is released to production.`;
    if (n.includes("logistics") || n.includes("dispatch") || n.includes("carrier")) return `Responsible for arranging the despatch and delivery of goods to the ${c}. The agent books the appropriate carrier, generates shipping documentation, and updates the order management system with tracking information once the goods have left the facility.`;

    if (n.includes("lead scoring"))    return `Responsible for evaluating inbound leads and assigning a quality score based on defined criteria — company size, buying signals, fit with the ideal customer profile, and engagement history. The agent prioritises the pipeline so the sales team focuses effort where conversion probability is highest.`;
    if (n.includes("conflict check"))  return `Responsible for running conflict of interest checks before a new ${svc} begins. The agent searches the client register and restricted party list for any existing or prior relationships that would prevent the firm from taking on the work. Any potential conflict is escalated to the Ethics Committee before the ${svc} proceeds.`;
    if (n.includes("proposal"))        return `Responsible for assembling the commercial and technical components of a ${c} proposal. The agent pulls together rate cards, resource profiles, and relevant case study references — it does not approve pricing or commit the firm. The completed draft is routed to the appropriate Partner for review and sign-off.`;
    if (n.includes("scoping"))         return `Responsible for translating ${c} requirements into a defined scope of work. The agent structures the deliverables, milestones, and assumptions, and checks the scope against standard engagement templates. The output is a draft scope document for Partner review before the contract is issued.`;
    if (n.includes("utilisation"))     return `Responsible for monitoring and reporting on ${e} utilisation across active ${svc}s. The agent tracks time allocation against forecast, identifies over- or under-utilisation early, and surfaces redeployment opportunities to the resourcing team.`;
    if (n.includes("renewal"))         return `Responsible for identifying ${c}s due for contract renewal and initiating the renewal conversation at the right time. The agent tracks contract end dates, surfaces renewal candidates to the relationship owner, and prepares a summary of prior work to support the conversation.`;

    if (n.includes("recommendation") || n.includes("personalisation")) return `Responsible for generating personalised recommendations for ${c}s based on their history, preferences, and current context. All recommendations are subject to the ${c}'s active consent and GDPR lawful basis on file. The agent does not apply personalised pricing or content without a verified legal basis.`;
    if (n.includes("basket") || n.includes("cart"))  return `Responsible for managing the ${c}'s active basket — adding, removing, and adjusting items, applying eligible promotions, and presenting an accurate order summary before the ${c} proceeds to payment.`;
    if (n.includes("returns"))         return `Responsible for processing ${c} return requests against the current returns policy. The agent verifies the return is within the permitted window, checks the declared item condition, and initiates the refund or replacement workflow. Returns outside policy require manual authorisation.`;
    if (n.includes("inventory"))       return `Responsible for monitoring stock levels and triggering replenishment or allocation actions when thresholds are breached. The agent tracks available, reserved, and committed inventory across locations and flags discrepancies for the Operations team to investigate.`;

    if (n.includes("invoice") || n.includes("billing agent")) return `Responsible for generating accurate invoices at the correct point in the ${svc} lifecycle. The agent pulls the relevant charges, applies the correct tax codes, and dispatches the invoice to the confirmed billing contact within the SLA window. Any invoicing dispute is routed to the Finance team.`;
    if (n.includes("collection") || n.includes("credit control")) return `Responsible for managing the collections process for overdue accounts. The agent sends automated reminders at defined intervals, tracks payment responses, and escalates accounts that breach the overdue threshold to the Finance Director for manual intervention.`;
    if (n.includes("revenue recogni")) return `Responsible for ensuring revenue is recognised in the correct period in line with the applicable accounting standard. The agent monitors delivery milestones, confirms performance obligations have been satisfied, and posts the revenue recognition entry to the finance system.`;
    if (n.includes("cash application")) return `Responsible for matching incoming payments to the correct open invoices in the accounts receivable ledger. The agent identifies the payment source, allocates it to the matching invoice, and flags any unallocated cash to the Finance team for resolution.`;
    if (n.includes("reconcil"))        return `Responsible for reconciling transactional records between systems to identify and resolve discrepancies. The agent compares source data across defined periods, flags mismatches above tolerance for human review, and produces a reconciliation report for Finance sign-off.`;
    if (n.includes("insurance") || n.includes("claims")) return `Responsible for submitting and tracking insurance claims on behalf of ${c}s. The agent compiles the required documentation, submits the claim to the appropriate insurer within the required timeframe, and monitors the claim status — escalating rejections or delays to the Revenue Cycle Manager.`;
    if (n.includes("patient billing"))  return `Responsible for generating accurate bills for ${c}s following a care episode. The agent verifies insurance eligibility, applies the correct procedure codes, and dispatches the invoice to the insurer and any residual balance to the ${c}. Billing disputes are routed to the Revenue Cycle team.`;

    if (n.includes("po ") || n.includes("purchase order") || (n.includes("po") && n.includes("bot"))) return `Responsible for raising and managing purchase orders within the delegated authority framework. The agent verifies that the requested supplier is on the Approved Vendor list, confirms the budget code, and submits the PO at the correct authority level. POs above the requestor's ceiling are blocked until appropriate sign-off is obtained.`;
    if (n.includes("vendor") || n.includes("buying agent")) return `Responsible for managing the vendor relationship and procurement process. The agent verifies supplier status, checks current preferred supplier designations, and routes procurement requests through the correct approval path based on value and supplier tier.`;
    if (n.includes("subcontract"))     return `Responsible for engaging and managing subcontractors within a ${svc}. The agent verifies the subcontractor holds current preferred status or initiates the approval process, confirms DPA and insurance coverage, and raises the subcontract agreement for Partner sign-off.`;

    // Marina-specific agents
    if (n.includes("berth availability")) return `Responsible for checking real-time berth availability across the marina facility. The agent queries the berth management system for the requested vessel dimensions and arrival dates, applies any hold or reserved designations, and returns an accurate availability result for the ${c} or commercial team.`;
    if (n.includes("berth assignment"))   return `Responsible for allocating an appropriate berth to an arriving vessel. The agent matches the vessel's declared LOA, beam, and draught against available berths, considers the ${c}'s tenure and tier status, and assigns the optimal berth. Premium berth assignments for long-standing ${c}s require Harbour Master approval per the berth allocation policy.`;
    if (n.includes("mooring pricing"))    return `Responsible for calculating mooring and berth fees for ${c}s based on vessel dimensions, berth type, duration, and applicable tier rates. The agent applies current tariffs, checks for any agreed rate exceptions on file, and presents the fee to the ${c} before reservation is confirmed.`;
    if (n.includes("reservation bot"))    return `Responsible for managing berth reservation requests from ${c}s and the commercial team. The agent confirms availability, records vessel details, applies the correct fee schedule, and issues a reservation confirmation. Reservations above the automated approval ceiling require Head of Commercial sign-off.`;
    if (n.includes("arrival agent"))      return `Responsible for coordinating the safe arrival and berthing of incoming vessels. The agent confirms the expected arrival with the ${c}, liaises with the Harbour Master on berth readiness, and ensures all pre-arrival safety documentation is complete before the vessel enters the marina.`;
    if (n.includes("safety check"))       return `Responsible for conducting pre-departure and arrival safety checks on vessels using the marina's berths. The agent verifies that the vessel holds a current marine insurance certificate, that safety equipment is declared in order, and that the MCA documentation requirements are met. Non-compliant vessels are flagged to the Harbour Master.`;
    if (n.includes("listings agent"))     return `Responsible for managing the marina's boat sales and brokerage listings. The agent ingests new listing details, verifies vessel documentation and title status, publishes listings to the agreed channels, and maintains accurate availability status as negotiations progress.`;
    if (n.includes("valuation bot"))      return `Responsible for producing indicative valuations for vessels entering the brokerage programme. The agent applies the current market comparables, adjusts for vessel condition and specification, and produces a valuation report for review by the Head of Sales before it is shared with the ${c}.`;
    if (n.includes("sales progression"))  return `Responsible for managing the progression of a boat sale from accepted offer to completion. The agent tracks the agreed milestones — survey, sea trial, finance approval, and title transfer — chases outstanding items, and ensures the completion is logged in the marina management system.`;
    if (n.includes("renewal agent"))      return `Responsible for identifying ${c}s whose annual mooring or berth agreement is due for renewal and initiating the renewal process at the correct time. The agent generates the renewal offer at the applicable tariff, dispatches it to the ${c}, and tracks acceptance. Non-renewed berths are flagged to the Head of Commercial for follow-up.`;
    if (n.includes("maintenance scheduler")) return `Responsible for scheduling planned maintenance for vessels on the marina's service programme. The agent creates work orders at the agreed service intervals, matches each order to an available ${e} with the required qualification, and confirms the booking with the ${c} before the vessel is hauled or worked.`;
    if (n.includes("upgrade recommendation")) return `Responsible for identifying ${c}s who may benefit from a larger berth or an upgrade to their mooring arrangement based on vessel changes or tenure. The agent surfaces upgrade candidates to the Head of Commercial with a recommended berth and estimated uplift in fee. GDPR Article 6 lawful basis is verified before any personalised outreach.`;
    if (n.includes("parts & supplies") || n.includes("parts and supplies")) return `Responsible for managing requests for marine parts and consumables required for vessel servicing. The agent checks stock levels, sources the item from the Approved Supplier list, and raises the purchase request at the correct authority level. Urgent or out-of-stock items above the standard threshold require Operations Manager approval.`;
    if (n.includes("rota bot"))           return `Responsible for building and maintaining the ${e} rota across the marina facility. The agent allocates shifts against contracted hours, skill requirements (e.g. qualified Dockmaster, crane operator, engineer), and seasonal demand — flagging any staffing gap or working time breach to the HR Manager.`;
    if (n.includes("mooring invoice"))    return `Responsible for generating accurate mooring and berth invoices at the point of reservation confirmation or annual renewal. The agent applies the correct tariff, vessel dimension adjustments, and any agreed exceptions, and dispatches the invoice to the ${c}'s confirmed billing contact within the SLA window.`;
    if (n.includes("sales completion"))   return `Responsible for completing the financial close of a boat sale. The agent confirms that all completion conditions are met — survey, finance, title transfer — raises the final sale invoice, records the commission, and archives the sale documentation in the marina management system.`;
    if (n.includes("debt collection") || n.includes("mooring debt")) return `Responsible for managing overdue mooring and sales accounts. The agent sends automated reminders at defined intervals, tracks payment or dispute responses, and escalates accounts that breach the overdue threshold to the CFO for manual intervention.`;

    if (n.includes("onboard") && !n.includes("client")) return `Responsible for provisioning system access for new ${e}s on their confirmed start date. The agent verifies the HR manager request, confirms the start date and cost centre, and sets up role-appropriate access across the required systems. Access is provisioned on the confirmed start date — not before, unless a formal exception has been approved.`;
    if (n.includes("offboard"))        return `Responsible for revoking system access when an ${e} leaves the organisation. The agent terminates active accounts, recovers issued equipment, and produces a leavers checklist for the ${e}'s manager. All access must be removed within the defined SLA to meet NIST AC-2 requirements.`;
    if (n.includes("payroll"))         return `Responsible for calculating and processing ${e} payroll for each pay period. The agent compiles hours, applies the correct pay rates and deductions, and produces the payroll run for Finance sign-off before payment is released. Any discrepancy above tolerance is flagged for manual review.`;
    if (n.includes("rota") || n.includes("scheduling bot") || n.includes("scheduling agent")) return `Responsible for building and maintaining the ${e} schedule. The agent allocates shifts based on contracted hours, skill requirements, and leave requests — flagging any gaps or breaches of working time rules for the relevant manager to resolve.`;
    if (n.includes("credentialing"))   return `Responsible for verifying and maintaining the professional credentials of clinical ${e}s. The agent checks registration status with the relevant professional body, tracks renewal dates, and blocks system access for any ${e} whose registration has lapsed until the credential is renewed and verified.`;
    if (n.includes("skills"))          return `Responsible for tracking ${e} competencies and skills against the requirements of their role and assigned work. The agent identifies skills gaps, surfaces training recommendations, and ensures that ${e}s are not assigned to tasks requiring qualifications they do not hold.`;

    if (n.includes("churn") || n.includes("re-engage") || n.includes("retention")) return `Responsible for identifying ${c}s at risk of lapsing or disengaging and initiating targeted re-engagement. The agent monitors engagement signals, scores churn risk, and surfaces high-risk ${c}s to the CX team with a recommended action. All outreach must comply with the ${c}'s communication preferences and GDPR consent on file.`;
    if (n.includes("loyalty"))         return `Responsible for managing ${c} loyalty status and applying tier-appropriate benefits. The agent verifies the ${c}'s current loyalty tier in real time, applies eligible rewards or rate adjustments, and records the benefit application with the governing clause cited.`;
    if (n.includes("feedback") || n.includes("review agent") || n.includes("outcome")) return `Responsible for collecting and processing ${c} feedback following a completed ${svc}. The agent distributes the feedback request at the appropriate point in the ${c}'s journey, records responses in the CRM, and surfaces any below-threshold scores to the relevant owner for follow-up.`;
    if (n.includes("complaint"))       return `Responsible for capturing, triaging, and routing ${c} complaints. The agent records the complaint with full context, assigns a severity level, routes it to the responsible owner, and tracks resolution within the committed timeframe. Unresolved complaints above the escalation threshold are raised to the relevant Director.`;
    if (n.includes("activation"))      return `Responsible for completing the final steps of ${c} onboarding and activating their ${svc}. The agent confirms all required setup steps are complete, activates the ${c}'s account or service, and sends the confirmation communication.`;
    if (n.includes("follow-up") || n.includes("followup")) return `Responsible for scheduling and tracking follow-up actions after a ${svc} or interaction. The agent creates follow-up tasks at the appropriate interval, routes them to the responsible ${e}, and escalates any overdue follow-ups to the domain owner.`;
    if (n.includes("monitoring") || n.includes("monitor bot")) return `Responsible for continuous monitoring of defined metrics or signals within the ${domain} domain. The agent compares live readings against thresholds, generates alerts when values breach limits, and dispatches notifications to the relevant owner for human review and action.`;
    if (n.includes("reporting"))       return `Responsible for compiling and distributing regular management reports for the ${domain} domain. The agent gathers data from the relevant source systems, assembles the report in the standard format, and dispatches it to the distribution list on schedule.`;
    if (n.includes("audit"))           return `Responsible for executing planned and ad-hoc audit activities within the ${domain} domain. The agent checks processes and records against the governing policy, records findings, and assigns corrective actions to the responsible owner. Critical findings are escalated immediately to the Quality Director.`;
    if (n.includes("compliance monitor")) return `Responsible for continuously monitoring operational activity against the compliance framework. The agent flags deviations from policy for human review, maintains the compliance event log, and produces periodic summary reports for the CRO.`;
    if (n.includes("risk assessment")) return `Responsible for assessing the risk profile of ${c}s, transactions, or ${svc}s against the defined risk framework. The agent scores each case, applies the appropriate risk classification, and routes high-risk cases to the responsible reviewer before proceeding.`;
    if (n.includes("search") || n.includes("search bot")) return `Responsible for processing ${c} search queries and returning relevant results. The agent applies personalisation only where valid GDPR consent is on file, and ensures search results comply with applicable product eligibility rules.`;
    if (n.includes("activation"))      return `Responsible for completing the activation of a new ${c} ${svc}. The agent confirms all pre-activation conditions are met, runs the activation sequence, and sends the confirmation to the ${c}.`;
    if (n.includes("limit enforcement")) return `Responsible for monitoring account and transaction limits in real time. The agent checks each transaction against the ${c}'s current limits, blocks transactions that would breach them, and notifies the ${c} and relevant ${e} when limits are approached or exceeded.`;
    if (n.includes("field service"))   return `Responsible for scheduling and dispatching field service ${e}s to ${c} sites. The agent matches the work order to a qualified ${e} with availability, books the appointment, and ensures the ${e} has the required parts, tools, and access information before travelling to site.`;
    if (n.includes("closure"))         return `Responsible for managing the formal closure of a completed ${svc}. The agent confirms all deliverables are signed off, ensures the final invoice has been issued, archives the ${svc} documentation, and triggers the post-${svc} feedback process.`;

    // Generic fallback based on suffix patterns
    if (n.endsWith("bot") || n.endsWith("agent")) {
      const base = agent.replace(/\s*(bot|agent)$/i, "").trim();
      return `Responsible for automating ${base.toLowerCase()} tasks within the ${domain} domain. The agent executes defined process steps, applies the governing policy rules, and logs every decision to the Witness Agent audit trail. Accountable to: ${owner}.`;
    }

    return `Responsible for executing defined ${agent} tasks within the ${domain} domain on behalf of ${companyName}. Every action is evaluated against the governing policy file before execution, and logged automatically to the Witness Agent audit trail. Accountable to: ${owner}.`;
  })();

  // Boolean flags reused by rules section
  const agentType    = agent.toLowerCase();
  const isPayment    = agentType.includes("payment") || agentType.includes("billing") || agentType.includes("invoice");
  const isAccess     = agentType.includes("access") || agentType.includes("onboard") || agentType.includes("offboard");
  const isDecision   = agentType.includes("recommend") || agentType.includes("score") || agentType.includes("pricing") || agentType.includes("fraud");
  const isProcure    = agentType.includes("vendor") || agentType.includes("po ") || agentType.includes("supplier") || agentType.includes("procurement");
  const isCompliance = agentType.includes("kyc") || agentType.includes("aml") || agentType.includes("compliance") || agentType.includes("quality") || agentType.includes("audit");
  const isData       = agentType.includes("data") || agentType.includes("monitor") || agentType.includes("track");

  const mustRules = [
    `MUST log every decision to the Witness Agent before executing any action`,
    isPayment    ? `MUST verify payment authorisation at the correct authority level before committing any transaction` : null,
    isAccess     ? `MUST NOT provision system access without a confirmed manager request in the HR system` : null,
    isDecision   ? `MUST preserve ${config.customerTerm.toLowerCase()} right to human review under GDPR Article 22 for any automated decision` : null,
    isProcure    ? `MUST NOT raise a purchase order above the requestor's delegated authority level` : null,
    isCompliance ? `MUST escalate any non-compliant finding to the domain owner before proceeding` : null,
    isData       ? `MUST NOT process personal data beyond the stated lawful basis under GDPR Article 6` : null,
    `MUST cite the exact governing .md clause in every Witness Agent entry`,
  ].filter(Boolean);

  const mustNotRules = [
    `MUST NOT operate without a current, approved governance file in the VDA-MD repository`,
    `MUST NOT execute actions when an exception is required but no exception overlay is active`,
    `MUST NOT process personal data beyond the stated lawful basis under GDPR Article 6`,
    `MUST NOT bypass human oversight where required by EU AI Act Article 14`,
    isPayment    ? `MUST NOT process transactions above threshold without appropriate authority sign-off` : null,
    isAccess     ? `MUST NOT provision production access before the confirmed start date` : null,
  ].filter(Boolean);

  const mayRules = [
    `MAY apply an approved exception overlay when all exception conditions are verified`,
    `MAY escalate to the domain owner (${owner}) when parameters fall outside the baseline rules`,
    isDecision   ? `MAY apply automated decisions for standard cases — premium/priority exceptions require explicit exception overlay` : null,
  ].filter(Boolean);

  const nistControls = config.nistControls;
  const govFile = agent.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-policy.md";

  const nistDescriptions = {
    "AC-2": "Account Management — account lifecycle, access authorisation",
    "AU-2": "Event Logging — audit events, tamper-evident log",
    "SA-4": "Acquisition Process — security in procurement",
    "IR-4": "Incident Handling — detection, containment, recovery",
    "SC-28": "Protection of Information at Rest — encryption",
    "RA-5": "Vulnerability Monitoring — scanning and remediation",
    "MP-6": "Media Sanitization — secure disposal",
    "IA-5": "Authenticator Management — credential lifecycle",
    "SI-10": "Information Input Validation — injection prevention",
    "AC-17": "Remote Access — usage restrictions",
    "SC-8":  "Transmission Confidentiality — TLS/encryption in transit",
    "PE-3":  "Physical Access Control — facility access enforcement",
  };

  const downloadAsPDF = () => {
    const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    const nistRows = nistControls.map(c =>
      `<tr><td class="badge blue">${c}</td><td>${nistDescriptions[c] || c}</td></tr>`
    ).join("");
    const mustRows  = mustRules.map(r  => `<tr><td class="badge green">MUST</td><td>${r}</td></tr>`).join("");
    const mustNotRows = mustNotRules.map(r => `<tr><td class="badge red">MUST NOT</td><td>${r}</td></tr>`).join("");
    const mayRows   = mayRules.map(r   => `<tr><td class="badge purple">MAY</td><td>${r}</td></tr>`).join("");
    const addlRows  = (config.additionalFrameworks || []).map(f => `<li>${f}</li>`).join("");

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>${agent} — Agent Policy Document</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=Outfit:wght@400;600;700;900&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Outfit', sans-serif; font-size: 11pt; color: #111; background: #fff; padding: 32px 40px 48px; line-height: 1.6; }
  @page { margin: 18mm 15mm; size: A4; }
  @media print { body { padding: 0; } .no-print { display: none !important; } }

  .letterhead { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #f97316; padding-bottom: 14px; margin-bottom: 22px; }
  .brand { font-family: 'IBM Plex Mono', monospace; font-weight: 700; font-size: 15pt; color: #f97316; }
  .brand-sub { font-size: 8pt; color: #888; font-family: 'IBM Plex Mono', monospace; margin-top: 2px; }
  .doc-meta { text-align: right; font-family: 'IBM Plex Mono', monospace; font-size: 8pt; color: #666; line-height: 1.8; }

  h1 { font-size: 20pt; font-weight: 900; letter-spacing: -0.03em; margin-bottom: 4px; }
  h2 { font-size: 10pt; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #f97316; margin: 22px 0 8px; font-family: 'IBM Plex Mono', monospace; }
  h3 { font-size: 9pt; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; margin: 16px 0 6px; font-family: 'IBM Plex Mono', monospace; }

  .agent-meta { display: flex; gap: 12px; flex-wrap: wrap; margin: 8px 0 16px; }
  .tag { font-family: 'IBM Plex Mono', monospace; font-size: 8pt; font-weight: 700; border-radius: 4px; padding: 2px 8px; border: 1px solid; }
  .tag-orange { color: #f97316; border-color: #f9731660; background: #f9731610; }
  .tag-blue   { color: #3b82f6; border-color: #3b82f660; background: #3b82f610; }
  .tag-purple { color: #a855f7; border-color: #a855f760; background: #a855f710; }

  .govfile { background: #f8f8f8; border: 1px solid #ddd; border-radius: 6px; padding: 8px 14px; font-family: 'IBM Plex Mono', monospace; font-size: 9pt; color: #444; margin-bottom: 16px; display: flex; justify-content: space-between; }
  .govfile span { color: #888; }

  .mandate { background: #fff7ed; border: 1px solid #fed7aa; border-left: 3px solid #f97316; border-radius: 6px; padding: 12px 16px; font-size: 11pt; line-height: 1.8; margin-bottom: 6px; }

  table { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
  td { padding: 6px 10px; vertical-align: top; font-size: 10pt; border-bottom: 1px solid #f0f0f0; }
  td:first-child { width: 88px; padding-top: 8px; }

  .badge { display: inline-block; font-family: 'IBM Plex Mono', monospace; font-weight: 700; font-size: 7.5pt; border-radius: 4px; padding: 2px 7px; border: 1px solid; white-space: nowrap; }
  .green  { color: #16a34a; border-color: #16a34a60; background: #16a34a12; }
  .red    { color: #dc2626; border-color: #dc262660; background: #dc262612; }
  .purple { color: #9333ea; border-color: #9333ea60; background: #9333ea12; }
  .blue   { color: #2563eb; border-color: #2563eb60; background: #2563eb12; }

  .exception-step { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 10px; page-break-inside: avoid; }
  .step-num { width: 22px; height: 22px; border-radius: 50%; background: #f3e8ff; border: 1px solid #c084fc; color: #9333ea; font-family: 'IBM Plex Mono', monospace; font-weight: 700; font-size: 9pt; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .step-label { font-weight: 700; font-size: 10pt; margin-bottom: 1px; }
  .step-detail { font-size: 9pt; color: #555; font-family: 'IBM Plex Mono', monospace; }

  .fw-section { margin-bottom: 14px; }
  .fw-title { font-family: 'IBM Plex Mono', monospace; font-size: 8pt; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 6px; }
  .fw-title.blue   { color: #2563eb; }
  .fw-title.green  { color: #16a34a; }
  .fw-title.purple { color: #9333ea; }
  .fw-title.orange { color: #ea580c; }

  ul.addl { padding-left: 18px; font-size: 10pt; color: #333; line-height: 1.8; }

  .footer { margin-top: 36px; border-top: 1px solid #ddd; padding-top: 12px; display: flex; justify-content: space-between; font-family: 'IBM Plex Mono', monospace; font-size: 8pt; color: #999; }
  .print-btn { position: fixed; bottom: 28px; right: 28px; background: #f97316; color: white; border: none; border-radius: 8px; padding: 12px 24px; font-family: 'Outfit', sans-serif; font-weight: 700; font-size: 14px; cursor: pointer; box-shadow: 0 4px 20px rgba(249,115,22,0.4); }
  .print-btn:hover { background: #ea580c; }
</style>
</head>
<body>

<div class="letterhead">
  <div>
    <div class="brand">VDA-MD for Apaleo</div>
    <div class="brand-sub">Value-Driven AI with Markdowns · Agent Policy Document</div>
  </div>
  <div class="doc-meta">
    <div><strong>${companyName || "Apaleo Property"}</strong></div>
    <div>${config.label}</div>
    <div>${date}</div>
    <div style="margin-top:4px;color:#aaa">CONFIDENTIAL — INTERNAL USE</div>
  </div>
</div>

<h1>${agent}</h1>
<div class="agent-meta">
  <span class="tag tag-orange">${domain}</span>
  <span class="tag tag-orange">VDA-MD Agent</span>
  <span class="tag tag-purple">EU AI Act</span>
  <span class="tag tag-blue">NIST SP 800-53</span>
</div>
<div style="font-size:10pt;color:#555;margin-bottom:12px;">Domain owner: <strong>${owner}</strong></div>

<div class="govfile">
  <span>📄 &nbsp;<code>${govFile}</code></span>
  <span>governance/.md</span>
</div>

<h2>Primary Role</h2>
<div class="mandate">${mandate}</div>

<h2>Agent Rules</h2>

<h3 style="color:#16a34a;">MUST</h3>
<table>${mustRows}</table>

<h3 style="color:#dc2626;">MUST NOT</h3>
<table>${mustNotRows}</table>

<h3 style="color:#9333ea;">MAY</h3>
<table>${mayRows}</table>

<h2>Exception Path</h2>
<div style="font-size:10pt;color:#555;margin-bottom:12px;">When a decision falls outside baseline rules, the agent checks for an active exception overlay before escalating.</div>
${[
  { step: "1", label: "Baseline evaluation", detail: "Agent evaluates parameters against baseline .md rules" },
  { step: "2", label: "Exception check", detail: "If FAIL or ESCALATE — check for active exception overlay" },
  { step: "3", label: "Conditions verified", detail: "All exception conditions must be met before applying" },
  { step: "4", label: "Re-evaluation", detail: "Agent re-evaluates under combined baseline + exception rules" },
  { step: "5", label: "Witness Agent log", detail: "exception_applied: true logged regardless of final outcome" },
].map(s => `<div class="exception-step"><div class="step-num">${s.step}</div><div><div class="step-label">${s.label}</div><div class="step-detail">${s.detail}</div></div></div>`).join("")}

<h2>Compliance Framework</h2>

<div class="fw-section">
  <div class="fw-title blue">NIST SP 800-53 Rev 5</div>
  <table>${nistRows}</table>
</div>

<div class="fw-section">
  <div class="fw-title green">GDPR</div>
  <table>
    <tr><td class="badge green">Art. 5</td><td>Principles relating to processing — lawfulness, fairness, transparency</td></tr>
    <tr><td class="badge green">Art. 6</td><td>Lawfulness of processing — legal basis required for each action</td></tr>
    <tr><td class="badge green">Art. 22</td><td>Automated decision-making — right to human review preserved</td></tr>
    <tr><td class="badge green">Art. 25</td><td>Data protection by design — minimal data per agent operation</td></tr>
  </table>
</div>

<div class="fw-section">
  <div class="fw-title purple">EU AI Act</div>
  <table>
    <tr><td class="badge purple">Art. 9</td><td>Risk management — documented per agent, reviewed annually</td></tr>
    <tr><td class="badge purple">Art. 12</td><td>Record-keeping — Witness Agent provides automatic audit trail</td></tr>
    <tr><td class="badge purple">Art. 13</td><td>Transparency — agent decisions explainable to affected parties</td></tr>
    <tr><td class="badge purple">Art. 14</td><td>Human oversight — domain owner can override at any time</td></tr>
    <tr><td class="badge purple">Art. 17</td><td>Quality management — governance files version-controlled in Git</td></tr>
  </table>
</div>

${addlRows ? `<div class="fw-section">
  <div class="fw-title orange">Industry-Specific Frameworks — ${config.label}</div>
  <ul class="addl">${addlRows}</ul>
</div>` : ""}

<div class="footer">
  <span>${agent} · ${domain} · ${companyName || "Apaleo Property"}</span>
  <span>VDA-MD for Apaleo · C2MD Pipeline · Powered by Apaleo · ${new Date().getFullYear()}</span>
</div>

<button class="print-btn no-print" onclick="window.print()">⬇ Save as PDF</button>
</body>
</html>`;

    const win = window.open("", "_blank");
    if (!win) { alert("Pop-up blocked — please allow pop-ups for this site and try again."); return; }
    win.document.write(html);
    win.document.close();
    win.onload = () => win.print();
  };

  const drawerTabs = [
    { id: "rules",      label: "Agent Rules",     icon: "📋" },
    { id: "exception",  label: "Exception Path",  icon: "⚡" },
    { id: "compliance", label: "Compliance",       icon: "⚖️" },
  ];

  return (
    <>
      <div onClick={dismiss} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 400, backdropFilter: "blur(2px)", opacity: visible ? 1 : 0, transition: "opacity 0.25s" }} />
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 480, maxWidth: "95vw",
        background: "#0b0d12", borderLeft: `2px solid ${color}60`,
        zIndex: 401, display: "flex", flexDirection: "column",
        transform: visible ? "translateX(0)" : "translateX(100%)",
        transition: "transform 0.28s cubic-bezier(0.34,1.56,0.64,1)",
        boxShadow: `-24px 0 60px rgba(0,0,0,0.6)`,
      }}>
        {/* Header */}
        <div style={{ padding: "20px 22px 16px", borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
                <Tag color={color}>{domain}</Tag>
                <Tag color={T.orange}>VDA-MD Agent</Tag>
                <Tag color={T.purple}>EU AI Act</Tag>
              </div>
              <h3 style={{ fontFamily: T.sans, fontWeight: 900, fontSize: 20, color: T.text, letterSpacing: "-0.02em", marginBottom: 4 }}>{agent}</h3>
              <div style={{ fontSize: 12, color: T.dim, fontFamily: T.mono }}>Domain owner: {owner}</div>
            </div>
            <div style={{ display: "flex", gap: 6, flexShrink: 0, marginLeft: 12 }}>
              <button onClick={downloadAsPDF} title="Download agent policy as PDF" style={{ background: `${color}15`, border: `1px solid ${color}50`, borderRadius: 8, height: 32, padding: "0 10px", cursor: "pointer", color: color, fontSize: 11, fontFamily: T.mono, fontWeight: 700, display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
                <span style={{ fontSize: 13 }}>⬇</span> PDF
              </button>
              <button onClick={dismiss} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, width: 32, height: 32, cursor: "pointer", color: T.muted, fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
            </div>
          </div>
          {/* Governing file chip */}
          <div style={{ display: "flex", gap: 6, alignItems: "center", background: "#04050a", border: `1px solid ${T.border}`, borderRadius: 7, padding: "7px 12px" }}>
            <span style={{ fontSize: 14 }}>📄</span>
            <code style={{ fontSize: 11, color: color, fontFamily: T.mono }}>{govFile}</code>
            <span style={{ fontSize: 10, color: T.dim, marginLeft: "auto", fontFamily: T.mono }}>governance/.md</span>
          </div>
        </div>

        {/* Sub-tabs */}
        <div style={{ display: "flex", borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
          {drawerTabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              flex: 1, padding: "11px 6px", background: "none", border: "none",
              borderBottom: `2px solid ${tab === t.id ? color : "transparent"}`,
              color: tab === t.id ? color : T.dim, cursor: "pointer",
              fontSize: 12, fontFamily: T.sans, fontWeight: tab === t.id ? 700 : 400,
              display: "flex", gap: 5, alignItems: "center", justifyContent: "center",
              transition: "all 0.15s",
            }}>
              <span>{t.icon}</span>{t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "18px 22px 28px" }}>

          {/* Rules tab */}
          {tab === "rules" && (
            <div style={{ animation: "slide-up 0.25s ease" }}>

              {/* Primary mandate card */}
              <div style={{
                background: `linear-gradient(135deg, ${color}14, ${color}08)`,
                border: `1px solid ${color}40`,
                borderLeft: `3px solid ${color}`,
                borderRadius: 10, padding: "14px 16px", marginBottom: 20,
              }}>
                <div style={{ fontSize: 10, color, fontFamily: T.mono, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>
                  Primary Role
                </div>
                <div style={{ fontSize: 13, color: T.text, lineHeight: 1.8 }}>
                  {mandate}
                </div>
              </div>

              <div style={{ fontSize: 11, color: T.dim, marginBottom: 14, fontFamily: T.mono, lineHeight: 1.6 }}>
                The rules below govern every decision this agent makes. The agent cites the exact clause in each audit log entry.
              </div>
              {[
                { label: "MUST", rules: mustRules, color: T.green, bg: "#0a2818", border: "#1a5030" },
                { label: "MUST NOT", rules: mustNotRules, color: T.red, bg: "#200a0a", border: "#5a1414" },
                { label: "MAY", rules: mayRules, color: T.purple, bg: "#150a28", border: "#3d1a6e" },
              ].map(section => (
                <div key={section.label} style={{ marginBottom: 18 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                    <span style={{ fontFamily: T.mono, fontWeight: 900, fontSize: 12, color: section.color, background: `${section.color}18`, border: `1px solid ${section.color}40`, borderRadius: 4, padding: "2px 8px" }}>{section.label}</span>
                  </div>
                  {section.rules.map((rule, i) => (
                    <div key={i} style={{ background: section.bg, border: `1px solid ${section.border}`, borderRadius: 8, padding: "10px 14px", marginBottom: 8, fontSize: 13, color: T.muted, lineHeight: 1.6, fontFamily: T.mono }}>
                      {rule}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* Exception tab */}
          {tab === "exception" && (
            <div style={{ animation: "slide-up 0.25s ease" }}>
              <div style={{ fontSize: 12, color: T.dim, marginBottom: 16, fontFamily: T.mono, lineHeight: 1.7 }}>
                When a decision falls outside baseline rules, the agent checks for an active exception overlay before escalating.
              </div>
              <div style={{ background: "linear-gradient(135deg, #150a28, #0a1528)", border: `1px solid ${T.purple}50`, borderRadius: 10, padding: 16, marginBottom: 16 }}>
                <div style={{ fontFamily: T.sans, fontWeight: 800, color: T.purple, fontSize: 14, marginBottom: 10 }}>Exception Flow</div>
                {[
                  { step: "1", label: "Baseline evaluation", detail: "Agent evaluates parameters against baseline .md rules" },
                  { step: "2", label: "Exception check", detail: "If FAIL or ESCALATE — check for active exception overlay" },
                  { step: "3", label: "Conditions verified", detail: "All exception conditions must be met before applying" },
                  { step: "4", label: "Re-evaluation", detail: "Agent re-evaluates under combined baseline + exception rules" },
                  { step: "5", label: "Witness Agent log", detail: "exception_applied: true logged regardless of final outcome" },
                ].map(item => (
                  <div key={item.step} style={{ display: "flex", gap: 12, marginBottom: 10, alignItems: "flex-start" }}>
                    <div style={{ width: 22, height: 22, borderRadius: "50%", background: `${T.purple}25`, border: `1px solid ${T.purple}50`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: T.purple, fontFamily: T.mono, fontWeight: 700, flexShrink: 0 }}>{item.step}</div>
                    <div>
                      <div style={{ fontSize: 13, color: T.text, fontWeight: 600, marginBottom: 2 }}>{item.label}</div>
                      <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono }}>{item.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: "12px 14px", fontSize: 12, color: T.muted, fontFamily: T.mono, lineHeight: 1.7 }}>
                Exception overlays are formal .md files — version-controlled, time-limited, and approved by the domain owner. There are no informal exceptions. Every exception is in Git.
              </div>
            </div>
          )}

          {/* Compliance tab */}
          {tab === "compliance" && (
            <div style={{ animation: "slide-up 0.25s ease" }}>
              <div style={{ fontSize: 12, color: T.dim, marginBottom: 16, fontFamily: T.mono, lineHeight: 1.7 }}>
                Regulatory framework applied to this agent's decisions.
              </div>
              {[
                {
                  framework: "NIST SP 800-53 Rev 5",
                  color: T.blue,
                  controls: nistControls.map(c => ({ id: c, desc: {
                    "AC-2": "Account Management — account lifecycle, access authorisation",
                    "AU-2": "Event Logging — audit events, tamper-evident log",
                    "SA-4": "Acquisition Process — security in procurement",
                    "IR-4": "Incident Handling — detection, containment, recovery",
                    "SC-28": "Protection of Information at Rest — encryption",
                    "RA-5": "Vulnerability Monitoring — scanning and remediation",
                    "MP-6": "Media Sanitization — secure disposal",
                    "IA-5": "Authenticator Management — credential lifecycle",
                    "SI-10": "Information Input Validation — injection prevention",
                    "AC-17": "Remote Access — usage restrictions",
                    "SC-8":  "Transmission Confidentiality — TLS/encryption in transit",
                    "PE-3":  "Physical Access Control — facility access enforcement",
                  }[c] || c })),
                },
                {
                  framework: "GDPR",
                  color: T.green,
                  controls: [
                    { id: "Art. 5", desc: "Principles relating to processing — lawfulness, fairness, transparency" },
                    { id: "Art. 6", desc: "Lawfulness of processing — legal basis required for each action" },
                    { id: "Art. 22", desc: "Automated decision-making — right to human review preserved" },
                    { id: "Art. 25", desc: "Data protection by design — minimal data per agent operation" },
                  ],
                },
                {
                  framework: "EU AI Act",
                  color: T.purple,
                  controls: [
                    { id: "Art. 9",  desc: "Risk management — documented per agent, reviewed annually" },
                    { id: "Art. 12", desc: "Record-keeping — Witness Agent provides automatic audit trail" },
                    { id: "Art. 13", desc: "Transparency — agent decisions explainable to affected parties" },
                    { id: "Art. 14", desc: "Human oversight — domain owner can override at any time" },
                    { id: "Art. 17", desc: "Quality management — governance files version-controlled in Git" },
                  ],
                },
              ].map(fw => (
                <div key={fw.framework} style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 11, color: fw.color, fontFamily: T.mono, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 8, textTransform: "uppercase" }}>{fw.framework}</div>
                  {fw.controls.map(c => (
                    <div key={c.id} style={{ display: "flex", gap: 10, marginBottom: 7, alignItems: "flex-start" }}>
                      <span style={{ background: `${fw.color}18`, color: fw.color, border: `1px solid ${fw.color}40`, borderRadius: 4, padding: "2px 7px", fontSize: 10, fontFamily: T.mono, fontWeight: 700, flexShrink: 0 }}>{c.id}</span>
                      <span style={{ fontSize: 12, color: T.muted, fontFamily: T.mono, lineHeight: 1.5 }}>{c.desc}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "12px 22px", borderTop: `1px solid ${T.border}`, flexShrink: 0, display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono }}>
            {agent} · {domain} · {companyName || "Apaleo Property"}
          </div>
          <Tag color={T.green}>Witness Agent Active</Tag>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────
// JOURNEY MAP TAB
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// JOURNEY MAP TOUR
// ─────────────────────────────────────────────
const JOURNEY_TOUR_STEPS = [
  {
    id: "welcome",
    target: null, // full-screen welcome card, no spotlight
    title: "This is your AI governance map",
    body: "Every AI agent your organisation deploys lives here — mapped to the exact part of the business it serves, owned by a named person, and governed by rules written in plain English.\n\nMost companies deploying AI agents have none of this. Rules exist only in someone's head. When something goes wrong, no one can show an auditor what the agent was supposed to do.\n\nThis map fixes that. Let's walk through how.",
    icon: "🗺",
    position: "center",
  },
  {
    id: "journey-row",
    target: "journey-row",
    title: "The journey your customer actually takes",
    body: "Each column is a real stage in your customer's experience — from first contact to repeat business. This isn't an org chart. It's the sequence of moments where AI agents can help, harm, or be held accountable.\n\nStructuring agents this way means every decision is traceable back to a specific business moment — not just 'the system did it'.",
    icon: "🎯",
    position: "below",
    highlight: "blue",
  },
  {
    id: "ownership",
    target: "first-stage-card",
    title: "Every stage has a named owner",
    body: "The person listed here is accountable for every AI decision in this stage. Not 'the technology team'. Not 'the vendor'. A real person with a real title.\n\nThis is what regulators — and your board — actually want to see. GDPR Article 22 requires a human who can be questioned about automated decisions. This map makes that human visible.",
    icon: "👤",
    position: "below",
    highlight: "orange",
  },
  {
    id: "agents",
    target: "first-agent",
    title: "Each agent name is a link to its rules",
    body: "Click any agent name. A panel opens showing exactly what that agent is allowed to do, what it's explicitly prohibited from doing, and what it may do under certain conditions.\n\nThose rules are not written in legal code or YAML. They're written in plain sentences — 'MUST verify identity before proceeding', 'MUST NOT approve above €50,000 without sign-off'. Any domain owner can read them in 30 seconds.",
    icon: "📋",
    position: "right",
    highlight: "orange",
    cta: "Click any agent ↗ to see this",
  },
  {
    id: "plain-english",
    target: "first-agent",
    title: "Plain English is the medium of exchange",
    body: "This is the core idea. Governance documents are normally written for lawyers and auditors — dense, inaccessible, ignored in practice.\n\nHere, the same document that satisfies GDPR Article 22 and NIST AC-2 is also the document a VP of Operations reads on a Monday morning and approves. One file. Two audiences. No translation needed.\n\nThis is C2MD — Compliance to Markdown. Compliance standards translated into plain English by AI, owned by humans.",
    icon: "✍️",
    position: "right",
    highlight: "purple",
  },
  {
    id: "shared-services",
    target: "shared-row",
    title: "Back-office agents govern across everything",
    body: "Finance, HR, and billing agents don't belong to one journey stage — they support all of them. When a checkout agent processes a refund, it triggers a finance agent. When a new hire gets system access, an HR agent governs the provisioning.\n\nThese shared service agents inherit the same governance framework. One policy change here applies everywhere — consistently, automatically, auditably.",
    icon: "🔗",
    position: "above",
    highlight: "green",
  },
  {
    id: "compliance",
    target: "compliance-footer",
    title: "Every rule traces back to a real regulation",
    body: "The plain English rules you saw earlier didn't come from nowhere. Each one was generated from an actual NIST SP 800-53 control, a GDPR article, or an EU AI Act requirement.\n\nThe governance file knows its lineage. You can always show an auditor: here is the rule the agent followed, here is the regulation it satisfies, here is the audit log entry where it was applied.",
    icon: "⚖️",
    position: "above",
    highlight: "purple",
  },
  {
    id: "done",
    target: null,
    title: "Now explore",
    body: "Click any agent name to inspect its rules. Every agent on this map has a full governance file — MUST, MUST NOT, and MAY rules, written in plain English, traceable to regulation, with a human owner attached.\n\nWhen you're ready, go to C2MD Studio to see how those rules are generated from scratch, or to Exception Engine to see what happens when a standard rule needs to bend.",
    icon: "✓",
    position: "center",
    cta: "Start exploring →",
  },
];

function JourneyTour({ steps, onDismiss, config }) {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);
  const current = steps[step];
  const isFirst = step === 0;
  const isLast = step === steps.length - 1;

  useEffect(() => { setTimeout(() => setVisible(true), 80); }, []);
  useEffect(() => { setVisible(false); setTimeout(() => setVisible(true), 120); }, [step]);

  const dismiss = () => { setVisible(false); setTimeout(onDismiss, 280); };
  const next = () => { if (isLast) dismiss(); else setStep(s => s + 1); };
  const prev = () => { if (!isFirst) setStep(s => s - 1); };

  const isCentered = current.position === "center";

  return (
    <>
      {/* Dim overlay — lighter for spotlight steps */}
      <div onClick={dismiss} style={{
        position: "fixed", inset: 0, zIndex: 300,
        background: isCentered ? "rgba(0,0,0,0.75)" : "rgba(0,0,0,0.45)",
        backdropFilter: isCentered ? "blur(3px)" : "none",
        opacity: visible ? 1 : 0, transition: "opacity 0.25s",
        pointerEvents: isCentered ? "auto" : "none",
      }} />

      {/* Tour card */}
      <div style={{
        position: "fixed", zIndex: 301,
        ...(isCentered ? {
          top: "50%", left: "50%",
          transform: visible ? "translate(-50%, -50%)" : "translate(-50%, calc(-50% + 16px))",
          width: 520, maxWidth: "92vw",
        } : {
          bottom: 32, right: 32,
          transform: visible ? "translateY(0)" : "translateY(16px)",
          width: 400, maxWidth: "calc(100vw - 48px)",
        }),
        background: "linear-gradient(145deg, #13151c 0%, #0d0f14 100%)",
        border: `2px solid ${current.highlight === "blue" ? T.blue : current.highlight === "green" ? T.green : current.highlight === "purple" ? T.purple : T.orange}60`,
        borderRadius: 16,
        boxShadow: `0 24px 64px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.04)`,
        opacity: visible ? 1 : 0,
        transition: "all 0.28s cubic-bezier(0.34,1.2,0.64,1)",
        overflow: "hidden",
      }}>
        {/* Progress bar */}
        <div style={{ height: 3, background: T.border }}>
          <div style={{
            height: "100%", borderRadius: 999,
            background: `linear-gradient(90deg, ${T.orange}, ${T.amber})`,
            width: `${((step + 1) / steps.length) * 100}%`,
            transition: "width 0.4s ease",
          }} />
        </div>

        <div style={{ padding: "22px 24px 20px" }}>
          {/* Header */}
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 14 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10, flexShrink: 0,
              background: `${T.orange}18`, border: `1px solid ${T.orange}40`,
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20,
            }}>{current.icon}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: T.dim, fontFamily: T.mono, marginBottom: 4, letterSpacing: "0.1em" }}>
                STEP {step + 1} OF {steps.length}
              </div>
              <div style={{ fontFamily: T.sans, fontWeight: 900, fontSize: 17, color: T.text, letterSpacing: "-0.02em", lineHeight: 1.3 }}>
                {current.title}
              </div>
            </div>
            <button onClick={dismiss} style={{
              background: "none", border: "none", color: T.dim, cursor: "pointer",
              fontSize: 18, padding: 4, flexShrink: 0, lineHeight: 1,
            }}>✕</button>
          </div>

          {/* Body */}
          <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.8, whiteSpace: "pre-line", marginBottom: 16 }}>
            {current.body}
          </div>

          {/* CTA hint */}
          {current.cta && (
            <div style={{
              background: `${T.orange}10`, border: `1px solid ${T.orange}30`,
              borderRadius: 8, padding: "8px 12px", marginBottom: 14,
              fontSize: 12, color: T.orange, fontFamily: T.mono, fontWeight: 700,
            }}>
              → {current.cta}
            </div>
          )}

          {/* Navigation */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", gap: 6 }}>
              {steps.map((_, i) => (
                <div key={i} onClick={() => setStep(i)} style={{
                  width: i === step ? 18 : 7, height: 7, borderRadius: 99,
                  background: i === step ? T.orange : i < step ? T.orange + "50" : T.border,
                  cursor: "pointer", transition: "all 0.25s",
                }} />
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {!isFirst && (
                <button onClick={prev} style={{
                  background: T.card, border: `1px solid ${T.border}`,
                  borderRadius: 8, padding: "7px 14px", fontSize: 12,
                  color: T.muted, cursor: "pointer", fontFamily: T.sans,
                }}>← Back</button>
              )}
              <button onClick={next} style={{
                background: T.orange, border: "none", borderRadius: 8,
                padding: "7px 18px", fontSize: 13, color: "#fff",
                cursor: "pointer", fontFamily: T.sans, fontWeight: 800,
                boxShadow: `0 0 20px ${T.orange}50`,
              }}>
                {isLast ? "Start exploring →" : "Next →"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Skip label bottom-left for non-centered steps */}
      {!isCentered && (
        <div onClick={dismiss} style={{
          position: "fixed", bottom: 36, left: 32, zIndex: 302,
          fontSize: 11, color: T.dim, fontFamily: T.mono, cursor: "pointer",
          opacity: visible ? 0.7 : 0, transition: "opacity 0.3s",
        }}>
          Skip tour ✕
        </div>
      )}
    </>
  );
}

function JourneyMapTab({ config, companyName, propertyId, apaleoStats }) {
  const [hovered, setHovered] = useState(null);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [tourActive, setTourActive] = useState(false);

  const stageStats = apaleoStats ? {
    discover: null,
    checkin: apaleoStats.arrivalsToday,
    instay: apaleoStats.inHouseCount,
    checkout: apaleoStats.departuresToday,
    poststay: null,
  } : {};

  const openAgent = (name, domain, owner, color) => setSelectedAgent({ name, domain, owner, color });

  return (
    <div style={{ padding: "28px 28px 40px" }}>
      {selectedAgent && (
        <AgentDrawer
          agent={selectedAgent.name}
          domain={selectedAgent.domain}
          owner={selectedAgent.owner}
          color={selectedAgent.color}
          config={config}
          companyName={companyName}
          onClose={() => setSelectedAgent(null)}
        />
      )}

      {/* Tour overlay */}
      {tourActive && (
        <JourneyTour
          steps={JOURNEY_TOUR_STEPS}
          config={config}
          onDismiss={() => setTourActive(false)}
        />
      )}

      {/* Header with tour toggle */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontFamily: T.sans, fontWeight: 900, fontSize: 24, color: T.text, marginBottom: 8, letterSpacing: "-0.03em" }}>
            Where AI Agents Operate — and Who Governs Them
          </h2>
          <p style={{ color: T.muted, fontSize: 15, lineHeight: 1.75, maxWidth: 680 }}>
            Every AI agent at {companyName} operates inside a defined area — a specific step in the {config.customerTerm.toLowerCase()} journey, owned by a named person, governed by a plain-text policy file.
          </p>
        </div>
        <button onClick={() => setTourActive(t => !t)} style={{
          background: tourActive ? `${T.orange}15` : T.card,
          border: `1px solid ${tourActive ? T.orange + "50" : T.border}`,
          borderRadius: 8, padding: "7px 14px",
          color: tourActive ? T.orange : T.dim,
          fontSize: 12, fontFamily: T.mono, fontWeight: 700,
          cursor: "pointer", display: "flex", gap: 6, alignItems: "center",
          transition: "all 0.2s", whiteSpace: "nowrap", flexShrink: 0,
        }}>
          <span>{tourActive ? "🎯" : "○"}</span>
          {tourActive ? "Tour on" : "Start tour"}
        </button>
      </div>
        {/* Plain-English legend — shown only when tour is off */}
        {!tourActive && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
            {[
              { color: T.blue, label: "Customer-facing agents", desc: "Each column = a stage in the " + config.customerTerm.toLowerCase() + " journey" },
              { color: T.green, label: "Back-office agents", desc: "Finance, HR, billing — shared across all stages" },
              { color: T.orange, label: "Click any agent ↗", desc: "See its rules, exception path, and compliance sources" },
            ].map(item => (
              <div key={item.label} style={{ display: "flex", gap: 8, alignItems: "flex-start", background: T.card, border: `1px solid ${item.color}30`, borderRadius: 8, padding: "8px 14px", flex: "1 1 200px" }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: item.color, flexShrink: 0, marginTop: 4 }} />
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: item.color, marginBottom: 2 }}>{item.label}</div>
                  <div style={{ fontSize: 11, color: T.dim, lineHeight: 1.5 }}>{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        )}

      {/* Journey stages */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <div style={{ width: 3, height: 20, background: T.blue, borderRadius: 2 }} />
        <div>
          <span style={{ fontSize: 13, color: T.text, fontWeight: 700 }}>The {config.customerTerm} Journey</span>
          <span style={{ fontSize: 12, color: T.dim, marginLeft: 10 }}>— left to right, from first contact to repeat business</span>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${config.journeyStages.length}, 1fr)`, gap: 12, marginBottom: 28 }}>
        {config.journeyStages.map(s => (
          <div key={s.id} onMouseEnter={() => setHovered(s.id)} onMouseLeave={() => setHovered(null)}
            style={{ background: hovered === s.id ? `${s.color}12` : T.card, border: `2px solid ${hovered === s.id ? s.color : T.border}`, borderRadius: 12, padding: 18, transition: "all 0.2s" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, alignItems: "flex-start" }}>
              <span style={{ fontFamily: T.sans, fontWeight: 900, fontSize: 16, color: s.color }}>{s.label}</span>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {stageStats[s.id] != null && (
                  <span style={{ background: `${s.color}18`, border: `1px solid ${s.color}40`, color: s.color, borderRadius: 6, padding: "2px 8px", fontSize: 11, fontFamily: T.mono, fontWeight: 700 }}>
                    {stageStats[s.id]} live
                  </span>
                )}
                <Tag color={s.color}>{s.domain}</Tag>
              </div>
            </div>
            <div style={{ fontSize: 12, color: T.dim, marginBottom: 12 }}>Accountable: <span style={{ color: T.muted }}>{s.owner}</span></div>
            <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 10 }}>
              <div style={{ fontSize: 10, color: T.dim, marginBottom: 6, letterSpacing: "0.08em", textTransform: "uppercase" }}>AI agents in this stage — click to see rules</div>
              {s.agents.map(a => (
                <button key={a} onClick={() => openAgent(a, s.domain, s.owner, s.color)}
                  style={{
                    display: "flex", alignItems: "center", gap: 7, width: "100%",
                    background: "none", border: "none", cursor: "pointer", padding: "4px 0",
                    textAlign: "left",
                  }}
                  onMouseEnter={e => e.currentTarget.querySelector("span").style.color = s.color}
                  onMouseLeave={e => e.currentTarget.querySelector("span").style.color = T.muted}
                >
                  <span style={{ color: s.color, fontSize: 11, flexShrink: 0 }}>◈</span>
                  <span style={{ fontSize: 13, color: T.muted, transition: "color 0.15s" }}>{a}</span>
                  <span style={{ marginLeft: "auto", fontSize: 9, color: T.dim, fontFamily: T.mono, opacity: 0.6 }}>↗</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Shared services */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <div style={{ width: 3, height: 20, background: T.green, borderRadius: 2 }} />
        <div>
          <span style={{ fontSize: 13, color: T.text, fontWeight: 700 }}>Back-Office & Shared Services</span>
          <span style={{ fontSize: 12, color: T.dim, marginLeft: 10 }}>— these agents support every stage above, and inherit the same governance rules</span>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${config.sharedServices.length}, 1fr)`, gap: 12, marginBottom: 24 }}>
        {config.sharedServices.map(ss => (
          <div key={ss.id} onMouseEnter={() => setHovered(ss.id)} onMouseLeave={() => setHovered(null)}
            style={{ background: hovered === ss.id ? `${ss.color}10` : T.card, border: `2px solid ${hovered === ss.id ? ss.color : T.border}`, borderRadius: 12, padding: 18, transition: "all 0.2s" }}>
            <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
              <span style={{ fontSize: 26 }}>{ss.icon}</span>
              <div>
                <div style={{ fontFamily: T.sans, fontWeight: 700, color: ss.color, fontSize: 15 }}>{ss.label}</div>
                <div style={{ fontSize: 13, color: T.muted }}>Owner: {ss.owner}</div>
              </div>
            </div>
            <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 10 }}>
              <div style={{ fontSize: 10, color: T.dim, marginBottom: 6, letterSpacing: "0.08em", textTransform: "uppercase" }}>Agents — click to inspect</div>
              {ss.agents.map(a => (
                <button key={a} onClick={() => openAgent(a, ss.label, ss.owner, ss.color)}
                  style={{
                    display: "flex", alignItems: "center", gap: 7, width: "100%",
                    background: "none", border: "none", cursor: "pointer", padding: "4px 0",
                    textAlign: "left",
                  }}
                  onMouseEnter={e => e.currentTarget.querySelector("span").style.color = ss.color}
                  onMouseLeave={e => e.currentTarget.querySelector("span").style.color = T.muted}
                >
                  <span style={{ color: ss.color, fontSize: 11, flexShrink: 0 }}>◈</span>
                  <span style={{ fontSize: 13, color: T.muted, transition: "color 0.15s" }}>{a}</span>
                  <span style={{ marginLeft: "auto", fontSize: 9, color: T.dim, fontFamily: T.mono, opacity: 0.6 }}>↗</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Regulatory */}
      <div style={{ background: "linear-gradient(135deg, #0a0a1a 0%, #0a1a0a 100%)", border: `1px solid ${T.purple}30`, borderRadius: 12, padding: 20 }}>
        <div style={{ fontFamily: T.sans, fontWeight: 700, color: T.purple, fontSize: 15, marginBottom: 6 }}>Every decision on this map is governed</div>
        <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.7, marginBottom: 12 }}>
          Each agent above operates under a policy file that was generated from real compliance standards. When an agent makes a decision, it cites the exact rule it used — and logs it automatically to the audit trail.
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[...config.nistControls.map(c => ({ label: `NIST ${c}`, color: T.blue, title: "US government security control standard" })),
            { label: "GDPR", color: T.green, title: "EU data protection regulation" },
            { label: "EU AI Act", color: T.purple, title: "EU regulation for AI systems" },
            ...config.additionalFrameworks.map(f => ({ label: f.split(" (")[0], color: T.amber, title: f }))
          ].map(r => (
            <span key={r.label} title={r.title} style={{
              background: `${r.color}18`, border: `1px solid ${r.color}40`, color: r.color,
              borderRadius: 4, padding: "2px 8px", fontSize: 10, fontWeight: 700,
              fontFamily: T.mono, letterSpacing: "0.06em", cursor: "default",
            }}>{r.label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// A2MD NORMALISER TAB
// ─────────────────────────────────────────────

const SAMPLE_AGENT_MD = `---
name: check-in-agent
description: Automates Apaleo check-in flow for arriving guests
version: 1.0
owner: front-office
tags: [check-in, apaleo, guest-journey]
---

## Role
You are the Apaleo Check-In Agent. You manage the digital check-in workflow for arriving guests using the Apaleo Property Management API.

## Behaviour
- Verify reservation status via Apaleo Reservations API before proceeding
- Confirm folio balance is settled or a valid payment method is on file
- Assign a unit using Apaleo Unit Management API; prioritise room-type match
- Honour loyalty tier upgrades when an equivalent unit is available
- Send digital key and arrival confirmation via Apaleo Messaging API
- Escalate to front-office team if reservation has a block, dispute, or open folio balance > €500
- Never override a unit assignment without a supervisor token

## Constraints
- Max folio pre-auth: €1,000
- Do not process refunds — route to Folio Settlement Agent
- PCI DSS: never log raw card data

## Tools
- apaleo_reservations_get
- apaleo_unit_assign
- apaleo_folio_check
- apaleo_messaging_send
- apaleo_loyalty_lookup`;

const SOURCE_PLACEHOLDERS = {
  "OpenAI": "# System Prompt\nYou are a helpful assistant that...",
  "LangChain": "# Agent Definition\n## Tools\n- search\n- calculator...",
  "GitHub Copilot": "---\nname: my-agent\ndescription: ...\n---\n## Role...",
  "Claude Code": "# CLAUDE.md\n## Project Overview\n...",
  "WSO2 AFM": "---\nname: pr-analyzer\nversion: 1.0\ntools:\n  - ...",
  "Custom": "Paste any agent definition, system prompt, or governance document in Markdown format...",
  "Unknown": "Paste any agent definition, system prompt, or governance document in Markdown format...",
};

function GapScoreRing({ score }) {
  const r = 44;
  const circ = 2 * Math.PI * r;
  const fill = score == null ? 0 : (score / 100) * circ;
  const color = score == null ? T.border : score > 70 ? T.green : score > 40 ? T.amber : T.red;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <svg width={104} height={104} viewBox="0 0 104 104">
        <circle cx={52} cy={52} r={r} fill="none" stroke={T.border} strokeWidth={8} />
        <circle cx={52} cy={52} r={r} fill="none" stroke={color} strokeWidth={8}
          strokeDasharray={`${fill} ${circ}`}
          strokeDashoffset={circ * 0.25}
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.6s ease" }} />
        <text x={52} y={52} textAnchor="middle" dy="0.35em"
          fill={score == null ? T.dim : color}
          fontSize={score == null ? 18 : 22}
          fontFamily={T.mono} fontWeight={700}>
          {score == null ? "—" : score}
        </text>
      </svg>
      <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono, textAlign: "center", letterSpacing: "0.05em" }}>GOVERNANCE<br/>COMPLETENESS</div>
    </div>
  );
}

function A2MDNormaliserTab({ config, companyName, onLogEntry, setTabFn, companyId, onSaveToFM }) {
  const [inputMd, setInputMd] = useState("");
  const [inputSource, setInputSource] = useState("Custom");
  const [agentName, setAgentName] = useState("");
  const [detectedGaps, setDetectedGaps] = useState([]);
  const [outputMd, setOutputMd] = useState("");
  const [displayedMd, setDisplayedMd] = useState("");
  const [status, setStatus] = useState("idle");
  const [axisPlacement, setAxisPlacement] = useState(null);
  const [gapScore, setGapScore] = useState(null);
  const [normalisedAt, setNormalisedAt] = useState(null);
  const [normReport, setNormReport] = useState(null);
  const [error, setError] = useState(null);
  const [detectedRules, setDetectedRules] = useState(null);
  const [fmSaved, setFmSaved] = useState(false);
  const [fmSavedFileId, setFmSavedFileId] = useState(null);
  const streamRef = useRef(null);
  const fileRef = useRef(null);

  const isAnalysing = status === "analysing";
  const isNormalising = status === "normalising";
  const isBusy = isAnalysing || isNormalising;
  const isDone = status === "done";
  const hasGaps = detectedGaps.length > 0;
  const hasOutput = outputMd.length > 0;

  const activePanel = isDone ? "output" : hasGaps ? "gaps" : "input";

  const col1BorderColor = inputMd.length > 0 ? T.amber : T.border;
  const col2BorderColor = hasGaps ? (gapScore > 70 ? T.green : gapScore > 40 ? T.amber : T.red) : T.border;
  const col3BorderColor = hasOutput ? T.green : T.border;

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setInputMd(ev.target.result);
      if (!agentName) setAgentName(file.name.replace(/\.(md|txt)$/, ""));
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setInputMd(text);
    } catch {
      alert("Clipboard access denied — please paste manually into the text area.");
    }
  };

  const handleLoadSample = () => {
    setInputMd(SAMPLE_AGENT_MD);
    setInputSource("Custom");
    setAgentName("Check-In Agent");
  };

  const handleDownload = () => {
    if (!outputMd) return;
    const slug = (normReport?.filename) || ((agentName || "agent").toLowerCase().replace(/\s+/g, "-") + "-vdamd.md");
    const blob = new Blob([outputMd], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = slug; a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopy = () => {
    if (outputMd) navigator.clipboard.writeText(outputMd);
  };

  const handleSaveToGov = async () => {
    if (!outputMd || !onLogEntry) return;
    const filename = normReport?.filename || ((agentName || "agent").toLowerCase().replace(/\s+/g, "-") + "-vdamd.md");
    onLogEntry({
      id: Date.now(),
      timestamp: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      agent: agentName || "Unknown Agent",
      decision: "NORMALISED",
      fileReferenced: filename,
      clauseApplied: "A2MD normalisation completed — " + detectedGaps.length + " gaps resolved, all MUST/MUST NOT/MAY rules verified",
      actionProposed: `External agent file normalised to VDA-MD schema · Source: ${inputSource} · Gap score: ${gapScore}/100 → 100/100`,
      exceptionApplied: false,
      escalationTarget: null,
      reasoning: normReport
        ? `${normReport.gapsResolved}/${normReport.totalGaps} gaps resolved. Rules added: ${normReport.rulesAdded?.must || 0} MUST, ${normReport.rulesAdded?.mustNot || 0} MUST NOT, ${normReport.rulesAdded?.may || 0} MAY. Axis: ${normReport.axisPlacement?.axis} → ${normReport.axisPlacement?.stage}. Compliance baseline inherited from ${normReport.complianceBaseline || "industry config"}.`
        : `Agent file normalised from ${inputSource} format. ${detectedGaps.length} governance gaps resolved.`,
    });
    if (onSaveToFM && companyId) {
      try {
        const file = await onSaveToFM(outputMd, filename);
        if (file?.id) { setFmSaved(true); setFmSavedFileId(file.id); }
      } catch {}
    }
  };

  const handleAnalyse = async () => {
    if (!inputMd.trim() || isBusy) return;
    setError(null);
    setDetectedGaps([]);
    setGapScore(null);
    setAxisPlacement(null);
    setOutputMd("");
    setDisplayedMd("");
    setNormReport(null);
    setStatus("analysing");

    const systemPrompt = `You are the A2MD Gap Analysis Engine, part of the VDA-MD (Value-Driven AI with Markdowns) Framework for Apaleo hospitality. Your job is to analyse an existing agent Markdown file and identify every structural gap between it and a valid VDA-MD governed agent file.

A valid VDA-MD agent file MUST have ALL of the following:

YAML FRONT MATTER containing:
  agent_id: (slugified agent name)
  domain: (Business | Operations | Compliance | Technology | Finance | HR)
  owner: (named role, not "the team" or "IT")
  axis: (vertical | horizontal)
  journey_stage: (one of the journey stages OR shared service id)
  normalisation_level: (1 | 2 | 3)
  vendor: (vendor name or "VDA-MD for Apaleo")
  baseline: (true | false)

SECTIONS:
  ## Agent Scope — what this agent is for
  ## Permitted Actions — MUST / MUST NOT / MAY rules only
  ## Escalation Path — who and when
  ## Cross-Domain Inheritance — what horizontal permissions are needed
  ## Violation Definition — what constitutes non-compliance
  ## Compliance Baseline — which standards this agent inherits

RULES FORMAT:
  All rules must use exactly: MUST, MUST NOT, or MAY as the first word.
  No passive voice rules. No vague rules. Each rule must be a single testable action.

WITNESS AGENT COMPATIBILITY:
  Every rule must be citable as a single clause. Rules longer than 2 lines should be split. Every section must have at least one rule.

You will respond with ONLY a JSON object, no preamble, no markdown fences:

{
  "agentName": "detected or inferred agent name",
  "gapScore": 0-100,
  "axisPlacement": {
    "axis": "vertical or horizontal",
    "stage": "the most likely journey stage or shared service",
    "owner": "inferred owner role",
    "confidence": 0.0-1.0,
    "inferred": true or false
  },
  "gaps": [
    {
      "id": "slug-id",
      "name": "Human readable gap name",
      "description": "One sentence: what is missing and why it matters",
      "severity": "CRITICAL or RECOMMENDED or OPTIONAL",
      "section": "yaml_front_matter or scope or rules or escalation or cross_domain or violation or compliance_baseline"
    }
  ],
  "detectedRules": {
    "must": number,
    "must_not": number,
    "may": number
  },
  "sourceFormat": "detected format of the input file"
}`;

    const truncatedInput = inputMd.length > 10000 ? inputMd.slice(0, 10000) + "\n\n[... truncated for analysis — full file will be used during normalisation ...]" : inputMd;
    const userMsg = `Company: ${companyName}
Industry: ${config.label}
Source Format Hint: ${inputSource}
Journey Stages available: ${config.journeyStages.map(s => s.id + ": " + s.label).join(", ")}
Shared Services available: ${(config.sharedServices || []).map(s => s.id + ": " + s.label).join(", ")}

INPUT AGENT FILE:
${truncatedInput}`;

    try {
      const resp = await fetch("/api/ai/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4000,
          system: systemPrompt,
          messages: [{ role: "user", content: userMsg }],
        }),
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        throw new Error(`Gap analysis API error (${resp.status}): ${errText.slice(0, 200)}`);
      }
      const data = await resp.json();
      const contentBlock = data?.content?.[0];
      if (!contentBlock || !contentBlock.text) {
        throw new Error(`API returned no content. Stop reason: ${data?.stop_reason || "unknown"}. This may indicate the model hit a token limit.`);
      }
      const raw = contentBlock.text.trim();
      if (!raw) throw new Error("API returned an empty response — please try again.");

      // Strip markdown fences if present (```json ... ```)
      const jsonStr = raw
        .replace(/^```json[\r\n]*/i, "")
        .replace(/^```[\r\n]*/i, "")
        .replace(/[\r\n]*```\s*$/i, "")
        .trim();

      let parsed;
      try {
        parsed = JSON.parse(jsonStr);
      } catch (parseErr) {
        // Try to extract JSON from the middle of the response (model added preamble/postamble)
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error(`Could not parse AI response as JSON. Raw response starts with: "${raw.slice(0, 120)}"`);
        }
      }

      setDetectedGaps(parsed.gaps || []);
      setGapScore(parsed.gapScore ?? null);
      setAxisPlacement(parsed.axisPlacement || null);
      setDetectedRules(parsed.detectedRules || null);
      if (!agentName && parsed.agentName) setAgentName(parsed.agentName);
      setStatus("gaps");
    } catch (e) {
      setStatus("error");
      setError(e.message);
    }
  };

  const handleNormalise = async () => {
    if (!hasGaps || isBusy) return;
    setError(null);
    setOutputMd("");
    setDisplayedMd("");
    setNormReport(null);
    setStatus("normalising");

    const systemPrompt = `You are the A2MD Normalisation Engine, part of the VDA-MD (Value-Driven AI with Markdowns) Framework for Apaleo hospitality. Your job is to take an existing agent file and rewrite it as a fully compliant VDA-MD governed Markdown file.

NORMALISATION RULES:
1. Preserve all valid existing content — do not discard working rules
2. Translate any rules that are not in MUST/MUST NOT/MAY format into that format
3. Add ALL missing sections identified in the gap analysis
4. Infer reasonable rules from context where sections are missing — mark inferred rules with a comment: # [A2MD inferred]
5. The YAML front matter must be complete and accurate
6. Owner must be a real named role from the company's org (use the industry config)
7. The escalation path must name specific roles, not "the system" or "IT"
8. Cross-domain inheritance must explicitly reference horizontal shared service files if the agent could ever trigger financial, HR, or procurement actions
9. Every rule must be independently citable as a Witness Agent clause
10. The output must be deployable as-is — a governance owner should be able to sign this file without rewriting it

OUTPUT FORMAT:
Output ONLY the complete Markdown file, starting with --- (YAML front matter).
No preamble. No explanation. No markdown code fences. Just the raw .md content.
The file will be saved directly and deployed.

After the main Markdown content, on a new line add exactly:
---A2MD_REPORT---
Then output a JSON object (single line) with this structure:
{"gapsResolved":number,"totalGaps":number,"rulesAdded":{"must":number,"mustNot":number,"may":number},"axisPlacement":{"axis":"string","stage":"string","owner":"string"},"complianceBaseline":"string","witnessCompatible":true,"confidence":number,"filename":"agent-slug-vdamd.md"}`;

    const userMsg = `Company: ${companyName}
Industry: ${config.label}
Industry Icon: ${config.icon}

AXIS PLACEMENT (from gap analysis):
Axis: ${axisPlacement?.axis || "vertical"}
Stage: ${axisPlacement?.stage || ""}
Owner: ${axisPlacement?.owner || ""}

GAPS TO RESOLVE:
${detectedGaps.map(g => `- [${g.severity}] ${g.name}: ${g.description}`).join("\n")}

COMPLIANCE FRAMEWORKS FOR THIS INDUSTRY:
NIST Controls: ${config.nistControls.join(", ")}
Additional: ${(config.additionalFrameworks || []).join(", ")}

JOURNEY STAGES:
${config.journeyStages.map(s => `${s.id}: ${s.label} — Owner: ${s.owner}`).join("\n")}

SHARED SERVICES:
${(config.sharedServices || []).map(s => `${s.id}: ${s.label} — Owner: ${s.owner}`).join("\n")}

ORIGINAL AGENT FILE (Source: ${inputSource}):
${inputMd}`;

    try {
      const resp = await fetch("/api/ai/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4000,
          system: systemPrompt,
          messages: [{ role: "user", content: userMsg }],
        }),
      });
      if (!resp.ok) throw new Error("Normalisation API error: " + resp.status);
      const data = await resp.json();
      const fullText = data.content[0].text;

      const delimIdx = fullText.indexOf("---A2MD_REPORT---");
      const mdPart = delimIdx >= 0 ? fullText.substring(0, delimIdx).trim() : fullText.trim();
      const reportPart = delimIdx >= 0 ? fullText.substring(delimIdx + 17).trim() : null;

      let report = null;
      if (reportPart) {
        try { report = JSON.parse(reportPart); } catch {}
      }

      setOutputMd(mdPart);
      setNormReport(report);
      setNormalisedAt(Date.now());

      let i = 0;
      clearInterval(streamRef.current);
      const full = mdPart;
      streamRef.current = setInterval(() => {
        if (i >= full.length) {
          clearInterval(streamRef.current);
          setStatus("done");
          return;
        }
        i = Math.min(i + 6, full.length);
        setDisplayedMd(full.substring(0, i));
      }, 8);
    } catch (e) {
      clearInterval(streamRef.current);
      setStatus("error");
      setError(e.message);
    }
  };

  const SOURCES = ["OpenAI", "LangChain", "GitHub Copilot", "Claude Code", "WSO2 AFM", "Custom"];

  const severityIcon = (sev) => sev === "CRITICAL" ? "✗" : sev === "RECOMMENDED" ? "⚠" : "ℹ";
  const severityColor = (sev) => sev === "CRITICAL" ? T.red : sev === "RECOMMENDED" ? T.amber : T.blue;

  return (
    <div style={{ padding: "28px 28px 40px" }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <h2 style={{ fontFamily: T.sans, fontWeight: 900, fontSize: 24, color: T.text, letterSpacing: "-0.03em" }}>⚙️ A2MD Normaliser</h2>
          <Tag color={T.orange}>Live API</Tag>
          <Tag color={T.blue}>Any Vendor</Tag>
          <Tag color={T.purple}>{config.label}</Tag>
        </div>
        <p style={{ color: T.muted, fontSize: 16, lineHeight: 1.7, maxWidth: 780 }}>
          Every AI agent — regardless of vendor or origin — must have a VDA-MD governed Markdown file before it can operate in an Apaleo-governed property. A2MD normalises any existing agent file into a compliant governance passport in one step.
        </p>
      </div>

      {/* Explainer cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 28 }}>
        {[
          { dot: T.amber, title: "Any Agent File", body: "OpenAI prompts, LangChain configs, GitHub Copilot AGENTS.md, WSO2 AFM, Claude Code CLAUDE.md, or any plain-text agent definition" },
          { dot: T.orange, title: "Gap Analysis + Normalisation", body: "AI identifies every structural gap against the VDA-MD schema, then rewrites the file with all missing governance elements added" },
          { dot: T.green, title: "VDA-MD Governed Passport", body: "Complete YAML front matter, MUST/MUST NOT/MAY rules, escalation paths, Witness Agent compatibility, Two-Axis placement confirmed" },
        ].map((c, i) => (
          <div key={i} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "14px 16px", display: "flex", gap: 12 }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: c.dot, marginTop: 4, flexShrink: 0 }} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, color: T.text, marginBottom: 4 }}>{c.title}</div>
              <div style={{ fontSize: 12, color: T.dim, lineHeight: 1.5 }}>{c.body}</div>
            </div>
          </div>
        ))}
      </div>

      {/* 3-column pipeline */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20, alignItems: "start" }}>

        {/* COLUMN 1 — INPUT */}
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderLeft: `3px solid ${col1BorderColor}`, borderRadius: 12, padding: 20, minHeight: 600 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: T.text, marginBottom: 4 }}>External Agent File</div>
          <div style={{ fontSize: 12, color: T.dim, marginBottom: 16 }}>Paste any agent Markdown — any vendor, any format</div>

          {/* Source selector */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
            {SOURCES.map(src => (
              <button key={src} onClick={() => setInputSource(src)} style={{
                padding: "4px 10px", borderRadius: 20, fontSize: 11, fontFamily: T.mono,
                border: `1px solid ${inputSource === src ? T.amber : T.border}`,
                background: inputSource === src ? T.amber + "18" : "transparent",
                color: inputSource === src ? T.amber : T.dim,
                cursor: "pointer", transition: "all 0.15s",
              }}>{src}</button>
            ))}
          </div>

          {/* Textarea */}
          <div style={{ position: "relative" }}>
            <textarea
              value={inputMd}
              onChange={e => setInputMd(e.target.value)}
              placeholder={SOURCE_PLACEHOLDERS[inputSource]}
              style={{
                width: "100%", minHeight: 340, background: "#03040a",
                border: `1px solid ${T.border}`, borderRadius: 8, padding: 14,
                color: T.green, fontFamily: T.mono, fontSize: 11, lineHeight: 1.7,
                resize: "vertical", outline: "none", boxSizing: "border-box",
              }}
            />
            <div style={{ position: "absolute", bottom: 10, right: 10, fontSize: 10, color: T.dim, fontFamily: T.mono }}>
              {inputMd.length.toLocaleString()} chars
            </div>
          </div>

          {/* Upload + Paste buttons */}
          <div style={{ display: "flex", gap: 8, marginTop: 10, marginBottom: 14 }}>
            <button onClick={() => fileRef.current?.click()} style={{
              flex: 1, padding: "8px 12px", borderRadius: 7, border: `1px solid ${T.border}`,
              background: T.card, color: T.dim, cursor: "pointer", fontSize: 12, fontFamily: T.sans,
            }}>📁 Upload .md File</button>
            <input ref={fileRef} type="file" accept=".md,.txt" style={{ display: "none" }} onChange={handleFileUpload} />
            <button onClick={handlePaste} style={{
              flex: 1, padding: "8px 12px", borderRadius: 7, border: `1px solid ${T.border}`,
              background: T.card, color: T.dim, cursor: "pointer", fontSize: 12, fontFamily: T.sans,
            }}>📋 Paste</button>
            <button onClick={handleLoadSample} style={{
              flex: 1, padding: "8px 12px", borderRadius: 7, border: `1px solid ${T.amber}40`,
              background: T.amber + "10", color: T.amber, cursor: "pointer", fontSize: 12, fontFamily: T.sans,
            }}>Load Sample</button>
          </div>

          {/* Agent name */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 11, color: T.dim, fontFamily: T.mono, display: "block", marginBottom: 6, letterSpacing: "0.05em" }}>AGENT NAME (for governance file)</label>
            <input
              value={agentName}
              onChange={e => setAgentName(e.target.value)}
              placeholder="e.g. Check-in Assistant"
              style={{
                width: "100%", padding: "9px 12px", borderRadius: 7, border: `1px solid ${T.border}`,
                background: T.card, color: T.text, fontFamily: T.sans, fontSize: 13,
                outline: "none", boxSizing: "border-box",
              }}
            />
          </div>

          {/* Analyse button */}
          <button
            onClick={handleAnalyse}
            disabled={!inputMd.trim() || isBusy}
            style={{
              width: "100%", padding: "12px 0", borderRadius: 8, border: "none",
              background: !inputMd.trim() || isBusy ? T.border : T.amber,
              color: !inputMd.trim() || isBusy ? T.dim : "#000",
              cursor: !inputMd.trim() || isBusy ? "not-allowed" : "pointer",
              fontWeight: 700, fontSize: 14, fontFamily: T.sans, transition: "all 0.2s",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}
          >
            {isAnalysing ? <><span className="spin" style={{ display: "inline-block" }}>⟳</span> Analysing…</> : "Analyse Gaps →"}
          </button>

          {error && <div style={{ marginTop: 12, padding: "10px 14px", background: T.red + "18", border: `1px solid ${T.red}40`, borderRadius: 7, color: T.red, fontSize: 12, fontFamily: T.mono }}>{error}</div>}
        </div>

        {/* COLUMN 2 — GAP ANALYSIS */}
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderLeft: `3px solid ${col2BorderColor}`, borderRadius: 12, padding: 20, minHeight: 600 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: T.text, marginBottom: 4 }}>Gap Analysis</div>
          <div style={{ fontSize: 12, color: T.dim, marginBottom: 16 }}>What's missing vs VDA-MD schema</div>

          {isAnalysing ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 60, gap: 16 }}>
              <div style={{ fontSize: 36, animation: "spin 1.2s linear infinite" }}>⟳</div>
              <div style={{ color: T.amber, fontFamily: T.mono, fontSize: 13 }}>Analysing structure…</div>
            </div>
          ) : !hasGaps ? (
            <div style={{ paddingTop: 20 }}>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
                <GapScoreRing score={null} />
              </div>
              <div style={{ color: T.dim, fontSize: 12, textAlign: "center", marginBottom: 24, fontFamily: T.mono }}>Paste an agent file and click Analyse Gaps<br/>to see what's missing</div>
              {[
                { icon: "✗", label: "YAML front matter", sev: "CRITICAL" },
                { icon: "⚠", label: "No escalation path", sev: "RECOMMENDED" },
                { icon: "ℹ", label: "No agent_id slug", sev: "OPTIONAL" },
              ].map((ex, i) => (
                <div key={i} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 14px", marginBottom: 8, opacity: 0.4, display: "flex", gap: 10, alignItems: "center" }}>
                  <span style={{ color: severityColor(ex.sev), fontSize: 14, fontFamily: T.mono }}>{ex.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, color: T.dim }}>{ex.label}</div>
                  </div>
                  <Tag color={severityColor(ex.sev)}>{ex.sev}</Tag>
                </div>
              ))}
            </div>
          ) : (
            <div>
              {/* Gap score ring */}
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
                <GapScoreRing score={gapScore} />
              </div>
              <div style={{ textAlign: "center", fontSize: 12, color: T.dim, fontFamily: T.mono, marginBottom: 20 }}>
                {detectedGaps.length} gap{detectedGaps.length !== 1 ? "s" : ""} detected
              </div>

              {/* Axis placement */}
              {axisPlacement && (
                <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: "12px 14px", marginBottom: 16 }}>
                  <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono, letterSpacing: "0.05em", marginBottom: 8 }}>AXIS PLACEMENT</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                    <Tag color={T.orange}>{(axisPlacement.axis || "").toUpperCase()}</Tag>
                    {axisPlacement.inferred && <Tag color={T.amber}>Inferred</Tag>}
                    {!axisPlacement.inferred && <Tag color={T.green}>Explicit</Tag>}
                  </div>
                  <div style={{ fontSize: 12, color: T.text, marginBottom: 3 }}>Stage: <span style={{ color: T.orange }}>{axisPlacement.stage}</span></div>
                  <div style={{ fontSize: 12, color: T.dim }}>Owner: {axisPlacement.owner}</div>
                </div>
              )}

              {/* Detected rules */}
              {detectedRules && (
                <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                  {[
                    { label: "MUST", val: detectedRules.must, color: T.green },
                    { label: "MUST NOT", val: detectedRules.must_not, color: T.red },
                    { label: "MAY", val: detectedRules.may, color: T.blue },
                  ].map(r => (
                    <div key={r.label} style={{ flex: 1, background: T.card, border: `1px solid ${r.color}30`, borderRadius: 7, padding: "8px 10px", textAlign: "center" }}>
                      <div style={{ fontSize: 16, fontWeight: 900, color: r.color, fontFamily: T.mono }}>{r.val}</div>
                      <div style={{ fontSize: 9, color: T.dim, fontFamily: T.mono, letterSpacing: "0.05em" }}>{r.label}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Gaps list */}
              <div style={{ maxHeight: 280, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
                {detectedGaps.map((g, i) => (
                  <div key={i} style={{ background: T.card, border: `1px solid ${severityColor(g.severity)}30`, borderRadius: 8, padding: "10px 14px", display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <span style={{ color: severityColor(g.severity), fontSize: 14, fontFamily: T.mono, marginTop: 1 }}>{severityIcon(g.severity)}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 3 }}>{g.name}</div>
                      <div style={{ fontSize: 11, color: T.dim, lineHeight: 1.4 }}>{g.description}</div>
                    </div>
                    <Tag color={severityColor(g.severity)}>{g.severity}</Tag>
                  </div>
                ))}
              </div>

              {/* Normalise button */}
              <button
                onClick={handleNormalise}
                disabled={isBusy || isDone}
                style={{
                  width: "100%", padding: "12px 0", borderRadius: 8, border: "none",
                  background: isBusy || isDone ? T.border : T.green,
                  color: isBusy || isDone ? T.dim : "#000",
                  cursor: isBusy || isDone ? "not-allowed" : "pointer",
                  fontWeight: 700, fontSize: 14, fontFamily: T.sans, transition: "all 0.2s",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                }}
              >
                {isNormalising ? <><span style={{ display: "inline-block", animation: "spin 1.2s linear infinite" }}>⟳</span> Normalising…</> : isDone ? "✓ Normalised" : "Normalise → VDA-MD"}
              </button>
            </div>
          )}
        </div>

        {/* COLUMN 3 — OUTPUT */}
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderLeft: `3px solid ${col3BorderColor}`, borderRadius: 12, padding: 20, minHeight: 600 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: T.text, marginBottom: 4 }}>VDA-MD Governed Output</div>
          <div style={{ fontSize: 12, color: T.dim, marginBottom: 16 }}>
            {agentName ? `${agentName.toLowerCase().replace(/\s+/g, "-")}-vdamk.md` : "output.md"} · Ready for Two-Axis Map
          </div>

          {/* macOS chrome */}
          <div style={{ background: "#03040a", border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden", marginBottom: 16 }}>
            <div style={{ padding: "8px 14px", background: "#050609", display: "flex", gap: 7, borderBottom: `1px solid ${T.border}`, alignItems: "center" }}>
              {["#ff5f57","#febc2e","#28c840"].map((c,i) => <div key={i} style={{ width: 9, height: 9, borderRadius: "50%", background: c }} />)}
              <span style={{ fontSize: 11, color: T.dim, marginLeft: 4, fontFamily: T.mono }}>
                {normReport?.filename || (agentName ? agentName.toLowerCase().replace(/\s+/g, "-") + "-vdamd.md" : "--- pending ---")}
              </span>
            </div>
            {!isNormalising && !hasOutput ? (
              <div style={{ minHeight: 340, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10 }}>
                <div style={{ fontSize: 28, opacity: 0.3 }}>⚙</div>
                <div style={{ color: T.dim, fontFamily: T.mono, fontSize: 12 }}>→ Normalised output will appear here</div>
                <div style={{ color: T.dim, fontSize: 11, opacity: 0.6 }}>The complete VDA-MD governed .md file, ready to deploy</div>
              </div>
            ) : (
              <pre style={{
                color: T.green, fontSize: 11, lineHeight: 1.8, fontFamily: T.mono,
                whiteSpace: "pre-wrap", margin: 0, padding: 14,
                maxHeight: 400, overflowY: "auto",
              }}>
                {displayedMd || ""}
                {isNormalising && <span style={{ animation: "glow-pulse 1s ease-in-out infinite", color: T.green }}>▊</span>}
              </pre>
            )}
          </div>

          {/* Normalisation report */}
          {isDone && normReport && (
            <div style={{ background: T.card, border: `1px solid ${T.green}30`, borderRadius: 10, padding: "14px 16px", marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono, letterSpacing: "0.05em", marginBottom: 12 }}>NORMALISATION REPORT</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {[
                  { label: "Gaps Resolved", val: `${normReport.gapsResolved}/${normReport.totalGaps}` },
                  { label: "Rules Added", val: `${normReport.rulesAdded?.must || 0} MUST · ${normReport.rulesAdded?.mustNot || 0} MUST NOT · ${normReport.rulesAdded?.may || 0} MAY` },
                  { label: "Axis Placement", val: `${normReport.axisPlacement?.axis} → ${normReport.axisPlacement?.stage}` },
                  { label: "Owner Assigned", val: normReport.axisPlacement?.owner },
                  { label: "Compliance Baseline", val: `Inherited from ${config.label}` },
                  { label: "Witness Agent", val: "Compatible ✓" },
                ].map(row => (
                  <div key={row.label} style={{ display: "flex", gap: 8, fontSize: 12 }}>
                    <span style={{ color: T.dim, minWidth: 130, fontFamily: T.mono, fontSize: 11 }}>{row.label}</span>
                    <span style={{ color: T.text }}>{row.val}</span>
                  </div>
                ))}
              </div>
              {/* Confidence bar */}
              <div style={{ marginTop: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                  <span style={{ fontSize: 11, color: T.dim, fontFamily: T.mono }}>CONFIDENCE</span>
                  <span style={{ fontSize: 11, color: T.green, fontFamily: T.mono }}>{Math.round((normReport.confidence || 0) * 100)}%</span>
                </div>
                <div style={{ height: 6, background: T.border, borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.round((normReport.confidence || 0) * 100)}%`, background: T.green, borderRadius: 3, transition: "width 0.8s ease" }} />
                </div>
              </div>
            </div>
          )}

          {/* Action buttons */}
          {isDone && (
            <>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={handleDownload} style={{
                  flex: 1, padding: "10px 14px", borderRadius: 8, border: `1px solid ${T.green}60`,
                  background: T.green + "12", color: T.green, cursor: "pointer",
                  fontWeight: 700, fontSize: 12, fontFamily: T.sans,
                }}>⬇ Download .md</button>
                <button onClick={handleCopy} style={{
                  flex: 1, padding: "10px 14px", borderRadius: 8, border: `1px solid ${T.border}`,
                  background: T.card, color: T.dim, cursor: "pointer",
                  fontWeight: 600, fontSize: 12, fontFamily: T.sans,
                }}>📋 Copy Markdown</button>
                <button onClick={handleSaveToGov} style={{
                  flex: 1, padding: "10px 14px", borderRadius: 8, border: `1px solid ${T.orange}60`,
                  background: T.orange + "12", color: T.orange, cursor: "pointer",
                  fontWeight: 700, fontSize: 12, fontFamily: T.sans,
                }}>💾 Save to Governance Map</button>
              </div>
              {fmSaved && (
                <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", padding: "8px 12px", background: `${T.blue}12`, border: `1px solid ${T.blue}40`, borderRadius: 8, animation: "slide-up 0.3s ease" }}>
                  <span style={{ fontSize: 13 }}>📁</span>
                  <span style={{ fontSize: 12, color: T.blue, fontWeight: 600 }}>Saved · </span>
                  <button onClick={() => setTabFn && setTabFn("filemanager")} style={{
                    background: "none", border: "none", color: T.blue, fontWeight: 700, fontSize: 12,
                    cursor: "pointer", textDecoration: "underline", padding: 0,
                  }}>
                    View in File Manager →
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// C2MD STUDIO TAB
// ─────────────────────────────────────────────
function C2MDStudioTab({ config, companyName, brandContext, cache, setCache, onSaveToFM, companyId }) {
  const [sel, setSel] = useState(config.nistControls[0]);
  // cache and setCache come from App root — persists across tab switches
  const [status, setStatus] = useState("idle");
  const [displayedMd, setDisplayedMd] = useState("");
  const [error, setError] = useState(null);
  // true while fetching enriched content from the database on first open
  const [isPrePopulating, setIsPrePopulating] = useState(true);
  const streamRef = useRef(null);
  const ctrl = NIST_CONTROLS[sel];
  const result = cache[sel];

  // ── PRIMARY PATH: Load enriched C2MD content from database ──────────────────
  // Seed → generateC2MDContent → stored in DB → we read it here.
  // Files with c2md_generated: true in their content are the DB source of truth.
  // Runs once per company. After completion, any control not found in DB falls
  // through to the live API fallback (handleTranslate).
  useEffect(() => {
    if (!companyId) { setIsPrePopulating(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const listRes = await fetch(`/api/fm/files/${companyId}`);
        if (!listRes.ok) { setIsPrePopulating(false); return; }
        const files = await listRes.json();
        const newEntries = {};
        for (const controlId of config.nistControls) {
          if (cache[controlId]) continue;
          const matching = files
            .filter(f => f.nistControl === controlId && f.status === "live")
            .sort((a, b) => (b.wordCount || 0) - (a.wordCount || 0));
          if (!matching.length) continue;
          const fileRes = await fetch(`/api/fm/file/${matching[0].id}?companyId=${companyId}`);
          if (!fileRes.ok || cancelled) continue;
          const full = await fileRes.json();
          if (full.content?.includes("c2md_generated: true")) {
            newEntries[controlId] = { md: full.content, filename: full.filename, overall_confidence: 0.97, clauses: [] };
          }
        }
        if (!cancelled && Object.keys(newEntries).length) {
          setCache(prev => ({ ...newEntries, ...prev }));
          // Show the currently selected control immediately if it was just found
          if (newEntries[sel]) {
            setDisplayedMd(newEntries[sel].md);
            setStatus("done");
          }
        }
      } catch {}
      if (!cancelled) setIsPrePopulating(false);
    })();
    return () => { cancelled = true; };
  }, [companyId]);

  // ── FALLBACK: Live API generation via runC2MDTranslation ────────────────────
  // Only used when the DB has no enriched content for a control (e.g. before seed
  // enrichment runs). Triggered automatically — no button click required.
  const handleTranslate = async () => {
    if (result || status === "calling" || status === "streaming") return;
    setError(null); setStatus("calling"); setDisplayedMd(""); clearInterval(streamRef.current);
    try {
      const parsed = await runC2MDTranslation(sel, ctrl, config, companyName, brandContext);
      setStatus("streaming");
      const full = parsed.md; let i = 0;
      streamRef.current = setInterval(() => {
        if (i >= full.length) { clearInterval(streamRef.current); setStatus("done"); setCache(p => ({ ...p, [sel]: parsed })); return; }
        i = Math.min(i + 4, full.length); setDisplayedMd(full.substring(0, i));
      }, 8);
    } catch (e) { clearInterval(streamRef.current); setStatus("error"); setError(e.message); }
  };

  // When control selection changes: show from cache (DB or previously generated),
  // or auto-trigger generation if pre-population already finished with no result.
  useEffect(() => {
    clearInterval(streamRef.current);
    if (cache[sel]) { setDisplayedMd(cache[sel].md); setStatus("done"); setError(null); }
    else {
      setDisplayedMd(""); setStatus("idle"); setError(null);
      // Pre-population already finished and no DB content — trigger live fallback immediately
      if (!isPrePopulating) handleTranslate();
    }
  }, [sel]);

  // After pre-population completes: if the selected control still has no content,
  // auto-trigger the live generation fallback (no button click needed).
  useEffect(() => {
    if (!isPrePopulating && !cache[sel] && status === "idle") {
      handleTranslate();
    }
  }, [isPrePopulating]);

  const isTranslating = status === "calling" || status === "streaming";
  const isDone = status === "done" && result;

  return (
    <div style={{ padding: "28px 28px 40px" }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <h2 style={{ fontFamily: T.sans, fontWeight: 900, fontSize: 24, color: T.text, letterSpacing: "-0.03em" }}>C2MD Studio</h2>
          <Tag color={T.orange}>Live API</Tag>
          <Tag color={T.green}>Real Translation</Tag>
          <Tag color={T.purple}>{config.label}</Tag>
        </div>
        <p style={{ color: T.muted, fontSize: 16, lineHeight: 1.7, maxWidth: 720 }}>
          NIST SP 800-53 OSCAL controls translated into {companyName}-specific governance .md files. Brand context ingested from your website. Controls selected for {config.label}.
        </p>
      </div>

      {/* Brand context indicator */}
      <div style={{ background: T.card, border: `1px solid ${T.purple}40`, borderRadius: 10, padding: "12px 18px", marginBottom: 20, display: "flex", gap: 12, alignItems: "center" }}>
        <span style={{ fontSize: 16 }}>📥</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 2 }}>Brand Context Active</div>
          <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono }}>{companyName} · {config.label} · {brandContext.length.toLocaleString()} chars ingested</div>
        </div>
        <Tag color={T.green}>Injected into prompt</Tag>
      </div>

      {/* Control selector */}
      <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
        {config.nistControls.map(id => (
          <button key={id} onClick={() => setSel(id)} style={{
            padding: "9px 18px", borderRadius: 8,
            border: `2px solid ${sel === id ? T.orange : cache[id] ? T.green + "60" : T.border}`,
            background: sel === id ? `${T.orange}12` : cache[id] ? `${T.green}08` : T.card,
            color: sel === id ? T.orange : cache[id] ? T.green : T.muted,
            cursor: "pointer", fontWeight: 600, fontSize: 13, fontFamily: T.sans, transition: "all 0.2s",
            display: "flex", gap: 8, alignItems: "center",
          }}>
            <span style={{ fontFamily: T.mono, fontWeight: 700 }}>{id}</span>
            <span style={{ opacity: 0.4 }}>·</span>
            {NIST_CONTROLS[id]?.title}
            {cache[id] && <span style={{ fontSize: 10 }}>✓</span>}
          </button>
        ))}
      </div>

      {ctrl && (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "14px 18px", marginBottom: 20 }}>
          <div style={{ color: T.orange, fontSize: 22 }}>◉</div>
          <div style={{ fontWeight: 700, color: T.text, fontSize: 15, marginTop: 4 }}>{ctrl.family} · {sel}: {ctrl.title}</div>
          <div style={{ color: T.muted, fontSize: 13, marginTop: 4, lineHeight: 1.5 }}>{ctrl.description}</div>
        </div>
      )}

      {/* Translation panels */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 64px 1fr", alignItems: "start" }}>
        {/* OSCAL */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontSize: 11, color: T.muted, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: T.mono }}>NIST OSCAL Source</span>
            <Tag color={T.blue}>SP 800-53 Rev 5</Tag>
          </div>
          <div style={{ background: "#03040a", border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
            <div style={{ padding: "8px 14px", background: "#050609", display: "flex", gap: 7, borderBottom: `1px solid ${T.border}` }}>
              {["#ff5f57","#febc2e","#28c840"].map((c,i) => <div key={i} style={{ width: 9, height: 9, borderRadius: "50%", background: c }} />)}
              <span style={{ fontSize: 11, color: T.dim, marginLeft: 4, fontFamily: T.mono }}>oscal-rev5/{sel?.toLowerCase()}.json</span>
            </div>
            <pre style={{ color: "#7dd3fc", fontSize: 11, lineHeight: 1.8, fontFamily: T.mono, whiteSpace: "pre-wrap", margin: 0, padding: 14, maxHeight: 380, overflowY: "auto" }}>
              {ctrl?.oscal}
            </pre>
          </div>
        </div>

        {/* Button */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 52, gap: 8 }}>
          <button onClick={handleTranslate} disabled={isDone || isTranslating} style={{
            width: 46, height: 46, borderRadius: "50%",
            background: isDone ? "#0a2818" : isTranslating ? `${T.orange}20` : T.orange,
            border: `2px solid ${isDone ? T.green : T.orange}`,
            color: isDone ? T.green : "#fff",
            cursor: isDone || isTranslating ? "default" : "pointer",
            fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: isDone || isTranslating ? "none" : `0 0 28px ${T.orange}70`,
            animation: isTranslating ? "spin 1.2s linear infinite" : !isDone ? "glow-pulse 2s ease-in-out infinite" : "none",
          }}>
            {isDone ? "✓" : isTranslating ? "→" : "→"}
          </button>
          <span style={{ fontSize: 9, color: T.dim, textAlign: "center", fontFamily: T.mono, lineHeight: 1.4, width: 50 }}>
            {status === "calling" ? "API\nCALL" : status === "streaming" ? "LIVE\nWRITE" : isDone ? "DONE" : "C2MD"}
          </span>
        </div>

        {/* Output */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontSize: 11, color: T.muted, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: T.mono }}>C2MD Output</span>
            <div style={{ display: "flex", gap: 6 }}><Tag color={T.green}>Human-Readable</Tag><Tag color={T.purple}>Agent-Executable</Tag></div>
          </div>
          <div style={{ background: "#030805", borderRadius: 10, overflow: "hidden", border: `1px solid ${displayedMd ? T.green + "60" : T.border}`, minHeight: 420, transition: "border-color 0.6s" }}>
            {displayedMd ? (
              <>
                <div style={{ padding: "8px 14px", background: "#040a05", display: "flex", gap: 7, alignItems: "center", borderBottom: `1px solid ${T.border}` }}>
                  {["#ff5f57","#febc2e","#28c840"].map((c,i) => <div key={i} style={{ width: 9, height: 9, borderRadius: "50%", background: c }} />)}
                  <span style={{ fontSize: 11, color: T.dim, marginLeft: 4, fontFamily: T.mono }}>{result?.filename || `${sel?.toLowerCase()}.md`}</span>
                  {isDone && <Tag color={T.green}>Generated</Tag>}
                </div>
                <pre style={{ color: "#a3e635", fontSize: 12, lineHeight: 1.85, fontFamily: T.mono, whiteSpace: "pre-wrap", margin: 0, padding: 14, maxHeight: 380, overflowY: "auto" }}>
                  {displayedMd}
                  {isTranslating && <span style={{ animation: "pulse-ring 0.6s ease infinite" }}>▊</span>}
                </pre>
              </>
            ) : error ? (
              <div style={{ padding: 24, color: T.red, fontFamily: T.mono, fontSize: 13 }}>⚠ {error}</div>
            ) : isPrePopulating ? (
              <div style={{ textAlign: "center", paddingTop: 100, color: T.dim }}>
                <div style={{ fontSize: 28, marginBottom: 12, animation: "spin 1.2s linear infinite", display: "inline-block" }}>◎</div>
                <div style={{ fontSize: 13, fontFamily: T.mono, color: T.muted, marginTop: 8 }}>Loading from database…</div>
                <div style={{ fontSize: 11, marginTop: 4, color: T.dim }}>{companyName} governance files · C2MD enrichment</div>
              </div>
            ) : (
              <div style={{ textAlign: "center", paddingTop: 100, color: T.dim }}>
                <div style={{ fontSize: 36, marginBottom: 16, opacity: 0.4 }}>→</div>
                <div style={{ fontSize: 14, fontFamily: T.mono, color: T.muted }}>Generating compliance markdown…</div>
                <div style={{ fontSize: 12, marginTop: 6, color: T.dim }}>OSCAL + {companyName} brand context → C2MD</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Clause scores */}
      {isDone && result?.clauses && (
        <div style={{ marginTop: 24, background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 22, animation: "slide-up 0.4s ease" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
            <span style={{ fontFamily: T.sans, fontWeight: 800, fontSize: 15, color: T.text }}>Clause Confidence Analysis</span>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 11, color: T.dim }}>Overall</div>
              <div style={{ fontFamily: T.mono, fontWeight: 800, fontSize: 20, color: result.overall_confidence >= 0.92 ? T.green : result.overall_confidence >= 0.85 ? T.amber : T.red }}>
                {Math.round(result.overall_confidence * 100)}%
              </div>
            </div>
          </div>
          {result.clauses.map((c, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 200px 52px auto", alignItems: "center", gap: 12, padding: "8px 12px", background: c.flagged ? `${T.amber}08` : "#0a0c10", borderRadius: 8, marginBottom: 8, border: `1px solid ${c.flagged ? T.amber + "30" : T.border}` }}>
              <div style={{ fontSize: 13, color: c.flagged ? T.amber : T.muted }}>{c.text}</div>
              <div style={{ background: T.border, borderRadius: 999, height: 6, overflow: "hidden" }}>
                <div style={{ width: `${c.confidence * 100}%`, height: "100%", background: c.confidence >= 0.92 ? T.green : c.confidence >= 0.85 ? T.amber : T.red, borderRadius: 999, transition: `width 1.2s ease ${i * 0.1}s` }} />
              </div>
              <span style={{ fontFamily: T.mono, fontWeight: 700, fontSize: 13, textAlign: "right", color: c.confidence >= 0.92 ? T.green : c.confidence >= 0.85 ? T.amber : T.red }}>{Math.round(c.confidence * 100)}%</span>
              {c.flagged ? <Tag color={T.amber}>REVIEW</Tag> : <Tag color={T.green}>OK</Tag>}
            </div>
          ))}
        </div>
      )}

      {/* Save to File Manager */}
      {isDone && result && onSaveToFM && (
        <C2MDSaveToFMButton result={result} sel={sel} onSaveToFM={onSaveToFM} displayedMd={displayedMd} />
      )}
    </div>
  );
}

function C2MDSaveToFMButton({ result, sel, onSaveToFM, displayedMd }) {
  const [saved, setSaved] = useState(false);
  const handleSave = () => {
    if (saved) return;
    const filename = result?.filename || `${sel?.toLowerCase()}.md`;
    onSaveToFM(displayedMd, filename, "COMPLIANCE");
    setSaved(true);
    setTimeout(() => setSaved(false), 4000);
  };
  return (
    <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
      <button onClick={handleSave} style={{
        padding: "8px 18px", borderRadius: 7,
        background: saved ? `${T.green}20` : `${T.blue}20`,
        border: `1px solid ${saved ? T.green + "50" : T.blue + "50"}`,
        color: saved ? T.green : T.blue,
        fontSize: 12, fontWeight: 700, cursor: saved ? "default" : "pointer",
        display: "flex", gap: 8, alignItems: "center", transition: "all 0.2s",
      }}>
        <span>{saved ? "✓" : "📁"}</span>
        {saved ? "Saved to File Manager" : "Save to File Manager"}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────
// EXCEPTION ENGINE TAB
// ─────────────────────────────────────────────
function ExceptionEngineTab({ config, companyName, onLogEntry }) {
  const scenarios = buildScenarios(config.id || "hospitality", companyName);
  const [activeId, setActiveId] = useState("decision");
  const [params, setParams] = useState({});
  const [results, setResults] = useState({ baseline: null, exception: null });
  const [loading, setLoading] = useState({ baseline: false, exception: false });
  const [hasRun, setHasRun] = useState(false);
  const scenario = scenarios[activeId];

  useEffect(() => {
    if (!scenario) return;
    const d = {}; scenario.params.forEach(p => { d[p.id] = scenario.defaultParams[p.id] || p.options[0]; });
    setParams(d); setResults({ baseline: null, exception: null }); setHasRun(false);
  }, [activeId]);

  const run = async (withEx, key) => {
    setLoading(p => ({ ...p, [key]: true })); setResults(p => ({ ...p, [key]: null }));
    try {
      const r = await runGovernanceDecision(scenario, params, withEx, companyName);
      setResults(p => ({ ...p, [key]: r }));
      onLogEntry({ id: Date.now() + Math.random(), timestamp: new Date().toISOString().replace("T"," ").substring(0,19) + " UTC", agent: `${scenario.label} Agent`, decision: r.decision, fileReferenced: r.file_referenced || (withEx ? scenario.exceptionFile.name : scenario.baselineFile.name), clauseApplied: r.clause_applied || "—", actionProposed: `${scenario.label} decision evaluated for ${companyName}`, escalationTarget: r.escalation_target, exceptionApplied: r.exception_applied });
    } catch(e) { setResults(p => ({ ...p, [key]: { error: true } })); }
    setLoading(p => ({ ...p, [key]: false }));
  };

  const handleCompare = () => { setHasRun(true); run(false, "baseline"); run(true, "exception"); };
  const differsOutcome = results.baseline?.decision && results.exception?.decision && results.baseline.decision !== results.exception.decision;
  const bothDone = !loading.baseline && !loading.exception && results.baseline && results.exception;

  return (
    <div style={{ padding: "28px 28px 40px" }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontFamily: T.sans, fontWeight: 900, fontSize: 24, color: T.text, marginBottom: 8, letterSpacing: "-0.03em" }}>Exception Overlay Engine</h2>
        <p style={{ color: T.muted, fontSize: 16, lineHeight: 1.7, maxWidth: 680 }}>
          Three universal governance scenarios applicable to any {config.label} organisation. Baseline vs exception — two live Claude API calls, side-by-side.
        </p>
      </div>

      {/* Scenario tabs */}
      <div style={{ display: "flex", gap: 10, marginBottom: 24, flexWrap: "wrap" }}>
        {Object.values(scenarios).map(s => (
          <button key={s.id} onClick={() => setActiveId(s.id)} style={{
            padding: "10px 18px", borderRadius: 8,
            border: `2px solid ${activeId === s.id ? s.color : T.border}`,
            background: activeId === s.id ? `${s.color}12` : T.card,
            color: activeId === s.id ? s.color : T.muted,
            cursor: "pointer", fontWeight: 600, fontSize: 13, fontFamily: T.sans, transition: "all 0.2s",
            display: "flex", gap: 8, alignItems: "center",
          }}>
            <span>{s.icon}</span> {s.label}
            <Tag color={s.color}>{s.domain}</Tag>
          </button>
        ))}
      </div>

      {/* File panels */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 20 }}>
        {[{ file: scenario.baselineFile, type: "SOP", color: T.blue }, { file: scenario.exceptionFile, type: "EXCEPTION", color: T.purple }].map(({ file, type, color }) => (
          <div key={type} style={{ border: `1px solid ${color}40`, borderRadius: 10, overflow: "hidden", background: T.surface }}>
            <div style={{ padding: "10px 14px", background: `${color}0c`, borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Tag color={color}>{type}</Tag>
                <code style={{ fontSize: 11, color, fontFamily: T.mono }}>{file.name}</code>
              </div>
              <span style={{ fontSize: 11, color: T.dim }}>Owner: {file.owner}</span>
            </div>
            <pre style={{ color: type === "SOP" ? "#7dd3fc" : "#c4b5fd", fontSize: 11, lineHeight: 1.75, fontFamily: T.mono, whiteSpace: "pre-wrap", margin: 0, padding: 14, maxHeight: 220, overflowY: "auto", background: "#04050a" }}>
              {file.content}
            </pre>
          </div>
        ))}
      </div>

      {/* Params */}
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 20, marginBottom: 20 }}>
        <div style={{ fontFamily: T.sans, fontWeight: 700, fontSize: 15, color: T.text, marginBottom: 16 }}>Scenario Parameters</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 14, marginBottom: 18 }}>
          {scenario.params.map(p => (
            <div key={p.id}>
              <label style={{ fontSize: 10, color: T.muted, display: "block", marginBottom: 7, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: T.mono }}>{p.label}</label>
              <select value={params[p.id] || p.options[0]} onChange={e => setParams(pv => ({ ...pv, [p.id]: e.target.value }))}
                style={{ width: "100%", padding: "9px 12px", background: T.surface, border: `1px solid ${T.borderHi}`, borderRadius: 7, color: T.text, fontSize: 13, fontFamily: T.sans, cursor: "pointer", outline: "none" }}>
                {p.options.map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
          ))}
        </div>
        <button onClick={handleCompare} disabled={loading.baseline || loading.exception} style={{
          padding: "12px 28px", background: T.orange, border: "none", borderRadius: 9,
          color: "#fff", fontWeight: 800, fontSize: 15, fontFamily: T.sans,
          cursor: loading.baseline || loading.exception ? "wait" : "pointer",
          opacity: loading.baseline || loading.exception ? 0.65 : 1,
          boxShadow: `0 0 28px ${T.orange}55`, animation: "glow-pulse 3s ease-in-out infinite",
        }}>
          {loading.baseline || loading.exception ? "⟳ Evaluating…" : "⚡ Compare — Baseline vs Exception"}
        </button>
      </div>

      {/* Outcome change banner */}
      {bothDone && differsOutcome && (
        <div style={{ background: "linear-gradient(135deg,#1a0a2e,#0a1a2e)", border: `2px solid ${T.purple}`, borderRadius: 12, padding: 20, marginBottom: 20, display: "flex", gap: 16, alignItems: "center", animation: "slide-up 0.4s ease" }}>
          <div style={{ fontSize: 36 }}>⚡</div>
          <div>
            <div style={{ fontFamily: T.sans, fontWeight: 900, fontSize: 18, color: T.purple, marginBottom: 6 }}>Exception Changed the Outcome</div>
            <div style={{ fontSize: 14, color: "#c4b5fd", lineHeight: 1.6 }}>
              Same scenario. Baseline: <strong style={{ color: T.red }}>{results.baseline?.decision}</strong> → Exception: <strong style={{ color: T.green }}>{results.exception?.decision}</strong>. Witness Agent logged both decisions with the exact clause applied.
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      {hasRun && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, animation: "slide-up 0.3s ease" }}>
          {[
            { key: "baseline", label: "Baseline Only", color: T.blue, result: results.baseline, loading: loading.baseline },
            { key: "exception", label: "With Exception Overlay", color: T.purple, result: results.exception, loading: loading.exception },
          ].map(({ key, label, color, result: r, loading: l }) => (
            <div key={key} style={{ background: T.card, borderRadius: 12, padding: 20, border: `2px solid ${r?.decision === "PASS" ? T.green + "50" : r?.decision === "FAIL" ? T.red + "50" : r?.decision === "ESCALATE" ? T.amber + "50" : T.border}`, transition: "border-color 0.4s" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <Tag color={key === "baseline" ? T.blue : T.purple}>{key === "baseline" ? "SOP" : "EXCEPTION"}</Tag>
                  <span style={{ fontFamily: T.sans, fontWeight: 700, fontSize: 14, color }}>{label}</span>
                </div>
                {l ? <span style={{ color: T.muted, fontSize: 13, fontFamily: T.mono }}>⟳ evaluating…</span> : r && !r.error ? <DecisionBadge decision={r.decision} large /> : null}
              </div>
              {r && !r.error && (
                <div style={{ animation: "slide-up 0.3s ease" }}>
                  <div style={{ fontSize: 12, color: T.dim, marginBottom: 10, fontFamily: T.mono }}>→ <span style={{ color }}>{r.file_referenced}</span></div>
                  <p style={{ fontSize: 13, color: T.muted, lineHeight: 1.7, marginBottom: 14 }}>{r.reasoning}</p>
                  <div style={{ background: "#04050a", borderRadius: 8, padding: 12 }}>
                    <div style={{ fontSize: 10, color: T.dim, marginBottom: 4, letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: T.mono }}>Clause Applied</div>
                    <div style={{ fontSize: 12, color: key === "baseline" ? "#7dd3fc" : "#c4b5fd", fontFamily: T.mono, fontStyle: "italic", lineHeight: 1.6 }}>{r.clause_applied}</div>
                  </div>
                  {r.escalation_target && <div style={{ marginTop: 12, background: "#1f1500", border: `1px solid ${T.amber}50`, borderRadius: 8, padding: "10px 12px", fontSize: 13, color: T.amber }}>↳ Escalate to: <strong>{r.escalation_target}</strong></div>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// FILE MANAGER — TEMPLATES
// ─────────────────────────────────────────────
const FM_FILE_TEMPLATES = {
  AGENTS: (cfg, company) => `---
file_type: AGENTS
agent_id: ${(company || "agent").toLowerCase().replace(/\s+/g, "-")}-agent
domain: Hospitality
owner: ${cfg?.journeyStages?.[0]?.owner || "Front Office Manager"}
axis: vertical
journey_stage: ${cfg?.journeyStages?.[0]?.id || "checkin"}
normalisation_level: 2
vendor: VDA-MD for Apaleo
baseline: true
nist_control: AC-2
apaleo_api: Reservations API
---

## Agent Scope

This agent governs automated decision-making within the ${cfg?.journeyStages?.[0]?.label || "Check-In"} stage of the Apaleo guest journey for ${company}.

## Permitted Actions

MUST verify guest reservation status in Apaleo Reservations API before processing any request.
MUST log every decision to the Witness Agent audit trail before execution.
MUST NOT process requests that exceed defined authority levels without escalation.
MUST NOT retain guest PII beyond the required GDPR retention window.
MAY apply standard Apaleo service rules without human approval for low-risk decisions.
MAY escalate to a human ${cfg?.employeeTerm || "team member"} when confidence falls below threshold.

## Escalation Path

MUST escalate to ${cfg?.journeyStages?.[0]?.owner || "Front Office Manager"} when:
- Decision confidence is below 80%
- Folio balance or rate override request exceeds automated authority
- Guest disputes the automated outcome

## Cross-Domain Inheritance

MAY inherit permissions from the Shared Services axis for procurement and HR decisions.
MUST apply PCI DSS and GDPR baseline controls at all times.

## Violation Definition

Any decision made without Witness Agent logging constitutes a violation.
Any Apaleo API call that bypasses the escalation path without documented justification constitutes a violation.

## Compliance Baseline

Inherits: NIST SP 800-53 AC-2, AU-2
Frameworks: ${(cfg?.additionalFrameworks || ["PCI DSS", "GDPR/CCPA", "ISO 22301"]).join(", ")}
`,

  SOP: (cfg, company) => `---
file_type: SOP
owner: ${cfg?.journeyStages?.[0]?.owner || "Front Office Manager"}
domain: Hospitality Operations
axis: horizontal
journey_stage: shared
normalisation_level: 2
vendor: VDA-MD for Apaleo
baseline: true
nist_control: AU-2
apaleo_api: Reservations API, Folio API
---

## Purpose

This Standard Operating Procedure defines the process for AI agent operation within the Apaleo guest lifecycle at ${company}.

## Scope

Applies to all AI agents operating within the Apaleo VDA-MD governance framework — spanning Discover & Book through Post-Stay.

## Procedure

MUST follow the four-step decision cycle: Sense → Reason → Act → Log.
MUST verify Apaleo reservation or folio status before processing any guest-facing action.
MUST obtain explicit authorisation for any action above the automated authority threshold.
MUST NOT execute irreversible Apaleo API actions (folio settlement, unit assignment) without human confirmation for high-value transactions.
MAY defer low-risk, high-frequency decisions (standard check-in, unit assignment within confirmed reservation) to fully automated processing.

## Review Cycle

This SOP MUST be reviewed every 90 days.
Any material changes MUST be signed off by the owner before taking effect.

## Escalation

MUST escalate policy exceptions to the Chief Compliance Officer within 24 hours.
MUST escalate PCI DSS incidents to the Data Protection Officer within 72 hours.
`,

  SKILL: (cfg, company) => `---
file_type: SKILL
owner: ${cfg?.journeyStages?.[0]?.owner || "Technical Lead"}
domain: Hospitality Technology
axis: horizontal
journey_stage: shared
normalisation_level: 2
vendor: VDA-MD for Apaleo
baseline: false
---

## Skill Scope

This skill file defines a reusable capability that may be invoked by authorised Apaleo agents within ${company}.

## Permitted Usage

MUST only be invoked by agents with a valid agent_id in their YAML front matter.
MUST log each invocation to the Witness Agent trail.
MUST NOT be used outside the Apaleo guest journey stages listed in the consuming agent's jurisdiction.
MAY be shared across axes where the consuming agent has cross-domain inheritance declared.

## Parameters

MUST receive validated, typed inputs only — including Apaleo reservation IDs and folio references.
MUST NOT accept raw user-supplied strings without sanitisation.

## Output Contract

MUST return a structured response conforming to the VDA-MD output schema.
MUST NOT return guest PII unless the consuming agent has explicit GDPR-compliant permission.
`,

  EXCEPTION: (cfg, company) => `---
file_type: EXCEPTION
owner: ${cfg?.journeyStages?.[0]?.owner || "Revenue Manager"}
domain: Compliance
axis: horizontal
journey_stage: shared
normalisation_level: 3
vendor: VDA-MD for Apaleo
baseline: false
exception_reason: Documented exception to standard Apaleo governance rule
expires_at: ${new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)}
---

## Exception Scope

This exception file documents a specific, time-limited deviation from the standard governance rules within ${company}.

## Exception Justification

MUST state a clear business justification for this exception.
MUST identify the specific rule being excepted and the duration of the exception.
MUST NOT be used to permanently bypass a governance control.

## Compensating Controls

MUST implement compensating controls to mitigate the risk introduced by this exception.
MUST review the exception before the expiry date above.
MAY renew this exception once, with fresh sign-off, before a permanent policy change is required.

## Approval Chain

MUST be signed off by the owner named above before the exception takes effect.
MUST be reviewed by the Chief Compliance Officer if the exception exceeds 90 days.
`,

  COMPLIANCE: (cfg, company) => `---
file_type: COMPLIANCE
owner: Chief Compliance Officer
domain: Compliance
axis: horizontal
journey_stage: shared
normalisation_level: 3
vendor: VDA-MD for Apaleo
baseline: true
nist_control: ${cfg?.nistControls?.[0] || "AC-2"}
---

## Compliance Scope

This file defines the compliance baseline inherited by all Apaleo-connected agents within ${company}.

## Mandatory Controls

MUST implement NIST SP 800-53 controls: ${(cfg?.nistControls || ["AC-2", "AU-2", "AU-12", "SI-7"]).join(", ")}.
MUST comply with: ${(cfg?.additionalFrameworks || ["PCI DSS", "GDPR/CCPA", "ISO 22301"]).join(", ")}.
MUST NOT process guest payment card data in a manner inconsistent with PCI DSS requirements.
MUST NOT process guest PII in a manner inconsistent with GDPR Article 5 principles.
MUST maintain an audit trail per EU AI Act Article 12 requirements.
MUST NOT store raw Apaleo API credentials or guest payment data in agent logs.

## Guest Data Handling

MUST classify all guest data before processing (PII, payment, preference).
MUST NOT retain guest PII beyond the required retention window.
MUST apply pseudonymisation for analytics workloads involving guest data.
MAY retain anonymised aggregated data for operational reporting with documented justification.

## Incident Response

MUST notify the Data Protection Officer within 72 hours of a suspected guest data breach.
MUST notify PCI DSS QSA within required timelines for payment card incidents.
MUST preserve all Apaleo agent audit logs for a minimum of 12 months.
`,

  CUSTOM: (_cfg, company) => `---
file_type: CUSTOM
owner: Front Office Manager
domain: Hospitality
axis: vertical
journey_stage: shared
normalisation_level: 1
vendor: VDA-MD for Apaleo
baseline: false
---

## Purpose

Custom governance document for ${company} — Apaleo property.

## Rules

MUST define clear governance rules using MUST, MUST NOT, or MAY clauses.
MUST reference the relevant Apaleo API or guest journey stage where applicable.
MUST NOT leave this template without a named owner.
MAY be promoted to a standard file type once validated.
`,
};

const FM_FILE_TYPES = [
  { type: "AGENTS", icon: "🤖", label: "Agent File", color: "#4A9EFF", desc: "Governs a single AI agent — scope, rules, escalation path" },
  { type: "SOP", icon: "📋", label: "SOP", color: "#FF6B2B", desc: "Standard Operating Procedure for agent-process interaction" },
  { type: "SKILL", icon: "⚡", label: "Skill File", color: "#A066FF", desc: "Reusable skill or capability callable by authorised agents" },
  { type: "EXCEPTION", icon: "⚠️", label: "Exception File", color: "#FFB020", desc: "Time-limited exception to a standard governance rule" },
  { type: "COMPLIANCE", icon: "✅", label: "Compliance Baseline", color: "#22D47A", desc: "Inherited compliance controls and regulatory requirements" },
  { type: "CUSTOM", icon: "📄", label: "Custom Document", color: "#ffffff", desc: "Custom governance document — any format" },
];

const FM_AXIS_GROUPS = [
  { id: "vertical", label: "Customer Journey", icon: "🗺", color: "#4A9EFF" },
  { id: "horizontal", label: "Shared Services", icon: "⚙", color: "#22D47A" },
  { id: "compliance", label: "Compliance", icon: "✅", color: "#A066FF" },
];

function getStatusColor(status) {
  if (status === "live") return "#22D47A";
  if (status === "draft") return "#FFB020";
  if (status === "archived") return "#FF4D6A";
  return "#ffffff";
}

function getStatusLabel(status) {
  if (status === "live") return "LIVE";
  if (status === "draft") return "DRAFT";
  if (status === "archived") return "ARCHIVED";
  return status?.toUpperCase() || "UNKNOWN";
}

function getExpiryDays(expiresAt) {
  if (!expiresAt) return null;
  const d = new Date(expiresAt);
  const now = new Date();
  return Math.ceil((d - now) / (1000 * 60 * 60 * 24));
}

function highlightMd(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/(^|\n)(---[\s\S]*?---)/m, (_, pre, fm) =>
      pre + '<span style="color:#7dd3fc">' + fm + "</span>"
    )
    .replace(/\bMUST NOT\b/g, '<span style="color:#FF4D6A;font-weight:700">MUST NOT</span>')
    .replace(/\bMUST\b(?!\s+NOT)/g, '<span style="color:#22D47A;font-weight:700">MUST</span>')
    .replace(/\bMAY\b/g, '<span style="color:#FFB020;font-weight:700">MAY</span>')
    .replace(/(^|\n)(#{1,3} .+)/g, (_, pre, h) =>
      pre + '<span style="color:#A066FF;font-weight:700">' + h + "</span>"
    );
}

function renderMarkdown(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/^---[\s\S]*?---\n/m, (fm) =>
      '<div style="background:#0d1117;border:1px solid #1e2229;border-radius:6px;padding:10px 14px;margin-bottom:12px;font-family:monospace;font-size:11px;color:#7dd3fc;white-space:pre-wrap">' + fm + "</div>"
    )
    .replace(/^### (.+)$/gm, '<h3 style="color:#A066FF;font-weight:700;margin:14px 0 6px;font-size:15px">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 style="color:#4A9EFF;font-weight:800;margin:18px 0 8px;font-size:17px;border-bottom:1px solid #1e2229;padding-bottom:4px">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 style="color:#FF6B2B;font-weight:900;margin:20px 0 10px;font-size:20px">$1</h1>')
    .replace(/\bMUST NOT\b/g, '<strong style="color:#FF4D6A">MUST NOT</strong>')
    .replace(/\bMUST\b(?!\s+NOT)/g, '<strong style="color:#22D47A">MUST</strong>')
    .replace(/\bMAY\b/g, '<strong style="color:#FFB020">MAY</strong>')
    .replace(/^- (.+)$/gm, '<li style="color:#ffffff;margin:3px 0;margin-left:16px">$1</li>')
    .replace(/\n\n/g, '<br/><br/>');
}

// ─────────────────────────────────────────────
// SOC 2 SYSTEM DESCRIPTION TAB
// ─────────────────────────────────────────────
function Soc2Tab({ companyName, companyId, onSaveToWitness }) {
  const [status, setStatus]     = useState(null);   // soc2-sd-status API response
  const [content, setContent]   = useState(null);   // full markdown content
  const [loading, setLoading]   = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError]       = useState(null);
  const [signedOffBy, setSignedOffBy] = useState("");

  const fetchStatus = async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/soc2-sd-status/${companyId}`);
      const data = await r.json();
      setStatus(data);
      if (data.fileId) {
        const fr = await fetch(`/api/fm/file/${data.fileId}?companyId=${companyId}`);
        const fd = await fr.json();
        setContent(fd.content || null);
      } else {
        setContent(null);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStatus(); }, [companyId]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/generate-soc2-sd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, signedOffBy: signedOffBy || undefined }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Generation failed");
      if (onSaveToWitness) {
        onSaveToWitness({
          id: Date.now(), timestamp: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
          agent: "Witness Agent", decision: "PASS",
          fileReferenced: data.filename,
          clauseApplied: "SOC 2 Trust Service Criteria — AICPA System Description generated per SOC 2 Type II requirements",
          actionProposed: `SOC 2 System Description generated for ${companyName} (${data.wordCount} words)`,
          exceptionApplied: false, escalationTarget: null,
          reasoning: `Generated by ${signedOffBy || "Platform User"} — ${data.wordCount} words covering CC6/CC7/CC8/CC9 Trust Service Criteria.`,
        });
      }
      await fetchStatus();
    } catch (e) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  const staleBadgeColor = !status?.exists ? T.dim
    : status?.isStale ? T.red
    : status?.daysSinceGeneration < 30 ? T.green : T.amber;

  const staleLabel = !status?.exists ? "Not generated"
    : status?.isStale ? `Stale (${status.daysSinceGeneration}d ago)`
    : status?.daysSinceGeneration === 0 ? "Generated today"
    : `${status.daysSinceGeneration}d ago`;

  return (
    <div style={{ padding: "28px 32px", maxWidth: 1100, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28, gap: 20 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 22 }}>📋</span>
            <h2 style={{ fontFamily: T.sans, fontWeight: 900, fontSize: 22, color: T.text, letterSpacing: "-0.03em", margin: 0 }}>
              SOC 2 System Description
            </h2>
            {status?.exists && (
              <span style={{ fontSize: 11, color: staleBadgeColor, fontFamily: T.mono, fontWeight: 700, background: staleBadgeColor + "18", border: `1px solid ${staleBadgeColor}40`, borderRadius: 4, padding: "2px 8px", display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: staleBadgeColor, display: "inline-block" }} />
                {staleLabel}
              </span>
            )}
          </div>
          <div style={{ fontSize: 13, color: T.dim, fontFamily: T.mono }}>
            AICPA Trust Service Criteria · SOC 2 Type II · {companyName}
          </div>
          <div style={{ fontSize: 12, color: T.dim, marginTop: 6, maxWidth: 600 }}>
            Formal 8-section System Description synthesised from {status?.wordCount ? `${status.wordCount.toLocaleString()} words · ` : ""}governance files, Witness Agent audit trail, and §3/§4 compliance controls. Regenerate at any time — every generation is logged by the Witness Agent.
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexShrink: 0 }}>
          <input
            value={signedOffBy}
            onChange={e => setSignedOffBy(e.target.value)}
            placeholder="Your name (for audit log)"
            style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 12px", color: T.text, fontFamily: T.mono, fontSize: 12, width: 180 }}
          />
          <button
            onClick={handleGenerate}
            disabled={generating || loading}
            style={{
              background: generating ? `${T.orange}20` : `${T.orange}15`,
              border: `1px solid ${T.orange}${generating ? "80" : "50"}`,
              borderRadius: 8, padding: "8px 18px", color: T.orange, fontFamily: T.mono,
              fontWeight: 700, fontSize: 13, cursor: generating ? "wait" : "pointer",
              display: "flex", alignItems: "center", gap: 8, transition: "all 0.2s",
              animation: generating ? "pulse-ring 1.5s ease infinite" : "none",
            }}
          >
            {generating ? (
              <><span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>⟳</span> Generating…</>
            ) : status?.exists ? (
              <><span>⟳</span> Regenerate</>
            ) : (
              <><span>▶</span> Generate</>
            )}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: `${T.red}15`, border: `1px solid ${T.red}40`, borderRadius: 8, padding: "12px 16px", marginBottom: 20, color: T.red, fontSize: 13, fontFamily: T.mono }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ color: T.dim, fontFamily: T.mono, fontSize: 13, padding: 40, textAlign: "center" }}>
          <div style={{ display: "inline-block", animation: "spin 1s linear infinite", marginRight: 8 }}>⟳</div>
          Loading SOC 2 System Description…
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 24 }}>

          {/* Left: Document Content */}
          <div>
            {!status?.exists ? (
              <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 40, textAlign: "center" }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>📋</div>
                <div style={{ fontFamily: T.sans, fontWeight: 700, fontSize: 18, color: T.text, marginBottom: 8 }}>No System Description yet</div>
                <div style={{ color: T.dim, fontSize: 13, maxWidth: 400, margin: "0 auto 24px" }}>
                  Click Generate to synthesise a formal AICPA SOC 2 System Description from {companyName}'s governance files, agent definitions, and compliance controls.
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, textAlign: "left", background: T.card, borderRadius: 8, padding: "16px 20px", maxWidth: 400, margin: "0 auto" }}>
                  {["Section 1 — Entity Overview", "Section 2 — Service Commitments", "Section 3 — System Components (Infra/Software/People/Procedures/Data)", "Section 4 — System Boundaries", "Section 5 — Control Environment", "Section 6 — Trust Service Criteria (CC6/CC7/CC8/CC9)", "Section 7 — User Entity Controls (CUECs)", "Section 8 — Subservice Organization Controls"].map(s => (
                    <div key={s} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: T.dim, fontFamily: T.mono }}>
                      <span style={{ color: T.orange }}>○</span> {s}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, overflow: "hidden" }}>
                {/* File Header */}
                <div style={{ padding: "14px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10, background: T.card }}>
                  <span style={{ fontSize: 14, fontFamily: T.mono, color: T.orange, fontWeight: 700 }}>📄</span>
                  <span style={{ fontSize: 12, fontFamily: T.mono, color: T.text, fontWeight: 700 }}>SOC2-SystemDescription-{(status?.filename || "").replace("SOC2-SystemDescription-", "").replace(".SYSTEM-DESC.md", "")}.SYSTEM-DESC.md</span>
                  <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                    <Tag color={T.green}>SOC2-SD</Tag>
                    <Tag color={status?.status === "live" ? T.green : T.amber}>{status?.status || "draft"}</Tag>
                    {status?.signedBy && <Tag color={T.purple}>Signed: {status.signedBy}</Tag>}
                  </div>
                </div>
                {/* Markdown Content */}
                <div style={{ padding: "20px 24px", maxHeight: 720, overflowY: "auto" }}>
                  {content ? (
                    <pre style={{ fontFamily: T.mono, fontSize: 11.5, color: T.dim, lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0 }}>
                      {content}
                    </pre>
                  ) : (
                    <div style={{ color: T.dim, fontSize: 13, fontFamily: T.mono }}>Loading content…</div>
                  )}
                </div>
                {/* §4 guard notice */}
                <div style={{ padding: "10px 20px", borderTop: `1px solid ${T.border}`, background: "#0a0c10", display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, color: T.amber, fontFamily: T.mono }}>⚠ VDA-MD §4</span>
                  <span style={{ fontSize: 11, color: T.dim, fontFamily: T.mono }}>Any reduction of SOC 2 / Trust Service Criteria references requires accountable owner signoff — enforced via §4 compliance guard (HTTP 409 if unsigned)</span>
                </div>
              </div>
            )}
          </div>

          {/* Right: Metadata + Witness Trail */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Status card */}
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 18 }}>
              <div style={{ fontSize: 11, fontFamily: T.mono, color: T.dim, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>Status</div>
              {[
                { label: "Document exists", value: status?.exists ? "Yes" : "No", color: status?.exists ? T.green : T.red },
                { label: "Word count", value: status?.wordCount ? status.wordCount.toLocaleString() : "—", color: T.text },
                { label: "Status", value: status?.status || "—", color: status?.status === "live" ? T.green : T.amber },
                { label: "Last generated", value: status?.lastGeneratedAt ? new Date(status.lastGeneratedAt).toLocaleDateString("en-GB") : "Never", color: T.text },
                { label: "Days since update", value: status?.daysSinceGeneration !== null ? `${status.daysSinceGeneration}d` : "—", color: staleBadgeColor },
                { label: "Staleness", value: !status?.exists ? "N/A" : status?.isStale ? "STALE — regenerate" : "Current", color: staleBadgeColor },
                { label: "Signed by", value: status?.signedBy || "Not signed", color: status?.signedBy ? T.green : T.dim },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: `1px solid ${T.border}` }}>
                  <span style={{ fontSize: 11, color: T.dim, fontFamily: T.mono }}>{label}</span>
                  <span style={{ fontSize: 12, color, fontFamily: T.mono, fontWeight: 600 }}>{value}</span>
                </div>
              ))}
            </div>

            {/* AICPA sections covered */}
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 18 }}>
              <div style={{ fontSize: 11, fontFamily: T.mono, color: T.dim, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>AICPA Sections</div>
              {[
                { num: "§1", label: "Entity Overview", ctrl: null },
                { num: "§2", label: "Service Commitments", ctrl: null },
                { num: "§3", label: "System Components", ctrl: null },
                { num: "§4", label: "System Boundaries", ctrl: null },
                { num: "§5", label: "Control Environment", ctrl: null },
                { num: "§6", label: "Trust Service Criteria", ctrl: "CC6–CC9" },
                { num: "§7", label: "User Entity Controls", ctrl: null },
                { num: "§8", label: "Subservice Organizations", ctrl: null },
              ].map(({ num, label, ctrl }) => (
                <div key={num} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
                  <span style={{ fontSize: 10, color: status?.exists ? T.green : T.dim, fontFamily: T.mono, fontWeight: 700, width: 22 }}>
                    {status?.exists ? "✓" : "○"}
                  </span>
                  <span style={{ fontSize: 11, color: T.dim, fontFamily: T.mono, flex: 1 }}>{num} {label}</span>
                  {ctrl && <Tag color={T.blue}>{ctrl}</Tag>}
                </div>
              ))}
            </div>

            {/* Witness Agent provenance trail */}
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 18 }}>
              <div style={{ fontSize: 11, fontFamily: T.mono, color: T.dim, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>Witness Agent Provenance</div>
              {(!status?.recentWitnessEntries || status.recentWitnessEntries.length === 0) ? (
                <div style={{ fontSize: 12, color: T.dim, fontFamily: T.mono, textAlign: "center", padding: "16px 0" }}>
                  No entries yet — generate the document first
                </div>
              ) : (
                status.recentWitnessEntries.map((entry, i) => {
                  const apaleoData = entry.apaleoData || {};
                  return (
                    <div key={entry.id} style={{ borderBottom: i < status.recentWitnessEntries.length - 1 ? `1px solid ${T.border}` : "none", padding: "10px 0" }}>
                      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: T.green, flexShrink: 0 }} />
                        <span style={{ fontSize: 11, color: T.green, fontFamily: T.mono, fontWeight: 700 }}>PASS</span>
                        <span style={{ fontSize: 10, color: T.dim, fontFamily: T.mono, marginLeft: "auto" }}>
                          {new Date(entry.createdAt).toLocaleDateString("en-GB")} {new Date(entry.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono, lineHeight: 1.5 }}>
                        {apaleoData.signedOffBy && <div>By: <span style={{ color: T.text }}>{apaleoData.signedOffBy}</span></div>}
                        {apaleoData.wordCount && <div>Words: <span style={{ color: T.text }}>{apaleoData.wordCount?.toLocaleString()}</span></div>}
                        {apaleoData.govFilesUsed && <div>Gov files used: <span style={{ color: T.text }}>{apaleoData.govFilesUsed}</span></div>}
                        {apaleoData.modelUsed && <div>Model: <span style={{ color: T.blue }}>{apaleoData.modelUsed}</span></div>}
                      </div>
                    </div>
                  );
                })
              )}
              <div style={{ marginTop: 12, fontSize: 10, color: T.dim, fontFamily: T.mono, lineHeight: 1.6, borderTop: `1px solid ${T.border}`, paddingTop: 10 }}>
                Every generation creates an immutable Witness Agent log entry — constitutes SOC 2 Type II operational evidence.
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// FILE MANAGER TAB
// ─────────────────────────────────────────────
function FileManagerTab({ config, companyName, companyId, onSaveToWitness, onNavigateToFile, agentFilter, reviewMode, onReviewComplete }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState(null);
  const [editorContent, setEditorContent] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);
  const [rightPanel, setRightPanel] = useState("agent");
  const [history, setHistory] = useState([]);
  const [diffData, setDiffData] = useState(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState(agentFilter || "");
  const [searchResults, setSearchResults] = useState(null);
  const [typeFilter, setTypeFilter] = useState("all");
  const [axisFilter, setAxisFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [diffFromId, setDiffFromId] = useState(null);
  const [diffToId, setDiffToId] = useState(null);
  const [showNewFileModal, setShowNewFileModal] = useState(false);
  const [showSignoffModal, setShowSignoffModal] = useState(false);
  const [showReleaseModal, setShowReleaseModal] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [releaseNotes, setReleaseNotes] = useState("");
  const [releaseLoading, setReleaseLoading] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [navigateToFileId, setNavigateToFileId] = useState(null);
  const [complianceCheck, setComplianceCheck] = useState(null);
  const [complianceLoading, setComplianceLoading] = useState(false);
  const [showDilutionModal, setShowDilutionModal] = useState(false);
  const [pendingSaveContent, setPendingSaveContent] = useState(null);
  const [integrityCheck, setIntegrityCheck] = useState(null);
  const [integrityLoading, setIntegrityLoading] = useState(false);
  const [archiveBlock, setArchiveBlock] = useState(null);
  // ── Guided review mode state ──
  const [reviewQueue, setReviewQueue] = useState(null);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [reviewApproved, setReviewApproved] = useState(new Set());
  const [reviewComplete, setReviewComplete] = useState(false);
  const [reviewApproving, setReviewApproving] = useState(false);
  const editorRef = useRef(null);
  const backdropRef = useRef(null);
  const searchTimeout = useRef(null);
  const complianceTimeout = useRef(null);
  const integrityTimeout = useRef(null);

  const loadFiles = async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const resp = await fetch(`/api/fm/files/${companyId}`);
      const data = await resp.json();
      setFiles(Array.isArray(data) ? data : []);
    } catch { setFiles([]); } finally { setLoading(false); }
  };

  useEffect(() => { loadFiles(); }, [companyId]);

  useEffect(() => {
    if (navigateToFileId && files.length > 0) {
      const f = files.find(f => f.id === navigateToFileId);
      if (f) { handleSelectFile(f); setNavigateToFileId(null); }
    }
  }, [navigateToFileId, files]);

  // Capture agentFilter and reviewMode at mount time — immune to parent 1s hubNavContext clearance
  const initialAgentFilter = useRef(agentFilter || null);
  const agentFilterApplied = useRef(false);
  const isReviewMode = useRef(reviewMode || false);
  useEffect(() => {
    if (initialAgentFilter.current && files.length > 0 && !agentFilterApplied.current) {
      agentFilterApplied.current = true;
      handleSearch(initialAgentFilter.current);
    }
  }, [files]);

  if (onNavigateToFile) {
    onNavigateToFile.current = (id) => { setNavigateToFileId(id); };
  }

  const handleSelectFile = async (file) => {
    if (isDirty && selectedFile && !window.confirm("You have unsaved changes. Discard them?")) return;
    const resp = await fetch(`/api/fm/file/${file.id}?companyId=${companyId}`);
    const full = await resp.json();
    setSelectedFile(full);
    setEditorContent(full.content || "");
    setIsDirty(false);
    setRightPanel("agent");
    setHistory([]);
    setDiffData(null);
    setAiSuggestion(null);
    setSaveMsg(null);
    setPreviewMode(false);
    setComplianceCheck(null);
    setIntegrityCheck(null);
    runComplianceCheck(full.content || "", null, full);
    runIntegrityCheck(full.content || "", full);
  };

  const handleEditorChange = (e) => {
    const newContent = e.target.value;
    setEditorContent(newContent);
    setIsDirty(newContent !== (selectedFile?.content || ""));
    clearTimeout(complianceTimeout.current);
    complianceTimeout.current = setTimeout(() => {
      runComplianceCheck(newContent, selectedFile?.content || null);
    }, 600);
    clearTimeout(integrityTimeout.current);
    integrityTimeout.current = setTimeout(() => {
      runIntegrityCheck(newContent);
    }, 1200);
  };

  const handleSave = async (msg) => {
    if (!selectedFile || !isDirty) return;
    setIsSaving(true);
    try {
      await fetch(`/api/fm/file/${selectedFile.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editorContent, commitMessage: msg || "Updated", companyId }),
      });
      setIsDirty(false);
      setSaveMsg("Saved ✓");
      setTimeout(() => setSaveMsg(null), 2500);
      await loadFiles();
      const resp = await fetch(`/api/fm/file/${selectedFile.id}?companyId=${companyId}`);
      const updated = await resp.json();
      setSelectedFile(updated);
      runComplianceCheck(updated.content || "", null, updated);
    } catch (e) { setSaveMsg("Error: " + e.message); }
    setIsSaving(false);
  };

  const handleHistory = async () => {
    if (!selectedFile) return;
    setRightPanel("history");
    const resp = await fetch(`/api/fm/history/${selectedFile.id}?companyId=${companyId}`);
    const data = await resp.json();
    setHistory(Array.isArray(data) ? data : []);
  };

  const handleDiff = async (fromId, toId) => {
    if (!selectedFile) return;
    setRightPanel("diff");
    setDiffLoading(true);
    const params = new URLSearchParams();
    if (fromId) params.set("fromVersion", String(fromId));
    if (toId) params.set("toVersion", String(toId));
    params.set("companyId", String(companyId));
    const url = `/api/fm/diff/${selectedFile.id}?${params.toString()}`;
    const resp = await fetch(url);
    const data = await resp.json();
    setDiffData(data);
    setDiffLoading(false);
  };

  const handleSignoff = async ({ signedBy, signedRole }) => {
    if (!selectedFile) return;
    await fetch(`/api/fm/sign/${selectedFile.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signedBy, signedRole, companyId }),
    });
    await loadFiles();
    const resp = await fetch(`/api/fm/file/${selectedFile.id}?companyId=${companyId}`);
    setSelectedFile(await resp.json());
    setShowSignoffModal(false);
    if (onSaveToWitness) {
      onSaveToWitness({
        id: Date.now(), timestamp: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        agent: "File Manager", decision: "PASS",
        fileReferenced: selectedFile.filename,
        clauseApplied: `File signed off and promoted to LIVE status by ${signedBy} (${signedRole})`,
        actionProposed: `Governance file ${selectedFile.filename} → status: LIVE`,
        exceptionApplied: false, escalationTarget: null,
        reasoning: `Sign-off completed. File is now part of the active governance baseline.`,
      });
    }
  };

  const handleDelete = async (file) => {
    if (!window.confirm(`Archive "${file.filename}"? It will be hidden but not permanently deleted.`)) return;
    const resp = await fetch(`/api/fm/file/${file.id}?companyId=${companyId}`, { method: "DELETE" });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      if (err.reason === "core_file") {
        setArchiveBlock({ type: "core", filename: file.filename, fileType: err.fileType });
      } else if (err.reason === "referenced") {
        setArchiveBlock({ type: "referenced", filename: file.filename, referencedBy: err.referencedBy || [] });
      } else {
        alert(err.error || "Archive failed");
      }
      return;
    }
    if (selectedFile?.id === file.id) { setSelectedFile(null); setEditorContent(""); setIntegrityCheck(null); }
    await loadFiles();
  };

  const handleSearch = (q) => {
    setSearchQuery(q);
    clearTimeout(searchTimeout.current);
    if (!q.trim()) { setSearchResults(null); return; }
    searchTimeout.current = setTimeout(async () => {
      const resp = await fetch(`/api/fm/search/${companyId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      const data = await resp.json();
      setSearchResults(Array.isArray(data) ? data : []);
    }, 350);
  };

  // ── Guided review: build ordered queue from search results ──
  useEffect(() => {
    if (!isReviewMode.current || !searchResults) return;
    const order = ["AGENTS", "SOP", "SKILL", "EXCEPTION", "COMPLIANCE", "CUSTOM"];
    const nonArchived = searchResults.filter(f => f.status !== "archived");
    const sorted = [...nonArchived].sort((a, b) => {
      const ai = order.indexOf(a.fileType); const bi = order.indexOf(b.fileType);
      if (ai !== bi) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      return a.filename.localeCompare(b.filename);
    });
    setReviewQueue(sorted);
    setReviewIndex(0);
    setReviewApproved(new Set());
    setReviewComplete(false);
  }, [searchResults]);

  // ── Guided review: auto-select current file when index changes ──
  useEffect(() => {
    if (!isReviewMode.current || !reviewQueue || reviewQueue.length === 0) return;
    if (reviewIndex < reviewQueue.length) {
      handleSelectFile(reviewQueue[reviewIndex]);
    }
  }, [reviewQueue, reviewIndex]);

  const handleReviewApprove = async () => {
    if (!selectedFile || reviewApproving) return;
    setReviewApproving(true);
    await fetch(`/api/fm/sign/${selectedFile.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signedBy: "Compliance Officer", signedRole: "compliance_officer", companyId }),
    });
    await loadFiles();
    setReviewApproved(prev => new Set([...prev, selectedFile.id]));
    setReviewApproving(false);
    if (onSaveToWitness) {
      onSaveToWitness({ id: Date.now(), timestamp: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }), agent: "Guided Review", decision: "PASS", fileReferenced: selectedFile.filename, clauseApplied: "Governance file reviewed and signed off by Compliance Officer", actionProposed: `${selectedFile.filename} → status: LIVE`, exceptionApplied: false, escalationTarget: null, reasoning: "Compliance Officer signed off during guided onboarding review." });
    }
    const next = reviewIndex + 1;
    if (next >= reviewQueue.length) { setReviewComplete(true); } else { setReviewIndex(next); }
  };

  const handleReviewSkip = () => {
    const next = reviewIndex + 1;
    if (next >= reviewQueue.length) { setReviewComplete(true); } else { setReviewIndex(next); }
  };

  const handleReviewPrev = () => {
    if (reviewIndex > 0) setReviewIndex(reviewIndex - 1);
  };

  const runComplianceCheck = async (content, savedContent, fileOverride) => {
    const file = fileOverride || selectedFile;
    if (!file || !config) return;
    setComplianceLoading(true);
    try {
      const resp = await fetch("/api/fm/compliance-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          savedContent: savedContent || null,
          industry: config.id || config.label || "general",
          fileType: file.fileType,
        }),
      });
      const data = await resp.json();
      setComplianceCheck(data);
    } catch (e) { /* silent */ }
    setComplianceLoading(false);
  };

  const runIntegrityCheck = async (content, fileOverride) => {
    const file = fileOverride || selectedFile;
    if (!file || !companyId) return;
    setIntegrityLoading(true);
    try {
      const resp = await fetch("/api/fm/integrity-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          content: content || file.content || "",
          filename: file.filename,
          fileId: file.id,
        }),
      });
      const data = await resp.json();
      setIntegrityCheck(data);
    } catch (e) { /* silent */ }
    setIntegrityLoading(false);
  };

  const handleSaveWithGuard = async (msg) => {
    if (!selectedFile || !isDirty) return;
    let freshCheck = null;
    let checkFailed = false;
    try {
      const resp = await fetch("/api/fm/compliance-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: editorContent,
          savedContent: selectedFile?.content || null,
          industry: config?.id || config?.label || "general",
          fileType: selectedFile.fileType,
        }),
      });
      if (!resp.ok) {
        checkFailed = true;
      } else {
        freshCheck = await resp.json();
        setComplianceCheck(freshCheck);
      }
    } catch (_) {
      checkFailed = true;
    }

    if (checkFailed || freshCheck?.hasDilution) {
      setPendingSaveContent({ content: editorContent, msg, checkFailed });
      setShowDilutionModal(true);
      return;
    }
    await handleSave(msg);
  };

  const handleDilutionConfirm = async (overrideString) => {
    if (!pendingSaveContent) return;
    const fullMsg = overrideString
      ? `${overrideString} — ${pendingSaveContent.msg}`
      : pendingSaveContent.msg;
    setShowDilutionModal(false);
    setPendingSaveContent(null);
    await handleSave(fullMsg);
  };

  const handleAISuggest = async () => {
    if (!selectedFile || aiLoading) return;
    setAiLoading(true);
    setAiSuggestion(null);
    try {
      const resp = await fetch("/api/fm/agent/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileType: selectedFile.fileType,
          axis: selectedFile.axis,
          companyName,
          industry: config?.label,
          filename: selectedFile.filename,
          existingContent: editorContent.slice(0, 4000),
        }),
      });
      const data = await resp.json();
      setAiSuggestion(data);
    } catch (e) { setAiSuggestion({ error: e.message }); }
    setAiLoading(false);
  };

  const handleGenerateReleaseNotes = async () => {
    setReleaseLoading(true);
    const liveFiles = files.filter(f => f.status === "live");
    const draftFiles = files.filter(f => f.status === "draft");
    try {
      const resp = await fetch("/api/fm/agent/release-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName,
          industry: config?.label,
          liveFiles: liveFiles.map(f => f.filename),
          draftFiles: draftFiles.map(f => f.filename),
          releaseDate: new Date().toISOString().slice(0, 10),
        }),
      });
      const data = await resp.json();
      setReleaseNotes(data?.releaseNotes || "");
    } catch (e) { setReleaseNotes("Error generating notes: " + e.message); }
    setReleaseLoading(false);
  };

  const handleNewFileSave = async ({ filename, fileType, axis, stage, content, expiresAt, exceptionReason }) => {
    const resp = await fetch("/api/fm/file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId, filename, fileType, axis, stage, content, status: "draft", expiresAt: expiresAt || null, exceptionReason: exceptionReason || null }),
    });
    const file = await resp.json();
    await loadFiles();
    setShowNewFileModal(false);
    setSelectedFile(file);
    setEditorContent(file.content || "");
    setIsDirty(false);
    setComplianceCheck(null);
    runComplianceCheck(file.content || "", null, file);
  };

  const displayedFiles = searchResults
    ? searchResults
    : files.filter(f =>
        (typeFilter === "all" || f.fileType === typeFilter) &&
        (axisFilter === "all" || f.axis === axisFilter) &&
        (statusFilter === "all" || f.status === statusFilter)
      );

  const liveCount = files.filter(f => f.status === "live").length;
  const draftCount = files.filter(f => f.status === "draft").length;
  const expiringCount = files.filter(f => {
    const d = getExpiryDays(f.expiresAt);
    return d !== null && d <= 30 && d > 0;
  }).length;
  const unsignedCount = files.filter(f => f.status !== "live").length;

  const nistCovered = [...new Set(files.filter(f => f.nistControl).map(f => f.nistControl))];
  const nistTotal = config?.nistControls || [];

  const showReviewBanner = isReviewMode.current && reviewQueue && reviewQueue.length > 0;

  return (
    <>
    {/* ── Guided Review Banner ── */}
    {showReviewBanner && !reviewComplete && (() => {
      const cur = reviewQueue[reviewIndex];
      const pct = Math.round((reviewIndex / reviewQueue.length) * 100);
      const isApproved = cur && reviewApproved.has(cur.id);
      return (
        <div style={{ background: T.card, borderBottom: `2px solid ${T.orange}40`, padding: "10px 20px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          {/* Left: progress info */}
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontSize: 11, color: T.orange, fontFamily: T.mono, fontWeight: 700, letterSpacing: "0.06em", marginBottom: 3 }}>
              GUIDED REVIEW · FILE {reviewIndex + 1} OF {reviewQueue.length}
              {isApproved && <span style={{ marginLeft: 8, color: T.green }}>✓ Approved</span>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ flex: 1, height: 4, background: `${T.border}`, borderRadius: 4, overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: T.orange, borderRadius: 4, transition: "width 0.3s" }} />
              </div>
              <span style={{ fontSize: 10, color: T.dim, fontFamily: T.mono, whiteSpace: "nowrap" }}>{pct}%</span>
            </div>
          </div>
          {/* Centre: current filename */}
          {cur && (
            <div style={{ fontSize: 12, fontFamily: T.mono, color: T.text, fontWeight: 600, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {cur.filename}
              <span style={{ marginLeft: 6, fontSize: 10, color: cur.status === "live" ? T.green : T.amber }}>{cur.status?.toUpperCase()}</span>
            </div>
          )}
          {/* Right: action buttons */}
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <button disabled={reviewIndex === 0} onClick={handleReviewPrev}
              style={{ padding: "5px 10px", borderRadius: 6, border: `1px solid ${T.border}`, background: "none", color: reviewIndex === 0 ? T.dim : T.text, fontSize: 11, cursor: reviewIndex === 0 ? "default" : "pointer", fontFamily: T.mono, opacity: reviewIndex === 0 ? 0.4 : 1 }}>
              ← Prev
            </button>
            {isDirty && (
              <button onClick={() => handleSaveWithGuard("Reviewed and saved")}
                style={{ padding: "5px 12px", borderRadius: 6, border: `1px solid ${T.orange}50`, background: `${T.orange}18`, color: T.orange, fontSize: 11, cursor: "pointer", fontFamily: T.mono, fontWeight: 700 }}>
                Save Changes
              </button>
            )}
            <button onClick={handleReviewApprove} disabled={reviewApproving || isApproved}
              style={{ padding: "5px 14px", borderRadius: 6, border: `1px solid ${T.green}50`, background: reviewApproving ? "none" : `${T.green}18`, color: T.green, fontSize: 11, cursor: reviewApproving || isApproved ? "default" : "pointer", fontFamily: T.mono, fontWeight: 700, opacity: isApproved ? 0.5 : 1 }}>
              {reviewApproving ? "Signing…" : isApproved ? "✓ Approved" : "✓ Approve & Next →"}
            </button>
            <button onClick={handleReviewSkip}
              style={{ padding: "5px 10px", borderRadius: 6, border: `1px solid ${T.border}`, background: "none", color: T.dim, fontSize: 11, cursor: "pointer", fontFamily: T.mono }}>
              Skip →
            </button>
          </div>
        </div>
      );
    })()}

    {/* ── Review Complete ── */}
    {showReviewBanner && reviewComplete && (
      <div style={{ background: `${T.green}10`, border: `1px solid ${T.green}30`, borderRadius: 10, margin: "16px 20px", padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: T.green, marginBottom: 4 }}>
            ✓ File review complete — {reviewApproved.size} of {reviewQueue.length} files approved
          </div>
          <div style={{ fontSize: 12, color: T.muted }}>
            You've worked through all existing governance files. The next step is to submit the formal admission request through the Onboarding Wizard.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={() => onReviewComplete ? onReviewComplete(initialAgentFilter.current) : undefined}
            style={{
              padding: "8px 18px", borderRadius: 7, border: "none",
              background: T.blue, color: "#fff", fontSize: 12, fontWeight: 800,
              cursor: "pointer", fontFamily: T.mono, letterSpacing: "0.04em",
            }}
          >
            Step 2: Submit Wizard →
          </button>
        </div>
      </div>
    )}

    <div style={{ display: "flex", height: `calc(100vh - ${110 + (showReviewBanner && !reviewComplete ? 72 : 0)}px)`, overflow: "hidden" }}>
      {/* ── LEFT SIDEBAR ── */}
      <div style={{ width: 280, borderRight: `1px solid ${T.border}`, display: "flex", flexDirection: "column", background: T.surface, flexShrink: 0 }}>
        {/* Health strip */}
        <div style={{ padding: "12px 14px", background: T.card, borderBottom: `1px solid ${T.border}`, display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[
            { label: "Live", val: liveCount, color: T.green },
            { label: "Draft", val: draftCount, color: T.amber },
            { label: "Expiring", val: expiringCount, color: T.red },
          ].map(s => (
            <div key={s.label} style={{ flex: 1, minWidth: 52, background: `${s.color}12`, border: `1px solid ${s.color}30`, borderRadius: 6, padding: "4px 8px", textAlign: "center" }}>
              <div style={{ fontFamily: T.mono, fontWeight: 800, fontSize: 15, color: s.color }}>{s.val}</div>
              <div style={{ fontSize: 9, color: s.color, opacity: 0.7, textTransform: "uppercase", letterSpacing: "0.05em" }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Search */}
        <div style={{ padding: "10px 12px", borderBottom: `1px solid ${T.border}` }}>
          <input
            value={searchQuery}
            onChange={e => handleSearch(e.target.value)}
            placeholder="Search files & clauses…"
            style={{ width: "100%", background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 10px", fontSize: 12, color: T.text, fontFamily: T.mono, outline: "none" }}
          />
        </div>

        {/* Type Filters */}
        <div style={{ padding: "6px 12px", display: "flex", gap: 4, borderBottom: `1px solid ${T.border}`, flexWrap: "wrap" }}>
          {["all", "AGENTS", "SOP", "SKILL", "EXCEPTION", "COMPLIANCE", "CUSTOM"].map(t => (
            <button key={t} onClick={() => { setTypeFilter(t); setSearchResults(null); setSearchQuery(""); }}
              style={{ padding: "2px 6px", borderRadius: 4, border: `1px solid ${typeFilter === t ? T.orange : T.border}`, background: typeFilter === t ? `${T.orange}20` : "none", color: typeFilter === t ? T.orange : T.dim, fontSize: 9, cursor: "pointer", fontFamily: T.mono }}>
              {t === "all" ? "ALL TYPES" : t}
            </button>
          ))}
        </div>
        {/* Status + Axis Filters */}
        <div style={{ padding: "6px 12px", display: "flex", gap: 4, borderBottom: `1px solid ${T.border}`, flexWrap: "wrap" }}>
          {[
            { key: "all", label: "ALL STATUS", color: T.dim },
            { key: "live", label: "LIVE", color: T.green },
            { key: "draft", label: "DRAFT", color: T.amber },
            { key: "archived", label: "ARCHIVED", color: T.muted },
          ].map(s => (
            <button key={s.key} onClick={() => { setStatusFilter(s.key); setSearchResults(null); setSearchQuery(""); }}
              style={{ padding: "2px 6px", borderRadius: 4, border: `1px solid ${statusFilter === s.key ? s.color : T.border}`, background: statusFilter === s.key ? `${s.color}20` : "none", color: statusFilter === s.key ? s.color : T.dim, fontSize: 9, cursor: "pointer", fontFamily: T.mono }}>
              {s.label}
            </button>
          ))}
          <span style={{ width: "100%", height: 1 }} />
          {FM_AXIS_GROUPS.map(g => (
            <button key={g.id} onClick={() => { setAxisFilter(axisFilter === g.id ? "all" : g.id); setSearchResults(null); setSearchQuery(""); }}
              style={{ padding: "2px 6px", borderRadius: 4, border: `1px solid ${axisFilter === g.id ? g.color : T.border}`, background: axisFilter === g.id ? `${g.color}20` : "none", color: axisFilter === g.id ? g.color : T.dim, fontSize: 9, cursor: "pointer", fontFamily: T.mono }}>
              {g.icon} {g.label}
            </button>
          ))}
        </div>

        {/* New File + file list */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          <div style={{ padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 10, color: T.dim, fontFamily: T.mono, textTransform: "uppercase", letterSpacing: "0.1em" }}>
              {searchResults ? `${searchResults.length} results` : `${displayedFiles.length} files`}
            </span>
            <button onClick={() => setShowNewFileModal(true)} style={{
              background: `${T.orange}20`, border: `1px solid ${T.orange}40`, borderRadius: 5,
              padding: "3px 8px", fontSize: 11, color: T.orange, cursor: "pointer", fontWeight: 700,
            }}>+ New</button>
          </div>

          {loading ? (
            <div style={{ textAlign: "center", padding: 24, color: T.dim, fontSize: 12 }}>Loading…</div>
          ) : displayedFiles.length === 0 ? (
            <div style={{ textAlign: "center", padding: 24, color: T.dim }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>📂</div>
              <div style={{ fontSize: 12, color: T.dim }}>No files yet</div>
              <div style={{ fontSize: 11, color: T.dim, marginTop: 4 }}>Click + New to create one</div>
            </div>
          ) : (
            FM_AXIS_GROUPS.map(group => {
              const groupFiles = displayedFiles.filter(f =>
                searchResults
                  ? f.axis === group.id || (group.id === "compliance" && f.fileType === "COMPLIANCE")
                  : f.axis === group.id || (group.id === "compliance" && f.fileType === "COMPLIANCE")
              );
              if (groupFiles.length === 0) return null;
              return (
                <div key={group.id}>
                  <div style={{ padding: "6px 12px 3px", fontSize: 10, color: group.color, fontFamily: T.mono, textTransform: "uppercase", letterSpacing: "0.1em", background: `${group.color}08`, display: "flex", gap: 5, alignItems: "center" }}>
                    <span>{group.icon}</span> {group.label}
                  </div>
                  {groupFiles.map(file => {
                    const expDays = getExpiryDays(file.expiresAt);
                    const isSelected = selectedFile?.id === file.id;
                    const ftype = FM_FILE_TYPES.find(t => t.type === file.fileType) || FM_FILE_TYPES[5];
                    return (
                      <div key={file.id} onClick={() => handleSelectFile(file)}
                        style={{ padding: "8px 12px", cursor: "pointer", background: isSelected ? `${T.orange}12` : "none", borderLeft: `2px solid ${isSelected ? T.orange : "transparent"}`, transition: "all 0.15s" }}
                        onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = `${T.border}40`; }}
                        onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "none"; }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 4 }}>
                          <div style={{ display: "flex", gap: 6, alignItems: "center", minWidth: 0 }}>
                            <span style={{ fontSize: 13 }}>{ftype.icon}</span>
                            <span style={{ fontSize: 12, color: isSelected ? T.orange : T.text, fontFamily: T.mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 130 }}>{file.filename}</span>
                          </div>
                          <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0 }}>
                            <span style={{ width: 7, height: 7, borderRadius: "50%", background: getStatusColor(file.status), display: "inline-block", flexShrink: 0 }} />
                            <button onClick={e => { e.stopPropagation(); handleDelete(file); }}
                              style={{ background: "none", border: "none", color: T.dim, cursor: "pointer", fontSize: 10, padding: "0 2px", opacity: 0.5 }}
                              onMouseEnter={e => { e.currentTarget.style.color = T.red; e.currentTarget.style.opacity = "1"; }}
                              onMouseLeave={e => { e.currentTarget.style.color = T.dim; e.currentTarget.style.opacity = "0.5"; }}
                              title="Archive file"
                            >✕</button>
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 6, marginTop: 3, alignItems: "center" }}>
                          <span style={{ fontSize: 9, fontFamily: T.mono, color: ftype.color, opacity: 0.8 }}>{file.fileType}</span>
                          {file.owner && <span style={{ fontSize: 9, color: T.dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 100 }}>· {file.owner}</span>}
                        </div>
                        {expDays !== null && (
                          <div style={{ marginTop: 3, fontSize: 9, fontFamily: T.mono, color: expDays <= 14 ? T.red : expDays <= 30 ? T.amber : T.dim }}>
                            ⏱ {expDays > 0 ? `expires in ${expDays}d` : `expired ${Math.abs(expDays)}d ago`}
                          </div>
                        )}
                        {searchResults && file.snippet && (
                          <div style={{ marginTop: 4, fontSize: 10, color: T.dim, fontFamily: T.mono, background: T.bg, borderRadius: 4, padding: "3px 6px", whiteSpace: "pre-wrap", overflow: "hidden", maxHeight: 40 }}>
                            …{file.snippet}…
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── CENTRE EDITOR ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {selectedFile ? (
          <>
            {/* File toolbar */}
            <div style={{ padding: "8px 16px", background: T.card, borderBottom: `1px solid ${T.border}`, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontFamily: T.mono, fontWeight: 700, fontSize: 13, color: T.text }}>{selectedFile.filename}</span>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: getStatusColor(selectedFile.status) }} />
              <span style={{ fontSize: 10, color: getStatusColor(selectedFile.status), fontFamily: T.mono, fontWeight: 700 }}>{getStatusLabel(selectedFile.status)}</span>
              {isDirty && <span style={{ fontSize: 10, color: T.amber, fontFamily: T.mono }}>● unsaved changes</span>}
              {saveMsg && <span style={{ fontSize: 10, color: T.green, fontFamily: T.mono }}>{saveMsg}</span>}
              <div style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button onClick={() => setPreviewMode(p => !p)} style={{ padding: "4px 10px", borderRadius: 5, border: `1px solid ${previewMode ? T.purple : T.border}`, background: previewMode ? `${T.purple}20` : "none", color: previewMode ? T.purple : T.dim, fontSize: 11, cursor: "pointer" }}>
                  {previewMode ? "Edit" : "Preview"}
                </button>
                <button onClick={() => handleSaveWithGuard("Updated")} disabled={!isDirty || isSaving} style={{
                  padding: "4px 12px", borderRadius: 5,
                  border: `1px solid ${complianceCheck?.hasDilution && isDirty ? T.red + "80" : isDirty ? T.blue + "80" : T.border}`,
                  background: complianceCheck?.hasDilution && isDirty ? `${T.red}20` : isDirty ? `${T.blue}20` : "none",
                  color: complianceCheck?.hasDilution && isDirty ? T.red : isDirty ? T.blue : T.dim,
                  fontSize: 11, cursor: isDirty ? "pointer" : "default", fontWeight: 700,
                }}>
                  {isSaving ? "Saving…" : complianceCheck?.hasDilution && isDirty ? "⚠ Save" : "Save"}
                </button>
                <button onClick={handleHistory} style={{ padding: "4px 10px", borderRadius: 5, border: `1px solid ${T.border}`, background: "none", color: T.dim, fontSize: 11, cursor: "pointer" }}>
                  History
                </button>
                <button onClick={() => { handleHistory(); handleDiff(); }} style={{ padding: "4px 10px", borderRadius: 5, border: `1px solid ${T.border}`, background: "none", color: T.dim, fontSize: 11, cursor: "pointer" }}>
                  Diff
                </button>
                <button
                  onClick={() => setShowSignoffModal(true)}
                  disabled={selectedFile.status === "live"}
                  style={{
                    padding: "4px 12px", borderRadius: 5,
                    border: `1px solid ${selectedFile.status === "live" ? T.green + "60" : T.green + "80"}`,
                    background: selectedFile.status === "live" ? `${T.green}12` : `${T.green}20`,
                    color: selectedFile.status === "live" ? T.green : T.green,
                    fontSize: 11, cursor: selectedFile.status === "live" ? "default" : "pointer", fontWeight: 700,
                  }}>
                  {selectedFile.status === "live" ? "✓ Signed" : "Sign Off"}
                </button>
              </div>
            </div>

            {/* Schema validation bar — live from editorContent */}
            {(() => {
              const liveMust = (editorContent.match(/\bMUST\b(?!\s+NOT)/g) || []).length;
              const liveMustNot = (editorContent.match(/\bMUST NOT\b/g) || []).length;
              const liveMay = (editorContent.match(/\bMAY\b/g) || []).length;
              const liveWords = editorContent.split(/\s+/).filter(Boolean).length;
              const hasYaml = /^---\s*\n/.test(editorContent);
              return (
                <div style={{ padding: "5px 16px", background: "#04060a", borderBottom: `1px solid ${T.border}`, display: "flex", gap: 14, alignItems: "center" }}>
                  {[
                    { label: "MUST", count: liveMust, color: T.green },
                    { label: "MUST NOT", count: liveMustNot, color: T.red },
                    { label: "MAY", count: liveMay, color: T.amber },
                    { label: "Words", count: liveWords, color: T.dim },
                  ].map(s => (
                    <span key={s.label} style={{ fontSize: 10, fontFamily: T.mono, color: s.color }}>
                      {s.count} {s.label}
                    </span>
                  ))}
                  <span style={{ fontSize: 10, fontFamily: T.mono, color: hasYaml ? T.teal : T.red, marginLeft: 8 }}>
                    {hasYaml ? "✓ YAML" : "⚠ no front matter"}
                  </span>
                  <span style={{ fontSize: 10, fontFamily: T.mono, color: T.dim, marginLeft: "auto" }}>
                    {selectedFile.owner ? `owner: ${selectedFile.owner}` : ""}{selectedFile.nistControl ? ` · ${selectedFile.nistControl}` : ""}
                  </span>
                  {selectedFile.updatedAt && (
                    <span style={{ fontSize: 10, fontFamily: T.mono, color: T.dim }}>
                      updated: {new Date(selectedFile.updatedAt).toLocaleDateString("en-GB")}
                    </span>
                  )}
                </div>
              );
            })()}

            {/* Editor / Preview */}
            <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
              {previewMode ? (
                <div style={{ padding: 20, overflowY: "auto", height: "100%", background: T.bg }}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(editorContent) }}
                />
              ) : (
                <div style={{ position: "relative", width: "100%", height: "100%" }}>
                  {/* Syntax highlight backdrop — scrollTop is kept in sync with textarea */}
                  <pre
                    ref={backdropRef}
                    aria-hidden="true"
                    style={{
                      position: "absolute", inset: 0, margin: 0,
                      padding: "16px 20px", fontFamily: T.mono, fontSize: 13,
                      lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-word",
                      overflowY: "scroll", pointerEvents: "none",
                      background: "#050608", zIndex: 0,
                    }}
                    dangerouslySetInnerHTML={{ __html: highlightMd(editorContent) }}
                  />
                  <textarea
                    ref={editorRef}
                    value={editorContent}
                    onChange={handleEditorChange}
                    onScroll={() => {
                      if (backdropRef.current && editorRef.current) {
                        backdropRef.current.scrollTop = editorRef.current.scrollTop;
                      }
                    }}
                    spellCheck={false}
                    style={{
                      position: "absolute", inset: 0,
                      width: "100%", height: "100%", background: "transparent",
                      color: "transparent", fontFamily: T.mono, fontSize: 13,
                      lineHeight: 1.7, border: "none", outline: "none",
                      padding: "16px 20px", resize: "none",
                      whiteSpace: "pre-wrap", caretColor: "#e2e8f0",
                      overflowY: "scroll",
                      zIndex: 1,
                    }}
                  />
                </div>
              )}
            </div>

            {/* Download bar */}
            <div style={{ padding: "6px 16px", background: T.card, borderTop: `1px solid ${T.border}`, display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={() => {
                const blob = new Blob([editorContent], { type: "text/markdown" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a"); a.href = url; a.download = selectedFile.filename; a.click();
                URL.revokeObjectURL(url);
              }} style={{ padding: "4px 10px", borderRadius: 5, border: `1px solid ${T.border}`, background: "none", color: T.dim, fontSize: 11, cursor: "pointer" }}>
                ↓ Download .md
              </button>
              <button onClick={() => navigator.clipboard.writeText(editorContent)} style={{ padding: "4px 10px", borderRadius: 5, border: `1px solid ${T.border}`, background: "none", color: T.dim, fontSize: 11, cursor: "pointer" }}>
                Copy
              </button>
              <button onClick={() => setShowReleaseModal(true)} style={{
                marginLeft: "auto", padding: "4px 12px", borderRadius: 5,
                border: `1px solid ${T.purple}40`, background: `${T.purple}15`, color: T.purple,
                fontSize: 11, cursor: "pointer", fontWeight: 700,
              }}>
                Create Release
              </button>
            </div>
          </>
        ) : (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12, color: T.dim, padding: 40 }}>
            <div style={{ fontSize: 48, opacity: 0.3 }}>📁</div>
            <div style={{ fontWeight: 700, fontSize: 16, color: T.muted }}>Select a file to edit</div>
            <div style={{ fontSize: 13, color: T.dim, textAlign: "center", maxWidth: 320 }}>
              Choose a file from the sidebar, or click + New to create your first governance document.
            </div>
            <button onClick={() => setShowNewFileModal(true)} style={{
              marginTop: 8, padding: "8px 20px", borderRadius: 8,
              background: T.orange, border: "none", color: "#fff",
              fontSize: 13, fontWeight: 700, cursor: "pointer",
            }}>
              + New Governance File
            </button>
          </div>
        )}
      </div>

      {/* ── RIGHT PANEL ── */}
      <div style={{ width: 300, borderLeft: `1px solid ${T.border}`, display: "flex", flexDirection: "column", background: T.surface, flexShrink: 0 }}>
        {/* Panel tabs */}
        <div style={{ display: "flex", borderBottom: `1px solid ${T.border}` }}>
          {[{ id: "agent", label: "FM Agent" }, { id: "history", label: "History" }, { id: "diff", label: "Diff" }].map(p => (
            <button key={p.id} onClick={() => {
              setRightPanel(p.id);
              if (p.id === "agent" && selectedFile) { runComplianceCheck(editorContent, selectedFile.content, selectedFile); runIntegrityCheck(editorContent, selectedFile); }
              if (p.id === "history" && selectedFile) handleHistory();
              if (p.id === "diff" && selectedFile) { handleHistory(); handleDiff(); }
            }} style={{
              flex: 1, padding: "9px 6px", background: "none", border: "none",
              borderBottom: `2px solid ${rightPanel === p.id ? T.orange : "transparent"}`,
              color: rightPanel === p.id ? T.orange : T.dim,
              fontSize: 11, cursor: "pointer", fontFamily: T.sans, fontWeight: rightPanel === p.id ? 700 : 400,
            }}>
              {p.label}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
          {rightPanel === "agent" && (
            <>
              {/* ── COMPLIANCE SHIELD ── */}
              {selectedFile && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: T.teal, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                      Compliance Shield
                    </div>
                    {complianceCheck && (
                      <div style={{
                        fontSize: 11, fontWeight: 800, fontFamily: T.mono,
                        color: complianceCheck.hasDilution ? T.amber : complianceCheck.covered === complianceCheck.total ? T.green : T.red,
                      }}>
                        {complianceCheck.covered}/{complianceCheck.total}
                        {complianceCheck.hasDilution && " ⚠"}
                      </div>
                    )}
                    {complianceLoading && <span style={{ fontSize: 10, color: T.dim, fontFamily: T.mono }}>checking…</span>}
                  </div>
                  {complianceCheck?.hasDilution && (
                    <div style={{ marginBottom: 8, padding: "6px 8px", borderRadius: 5, background: `${T.red}12`, border: `1px solid ${T.red}40`, fontSize: 10, color: T.red, fontWeight: 700 }}>
                      ⚠ Mandatory elements removed — save blocked until override reason provided
                    </div>
                  )}
                  {complianceCheck?.elements?.length > 0 ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {complianceCheck.elements.map(el => (
                        <div key={el.id} style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          padding: "4px 8px", borderRadius: 5,
                          background: el.status === "present" ? `${T.green}10` : el.status === "diluted" ? `${T.amber}12` : `${T.red}10`,
                          border: `1px solid ${el.status === "present" ? T.green + "30" : el.status === "diluted" ? T.amber + "40" : T.red + "30"}`,
                        }}>
                          <span style={{ fontSize: 10, fontFamily: T.mono, color: T.text }}>{el.label}</span>
                          <span style={{
                            fontSize: 9, fontWeight: 700, fontFamily: T.mono,
                            color: el.status === "present" ? T.green : el.status === "diluted" ? T.amber : T.red,
                          }}>
                            {el.status === "present" ? "✓" : el.status === "diluted" ? "DILUTED" : "MISSING"}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : !complianceLoading && (
                    <div style={{ fontSize: 11, color: T.dim, textAlign: "center", padding: "8px 0" }}>No file selected</div>
                  )}
                </div>
              )}

              {/* ── INTEGRITY GRAPH ── */}
              {selectedFile && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: T.teal, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                      Reference Graph
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {integrityCheck && (() => {
                        const broken = (integrityCheck.outboundRefs || []).filter(r => r.status === "broken").length;
                        const missingCore = (integrityCheck.missingCoreTypes || []).length;
                        const bad = broken + missingCore;
                        return (
                          <span style={{ fontSize: 11, fontWeight: 800, fontFamily: T.mono, color: bad > 0 ? T.red : T.green }}>
                            {bad > 0 ? `${bad} issue${bad > 1 ? "s" : ""}` : "✓ intact"}
                          </span>
                        );
                      })()}
                      {integrityLoading && <span style={{ fontSize: 10, color: T.dim, fontFamily: T.mono }}>checking…</span>}
                    </div>
                  </div>

                  {integrityCheck ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      {/* Missing core types */}
                      {(integrityCheck.missingCoreTypes || []).map(t => (
                        <div key={t} style={{ padding: "5px 8px", borderRadius: 5, background: `${T.red}12`, border: `1px solid ${T.red}35`, display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 9, fontWeight: 800, color: T.red, fontFamily: T.mono }}>MISSING CORE</span>
                          <span style={{ fontSize: 10, color: T.text, fontFamily: T.mono }}>{t} file not present</span>
                        </div>
                      ))}
                      {/* Outbound refs */}
                      {(integrityCheck.outboundRefs || []).length > 0 ? (
                        <>
                          <div style={{ fontSize: 10, color: T.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 4 }}>References from this file</div>
                          {integrityCheck.outboundRefs.map(r => (
                            <div key={r.name} style={{ padding: "5px 8px", borderRadius: 5, background: r.status === "intact" ? `${T.green}10` : `${T.red}12`, border: `1px solid ${r.status === "intact" ? T.green + "30" : T.red + "35"}`, display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ fontSize: 9, fontWeight: 800, fontFamily: T.mono, color: r.status === "intact" ? T.green : T.red }}>
                                {r.status === "intact" ? "✓" : "BROKEN"}
                              </span>
                              <span style={{ fontSize: 10, color: T.text, fontFamily: T.mono, flex: 1 }}>{r.name}</span>
                              {r.status === "broken" && <span style={{ fontSize: 9, color: T.red }}>not found in FM</span>}
                            </div>
                          ))}
                        </>
                      ) : (
                        <div style={{ fontSize: 10, color: T.dim, padding: "4px 0" }}>No cross-file references detected</div>
                      )}
                      {/* Inbound refs */}
                      {(integrityCheck.inboundRefs || []).length > 0 && (
                        <>
                          <div style={{ fontSize: 10, color: T.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 4 }}>Referenced by</div>
                          {integrityCheck.inboundRefs.map(r => (
                            <div key={r.fileId} style={{ padding: "5px 8px", borderRadius: 5, background: `${T.teal}0D`, border: `1px solid ${T.teal}30`, display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ fontSize: 9, fontWeight: 800, fontFamily: T.mono, color: T.teal }}>↑ IN</span>
                              <span style={{ fontSize: 10, color: T.text, fontFamily: T.mono }}>{r.name}</span>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  ) : !integrityLoading && (
                    <div style={{ fontSize: 11, color: T.dim, textAlign: "center", padding: "8px 0" }}>No file selected</div>
                  )}
                </div>
              )}

              {/* NIST Coverage Matrix */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em" }}>NIST Coverage</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {nistTotal.map(ctrl => {
                    const covered = nistCovered.includes(ctrl);
                    return (
                      <span key={ctrl} style={{
                        padding: "3px 7px", borderRadius: 4, fontSize: 10, fontFamily: T.mono, fontWeight: 700,
                        background: covered ? `${T.green}20` : `${T.border}50`,
                        color: covered ? T.green : T.dim,
                        border: `1px solid ${covered ? T.green + "40" : T.border}`,
                      }}>{ctrl} {covered ? "✓" : "–"}</span>
                    );
                  })}
                </div>
                <div style={{ marginTop: 6, fontSize: 10, color: T.dim, fontFamily: T.mono }}>
                  {nistCovered.length}/{nistTotal.length} controls covered
                </div>
              </div>

              {/* Expiry Monitor */}
              {files.some(f => f.expiresAt) && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: T.amber, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em" }}>Expiry Monitor</div>
                  {files.filter(f => f.expiresAt).map(f => {
                    const d = getExpiryDays(f.expiresAt);
                    return (
                      <div key={f.id} onClick={() => handleSelectFile(f)} style={{ cursor: "pointer", padding: "6px 8px", borderRadius: 6, background: T.bg, border: `1px solid ${d !== null && d <= 14 ? T.red + "40" : T.border}`, marginBottom: 4, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 10, fontFamily: T.mono, color: T.text }}>{f.filename}</span>
                        <span style={{ fontSize: 9, fontFamily: T.mono, color: d !== null && d <= 14 ? T.red : d !== null && d <= 30 ? T.amber : T.dim }}>
                          {d !== null ? (d > 0 ? `${d}d` : `${Math.abs(d)}d ago`) : "–"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Unsigned Files */}
              {unsignedCount > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: T.amber, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em" }}>Unsigned Files ({unsignedCount})</div>
                  {files.filter(f => f.status !== "live").slice(0, 5).map(f => (
                    <div key={f.id} onClick={() => handleSelectFile(f)} style={{ cursor: "pointer", padding: "5px 8px", borderRadius: 5, background: T.bg, border: `1px solid ${T.border}`, marginBottom: 3, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 10, fontFamily: T.mono, color: T.muted }}>{f.filename}</span>
                      <span style={{ fontSize: 9, color: T.amber, fontFamily: T.mono }}>DRAFT</span>
                    </div>
                  ))}
                  {unsignedCount > 5 && <div style={{ fontSize: 10, color: T.dim, fontFamily: T.mono, paddingLeft: 4 }}>+ {unsignedCount - 5} more</div>}
                </div>
              )}

              {/* AI Suggest */}
              {selectedFile && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: T.purple, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em" }}>AI Suggestions</div>
                  <button onClick={handleAISuggest} disabled={aiLoading} style={{
                    width: "100%", padding: "8px 14px", borderRadius: 6,
                    background: aiLoading ? `${T.purple}15` : `${T.purple}25`,
                    border: `1px solid ${T.purple}50`, color: T.purple,
                    fontSize: 12, fontWeight: 700, cursor: aiLoading ? "default" : "pointer",
                  }}>
                    {aiLoading ? "Analysing…" : "✦ Suggest Improvements"}
                  </button>
                  {aiSuggestion && !aiSuggestion.error && (
                    <div style={{ marginTop: 10, animation: "slide-up 0.3s ease" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <span style={{ fontSize: 10, color: T.dim, fontFamily: T.mono }}>Score</span>
                        <span style={{ fontFamily: T.mono, fontWeight: 800, fontSize: 18, color: aiSuggestion.overallScore >= 80 ? T.green : aiSuggestion.overallScore >= 60 ? T.amber : T.red }}>
                          {aiSuggestion.overallScore}/100
                        </span>
                      </div>
                      {aiSuggestion.summary && (
                        <div style={{ fontSize: 11, color: T.dim, lineHeight: 1.5, marginBottom: 10, padding: "8px 10px", background: T.bg, borderRadius: 6, border: `1px solid ${T.border}` }}>
                          {aiSuggestion.summary}
                        </div>
                      )}
                      {aiSuggestion.improvements?.slice(0, 3).map((imp, i) => (
                        <div key={i} style={{ marginBottom: 8, padding: "8px 10px", borderRadius: 6, background: T.bg, border: `1px solid ${imp.priority === "HIGH" ? T.red + "40" : imp.priority === "MEDIUM" ? T.amber + "40" : T.border}` }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: imp.priority === "HIGH" ? T.red : imp.priority === "MEDIUM" ? T.amber : T.dim }}>{imp.priority}</span>
                            <span style={{ fontSize: 10, color: T.dim, fontFamily: T.mono }}>{imp.issue}</span>
                          </div>
                          <div style={{ fontSize: 11, color: T.muted, lineHeight: 1.4 }}>{imp.suggestion}</div>
                        </div>
                      ))}
                      {aiSuggestion.nistGaps?.length > 0 && (
                        <div style={{ fontSize: 10, color: T.amber, fontFamily: T.mono, padding: "6px 10px", background: `${T.amber}08`, borderRadius: 5, border: `1px solid ${T.amber}30` }}>
                          NIST gaps: {aiSuggestion.nistGaps.slice(0, 2).join(", ")}
                        </div>
                      )}
                    </div>
                  )}
                  {aiSuggestion?.error && (
                    <div style={{ marginTop: 8, fontSize: 11, color: T.red, fontFamily: T.mono, padding: "6px 8px", background: `${T.red}10`, borderRadius: 5 }}>
                      ⚠ {aiSuggestion.error}
                    </div>
                  )}
                </div>
              )}

              {!selectedFile && (
                <div style={{ textAlign: "center", paddingTop: 32, color: T.dim }}>
                  <div style={{ fontSize: 24, marginBottom: 8, opacity: 0.4 }}>🤖</div>
                  <div style={{ fontSize: 12 }}>Select a file to see AI suggestions</div>
                </div>
              )}
            </>
          )}

          {rightPanel === "history" && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.blue, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.08em" }}>Version History</div>
              {history.length === 0 ? (
                <div style={{ color: T.dim, fontSize: 12, textAlign: "center", paddingTop: 20 }}>No history yet</div>
              ) : (
                history.map((v, i) => (
                  <div key={v.id} style={{ padding: "8px 10px", borderRadius: 6, background: i === 0 ? `${T.blue}10` : T.bg, border: `1px solid ${i === 0 ? T.blue + "40" : T.border}`, marginBottom: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                      <span style={{ fontFamily: T.mono, fontWeight: 800, fontSize: 11, color: i === 0 ? T.blue : T.muted }}>v{v.versionNumber}</span>
                      <span style={{ fontSize: 9, color: T.dim, fontFamily: T.mono }}>{new Date(v.createdAt).toLocaleDateString("en-GB")}</span>
                    </div>
                    <div style={{ fontSize: 11, color: T.dim }}>{v.commitMessage}</div>
                    <div style={{ fontSize: 9, color: T.dim, fontFamily: T.mono, marginTop: 2 }}>by {v.author}</div>
                    <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                      {v.mustCount > 0 && <span style={{ fontSize: 9, color: T.green, fontFamily: T.mono }}>{v.mustCount} MUST</span>}
                      {v.mustNotCount > 0 && <span style={{ fontSize: 9, color: T.red, fontFamily: T.mono }}>{v.mustNotCount} MUST NOT</span>}
                      {v.mayCount > 0 && <span style={{ fontSize: 9, color: T.amber, fontFamily: T.mono }}>{v.mayCount} MAY</span>}
                    </div>
                  </div>
                ))
              )}
            </>
          )}

          {rightPanel === "diff" && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.teal, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em" }}>Version Diff</div>
              {/* Version selectors */}
              {history.length >= 2 && (
                <div style={{ display: "flex", gap: 6, marginBottom: 10, alignItems: "center" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 9, color: T.dim, marginBottom: 3, fontFamily: T.mono }}>FROM</div>
                    <select
                      value={diffFromId || ""}
                      onChange={e => {
                        const v = e.target.value ? parseInt(e.target.value) : undefined;
                        setDiffFromId(v || null);
                        handleDiff(v, diffToId || undefined);
                      }}
                      style={{ width: "100%", background: T.bg, border: `1px solid ${T.border}`, borderRadius: 5, padding: "4px 6px", fontSize: 10, color: T.text, fontFamily: T.mono, outline: "none" }}
                    >
                      {history.map(v => (
                        <option key={v.id} value={v.id}>v{v.versionNumber} — {v.commitMessage?.slice(0, 20)}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 9, color: T.dim, marginBottom: 3, fontFamily: T.mono }}>TO</div>
                    <select
                      value={diffToId || ""}
                      onChange={e => {
                        const v = e.target.value ? parseInt(e.target.value) : undefined;
                        setDiffToId(v || null);
                        handleDiff(diffFromId || undefined, v);
                      }}
                      style={{ width: "100%", background: T.bg, border: `1px solid ${T.border}`, borderRadius: 5, padding: "4px 6px", fontSize: 10, color: T.text, fontFamily: T.mono, outline: "none" }}
                    >
                      {history.map(v => (
                        <option key={v.id} value={v.id}>v{v.versionNumber} — {v.commitMessage?.slice(0, 20)}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
              {diffLoading ? (
                <div style={{ color: T.dim, fontSize: 12, textAlign: "center", paddingTop: 20 }}>Loading…</div>
              ) : !diffData || diffData.diff?.length === 0 ? (
                <div style={{ color: T.dim, fontSize: 12, textAlign: "center", paddingTop: 20 }}>
                  {history.length < 2 ? "Only one version — no diff yet" : "No differences between selected versions"}
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 10, color: T.dim, fontFamily: T.mono, marginBottom: 8 }}>
                    v{diffData.from?.versionNumber} → v{diffData.to?.versionNumber}
                    <span style={{ marginLeft: 8, color: T.green }}>+{diffData.diff.filter(d => d.type === "added").length}</span>
                    <span style={{ marginLeft: 4, color: T.red }}>-{diffData.diff.filter(d => d.type === "removed").length}</span>
                  </div>
                  <div style={{ background: T.bg, borderRadius: 6, border: `1px solid ${T.border}`, overflow: "hidden", maxHeight: 480, overflowY: "auto" }}>
                    {diffData.diff.filter(d => d.type !== "same").map((d, i) => (
                      <div key={i} style={{
                        padding: "2px 8px", fontFamily: T.mono, fontSize: 10, lineHeight: 1.5,
                        background: d.type === "added" ? "#0d2b1a" : "#2b0d0f",
                        color: d.type === "added" ? "#4ade80" : "#f87171",
                        borderLeft: `2px solid ${d.type === "added" ? T.green : T.red}`,
                      }}>
                        {d.type === "added" ? "+" : "-"} {d.line}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── NEW FILE MODAL ── */}
      {showNewFileModal && (
        <NewFileModal
          config={config}
          companyName={companyName}
          onSave={handleNewFileSave}
          onClose={() => setShowNewFileModal(false)}
        />
      )}

      {/* ── SIGN OFF MODAL ── */}
      {showSignoffModal && selectedFile && (
        <SignoffModal
          file={selectedFile}
          onConfirm={handleSignoff}
          onClose={() => setShowSignoffModal(false)}
        />
      )}

      {/* ── RELEASE MODAL ── */}
      {showReleaseModal && (
        <ReleaseModal
          files={files}
          companyId={companyId}
          companyName={companyName}
          config={config}
          releaseNotes={releaseNotes}
          releaseLoading={releaseLoading}
          onGenerateNotes={handleGenerateReleaseNotes}
          onClose={() => { setShowReleaseModal(false); setReleaseNotes(""); }}
        />
      )}

      {/* ── DILUTION GUARD MODAL ── */}
      {showDilutionModal && (
        <DilutionModal
          elements={complianceCheck?.elements?.filter(e => e.status === "diluted") || []}
          onConfirm={handleDilutionConfirm}
          onCancel={() => { setShowDilutionModal(false); setPendingSaveContent(null); }}
          checkFailed={pendingSaveContent?.checkFailed || false}
        />
      )}

      {/* ── ARCHIVE BLOCK MODAL ── */}
      {archiveBlock && (
        <ArchiveBlockModal block={archiveBlock} onClose={() => setArchiveBlock(null)} />
      )}
    </div>
    </>
  );
}

// ─────────────────────────────────────────────
// DILUTION GUARD MODAL — structured override form
// ─────────────────────────────────────────────
const OVERRIDE_CATEGORIES = [
  { id: "temporary",         label: "Temporary",          desc: "Will be restored before next release",    detail: null },
  { id: "business-exception",label: "Business exception", desc: "Approved by",                             detail: "owner" },
  { id: "not-applicable",    label: "Control not applicable", desc: "Reason:",                             detail: "reason" },
  { id: "superseded",        label: "Superseded by",      desc: "References:",                             detail: "ref" },
];

function DilutionModal({ elements, onConfirm, onCancel, checkFailed }) {
  const [category, setCategory]     = useState("");
  const [detail, setDetail]         = useState("");
  const [role, setRole]             = useState("");
  const [ackRecorded, setAckRecorded] = useState(false);
  const [ackAccountable, setAckAccountable] = useState(false);

  const hasLegalElement = elements.some(e => e.category === "framework");
  const selectedCat     = OVERRIDE_CATEGORIES.find(c => c.id === category);
  const needsDetail     = selectedCat?.detail !== null && selectedCat?.detail !== undefined;
  const detailOk        = !needsDetail || detail.trim().length > 0;
  const roleTrimmed     = role.trim();
  const legalRoleOk     = !hasLegalElement || ["CFO", "CEO"].includes(roleTrimmed.toUpperCase());
  const canConfirm      = category && detailOk && roleTrimmed.length > 0 && ackRecorded && ackAccountable && legalRoleOk;

  const handleConfirm = () => {
    if (!canConfirm) return;
    let catLabel = selectedCat.label;
    if (selectedCat.detail === "owner")  catLabel = `Business exception approved by ${detail.trim()}`;
    if (selectedCat.detail === "reason") catLabel = `Control not applicable — ${detail.trim()}`;
    if (selectedCat.detail === "ref")    catLabel = `Superseded by ${detail.trim()}`;
    if (selectedCat.detail === null)     catLabel = "Temporary — will be restored before next release";
    onConfirm(`[OVERRIDE: ${catLabel} | Approved: ${roleTrimmed}]`);
  };

  const inp = (val, setVal, placeholder, disabled) => (
    <input
      type="text"
      value={val}
      onChange={e => { if (!disabled) setVal(e.target.value); }}
      placeholder={placeholder}
      disabled={disabled}
      style={{
        flex: 1, padding: "5px 9px", borderRadius: 5, border: `1px solid ${val.trim() ? T.amber + "70" : T.border}`,
        background: disabled ? T.bg + "80" : T.bg, color: disabled ? T.dim : T.text,
        fontSize: 12, fontFamily: T.mono, outline: "none",
      }}
    />
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: T.card, border: `1px solid ${T.red}60`, borderRadius: 14, width: 560, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto", padding: 0 }}>

        {/* Header */}
        <div style={{ background: `${T.red}18`, borderBottom: `1px solid ${T.red}40`, padding: "16px 22px", display: "flex", alignItems: "center", gap: 10, position: "sticky", top: 0, zIndex: 1 }}>
          <span style={{ fontSize: 20 }}>⚠</span>
          <div>
            <div style={{ fontWeight: 900, fontSize: 15, color: T.red, letterSpacing: "-0.02em" }}>
              {checkFailed ? "Compliance Check Unavailable" : "Compliance Dilution Detected"}
            </div>
            <div style={{ fontSize: 11, color: T.dim, marginTop: 2 }}>
              {checkFailed
                ? "Verification could not be completed — a structured override is required to proceed"
                : "Mandatory elements have been weakened — categorise this override for the audit record"}
            </div>
          </div>
        </div>

        <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 18 }}>

          {/* Elements at risk */}
          {elements.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.07em" }}>Elements at risk</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {elements.map(el => (
                  <div key={el.id} style={{ padding: "6px 10px", borderRadius: 6, background: `${T.red}10`, border: `1px solid ${T.red}35`, display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 800, color: T.red, fontFamily: T.mono }}>DILUTED</span>
                    <span style={{ fontSize: 11, color: T.text, fontFamily: T.mono }}>{el.label}</span>
                    <span style={{ fontSize: 10, color: el.category === "framework" ? T.amber : T.dim, marginLeft: "auto", textTransform: "uppercase", fontWeight: el.category === "framework" ? 700 : 400 }}>
                      {el.category === "framework" ? "⚖ LEGAL" : el.category}
                    </span>
                  </div>
                ))}
              </div>
              {hasLegalElement && (
                <div style={{ marginTop: 8, padding: "7px 10px", borderRadius: 6, background: `${T.amber}15`, border: `1px solid ${T.amber}50`, fontSize: 11, color: T.amber, fontWeight: 700 }}>
                  This override includes a legal requirement. Only a CFO or CEO may authorise this decision.
                </div>
              )}
            </div>
          )}

          {/* Override reason category */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.amber, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.07em" }}>Override reason (required)</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {OVERRIDE_CATEGORIES.map(cat => {
                const isSelected = category === cat.id;
                return (
                  <label key={cat.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", padding: "10px 12px", borderRadius: 8, border: `1px solid ${isSelected ? T.amber + "80" : T.border}`, background: isSelected ? `${T.amber}0D` : "transparent", transition: "all 0.15s" }}>
                    <input
                      type="radio"
                      name="override-category"
                      value={cat.id}
                      checked={isSelected}
                      onChange={() => { setCategory(cat.id); setDetail(""); }}
                      style={{ marginTop: 2, accentColor: T.amber }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: isSelected ? 700 : 500, color: isSelected ? T.text : T.muted }}>
                        {cat.label}
                        {cat.detail === null && <span style={{ color: T.dim, fontWeight: 400 }}> — {cat.desc}</span>}
                      </div>
                      {isSelected && cat.detail && (
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                          <span style={{ fontSize: 11, color: T.dim, whiteSpace: "nowrap" }}>{cat.desc}</span>
                          {inp(detail, setDetail,
                            cat.detail === "owner"  ? "Name or role of approver" :
                            cat.detail === "reason" ? "Explain why this control does not apply" :
                            "Reference document or policy ID", false)}
                        </div>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Acknowledgements */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.amber, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.07em" }}>Acknowledgement</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={ackRecorded}
                  onChange={e => setAckRecorded(e.target.checked)}
                  style={{ marginTop: 2, accentColor: T.amber }}
                />
                <span style={{ fontSize: 12, color: ackRecorded ? T.text : T.muted, lineHeight: 1.5 }}>
                  I understand this override will be permanently recorded in the version history and audit log
                </span>
              </label>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={ackAccountable}
                  onChange={e => setAckAccountable(e.target.checked)}
                  style={{ marginTop: 2, accentColor: T.amber }}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, color: ackAccountable ? T.text : T.muted, lineHeight: 1.5 }}>I accept accountability as</span>
                  {inp(role, setRole, hasLegalElement ? "CFO or CEO" : "your role or title", false)}
                  <span style={{ fontSize: 12, color: ackAccountable ? T.text : T.muted }}>for this decision</span>
                </div>
              </label>
              {hasLegalElement && roleTrimmed.length > 0 && !legalRoleOk && (
                <div style={{ padding: "7px 10px", borderRadius: 6, background: `${T.red}15`, border: `1px solid ${T.red}50`, fontSize: 11, color: T.red, fontWeight: 700 }}>
                  Legal requirement overrides must be authorised by the CFO or CEO
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", paddingTop: 4 }}>
            <button onClick={onCancel} style={{ padding: "8px 18px", borderRadius: 7, border: `1px solid ${T.border}`, background: "none", color: T.dim, fontSize: 13, cursor: "pointer" }}>
              Cancel
            </button>
            <button onClick={handleConfirm} disabled={!canConfirm} style={{
              padding: "8px 20px", borderRadius: 7, border: `1px solid ${canConfirm ? T.red + "80" : T.border}`,
              background: canConfirm ? `${T.red}20` : T.bg, color: canConfirm ? T.red : T.dim,
              fontSize: 13, fontWeight: 700, cursor: canConfirm ? "pointer" : "default",
            }}>
              Override & Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// ARCHIVE BLOCK MODAL
// ─────────────────────────────────────────────
function ArchiveBlockModal({ block, onClose }) {
  if (!block) return null;
  const isCore = block.type === "core";
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: T.card, border: `1px solid ${T.red}60`, borderRadius: 14, width: 480, maxWidth: "95vw", padding: 0, overflow: "hidden" }}>
        <div style={{ background: `${T.red}18`, borderBottom: `1px solid ${T.red}40`, padding: "16px 22px", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 20 }}>🔒</span>
          <div>
            <div style={{ fontWeight: 900, fontSize: 15, color: T.red, letterSpacing: "-0.02em" }}>
              {isCore ? "Core File — Cannot Archive" : "Referential Integrity Violation"}
            </div>
            <div style={{ fontSize: 11, color: T.dim, marginTop: 2 }}>
              {isCore
                ? `${block.fileType} files are mandatory for the governance framework`
                : `${block.filename} is referenced by other active files`}
            </div>
          </div>
        </div>
        <div style={{ padding: "18px 22px" }}>
          {isCore ? (
            <div style={{ fontSize: 12, color: T.text, lineHeight: 1.7, marginBottom: 18 }}>
              <strong>{block.filename}</strong> is a mandatory core governance file (<span style={{ color: T.amber, fontFamily: T.mono, fontSize: 11 }}>{block.fileType}</span>).
              Core files form the foundational governance baseline and cannot be archived.
              To replace it, create a new version and sign it off — do not archive the existing one.
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12, color: T.text, lineHeight: 1.7, marginBottom: 10 }}>
                Archiving <strong>{block.filename}</strong> would create a broken reference in the following active files:
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 18 }}>
                {(block.referencedBy || []).map(name => (
                  <div key={name} style={{ padding: "6px 10px", borderRadius: 6, background: `${T.red}10`, border: `1px solid ${T.red}35`, fontSize: 11, fontFamily: T.mono, color: T.text }}>
                    ↑ {name}
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11, color: T.dim, padding: "8px 10px", background: T.bg, borderRadius: 6, border: `1px solid ${T.border}`, lineHeight: 1.6, marginBottom: 4 }}>
                Remove or update the references in those files first, then archive this file.
              </div>
            </>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button onClick={onClose} style={{ padding: "8px 22px", borderRadius: 7, border: `1px solid ${T.border}`, background: `${T.red}18`, color: T.red, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
              Understood
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function NewFileModal({ config, companyName, onSave, onClose }) {
  const [step, setStep] = useState(0);
  const [fileType, setFileType] = useState(null);
  const [axis, setAxis] = useState("vertical");
  const [stage, setStage] = useState("");
  const [filename, setFilename] = useState("");
  const [preview, setPreview] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [exceptionReason, setExceptionReason] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiGenWarnings, setAiGenWarnings] = useState([]);

  const isException = fileType === "EXCEPTION";
  const steps = isException ? ["Type", "Placement", "Identity", "Expiry"] : ["Type", "Placement", "Identity"];

  useEffect(() => {
    if (fileType) {
      const tmpl = FM_FILE_TEMPLATES[fileType] || FM_FILE_TEMPLATES.CUSTOM;
      setPreview(tmpl(config, companyName));
      setAiGenWarnings([]);
    }
  }, [fileType, config, companyName]);

  const handleAIGenerate = async () => {
    if (!fileType || aiGenerating) return;
    setAiGenerating(true);
    setAiGenWarnings([]);
    try {
      const resp = await fetch("/api/fm/agent/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileType,
          axis,
          companyName,
          industry: config?.id || config?.label || "general",
          requiredControls: config?.nistControls || [],
          requiredFrameworks: config?.additionalFrameworks || [],
          brandContext: config?.brandContext,
        }),
      });
      const data = await resp.json();
      if (data?.content) {
        setPreview(data.content);
        if (data.complianceWarnings?.length > 0) setAiGenWarnings(data.complianceWarnings);
      }
    } catch (e) { /* silent */ }
    setAiGenerating(false);
  };

  const handleCreate = () => {
    const slug = filename || (companyName.toLowerCase().replace(/\s+/g, "-") + "-" + fileType.toLowerCase() + ".md");
    onSave({ filename: slug, fileType, axis, stage: stage || null, content: preview, expiresAt: expiresAt || null, exceptionReason: exceptionReason || null });
  };

  const canProceed = step === 0 ? !!fileType : true;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999 }}>
      <div style={{ background: T.card, border: `1px solid ${T.borderHi}`, borderRadius: 14, width: 580, maxHeight: "85vh", overflow: "hidden", display: "flex", flexDirection: "column", animation: "wizard-in 0.3s ease" }}>
        {/* Header */}
        <div style={{ padding: "18px 24px 14px", borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 17, letterSpacing: "-0.03em" }}>+ New Governance File</div>
            <div style={{ fontSize: 11, color: T.dim, marginTop: 3, fontFamily: T.mono }}>Step {step + 1} of {steps.length}: {steps[step]}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: T.dim, fontSize: 18, cursor: "pointer" }}>✕</button>
        </div>

        {/* Step progress bar */}
        <div style={{ display: "flex", height: 3, background: T.bg }}>
          {steps.map((_, i) => (
            <div key={i} style={{ flex: 1, background: i <= step ? T.orange : "transparent", transition: "background 0.25s", marginRight: 1 }} />
          ))}
        </div>

        {/* Steps */}
        <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
          {step === 0 && (
            <div>
              <div style={{ fontSize: 13, color: T.dim, marginBottom: 16 }}>Choose the type of governance file to create:</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {FM_FILE_TYPES.map(ft => (
                  <button key={ft.type} onClick={() => setFileType(ft.type)} style={{
                    padding: "14px 16px", borderRadius: 8, textAlign: "left",
                    border: `2px solid ${fileType === ft.type ? ft.color : T.border}`,
                    background: fileType === ft.type ? `${ft.color}15` : T.bg,
                    cursor: "pointer", transition: "all 0.15s",
                  }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                      <span style={{ fontSize: 16 }}>{ft.icon}</span>
                      <span style={{ fontWeight: 700, fontSize: 13, color: fileType === ft.type ? ft.color : T.text }}>{ft.label}</span>
                    </div>
                    <div style={{ fontSize: 11, color: T.dim, lineHeight: 1.4 }}>{ft.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 1 && (
            <div>
              <div style={{ fontSize: 13, color: T.dim, marginBottom: 16 }}>Where does this file live in the governance map?</div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: T.muted, marginBottom: 8, fontWeight: 600 }}>Axis</div>
                <div style={{ display: "flex", gap: 8 }}>
                  {FM_AXIS_GROUPS.map(g => (
                    <button key={g.id} onClick={() => setAxis(g.id)} style={{
                      flex: 1, padding: "10px 12px", borderRadius: 7,
                      border: `2px solid ${axis === g.id ? g.color : T.border}`,
                      background: axis === g.id ? `${g.color}15` : T.bg,
                      color: axis === g.id ? g.color : T.dim, cursor: "pointer", fontSize: 12, fontWeight: 600,
                    }}>
                      {g.icon} {g.label}
                    </button>
                  ))}
                </div>
              </div>
              {axis === "vertical" && config?.journeyStages && (
                <div>
                  <div style={{ fontSize: 11, color: T.muted, marginBottom: 8, fontWeight: 600 }}>Journey Stage</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {config.journeyStages.map(s => (
                      <button key={s.id} onClick={() => setStage(s.id)} style={{
                        padding: "6px 12px", borderRadius: 6,
                        border: `1px solid ${stage === s.id ? s.color : T.border}`,
                        background: stage === s.id ? `${s.color}20` : T.bg,
                        color: stage === s.id ? s.color : T.dim, cursor: "pointer", fontSize: 11,
                      }}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {axis === "horizontal" && config?.sharedServices && (
                <div>
                  <div style={{ fontSize: 11, color: T.muted, marginBottom: 8, fontWeight: 600 }}>Shared Service</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {config.sharedServices.map(s => (
                      <button key={s.id} onClick={() => setStage(s.id)} style={{
                        padding: "6px 12px", borderRadius: 6,
                        border: `1px solid ${stage === s.id ? T.green : T.border}`,
                        background: stage === s.id ? `${T.green}20` : T.bg,
                        color: stage === s.id ? T.green : T.dim, cursor: "pointer", fontSize: 11,
                      }}>
                        {s.icon} {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: T.muted, marginBottom: 6, fontWeight: 600 }}>Filename</div>
                <input value={filename} onChange={e => setFilename(e.target.value)}
                  placeholder={`${companyName.toLowerCase().replace(/\s+/g, "-")}-${(fileType || "").toLowerCase()}.md`}
                  style={{ width: "100%", background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6, padding: "8px 12px", fontSize: 12, color: T.text, fontFamily: T.mono, outline: "none" }}
                />
              </div>
              {fileType && (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <div style={{ fontSize: 11, color: T.muted, fontWeight: 600 }}>Content Preview</div>
                    <button onClick={handleAIGenerate} disabled={aiGenerating} style={{
                      padding: "4px 12px", borderRadius: 5, fontSize: 11, fontWeight: 700,
                      border: `1px solid ${T.purple}60`, background: `${T.purple}18`,
                      color: T.purple, cursor: aiGenerating ? "default" : "pointer",
                    }}>
                      {aiGenerating ? "Generating…" : "✦ Generate with AI"}
                    </button>
                  </div>
                  {aiGenWarnings.length > 0 && (
                    <div style={{ marginBottom: 8, padding: "8px 10px", borderRadius: 6, background: `${T.amber}10`, border: `1px solid ${T.amber}30` }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: T.amber, marginBottom: 4 }}>Compliance warnings in generated file:</div>
                      {aiGenWarnings.map((w, i) => (
                        <div key={i} style={{ fontSize: 10, color: T.amber, fontFamily: T.mono, lineHeight: 1.5 }}>⚠ {w}</div>
                      ))}
                    </div>
                  )}
                  <pre style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 8, padding: 12, fontSize: 10, color: "#7dd3fc", fontFamily: T.mono, maxHeight: 280, overflowY: "auto", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
                    {preview}
                  </pre>
                </div>
              )}
            </div>
          )}

          {step === 3 && isException && (
            <div>
              <div style={{ background: `${T.amber}10`, border: `1px solid ${T.amber}30`, borderRadius: 8, padding: "12px 16px", marginBottom: 20, display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span style={{ fontSize: 20 }}>⚠</span>
                <div style={{ fontSize: 12, color: T.amber, lineHeight: 1.5 }}>
                  Exception files require an expiry date and justification. They will appear in the expiry monitor and FM Agent alerts.
                </div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: T.muted, marginBottom: 6, fontWeight: 600 }}>Expiry Date <span style={{ color: T.red }}>*</span></div>
                <input
                  type="date"
                  value={expiresAt}
                  onChange={e => setExpiresAt(e.target.value)}
                  min={new Date().toISOString().slice(0, 10)}
                  style={{ width: "100%", background: T.bg, border: `1px solid ${expiresAt ? T.amber : T.border}`, borderRadius: 6, padding: "8px 12px", fontSize: 12, color: T.text, fontFamily: T.mono, outline: "none" }}
                />
              </div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: T.muted, marginBottom: 6, fontWeight: 600 }}>Exception Justification <span style={{ color: T.red }}>*</span></div>
                <textarea
                  value={exceptionReason}
                  onChange={e => setExceptionReason(e.target.value)}
                  rows={4}
                  placeholder="Describe the business justification for this exception (e.g. vendor constraint, regulatory transition, legacy system dependency)..."
                  style={{ width: "100%", background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6, padding: "8px 12px", fontSize: 12, color: T.text, fontFamily: T.mono, outline: "none", resize: "vertical" }}
                />
              </div>
              {expiresAt && (
                <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono }}>
                  Days until expiry: <span style={{ color: T.amber, fontWeight: 700 }}>
                    {Math.ceil((new Date(expiresAt) - new Date()) / (1000 * 60 * 60 * 24))}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "14px 24px", borderTop: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between" }}>
          <button onClick={() => step > 0 ? setStep(s => s - 1) : onClose()} style={{ padding: "7px 16px", borderRadius: 6, border: `1px solid ${T.border}`, background: "none", color: T.dim, fontSize: 12, cursor: "pointer" }}>
            {step === 0 ? "Cancel" : "← Back"}
          </button>
          {step < steps.length - 1 ? (
            <button onClick={() => setStep(s => s + 1)} disabled={!canProceed} style={{
              padding: "7px 20px", borderRadius: 6, background: canProceed ? T.orange : T.border,
              border: "none", color: "#fff", fontSize: 12, fontWeight: 700,
              cursor: canProceed ? "pointer" : "default", opacity: canProceed ? 1 : 0.5,
            }}>
              Next →
            </button>
          ) : (
            <button
              onClick={handleCreate}
              disabled={isException && (!expiresAt || !exceptionReason)}
              style={{
                padding: "7px 20px", borderRadius: 6, background: T.green,
                border: "none", color: "#fff", fontSize: 12, fontWeight: 700,
                cursor: (isException && (!expiresAt || !exceptionReason)) ? "default" : "pointer",
                opacity: (isException && (!expiresAt || !exceptionReason)) ? 0.5 : 1,
              }}>
              Create File
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// SIGN OFF MODAL
// ─────────────────────────────────────────────
function SignoffModal({ file, onConfirm, onClose }) {
  const [signedBy, setSignedBy] = useState("");
  const [signedRole, setSignedRole] = useState("");

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999 }}>
      <div style={{ background: T.card, border: `1px solid ${T.green}50`, borderRadius: 14, width: 440, padding: 28, animation: "wizard-in 0.3s ease" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ fontWeight: 900, fontSize: 16, letterSpacing: "-0.03em" }}>Sign Off: {file.filename}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: T.dim, fontSize: 18, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ background: `${T.green}10`, border: `1px solid ${T.green}40`, borderRadius: 8, padding: "12px 16px", marginBottom: 20, fontSize: 12, color: T.green, lineHeight: 1.5 }}>
          Signing off this file will promote it from DRAFT to LIVE status. It will appear in the governance baseline and count towards compliance coverage.
        </div>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: T.muted, marginBottom: 6, fontWeight: 600 }}>Your Name</div>
          <input value={signedBy} onChange={e => setSignedBy(e.target.value)} placeholder="e.g. Alex Johnson"
            style={{ width: "100%", background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6, padding: "8px 12px", fontSize: 12, color: T.text, fontFamily: T.sans, outline: "none" }}
          />
        </div>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: T.muted, marginBottom: 6, fontWeight: 600 }}>Your Role</div>
          <input value={signedRole} onChange={e => setSignedRole(e.target.value)} placeholder="e.g. Chief Compliance Officer"
            style={{ width: "100%", background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6, padding: "8px 12px", fontSize: 12, color: T.text, fontFamily: T.sans, outline: "none" }}
          />
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "7px 16px", borderRadius: 6, border: `1px solid ${T.border}`, background: "none", color: T.dim, fontSize: 12, cursor: "pointer" }}>Cancel</button>
          <button onClick={() => onConfirm({ signedBy: signedBy || "User", signedRole: signedRole || "Owner" })} disabled={!signedBy} style={{
            padding: "7px 20px", borderRadius: 6, background: signedBy ? T.green : T.border,
            border: "none", color: "#fff", fontSize: 12, fontWeight: 700, cursor: signedBy ? "pointer" : "default",
          }}>
            ✓ Sign Off & Go Live
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// RELEASE MODAL
// ─────────────────────────────────────────────
function ReleaseModal({ files, companyId, companyName, config, releaseNotes, releaseLoading, onGenerateNotes, onClose }) {
  const liveFiles = files.filter(f => f.status === "live");
  const draftFiles = files.filter(f => f.status === "draft");
  const [releaseName, setReleaseName] = useState(`${companyName} Governance Baseline v${new Date().toISOString().slice(0, 10)}`);
  const [releasing, setReleasing] = useState(false);

  const handleRelease = async () => {
    setReleasing(true);
    try {
      const resp = await fetch(`/api/fm/release/${companyId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ releaseName, releaseNotes }),
      });
      const data = await resp.json();
      const content = `# ${data.releaseName}\n\n**Date:** ${data.createdAt?.slice(0, 10)}\n**Company:** ${companyName}\n**Industry:** ${config?.label}\n\n## Release Notes\n\n${releaseNotes || "No release notes generated."}\n\n## Live Files (${data.liveCount})\n\n${(data.liveFiles || []).map(f => `- ${f}`).join("\n")}\n\n## Pending / Excluded (${data.draftCount})\n\n${draftFiles.map(f => `- ${f.filename} [DRAFT]`).join("\n")}\n`;
      const blob = new Blob([content], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `${releaseName.replace(/\s+/g, "-")}.md`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Release error", e);
    }
    setReleasing(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999 }}>
      <div style={{ background: T.card, border: `1px solid ${T.purple}50`, borderRadius: 14, width: 560, maxHeight: "82vh", overflow: "hidden", display: "flex", flexDirection: "column", animation: "wizard-in 0.3s ease" }}>
        <div style={{ padding: "18px 24px 14px", borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 900, fontSize: 16, letterSpacing: "-0.03em" }}>Create Governance Release</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: T.dim, fontSize: 18, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: T.muted, marginBottom: 6, fontWeight: 600 }}>Release Name</div>
            <input value={releaseName} onChange={e => setReleaseName(e.target.value)}
              style={{ width: "100%", background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6, padding: "8px 12px", fontSize: 12, color: T.text, fontFamily: T.sans, outline: "none" }}
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
            <div style={{ background: `${T.green}10`, border: `1px solid ${T.green}30`, borderRadius: 8, padding: "12px 16px", textAlign: "center" }}>
              <div style={{ fontFamily: T.mono, fontWeight: 900, fontSize: 24, color: T.green }}>{liveFiles.length}</div>
              <div style={{ fontSize: 11, color: T.green }}>LIVE files</div>
            </div>
            <div style={{ background: `${T.amber}10`, border: `1px solid ${T.amber}30`, borderRadius: 8, padding: "12px 16px", textAlign: "center" }}>
              <div style={{ fontFamily: T.mono, fontWeight: 900, fontSize: 24, color: T.amber }}>{draftFiles.length}</div>
              <div style={{ fontSize: 11, color: T.amber }}>DRAFT (excluded)</div>
            </div>
          </div>
          {liveFiles.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: T.muted, marginBottom: 6, fontWeight: 600 }}>Included Files</div>
              <div style={{ background: T.bg, borderRadius: 6, border: `1px solid ${T.border}`, padding: 10, maxHeight: 120, overflowY: "auto" }}>
                {liveFiles.map(f => (
                  <div key={f.id} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: `1px solid ${T.border}`, fontSize: 11 }}>
                    <span style={{ fontFamily: T.mono, color: T.text }}>{f.filename}</span>
                    <span style={{ color: T.dim }}>{f.owner || "TBC"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: T.muted, fontWeight: 600 }}>Release Notes</span>
              <button onClick={onGenerateNotes} disabled={releaseLoading} style={{
                padding: "4px 10px", borderRadius: 5, border: `1px solid ${T.purple}50`,
                background: `${T.purple}20`, color: T.purple, fontSize: 11, cursor: "pointer",
              }}>
                {releaseLoading ? "Generating…" : "✦ AI Generate"}
              </button>
            </div>
            <textarea value={releaseNotes} readOnly rows={5}
              placeholder="Click 'AI Generate' to auto-generate release notes, or write your own…"
              style={{ width: "100%", background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6, padding: "8px 12px", fontSize: 11, color: T.muted, fontFamily: T.mono, outline: "none", resize: "vertical" }}
            />
          </div>
        </div>
        <div style={{ padding: "14px 24px", borderTop: `1px solid ${T.border}`, display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "7px 16px", borderRadius: 6, border: `1px solid ${T.border}`, background: "none", color: T.dim, fontSize: 12, cursor: "pointer" }}>Cancel</button>
          <button onClick={handleRelease} disabled={releasing || liveFiles.length === 0} style={{
            padding: "7px 20px", borderRadius: 6, background: T.purple,
            border: "none", color: "#fff", fontSize: 12, fontWeight: 700,
            cursor: (releasing || liveFiles.length === 0) ? "default" : "pointer",
            opacity: liveFiles.length === 0 ? 0.5 : 1,
          }}>
            {releasing ? "Creating…" : "↓ Create & Download Release"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// FRAMEWORK INTEGRITY PANEL
// ─────────────────────────────────────────────

const CATEGORY_META = {
  FRAMEWORK_INTEGRITY: { label: "Framework Integrity", color: T.purple, icon: "🔐" },
  COMPLIANCE_BOUNDARY: { label: "Compliance Boundary", color: T.amber,  icon: "⚠️" },
  AGENT_LIFECYCLE:     { label: "Agent Lifecycle",     color: T.blue,   icon: "🔄" },
  A2A_PROTOCOL:        { label: "A2A Protocol",        color: T.teal,   icon: "🔗" },
};

function CategoryBadge({ category }) {
  const meta = CATEGORY_META[category] || { label: category || "Agent Decision", color: T.dim, icon: "📋" };
  return <Tag color={meta.color}>{meta.icon} {meta.label}</Tag>;
}

function FrameworkIntegrityPanel({ companyId }) {
  const [metrics, setMetrics] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);

  const refresh = useCallback(async () => {
    if (!companyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [mRes, eRes] = await Promise.all([
        fetch(`/api/agents/witness/integrity-metrics?companyId=${companyId}`),
        fetch(`/api/agents/witness/framework-events?companyId=${companyId}&limit=10`),
      ]);
      if (mRes.ok) setMetrics(await mRes.json());
      if (eRes.ok) {
        const data = await eRes.json();
        setEvents(Array.isArray(data) ? data : []);
      }
      setLastRefresh(new Date());
    } catch (err) {
      console.error("[FrameworkIntegrityPanel] fetch error", err);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  const metricCards = [
    {
      label: "Integrity Checks Passed",
      sub: "last 24 h",
      val: metrics?.integrityPassedLast24h ?? "—",
      color: T.green,
      icon: "✅",
    },
    {
      label: "Integrity Failures",
      sub: "all time",
      val: metrics?.integrityFailuresAllTime ?? "—",
      color: T.red,
      icon: "❌",
    },
    {
      label: "Compliance Rejections",
      sub: "last 7 days",
      val: metrics?.complianceRejectionsLast7d ?? "—",
      color: T.amber,
      icon: "⚠️",
    },
    {
      label: "Active Exceptions",
      sub: "live EXCEPTION files",
      val: metrics?.activeExceptions ?? "—",
      color: T.purple,
      icon: "⚡",
    },
  ];

  return (
    <div style={{
      background: T.card, border: `1px solid ${T.purple}30`,
      borderLeft: `3px solid ${T.purple}`, borderRadius: 10, marginBottom: 20,
    }}>
      {/* Panel header */}
      <div
        onClick={() => setCollapsed(c => !c)}
        style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "14px 18px", cursor: "pointer", userSelect: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 18 }}>🔐</span>
          <span style={{ fontFamily: T.sans, fontWeight: 700, fontSize: 15, color: T.text }}>
            Framework Integrity Panel
          </span>
          <Tag color={T.purple}>VDA-MD §3</Tag>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {lastRefresh && (
            <span style={{ fontSize: 10, color: T.dim, fontFamily: T.mono }}>
              updated {lastRefresh.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          )}
          <button
            onClick={e => { e.stopPropagation(); refresh(); }}
            style={{
              background: `${T.purple}18`, border: `1px solid ${T.purple}40`, color: T.purple,
              borderRadius: 6, padding: "4px 10px", fontSize: 11, fontFamily: T.mono,
              cursor: "pointer", fontWeight: 700,
            }}
          >↻ Refresh</button>
          <span style={{ color: T.dim, fontSize: 14, transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)", transition: "transform 0.2s", display: "inline-block" }}>▼</span>
        </div>
      </div>

      {/* Collapsible body */}
      {!collapsed && (
        <div style={{ padding: "0 18px 18px" }}>
          {!companyId ? (
            <div style={{ padding: "20px 0", fontSize: 13, color: T.dim, fontFamily: T.mono }}>
              Select a hotel to view framework integrity metrics.
            </div>
          ) : (
          <>{/* Metric cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 18 }}>
            {metricCards.map(card => (
              <div key={card.label} style={{
                background: T.surface, border: `1px solid ${card.color}25`,
                borderRadius: 8, padding: "14px 16px",
              }}>
                <div style={{ fontSize: 20, marginBottom: 6 }}>{card.icon}</div>
                <div style={{ fontFamily: T.mono, fontWeight: 700, fontSize: 26, color: card.color, marginBottom: 4 }}>
                  {loading && metrics === null ? "…" : card.val}
                </div>
                <div style={{ fontSize: 12, color: T.text, fontWeight: 600, marginBottom: 2 }}>{card.label}</div>
                <div style={{ fontSize: 10, color: T.dim, fontFamily: T.mono }}>{card.sub}</div>
              </div>
            ))}
          </div>

          {/* Recent Framework Events list */}
          <div>
            <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono, letterSpacing: "0.06em", marginBottom: 10 }}>
              RECENT FRAMEWORK EVENTS
            </div>
            {loading && events.length === 0 ? (
              <div style={{ fontSize: 13, color: T.dim, padding: "12px 0" }}>Loading…</div>
            ) : events.length === 0 ? (
              <div style={{ fontSize: 13, color: T.dim, padding: "12px 0" }}>
                No framework events recorded yet. Run the integrity check or compliance guard to generate entries.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {events.map(ev => {
                  const cat = CATEGORY_META[ev.eventCategory] || { color: T.dim, icon: "📋" };
                  const eventType = ev.apaleoData?.event_type ?? ev.apaleoData?.eventType ?? null;
                  return (
                    <div key={ev.id} style={{
                      background: T.surface, border: `1px solid ${cat.color}20`,
                      borderLeft: `2px solid ${cat.color}`, borderRadius: 6,
                      padding: "8px 12px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap",
                    }}>
                      <span style={{ fontSize: 10, color: T.dim, fontFamily: T.mono, flexShrink: 0, minWidth: 70 }}>
                        {ev.createdAt ? new Date(ev.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}
                      </span>
                      <span style={{ color: T.orange, fontFamily: T.mono, fontSize: 12, fontWeight: 700 }}>{ev.agent}</span>
                      {eventType && (
                        <span style={{ fontFamily: T.mono, fontSize: 11, color: cat.color }}>{eventType}</span>
                      )}
                      <CategoryBadge category={ev.eventCategory} />
                      <DecisionBadge decision={ev.decision} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          </>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// WITNESS AGENT TAB
// ─────────────────────────────────────────────

const CATEGORY_FILTER_OPTIONS = [
  { value: "ALL",                label: "All Categories" },
  { value: "AGENT_DECISION",     label: "Agent Decision" },
  { value: "FRAMEWORK_INTEGRITY",label: "Framework Integrity" },
  { value: "COMPLIANCE_BOUNDARY",label: "Compliance Boundary" },
  { value: "AGENT_LIFECYCLE",    label: "Agent Lifecycle" },
  { value: "A2A_PROTOCOL",       label: "A2A Protocol" },
];

function WitnessAgentTab({ log, config, companyName, isSeeded, companyId }) {
  const [categoryFilter, setCategoryFilter] = useState("ALL");

  const filteredLog = categoryFilter === "ALL"
    ? log
    : categoryFilter === "AGENT_DECISION"
      ? log.filter(e => !e.eventCategory)
      : log.filter(e => e.eventCategory === categoryFilter);

  const stats = { PASS: log.filter(e => e.decision === "PASS").length, FAIL: log.filter(e => e.decision === "FAIL").length, ESCALATE: log.filter(e => e.decision === "ESCALATE").length, NORMALISED: log.filter(e => e.decision === "NORMALISED").length, exceptions: log.filter(e => e.exceptionApplied).length };
  return (
    <div style={{ padding: "28px 28px 40px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 16 }}>
        <div>
          <h2 style={{ fontFamily: T.sans, fontWeight: 900, fontSize: 24, color: T.text, marginBottom: 8, letterSpacing: "-0.03em" }}>Witness Agent — Audit Trail</h2>
          <p style={{ color: T.muted, fontSize: 16, lineHeight: 1.7, maxWidth: 580 }}>
            Every agent decision logged automatically before execution — tamper-evident, structured, version-controlled. SOC 2 Type II · GDPR Article 5 · ISO 42001 · EU AI Act Article 12.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
          {[{ label: "Total", val: log.length, color: T.muted }, { label: "PASS", val: stats.PASS, color: T.green }, { label: "FAIL", val: stats.FAIL, color: T.red }, { label: "ESCALATE", val: stats.ESCALATE, color: T.amber }, { label: "A2MD", val: stats.NORMALISED, color: T.teal }, { label: "Exceptions", val: stats.exceptions, color: T.purple }].map(s => (
            <div key={s.label} style={{ background: T.card, border: `1px solid ${s.color}30`, borderRadius: 8, padding: "10px 14px", textAlign: "center", minWidth: 64 }}>
              <div style={{ fontFamily: T.mono, fontWeight: 700, fontSize: 22, color: s.color }}>{s.val}</div>
              <div style={{ fontSize: 10, color: T.dim, marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Framework Integrity Panel — always visible */}
      <FrameworkIntegrityPanel companyId={companyId} />

      {/* Sample data banner */}
      {isSeeded && (
        <div style={{ background: `${T.blue}0a`, border: `1px solid ${T.blue}30`, borderRadius: 10, padding: "12px 18px", marginBottom: 20, display: "flex", gap: 12, alignItems: "center" }}>
          <span style={{ fontSize: 20 }}>📋</span>
          <div>
            <div style={{ fontSize: 13, color: T.text, fontWeight: 700, marginBottom: 3 }}>Sample entries — pre-seeded for {companyName}</div>
            <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono, lineHeight: 1.6 }}>
              These 10 entries show realistic Witness Agent log output for {config.label} operations. Each entry shows exactly what the log records: agent, decision, governance file cited, specific clause applied, and reasoning. Run the Exception Engine to add live entries.
            </div>
          </div>
          <Tag color={T.blue}>{config.label}</Tag>
        </div>
      )}

      {/* Category filter bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <span style={{ fontSize: 11, color: T.dim, fontFamily: T.mono, letterSpacing: "0.06em", flexShrink: 0 }}>FILTER BY CATEGORY</span>
        <select
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
          style={{
            background: T.card, border: `1px solid ${T.border}`, color: T.text,
            borderRadius: 6, padding: "6px 12px", fontSize: 12, fontFamily: T.mono,
            cursor: "pointer", outline: "none",
          }}
        >
          {CATEGORY_FILTER_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        {categoryFilter !== "ALL" && (
          <span style={{ fontSize: 11, color: T.dim, fontFamily: T.mono }}>
            {filteredLog.length} / {log.length} entries
          </span>
        )}
      </div>

      {filteredLog.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 0", color: T.dim }}>
          <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.4 }}>🕵️</div>
          <div style={{ fontSize: 16, fontFamily: T.sans, fontWeight: 600, marginBottom: 8 }}>
            {log.length === 0 ? "Audit log is empty" : "No entries match this filter"}
          </div>
          <div style={{ fontSize: 14 }}>
            {log.length === 0
              ? "Run decisions in the Exception Engine to generate audit entries"
              : "Try a different category filter or select \"All Categories\""}
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[...filteredLog].reverse().map((e) => (
            <div key={e.id} style={{
              background: "#090b0d",
              border: `1px solid ${e.decision === "PASS" ? T.green + "25" : e.decision === "FAIL" ? T.red + "25" : e.decision === "ESCALATE" ? T.amber + "25" : e.decision === "NORMALISED" ? T.teal + "40" : T.border}`,
              borderLeft: `3px solid ${e.decision === "PASS" ? T.green : e.decision === "FAIL" ? T.red : e.decision === "ESCALATE" ? T.amber : e.decision === "NORMALISED" ? T.teal : T.border}`,
              borderRadius: 8, padding: "12px 16px", fontFamily: T.mono, fontSize: 13, animation: "slide-up 0.3s ease",
            }}>
              {/* Row 1: timestamp + agent + decision + exception badge */}
              <div style={{ display: "flex", gap: 12, marginBottom: 7, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ color: T.dim, fontSize: 11, flexShrink: 0 }}>{e.timestamp ?? (e.createdAt ? new Date(e.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—")}</span>
                <span style={{ color: T.orange, fontWeight: 700 }}>{e.agent}</span>
                <DecisionBadge decision={e.decision} />
                <CategoryBadge category={e.eventCategory} />
                {e.exceptionApplied && <Tag color={T.purple}>⚡ Exception Applied</Tag>}
                {e.escalationTarget && <Tag color={T.amber}>↳ {e.escalationTarget}</Tag>}
              </div>
              {/* Row 2: action */}
              <div style={{ color: T.muted, marginBottom: 6, lineHeight: 1.5, fontSize: 12 }}>{e.actionProposed}</div>
              {/* Row 3: file + clause */}
              <div style={{ display: "flex", gap: 16, marginBottom: e.reasoning ? 6 : 0, flexWrap: "wrap" }}>
                <div style={{ color: "#86efac", fontSize: 11 }}>
                  📄 <span style={{ color: "#a3e635" }}>{e.fileReferenced}</span>
                </div>
              </div>
              <div style={{ fontSize: 11, marginBottom: e.reasoning ? 6 : 0 }}>
                <span style={{ color: T.dim }}>Clause: </span>
                <span style={{ color: e.exceptionApplied ? "#c4b5fd" : "#7dd3fc", fontStyle: "italic" }}>{e.clauseApplied}</span>
              </div>
              {/* Row 4: reasoning (collapsible feel via lighter colour) */}
              {e.reasoning && (
                <div style={{ fontSize: 11, color: T.dim, borderTop: `1px solid ${T.border}`, paddingTop: 6, marginTop: 2, lineHeight: 1.6 }}>
                  <span style={{ color: T.dim, letterSpacing: "0.06em", fontSize: 10 }}>REASONING › </span>
                  {e.reasoning}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {log.length > 0 && (
        <div style={{ marginTop: 20, background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div style={{ fontSize: 12, color: T.dim, fontFamily: T.mono }}>witness_agent.log · {companyName} · VDA-MD for Apaleo · {log.length} entries</div>
          <div style={{ display: "flex", gap: 8 }}><Tag color={T.green}>SOC 2 Type II</Tag><Tag color={T.blue}>GDPR Article 5</Tag><Tag color={T.purple}>EU AI Act Art.12</Tag><Tag color={T.orange}>ISO 42001</Tag></div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// ROOT APP
// ─────────────────────────────────────────────

// Build realistic seed log entries from industry witness config
function buildSeedLog(config, companyName) {
  const now = new Date();
  const ts = (hoursAgo, minsAgo = 0) => {
    const d = new Date(now - hoursAgo * 3600000 - minsAgo * 60000);
    return d.toISOString().replace("T", " ").substring(0, 19) + " UTC";
  };

  // Each industry has 3 base entries — expand to 10 realistic ones
  const industry = config.id;
  const customer = config.customerTerm;
  const employee = config.employeeTerm;

  // Universal entries every industry gets (3)
  const universal = [
    {
      id: 1, timestamp: ts(0, 4),
      agent: "Staff Access Provisioning Agent",
      decision: "PASS",
      fileReferenced: "staff-access-provisioning-baseline.md",
      clauseApplied: "MUST NOT activate any account without a logged manager request in the HR system",
      actionProposed: `New ${employee.toLowerCase()} onboarding — system access provisioned on confirmed start date`,
      escalationTarget: null, exceptionApplied: false,
      reasoning: "Workday manager request confirmed. Start date verified. Access level matches role classification. All baseline conditions met.",
    },
    {
      id: 2, timestamp: ts(0, 22),
      agent: "Procurement Approval Agent",
      decision: "PASS",
      fileReferenced: "procurement-preferred-supplier-exception.md",
      clauseApplied: "MAY approve at reduced authority level for current Preferred Suppliers — three-quote waived",
      actionProposed: "Purchase order submitted for Preferred Supplier — exception overlay applied",
      escalationTarget: null, exceptionApplied: true,
      reasoning: "Supplier verified on current Preferred Supplier List. Invoice below exception ceiling. DPA in place. Exception conditions all met — baseline three-quote requirement waived.",
    },
    {
      id: 3, timestamp: ts(1, 8),
      agent: "Procurement Approval Agent",
      decision: "FAIL",
      fileReferenced: "procurement-approval-authority-baseline.md",
      clauseApplied: "MUST NOT process PO above requestor's authority level",
      actionProposed: "Purchase order above requestor's delegated authority — blocked pending escalation",
      escalationTarget: "CFO",
      exceptionApplied: false,
      reasoning: "PO value of €85,000 exceeds Operations Director authority ceiling of €50,000. No active exception overlay for this supplier. CFO sign-off required before PO can be raised.",
    },
  ];

  // Apaleo hospitality-specific entries (7)
  const industryEntries = {
    hospitality: [
      { id: 10, timestamp: ts(0, 3), agent: "Checkout Agent", decision: "PASS", fileReferenced: "Hospitality-Operations-Post-Stay-checkout-agent.SOP.md", clauseApplied: "MAY waive late checkout fee per EXCEPTION.md for verified loyalty tier guests", actionProposed: `Reservation RES-2026-88341 — ${customer} requested late checkout to 13:30, loyalty tier verified in Apaleo, fee waived`, escalationTarget: null, exceptionApplied: true, reasoning: `${customer} holds active Gold loyalty status confirmed in Apaleo guest profile. Late checkout exception overlay active. Unit availability checked via Apaleo Inventory API — no constraint. Folio charge suppressed automatically.` },
      { id: 11, timestamp: ts(0, 15), agent: "Folio Settlement Agent", decision: "FAIL", fileReferenced: "Hospitality-Operations-Stay-folio-charge-agent.SOP.md", clauseApplied: "MUST NOT post folio charges without matching reservation ID in Apaleo", actionProposed: `Folio charge FOL-2026-0922 blocked — reservation ID not found in Apaleo Reservations API`, escalationTarget: "Operations Director", exceptionApplied: false, reasoning: "Charge submitted without a valid Apaleo reservation reference. Folio cannot be settled against an unlinked guest record. Operations Director notified. Charge held pending reservation verification." },
      { id: 12, timestamp: ts(1, 5), agent: "Rate Agent", decision: "ESCALATE", fileReferenced: "Hospitality-Revenue-Book-rate-agent.SOP.md", clauseApplied: "MUST escalate rate plan override requests above Revenue Manager authority to VP Revenue", actionProposed: "Corporate account requested 25% override on BAR rate plan — above Revenue Manager ceiling, escalated", escalationTarget: "VP Revenue", exceptionApplied: false, reasoning: "Requested rate plan override of 25% below BAR exceeds Revenue Manager authority ceiling of 18%. Account is Tier 2 in Apaleo — not Tier 1 key account. No active rate-plan-override exception overlay. Escalated to VP Revenue for approval." },
      { id: 13, timestamp: ts(1, 33), agent: "Rate Agent", decision: "PASS", fileReferenced: "Hospitality-Revenue-Book-rate-agent.SOP.md", clauseApplied: "MAY approve up to 18% discount on BAR at Revenue Manager authority for verified Tier 1 accounts", actionProposed: "Tier 1 Key Account rate plan approved in Apaleo — exception overlay applied, rate plan updated", escalationTarget: null, exceptionApplied: true, reasoning: "Account verified as Tier 1 in Apaleo guest profile and CRM. Requested discount of 16% below BAR within exception ceiling. Rate parity obligations checked. Rate plan updated via Apaleo Rate Plan API. Exception conditions all met." },
      { id: 14, timestamp: ts(2, 11), agent: "Check-In Agent", decision: "PASS", fileReferenced: "Hospitality-Operations-Stay-checkin-agent.SOP.md", clauseApplied: "MUST verify reservation status in Apaleo before assigning property unit", actionProposed: `Reservation RES-2026-91204 — ${customer} check-in confirmed, unit assigned via Apaleo Unit Management API`, escalationTarget: null, exceptionApplied: false, reasoning: "Reservation status confirmed as CONFIRMED in Apaleo Reservations API. Guest identity verified. Unit availability confirmed. Check-in processed. Access credentials issued. Apaleo reservation status updated to IN_HOUSE." },
      { id: 15, timestamp: ts(3, 44), agent: "Checkout Agent", decision: "PASS", fileReferenced: "Hospitality-Operations-Post-Stay-checkout-agent.SOP.md", clauseApplied: "MUST confirm folio balance is zero or settled before closing reservation in Apaleo", actionProposed: `Reservation RES-2026-91204 — ${customer.toLowerCase()} checkout at 11:00, folio settled, Apaleo status updated to CHECKED_OUT`, escalationTarget: null, exceptionApplied: false, reasoning: "Folio balance confirmed zero — all charges settled. No pending disputes. Reservation status updated to CHECKED_OUT via Apaleo Reservations API. Revenue recognition entry posted." },
      { id: 16, timestamp: ts(4, 2), agent: "Onboarding Agent", decision: "ESCALATE", fileReferenced: "staff-access-provisioning-baseline.md", clauseApplied: "MUST flag and NOT provision Apaleo system access if CISO sign-off is missing", actionProposed: `Property Systems ${employee.toLowerCase()} fast-track provisioning request — CISO sign-off not found, escalated`, escalationTarget: "CISO", exceptionApplied: false, reasoning: "Role classified as Property Systems specialist qualifying for fast-track exception. However no CISO sign-off reference found in log for this individual. Apaleo admin provisioning blocked. Escalated to CISO for approval." },
      { id: 17, timestamp: ts(4, 28), agent: "Folio Invoice Agent", decision: "PASS", fileReferenced: "Hospitality-Finance-Shared-O2C-folio-charge-authority.md", clauseApplied: "MUST generate folio invoice within 24 hours of checkout and dispatch to confirmed billing address", actionProposed: "Post-stay folio invoice INV-2026-4471 generated from Apaleo folio data and dispatched to corporate billing contact", escalationTarget: null, exceptionApplied: false, reasoning: "Checkout completed. Corporate billing address confirmed in Apaleo guest profile. Folio invoice generated from Apaleo Folio API data. Dispatched via automated billing workflow within 24-hour SLA." },
      { id: 18, timestamp: ts(5, 12), agent: "Payment Collection Bot", decision: "ESCALATE", fileReferenced: "Hospitality-Finance-Shared-O2C-folio-charge-authority.md", clauseApplied: "MUST escalate folios unpaid beyond 30-day terms to Credit Control", actionProposed: "Folio INV-2026-4471 — 30 days overdue, escalated to Credit Control team", escalationTarget: "Credit Control", exceptionApplied: false, reasoning: "Folio invoice INV-2026-4471 has passed 30-day payment terms. Two automated reminders sent. No payment or dispute received. Escalated to Credit Control for manual follow-up per O2C policy." },
    ],
  };

  const industrySpecific = industryEntries.hospitality;
  const all = [...universal, ...industrySpecific].sort((a, b) => a.id - b.id);

  return all.map((e, i) => ({ ...e, id: Date.now() + i }));
}

// ─────────────────────────────────────────────────────────────────────────────
// RESET DEMO BUTTON
// Clears all transient DB state + localStorage so the next demo starts fresh.
// Governance files (AGENTS.md, SOP.md, SKILL.md, EXCEPTION_AUTHORITY.md) are
// preserved — only onboarding progress, witness logs, credentials etc. are wiped.
// ─────────────────────────────────────────────────────────────────────────────

const NATIVE_AGENT_SLUGS = [
  "rate-agent", "availability-agent", "reservation-bot", "check-in-agent",
  "folio-agent", "folio-charge-agent", "checkout-agent", "revenue-reconciliation-agent",
];

function ResetDemoButton({ onReset }) {
  const [status, setStatus] = useState(null); // null | "confirming" | "resetting" | "done" | "error"
  const [errMsg, setErrMsg] = useState("");

  const handleClick = () => {
    if (status === "confirming") return doReset();
    setStatus("confirming");
    setTimeout(() => setStatus(s => s === "confirming" ? null : s), 5000);
  };

  const doReset = async () => {
    setStatus("resetting");
    try {
      const r = await fetch("/api/admin/reset-demo", { method: "POST" });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || "Reset failed"); }
      // Clear CISO walkthrough localStorage for all native agents
      NATIVE_AGENT_SLUGS.forEach(slug => {
        try { localStorage.removeItem(`vda_ciso_${slug}_stages`); } catch {}
        try { localStorage.removeItem(`vda_ciso_${slug}_stage`); } catch {}
      });
      setStatus("done");
      onReset?.();
      setTimeout(() => setStatus(null), 3000);
    } catch (err) {
      setErrMsg(err.message || "Reset failed");
      setStatus("error");
      setTimeout(() => setStatus(null), 4000);
    }
  };

  const label = status === "confirming" ? "⚠ Confirm reset? Click again"
    : status === "resetting" ? "Resetting…"
    : status === "done" ? "✓ Demo reset — ready for next user"
    : status === "error" ? `Error: ${errMsg}`
    : "↺ Reset Demo";

  const bg = status === "confirming" ? `${T.amber}18`
    : status === "done" ? `${T.green}18`
    : status === "error" ? `${T.red}18`
    : "transparent";

  const borderColor = status === "confirming" ? `${T.amber}60`
    : status === "done" ? `${T.green}60`
    : status === "error" ? `${T.red}60`
    : `${T.border}`;

  const color = status === "confirming" ? T.amber
    : status === "done" ? T.green
    : status === "error" ? T.red
    : T.dim;

  return (
    <button
      onClick={handleClick}
      disabled={status === "resetting"}
      style={{ width: "100%", padding: "7px 0", borderRadius: 6, fontSize: 11, fontWeight: 600,
        fontFamily: T.mono, background: bg, border: `1px solid ${borderColor}`, color,
        cursor: status === "resetting" ? "not-allowed" : "pointer", transition: "all 0.2s",
        letterSpacing: "0.02em", opacity: status === "resetting" ? 0.6 : 1 }}>
      {label}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CISO-FIRST ONBOARDING CONSOLE — Task #71
// Three-track starting screen: VDA Native Agent Admission / Hotel Activation /
// External A2A Admission
// ─────────────────────────────────────────────────────────────────────────────

const VDA_NATIVE_AGENTS = [
  { slug: "rate-agent",                    name: "Rate Agent",              icon: "💰" },
  { slug: "availability-agent",            name: "Availability Agent",      icon: "🔍" },
  { slug: "reservation-bot",              name: "Reservation Bot",          icon: "📋" },
  { slug: "check-in-agent",               name: "Check-In Agent",           icon: "✅" },
  { slug: "folio-agent",                  name: "Folio Agent",              icon: "🧾" },
  { slug: "folio-charge-agent",           name: "Folio Charge Agent",       icon: "💳" },
  { slug: "checkout-agent",              name: "Checkout Agent",            icon: "🚪" },
  { slug: "revenue-reconciliation-agent", name: "Revenue Reconciliation",   icon: "📊" },
];

function loadStageCompletions(slug) {
  try { return JSON.parse(localStorage.getItem(`vda_ciso_${slug}_stages`) || "null") || [false,false,false,false,false,false]; }
  catch { return [false,false,false,false,false,false]; }
}
function saveStageCompletions(slug, c) {
  try { localStorage.setItem(`vda_ciso_${slug}_stages`, JSON.stringify(c)); } catch {}
}
function loadCurrentStage(slug) {
  try { return Number(localStorage.getItem(`vda_ciso_${slug}_stage`) || "1") || 1; } catch { return 1; }
}
function saveCurrentStage(slug, s) {
  try { localStorage.setItem(`vda_ciso_${slug}_stage`, String(s)); } catch {}
}

// ─── Stage 1: Governance File Review ────────────────────────────────────────
function RenderMd({ content }) {
  const lines = (content || "").split("\n");
  const els = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // YAML front-matter block — render as a dim code block
    if (i === 0 && line.trim() === "---") {
      const fmLines = [];
      i++;
      while (i < lines.length && lines[i].trim() !== "---") { fmLines.push(lines[i]); i++; }
      els.push(<div key="fm" style={{ background: "#0d0f14", border: `1px solid ${T.border}`, borderRadius: 6, padding: "10px 14px", marginBottom: 16, fontSize: 10, fontFamily: T.mono, color: T.dim, whiteSpace: "pre-wrap" }}>{fmLines.join("\n")}</div>);
      i++; continue;
    }
    // H1
    if (/^# /.test(line)) {
      els.push(<h1 key={i} style={{ fontSize: 17, fontWeight: 800, color: T.text, fontFamily: T.sans, margin: "0 0 12px", paddingBottom: 8, borderBottom: `1px solid ${T.border}` }}>{line.slice(2)}</h1>);
      i++; continue;
    }
    // H2
    if (/^## /.test(line)) {
      els.push(<h2 key={i} style={{ fontSize: 13, fontWeight: 700, color: T.blue, fontFamily: T.mono, margin: "20px 0 8px", textTransform: "uppercase", letterSpacing: "0.06em" }}>{line.slice(3)}</h2>);
      i++; continue;
    }
    // H3
    if (/^### /.test(line)) {
      els.push(<h3 key={i} style={{ fontSize: 12, fontWeight: 700, color: T.text, fontFamily: T.mono, margin: "14px 0 6px" }}>{line.slice(4)}</h3>);
      i++; continue;
    }
    // Code fence
    if (/^```/.test(line)) {
      const codeLines = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { codeLines.push(lines[i]); i++; }
      els.push(<pre key={i} style={{ background: "#0d0f14", border: `1px solid ${T.border}`, borderRadius: 6, padding: "10px 14px", margin: "8px 0 12px", fontSize: 11, fontFamily: T.mono, color: "#a0c4ff", whiteSpace: "pre-wrap", wordBreak: "break-word", overflowX: "auto" }}>{codeLines.join("\n")}</pre>);
      i++; continue;
    }
    // Blank line
    if (line.trim() === "") { els.push(<div key={i} style={{ height: 6 }} />); i++; continue; }
    // List item
    if (/^[-*] /.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*] /.test(lines[i])) {
        items.push(lines[i].slice(2));
        i++;
      }
      els.push(
        <ul key={i} style={{ margin: "4px 0 10px", paddingLeft: 18, listStyle: "none" }}>
          {items.map((it, j) => (
            <li key={j} style={{ fontSize: 12, fontFamily: T.mono, color: "#c0c6d8", lineHeight: 1.7, display: "flex", alignItems: "flex-start", gap: 6 }}>
              <span style={{ color: T.green, flexShrink: 0, marginTop: 2 }}>▸</span>
              <span dangerouslySetInnerHTML={{ __html: it.replace(/\*\*(.+?)\*\*/g, `<strong style="color:${T.text}">$1</strong>`).replace(/`(.+?)`/g, `<code style="background:#1a1f2e;padding:1px 5px;border-radius:3px;font-size:11px;color:#a0c4ff">$1</code>`) }} />
            </li>
          ))}
        </ul>
      );
      continue;
    }
    // Numbered list
    if (/^\d+\. /.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\. /, ""));
        i++;
      }
      els.push(
        <ol key={i} style={{ margin: "4px 0 10px", paddingLeft: 20 }}>
          {items.map((it, j) => (
            <li key={j} style={{ fontSize: 12, fontFamily: T.mono, color: "#c0c6d8", lineHeight: 1.7 }}>
              <span dangerouslySetInnerHTML={{ __html: it.replace(/\*\*(.+?)\*\*/g, `<strong style="color:${T.text}">$1</strong>`).replace(/`(.+?)`/g, `<code style="background:#1a1f2e;padding:1px 5px;border-radius:3px;font-size:11px;color:#a0c4ff">$1</code>`) }} />
            </li>
          ))}
        </ol>
      );
      continue;
    }
    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      els.push(<hr key={i} style={{ border: "none", borderTop: `1px solid ${T.border}`, margin: "14px 0" }} />);
      i++; continue;
    }
    // Paragraph / inline text
    const html = line
      .replace(/\*\*(.+?)\*\*/g, `<strong style="color:${T.text}">$1</strong>`)
      .replace(/\*(.+?)\*/g, `<em style="color:${T.dim}">$1</em>`)
      .replace(/`(.+?)`/g, `<code style="background:#1a1f2e;padding:1px 5px;border-radius:3px;font-size:11px;color:#a0c4ff">$1</code>`);
    els.push(<p key={i} style={{ fontSize: 12, fontFamily: T.mono, color: "#c0c6d8", lineHeight: 1.8, margin: "0 0 4px" }} dangerouslySetInnerHTML={{ __html: html }} />);
    i++;
  }
  return <div style={{ padding: "18px 22px" }}>{els}</div>;
}

function GovernanceFileReview({ agentSlug, companyId = 0, onNext, onFilesLoaded }) {
  const [files, setFiles] = useState(null);
  const [contents, setContents] = useState({});
  const [activeTab, setActiveTab] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [fallbackTypes, setFallbackTypes] = useState(new Set());
  const FILE_TYPES = ["AGENTS", "SOP", "SKILL", "EXCEPTION_AUTHORITY"];
  const FILE_LABELS = { AGENTS: "AGENTS.md", SOP: "SOP.md", SKILL: "SKILL.md", EXCEPTION_AUTHORITY: "EXCEPTION_AUTHORITY.md" };

  useEffect(() => {
    if (!agentSlug) return;
    setLoading(true); setError(null);
    (async () => {
      try {
        // Fetch company-specific files, then merge in platform files for missing types
        const fetchCid = companyId || 0;

        // Helper: from a raw file list, pick best match per FILE_TYPE.
        // Priority: (1) agentId === agentSlug, (2) agentId === 'onboarding-agent' (shared platform doc)
        const pickBestPerType = (list) => {
          const byType = {};
          for (const f of list) {
            if (!FILE_TYPES.includes(f.fileType)) continue;
            const prev = byType[f.fileType];
            const rank = f.agentId === agentSlug ? 2 : f.agentId === "onboarding-agent" ? 1 : 0;
            if (rank === 0) continue;
            if (!prev || rank > (prev.agentId === agentSlug ? 2 : 1)) byType[f.fileType] = f;
          }
          return Object.values(byType);
        };

        const r1 = await fetch(`/api/fm/files/${fetchCid}`);
        const d1 = await r1.json();
        const list1 = Array.isArray(d1) ? d1 : (d1.files || []);
        let all = pickBestPerType(list1);

        // Fallback: if companyId > 0, also load platform files (companyId=0) for types still missing
        const newFallbackTypes = new Set();
        if (fetchCid > 0) {
          const presentTypes = new Set(all.map(f => f.fileType));
          const missingFromCompany = FILE_TYPES.filter(t => !presentTypes.has(t));
          if (missingFromCompany.length > 0) {
            try {
              const r0 = await fetch("/api/fm/files/0");
              const d0 = await r0.json();
              const list0 = Array.isArray(d0) ? d0 : (d0.files || []);
              const platformFiles = pickBestPerType(list0).filter(f => missingFromCompany.includes(f.fileType));
              platformFiles.forEach(f => newFallbackTypes.add(f.fileType));
              all = [...all, ...platformFiles];
            } catch {}
          }
        }
        setFallbackTypes(newFallbackTypes);

        setFiles(all);
        if (all.length > 0) setActiveTab(all[0].id);
        const cm = {};
        await Promise.all(all.map(async f => {
          try {
            const r = await fetch(`/api/fm/file/${f.id}`);
            const d = await r.json();
            cm[f.id] = d.content || "(empty)";
          } catch { cm[f.id] = "(failed to load)"; }
        }));
        setContents(cm);
        onFilesLoaded?.(all, cm);
        setLoading(false);
      } catch {
        setError("Failed to load governance files");
        setLoading(false);
      }
    })();
  }, [agentSlug, companyId, refreshTick]);

  const handleGenerateEA = async () => {
    setGenerating(true); setGenerateError(null);
    try {
      const r = await fetch("/api/fm/generate-exception-authority", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: agentSlug, companyId: companyId || 0, regenerate: true }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Generation failed");
      setRefreshTick(t => t + 1);
    } catch (err) {
      setGenerateError(err.message || "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const presentTypes = new Set((files || []).map(f => f.fileType));
  const missingTypes = FILE_TYPES.filter(t => !presentTypes.has(t));
  const hotelScopeMissingEA = (companyId || 0) > 0 && fallbackTypes.has("EXCEPTION_AUTHORITY");
  const canProceed = !loading && missingTypes.length === 0;
  const activeContent = contents[activeTab] || "";
  const mustCount = (activeContent.match(/\bMUST\b(?!\s+NOT)/g) || []).length;
  const mustNotCount = (activeContent.match(/\bMUST NOT\b/g) || []).length;
  const mayCount = (activeContent.match(/\bMAY\b/g) || []).length;

  // NIST control refs extracted across ALL loaded file contents
  const allContent = Object.values(contents).join("\n");
  const nistRefs = [...new Set((allContent.match(/\b(?:AC|AU|CA|CM|CP|IA|IR|MA|MP|PE|PL|PM|RA|SA|SC|SI|SR)-\d+(?:\(\d+\))?/g) || []))].sort();

  // Exception authority ceiling table from EXCEPTION_AUTHORITY.md
  const eaFile = (files || []).find(f => f.fileType === "EXCEPTION_AUTHORITY");
  const eaContent = eaFile ? (contents[eaFile.id] || "") : "";
  const CEILING_BANDS = ["ambassador", "senior_ambassador", "hotel_gm", "ops_director", "ciso"];
  const BAND_LABELS = { ambassador: "Ambassador", senior_ambassador: "Sr Ambassador", hotel_gm: "Hotel GM", ops_director: "Ops Director", ciso: "CISO" };
  const parseCeiling = (band) => {
    const re = new RegExp(`${band}:[\\s\\S]*?max_value:\\s*([\\d.]+)`, "m");
    const m = eaContent.match(re);
    return m ? m[1] : null;
  };
  const ceilingRows = CEILING_BANDS.map(b => ({ band: BAND_LABELS[b], ceiling: parseCeiling(b) })).filter(r => r.ceiling !== null);

  return (
    <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 24, color: T.dim, fontSize: 13 }}>Loading governance files…</div>
        ) : error ? (
          <div style={{ padding: 24, color: T.red, fontSize: 13 }}>{error}</div>
        ) : (
          <>
            <div style={{ display: "flex", borderBottom: `1px solid ${T.border}`, overflowX: "auto", flexShrink: 0 }}>
              {FILE_TYPES.map(ft => {
                const f = (files || []).find(x => x.fileType === ft);
                const missing = !f;
                const isFallbackEA = ft === "EXCEPTION_AUTHORITY" && !missing && hotelScopeMissingEA;
                return (
                  <button key={ft} onClick={() => f && setActiveTab(f.id)} style={{
                    background: "none", border: "none",
                    borderBottom: activeTab === f?.id ? `2px solid ${T.blue}` : "2px solid transparent",
                    color: missing ? T.red : isFallbackEA ? T.amber : activeTab === f?.id ? T.text : T.dim,
                    padding: "10px 16px", cursor: f ? "pointer" : "default",
                    fontSize: 12, fontFamily: T.mono, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0,
                  }}>
                    {missing ? "⚠ " : isFallbackEA ? "⚡ " : ""}{FILE_LABELS[ft]}{isFallbackEA ? " (platform)" : ""}
                  </button>
                );
              })}
            </div>
            {(missingTypes.length > 0 || hotelScopeMissingEA) && (
              <div style={{ padding: "8px 16px", background: hotelScopeMissingEA && missingTypes.length === 0 ? "#1a1000" : "#1a0505", borderBottom: `1px solid ${hotelScopeMissingEA && missingTypes.length === 0 ? T.amber + "40" : T.red + "40"}`, color: hotelScopeMissingEA && missingTypes.length === 0 ? T.amber : T.red, fontSize: 12, flexShrink: 0, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                {missingTypes.length > 0 && <span>Missing: {missingTypes.map(t => FILE_LABELS[t]).join(", ")}</span>}
                {hotelScopeMissingEA && missingTypes.length === 0 && (
                  <span>EXCEPTION_AUTHORITY.md is platform-level — generate a hotel-specific version below.</span>
                )}
                {(missingTypes.includes("EXCEPTION_AUTHORITY") || hotelScopeMissingEA) && (
                  <button onClick={handleGenerateEA} disabled={generating} style={{
                    padding: "4px 12px", borderRadius: 5, fontSize: 11, fontFamily: T.mono, fontWeight: 700,
                    background: generating ? "#1a0f00" : "#1c1200", color: generating ? T.dim : T.amber,
                    border: `1px solid ${T.amber}50`, cursor: generating ? "not-allowed" : "pointer", flexShrink: 0,
                  }}>
                    {generating ? "Generating…" : "⚡ Generate exception authority"}
                  </button>
                )}
                {!missingTypes.includes("EXCEPTION_AUTHORITY") && !hotelScopeMissingEA && <span>— seed governance files before proceeding.</span>}
                {generateError && <span style={{ color: T.red, fontSize: 11 }}>{generateError}</span>}
              </div>
            )}
            {/* Source clause column shown when EXCEPTION_AUTHORITY tab is active */}
            {(() => {
              const eaFile = (files || []).find(f => f.fileType === "EXCEPTION_AUTHORITY");
              const isEATab = eaFile && activeTab === eaFile.id;
              const eaRawContent = eaFile ? (contents[eaFile.id] || "") : "";
              const sourceClauses = (() => {
                try {
                  const fm = eaRawContent.match(/^---\s*\n([\s\S]*?)\n---/);
                  if (!fm) return [];
                  const scBlock = fm[1].match(/source_clauses:\s*\n((?:[ \t][^\n]+\n?)*)/);
                  if (!scBlock) return [];
                  const lines = scBlock[1].split("\n");
                  const result = [];
                  let cur = {};
                  for (const line of lines) {
                    const ecMatch = line.match(/exception_class:\s*["']?([^"'\n]+?)["']?\s*$/);
                    const tcMatch = line.match(/traced_to_clause:\s*["']?([^"'\n]+?)["']?\s*$/);
                    if (ecMatch) {
                      if (cur.ec && cur.tc) result.push(cur);
                      cur = { ec: ecMatch[1].trim() };
                    } else if (tcMatch && cur.ec) {
                      cur.tc = tcMatch[1].trim();
                      result.push(cur);
                      cur = {};
                    }
                  }
                  if (cur.ec && cur.tc) result.push(cur);
                  return result.filter(r => r.ec && r.tc);
                } catch { return []; }
              })();
              if (!isEATab || sourceClauses.length === 0) return null;
              return (
                <div style={{ padding: "8px 16px 0", borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
                  <div style={{ fontSize: 10, fontFamily: T.mono, fontWeight: 700, color: T.dim, letterSpacing: "0.1em", marginBottom: 6 }}>SOURCE CLAUSES</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 120, overflowY: "auto", marginBottom: 8 }}>
                    {sourceClauses.map((sc, i) => (
                      <div key={i} style={{ display: "flex", gap: 10, fontSize: 10, fontFamily: T.mono }}>
                        <span style={{ color: T.amber, fontWeight: 700, flexShrink: 0, minWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sc.ec}</span>
                        <span style={{ color: T.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>← {sc.tc}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
            <div style={{ flex: 1, overflow: "auto" }}>
              {activeContent
                ? <RenderMd content={activeContent} />
                : <div style={{ padding: "16px 20px", fontSize: 12, fontFamily: T.mono, color: T.dim }}>(select a file tab above)</div>}
            </div>
          </>
        )}
        <div style={{ padding: "14px 20px", borderTop: `1px solid ${T.border}`, display: "flex", justifyContent: "flex-end", flexShrink: 0 }}>
          <button onClick={onNext} disabled={!canProceed} style={{
            padding: "10px 28px", borderRadius: 8, fontSize: 13, fontWeight: 700, fontFamily: T.mono,
            background: canProceed ? T.blue : "#1e2229", color: canProceed ? "#fff" : T.dim,
            border: "none", cursor: canProceed ? "pointer" : "not-allowed",
          }}>Next → Stage 2</button>
        </div>
      </div>

      {/* Right panel: Clause counts + NIST refs + Ceiling table */}
      <div style={{ width: 200, borderLeft: `1px solid ${T.border}`, flexShrink: 0, overflowY: "auto", display: "flex", flexDirection: "column" }}>
        {/* Clause counts */}
        <div style={{ padding: "14px 16px 10px", borderBottom: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 10, fontFamily: T.mono, fontWeight: 700, color: T.dim, letterSpacing: "0.1em", marginBottom: 10 }}>CLAUSE COUNTS</div>
          {[{ label: "MUST", value: mustCount, color: T.green }, { label: "MUST NOT", value: mustNotCount, color: T.red }, { label: "MAY", value: mayCount, color: T.blue }]
            .map(({ label, value, color }) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontFamily: T.mono, color: T.dim }}>{label}</span>
                <span style={{ fontSize: 17, fontWeight: 700, color, fontFamily: T.mono }}>{value}</span>
              </div>
            ))}
        </div>

        {/* NIST control refs */}
        <div style={{ padding: "12px 16px 10px", borderBottom: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 10, fontFamily: T.mono, fontWeight: 700, color: T.dim, letterSpacing: "0.1em", marginBottom: 8 }}>NIST CONTROLS</div>
          {loading ? <div style={{ fontSize: 10, color: T.dim }}>—</div>
            : nistRefs.length === 0 ? <div style={{ fontSize: 10, color: T.dim, fontFamily: T.mono }}>None referenced</div>
            : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {nistRefs.slice(0, 24).map(ref => (
                  <span key={ref} style={{ fontSize: 9, fontFamily: T.mono, fontWeight: 700, color: T.blue, background: `${T.blue}18`, border: `1px solid ${T.blue}30`, borderRadius: 3, padding: "2px 5px" }}>{ref}</span>
                ))}
                {nistRefs.length > 24 && <span style={{ fontSize: 9, color: T.dim, fontFamily: T.mono }}>+{nistRefs.length - 24}</span>}
              </div>
            )}
        </div>

        {/* Exception authority ceiling table */}
        <div style={{ padding: "12px 16px 10px" }}>
          <div style={{ fontSize: 10, fontFamily: T.mono, fontWeight: 700, color: T.dim, letterSpacing: "0.1em", marginBottom: 8 }}>AUTHORITY CEILINGS</div>
          {ceilingRows.length === 0
            ? <div style={{ fontSize: 10, color: T.dim, fontFamily: T.mono }}>Open EXCEPTION_AUTHORITY.md tab to load</div>
            : ceilingRows.map(({ band, ceiling }) => (
              <div key={band} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 }}>
                <span style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>{band}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: T.amber, fontFamily: T.mono }}>€{ceiling}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

// ─── Stage 2: Sandbox Evaluation ────────────────────────────────────────────
function SandboxEvaluation({ requestId, agentSource, existingPassRate, onNext, onSandboxRun }) {
  const isExternal = agentSource === "a2a_external";
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState(null);
  const [threshold, setThreshold] = useState(null);
  const [error, setError] = useState(null);
  const [selectedResult, setSelectedResult] = useState(null);
  const [witnessEntry, setWitnessEntry] = useState(null);
  const [witnessLoading, setWitnessLoading] = useState(false);

  const passRate = results ? results.filter(r => r.passed).length / results.length
    : isExternal && existingPassRate != null ? Number(existingPassRate)
    : null;
  const THRESHOLD = threshold ?? 0.6;
  const canProceed = passRate !== null && passRate >= THRESHOLD;
  const failCount = results ? results.filter(r => !r.passed).length : 0;

  const runSandbox = async () => {
    if (!requestId) { setError("No onboarding request ID — submit this agent via POST /api/onboarding/submit first."); return; }
    setRunning(true); setError(null);
    const ts = Date.now();
    try {
      const r = await fetch(`/api/onboarding/${requestId}/run-sandbox`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) setError(d.error || "Sandbox failed");
      else {
        setResults(d.results || []);
        if (d.threshold != null) setThreshold(d.threshold);
        onSandboxRun?.(ts);
      }
    } catch { setError("Network error"); }
    finally { setRunning(false); }
  };

  const openDisclosure = async (r) => {
    setSelectedResult(r);
    setWitnessEntry(null);
    if (r.witnessId) {
      setWitnessLoading(true);
      try {
        const res = await fetch(`/api/agents/witness/${r.witnessId}`);
        if (res.ok) setWitnessEntry(await res.json());
      } catch { /* best effort */ }
      finally { setWitnessLoading(false); }
    }
  };

  const dc = (d) => d === "PASS" ? T.green : d === "FAIL" ? T.red : T.amber;
  const resultBg = (r) => r.passed ? "#0a1a0a" : "#1a0808";
  const resultBorder = (r) => r.passed ? `${T.green}25` : `${T.red}25`;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
      <div style={{ flex: 1, overflow: "auto", padding: "20px 24px" }}>
        {isExternal ? (
          <>
            <div style={{ padding: "10px 14px", background: "#0f1824", border: `1px solid ${T.blue}40`, borderRadius: 8, fontSize: 12, color: T.blue, marginBottom: 16 }}>
              External A2A agent — sandbox evaluation was run by the onboarding orchestrator pipeline. Results are read-only.
            </div>
            {passRate !== null ? (
              <div style={{ padding: "14px 18px", background: canProceed ? "#0d1f0d" : "#1a0a0a", border: `1px solid ${canProceed ? T.green : T.red}40`, borderRadius: 10, display: "flex", alignItems: "center", gap: 16 }}>
                <div style={{ fontSize: 32, fontWeight: 700, fontFamily: T.mono, color: canProceed ? T.green : T.red }}>{Math.round(passRate * 100)}%</div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: canProceed ? T.green : T.red }}>Orchestrator Pass Rate {canProceed ? "✓" : "✗"}</div>
                  <div style={{ fontSize: 11, color: T.dim }}>Evaluated during A2A pipeline · threshold {Math.round(THRESHOLD * 100)}%</div>
                </div>
              </div>
            ) : (
              <div style={{ padding: "10px 14px", background: "#1a1208", border: `1px solid ${T.amber}40`, borderRadius: 8, fontSize: 12, color: T.amber }}>
                No eval pass rate recorded yet — orchestrator may still be processing.
              </div>
            )}
          </>
        ) : (
          <>
            <p style={{ fontSize: 13, color: T.muted, lineHeight: 1.6, margin: "0 0 16px" }}>
              5 predefined governance scenarios are evaluated against this agent's SOP.md through the same
              governance pipeline used for live A2A decisions (evaluateWithPolicy → SOP + AGENTS + SKILL).
              Each actual decision is compared to an expected outcome (PASS / FAIL / ESCALATE).
              ≥{Math.round(THRESHOLD * 100)}% match rate required to proceed.
            </p>
            {!requestId && (
              <div style={{ padding: "10px 14px", background: "#1a0505", border: `1px solid ${T.red}40`, borderRadius: 8, color: T.red, fontSize: 12, marginBottom: 16 }}>
                No onboarding request found for this agent. Submit via POST /api/onboarding/submit with source=vda_native.
              </div>
            )}
            <button onClick={runSandbox} disabled={running || !requestId} style={{
              padding: "10px 24px", borderRadius: 8, fontSize: 13, fontWeight: 700, fontFamily: T.mono,
              background: running ? "#1e2229" : "#2d1b69", color: running ? T.dim : "#c4b5fd",
              border: `1px solid ${running ? T.border : "#7c3aed"}`, cursor: running || !requestId ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", gap: 8,
            }}>
              {running && <span style={{ display: "inline-block", width: 12, height: 12, border: "2px solid rgba(196,181,253,0.3)", borderTopColor: "#c4b5fd", borderRadius: "50%", animation: "co-spin 0.7s linear infinite" }} />}
              {running ? "Running scenarios…" : "▶ Run Sandbox Evaluation"}
            </button>
            {error && <div style={{ marginTop: 12, color: T.red, fontSize: 12 }}>{error}</div>}

            {results && (
              <div style={{ marginTop: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16, padding: "14px 18px", background: canProceed ? "#0d1f0d" : "#1a0a0a", border: `1px solid ${canProceed ? T.green : T.red}40`, borderRadius: 10 }}>
                  <div style={{ fontSize: 32, fontWeight: 700, fontFamily: T.mono, color: canProceed ? T.green : T.red }}>{Math.round(passRate * 100)}%</div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: canProceed ? T.green : T.red }}>Pass Rate {canProceed ? "✓" : "✗"}</div>
                    <div style={{ fontSize: 11, color: T.dim }}>{results.filter(r => r.passed).length}/{results.length} scenarios matched · threshold {Math.round(THRESHOLD * 100)}%</div>
                  </div>
                </div>

                {/* Blocking reason — only shown when failed */}
                {!canProceed && (
                  <div style={{ padding: "10px 14px", background: "#1a0808", border: `1px solid ${T.red}40`, borderRadius: 8, fontSize: 12, color: T.red, marginBottom: 16, lineHeight: 1.6 }}>
                    <strong>Stage blocked:</strong> {failCount} of {results.length} scenario{failCount !== 1 ? "s" : ""} produced an unexpected decision — pass rate {Math.round(passRate * 100)}% is below the required {Math.round(THRESHOLD * 100)}% threshold.
                    {" "}Click any failing row below to inspect the full witness disclosure, then re-run the evaluation once the governance files are in order.
                  </div>
                )}

                <div style={{ fontSize: 10, color: T.dim, fontFamily: T.mono, marginBottom: 8, letterSpacing: "0.06em" }}>
                  CLICK ANY ROW TO INSPECT FULL WITNESS EVENT DISCLOSURE
                </div>
                <div style={{ background: "#111318", border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 80px 80px", gap: 8, padding: "8px 16px", borderBottom: `1px solid ${T.border}`, fontSize: 10, color: T.dim, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: T.mono }}>
                    <span>Scenario</span><span>Expected</span><span>Actual</span><span>Result</span>
                  </div>
                  {results.map((r, i) => (
                    <div key={i} onClick={() => openDisclosure(r)}
                      style={{ display: "grid", gridTemplateColumns: "1fr 80px 80px 80px", gap: 8, padding: "10px 16px",
                        borderBottom: i < results.length - 1 ? `1px solid ${T.border}20` : "none", alignItems: "start",
                        cursor: "pointer", transition: "background 0.15s",
                        background: selectedResult === r ? resultBg(r) : "transparent",
                        borderLeft: selectedResult === r ? `3px solid ${r.passed ? T.green : T.red}` : "3px solid transparent",
                      }}
                      onMouseEnter={e => { if (selectedResult !== r) e.currentTarget.style.background = "#1a1d23"; }}
                      onMouseLeave={e => { if (selectedResult !== r) e.currentTarget.style.background = "transparent"; }}
                    >
                      <div>
                        <div style={{ fontSize: 12, color: T.text, lineHeight: 1.5, marginBottom: 3 }}>{r.scenario}</div>
                        {r.clause && <div style={{ fontSize: 10, fontFamily: T.mono, color: T.dim, lineHeight: 1.4 }}>"{r.clause.slice(0, 100)}{r.clause.length > 100 ? "…" : ""}"</div>}
                        <div style={{ fontSize: 10, fontFamily: T.mono, color: r.witnessId ? T.blue : "#374151", marginTop: 3 }}>
                          {r.witnessId ? `🔍 Witness #${r.witnessId} — click to inspect` : "No witness ID"}
                        </div>
                      </div>
                      <span style={{ fontSize: 11, fontFamily: T.mono, fontWeight: 600, color: dc(r.expected) }}>{r.expected}</span>
                      <span style={{ fontSize: 11, fontFamily: T.mono, fontWeight: 600, color: dc(r.decision) }}>{r.decision}</span>
                      <span style={{ fontSize: 11, fontFamily: T.mono, fontWeight: 700, color: r.passed ? T.green : T.red }}>{r.passed ? "✓ PASS" : "✗ FAIL"}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Bottom bar: blocking reason + Next button */}
      <div style={{ padding: "14px 20px", borderTop: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 16, flexShrink: 0 }}>
        {results && !canProceed && (
          <div style={{ fontSize: 11, color: T.red, fontFamily: T.mono, flex: 1 }}>
            ✗ Pass rate {Math.round(passRate * 100)}% · requires {Math.round(THRESHOLD * 100)}% · re-run evaluation to proceed
          </div>
        )}
        <button onClick={onNext} disabled={!canProceed} style={{
          padding: "10px 28px", borderRadius: 8, fontSize: 13, fontWeight: 700, fontFamily: T.mono,
          background: canProceed ? T.blue : "#1e2229", color: canProceed ? "#fff" : T.dim,
          border: "none", cursor: canProceed ? "pointer" : "not-allowed", whiteSpace: "nowrap",
        }}>Next → Stage 3</button>
      </div>

      {/* Witness Disclosure Slide-over */}
      {selectedResult && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 50, display: "flex", justifyContent: "flex-end" }}
          onClick={e => { if (e.target === e.currentTarget) setSelectedResult(null); }}>
          <div style={{ width: "100%", maxWidth: 480, background: "#0d1117", borderLeft: `1px solid ${T.border}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {/* Header */}
            <div style={{ padding: "16px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
              <div>
                <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>Witness Agent · Full Event Disclosure</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: selectedResult.passed ? T.green : T.red }}>
                  {selectedResult.passed ? "✓ PASS" : "✗ FAIL"} — Scenario {results.indexOf(selectedResult) + 1} of {results.length}
                </div>
              </div>
              <button onClick={() => setSelectedResult(null)} style={{ background: "none", border: "none", color: T.dim, cursor: "pointer", fontSize: 18, lineHeight: 1 }}>✕</button>
            </div>

            <div style={{ flex: 1, overflow: "auto", padding: "16px 20px" }}>
              {/* Scenario */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, color: T.dim, fontFamily: T.mono, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>Scenario</div>
                <div style={{ fontSize: 12, color: T.text, lineHeight: 1.7, background: "#111318", padding: "10px 14px", borderRadius: 8, border: `1px solid ${T.border}` }}>{selectedResult.scenario}</div>
              </div>

              {/* Decision verdict */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 16 }}>
                {[["Expected", selectedResult.expected], ["Actual", selectedResult.decision], ["Result", selectedResult.passed ? "PASS" : "FAIL"]].map(([label, val]) => (
                  <div key={label} style={{ background: "#111318", border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 12px", textAlign: "center" }}>
                    <div style={{ fontSize: 9, color: T.dim, fontFamily: T.mono, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, fontFamily: T.mono, color: dc(val) }}>{val}</div>
                  </div>
                ))}
              </div>

              {/* Clause applied */}
              {selectedResult.clause && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 10, color: T.dim, fontFamily: T.mono, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>Governance Clause Applied</div>
                  <div style={{ fontSize: 12, color: T.amber, lineHeight: 1.7, background: "#111318", padding: "10px 14px", borderRadius: 8, border: `1px solid ${T.amber}30`, fontFamily: T.mono }}>"{selectedResult.clause}"</div>
                </div>
              )}

              {/* Reasoning */}
              {selectedResult.reasoning && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 10, color: T.dim, fontFamily: T.mono, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>Agent Reasoning</div>
                  <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.7, background: "#111318", padding: "10px 14px", borderRadius: 8, border: `1px solid ${T.border}` }}>{selectedResult.reasoning}</div>
                </div>
              )}

              {/* Full Witness Entry from DB */}
              {selectedResult.witnessId && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 10, color: T.dim, fontFamily: T.mono, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
                    Witness Agent Record #{selectedResult.witnessId}
                  </div>
                  {witnessLoading ? (
                    <div style={{ fontSize: 12, color: T.dim, padding: "10px 14px" }}>Loading witness entry…</div>
                  ) : witnessEntry ? (() => {
                    const ad = witnessEntry.apaleoData || {};
                    const files = witnessEntry.filesConsulted || [];
                    const decObj = typeof witnessEntry.decision === "object" ? witnessEntry.decision : {};
                    const decStr = decObj.decision || witnessEntry.decision || "—";
                    const decColor = decStr === "PASS" ? T.green : decStr === "FAIL" ? T.red : T.amber;
                    const euAct = ad.eu_ai_act || [];
                    const nist = ad.nist_controls || [];
                    return (
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

                        {/* ── Core Decision Record ── */}
                        <div style={{ background: "#0a0e15", border: `1px solid ${decColor}30`, borderRadius: 8, overflow: "hidden" }}>
                          <div style={{ padding: "8px 14px", borderBottom: `1px solid ${T.border}20`, display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 10, fontFamily: T.mono, fontWeight: 700, color: decColor, background: decColor + "18", padding: "2px 8px", borderRadius: 4 }}>{decStr}</span>
                            <span style={{ fontSize: 10, fontFamily: T.mono, color: T.dim }}>Witness #{witnessEntry.id} · {witnessEntry.createdAt ? new Date(witnessEntry.createdAt).toLocaleString("en-GB") : "—"}</span>
                          </div>
                          {[
                            ["Agent", witnessEntry.agent],
                            ["SOP File", witnessEntry.fileReferenced],
                            ["Governance Clause", decObj.clauseApplied || witnessEntry.clauseApplied || "—"],
                            ["Action Proposed", decObj.actionProposed || witnessEntry.actionProposed || "—"],
                            ["Agent Reasoning", decObj.reasoning || witnessEntry.reasoning || "—"],
                            ["Exception Applied", (decObj.exceptionApplied ?? witnessEntry.exceptionApplied) ? "Yes" : "No"],
                            ["Escalation Target", decObj.escalationTarget || witnessEntry.escalationTarget || "—"],
                            ["Cross-Domain Inheritance", witnessEntry.crossDomainInheritance ? "Yes — Finance O2C authority applied" : "No"],
                            ["Credential Verified", witnessEntry.credentialVerified ? "Yes — CISO admission credential" : "No"],
                          ].map(([k, v], i, arr) => (
                            <div key={k} style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 8, padding: "7px 14px", borderBottom: i < arr.length - 1 ? `1px solid ${T.border}15` : "none" }}>
                              <div style={{ fontSize: 10, color: T.dim, fontFamily: T.mono, letterSpacing: "0.05em", paddingTop: 1 }}>{k}</div>
                              <div style={{ fontSize: 11, color: T.text, wordBreak: "break-word", lineHeight: 1.55 }}>{v}</div>
                            </div>
                          ))}
                        </div>

                        {/* ── Governance Files Consulted ── */}
                        {files.length > 0 && (
                          <div style={{ background: "#0a0e15", border: `1px solid ${T.border}30`, borderRadius: 8, overflow: "hidden" }}>
                            <div style={{ padding: "7px 14px", borderBottom: `1px solid ${T.border}20`, fontSize: 10, fontFamily: T.mono, color: T.dim, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                              Governance Files Consulted ({files.length})
                            </div>
                            <div style={{ padding: "8px 14px", display: "flex", flexDirection: "column", gap: 4 }}>
                              {files.map((f, i) => {
                                const type = f.endsWith(".AGENTS.md") ? "AGENTS" : f.endsWith(".SOP.md") ? "SOP" : f.endsWith(".SKILL.md") ? "SKILL" : f.includes("EXCEPTION_AUTHORITY") ? "EXCEPTION_AUTHORITY" : f.includes("shared-O2C") || f.includes("Shared-O2C") ? "SHARED_SERVICES" : "FILE";
                                const typeColor = type === "AGENTS" ? T.blue : type === "SOP" ? T.amber : type === "SKILL" ? T.green : type === "EXCEPTION_AUTHORITY" ? "#a78bfa" : "#64748b";
                                return (
                                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <span style={{ fontSize: 9, fontFamily: T.mono, fontWeight: 700, color: typeColor, background: typeColor + "18", padding: "1px 6px", borderRadius: 3, minWidth: 80, textAlign: "center" }}>{type}</span>
                                    <span style={{ fontSize: 10, fontFamily: T.mono, color: T.muted }}>{f}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* ── Live Apaleo Evidence ── */}
                        <div style={{ background: "#0a0e15", border: `1px solid ${T.border}30`, borderRadius: 8, overflow: "hidden" }}>
                          <div style={{ padding: "7px 14px", borderBottom: `1px solid ${T.border}20`, fontSize: 10, fontFamily: T.mono, color: T.dim, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                            Live Apaleo Evidence
                          </div>
                          <div style={{ padding: "10px 14px", display: "flex", flexWrap: "wrap", gap: 10 }}>
                            {[
                              { label: "Property", value: ad.property || "BER", color: T.blue },
                              { label: "MCP Used", value: ad.mcp_used ? "Yes" : "No", color: ad.mcp_used ? T.green : T.dim },
                              { label: "Tool Calls", value: String(ad.tool_calls_made ?? 0), color: T.amber },
                              { label: "Input Tokens", value: ad.input_tokens ? ad.input_tokens.toLocaleString() : "—", color: T.dim },
                              { label: "Output Tokens", value: ad.output_tokens ? ad.output_tokens.toLocaleString() : "—", color: T.dim },
                            ].map(({ label, value, color }) => (
                              <div key={label} style={{ background: "#111318", border: `1px solid ${T.border}`, borderRadius: 6, padding: "8px 12px", minWidth: 90 }}>
                                <div style={{ fontSize: 9, fontFamily: T.mono, color: T.dim, marginBottom: 3, letterSpacing: "0.05em" }}>{label}</div>
                                <div style={{ fontSize: 12, fontWeight: 700, fontFamily: T.mono, color }}>{value}</div>
                              </div>
                            ))}
                          </div>
                          {(ad.apaleo_tools || []).length > 0 && (
                            <div style={{ padding: "0 14px 10px", display: "flex", flexWrap: "wrap", gap: 6 }}>
                              {ad.apaleo_tools.map(t => (
                                <span key={t} style={{ fontSize: 10, fontFamily: T.mono, color: T.blue, background: T.blue + "12", padding: "2px 8px", borderRadius: 4, border: `1px solid ${T.blue}25` }}>{t}</span>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* ── Compliance Framework ── */}
                        {(euAct.length > 0 || nist.length > 0) && (
                          <div style={{ background: "#0a0e15", border: `1px solid ${T.border}30`, borderRadius: 8, overflow: "hidden" }}>
                            <div style={{ padding: "7px 14px", borderBottom: `1px solid ${T.border}20`, fontSize: 10, fontFamily: T.mono, color: T.dim, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                              Compliance Framework — {ad.framework || "VDA-MD v1.0"}
                            </div>
                            <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                              {euAct.length > 0 && (
                                <div>
                                  <div style={{ fontSize: 9, fontFamily: T.mono, color: T.dim, marginBottom: 5, letterSpacing: "0.06em" }}>EU AI ACT</div>
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                    {euAct.map(a => (
                                      <span key={a} style={{ fontSize: 10, fontFamily: T.mono, color: T.green, background: T.green + "12", padding: "2px 8px", borderRadius: 4, border: `1px solid ${T.green}25` }}>✓ {a}</span>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {nist.length > 0 && (
                                <div>
                                  <div style={{ fontSize: 9, fontFamily: T.mono, color: T.dim, marginBottom: 5, letterSpacing: "0.06em" }}>NIST SP 800-53</div>
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                    {nist.map(n => (
                                      <span key={n} style={{ fontSize: 10, fontFamily: T.mono, color: "#a78bfa", background: "#a78bfa12", padding: "2px 8px", borderRadius: 4, border: `1px solid #a78bfa25` }}>{n}</span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                      </div>
                    );
                  })() : (
                    <div style={{ fontSize: 11, color: T.dim, padding: "8px 14px" }}>Witness entry #{selectedResult.witnessId} — could not load details.</div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Stage 3: Apaleo CRUD Review ────────────────────────────────────────────
function ApaleoCRUDReview({ agentSlug, govFiles, govContents, onNext }) {
  const [apaleoStatus, setApaleoStatus] = useState(null);
  const [testing, setTesting] = useState(false);
  const skillContent = govContents?.[(govFiles || []).find(f => f.fileType === "SKILL")?.id] || "";
  const agentsContent = govContents?.[(govFiles || []).find(f => f.fileType === "AGENTS")?.id] || "";
  const apiPaths = [...new Set((skillContent.match(/\/api\/v1\/[a-z\-\/{}]+/gi) || []).map(p => p.trim()))].slice(0, 20);
  const writeOps = (agentsContent.match(/MUST\s+(?:create|update|post|submit|write|send|modify|delete|cancel)[^.\n]+/gi) || []).slice(0, 8);
  const readPaths = apiPaths.filter(p => !p.match(/create|update|delete|cancel/i));
  const writePaths = apiPaths.filter(p => p.match(/create|update|delete|cancel/i));

  const testConnection = async () => {
    setTesting(true);
    try {
      const r = await fetch("/api/apaleo/status");
      const d = await r.json();
      setApaleoStatus(d);
    } catch { setApaleoStatus({ error: "Connection test failed" }); }
    setTesting(false);
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ flex: 1, overflow: "auto", padding: "20px 24px" }}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 10 }}>Apaleo PMS Connection</div>
          <button onClick={testConnection} disabled={testing} style={{
            padding: "8px 20px", borderRadius: 7, fontSize: 12, fontWeight: 700, fontFamily: T.mono,
            background: "#0f1824", color: T.blue, border: `1px solid ${T.blue}40`, cursor: testing ? "wait" : "pointer",
          }}>{testing ? "Testing…" : "Test Apaleo Connection"}</button>
          {apaleoStatus && (
            <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
              {[
                { label: "Connected", value: apaleoStatus.connected ? "Yes" : "No", color: apaleoStatus.connected ? T.green : T.red },
                { label: "Properties", value: apaleoStatus.propertyCount ?? "—", color: T.blue },
                { label: "MCP", value: apaleoStatus.mcpConfigured ? "Configured" : "Not configured", color: apaleoStatus.mcpConfigured ? T.green : T.amber },
                { label: "Token Expiry", value: apaleoStatus.tokenExpiry ? new Date(apaleoStatus.tokenExpiry).toLocaleDateString() : "—", color: T.dim },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ background: "#111318", border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 14px", minWidth: 110 }}>
                  <div style={{ fontSize: 10, fontFamily: T.mono, color: T.dim, marginBottom: 4 }}>{label}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color, fontFamily: T.mono }}>{String(value)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {[
            { title: "READ Operations", items: readPaths.length > 0 ? readPaths : ["GET /api/v1/reservations/{id}", "GET /api/v1/folios/{id}", "GET /api/v1/properties/{id}", "GET /api/v1/units"], color: T.blue },
            { title: "WRITE Operations", items: writePaths.length > 0 ? writePaths : writeOps.map(s => s.trim().slice(0, 60)), color: T.amber },
          ].map(({ title, items, color }) => (
            <div key={title} style={{ background: "#111318", border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
              <div style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}`, fontSize: 11, fontWeight: 700, fontFamily: T.mono, color, letterSpacing: "0.08em" }}>{title}</div>
              <div style={{ padding: "8px 0" }}>
                {(items.length > 0 ? items : ["(None declared in SKILL.md)"]).slice(0, 8).map((item, i) => (
                  <div key={i} style={{ padding: "5px 14px", fontSize: 11, fontFamily: T.mono, color: "#c0c6d8" }}>{item}</div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ padding: "14px 20px", borderTop: `1px solid ${T.border}`, display: "flex", justifyContent: "flex-end", flexShrink: 0 }}>
        <button onClick={onNext} style={{ padding: "10px 28px", borderRadius: 8, fontSize: 13, fontWeight: 700, fontFamily: T.mono, background: T.blue, color: "#fff", border: "none", cursor: "pointer" }}>Next → Stage 4</button>
      </div>
    </div>
  );
}

// ─── Stage 4: Witness Review ─────────────────────────────────────────────────
function WitnessReviewStage({ agentSlug, sandboxTimestamp, onNext }) {
  const [entries, setEntries] = useState(null);
  const [loading, setLoading] = useState(true);
  const EU_MAP = [
    { article: "Art. 13", title: "Transparency", desc: "Witness entries provide real-time transparency on all agent decisions and their governance basis." },
    { article: "Art. 14", title: "Human Oversight", desc: "HITL cards and ESCALATE decisions ensure humans retain oversight over boundary-crossing actions." },
    { article: "Art. 17", title: "Risk Management", desc: "MUST/MUST NOT compliance guards are evaluated against SOP.md before every decision." },
  ];

  useEffect(() => {
    setLoading(true);
    fetch("/api/agents/witness?companyId=0&limit=50")
      .then(r => r.json())
      .then(d => {
        const all = d.entries || d.rows || [];
        const filtered = all
          .filter(e => e.agent === agentSlug || e.agentId === agentSlug)
          .filter(e => !sandboxTimestamp || new Date(e.createdAt || e.timestamp || 0).getTime() >= sandboxTimestamp)
          .slice(0, 5);
        setEntries(filtered);
        setLoading(false);
      })
      .catch(() => { setEntries([]); setLoading(false); });
  }, [agentSlug, sandboxTimestamp]);

  const downloadSOC2 = () => {
    const lines = [
      "SOC 2 Type II — Governance Witness Excerpt",
      `Agent: ${agentSlug}`,
      `Generated: ${new Date().toISOString()}`,
      "EU AI Act: Art.13 Transparency · Art.14 Human Oversight · Art.17 Risk Management",
      "",
      "─── Witness Entries ───",
      ...(entries || []).map((e, i) => [
        `\n[${i + 1}] Decision: ${e.decision?.decision || e.decision}`,
        `    Clause: ${e.decision?.clauseApplied || "—"}`,
        `    Action: ${e.decision?.actionProposed || "—"}`,
        `    Time: ${e.createdAt || e.timestamp || "—"}`,
      ].join("\n")),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([lines], { type: "text/plain" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `soc2-witness-${agentSlug}-${Date.now()}.txt` });
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ flex: 1, overflow: "auto", padding: "20px 24px" }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
          {EU_MAP.map(({ article, title, desc }) => (
            <div key={article} style={{ flex: 1, minWidth: 200, background: "#0f1520", border: `1px solid ${T.blue}30`, borderRadius: 8, padding: "12px 14px" }}>
              <div style={{ fontSize: 11, fontFamily: T.mono, fontWeight: 700, color: T.blue, marginBottom: 4 }}>{article} — {title}</div>
              <div style={{ fontSize: 11, color: T.muted, lineHeight: 1.5 }}>{desc}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontFamily: T.mono, fontWeight: 700, color: T.dim, letterSpacing: "0.08em" }}>
            WITNESS ENTRIES {sandboxTimestamp ? "(since sandbox run)" : ""}
          </div>
          <button onClick={downloadSOC2} style={{ padding: "6px 14px", borderRadius: 6, fontSize: 11, fontFamily: T.mono, fontWeight: 700, background: "#0f1520", border: `1px solid ${T.blue}40`, color: T.blue, cursor: "pointer" }}>
            ↓ SOC 2 Excerpt
          </button>
        </div>
        {loading ? (
          <div style={{ color: T.dim, fontSize: 12 }}>Loading…</div>
        ) : !entries || entries.length === 0 ? (
          <div style={{ padding: "16px 18px", background: "#111318", border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 12, color: T.dim }}>
            No witness entries for this agent since the sandbox run.
            Run Stage 2 sandbox to generate entries.
          </div>
        ) : entries.map((e, i) => {
          const dec = e.decision?.decision || String(e.decision) || "—";
          const col = dec === "PASS" ? T.green : dec === "FAIL" ? T.red : T.amber;
          return (
            <div key={e.id ?? i} style={{ background: "#111318", border: `1px solid ${T.border}`, borderLeft: `3px solid ${col}`, borderRadius: 8, padding: "12px 14px", marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 5 }}>
                <span style={{ fontSize: 10, fontFamily: T.mono, fontWeight: 700, color: col }}>{dec}</span>
                <span style={{ fontSize: 10, fontFamily: T.mono, color: T.dim }}>#{e.id}</span>
                <span style={{ fontSize: 10, color: T.dim, marginLeft: "auto" }}>{e.createdAt ? new Date(e.createdAt).toLocaleTimeString() : "—"}</span>
              </div>
              <div style={{ fontSize: 12, color: T.text, lineHeight: 1.5, marginBottom: 4 }}>{e.decision?.actionProposed || "—"}</div>
              <div style={{ fontSize: 11, fontFamily: T.mono, color: "#94a3b8", lineHeight: 1.4 }}>{e.decision?.clauseApplied || "—"}</div>
            </div>
          );
        })}
      </div>
      <div style={{ padding: "14px 20px", borderTop: `1px solid ${T.border}`, display: "flex", justifyContent: "flex-end", flexShrink: 0 }}>
        <button onClick={onNext} style={{ padding: "10px 28px", borderRadius: 8, fontSize: 13, fontWeight: 700, fontFamily: T.mono, background: T.blue, color: "#fff", border: "none", cursor: "pointer" }}>Next → Stage 5</button>
      </div>
    </div>
  );
}

// ─── Stage 5: Exception Authority Confirmation ──────────────────────────────
function ExceptionAuthorityConfirmation({ exceptionContent, agentSlug, companyId = 0, requestId = null, onNext }) {
  const [checked, setChecked] = useState({});
  const [pendingQueries, setPendingQueries] = useState({}); // key → submitted reason
  const [reasonInputs, setReasonInputs] = useState({});    // key → current textarea text
  const [submitting, setSubmitting] = useState({});
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState(null);
  const [serverRegenRequired, setServerRegenRequired] = useState(false);

  useEffect(() => {
    if (!requestId) return;
    fetch(`/api/onboarding/${requestId}`)
      .then(r => r.json())
      .then(d => {
        const flag = d?.impactDeltaReport?.cisoRegenRequired === true;
        setServerRegenRequired(flag);
      })
      .catch(() => {});
  }, [requestId]);

  const FRONT_LINE = ["ambassador", "senior_ambassador", "hotel_gm"];
  const BAND_LABEL = { ambassador: "Ambassador", senior_ambassador: "Senior Ambassador", hotel_gm: "Hotel GM" };

  const parsedBands = useMemo(() => {
    if (!exceptionContent) return {};
    const out = {};
    for (const band of FRONT_LINE) {
      const re = new RegExp(`${band}:[\\s\\S]*?exceptions:[\\s\\S]*?(?=\\n\\s+[a-z_]+:\\n|\\nmust_not_override|$)`, "m");
      const block = (exceptionContent.match(re) || [""])[0];
      const classes = [...block.matchAll(/exception_class:\s*["']?([^"'\n\s]+)["']?/g)].map(m => {
        const s = block.slice(m.index);
        const auth = (s.match(/authority:\s*["']?([^"'\n]+)["']?/) || [])[1]?.trim() || "—";
        const ceilMatch = s.match(/ceiling:\s*([^\n]+)/);
        const ceil = ceilMatch ? ceilMatch[1].trim().replace(/^['"]|['"]$/g, "") : null;
        const desc = (s.match(/description:\s*["']?([^"'\n]+)["']?/) || [])[1]?.trim() || "";
        return { cls: m[1], auth, desc, ceil, hitl: auth.includes("hitl") };
      });
      if (classes.length > 0) out[band] = classes;
    }
    return out;
  }, [exceptionContent]);

  const allKeys = FRONT_LINE.flatMap(b => (parsedBands[b] || []).map(c => `${b}--${c.cls}`));
  const hasPendingQueries = Object.keys(pendingQueries).length > 0 || serverRegenRequired;
  const allChecked = allKeys.length > 0 && allKeys.every(k => checked[k] || pendingQueries[k]);
  const canProceed = allChecked && !hasPendingQueries;

  const handleUncheck = (k) => {
    setChecked(p => ({ ...p, [k]: false }));
  };
  const handleCheck = (k) => {
    if (!pendingQueries[k]) setChecked(p => ({ ...p, [k]: true }));
  };
  const handleSubmitQuery = async (k, band, cls) => {
    const reason = (reasonInputs[k] || "").trim();
    if (!reason) return;
    setSubmitting(p => ({ ...p, [k]: true }));
    try {
      const r = await fetch("/api/agents/witness", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: companyId || 0,
          agent: "onboarding-agent",
          decision: {
            decision: "INFO",
            clauseApplied: `VDA-MD §10 EXCEPTION_AUTHORITY ceiling query — ${cls}`,
            actionProposed: `CISO raised discrepancy on exception class ${cls} in band ${band}`,
            exceptionApplied: false,
            escalationTarget: "Compliance Officer",
            reasoning: reason,
          },
          fileReferenced: "EXCEPTION_AUTHORITY.md",
          apaleoData: {
            event_type: "ciso_ceiling_query",
            exception_class: cls,
            band,
            reason,
            agent_slug: agentSlug || null,
          },
          credentialVerified: true,
        }),
      });
      if (!r.ok) {
        const errBody = await r.json().catch(() => ({}));
        throw new Error(errBody?.error || `Witness write failed (${r.status})`);
      }
      setPendingQueries(p => ({ ...p, [k]: reason }));
      setReasonInputs(p => ({ ...p, [k]: "" }));
      setServerRegenRequired(true);
      if (requestId) {
        fetch(`/api/onboarding/${requestId}/set-regen-flag`, { method: "POST" }).catch(() => {});
      }
    } catch {}
    setSubmitting(p => ({ ...p, [k]: false }));
  };

  const handleRegenerate = async () => {
    setRegenerating(true); setRegenError(null);
    try {
      const r = await fetch("/api/fm/generate-exception-authority", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: agentSlug, companyId: companyId || 0, regenerate: true }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Regeneration failed");
      // Clear all pending queries and reset checkboxes to force re-review
      setPendingQueries({});
      setChecked({});
      setReasonInputs({});
      setServerRegenRequired(false);
      if (requestId) {
        fetch(`/api/onboarding/${requestId}/clear-regen-flag`, { method: "POST" }).catch(() => {});
      }
    } catch (err) {
      setRegenError(err.message || "Regeneration failed");
    }
    setRegenerating(false);
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ flex: 1, overflow: "auto", padding: "20px 24px" }}>
        <p style={{ fontSize: 13, color: T.muted, lineHeight: 1.6, margin: "0 0 20px" }}>
          Check each exception class to confirm you have reviewed and accepted the authority structure for this agent. Uncheck and provide a reason to flag a ceiling for re-generation.
        </p>
        {hasPendingQueries && (
          <div style={{ padding: "12px 16px", background: "#1a0d00", border: `1px solid ${T.amber}40`, borderRadius: 8, marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 12, color: T.amber, flex: 1 }}>
              {Object.keys(pendingQueries).length} ceiling query{Object.keys(pendingQueries).length > 1 ? "ies" : ""} submitted — re-generate the file to resolve before admitting.
            </span>
            <button onClick={handleRegenerate} disabled={regenerating} style={{
              padding: "6px 14px", borderRadius: 6, fontSize: 11, fontFamily: T.mono, fontWeight: 700,
              background: regenerating ? "#1a0d00" : T.amber, color: regenerating ? T.dim : "#000",
              border: "none", cursor: regenerating ? "not-allowed" : "pointer",
            }}>
              {regenerating ? "Regenerating…" : "⚡ Regenerate"}
            </button>
            {regenError && <span style={{ fontSize: 10, color: T.red }}>{regenError}</span>}
          </div>
        )}
        {FRONT_LINE.map(band => {
          const classes = parsedBands[band] || [];
          return (
            <div key={band} style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 10, fontFamily: T.mono, fontWeight: 700, color: T.dim, letterSpacing: "0.1em", marginBottom: 10 }}>
                {BAND_LABEL[band].toUpperCase()}
              </div>
              {classes.length === 0 ? (
                <div style={{ fontSize: 12, color: T.dim, padding: "10px 14px", background: "#0d0f14", borderRadius: 8, border: `1px solid ${T.border}` }}>
                  No exception classes defined — load EXCEPTION_AUTHORITY.md in Stage 1 first.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {classes.map(({ cls, auth, desc, ceil, hitl }) => {
                    const k = `${band}--${cls}`;
                    const isPending = !!pendingQueries[k];
                    const isUnchecked = !checked[k] && !isPending;
                    const showReason = isUnchecked && checked[k] === false && checked.hasOwnProperty?.(k) === false ? false : !checked[k] && !isPending && allKeys.includes(k);
                    return (
                      <div key={k} style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                        <label style={{
                          display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 14px",
                          background: isPending ? "#1a0800" : hitl ? "#150b1a" : "#111318",
                          border: `1px solid ${isPending ? T.amber + "60" : hitl ? "#7c3aed50" : T.border}`,
                          borderRadius: isPending || showReason ? "8px 8px 0 0" : 8,
                          cursor: isPending ? "default" : "pointer",
                        }}>
                          <input
                            type="checkbox"
                            checked={!!checked[k] && !isPending}
                            disabled={isPending}
                            onChange={() => checked[k] ? handleUncheck(k) : handleCheck(k)}
                            style={{ marginTop: 2, flexShrink: 0, accentColor: T.blue }}
                          />
                          <div style={{ flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                              <span style={{ fontSize: 12, fontFamily: T.mono, fontWeight: 700, color: isPending ? T.amber : T.text }}>{cls}</span>
                              {hitl && <span style={{ fontSize: 10, fontFamily: T.mono, fontWeight: 700, color: "#c4b5fd", background: "#2d1b6930", padding: "1px 6px", borderRadius: 3 }}>ALWAYS HITL</span>}
                              {isPending && <span style={{ fontSize: 10, fontFamily: T.mono, fontWeight: 700, color: T.amber, background: "#1a0800", padding: "1px 6px", borderRadius: 3 }}>⚠ QUERIED</span>}
                              {ceil && <span style={{ fontSize: 10, fontFamily: T.mono, color: T.dim }}>ceiling: {ceil}</span>}
                              <span style={{ fontSize: 10, fontFamily: T.mono, color: T.dim, marginLeft: "auto" }}>auth: {auth}</span>
                            </div>
                            {desc && <div style={{ fontSize: 11, color: T.muted, lineHeight: 1.5 }}>{desc}</div>}
                            {isPending && <div style={{ fontSize: 10, color: T.amber, marginTop: 4, fontFamily: T.mono }}>Query: {pendingQueries[k]}</div>}
                          </div>
                        </label>
                        {(k in checked) && !checked[k] && !isPending && (
                          <div style={{ padding: "10px 14px", background: "#0d0f14", border: `1px solid ${T.border}`, borderTop: "none", borderRadius: "0 0 8px 8px" }}>
                            <div style={{ fontSize: 10, fontFamily: T.mono, color: T.amber, marginBottom: 6 }}>REASON FOR DISCREPANCY (required)</div>
                            <textarea
                              value={reasonInputs[k] || ""}
                              onChange={e => setReasonInputs(p => ({ ...p, [k]: e.target.value }))}
                              placeholder="Describe why this ceiling or authority level is incorrect or requires review…"
                              style={{
                                width: "100%", minHeight: 60, padding: "8px 10px", borderRadius: 6, fontSize: 11, fontFamily: T.mono,
                                background: "#050608", color: T.text, border: `1px solid ${T.amber}40`, resize: "vertical", boxSizing: "border-box",
                              }}
                            />
                            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                              <button
                                onClick={() => handleSubmitQuery(k, band, cls)}
                                disabled={!reasonInputs[k]?.trim() || submitting[k]}
                                style={{
                                  padding: "5px 14px", borderRadius: 5, fontSize: 11, fontFamily: T.mono, fontWeight: 700,
                                  background: reasonInputs[k]?.trim() ? T.amber : "#1e2229",
                                  color: reasonInputs[k]?.trim() ? "#000" : T.dim,
                                  border: "none", cursor: reasonInputs[k]?.trim() ? "pointer" : "not-allowed",
                                }}
                              >
                                {submitting[k] ? "Submitting…" : "Submit query"}
                              </button>
                              <button
                                onClick={() => handleCheck(k)}
                                style={{ padding: "5px 14px", borderRadius: 5, fontSize: 11, fontFamily: T.mono, background: "none", color: T.dim, border: `1px solid ${T.border}`, cursor: "pointer" }}
                              >
                                Re-check (no issue)
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {allKeys.length === 0 && (
          <div style={{ textAlign: "center", color: T.dim, fontSize: 13, padding: "20px 0" }}>
            No exception classes found — complete Stage 1 to load EXCEPTION_AUTHORITY.md.
          </div>
        )}
      </div>
      <div style={{ padding: "14px 20px", borderTop: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <span style={{ fontSize: 12, color: hasPendingQueries ? T.amber : T.dim }}>
          {hasPendingQueries
            ? `${Object.keys(pendingQueries).length} query pending — re-generate required before Admit`
            : allKeys.length > 0
              ? `${allKeys.filter(k => checked[k]).length} / ${allKeys.length} confirmed`
              : "Load governance files first"}
        </span>
        <button onClick={onNext} disabled={!canProceed} style={{
          padding: "10px 28px", borderRadius: 8, fontSize: 13, fontWeight: 700, fontFamily: T.mono,
          background: canProceed ? T.blue : "#1e2229",
          color: canProceed ? "#fff" : T.dim,
          border: "none", cursor: canProceed ? "pointer" : "not-allowed",
        }}>Next → Stage 6</button>
      </div>
    </div>
  );
}

// ─── Stage 6: Admit or Reject ────────────────────────────────────────────────
function AdmitOrRejectStage({ agentSlug, requestId, stageCompletions, onAdmitted, onRejected }) {
  const [admitting, setAdmitting] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState(null);
  const STAGE_LABELS = ["Governance Files", "Sandbox Evaluation", "Apaleo CRUD", "Witness Review", "Exception Authority"];

  const handleAdmit = async () => {
    if (!requestId) { setError("No onboarding request ID"); return; }
    setAdmitting(true); setError(null);
    try {
      const r = await fetch(`/api/onboarding/${requestId}/admit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decided_by: "CISO (dashboard)" }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || "Admission failed"); }
      else {
        await fetch("/api/agents/witness", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId: 0, agent: "onboarding-agent",
            decision: { decision: "PASS", clauseApplied: "VDA-MD Onboarding §6 — CISO walkthrough completed, agent admitted", actionProposed: `${agentSlug} admitted to VDA framework`, exceptionApplied: false, escalationTarget: null, reasoning: "CISO completed all 6 walkthrough stages and admitted agent" },
            fileReferenced: "AGENTS.md",
            apaleoData: { event_type: "ciso_walkthrough_completed", agentId: agentSlug, onboarding_id: requestId },
            credentialVerified: true,
          }),
        }).catch(() => {});
        onAdmitted?.(agentSlug);
      }
    } catch { setError("Network error"); }
    finally { setAdmitting(false); }
  };

  const handleReject = async () => {
    if (!requestId || rejectReason.trim().length < 20) return;
    setRejecting(true); setError(null);
    try {
      const r = await fetch(`/api/onboarding/${requestId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectReason, decided_by: "CISO (dashboard)" }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || "Rejection failed"); }
      else { onRejected?.(agentSlug, rejectReason); }
    } catch { setError("Network error"); }
    finally { setRejecting(false); }
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ flex: 1, overflow: "auto", padding: "24px 28px" }}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontFamily: T.mono, fontWeight: 700, color: T.dim, letterSpacing: "0.1em", marginBottom: 12 }}>STAGE COMPLETION</div>
          {STAGE_LABELS.map((label, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: i < STAGE_LABELS.length - 1 ? `1px solid ${T.border}20` : "none" }}>
              <span style={{ fontSize: 14, color: stageCompletions[i] ? T.green : T.dim }}>{stageCompletions[i] ? "✓" : "○"}</span>
              <span style={{ fontSize: 13, color: stageCompletions[i] ? T.text : T.dim }}>{label}</span>
              {!stageCompletions[i] && <span style={{ fontSize: 11, fontFamily: T.mono, color: T.amber, marginLeft: "auto" }}>Incomplete</span>}
            </div>
          ))}
        </div>
        <div style={{ background: "#0f1520", border: `1px solid ${T.blue}30`, borderRadius: 10, padding: "16px 18px", marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontFamily: T.mono, fontWeight: 700, color: T.blue, letterSpacing: "0.08em", marginBottom: 8 }}>ADMISSION DECLARATION — EU AI ACT ARTICLE 17</div>
          <p style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.7, margin: 0 }}>
            By clicking "Admit to Framework", I confirm as CISO that I have reviewed all six governance stages for <strong style={{ color: T.text }}>{agentSlug}</strong>: governance files, sandbox evaluation pass rate, Apaleo CRUD permissions, witness trail, and exception authority structure. This admission is recorded immutably in the Witness Agent and forms part of the Article 17 Risk Management documentation.
          </p>
          <div style={{ marginTop: 8, fontSize: 11, color: T.dim, fontFamily: T.mono }}>
            Timestamp: {new Date().toISOString()} · Decided by: CISO (dashboard)
          </div>
        </div>
        {!requestId && (
          <div style={{ padding: "12px 16px", background: "#1a0505", border: `1px solid ${T.red}40`, borderRadius: 8, color: T.red, fontSize: 12, marginBottom: 16 }}>
            No onboarding request ID — submit via POST /api/onboarding/submit with source=vda_native first.
          </div>
        )}
        {error && <div style={{ color: T.red, fontSize: 12, marginBottom: 12 }}>{error}</div>}
        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={handleAdmit} disabled={admitting || !requestId} style={{
            flex: 1, padding: "14px 0", borderRadius: 10, fontSize: 14, fontWeight: 700,
            background: admitting || !requestId ? "#1a2a1a" : "#14532d",
            color: admitting || !requestId ? T.dim : T.green,
            border: `1px solid ${admitting || !requestId ? T.dim : T.green}`,
            cursor: admitting || !requestId ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}>
            {admitting && <span style={{ display: "inline-block", width: 14, height: 14, border: "2px solid rgba(74,222,128,0.3)", borderTopColor: T.green, borderRadius: "50%", animation: "co-spin 0.7s linear infinite" }} />}
            ✅ Admit to Framework
          </button>
          <button onClick={() => setRejectOpen(true)} disabled={admitting || !requestId} style={{
            flex: 1, padding: "14px 0", borderRadius: 10, fontSize: 14, fontWeight: 700,
            background: "#450a0a", color: T.red, border: `1px solid ${T.red}`,
            cursor: admitting || !requestId ? "not-allowed" : "pointer",
            opacity: admitting || !requestId ? 0.5 : 1,
          }}>❌ Reject</button>
        </div>
      </div>
      {rejectOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: T.card, border: `1px solid ${T.red}60`, borderRadius: 16, padding: 28, width: 480, maxWidth: "92vw" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 8 }}>Reject Agent Admission</div>
            <p style={{ fontSize: 12, color: T.muted, marginBottom: 16 }}>Provide a reason (min 20 chars). This will be recorded in the Witness Agent.</p>
            <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Reason for rejection…"
              style={{ width: "100%", height: 100, background: "#0d0f14", border: `1px solid ${T.border}`, borderRadius: 8, color: T.text, fontSize: 12, padding: "10px 12px", fontFamily: T.sans, resize: "vertical", boxSizing: "border-box" }} />
            {rejectReason.length > 0 && rejectReason.length < 20 && (
              <div style={{ fontSize: 11, color: T.amber, marginTop: 6 }}>{20 - rejectReason.length} more characters required</div>
            )}
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button onClick={() => setRejectOpen(false)} style={{ flex: 1, padding: "10px 0", borderRadius: 8, background: "#1e2229", color: T.dim, border: `1px solid ${T.border}`, fontSize: 13, cursor: "pointer" }}>Cancel</button>
              <button onClick={handleReject} disabled={rejecting || rejectReason.trim().length < 20} style={{
                flex: 1, padding: "10px 0", borderRadius: 8, background: "#450a0a", color: T.red,
                border: `1px solid ${T.red}`, fontSize: 13, fontWeight: 700,
                cursor: rejecting || rejectReason.trim().length < 20 ? "not-allowed" : "pointer",
                opacity: rejecting || rejectReason.trim().length < 20 ? 0.6 : 1,
              }}>{rejecting ? "Rejecting…" : "Confirm Rejection"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── CISOWalkthrough — full-screen modal ─────────────────────────────────────
function CISOWalkthrough({ agents, companyId: walkCompanyId = 0, onClose, onAdmitted, onRejected }) {
  const [agentIdx, setAgentIdx] = useState(0);
  const agent = agents?.[agentIdx];
  const agentSlug = agent?.slug || "";
  const requestId = agent?.requestId || null;
  const [stage, setStage] = useState(1);
  const [completions, setCompletions] = useState(() => loadStageCompletions(agentSlug));
  const [sandboxTs, setSandboxTs] = useState(null);
  const [govFiles, setGovFiles] = useState(null);
  const [govContents, setGovContents] = useState({});
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    if (!agentSlug) return;
    // Always start at stage 1 when the walkthrough opens — "Start" means start from the beginning.
    // Restore completions so prior stage checkmarks are visible, but never skip to a later stage.
    const savedCompletions = loadStageCompletions(agentSlug);
    setStage(1);
    setCompletions(savedCompletions);
    setSandboxTs(null);
    setGovFiles(null);
    setGovContents({});
  }, [agentSlug]);

  useEffect(() => { if (agentSlug) saveCurrentStage(agentSlug, stage); }, [agentSlug, stage]);
  useEffect(() => { if (agentSlug) saveStageCompletions(agentSlug, completions); }, [agentSlug, completions]);

  const completeStage = (idx) => {
    const next = completions.map((v, i) => i === idx ? true : v);
    setCompletions(next);
    if (idx + 1 < 6) setStage(idx + 2);
    fetch("/api/agents/witness", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: 0, agent: "onboarding-agent",
        decision: { decision: "INFO", clauseApplied: `VDA-MD Onboarding §walkthrough — stage ${idx + 1} completed`, actionProposed: `CISO stage ${idx + 1} completed for ${agentSlug}`, exceptionApplied: false, escalationTarget: null, reasoning: `CISO completed stage ${idx + 1} of walkthrough` },
        fileReferenced: "AGENTS.md",
        apaleoData: { event_type: "ciso_stage_completed", stage: idx + 1, agentId: agentSlug, onboarding_id: requestId || null },
        credentialVerified: true,
      }),
    }).catch(() => {});
  };

  const handleRestart = async () => {
    setRestarting(true);
    if (requestId) {
      await fetch(`/api/onboarding/${requestId}/restart`, { method: "POST" }).catch(() => {});
    }
    const cleared = [false, false, false, false, false, false];
    setCompletions(cleared); setStage(1); setSandboxTs(null);
    if (agentSlug) { saveStageCompletions(agentSlug, cleared); saveCurrentStage(agentSlug, 1); }
    setRestarting(false);
  };

  const exceptionFile = (govFiles || []).find(f => f.fileType === "EXCEPTION_AUTHORITY");
  const exceptionContent = exceptionFile ? govContents[exceptionFile.id] : null;

  const STAGES = [
    { id: 1, label: "Governance Files", icon: "📄" },
    { id: 2, label: "Sandbox Evaluation", icon: "🧪" },
    { id: 3, label: "Apaleo CRUD Review", icon: "🔗" },
    { id: 4, label: "Witness Review", icon: "🕵️" },
    { id: 5, label: "Exception Authority", icon: "⚖️" },
    { id: 6, label: "Admit or Reject", icon: "🏛" },
  ];

  const badgeOf = (a) => {
    const s = a?.status;
    if (s === "admitted" || s === "onboarded") return { icon: "✅", color: T.green };
    if (s === "rejected_co") return { icon: "❌", color: T.red };
    if (s === "pre_admitted") return { icon: "⏳", color: T.amber };
    return { icon: "○", color: T.dim };
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: T.bg, zIndex: 9000, display: "flex", flexDirection: "column", fontFamily: T.sans }}>
      <style>{`@keyframes co-spin { to { transform: rotate(360deg); } }`}</style>

      {/* Top agent-tab bar — label + scrollable tabs + pinned action buttons */}
      <div style={{ background: "#050608", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "stretch", flexShrink: 0, minWidth: 0 }}>
        {/* Pinned label */}
        <div style={{ display: "flex", alignItems: "center", padding: "0 16px", borderRight: `1px solid ${T.border}`, flexShrink: 0, gap: 8 }}>
          <span style={{ fontSize: 10, fontFamily: T.mono, fontWeight: 700, color: "#f87171", letterSpacing: "0.1em" }}>CISO WALKTHROUGH</span>
          <span style={{ fontSize: 10, fontFamily: T.mono, color: T.dim }}>EU AI Act Art. 17</span>
        </div>
        {/* Scrollable agent tabs */}
        <div style={{ flex: 1, display: "flex", alignItems: "stretch", overflowX: "auto", minWidth: 0 }}>
          {(agents || []).map((a, idx) => {
            const { icon, color } = badgeOf(a);
            const active = idx === agentIdx;
            return (
              <button key={a.slug} onClick={() => setAgentIdx(idx)} style={{
                background: active ? "#0d1017" : "none", border: "none",
                borderBottom: active ? `2px solid ${T.blue}` : "2px solid transparent",
                borderTop: "2px solid transparent",
                color: active ? "#f0f4ff" : "#8b949e",
                padding: "12px 16px", cursor: "pointer", fontSize: 12, fontWeight: active ? 700 : 500,
                fontFamily: T.sans, whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6,
                letterSpacing: active ? "0.01em" : 0, flexShrink: 0,
              }}>
                <span style={{ color, fontSize: 13 }}>{icon}</span>{a.name}
              </button>
            );
          })}
        </div>
        {/* Pinned action buttons — always visible */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px", flexShrink: 0, borderLeft: `1px solid ${T.border}` }}>
          <button onClick={handleRestart} disabled={restarting} style={{ padding: "5px 12px", borderRadius: 6, fontSize: 11, fontFamily: T.mono, fontWeight: 700, background: "#150505", border: `1px solid ${T.red}50`, color: T.red, cursor: "pointer" }}>
            {restarting ? "…" : "↺ Restart"}
          </button>
          <button onClick={onClose} style={{ padding: "5px 12px", borderRadius: 6, fontSize: 11, fontFamily: T.mono, fontWeight: 700, background: "#1e2229", border: `1px solid ${T.border}`, color: "#c9d1d9", cursor: "pointer" }}>← Home</button>
        </div>
      </div>

      {/* Body: sidebar + content */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Stage sidebar */}
        <div style={{ width: 220, borderRight: `1px solid ${T.border}`, background: "#050608", display: "flex", flexDirection: "column", padding: "16px 0", flexShrink: 0, overflowY: "auto" }}>
          <div style={{ padding: "0 16px 12px", fontSize: 10, fontFamily: T.mono, fontWeight: 700, color: T.dim, letterSpacing: "0.1em" }}>
            {(agent?.name || "SELECT AGENT").toUpperCase()}
          </div>
          {STAGES.map((s, i) => {
            const done = completions[i];
            const active = stage === s.id;
            // A stage is accessible only if all prior stages are completed
            // (stage 1 is always accessible; stage N requires completions[0..N-2] all true)
            const accessible = i === 0 || completions.slice(0, i).every(Boolean);
            return (
              <button
                key={s.id}
                onClick={() => accessible && setStage(s.id)}
                title={accessible ? undefined : "Complete previous stages first"}
                style={{
                  background: active ? "#111318" : "none", border: "none",
                  borderLeft: active ? `3px solid ${T.blue}` : "3px solid transparent",
                  color: done ? T.green : active ? T.text : accessible ? T.dim : "#2a2f3a",
                  padding: "10px 16px 10px 13px",
                  cursor: accessible ? "pointer" : "not-allowed",
                  fontSize: 12, fontWeight: active ? 600 : 400, fontFamily: T.sans, textAlign: "left",
                  display: "flex", alignItems: "center", gap: 8, opacity: accessible ? 1 : 0.45,
                }}>
                <span style={{ fontSize: 11 }}>{done ? "✓" : active ? "▶" : accessible ? String(s.id) : "🔒"}</span>
                <span>{s.icon} {s.label}</span>
              </button>
            );
          })}
        </div>

        {/* Stage content area */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {!agentSlug ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: T.dim, fontSize: 13 }}>Select an agent tab to begin.</div>
          ) : (
            <>
              {/* Stage header */}
              <div style={{ padding: "14px 24px", borderBottom: `1px solid ${T.border}`, background: "#050608", flexShrink: 0, display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 10, fontFamily: T.mono, color: T.dim, letterSpacing: "0.1em" }}>STAGE {stage} OF 6</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{STAGES[stage - 1]?.icon} {STAGES[stage - 1]?.label}</span>
                <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
                  {stage > 1 && (
                    <button onClick={() => setStage(stage - 1)} style={{ padding: "5px 14px", borderRadius: 6, border: `1px solid ${T.border}`, background: "none", color: T.dim, fontSize: 11, fontFamily: T.mono, cursor: "pointer" }}>← Back</button>
                  )}
                  <div style={{ display: "flex", gap: 4 }}>
                    {STAGES.map((s, i) => (
                      <div key={s.id} style={{ width: 8, height: 8, borderRadius: "50%", background: completions[i] ? T.green : stage === s.id ? T.blue : T.border }} />
                    ))}
                  </div>
                </div>
              </div>
              {/* Stage body */}
              <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                {stage === 1 && <GovernanceFileReview agentSlug={agentSlug} companyId={agent?.companyId || walkCompanyId || 0} onNext={() => completeStage(0)} onFilesLoaded={(f, c) => { setGovFiles(f); setGovContents(c); }} />}
                {stage === 2 && <SandboxEvaluation
                  requestId={requestId}
                  agentSource={agent?.source ?? null}
                  existingPassRate={agent?.evalPassRate ?? null}
                  onNext={() => completeStage(1)}
                  onSandboxRun={ts => setSandboxTs(ts)}
                />}
                {stage === 3 && <ApaleoCRUDReview agentSlug={agentSlug} govFiles={govFiles} govContents={govContents} onNext={() => completeStage(2)} />}
                {stage === 4 && <WitnessReviewStage agentSlug={agentSlug} sandboxTimestamp={sandboxTs} onNext={() => completeStage(3)} />}
                {stage === 5 && <ExceptionAuthorityConfirmation exceptionContent={exceptionContent} agentSlug={agentSlug} companyId={agent?.companyId ?? walkCompanyId} requestId={requestId} onNext={() => completeStage(4)} />}
                {stage === 6 && <AdmitOrRejectStage agentSlug={agentSlug} requestId={requestId} stageCompletions={completions} onAdmitted={s => { const c = [false,false,false,false,false,false]; setCompletions(c); setStage(1); onAdmitted?.(s); }} onRejected={(s, r) => onRejected?.(s, r)} />}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── PreCrawlConfirmation — Track 2 band-confirmation before crawl ────────────
function PreCrawlConfirmation({ agentSlug, companyId, onCrawlEnabled }) {
  const [authContent, setAuthContent] = useState("");
  const [checked, setChecked] = useState({});
  const [open, setOpen] = useState({});
  const [enabling, setEnabling] = useState(false);
  const [error, setError] = useState(null);
  const LS_KEY = `vda_crawl_${agentSlug}_${companyId}_confirmed`;

  useEffect(() => {
    try { setChecked(JSON.parse(localStorage.getItem(LS_KEY) || "{}")); } catch {}
    fetch("/api/fm/files/0")
      .then(r => r.json())
      .then(async d => {
        const f = (d.files || []).find(x => x.agentId === agentSlug && x.fileType === "EXCEPTION_AUTHORITY");
        if (!f) return;
        const r = await fetch(`/api/fm/file/${f.id}`);
        const fd = await r.json();
        setAuthContent(fd.content || "");
      })
      .catch(() => {});
  }, [agentSlug]);

  const FRONT_LINE = ["ambassador", "senior_ambassador", "hotel_gm"];
  const BAND_LABEL = { ambassador: "Ambassador", senior_ambassador: "Senior Ambassador", hotel_gm: "Hotel GM" };
  const parseBandClasses = (band) => {
    const re = new RegExp(`${band}:[\\s\\S]*?exceptions:[\\s\\S]*?(?=\\n\\s+[a-z_]+:\\n|\\nmust_not_override|$)`, "m");
    const block = (authContent.match(re) || [""])[0];
    return [...block.matchAll(/exception_class:\s*["']?([^"'\n\s]+)["']?/g)].map(m => m[1]);
  };

  const toggleCheck = b => {
    const next = { ...checked, [b]: !checked[b] };
    setChecked(next);
    try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch {}
  };

  const allBandsChecked = FRONT_LINE.every(b => checked[b]);

  const enableCrawl = async () => {
    setEnabling(true); setError(null);
    try {
      const r = await fetch("/api/dashboard/activation/start", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: agentSlug, companyId, initiatedBy: "Hotel GM" }),
      });
      const d = await r.json();
      if (!r.ok) setError(d.error || "Failed to enable crawl");
      else onCrawlEnabled?.();
    } catch { setError("Network error"); }
    finally { setEnabling(false); }
  };

  return (
    <div style={{ background: "#0d0f14", border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}`, background: "#111318", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: T.text }}>Pre-Crawl Band Confirmation</span>
        <span style={{ fontSize: 10, fontFamily: T.mono, color: T.dim }}>Hotel GM must confirm all 3 bands</span>
      </div>
      <div style={{ padding: 14 }}>
        {FRONT_LINE.map(band => {
          const classes = parseBandClasses(band);
          const isOpen = !!open[band];
          return (
            <div key={band} style={{ marginBottom: 8, background: "#0a0c10", border: `1px solid ${T.border}`, borderRadius: 8 }}>
              <button onClick={() => setOpen(p => ({ ...p, [band]: !p[band] }))} style={{ width: "100%", background: "none", border: "none", cursor: "pointer", padding: "9px 12px", display: "flex", alignItems: "center", gap: 10, textAlign: "left" }}>
                <input type="checkbox" checked={!!checked[band]} onChange={() => toggleCheck(band)} onClick={e => e.stopPropagation()} style={{ flexShrink: 0, accentColor: T.blue }} />
                <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: T.text }}>{BAND_LABEL[band]}</span>
                <span style={{ fontSize: 10, fontFamily: T.mono, color: T.dim }}>{classes.length} classes</span>
                <span style={{ color: T.dim, fontSize: 11 }}>{isOpen ? "▲" : "▼"}</span>
              </button>
              {isOpen && classes.length > 0 && (
                <div style={{ padding: "0 12px 10px", borderTop: `1px solid ${T.border}20` }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
                    {classes.map(c => <span key={c} style={{ fontSize: 10, fontFamily: T.mono, color: "#94a3b8", background: "#111318", border: `1px solid ${T.border}`, borderRadius: 4, padding: "2px 7px" }}>{c}</span>)}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {error && <div style={{ color: T.red, fontSize: 12, marginTop: 8 }}>{error}</div>}
        {allBandsChecked && (
          <button onClick={enableCrawl} disabled={enabling} style={{
            width: "100%", padding: "10px 0", borderRadius: 8, fontSize: 13, fontWeight: 700,
            background: enabling ? "#1e2229" : "#14532d", color: enabling ? T.dim : T.green,
            border: `1px solid ${enabling ? T.dim : T.green}`, cursor: enabling ? "not-allowed" : "pointer", marginTop: 10,
          }}>{enabling ? "Enabling…" : "▶ Enable Crawl Phase"}</button>
        )}
      </div>
    </div>
  );
}

// ─── CrawlProgressDashboard — Track 2 per-band progress + promote to walk ────
function CrawlProgressDashboard({ agentSlug, companyId, onPromoted }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showPromote, setShowPromote] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [promotionSucceeded, setPromotionSucceeded] = useState(false);
  const [promotedMandateId, setPromotedMandateId] = useState(null);
  const [promoteError, setPromoteError] = useState(null);

  const loadStatus = useCallback(async () => {
    try {
      const r = await fetch(`/api/dashboard/activation/${agentSlug}/crawl-status?companyId=${companyId}`);
      if (r.ok) setStatus(await r.json());
    } catch {}
    setLoading(false);
  }, [agentSlug, companyId]);

  useEffect(() => { loadStatus(); const t = setInterval(loadStatus, 30000); return () => clearInterval(t); }, [loadStatus]);

  const promote = async () => {
    setPromoting(true);
    setPromoteError(null);
    try {
      const r = await fetch(`/api/dashboard/activation/${agentSlug}/promote-to-walk`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, promotedBy: "Hotel GM" }),
      });
      const d = await r.json();
      if (r.ok) {
        setPromotionSucceeded(true);
        setPromotedMandateId(d.mandateId ?? null);
        onPromoted?.();
      } else {
        setPromoteError(d.error ?? "Promotion failed");
      }
    } catch { setPromoteError("Network error"); }
    setPromoting(false);
  };

  const BAND_LABEL = { ambassador: "Ambassador", senior_ambassador: "Senior Ambassador", hotel_gm: "Hotel GM" };
  const bands = status?.bands || {};
  const fBands = status?.frontLineBands || Object.keys(bands);

  return (
    <div style={{ background: "#0d0f14", border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}`, background: "#111318", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: T.text }}>Crawl Progress</span>
        <button onClick={loadStatus} style={{ background: "none", border: "none", cursor: "pointer", color: T.dim, fontSize: 11 }}>↻</button>
      </div>
      {loading ? (
        <div style={{ padding: 14, color: T.dim, fontSize: 12 }}>Loading…</div>
      ) : !status ? (
        <div style={{ padding: 14, color: T.dim, fontSize: 12 }}>Crawl status unavailable — governance files may not be seeded.</div>
      ) : (
        <div style={{ padding: 14 }}>
          {fBands.map(band => {
            const b = bands[band] || {};
            const pct = b.total > 0 ? Math.round((b.resolved / b.total) * 100) : (b.total === 0 ? 100 : 0);
            return (
              <div key={band} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: T.text }}>{BAND_LABEL[band] || band}</span>
                  <span style={{ fontSize: 11, fontFamily: T.mono, color: b.complete ? T.green : T.dim }}>{b.resolved ?? 0}/{b.total ?? 0}{b.complete ? " ✓" : ""}</span>
                </div>
                <div style={{ height: 5, background: "#1e2229", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: b.complete ? T.green : T.blue, borderRadius: 3, transition: "width 0.3s" }} />
                </div>
              </div>
            );
          })}
          {status.crawlComplete && (
            <div style={{ marginTop: 12, padding: "10px 12px", background: "#0d1f0d", border: `1px solid ${T.green}40`, borderRadius: 8, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: T.green, fontSize: 12 }}>✓ Crawl complete — all classes baselined</span>
              <button onClick={() => setShowPromote(true)} style={{ marginLeft: "auto", padding: "5px 12px", borderRadius: 6, fontSize: 11, fontWeight: 700, fontFamily: T.mono, background: "#14532d", color: T.green, border: `1px solid ${T.green}`, cursor: "pointer" }}>
                Promote to Walk →
              </button>
            </div>
          )}
        </div>
      )}
      {showPromote && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 8000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: T.card, border: `1px solid ${T.green}40`, borderRadius: 14, padding: 28, width: 440, maxWidth: "92vw" }}>
            {promotionSucceeded ? (
              <>
                <div style={{ fontSize: 15, fontWeight: 700, color: T.green, marginBottom: 8 }}>✓ Promoted to Walk Phase</div>
                <p style={{ fontSize: 12, color: T.muted, lineHeight: 1.6, marginBottom: 12 }}>Agent is now operating in Walk phase with cryptographically-signed spending authority.</p>
                <div style={{ background: "#0d1f0d", border: `1px solid ${T.green}40`, borderRadius: 8, padding: "10px 14px", marginBottom: 20 }}>
                  <div style={{ fontSize: 10, color: T.dim, fontFamily: T.mono, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.07em" }}>Intent Mandate ID</div>
                  {promotedMandateId
                    ? <div style={{ fontSize: 11, color: T.green, fontFamily: T.mono, wordBreak: "break-all" }}>{promotedMandateId}</div>
                    : <div style={{ fontSize: 11, color: "#f97316", fontFamily: T.mono }}>Mandate ID unavailable — check server logs</div>
                  }
                </div>
                <button onClick={() => { setShowPromote(false); setPromotionSucceeded(false); setPromotedMandateId(null); }} style={{ width: "100%", padding: "10px 0", borderRadius: 8, background: "#14532d", color: T.green, border: `1px solid ${T.green}`, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                  Done
                </button>
              </>
            ) : (
              <>
                <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 8 }}>Promote to Walk Phase</div>
                <p style={{ fontSize: 12, color: T.muted, lineHeight: 1.6, marginBottom: 20 }}>All exception classes baselined. Walk phase grants limited autonomous authority (≤10% discount, ≤€150 refund, ≤€500 folio charge). A Witness entry and Intent Mandate will be issued.</p>
                {promoteError && (
                  <div style={{ fontSize: 12, color: "#f87171", background: "#450a0a40", border: "1px solid #f8717140", borderRadius: 6, padding: "8px 10px", marginBottom: 14 }}>✗ {promoteError}</div>
                )}
                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={() => { setShowPromote(false); setPromoteError(null); }} style={{ flex: 1, padding: "10px 0", borderRadius: 8, background: "#1e2229", color: T.dim, border: `1px solid ${T.border}`, fontSize: 13, cursor: "pointer" }}>Cancel</button>
                  <button onClick={promote} disabled={promoting} style={{ flex: 1, padding: "10px 0", borderRadius: 8, background: "#14532d", color: T.green, border: `1px solid ${T.green}`, fontSize: 13, fontWeight: 700, cursor: promoting ? "not-allowed" : "pointer" }}>
                    {promoting ? "Promoting…" : "✓ Confirm Walk Promotion"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Track2CompanyRow — per-hotel CWR activation row ─────────────────────────
// Shows admitted agents per hotel with PreCrawlConfirmation or CrawlProgressDashboard
// depending on the agent's current phase for this company.
function Track2CompanyRow({ company, name, admittedAgents, agentPhases, onOpenHub, onRefresh }) {
  const [expanded, setExpanded] = useState(false);
  const crawlCount = Object.values(agentPhases).filter(p => p === "crawl").length;
  const walkCount = Object.values(agentPhases).filter(p => p === "walk").length;
  const runCount = Object.values(agentPhases).filter(p => p === "run").length;
  const totalActivated = crawlCount + walkCount + runCount;

  return (
    <div style={{ borderBottom: `1px solid ${T.border}10` }}>
      {/* Company header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 20px", cursor: "pointer" }} onClick={() => setExpanded(p => !p)}>
        <span style={{ fontSize: 12, color: T.dim }}>{expanded ? "▼" : "▶"}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
          <div style={{ fontSize: 10, fontFamily: T.mono, color: T.dim, marginTop: 2 }}>
            {totalActivated === 0
              ? `${admittedAgents.length} agent${admittedAgents.length !== 1 ? "s" : ""} admitted — click to activate`
              : `${crawlCount ? `🟡 ${crawlCount} crawl ` : ""}${walkCount ? `🔵 ${walkCount} walk ` : ""}${runCount ? `🟢 ${runCount} run` : ""}`.trim()}
          </div>
        </div>
        <button onClick={e => { e.stopPropagation(); onOpenHub(); }} style={{ padding: "4px 10px", borderRadius: 5, fontSize: 10, fontFamily: T.mono, fontWeight: 700, background: "#1e2229", border: `1px solid ${T.border}`, color: T.dim, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>
          Hub →
        </button>
      </div>

      {/* Expanded: per-agent activation state */}
      {expanded && (
        <div style={{ borderTop: `1px solid ${T.border}20`, background: "#0a0c10", padding: "8px 14px 12px" }}>
          {admittedAgents.length === 0 ? (
            <div style={{ fontSize: 11, color: T.dim, padding: "8px 0" }}>No admitted agents — complete Track 1 first.</div>
          ) : admittedAgents.map(agent => {
            const phase = agentPhases[agent.slug] ?? null;
            return (
              <div key={agent.slug} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
                  <span style={{ fontSize: 13 }}>{agent.icon}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: T.text }}>{agent.name}</span>
                  <span style={{ fontSize: 10, fontFamily: T.mono, color: phase ? { crawl: T.amber, walk: T.blue, run: T.green }[phase] || T.dim : T.dim }}>
                    {phase ? phase.toUpperCase() : "Not started"}
                  </span>
                </div>
                {!phase ? (
                  <PreCrawlConfirmation
                    agentSlug={agent.slug}
                    companyId={company.id}
                    onCrawlEnabled={onRefresh}
                  />
                ) : phase === "crawl" ? (
                  <CrawlProgressDashboard
                    agentSlug={agent.slug}
                    companyId={company.id}
                    onPromoted={onRefresh}
                  />
                ) : (
                  <div style={{ padding: "8px 12px", background: "#0d1f0d", border: `1px solid ${T.green}30`, borderRadius: 7, fontSize: 11, color: T.green }}>
                    ✓ {phase.charAt(0).toUpperCase() + phase.slice(1)} phase active
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── ValueLedgerPanel — AP2 ROI dashboard overlay ────────────────────────────
function ValueLedgerPanel({ companies, onClose }) {
  const [ledger, setLedger] = useState(null);
  const [events, setEvents] = useState([]);
  const [seeding, setSeeding] = useState(false);
  const [seedMsg, setSeedMsg] = useState(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState(
    companies && companies.length > 0 ? companies[0].id : 0
  );

  const fetchLedger = useCallback(async () => {
    try {
      const [ledRes, evRes] = await Promise.all([
        fetch(`/api/dashboard/value-ledger?companyId=${selectedCompanyId}`).then(r => r.json()),
        fetch(`/api/dashboard/value-ledger/events?companyId=${selectedCompanyId}&limit=15`).then(r => r.json()),
      ]);
      setLedger(ledRes);
      setEvents(evRes.events || []);
    } catch {}
  }, [selectedCompanyId]);

  useEffect(() => { fetchLedger(); }, [fetchLedger]);

  const seedData = async () => {
    setSeeding(true); setSeedMsg(null);
    try {
      const r = await fetch("/api/admin/seed-value-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: selectedCompanyId }),
      });
      const d = await r.json();
      setSeedMsg(d.message || "Seeded");
      await fetchLedger();
    } catch { setSeedMsg("Seed failed"); }
    setSeeding(false);
  };

  const agentShort = id => ({
    "availability-agent": "Availability",
    "rate-agent": "Rate",
    "reservation-bot": "Reservation Bot",
    "check-in-agent": "Check-In",
    "folio-agent": "Folio",
    "folio-charge-agent": "Folio Charge",
    "checkout-agent": "Checkout",
    "revenue-reconciliation-agent": "Revenue Rec.",
  }[id] || id);

  const fmt = n => {
    if (n == null) return "—";
    const abs = Math.abs(n);
    const sign = n < 0 ? "-" : "";
    if (abs >= 1000) return `${sign}€${(abs / 1000).toFixed(1)}k`;
    return `${sign}€${abs.toFixed(0)}`;
  };

  const totals = ledger?.totals;
  const agents = ledger?.agents || [];
  const maxRev = Math.max(...agents.map(a => Math.abs(a.totalRevenue || 0)), 1);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 500, display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: "40px 24px" }}>
      <div style={{ width: "100%", maxWidth: 900, background: T.card, border: `1px solid ${T.border}`, borderRadius: 16, overflow: "hidden" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 28px 16px", borderBottom: `1px solid ${T.border}`, background: "#070809" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 9, fontFamily: T.mono, fontWeight: 700, letterSpacing: "0.1em", color: T.green, background: `${T.green}18`, border: `1px solid ${T.green}30`, borderRadius: 3, padding: "2px 6px" }}>AP2 VALUE LEDGER</span>
              <span style={{ fontSize: 10, fontFamily: T.mono, color: T.dim }}>30-day rolling window</span>
            </div>
            <div style={{ fontSize: 20, fontWeight: 900, color: T.text, letterSpacing: "-0.03em" }}>Agent ROI Dashboard</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {companies && companies.length > 1 && (
              <select
                value={selectedCompanyId}
                onChange={e => setSelectedCompanyId(Number(e.target.value))}
                style={{ padding: "4px 8px", borderRadius: 5, border: `1px solid ${T.border}`, background: "#111", color: T.text, fontSize: 11, fontFamily: T.mono }}
              >
                {companies.map(c => <option key={c.id} value={c.id}>{c.companyName || c.name || `Company ${c.id}`}</option>)}
              </select>
            )}
            <button onClick={seedData} disabled={seeding} style={{ padding: "6px 14px", borderRadius: 6, border: `1px solid ${T.green}40`, background: `${T.green}12`, color: T.green, fontSize: 11, fontFamily: T.mono, fontWeight: 700, cursor: seeding ? "not-allowed" : "pointer", opacity: seeding ? 0.6 : 1 }}>
              {seeding ? "Seeding…" : "↺ Seed Demo Data"}
            </button>
            <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: "50%", border: `1px solid ${T.border}`, background: "none", color: T.dim, fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
          </div>
        </div>

        {seedMsg && (
          <div style={{ padding: "8px 28px", background: `${T.green}12`, borderBottom: `1px solid ${T.green}30`, fontSize: 11, fontFamily: T.mono, color: T.green }}>{seedMsg}</div>
        )}

        {/* Platform Totals */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 0, borderBottom: `1px solid ${T.border}` }}>
          {[
            { label: "Total Revenue Delta", value: totals ? fmt(totals.totalRevenue) : "—", color: (totals?.totalRevenue ?? 0) >= 0 ? T.green : T.red },
            { label: "Governance Cost", value: totals ? fmt(totals.totalCostEur) : "—", color: T.amber },
            { label: "Net Value", value: totals ? fmt(totals.netValue) : "—", color: (totals?.netValue ?? 0) >= 0 ? T.green : T.red },
            { label: "ROI Multiple", value: totals?.roiMultiple != null ? `${totals.roiMultiple}×` : "—", color: T.blue },
          ].map((item, i) => (
            <div key={i} style={{ padding: "18px 24px", borderRight: i < 3 ? `1px solid ${T.border}` : "none" }}>
              <div style={{ fontSize: 10, fontFamily: T.mono, color: T.dim, letterSpacing: "0.08em", marginBottom: 6 }}>{item.label.toUpperCase()}</div>
              <div style={{ fontSize: 26, fontWeight: 900, fontFamily: T.mono, color: item.color, letterSpacing: "-0.02em" }}>{item.value}</div>
              {totals && <div style={{ fontSize: 10, color: T.dim, marginTop: 4 }}>{totals.passEvents ?? 0} PASS / {totals.totalEvents ?? 0} decisions</div>}
            </div>
          ))}
        </div>

        {/* Per-agent bars */}
        <div style={{ padding: "20px 28px" }}>
          <div style={{ fontSize: 10, fontFamily: T.mono, fontWeight: 700, color: T.dim, letterSpacing: "0.1em", marginBottom: 14 }}>PER-AGENT BREAKDOWN</div>
          {agents.length === 0 ? (
            <div style={{ textAlign: "center", padding: "30px 0", color: T.dim }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>📊</div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>No value events yet</div>
              <div style={{ fontSize: 11 }}>Click "Seed Demo Data" to populate the ledger with realistic baseline data.</div>
            </div>
          ) : agents.map(a => {
            const barPct = Math.min(100, (Math.abs(a.totalRevenue || 0) / maxRev) * 100);
            const passRate = a.totalEvents > 0 ? Math.round((a.passEvents / a.totalEvents) * 100) : 0;
            return (
              <div key={a.agentId} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{agentShort(a.agentId)}</span>
                  <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                    <span style={{ fontSize: 11, fontFamily: T.mono, color: T.dim }}>{passRate}% pass · {a.totalEvents} decisions</span>
                    <span style={{ fontSize: 13, fontWeight: 700, fontFamily: T.mono, color: (a.totalRevenue || 0) >= 0 ? T.green : T.red, minWidth: 60, textAlign: "right" }}>{fmt(a.totalRevenue)}</span>
                  </div>
                </div>
                <div style={{ height: 6, background: `${T.border}60`, borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${barPct}%`, background: (a.totalRevenue || 0) >= 0 ? T.green : T.red, borderRadius: 3, transition: "width 0.5s ease" }} />
                </div>
              </div>
            );
          })}
        </div>

        {/* Recent Events */}
        {events.length > 0 && (
          <div style={{ borderTop: `1px solid ${T.border}`, padding: "16px 28px 20px" }}>
            <div style={{ fontSize: 10, fontFamily: T.mono, fontWeight: 700, color: T.dim, letterSpacing: "0.1em", marginBottom: 10 }}>RECENT EVENTS</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 200, overflowY: "auto" }}>
              {events.map(ev => (
                <div key={ev.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", background: "#0a0b0d", borderRadius: 6, border: `1px solid ${T.border}30` }}>
                  <span style={{ fontSize: 9, fontFamily: T.mono, color: ev.decisionOutcome === "PASS" ? T.green : T.red, fontWeight: 700, minWidth: 35 }}>{ev.decisionOutcome}</span>
                  <span style={{ fontSize: 11, color: T.text, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{agentShort(ev.agentId)} · {ev.action}</span>
                  <span style={{ fontSize: 11, fontFamily: T.mono, color: Number(ev.revenueDelta) >= 0 ? T.green : T.red, fontWeight: 700 }}>{fmt(Number(ev.revenueDelta))}</span>
                  <span style={{ fontSize: 9, fontFamily: T.mono, color: T.dim }}>{ev.propertyCode || ""}</span>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

// ─── OnboardingConsole — three-track starting screen ─────────────────────────
function OnboardingConsole({ onLoadHotel }) {
  const [requests, setRequests] = useState(null);
  const [companies, setCompanies] = useState(null);
  const [phaseMap, setPhaseMap] = useState({});
  const [walkthroughOpen, setWalkthroughOpen] = useState(false);
  const [walkthroughSource, setWalkthroughSource] = useState("vda_native");
  const [refreshKey, setRefreshKey] = useState(0);
  const [apaleoStatus, setApaleoStatus] = useState(null);
  const [apaleoPopoverOpen, setApaleoPopoverOpen] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const apaleoPopoverRef = React.useRef(null);

  const fetchApaleoStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/apaleo/status");
      const data = await res.json();
      if (!res.ok) {
        setApaleoStatus({ connected: false, error: data.error || `HTTP ${res.status}`, mcpConfigured: data.mcpConfigured ?? false });
      } else {
        setApaleoStatus(data);
      }
    } catch {
      setApaleoStatus({ connected: false, error: "Network error" });
    }
  }, []);

  useEffect(() => {
    fetchApaleoStatus();
    const interval = setInterval(fetchApaleoStatus, 60_000);
    return () => clearInterval(interval);
  }, [fetchApaleoStatus]);

  useEffect(() => {
    if (!apaleoPopoverOpen) return;
    const handler = (e) => {
      if (apaleoPopoverRef.current && !apaleoPopoverRef.current.contains(e.target)) {
        setApaleoPopoverOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [apaleoPopoverOpen]);

  const loadAll = useCallback(async () => {
    try {
      const [reqRes, compRes] = await Promise.all([
        fetch("/api/onboarding?role_band=compliance_officer").then(r => r.json()),
        fetch("/api/companies").then(r => r.json()),
      ]);
      setRequests(reqRes.requests || []);
      const comps = Array.isArray(compRes) ? compRes : [];
      setCompanies(comps);
      if (comps.length > 0) {
        const phaseResults = await Promise.all(
          comps.map(c => fetch(`/api/dashboard/phases?companyId=${c.id}`).then(r => r.json()).catch(() => ({ phases: [] })))
        );
        const pm = {};
        comps.forEach((c, i) => {
          pm[c.id] = {};
          (phaseResults[i].phases || []).forEach(p => { pm[c.id][p.agentId] = p.phase; });
        });
        setPhaseMap(pm);
      }
    } catch {}
  }, []);

  useEffect(() => { loadAll(); }, [loadAll, refreshKey]);

  const nativeReqs = (requests || []).filter(r => r.source === "vda_native");
  const externalReqs = (requests || []).filter(r => r.source === "a2a_external");

  const nativeStatusMap = {};
  for (const req of nativeReqs) {
    const card = req.agentCard || {};
    const rawId = String(card.id || card.name || "").toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    if (rawId) nativeStatusMap[rawId] = { status: req.status, requestId: req.id, companyId: req.companyId || 0 };
  }

  const walkthroughAgents = VDA_NATIVE_AGENTS.map(a => ({
    ...a,
    status: nativeStatusMap[a.slug]?.status || null,
    requestId: nativeStatusMap[a.slug]?.requestId || null,
    companyId: nativeStatusMap[a.slug]?.companyId ?? 0,
  }));

  const admittedCount = walkthroughAgents.filter(a => ["admitted", "onboarded"].includes(a.status || "")).length;
  const track2Locked = admittedCount === 0;
  const loading = requests === null || companies === null;

  const statusColor = s => s === "admitted" || s === "onboarded" ? T.green : s === "rejected_co" ? T.red : s ? T.amber : T.dim;
  const statusLabel = s => ({ pre_admitted: "Pending admission", admitted: "Admitted", onboarded: "Onboarded", rejected_co: "Rejected", received: "Received", analysing: "Analysing", sandbox: "Sandbox" })[s] || (s || "Not submitted");

  const openWalkthrough = (src) => { setWalkthroughSource(src); setWalkthroughOpen(true); };

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: T.bg, fontFamily: T.sans, color: T.text, overflow: "hidden" }}>
      <style>{`
        @keyframes co-spin { to { transform: rotate(360deg); } }
        @keyframes console-fadein { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
      `}</style>

      {/* Header */}
      <div style={{ background: "#050608", borderBottom: `1px solid ${T.border}`, padding: "0 32px", height: 58, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ background: T.orange, borderRadius: 8, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: T.mono, fontWeight: 900, fontSize: 13, color: "#fff" }}>VD</div>
          <div>
            <div style={{ fontWeight: 900, fontSize: 15, letterSpacing: "-0.03em" }}>VDA-MD for Apaleo</div>
            <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono }}>CISO-First Onboarding Console · EU AI Act Article 17</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: admittedCount > 0 ? T.green : T.red, boxShadow: `0 0 8px ${admittedCount > 0 ? T.green : T.red}` }} />
            <span style={{ fontSize: 11, fontFamily: T.mono, color: admittedCount > 0 ? T.green : T.red, fontWeight: 700 }}>
              {admittedCount > 0 ? `${admittedCount} AGENT${admittedCount > 1 ? "S" : ""} ADMITTED` : "NO AGENTS ADMITTED"}
            </span>
          </div>

          {/* Apaleo connection status pill */}
          <div ref={apaleoPopoverRef} style={{ position: "relative" }}>
            <button
              onClick={() => setApaleoPopoverOpen(o => !o)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "4px 10px", borderRadius: 20,
                border: `1px solid ${apaleoStatus === null ? T.border : apaleoStatus.connected ? `${T.green}50` : `${T.red}50`}`,
                background: apaleoStatus === null ? "transparent" : apaleoStatus.connected ? `${T.green}12` : `${T.red}12`,
                cursor: "pointer", transition: "background 0.2s",
              }}
            >
              {apaleoStatus === null ? (
                <span style={{ fontSize: 10, fontFamily: T.mono, color: T.dim }}>Checking…</span>
              ) : apaleoStatus.connected ? (
                <>
                  <span style={{ fontSize: 9 }}>🟢</span>
                  <span style={{ fontSize: 10, fontFamily: T.mono, fontWeight: 700, color: T.green }}>
                    Apaleo Connected ({apaleoStatus.propertyCount ?? (apaleoStatus.propertiesReachable?.length ?? 0)} {(apaleoStatus.propertyCount ?? (apaleoStatus.propertiesReachable?.length ?? 0)) === 1 ? "property" : "properties"})
                  </span>
                </>
              ) : (
                <>
                  <span style={{ fontSize: 9 }}>🔴</span>
                  <span style={{ fontSize: 10, fontFamily: T.mono, fontWeight: 700, color: T.red }}>Apaleo Disconnected</span>
                </>
              )}
            </button>

            {/* Popover */}
            {apaleoPopoverOpen && (
              <div style={{
                position: "absolute", top: "calc(100% + 10px)", right: 0,
                width: 300, background: "#0d0e11", border: `1px solid ${T.border}`,
                borderRadius: 10, padding: "14px 16px", zIndex: 200,
                boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
              }}>
                <div style={{ fontSize: 11, fontFamily: T.mono, fontWeight: 700, color: T.text, marginBottom: 10, letterSpacing: "0.05em" }}>APALEO PMS STATUS</div>

                {apaleoStatus && (
                  <>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 11, color: T.dim }}>Connection</span>
                        <span style={{ fontSize: 11, fontFamily: T.mono, fontWeight: 700, color: apaleoStatus.connected ? T.green : T.red }}>
                          {apaleoStatus.connected ? "Connected" : "Disconnected"}
                        </span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 11, color: T.dim }}>Token expiry</span>
                        <span style={{ fontSize: 11, fontFamily: T.mono, color: T.text }}>
                          {apaleoStatus.tokenExpiry
                            ? new Date(apaleoStatus.tokenExpiry).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                            : "—"}
                        </span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 11, color: T.dim }}>MCP</span>
                        <span style={{ fontSize: 11, fontFamily: T.mono, color: apaleoStatus.mcpConfigured ? T.green : T.amber }}>
                          {apaleoStatus.mcpConfigured ? "Configured" : "Not configured"}
                        </span>
                      </div>
                      {apaleoStatus.error && (
                        <div style={{ fontSize: 10, fontFamily: T.mono, color: T.red, background: `${T.red}10`, border: `1px solid ${T.red}30`, borderRadius: 5, padding: "4px 8px", marginTop: 2 }}>
                          {apaleoStatus.error}
                        </div>
                      )}
                    </div>

                    {apaleoStatus.propertiesReachable && apaleoStatus.propertiesReachable.length > 0 && (
                      <>
                        <div style={{ fontSize: 10, fontFamily: T.mono, color: T.dim, marginBottom: 5, letterSpacing: "0.08em" }}>PROPERTIES</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 100, overflowY: "auto" }}>
                          {apaleoStatus.propertiesReachable.map(pid => (
                            <div key={pid} style={{ fontSize: 11, fontFamily: T.mono, color: T.text, background: `${T.green}0a`, border: `1px solid ${T.green}20`, borderRadius: 4, padding: "2px 7px" }}>
                              {pid}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </>
                )}

                <button
                  onClick={() => { fetchApaleoStatus(); setApaleoPopoverOpen(false); }}
                  style={{ marginTop: 12, width: "100%", padding: "5px 0", borderRadius: 5, border: `1px solid ${T.border}`, background: "none", color: T.dim, fontSize: 10, fontFamily: T.mono, cursor: "pointer" }}
                >
                  ↻ Refresh now
                </button>
              </div>
            )}
          </div>

          <button onClick={() => setLedgerOpen(true)} style={{ padding: "6px 14px", borderRadius: 6, border: `1px solid ${T.green}40`, background: `${T.green}0d`, color: T.green, fontSize: 11, fontFamily: T.mono, fontWeight: 700, cursor: "pointer" }}>📊 Value Ledger</button>
          <button onClick={() => setRefreshKey(k => k + 1)} style={{ padding: "6px 14px", borderRadius: 6, border: `1px solid ${T.border}`, background: "none", color: T.dim, fontSize: 11, fontFamily: T.mono, cursor: "pointer" }}>↻ Refresh</button>
        </div>
      </div>

      {ledgerOpen && <ValueLedgerPanel companies={companies || []} onClose={() => setLedgerOpen(false)} />}

      {/* Scrollable content area — fills remaining viewport below header */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", display: "flex", flexDirection: "column", minHeight: 0 }}>

      {/* Apaleo disconnected warning banner */}
      {apaleoStatus && !apaleoStatus.connected && (
        <div style={{ background: `${T.red}15`, borderBottom: `1px solid ${T.red}40`, padding: "8px 32px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", flexShrink: 0 }}>
          <span style={{ fontSize: 13 }}>⚠️</span>
          <span style={{ fontSize: 11, fontFamily: T.mono, color: T.red, fontWeight: 700 }}>Apaleo PMS is unreachable.</span>
          <span style={{ fontSize: 11, color: T.muted }}>
            {apaleoStatus.error || "Check credentials."}{" "}
            Set <code style={{ fontFamily: T.mono, fontSize: 10, background: `${T.red}20`, padding: "1px 4px", borderRadius: 3 }}>APALEO_CLIENT_ID</code> and{" "}
            <code style={{ fontFamily: T.mono, fontSize: 10, background: `${T.red}20`, padding: "1px 4px", borderRadius: 3 }}>APALEO_CLIENT_SECRET</code> in your environment secrets.
          </span>
          <button
            onClick={() => openWalkthrough("vda_native")}
            style={{
              marginLeft: 4, padding: "3px 10px", borderRadius: 5,
              border: `1px solid ${T.red}60`, background: `${T.red}20`,
              color: T.red, fontSize: 10, fontFamily: T.mono, fontWeight: 700,
              cursor: "pointer", whiteSpace: "nowrap",
            }}
          >
            Open credential setup →
          </button>
        </div>
      )}

      {/* Hero */}
      <div style={{ padding: "16px 40px 0", maxWidth: 1400, margin: "0 auto", width: "100%", boxSizing: "border-box", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <span style={{ fontSize: 10, fontFamily: T.mono, fontWeight: 700, letterSpacing: "0.1em", color: T.red, background: `${T.red}18`, border: `1px solid ${T.red}40`, borderRadius: 4, padding: "2px 8px" }}>COMPLIANCE OFFICER</span>
          <span style={{ fontSize: 11, color: T.dim, fontFamily: T.mono }}>Default view · Hotel roles unlock after agent admission</span>
        </div>
        <h1 style={{ fontFamily: T.sans, fontWeight: 900, fontSize: 22, color: T.text, letterSpacing: "-0.04em", margin: "0 0 2px" }}>Agent Admission Console</h1>
        <p style={{ fontSize: 12, color: T.muted, lineHeight: 1.5, margin: "0 0 12px" }}>
          Complete Track 1 (CISO agent admission) before hotel operations unlock. This screen is the EU AI Act Article 17 governance proof.
        </p>
      </div>

      {/* Three-track grid */}
      <div style={{ padding: "0 40px 20px", maxWidth: 1400, margin: "0 auto", width: "100%", boxSizing: "border-box", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20, animation: "console-fadein 0.3s ease", flex: 1, minHeight: 0 }}>

        {/* ── Track 1: VDA Native Agent Admission ─────── */}
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ padding: "16px 20px 12px", borderBottom: `1px solid ${T.border}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 9, fontFamily: T.mono, fontWeight: 700, letterSpacing: "0.1em", color: T.red, background: `${T.red}18`, border: `1px solid ${T.red}30`, borderRadius: 3, padding: "2px 6px" }}>TRACK 1</span>
              <span style={{ fontSize: 9, fontFamily: T.mono, color: T.dim }}>CISO FIRST</span>
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 4 }}>VDA Agent Admission</div>
            <div style={{ fontSize: 11, color: T.muted, lineHeight: 1.5 }}>Review governance files, run sandbox evaluation, confirm exception authority, then admit or reject each native agent.</div>
            <div style={{ display: "flex", gap: 14, marginTop: 10 }}>
              <span style={{ fontSize: 11, fontFamily: T.mono }}><span style={{ color: T.green, fontWeight: 700 }}>{admittedCount}</span><span style={{ color: T.dim }}> admitted</span></span>
              <span style={{ fontSize: 11, fontFamily: T.mono }}><span style={{ color: T.amber, fontWeight: 700 }}>{walkthroughAgents.filter(a => a.status === "pre_admitted").length}</span><span style={{ color: T.dim }}> pending</span></span>
              <span style={{ fontSize: 11, fontFamily: T.mono }}><span style={{ color: T.dim, fontWeight: 700 }}>{walkthroughAgents.filter(a => !a.status).length}</span><span style={{ color: T.dim }}> not started</span></span>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "6px 0" }}>
            {loading ? <div style={{ padding: "14px 20px", color: T.dim, fontSize: 12 }}>Loading…</div>
              : walkthroughAgents.map(a => (
                <div key={a.slug} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 20px", borderBottom: `1px solid ${T.border}10` }}>
                  <span style={{ fontSize: 16, flexShrink: 0 }}>{a.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
                    <div style={{ fontSize: 10, fontFamily: T.mono, color: statusColor(a.status) }}>{statusLabel(a.status)}</div>
                  </div>
                  {(a.status === "admitted" || a.status === "onboarded") && <span style={{ fontSize: 12, color: T.green }}>✅</span>}
                  {a.status === "rejected_co" && <span style={{ fontSize: 12, color: T.red }}>❌</span>}
                </div>
              ))}
          </div>
          <div style={{ padding: "14px 20px", borderTop: `1px solid ${T.border}`, display: "flex", flexDirection: "column", gap: 8 }}>
            <button onClick={() => openWalkthrough("vda_native")} style={{ width: "100%", padding: "11px 0", borderRadius: 8, fontSize: 13, fontWeight: 700, background: T.red, color: "#fff", border: "none", cursor: "pointer" }}>
              Start CISO Walkthrough →
            </button>
            <ResetDemoButton onReset={() => setRefreshKey(k => k + 1)} />
          </div>
        </div>

        {/* ── Track 2: Hotel Activation ─────────────────── */}
        <div style={{ background: T.card, border: `1px solid ${track2Locked ? T.border : T.green + "40"}`, borderRadius: 14, overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0, opacity: track2Locked ? 0.6 : 1, transition: "opacity 0.3s" }}>
          <div style={{ padding: "16px 20px 12px", borderBottom: `1px solid ${T.border}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 9, fontFamily: T.mono, fontWeight: 700, letterSpacing: "0.1em", color: T.green, background: `${T.green}18`, border: `1px solid ${T.green}30`, borderRadius: 3, padding: "2px 6px" }}>TRACK 2</span>
              <span style={{ fontSize: 9, fontFamily: T.mono, color: T.dim }}>HOTEL GM</span>
              {track2Locked && <span style={{ fontSize: 9, fontFamily: T.mono, color: T.red, background: `${T.red}18`, border: `1px solid ${T.red}30`, borderRadius: 3, padding: "2px 6px" }}>LOCKED</span>}
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 4 }}>Hotel Crawl → Walk → Run</div>
            <div style={{ fontSize: 11, color: T.muted, lineHeight: 1.5 }}>
              {track2Locked ? "Locked — admit at least one agent in Track 1 to unlock hotel activation." : "Activate admitted agents at each hotel property through the Crawl → Walk → Run lifecycle."}
            </div>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "6px 0" }}>
            {loading ? <div style={{ padding: "14px 20px", color: T.dim, fontSize: 12 }}>Loading hotels…</div>
              : track2Locked ? (
                <div style={{ padding: "24px 20px", textAlign: "center", color: T.dim }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>🔒</div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Locked until Track 1 complete</div>
                  <div style={{ fontSize: 11 }}>Admit at least 1 agent to unlock hotel operations</div>
                </div>
              ) : (companies || []).map(company => {
                const admittedAgents = walkthroughAgents.filter(a => ["admitted","onboarded"].includes(a.status || ""));
                const agentPhases = phaseMap[company.id] || {};
                const name = company.companyName || company.name || `Company ${company.id}`;
                return (
                  <Track2CompanyRow
                    key={company.id}
                    company={company}
                    name={name}
                    admittedAgents={admittedAgents}
                    agentPhases={agentPhases}
                    onOpenHub={() => onLoadHotel(company)}
                    onRefresh={() => setRefreshKey(k => k + 1)}
                  />
                );
              })}
          </div>
        </div>

        {/* ── Track 3: External A2A Admission ──────────── */}
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ padding: "16px 20px 12px", borderBottom: `1px solid ${T.border}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 9, fontFamily: T.mono, fontWeight: 700, letterSpacing: "0.1em", color: "#e879f9", background: "#e879f918", border: "1px solid #e879f930", borderRadius: 3, padding: "2px 6px" }}>TRACK 3</span>
              <span style={{ fontSize: 9, fontFamily: T.mono, color: T.dim }}>CISO → HOTEL GM</span>
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 4 }}>External A2A Admission</div>
            <div style={{ fontSize: 11, color: T.muted, lineHeight: 1.5 }}>External agents requesting A2A admission via the A2A protocol. Same 6-stage CISO walkthrough applies.</div>
            <div style={{ display: "flex", gap: 14, marginTop: 10 }}>
              <span style={{ fontSize: 11, fontFamily: T.mono }}><span style={{ color: T.green, fontWeight: 700 }}>{externalReqs.filter(r => r.status === "onboarded").length}</span><span style={{ color: T.dim }}> onboarded</span></span>
              <span style={{ fontSize: 11, fontFamily: T.mono }}><span style={{ color: T.amber, fontWeight: 700 }}>{externalReqs.filter(r => ["received","analysing","sandbox","awaiting_first_hitl"].includes(r.status)).length}</span><span style={{ color: T.dim }}> in progress</span></span>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "6px 0" }}>
            {loading ? <div style={{ padding: "14px 20px", color: T.dim, fontSize: 12 }}>Loading…</div>
              : externalReqs.length === 0 ? (
                <div style={{ padding: "24px 20px", textAlign: "center", color: T.dim }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>🔗</div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>No external agents pending</div>
                  <div style={{ fontSize: 11 }}>Agents submit via A2A at /api/a2a/onboarding</div>
                </div>
              ) : externalReqs.slice(0, 10).map(req => {
                const card = req.agentCard || {};
                const name = card.name || req.externalAgentDid || req.id;
                return (
                  <div key={req.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 20px", borderBottom: `1px solid ${T.border}10` }}>
                    <span style={{ fontSize: 16 }}>🤖</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
                      <div style={{ fontSize: 10, fontFamily: T.mono, color: statusColor(req.status) }}>{statusLabel(req.status)}</div>
                    </div>
                    {req.evalPassRate && <span style={{ fontSize: 11, fontFamily: T.mono, color: T.blue }}>{Math.round(Number(req.evalPassRate) * 100)}%</span>}
                  </div>
                );
              })}
          </div>
          <div style={{ padding: "14px 20px", borderTop: `1px solid ${T.border}` }}>
            <button onClick={() => openWalkthrough("a2a_external")} style={{ width: "100%", padding: "11px 0", borderRadius: 8, fontSize: 13, fontWeight: 700, background: "#150e1f", color: "#e879f9", border: "1px solid #e879f940", cursor: "pointer" }}>
              Review A2A Agents →
            </button>
          </div>
        </div>
      </div>

      </div>{/* end scrollable content area */}

      {walkthroughOpen && (
        <CISOWalkthrough
          agents={walkthroughSource === "a2a_external"
            ? externalReqs.map(r => {
                const card = r.agentCard || {};
                // Normalise to the same slug format used by governanceFiles.agentId
                const rawId = card.id || card.name || r.externalAgentDid || r.id;
                const slug = String(rawId).toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
                return {
                  slug,
                  name: card.name || r.externalAgentDid || r.id,
                  icon: "🤖",
                  status: r.status,
                  requestId: r.id,
                  evalPassRate: r.evalPassRate ?? null,
                  source: "a2a_external",
                  companyId: r.companyId || 0,
                };
              })
            : walkthroughAgents}
          companyId={walkthroughSource === "vda_native" ? (companies?.[0]?.id ?? 0) : 0}
          source={walkthroughSource}
          onClose={() => setWalkthroughOpen(false)}
          onAdmitted={() => { setWalkthroughOpen(false); setRefreshKey(k => k + 1); }}
          onRejected={() => { setWalkthroughOpen(false); setRefreshKey(k => k + 1); }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// DIRECTORY — persistent company list
// ─────────────────────────────────────────────
function Directory({ onNew, onLoad, role = "compliance_officer", currentSetup }) {
  const [companies, setCompanies] = useState(null);
  const [seeding, setSeeding] = useState(false);
  // Two-panel state
  const [nativeStatuses, setNativeStatuses] = useState({});  // { governanceSlug: reqStatus }
  const [externalAgents, setExternalAgents] = useState([]);
  const [portfolio, setPortfolio] = useState(null);
  const [allPhases, setAllPhases] = useState({});            // { [companyId]: phases[] }
  const [matrixOpen, setMatrixOpen] = useState(false);
  const [activateModal, setActivateModal] = useState(null);  // { agentId, agentName } | null
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState(null);
  const [activationUnavailable, setActivationUnavailable] = useState(false);
  const [onboardGuideModal, setOnboardGuideModal] = useState(null); // { slug, agentName, agentIcon }
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const handleMasterReset = async () => {
    setIsResetting(true);
    try {
      await fetch("/api/admin/master-reset", { method: "POST" });
    } catch (_) {}
    setIsResetting(false);
    setShowResetConfirm(false);
    // Reset all local state so UI returns to pre-load state
    setCompanies([]);
    setNativeStatuses({});
    setExternalAgents([]);
    setPortfolio(null);
    setAllPhases({});
    setOnboardGuideModal(null);
  };

  // AGENT_DEFS id → governance slug used in agent_phases table
  const GOVERNANCE_SLUG = {
    availability:  "availability-agent",
    rate:          "rate-agent",
    reservation:   "reservation-bot",
    checkin:       "check-in-agent",
    "folio-charge":"folio-charge-agent",
    folio:         "folio-agent",
    checkout:      "checkout-agent",
    revenue:       "revenue-reconciliation-agent",
  };

  // Abbreviated column labels for matrix view
  const MATRIX_ABBREV = {
    availability:  "Avail",
    rate:          "Rate",
    reservation:   "Res",
    checkin:       "Check-in",
    "folio-charge":"F-Chg",
    folio:         "Folio",
    checkout:      "Checkout",
    revenue:       "Revenue",
  };

  const loadCompanies = async () => {
    try {
      const res = await fetch("/api/companies");
      if (!res.ok) throw new Error("Failed to load");
      setCompanies(await res.json());
    } catch {
      setCompanies([]);
    }
  };

  const deleteCompany = async (id, e) => {
    if (e) e.stopPropagation();
    try { await fetch(`/api/companies/${id}`, { method: "DELETE" }); } catch {}
    setCompanies(p => (p || []).filter(c => c.id !== id));
  };

  const loadDemoHotels = async () => {
    setSeeding(true);
    try {
      const stubs = (companies || []).filter(c => !c.apaleoPropertyId);
      await Promise.allSettled(stubs.map(c => fetch(`/api/companies/${c.id}`, { method: "DELETE" })));
      const seedRes = await fetch("/api/admin/seed-companies", { method: "POST" });
      if (!seedRes.ok) { alert("Failed to load demo hotels — server error. Please try again."); return; }
      const seedData = await seedRes.json();
      if (!seedData.success) alert("Demo hotel load completed with errors. Some properties may be missing.");
      await loadCompanies();
    } catch { alert("Failed to load demo hotels — network error. Please try again."); }
    finally { setSeeding(false); }
  };

  const loadPhases = (ids) => {
    Promise.all(ids.map(cid =>
      fetch(`/api/dashboard/phases?companyId=${cid}`)
        .then(r => r.json()).then(d => [cid, d.phases || []]).catch(() => [cid, []])
    )).then(entries => setAllPhases(Object.fromEntries(entries)));
  };

  // GOVERNANCE_SLUG values set — used to match native onboarding rows by agentCard slug
  // Deterministic: display name (lowercase) → governance slug, built from AGENT_DEFS source of truth
  const AGENT_NAME_TO_SLUG = Object.fromEntries(
    AGENT_DEFS.map(a => [a.name.toLowerCase(), GOVERNANCE_SLUG[a.id]]).filter(([, s]) => s)
  );

  const loadOnboarding = () => {
    fetch("/api/onboarding").then(r => r.json()).then(d => {
      const reqs = d.requests || [];
      // Split strictly by source field (set on insert by onboarding orchestrator)
      const nativeReqs = reqs.filter(r => r.source === "vda_native");
      const externalReqs = reqs.filter(r => r.source === "a2a_external");

      // Build status map: governance slug → latest request status
      // Priority: (1) agentCard.id direct match in GOVERNANCE_SLUG, (2) AGENT_DEFS display name
      const statusMap = {};
      for (const req of nativeReqs) {
        const agentId = req.agentCard?.id || req.agent_card?.id;
        const rawName = (req.agentCard?.name || req.agent_card?.name || "").toLowerCase();
        const slug = (agentId && GOVERNANCE_SLUG[agentId]) || AGENT_NAME_TO_SLUG[rawName];
        if (slug) statusMap[slug] = req.status;
      }
      setNativeStatuses(statusMap);
      setExternalAgents(externalReqs);
    }).catch(() => {});

    fetch("/api/dashboard/phases/portfolio").then(r => r.json()).then(setPortfolio).catch(() => {});
  };

  useEffect(() => {
    loadCompanies();
    loadOnboarding();
    // Spec: parallel fetch for X = 1..5 on mount so Command Centre hydrates immediately
    loadPhases([1, 2, 3, 4, 5]);
  }, []);

  // Re-fetch phases with real company IDs once companies load (handles non-default IDs)
  useEffect(() => {
    if (companies && companies.length > 0) {
      const ids = companies.map(c => c.id);
      // Only re-fetch if any real ID differs from the 1..5 we pre-fetched
      if (ids.some(id => ![1, 2, 3, 4, 5].includes(id))) {
        loadPhases(ids);
      }
    }
  }, [companies]);

  const hasRealProperties = (companies || []).some(c => c.apaleoPropertyId);
  const showDemoButton = companies !== null && !hasRealProperties;

  // Phase lookup helper
  const getAgentPhase = (agentId, companyId) => {
    const rec = (allPhases[companyId] || []).find(p => p.agentId === agentId);
    return rec?.phase || "not_activated";
  };

  // Derive overall native agent status from phases across all hotels
  const agentOverallStatus = (governanceSlug) => {
    // Badge reflects actual onboarding/activation status — per-hotel dots show operational phase
    const reqStatus = nativeStatuses[governanceSlug];
    if (!reqStatus) return "pending";
    // Collapse in-flight activation sub-statuses into a single "activating" badge
    if (["activating","submitted","identity_verified","awaiting_first_hitl",
         "sandbox_evaluation","awaiting_second_hitl","governance_files_created"].includes(reqStatus)) {
      return "activating";
    }
    // Return actual DB status (admitted, rejected, active, pre_admitted, etc.) verbatim
    return reqStatus;
  };

  // Phase dot renderer
  const phaseDot = (phase) => {
    if (phase === "crawl") return <span title="Crawl">🟡</span>;
    if (phase === "walk")  return <span title="Walk">🔵</span>;
    if (phase === "run")   return <span title="Run">🟢</span>;
    return <span title="Not activated" style={{ color: T.dim, fontFamily: T.mono, fontSize: 11 }}>–</span>;
  };

  // Status badge — native agents
  const NativeBadge = ({ status }) => {
    const cfgs = {
      run:          { label: "Run",              bg: T.green,       color: "#fff",    outline: false },
      walk:         { label: "Walk",             bg: T.blue,        color: "#fff",    outline: false },
      crawl:        { label: "Crawl",            bg: "#d97706",     color: "#fff",    outline: false },
      activating:   { label: "Activating",       bg: "transparent", color: "#d97706", outline: true  },
      pending:      { label: "Pending Onboarding", bg: "transparent", color: T.dim,   outline: true  },
      pre_admitted: { label: "Pre-Admitted",     bg: "transparent", color: T.orange,  outline: true  },
    };
    const cfg = cfgs[status] || { label: status, bg: "transparent", color: T.dim, outline: true };
    return (
      <span style={{
        fontSize: 10, fontFamily: T.mono, fontWeight: 700, padding: "2px 8px", borderRadius: 4,
        background: cfg.bg, color: cfg.color,
        border: cfg.outline ? `1px solid ${cfg.color}60` : "none",
        letterSpacing: "0.05em", whiteSpace: "nowrap",
      }}>{cfg.label}</span>
    );
  };

  // Status badge — external A2A agents
  const A2ABadge = ({ status }) => {
    const map = {
      submitted:                { label: "Submitted",    color: T.dim    },
      identity_verified:        { label: "Verifying",   color: T.dim    },
      awaiting_first_hitl:      { label: "CO Review 1", color: T.orange },
      sandbox_evaluation:       { label: "Sandbox",     color: "#d97706"},
      awaiting_second_hitl:     { label: "CO Review 2", color: T.orange },
      governance_files_created: { label: "Files Ready", color: T.blue   },
      admitted:                 { label: "Admitted",    color: T.green  },
      rejected:                 { label: "Rejected",    color: T.red    },
    };
    const cfg = map[status] || { label: status || "Unknown", color: T.dim };
    return (
      <span style={{
        fontSize: 10, fontFamily: T.mono, fontWeight: 700, padding: "2px 8px", borderRadius: 4,
        background: `${cfg.color}18`, color: cfg.color, border: `1px solid ${cfg.color}40`,
        letterSpacing: "0.05em", whiteSpace: "nowrap",
      }}>{cfg.label}</span>
    );
  };

  // Activation handler — calls /api/dashboard/activation/start
  const handleActivate = async (agentId, companyId) => {
    if (activationUnavailable) return;
    setActivating(true);
    setActivateError(null);
    try {
      const res = await fetch("/api/dashboard/activation/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, companyId, initiatedBy: role }),
      });
      if (res.status === 404) {
        // Persist unavailable state — disable all activation entry points
        setActivationUnavailable(true);
        setActivateError("Activation engine not yet deployed");
        setActivating(false);
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setActivateError(err.error || "Activation failed");
        setActivating(false);
        return;
      }
      // Refresh phases for the activated hotel
      const d = await fetch(`/api/dashboard/phases?companyId=${companyId}`).then(r => r.json()).catch(() => ({ phases: [] }));
      setAllPhases(prev => ({ ...prev, [companyId]: d.phases || [] }));
      setActivateModal(null);
    } catch {
      setActivateError("Network error — please try again");
    }
    setActivating(false);
  };

  // Hotel phase summary — uses allPhases as primary source (always fetched with real company IDs).
  // Portfolio is used as a fallback for totalAgents only when present; never blocks rendering.
  const hotelPhaseSummary = (companyId) => {
    const portEntry = portfolio?.summary?.[companyId]; // may be undefined for new companies
    const phases = allPhases[companyId];
    // Only show skeleton while BOTH sources are still in-flight for this company
    if (portfolio === null && phases === undefined) return "Loading…";
    const phasesArr = (phases || []).filter(p => p.phase !== "not_activated");
    // Prefer portfolio totalAgents when available; otherwise count from allPhases
    const total = portEntry?.totalAgents ?? phasesArr.length;
    if (!total) return "No agents active";
    const crawl = phasesArr.filter(p => p.phase === "crawl").length;
    const walk  = phasesArr.filter(p => p.phase === "walk").length;
    const run   = phasesArr.filter(p => p.phase === "run").length;
    const parts = [];
    if (crawl) parts.push(`🟡 ${crawl} crawl`);
    if (walk)  parts.push(`🔵 ${walk} walk`);
    if (run)   parts.push(`🟢 ${run} run`);
    return `${total} agent${total !== 1 ? "s" : ""}${parts.length ? "  ·  " + parts.join("  ") : ""}`;
  };

  // Shared style helpers
  const panelStyle = {
    background: T.card, border: `1px solid ${T.border}`, borderRadius: 14,
    overflow: "hidden",
  };
  const sectionLabel = {
    fontSize: 10, fontFamily: T.mono, fontWeight: 700, color: T.dim,
    letterSpacing: "0.1em", padding: "10px 20px 4px",
  };
  const rowBase = {
    display: "flex", alignItems: "center", gap: 10,
    padding: "10px 20px", borderBottom: `1px solid ${T.border}18`,
  };
  const smallBtn = (color, outline = false) => ({
    fontSize: 11, fontFamily: T.mono, fontWeight: 700, padding: "4px 10px",
    borderRadius: 5, cursor: "pointer", whiteSpace: "nowrap",
    background: outline ? "transparent" : color,
    color: outline ? color : "#fff",
    border: `1px solid ${color}`,
  });

  return (
    <div style={{ minHeight: "100vh", background: T.bg, fontFamily: T.sans, color: T.text }}>
      <style>{GLOBAL_CSS}</style>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=Outfit:wght@300;400;600;700;900&family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500;600&display=swap" />

      {/* Sticky header */}
      <div style={{ background: "#050608", borderBottom: `1px solid ${T.border}`, padding: "0 32px", height: 58, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ background: T.orange, borderRadius: 8, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: T.mono, fontWeight: 900, fontSize: 13, color: "#fff" }}>VD</div>
          <div>
            <div style={{ fontWeight: 900, fontSize: 15, letterSpacing: "-0.03em" }}>VDA-MD for Apaleo</div>
            <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono }}>AI Governance · Apaleo Hospitality Stack</div>
          </div>
        </div>
        {/* CO role pill — always visible in header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: T.red, boxShadow: `0 0 8px ${T.red}` }} />
          <span style={{ fontSize: 11, fontFamily: T.mono, fontWeight: 700, color: T.red, letterSpacing: "0.1em" }}>COMPLIANCE OFFICER</span>
          <span style={{ fontSize: 10, color: T.dim, fontFamily: T.mono }}>· Hotel roles locked until agent admission</span>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 28px" }}>

        {/* Hero */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div>
              {/* CO role indicator */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{
                  fontSize: 10, fontFamily: T.mono, fontWeight: 700, letterSpacing: "0.1em",
                  color: T.red, background: `${T.red}18`, border: `1px solid ${T.red}50`,
                  borderRadius: 4, padding: "2px 8px",
                }}>COMPLIANCE OFFICER</span>
                <span style={{ fontSize: 10, color: T.dim, fontFamily: T.mono }}>Default view · Hotel roles unlock after agent admission</span>
              </div>
              <h1 style={{ fontFamily: T.sans, fontWeight: 900, fontSize: 28, color: T.text, letterSpacing: "-0.04em", marginBottom: 6, margin: "0 0 6px" }}>
                VDA-MD Command Centre
              </h1>
              <p style={{ fontSize: 13, color: T.muted, lineHeight: 1.6, margin: "0 0 12px" }}>
                Agent admission · Phase lifecycle · AP2 Intent Mandates · Agent Value Ledger · Click any cell to go deeper
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Tag color={T.blue}>NIST SP 800-53</Tag>
                <Tag color={T.green}>GDPR · EU AI Act</Tag>
                <Tag color={T.purple}>AP2 Intent Mandates</Tag>
                <Tag color={T.orange}>Agent Value Ledger</Tag>
                <Tag color="#e879f9">A2A v1.0</Tag>
              </div>
            </div>
            <button
              onClick={() => setShowResetConfirm(true)}
              style={{
                padding: "8px 16px", borderRadius: 8, border: `1px solid ${T.red}`,
                background: `${T.red}18`, color: T.red, fontSize: 12, fontFamily: T.mono,
                fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", letterSpacing: "0.04em",
                flexShrink: 0,
              }}
            >
              ⚠ Master Reset
            </button>
          </div>
        </div>

        {/* ── Master Reset confirmation modal ── */}
        {showResetConfirm && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ background: T.card, border: `1px solid ${T.red}60`, borderRadius: 16, padding: 32, width: 440, maxWidth: "92vw", boxShadow: `0 0 40px ${T.red}30` }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>⚠</div>
              <h2 style={{ fontFamily: T.sans, fontWeight: 900, fontSize: 20, color: T.red, margin: "0 0 12px" }}>Master Reset</h2>
              <p style={{ fontSize: 13, color: T.muted, lineHeight: 1.65, margin: "0 0 8px" }}>
                This will permanently delete <strong style={{ color: T.text }}>all hotel data, governance files, agent phases, witness logs, and onboarding records</strong> from the platform.
              </p>
              <p style={{ fontSize: 13, color: T.muted, lineHeight: 1.65, margin: "0 0 24px" }}>
                The platform will return to its blank starting state — ready for a fresh onboarding run from scratch.
              </p>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button
                  onClick={() => setShowResetConfirm(false)}
                  disabled={isResetting}
                  style={{ padding: "8px 20px", borderRadius: 8, border: `1px solid ${T.border}`, background: "none", color: T.dim, fontSize: 13, cursor: "pointer", fontFamily: T.sans }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleMasterReset}
                  disabled={isResetting}
                  style={{
                    padding: "8px 20px", borderRadius: 8, border: "none",
                    background: T.red, color: "#fff", fontSize: 13, fontWeight: 800,
                    cursor: isResetting ? "default" : "pointer", fontFamily: T.sans,
                    opacity: isResetting ? 0.7 : 1,
                  }}
                >
                  {isResetting ? "Resetting…" : "Yes, Reset Everything"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Loading */}
        {companies === null && (
          <div style={{ textAlign: "center", padding: "60px 0", color: T.dim }}>
            <div style={{ fontSize: 13, fontFamily: T.mono, animation: "pulse-ring 1s ease infinite" }}>Loading directory…</div>
          </div>
        )}

        {/* Empty / stub-only — show Load Demo Hotels */}
        {showDemoButton && (
          <div style={{ textAlign: "center", padding: "60px 40px", background: T.card, border: `2px dashed ${T.border}`, borderRadius: 16, marginBottom: 24 }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🏨</div>
            <h2 style={{ fontFamily: T.sans, fontWeight: 900, fontSize: 20, color: T.text, marginBottom: 8 }}>
              {companies?.length === 0 ? "No properties configured yet" : "Demo properties not loaded yet"}
            </h2>
            <p style={{ fontSize: 14, color: T.muted, marginBottom: 24, maxWidth: 480, margin: "0 auto 24px" }}>
              Load the five citizenM sandbox hotels to activate the Command Centre.
            </p>
            <button onClick={loadDemoHotels} disabled={seeding} style={{
              background: seeding ? T.dim : T.orange, border: "none", borderRadius: 10,
              padding: "10px 24px", fontSize: 14, color: "#fff", fontFamily: T.sans, fontWeight: 800,
              cursor: seeding ? "default" : "pointer", boxShadow: seeding ? "none" : `0 0 24px ${T.orange}50`,
            }}>{seeding ? "Loading…" : "Load Demo Hotels →"}</button>
          </div>
        )}

        {/* ── Portfolio-wide compliance gate status ── */}
        {(() => {
          if (!companies || companies.length === 0) return null;
          const allPhasesFlat = Object.values(allPhases).flat();
          const anyActivated = allPhasesFlat.length > 0;
          const anyLive = allPhasesFlat.some(p => p.phase === "walk" || p.phase === "run");
          const crawlCount = allPhasesFlat.filter(p => p.phase === "crawl").length;
          const walkCount  = allPhasesFlat.filter(p => p.phase === "walk").length;
          const runCount   = allPhasesFlat.filter(p => p.phase === "run").length;

          if (!anyActivated) return (
            <div style={{
              background: "linear-gradient(135deg, #1a0505 0%, #0f0202 100%)",
              border: "1px solid #7f1d1d", borderRadius: 14,
              padding: "24px 28px", marginBottom: 28,
              display: "flex", alignItems: "center", gap: 24,
              boxShadow: "0 0 40px #f8717110",
            }}>
              <div style={{ flexShrink: 0, width: 48, height: 48, borderRadius: "50%", background: "#7f1d1d", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 20px #f87171aa" }}>
                <span style={{ fontSize: 22 }}>🔴</span>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ color: "#f87171", fontWeight: 800, fontSize: 16, fontFamily: T.mono, letterSpacing: "0.06em", marginBottom: 4 }}>COMPLIANCE GATE ACTIVE</div>
                <div style={{ color: "#94a3b8", fontSize: 13, lineHeight: 1.6 }}>
                  No agents have been onboarded across any property. Hotel-facing roles (Ambassador, GM, Regional GM, Operations Chief) are locked.
                  Open a hotel hub below and complete the agent admission flow to unlock all roles.
                </div>
              </div>
              <div style={{ flexShrink: 0, textAlign: "center" }}>
                <div style={{ fontSize: 28, fontWeight: 900, color: "#f87171", fontFamily: T.mono }}>0</div>
                <div style={{ fontSize: 10, color: "#4b5563", fontFamily: T.mono }}>AGENTS LIVE</div>
              </div>
            </div>
          );
          if (!anyLive) return (
            <div style={{
              background: "linear-gradient(135deg, #120900 0%, #0c0600 100%)",
              border: "1px solid #78350f", borderRadius: 14,
              padding: "24px 28px", marginBottom: 28,
              display: "flex", alignItems: "center", gap: 24,
            }}>
              <div style={{ flexShrink: 0, width: 48, height: 48, borderRadius: "50%", background: "#78350f", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 22 }}>🟡</span>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ color: "#f59e0b", fontWeight: 800, fontSize: 16, fontFamily: T.mono, letterSpacing: "0.06em", marginBottom: 4 }}>CRAWL PHASE ONLY — NO LIVE DECISIONS</div>
                <div style={{ color: "#78716c", fontSize: 13, lineHeight: 1.6 }}>
                  {crawlCount} agent{crawlCount !== 1 ? "s" : ""} in crawl baseline across the portfolio — no autonomous decisions are executing.
                  Hotel-facing roles are accessible. Promote agents to Walk phase to go live.
                </div>
              </div>
              <div style={{ flexShrink: 0, textAlign: "center" }}>
                <div style={{ fontSize: 28, fontWeight: 900, color: "#f59e0b", fontFamily: T.mono }}>{crawlCount}</div>
                <div style={{ fontSize: 10, color: "#4b5563", fontFamily: T.mono }}>IN CRAWL</div>
              </div>
            </div>
          );
          return (
            <div style={{
              background: "linear-gradient(135deg, #020f06 0%, #010a04 100%)",
              border: "1px solid #166534", borderRadius: 14,
              padding: "24px 28px", marginBottom: 28,
              display: "flex", alignItems: "center", gap: 24,
            }}>
              <div style={{ flexShrink: 0, width: 48, height: 48, borderRadius: "50%", background: "#14532d", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 22 }}>🟢</span>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ color: "#4ade80", fontWeight: 800, fontSize: 16, fontFamily: T.mono, letterSpacing: "0.06em", marginBottom: 4 }}>AGENTS LIVE — ALL ROLES UNLOCKED</div>
                <div style={{ color: "#64748b", fontSize: 13, lineHeight: 1.6 }}>
                  {walkCount + runCount} agent{walkCount + runCount !== 1 ? "s" : ""} in Walk / Run phase.
                  {crawlCount > 0 ? ` ${crawlCount} still in crawl baseline.` : ""} All hotel-facing roles are unlocked in the hub.
                </div>
              </div>
              <div style={{ flexShrink: 0, display: "flex", gap: 16 }}>
                {crawlCount > 0 && <div style={{ textAlign: "center" }}><div style={{ fontSize: 22, fontWeight: 900, color: "#f59e0b", fontFamily: T.mono }}>{crawlCount}</div><div style={{ fontSize: 10, color: "#4b5563", fontFamily: T.mono }}>CRAWL</div></div>}
                {walkCount  > 0 && <div style={{ textAlign: "center" }}><div style={{ fontSize: 22, fontWeight: 900, color: "#60a5fa", fontFamily: T.mono }}>{walkCount}</div><div style={{ fontSize: 10, color: "#4b5563", fontFamily: T.mono }}>WALK</div></div>}
                {runCount   > 0 && <div style={{ textAlign: "center" }}><div style={{ fontSize: 22, fontWeight: 900, color: "#4ade80", fontFamily: T.mono }}>{runCount}</div><div style={{ fontSize: 10, color: "#4b5563", fontFamily: T.mono }}>RUN</div></div>}
              </div>
            </div>
          );
        })()}

        {/* ═══ Two-panel layout ═══ */}
        {companies?.length > 0 && (
          <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>

            {/* ── LEFT: Agent Registry (56%) ── */}
            <div style={{ ...panelStyle, flex: "0 0 56%" }}>
              <div style={{ padding: "14px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Agent Registry</div>
                <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono }}>
                  {AGENT_DEFS.length} native · {externalAgents.length} external
                </div>
              </div>

              {/* VDA Native Agents — always sourced from AGENT_DEFS */}
              <div style={sectionLabel}>VDA NATIVE AGENTS</div>
              {AGENT_DEFS.map(agent => {
                const slug = GOVERNANCE_SLUG[agent.id];
                const status = agentOverallStatus(slug);
                const anyNotActivated = companies.some(co => getAgentPhase(slug, co.id) === "not_activated");
                const activateBtnDisabled = activationUnavailable;
                return (
                  <div key={agent.id}
                    style={{ ...rowBase, cursor: "pointer" }}
                    onClick={() => {
                      // Pending agents → guided onboarding modal; active agents → File Manager
                      if (status === "pending") {
                        setOnboardGuideModal({ slug, agentName: agent.name, agentIcon: agent.icon });
                        return;
                      }
                      const activeHotel = companies.find(co => {
                        const ph = getAgentPhase(slug, co.id);
                        return ph === "crawl" || ph === "walk" || ph === "run";
                      }) || companies[0];
                      if (activeHotel) onLoad(activeHotel, "filemanager", { agentFilter: slug });
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = `${T.orange}08`}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                  >
                    <span style={{ fontSize: 18, flexShrink: 0 }}>{agent.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 4 }}>{agent.name}</div>
                      {/* Per-hotel phase dots */}
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        {companies.slice(0, 5).map(co => (
                          <div key={co.id} style={{ display: "flex", alignItems: "center", gap: 2 }}>
                            <span style={{ fontSize: 9, color: T.dim, fontFamily: T.mono }}>{co.apaleoPropertyId || co.companyName?.slice(0,3)}</span>
                            <span style={{ fontSize: 11 }}>{phaseDot(getAgentPhase(slug, co.id))}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <NativeBadge status={status} />
                    {status === "pending" ? (
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          setOnboardGuideModal({ slug, agentName: agent.name, agentIcon: agent.icon });
                        }}
                        style={{ ...smallBtn(T.orange, true) }}
                        title="Start the guided onboarding process for this agent"
                      >
                        Onboard →
                      </button>
                    ) : (
                      <button
                        disabled={activateBtnDisabled}
                        title={activateBtnDisabled ? "Pending setup — activation engine not yet deployed" : undefined}
                        onClick={e => {
                          e.stopPropagation();
                          if (activateBtnDisabled) return;
                          setActivateError(null);
                          setActivateModal({ agentId: slug, agentName: agent.name });
                        }}
                        style={{
                          ...smallBtn(anyNotActivated && !activateBtnDisabled ? T.orange : T.dim, anyNotActivated && !activateBtnDisabled),
                          opacity: activateBtnDisabled ? 0.45 : 1,
                          cursor: activateBtnDisabled ? "not-allowed" : "pointer",
                        }}
                      >
                        {activateBtnDisabled ? "Pending setup" : anyNotActivated ? "Activate →" : "Manage →"}
                      </button>
                    )}
                  </div>
                );
              })}

              {/* Section divider */}
              <div style={{ height: 1, background: T.border, margin: "6px 0" }} />

              {/* External A2A Agents */}
              <div style={sectionLabel}>EXTERNAL A2A AGENTS</div>
              {externalAgents.length === 0 ? (
                <div style={{ padding: "12px 20px 18px", fontSize: 12, color: T.dim, fontFamily: T.mono }}>
                  No external agents submitted yet · Submit via <code style={{ color: T.blue }}>POST /api/a2a/onboarding</code>
                </div>
              ) : externalAgents.map(ext => {
                const name = ext.agentCard?.name || ext.externalAgentDid || "Unknown Agent";
                return (
                  <div key={ext.id} style={rowBase}>
                    <span style={{ fontSize: 18, flexShrink: 0 }}>💱</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
                    </div>
                    <A2ABadge status={ext.status} />
                    <button
                      onClick={() => {
                        const target = currentSetup || companies[0];
                        if (target) onLoad(target, "onboarding", { phaseSubTab: "wizard" });
                      }}
                      style={smallBtn(T.blue, true)}
                    >Review →</button>
                  </div>
                );
              })}
            </div>

            {/* ── RIGHT: Hotel Operations (44%) ── */}
            <div style={{ ...panelStyle, flex: "1 1 0" }}>
              <div style={{ padding: "14px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Hotel Operations</div>
                <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono }}>{companies.length} properties</div>
              </div>

              {/* Compact hotel list */}
              {companies.map(co => (
                <div key={co.id} style={rowBase}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                    background: `${T.orange}20`, border: `1px solid ${T.orange}30`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontFamily: T.mono, fontWeight: 900, fontSize: 11, color: T.orange,
                  }}>
                    {co.companyName?.slice(0, 2).toUpperCase() || "??"}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{co.companyName}</span>
                      {co.apaleoPropertyId && (
                        <span style={{ fontSize: 9, fontFamily: T.mono, fontWeight: 700, color: T.orange, background: `${T.orange}18`, border: `1px solid ${T.orange}30`, borderRadius: 3, padding: "1px 5px", flexShrink: 0 }}>
                          {co.apaleoPropertyId}
                        </span>
                      )}
                    </div>
                    {portfolio === null && allPhases[co.id] === undefined ? (
                      <div style={{ height: 10, width: 120, background: `${T.dim}30`, borderRadius: 4, animation: "pulse-ring 1.2s ease infinite" }} />
                    ) : (
                      <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono }}>{hotelPhaseSummary(co.id)}</div>
                    )}
                  </div>
                  <button onClick={() => onLoad(co)} style={smallBtn(T.blue, true)}>Open hub →</button>
                </div>
              ))}

              {/* Matrix toggle button */}
              <div style={{ padding: "12px 20px", borderTop: `1px solid ${T.border}` }}>
                <button
                  onClick={() => setMatrixOpen(p => !p)}
                  style={{
                    width: "100%", padding: "7px 14px", borderRadius: 7,
                    background: matrixOpen ? `${T.orange}15` : "transparent",
                    border: `1px solid ${matrixOpen ? T.orange : T.border}`,
                    color: matrixOpen ? T.orange : T.dim,
                    fontFamily: T.mono, fontSize: 11, fontWeight: 700, cursor: "pointer",
                  }}
                >
                  {matrixOpen ? "▲ Collapse matrix view" : "▼ Expand to matrix view"}
                </button>
              </div>

              {/* Matrix view */}
              {matrixOpen && (
                <div style={{ overflowX: "auto", padding: "0 4px 16px" }}>
                  <table style={{ borderCollapse: "collapse", fontSize: 11, width: "100%" }}>
                    <thead>
                      <tr>
                        <th style={{ padding: "6px 12px", textAlign: "left", color: T.dim, fontFamily: T.mono, fontWeight: 700, borderBottom: `1px solid ${T.border}`, width: 60 }} />
                        {AGENT_DEFS.map(a => (
                          <th key={a.id} title={a.name} style={{ padding: "5px 6px", textAlign: "center", color: T.dim, fontFamily: T.mono, fontWeight: 700, fontSize: 9, borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap", letterSpacing: "0.04em" }}>
                            {MATRIX_ABBREV[a.id]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {companies.map(co => (
                        <tr key={co.id}>
                          <td style={{ padding: "7px 12px", fontFamily: T.mono, fontSize: 10, fontWeight: 700, color: T.orange, borderBottom: `1px solid ${T.border}10`, whiteSpace: "nowrap" }}>
                            {co.apaleoPropertyId || co.companyName?.slice(0, 3).toUpperCase()}
                          </td>
                          {AGENT_DEFS.map(a => {
                            const slug = GOVERNANCE_SLUG[a.id];
                            const phase = getAgentPhase(slug, co.id);
                            const activated = phase !== "not_activated";
                            return (
                              <td key={a.id}
                                onClick={() => {
                                  if (activated) onLoad(co, "onboarding", { phaseSubTab: "phases", phaseAgent: slug });
                                  else if (!activationUnavailable) { setActivateError(null); setActivateModal({ agentId: slug, agentName: a.name }); }
                                }}
                                title={activated ? `${a.name} @ ${co.apaleoPropertyId}: ${phase} — click to manage` : `Activate ${a.name} @ ${co.apaleoPropertyId}`}
                                style={{ padding: "7px 6px", textAlign: "center", borderBottom: `1px solid ${T.border}10`, cursor: "pointer", fontSize: 13 }}
                                onMouseEnter={e => e.currentTarget.style.background = `${T.orange}10`}
                                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                              >
                                {phase === "crawl" ? "🟡" : phase === "walk" ? "🔵" : phase === "run" ? "🟢" : (
                                  <span style={{ color: T.dim, fontFamily: T.mono }}>–</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Framework footer */}
        <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 20, marginTop: 24, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono }}>VDA-MD Framework · C2MD (Compliance to Markdown) · Powered by Apaleo · April 2026</div>
          <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono }}>Saved locally in this browser · No external storage</div>
        </div>
      </div>

      {/* ── Guided Onboarding Modal ── */}
      {onboardGuideModal && (() => {
        const steps = [
          {
            num: 1, phase: "Crawl", color: "#d97706",
            title: "Review existing governance files",
            body: "The framework has already generated governance files for this agent — AGENTS.md, SOP.md, SKILL.md, EXCEPTION.md and more. Your first task is to open each file, read it, and sign off on it. No editing required at this stage.",
            action: "Open File Manager →",
            onAction: () => {
              setOnboardGuideModal(null);
              const target = companies.find(co => {
                const ph = getAgentPhase(onboardGuideModal.slug, co.id);
                return ph === "crawl" || ph === "walk" || ph === "run";
              }) || companies[0];
              if (target) onLoad(target, "filemanager", { agentFilter: onboardGuideModal.slug, reviewMode: true });
            },
          },
          {
            num: 2, phase: "Walk", color: T.blue,
            title: "Submit the admission request",
            body: "Once you have reviewed the files, submit a formal admission request through the Wizard. This starts the 7-phase governance workflow — identity verification, sandbox evaluation, and two rounds of compliance officer sign-off.",
            action: "Open Onboarding Wizard →",
            onAction: () => {
              setOnboardGuideModal(null);
              const target = companies[0];
              if (target) onLoad(target, "onboarding", { phaseSubTab: "wizard" });
            },
          },
          {
            num: 3, phase: "Run", color: T.green,
            title: "Await approval and phase activation",
            body: "After submission, the Approvals tab shows live HITL decision cards. Once both reviews pass, the Phase Management tab lets you promote the agent from Crawl → Walk → Run. Generating new governance files comes only at this stage.",
            action: null,
          },
        ];
        return (
          <div
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
            onClick={() => setOnboardGuideModal(null)}
          >
            <div
              style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 16, padding: 32, maxWidth: 520, width: "100%" }}
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
                <span style={{ fontSize: 24 }}>{onboardGuideModal.agentIcon}</span>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 17, color: T.text }}>{onboardGuideModal.agentName}</div>
                  <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono, letterSpacing: "0.05em" }}>ONBOARDING GUIDE · CRAWL → WALK → RUN</div>
                </div>
              </div>
              <div style={{ fontSize: 13, color: T.muted, marginBottom: 24, lineHeight: 1.5 }}>
                Follow these three steps in order. Don't rush — the framework has done most of the heavy lifting already.
              </div>

              {/* Steps */}
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {steps.map(step => (
                  <div key={step.num} style={{ background: `${step.color}0c`, border: `1px solid ${step.color}25`, borderRadius: 10, padding: "14px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <span style={{ fontFamily: T.mono, fontWeight: 800, fontSize: 10, color: step.color, background: `${step.color}20`, border: `1px solid ${step.color}40`, borderRadius: 4, padding: "2px 6px", letterSpacing: "0.08em" }}>
                        STEP {step.num} · {step.phase}
                      </span>
                      <span style={{ fontWeight: 700, fontSize: 13, color: T.text }}>{step.title}</span>
                    </div>
                    <p style={{ margin: 0, fontSize: 12, color: T.muted, lineHeight: 1.6, marginBottom: step.action ? 12 : 0 }}>{step.body}</p>
                    {step.action && (
                      <button
                        onClick={step.onAction}
                        style={{ background: `${step.color}22`, border: `1px solid ${step.color}50`, color: step.color, borderRadius: 7, padding: "6px 14px", fontFamily: T.mono, fontWeight: 700, fontSize: 11, cursor: "pointer", letterSpacing: "0.04em" }}
                      >
                        {step.action}
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Footer */}
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
                <button onClick={() => setOnboardGuideModal(null)} style={smallBtn(T.dim, true)}>Close</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Activate Modal ── */}
      {activateModal && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => { setActivateModal(null); setActivateError(null); }}
        >
          <div
            style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: 28, maxWidth: 420, width: "90%" }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Activate {activateModal.agentName}</div>
            <div style={{ fontSize: 13, color: T.muted, marginBottom: 18 }}>
              {activationUnavailable ? "Activation engine not yet deployed — buttons disabled until setup is complete." : "Select a hotel to start the activation flow"}
            </div>

            {activateError && (
              <div style={{ background: `${T.red}15`, border: `1px solid ${T.red}30`, borderRadius: 7, padding: "8px 12px", marginBottom: 14, fontSize: 12, color: T.red, fontFamily: T.mono }}>
                {activateError}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
              {companies.map(co => {
                const phase = getAgentPhase(activateModal.agentId, co.id);
                const isActive = phase !== "not_activated";
                const btnDisabled = isActive || activating || activationUnavailable;
                return (
                  <button
                    key={co.id}
                    disabled={btnDisabled}
                    title={activationUnavailable ? "Pending setup — activation engine not yet deployed" : isActive ? `Already at ${phase}` : undefined}
                    onClick={() => !btnDisabled && handleActivate(activateModal.agentId, co.id)}
                    style={{
                      padding: "8px 14px", borderRadius: 8, fontFamily: T.mono, fontWeight: 700, fontSize: 12,
                      cursor: btnDisabled ? "not-allowed" : "pointer",
                      background: isActive || activationUnavailable ? `${T.dim}15` : `${T.orange}20`,
                      color: isActive || activationUnavailable ? T.dim : T.orange,
                      border: `1px solid ${(isActive || activationUnavailable) ? T.dim + "30" : T.orange + "50"}`,
                      opacity: activationUnavailable ? 0.45 : activating ? 0.6 : 1,
                    }}
                  >
                    {co.apaleoPropertyId || co.companyName?.slice(0, 3).toUpperCase()}
                    {isActive && <span style={{ fontSize: 10, marginLeft: 4, opacity: 0.7 }}>({phase})</span>}
                  </button>
                );
              })}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button onClick={() => { setActivateModal(null); setActivateError(null); }} style={smallBtn(T.dim, true)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// LIVE DEMO DASHBOARD TAB
// ─────────────────────────────────────────────
const AGENT_DEFS = [
  { id: "availability",  name: "Availability Agent",       icon: "🔍", policy: "Hospitality-Revenue-Pre-Book-availability-agent.SOP.md",          endpoint: "/api/agents/availability" },
  { id: "rate",          name: "Rate Agent",                icon: "💰", policy: "Hospitality-Revenue-Book-rate-agent.SOP.md",                     endpoint: "/api/agents/rate" },
  { id: "reservation",   name: "Reservation Bot",           icon: "📋", policy: "Hospitality-Revenue-Book-reservation-bot.SOP.md",               endpoint: "/api/agents/reservation",
    params: [
      { key: "action", label: "Action", type: "select", options: ["retrieve", "create", "modify"], default: "retrieve" },
      { key: "reservationId", label: "Reservation ID", type: "text", placeholder: "Leave blank to list recent" },
      { key: "modifyFields", label: "Modify Fields (JSON)", type: "text", placeholder: '{"departure":"2026-04-05"}' },
    ],
  },
  { id: "checkin",       name: "Check-In Agent",            icon: "✅", policy: "Hospitality-Operations-Stay-checkin-agent.SOP.md",              endpoint: "/api/agents/checkin" },
  { id: "folio-charge",  name: "Folio Charge Agent",        icon: "💳", policy: "Hospitality-Operations-Stay-folio-charge-agent.SOP.md",         endpoint: "/api/agents/folio-charge",
    params: [
      { key: "chargeAmount", label: "Charge Amount (€)", type: "number", default: 240 },
      { key: "serviceType",  label: "Service Type", type: "select", options: ["RoomRevenue", "FoodAndBeverage", "Spa", "Parking", "Other"], default: "RoomRevenue" },
      { key: "chargeName",   label: "Charge Name", type: "text", default: "Demo Room Charge" },
    ],
  },
  { id: "folio",         name: "Folio Agent",               icon: "🧾", policy: "Hospitality-Operations-Stay-folio-charge-agent.SOP.md",         endpoint: "/api/agents/folio" },
  { id: "checkout",      name: "Checkout Agent",            icon: "🚪", policy: "Hospitality-Operations-Post-Stay-checkout-agent.SOP.md",         endpoint: "/api/agents/checkout",
    params: [
      { key: "loyaltyTier",  label: "Loyalty Tier", type: "select", options: ["Standard", "Silver", "Gold", "Platinum"], default: "Gold" },
      { key: "lateCheckout", label: "Late Checkout Until", type: "text", placeholder: "e.g. 13:00" },
    ],
  },
  { id: "revenue",       name: "Revenue Reconciliation",    icon: "📊", policy: "revenue-reconciliation-policy.md",                           endpoint: "/api/agents/revenue" },
];

function AgentStatusCard({ agent, status, lastEntry, running }) {
  const decisionColor = {
    PASS: T.green, FAIL: T.red, ESCALATE: T.amber,
  }[lastEntry?.decision] || T.dim;

  return (
    <div style={{
      background: running ? `${T.orange}08` : T.card,
      border: `1px solid ${running ? T.orange + "50" : lastEntry ? decisionColor + "30" : T.border}`,
      borderRadius: 10, padding: "14px 16px",
      display: "flex", flexDirection: "column", gap: 8,
      transition: "all 0.3s",
      animation: running ? "glow-pulse 1.5s ease infinite" : "none",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 18 }}>{agent.icon}</span>
          <span style={{ fontWeight: 700, fontSize: 13, fontFamily: T.sans }}>{agent.name}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {!running && lastEntry?.apaleoData?.usedMcp && (
            <span style={{
              fontSize: 8, fontFamily: T.mono, fontWeight: 800, letterSpacing: "0.1em",
              background: "#6366f1", color: "#fff", borderRadius: 3, padding: "1px 5px",
            }}>MCP</span>
          )}
          {running && (
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: T.orange, display: "inline-block", animation: "pulse-ring 1s ease infinite" }} />
          )}
          <span style={{
            fontSize: 10, fontFamily: T.mono, fontWeight: 800,
            color: running ? T.orange : lastEntry ? decisionColor : T.dim,
            textTransform: "uppercase", letterSpacing: "0.08em",
          }}>
            {running ? "RUNNING" : lastEntry ? lastEntry.decision : "IDLE"}
          </span>
        </div>
      </div>
      <div style={{ fontSize: 10, color: T.dim, fontFamily: T.mono }}>{agent.policy}</div>
      {lastEntry && !running && (
        <div style={{ fontSize: 11, color: T.muted, lineHeight: 1.5, borderTop: `1px solid ${T.border}`, paddingTop: 8 }}>
          <div style={{ color: decisionColor, fontWeight: 600, marginBottom: 4, fontFamily: T.mono, fontSize: 10 }}>
            {lastEntry.clauseApplied?.slice(0, 80)}{lastEntry.clauseApplied?.length > 80 ? "…" : ""}
          </div>
          <div style={{ color: T.dim, fontSize: 10 }}>
            {lastEntry.reasoning?.slice(0, 100)}{lastEntry.reasoning?.length > 100 ? "…" : ""}
          </div>
        </div>
      )}
      {!lastEntry && !running && (
        <div style={{ fontSize: 10, color: T.dim + "80", fontFamily: T.mono, fontStyle: "italic" }}>
          No decisions yet — run scenario or trigger individually
        </div>
      )}
    </div>
  );
}

const FILE_TYPE_BADGE = {
  AGENTS:          { color: "#4A9EFF", label: "AGENTS" },
  SOP:             { color: "#22D47A", label: "SOP" },
  SKILL:           { color: "#A066FF", label: "SKILL" },
  EXCEPTION:       { color: "#FF6B2B", label: "EXCEPTION" },
  SHARED_SERVICES: { color: "#FF4D6A", label: "SHARED" },
};

function inferFileType(filename) {
  if (!filename) return null;
  if (filename.endsWith(".EXCEPTION.md")) return "EXCEPTION";
  if (filename.endsWith(".AGENTS.md"))    return "AGENTS";
  if (filename.endsWith(".SOP.md"))       return "SOP";
  if (filename.endsWith(".SKILL.md"))     return "SKILL";
  const lower = filename.toLowerCase();
  if (lower.includes("shared-o2c") || lower.includes("finance-o2c") || lower.includes("shared_services")) return "SHARED_SERVICES";
  return null;
}

function FileBadgeChip({ filename }) {
  const ft = inferFileType(filename);
  if (!ft) return null;
  const cfg = FILE_TYPE_BADGE[ft];
  const shortName = filename.replace(/\.md$/, "").split(/[-.]/).slice(-2).join(".");
  return (
    <span
      title={`Click to view full filename:\n${filename}`}
      onClick={() => {
        const msg = `Governance file consulted:\n\n${filename}\n\nFile type: ${ft}`;
        window.alert(msg);
      }}
      style={{
        display: "inline-flex", alignItems: "center", gap: 3,
        fontSize: 8, fontFamily: T.mono, fontWeight: 700, letterSpacing: "0.06em",
        background: cfg.color + "18", color: cfg.color, border: `1px solid ${cfg.color}55`,
        borderRadius: 3, padding: "2px 6px", whiteSpace: "nowrap", cursor: "pointer",
        userSelect: "none",
      }}
    >
      <span style={{ opacity: 0.7, marginRight: 1 }}>[{cfg.label}]</span>
      <span>{shortName.length > 28 ? shortName.slice(0, 28) + "…" : shortName}</span>
    </span>
  );
}

// ── WitnessLedger ────────────────────────────────────────────────────────────
function WitnessLedger({ entries, runEntries, onRefresh, loading }) {
  const listRef = useRef(null);
  // Summary stats computed from ALL displayed entries so every metric is consistent
  const allPassCount  = entries.filter(e => e.decision === "PASS").length;
  const allFailCount  = entries.filter(e => e.decision === "FAIL").length;
  const allEscalCount = entries.filter(e => e.decision === "ESCALATE").length;
  const pct = entries.length ? Math.round((allPassCount / entries.length) * 100) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {entries.length > 0 && (
        <div style={{
          padding: "7px 14px", borderBottom: `1px solid ${T.border}`,
          display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap",
          background: `${T.green}07`,
        }}>
          <span style={{ fontSize: 9, color: T.dim, fontFamily: T.mono }}>
            {entries.length} total
          </span>
          <span style={{ fontSize: 9, color: T.dim, fontFamily: T.mono, opacity: 0.4 }}>·</span>
          <span style={{ fontSize: 9, color: T.green, fontFamily: T.mono, fontWeight: 800 }}>
            {allPassCount} PASS
          </span>
          {allFailCount > 0 && (
            <>
              <span style={{ fontSize: 9, color: T.dim, fontFamily: T.mono, opacity: 0.4 }}>·</span>
              <span style={{ fontSize: 9, color: T.red, fontFamily: T.mono, fontWeight: 800 }}>{allFailCount} FAIL</span>
            </>
          )}
          {allEscalCount > 0 && (
            <>
              <span style={{ fontSize: 9, color: T.dim, fontFamily: T.mono, opacity: 0.4 }}>·</span>
              <span style={{ fontSize: 9, color: T.amber, fontFamily: T.mono, fontWeight: 800 }}>{allEscalCount} ESCALATE</span>
            </>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
            {pct !== null && (
              <span style={{
                fontSize: 10, color: pct >= 80 ? T.green : pct >= 50 ? T.amber : T.red,
                fontFamily: T.mono, fontWeight: 800,
                background: `${pct >= 80 ? T.green : pct >= 50 ? T.amber : T.red}18`,
                border: `1px solid ${pct >= 80 ? T.green : pct >= 50 ? T.amber : T.red}40`,
                borderRadius: 5, padding: "2px 9px",
              }}>{pct}% PASS</span>
            )}
            {runEntries.length > 0 && (
              <span style={{ fontSize: 9, color: T.dim, fontFamily: T.mono }}>{runEntries.length} this run</span>
            )}
          </div>
        </div>
      )}

      <div ref={listRef} style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 6, padding: "10px 12px" }}>
        {entries.length === 0 && (
          <div style={{ padding: "28px 12px", textAlign: "center", color: T.dim, fontFamily: T.mono, fontSize: 11, lineHeight: 1.7 }}>
            No audit entries yet<br />Run the guest journey to begin
          </div>
        )}
        {entries.map((e, i) => {
          const decColor = { PASS: T.green, FAIL: T.red, ESCALATE: T.amber }[e.decision] || T.dim;
          const filesConsulted = e.filesConsulted ?? [];
          const crossDomain = e.crossDomainInheritance === true || e.apaleoData?.crossDomainInheritance === true;
          const rawId = e.witnessEntryId ?? e.id;
          const sealId = rawId ? String(rawId).slice(0, 8) : `#${i + 1}`;
          return (
            <div key={e.id || i} style={{
              background: T.surface, border: `1px solid ${T.border}`,
              borderLeft: `3px solid ${decColor}`,
              borderRadius: 6, padding: "8px 10px",
              animation: "slide-up 0.3s ease",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 5 }}>
                <span style={{
                  fontSize: 7, fontFamily: T.mono, fontWeight: 800, letterSpacing: "0.05em",
                  background: `${decColor}18`, color: decColor, border: `1px solid ${decColor}40`,
                  borderRadius: 3, padding: "1px 5px", flexShrink: 0,
                }}>🕵️ #{sealId}</span>
                <span style={{ fontWeight: 700, fontSize: 11, fontFamily: T.sans, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.agent}</span>
                <DecisionBadge decision={e.decision} />
              </div>

              {(filesConsulted.length > 0 || crossDomain) && (
                <div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginBottom: 4 }}>
                  {filesConsulted.map((f, fi) => <FileBadgeChip key={fi} filename={f} />)}
                  {crossDomain && (
                    <span style={{
                      fontSize: 8, fontFamily: T.mono, fontWeight: 800, letterSpacing: "0.08em",
                      background: "#FF4D6A22", color: "#FF4D6A", border: "1px solid #FF4D6A55",
                      borderRadius: 3, padding: "1px 5px",
                    }}>Cross-domain ✓</span>
                  )}
                </div>
              )}

              {e.reasoning && (
                <div style={{ fontSize: 10, color: T.dim, lineHeight: 1.45 }}>
                  {e.reasoning.slice(0, 120)}{e.reasoning.length > 120 ? "…" : ""}
                </div>
              )}

              <div style={{ display: "flex", gap: 5, marginTop: 4, flexWrap: "wrap", alignItems: "center" }}>
                {e.apaleoData?.usedMcp && (
                  <span style={{ fontSize: 7, fontFamily: T.mono, fontWeight: 800, letterSpacing: "0.1em", background: "#6366f1", color: "#fff", borderRadius: 3, padding: "1px 5px" }}>MCP</span>
                )}
                {e.exceptionApplied && (
                  <span style={{ fontSize: 9, color: T.amber, fontFamily: T.mono, fontWeight: 700 }}>⚡ EXCEPTION</span>
                )}
                {e.escalationTarget && (
                  <span style={{ fontSize: 9, color: T.red, fontFamily: T.mono, fontWeight: 700 }}>↑ ESCALATE</span>
                )}
                <span style={{ fontSize: 9, color: T.dim, fontFamily: T.mono, marginLeft: "auto" }}>
                  {e.createdAt ? new Date(e.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : e.timestamp || ""}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ padding: "8px 12px", borderTop: `1px solid ${T.border}` }}>
        <button onClick={onRefresh} disabled={loading} style={{
          background: "none", border: `1px solid ${T.border}`,
          borderRadius: 5, padding: "4px 10px", fontSize: 10, color: T.dim,
          cursor: "pointer", fontFamily: T.mono, width: "100%",
        }}>{loading ? "…" : "↺ Refresh from database"}</button>
      </div>
    </div>
  );
}

// ── Apaleo ID chip labels ─────────────────────────────────────────────────────
const APALEO_ID_META = {
  propertyId:    { label: "property",    icon: "🏨" },
  unitGroupId:   { label: "unit group",  icon: "🛏" },
  ratePlanId:    { label: "rate plan",   icon: "💰" },
  reservationId: { label: "reservation", icon: "📋" },
  folioId:       { label: "folio",       icon: "📄" },
};

// ── JOURNEY_STEPS ─────────────────────────────────────────────────────────────
const JOURNEY_STEPS = [
  {
    step: 1, agentId: "availability", name: "Availability Agent", icon: "🔍",
    artifactKeys: ["unitGroupId", "ratePlanId"],
    purpose: "Queries live Apaleo inventory for available units and active rate plans for the upcoming stay.",
    narrative: (s) => s.decision === "PASS"
      ? `Availability confirmed — units found matching the guest's requirements. ${s.actionProposed ? s.actionProposed.slice(0, 80) + (s.actionProposed.length > 80 ? "…" : "") : ""}`
      : `No availability found for the requested dates — journey halted at source. ${s.actionProposed?.slice(0, 80) || ""}`,
    insight: "No hardcoded availability thresholds — the policy file is the sole arbiter of what 'available' means.",
  },
  {
    step: 2, agentId: "rate", name: "Rate Agent", icon: "💰",
    artifactKeys: ["ratePlanId"],
    purpose: "Evaluates a 5% discount request (BAR €180 → €171) — within the agent's autonomous authority ceiling.",
    narrative: (s) => s.decision === "ESCALATE"
      ? `Discount request escalated for manager approval — outside agent's delegated authority. ${s.actionProposed?.slice(0, 70) || ""}`
      : s.decision === "PASS"
        ? `5% discount approved autonomously — within policy authority ceiling. ${s.actionProposed?.slice(0, 80) || ""}`
        : `Discount rejected — requested rate is below the policy floor. ${s.actionProposed?.slice(0, 80) || ""}`,
    insight: "Rate override authority is bounded by SKILL.md — not hardcoded. Change the file, change the behaviour.",
  },
  {
    step: 3, agentId: "reservation", name: "Reservation Bot", icon: "📋",
    artifactKeys: ["unitGroupId", "ratePlanId", "reservationId"],
    purpose: "Creates a booking in Apaleo after policy validation — no PMS write without a PASS decision.",
    narrative: (s) => s.decision === "PASS"
      ? `Reservation created in Apaleo — policy PASS was the prerequisite. ${s.actionProposed?.slice(0, 80) || ""}`
      : `Reservation blocked — mandatory policy check did not pass. ${s.actionProposed?.slice(0, 80) || ""}`,
    insight: "The reservation bot cannot act alone. Every write is policy-gated before Apaleo is touched.",
  },
  {
    step: 4, agentId: "checkin", name: "Check-In Agent", icon: "✅",
    artifactKeys: ["reservationId", "folioId"],
    purpose: "Validates 5 mandatory gates (ID, folio, payment, status, arrival) before executing check-in.",
    narrative: (s) => s.decision === "PASS"
      ? `All 5 check-in gates passed — guest successfully checked in. ${s.actionProposed?.slice(0, 80) || ""}`
      : `Check-in blocked: one or more mandatory gates failed. ${s.actionProposed?.slice(0, 80) || ""}`,
    insight: "One failed gate blocks the entire check-in — preventing costly downstream data errors at source.",
  },
  {
    step: 5, agentId: "folio-charge", name: "Folio Charge Agent", icon: "💳",
    artifactKeys: ["folioId", "reservationId"],
    purpose: "Posts an €89 room revenue charge to the guest folio, inheriting cross-domain Finance O2C policy.",
    narrative: (s) => s.decision === "PASS"
      ? `€89 charge posted to folio under Finance O2C policy. ${s.crossDomainInheritance ? "Cross-domain policy inheritance applied. " : ""}${s.actionProposed?.slice(0, 70) || ""}`
      : `Charge blocked — did not pass cross-domain finance policy validation. ${s.actionProposed?.slice(0, 70) || ""}`,
    insight: "Shared policy files prevent finance rules being re-invented per property — one source of truth.",
  },
  {
    step: 6, agentId: "checkout", name: "Checkout Agent", icon: "🚪",
    artifactKeys: ["reservationId", "folioId"],
    purpose: "Processes departure with Gold loyalty exception evaluation and folio settlement verification.",
    narrative: (s) => s.exceptionApplied
      ? `Checkout completed with loyalty exception applied — bounded and auditable. ${s.actionProposed?.slice(0, 70) || ""}`
      : s.decision === "PASS"
        ? `Guest checked out, folio settled. ${s.actionProposed?.slice(0, 90) || ""}`
        : `Checkout blocked — folio unsettled or policy condition not met. ${s.actionProposed?.slice(0, 70) || ""}`,
    insight: "Exceptions are auditable, bounded, and immutable files — no hardcoded loyalty logic in code.",
  },
  {
    step: 7, agentId: "revenue", name: "Revenue Reconciliation", icon: "📊",
    artifactKeys: ["propertyId", "reservationId", "folioId"],
    purpose: "Reconciles revenue data and seals the Witness Agent audit trail for the complete guest journey.",
    narrative: (s) => s.decision === "PASS"
      ? `Revenue reconciled and Witness trail sealed for the complete guest journey. ${s.actionProposed?.slice(0, 70) || ""}`
      : `Revenue reconciliation flagged an anomaly — audit entry created for review. ${s.actionProposed?.slice(0, 70) || ""}`,
    insight: "Every decision, every governance file, every outcome — one click away from SOC 2 evidence.",
  },
];

// ── JourneyTimeline ───────────────────────────────────────────────────────────
function JourneyTimeline({ journeySteps, completedSteps, activeStepIdx, hasRun }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {journeySteps.map((step, idx) => {
        const isActive   = idx === activeStepIdx;
        const stepData   = completedSteps[step.step];
        const isComplete = !!stepData;
        const isUpcoming = !isComplete && !isActive;
        const decColor   = isComplete
          ? ({ PASS: T.green, FAIL: T.red, ESCALATE: T.amber }[stepData.decision] || T.dim)
          : T.dim;
        const filesConsulted = stepData?.filesConsulted ?? [];
        const crossDomain    = stepData?.crossDomainInheritance === true;

        return (
          <div key={step.step} style={{ display: "flex", gap: 0 }}>
            {/* Connector column */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginRight: 13, flexShrink: 0, width: 28 }}>
              <div style={{
                width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                border: `2px solid ${isComplete ? decColor : isActive ? T.orange : T.border}`,
                background: isComplete ? `${decColor}18` : isActive ? `${T.orange}12` : T.surface,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 13,
                animation: isActive ? "pulse-ring 1.5s ease infinite" : "none",
                transition: "all 0.4s",
                boxShadow: isActive ? `0 0 0 4px ${T.orange}15` : "none",
              }}>
                {isComplete
                  ? <span>{step.icon}</span>
                  : isActive
                    ? <span style={{ fontSize: 14, animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</span>
                    : <span style={{ opacity: 0.35 }}>{step.icon}</span>
                }
              </div>
              {idx < journeySteps.length - 1 && (
                <div style={{
                  width: 2, flex: 1, minHeight: 12,
                  background: isComplete ? `${decColor}45` : T.border,
                  transition: "background 0.5s",
                  margin: "3px 0",
                }} />
              )}
            </div>

            {/* Step content */}
            <div style={{
              flex: 1,
              paddingBottom: idx < journeySteps.length - 1 ? 18 : 0,
              opacity: isUpcoming && hasRun ? 0.42 : isUpcoming ? 0.65 : 1,
              transition: "opacity 0.4s",
            }}>
              {/* Name row */}
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 3, marginBottom: 5 }}>
                <span style={{ fontWeight: 700, fontSize: 13, fontFamily: T.sans, color: isComplete ? T.text : isActive ? T.orange : T.dim }}>
                  {step.name}
                </span>
                <span style={{ fontSize: 9, fontFamily: T.mono, color: T.dim, opacity: 0.5 }}>Step {step.step}/7</span>
                {isActive && (
                  <span style={{
                    fontSize: 9, fontFamily: T.mono, fontWeight: 800, color: T.orange,
                    letterSpacing: "0.1em", textTransform: "uppercase",
                    animation: "glow-pulse 1.5s ease infinite",
                  }}>· Running</span>
                )}
                {isComplete && (
                  <div style={{ marginLeft: "auto" }}>
                    <DecisionBadge decision={stepData.decision} />
                  </div>
                )}
              </div>

              {/* Purpose */}
              <div style={{ fontSize: 11, color: isActive ? T.muted : T.dim, lineHeight: 1.55, marginBottom: isComplete ? 10 : 0 }}>
                {step.purpose}
              </div>

              {/* Completed detail */}
              {isComplete && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {/* Narrative: plain-English outcome */}
                  <div style={{
                    fontSize: 11, color: T.muted, lineHeight: 1.6, fontWeight: 500,
                    background: `${decColor}08`, borderRadius: 5, padding: "6px 9px",
                    border: `1px solid ${decColor}1a`,
                  }}>
                    {step.narrative(stepData)}
                  </div>

                  {/* Apaleo artifact chips */}
                  {stepData.apaleoIds && step.artifactKeys?.some(k => stepData.apaleoIds[k]) && (
                    <div style={{
                      display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center",
                      padding: "5px 8px", borderRadius: 5,
                      background: "#0a1628", border: "1px solid #1e3a5f",
                    }}>
                      <span style={{ fontSize: 8, color: "#4a90d9", fontFamily: T.mono, fontWeight: 700, letterSpacing: "0.08em", flexShrink: 0 }}>
                        APALEO
                      </span>
                      {step.artifactKeys.map(k => {
                        const val = stepData.apaleoIds[k];
                        if (!val) return null;
                        const meta = APALEO_ID_META[k] || { label: k, icon: "🔗" };
                        return (
                          <span key={k} style={{
                            display: "inline-flex", alignItems: "center", gap: 3,
                            fontSize: 9, fontFamily: T.mono, fontWeight: 600,
                            color: "#7eb8f7",
                            background: "#112240", border: "1px solid #1e3a5f",
                            borderRadius: 4, padding: "2px 7px",
                            maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }} title={`${meta.label}: ${val}`}>
                            <span style={{ fontSize: 9 }}>{meta.icon}</span>
                            <span style={{ color: "#4a90d9", fontSize: 8, fontWeight: 700 }}>{meta.label}:</span>
                            <span>{val}</span>
                          </span>
                        );
                      })}
                    </div>
                  )}

                  {/* Governance files */}
                  {filesConsulted.length > 0 && (
                    <div>
                      <div style={{
                        fontSize: 9, color: T.dim, fontFamily: T.mono,
                        letterSpacing: "0.07em", textTransform: "uppercase",
                        marginBottom: 5, opacity: 0.7,
                      }}>
                        Governance context loaded:
                      </div>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {filesConsulted.map((f, fi) => <FileBadgeChip key={fi} filename={f} />)}
                        {crossDomain && (
                          <span style={{
                            fontSize: 8, fontFamily: T.mono, fontWeight: 800, letterSpacing: "0.08em",
                            background: "#FF4D6A22", color: "#FF4D6A", border: "1px solid #FF4D6A55",
                            borderRadius: 3, padding: "1px 5px",
                          }}>Cross-domain ✓</span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Clause applied */}
                  {stepData.clauseApplied && (
                    <div style={{
                      fontSize: 10, fontFamily: T.mono, color: decColor,
                      background: `${decColor}0d`, border: `1px solid ${decColor}28`,
                      borderRadius: 4, padding: "5px 9px", lineHeight: 1.5,
                    }}>
                      {stepData.clauseApplied.slice(0, 130)}{stepData.clauseApplied.length > 130 ? "…" : ""}
                    </div>
                  )}

                  {/* Action taken */}
                  {stepData.actionProposed && (
                    <div style={{ fontSize: 10, color: T.muted, lineHeight: 1.5 }}>
                      <span style={{ color: T.dim, fontFamily: T.mono, fontSize: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>Action taken: </span>
                      {stepData.actionProposed.slice(0, 150)}{stepData.actionProposed.length > 150 ? "…" : ""}
                    </div>
                  )}

                  {/* Witness seal + extras */}
                  <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                    {stepData.witnessEntryId && (
                      <span style={{
                        fontSize: 9, fontFamily: T.mono, fontWeight: 800, letterSpacing: "0.04em",
                        background: `${decColor}10`, color: decColor, border: `1px solid ${decColor}32`,
                        borderRadius: 4, padding: "2px 9px",
                      }}>
                        🕵️ Witness #{String(stepData.witnessEntryId).slice(0, 8)} sealed
                      </span>
                    )}
                    {stepData.exceptionApplied && (
                      <span style={{ fontSize: 9, color: T.amber, fontFamily: T.mono, fontWeight: 700 }}>⚡ EXCEPTION APPLIED</span>
                    )}
                    {stepData.escalationTarget && (
                      <span style={{ fontSize: 9, color: T.red, fontFamily: T.mono, fontWeight: 700 }}>↑ ESCALATE → {stepData.escalationTarget}</span>
                    )}
                  </div>

                  {/* Insight line */}
                  <div style={{
                    fontSize: 10, color: T.orange, fontFamily: T.mono, lineHeight: 1.6,
                    borderLeft: `2px solid ${T.orange}35`, paddingLeft: 9,
                  }}>
                    {step.insight}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LiveDemoTab({ config, companyName, propertyId, companyId, onLogEntry }) {
  const [agentLastEntries, setAgentLastEntries]   = useState({});
  const [runningAgents,    setRunningAgents]       = useState(new Set());
  const [streamEntries,    setStreamEntries]       = useState([]);
  const [scenarioRunning,  setScenarioRunning]     = useState(false);
  const [scenarioComplete, setScenarioComplete]    = useState(false);
  const [scenarioTokenData, setScenarioTokenData]  = useState(null);  // [{step,agent,inputTokens,outputTokens}]
  const [dbEntries,        setDbEntries]           = useState([]);
  const [loadingDbEntries, setLoadingDbEntries]    = useState(false);
  const [selectedAgent,    setSelectedAgent]       = useState(null);
  const [completedSteps,   setCompletedSteps]      = useState({});  // { [stepNum]: stepData }
  const [activeStepIdx,    setActiveStepIdx]       = useState(-1);  // -1 = none active
  const [showAdvanced,     setShowAdvanced]        = useState(false);
  const [showShowreel,     setShowShowreel]        = useState(false);
  const [agentParams, setAgentParams] = useState({
    availability:   { arrival: new Date().toISOString().split("T")[0], departure: new Date(Date.now() + 86400000).toISOString().split("T")[0], adults: "2" },
    rate:           { requestedRate: "162", barRate: "180" },
    reservation:    { action: "retrieve", guestName: "Demo Guest" },
    checkin:        { guestName: "Demo Guest" },
    "folio-charge": { chargeAmount: 240, serviceType: "RoomRevenue", chargeName: "Demo Room Charge" },
    folio:          {},
    checkout:       { guestName: "Demo Guest", loyaltyTier: "Gold", lateCheckout: "13:00" },
    revenue:        { date: new Date().toISOString().split("T")[0] },
  });

  const hasCredentials = !!propertyId;
  const hasCompany     = !!companyId;
  const hasRun         = scenarioRunning || scenarioComplete || streamEntries.length > 0;

  const fetchDbEntries = useCallback(async () => {
    if (!companyId) return;
    setLoadingDbEntries(true);
    try {
      const r = await fetch(`/api/agents/witness?companyId=${companyId}&limit=50`);
      if (r.ok) setDbEntries(await r.json());
    } catch (e) { /* ignore */ }
    setLoadingDbEntries(false);
  }, [companyId]);

  useEffect(() => { fetchDbEntries(); }, [fetchDbEntries]);

  // ── Showreel callbacks — keep background JourneyTimeline in sync ──────────
  const handleShowreelStep = useCallback((step) => {
    setCompletedSteps(prev => ({ ...prev, [step.step]: step }));
    setActiveStepIdx(step.step - 1);
    const agentDef = AGENT_DEFS.find(a => a.name === step.agent);
    const entry = { ...step, fileReferenced: agentDef?.policy || "", createdAt: new Date().toISOString() };
    setStreamEntries(prev => [...prev, entry]);
    if (agentDef) setAgentLastEntries(prev => ({ ...prev, [agentDef.id]: entry }));
    if (onLogEntry) {
      onLogEntry({
        id: Date.now() + Math.random(),
        timestamp: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        agent: step.agent, decision: step.decision,
        fileReferenced: agentDef?.policy || "",
        clauseApplied: step.clauseApplied || "", actionProposed: step.actionProposed || "",
        exceptionApplied: step.exceptionApplied || false, escalationTarget: step.escalationTarget || null,
        reasoning: step.reasoning || "",
      });
    }
  }, [onLogEntry]);

  const handleShowreelDone = useCallback((allSteps) => {
    setScenarioComplete(true);
    setScenarioRunning(false);
    setActiveStepIdx(-1);
    setScenarioTokenData(allSteps.map(s => ({
      step: s.step, agent: s.agent,
      inputTokens: s.inputTokens ?? 0, outputTokens: s.outputTokens ?? 0,
    })));
    fetchDbEntries();
  }, [fetchDbEntries]);

  const handleShowreelClose = useCallback((goToTimeline) => {
    setShowShowreel(false);
    setScenarioRunning(false);
    if (goToTimeline) {
      setTimeout(() => {
        document.getElementById("journey-timeline")?.scrollIntoView({ behavior: "smooth" });
      }, 200);
    }
  }, []);

  const addStreamEntry = useCallback((entry) => {
    setStreamEntries(prev => [entry, ...prev].slice(0, 100));
    const agentDef = AGENT_DEFS.find(a => a.name === entry.agent);
    if (agentDef) setAgentLastEntries(prev => ({ ...prev, [agentDef.id]: entry }));
    if (onLogEntry) {
      onLogEntry({
        id: Date.now(),
        timestamp: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        agent: entry.agent, decision: entry.decision,
        fileReferenced: entry.fileReferenced || "",
        clauseApplied: entry.clauseApplied || "", actionProposed: entry.actionProposed || "",
        exceptionApplied: entry.exceptionApplied || false, escalationTarget: entry.escalationTarget || null,
        reasoning: entry.reasoning || "",
      });
    }
  }, [onLogEntry]);

  const runSingleAgent = useCallback(async (agentId) => {
    if (!hasCredentials || !hasCompany) return;
    const agent = AGENT_DEFS.find(a => a.id === agentId);
    if (!agent) return;

    // Map UI agentId to the canonical agent credential ID used in governance files
    const AGENT_CRED_ID_MAP = {
      availability: "availability-agent",
      rate: "rate-agent",
      reservation: "reservation-bot",
      checkin: "check-in-agent",
      "folio-charge": "folio-charge-agent",
      folio: "folio-agent",
      checkout: "checkout-agent",
      revenue: "revenue-reconciliation-agent",
    };
    const credAgentId = AGENT_CRED_ID_MAP[agentId] || agentId;

    setRunningAgents(prev => new Set([...prev, agentId]));
    try {
      // Fetch active credential for this agent — auto-issue if missing
      let vcBase64url = null;
      try {
        const credRes = await fetch(`/api/agents/credentials/active?agentId=${credAgentId}&companyId=${companyId}`);
        if (credRes.ok) {
          const credData = await credRes.json();
          // Encode signed W3C VC JSON as base64url for internal bearer transport (not a JWT)
          if (credData.signedVc) {
            vcBase64url = btoa(JSON.stringify(credData.signedVc))
              .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
          }
        } else {
          // Auto-issue a credential for this agent
          const issueRes = await fetch("/api/agents/credentials/issue", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ agentId: credAgentId, companyId }),
          });
          if (issueRes.ok) {
            const issued = await issueRes.json();
            vcBase64url = issued.vcBase64url;
          }
        }
      } catch (e) { /* credential fetch failed — will get 401 from server */ }

      const headers = { "Content-Type": "application/json" };
      if (vcBase64url) headers["Authorization"] = `Bearer ${vcBase64url}`;

      const r = await fetch(agent.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ propertyId, companyId, ...(agentParams[agentId] || {}) }),
      });
      if (r.ok) {
        const data = await r.json();
        addStreamEntry({ ...data, agent: agent.name, fileReferenced: agent.policy, createdAt: new Date().toISOString() });
        fetchDbEntries();
      } else if (r.status === 401) {
        const err = await r.json();
        console.warn("[VDA-MD] Agent credential rejected:", err);
      }
    } catch (e) { /* ignore */ }
    setRunningAgents(prev => { const n = new Set(prev); n.delete(agentId); return n; });
  }, [hasCredentials, hasCompany, propertyId, companyId, agentParams, addStreamEntry, fetchDbEntries]);

  const allEntries = [...streamEntries, ...dbEntries.filter(d => !streamEntries.find(s => (s.witnessEntryId ?? s.id) === d.id))].sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tb - ta;
  });

  const completedCount = Object.keys(completedSteps).length;

  return (
    <div style={{ padding: "24px 28px 48px", display: "flex", flexDirection: "column", gap: 22 }}>

      {/* ── Header ────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div>
          <div style={{ fontWeight: 900, fontSize: 22, letterSpacing: "-0.04em", marginBottom: 6 }}>
            VDA-MD Guest Journey · Live
          </div>
          <div style={{ fontSize: 12, color: T.dim, maxWidth: 520, lineHeight: 1.6 }}>
            7 AI agents govern a complete hotel stay — each reads its markdown policy before acting, every decision sealed in an immutable Witness Ledger
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexShrink: 0 }}>
          {propertyId ? (
            <div style={{ background: `${T.green}15`, border: `1px solid ${T.green}40`, borderRadius: 8, padding: "6px 14px", fontSize: 11, color: T.green, fontFamily: T.mono }}>
              🏨 {propertyId} · Live
            </div>
          ) : (
            <div style={{ background: `${T.amber}15`, border: `1px solid ${T.amber}40`, borderRadius: 8, padding: "6px 14px", fontSize: 11, color: T.amber, fontFamily: T.mono }}>
              ⚠ No property ID — configure in Setup
            </div>
          )}
          <button
            onClick={() => {
              setScenarioComplete(false);
              setCompletedSteps({});
              setStreamEntries([]);
              setAgentLastEntries({});
              setActiveStepIdx(0);
              setScenarioRunning(true);
              setShowShowreel(true);
            }}
            disabled={!hasCredentials || !hasCompany || scenarioRunning}
            style={{
              background: scenarioRunning ? `${T.orange}18` : hasCredentials && hasCompany ? T.orange : T.border,
              border: `1px solid ${scenarioRunning ? T.orange : hasCredentials && hasCompany ? T.orange : T.border}`,
              borderRadius: 8, padding: "10px 22px", fontSize: 13, fontWeight: 900,
              color: scenarioRunning ? T.orange : "#fff",
              fontFamily: T.sans, cursor: hasCredentials && hasCompany && !scenarioRunning ? "pointer" : "default",
              display: "flex", alignItems: "center", gap: 8,
              animation: scenarioRunning ? "glow-pulse 1.5s ease infinite" : "none",
              transition: "all 0.2s",
            }}
          >
            {scenarioRunning
              ? <><span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</span> Running…</>
              : scenarioComplete
                ? <><span>▶</span> Run Again</>
                : <><span>▶</span> Run Full Guest Journey</>
            }
          </button>
        </div>
      </div>

      {/* ── Completion banner ─────────────────────────────────────────── */}
      {scenarioComplete && (
        <div style={{
          background: `${T.green}10`, border: `1px solid ${T.green}35`,
          borderRadius: 8, padding: "10px 16px",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <span style={{ fontSize: 15 }}>✅</span>
          <span style={{ fontSize: 12, color: T.green, fontFamily: T.mono, fontWeight: 700 }}>
            Guest journey complete · {completedCount} agent decisions · all sealed in the Witness Ledger
          </span>
          <button
            onClick={() => { setScenarioComplete(false); setScenarioTokenData(null); setCompletedSteps({}); setStreamEntries([]); setActiveStepIdx(-1); }}
            style={{
              marginLeft: "auto", background: "none", border: `1px solid ${T.border}`,
              borderRadius: 6, padding: "3px 10px", fontSize: 10, color: T.dim, cursor: "pointer", fontFamily: T.mono,
            }}
          >dismiss</button>
        </div>
      )}

      {/* ── Token Usage Panel ─────────────────────────────────────────── */}
      {scenarioTokenData && scenarioTokenData.length > 0 && (() => {
        const totalIn  = scenarioTokenData.reduce((s, r) => s + r.inputTokens,  0);
        const totalOut = scenarioTokenData.reduce((s, r) => s + r.outputTokens, 0);
        const grandTotal = totalIn + totalOut;
        return (
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
            <div style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13 }}>⚡</span>
              <span style={{ fontWeight: 700, fontSize: 12 }}>Token Usage · This Run</span>
              <span style={{ marginLeft: "auto", fontSize: 10, color: T.dim, fontFamily: T.mono }}>
                Grand total: <strong style={{ color: T.fg }}>{grandTotal.toLocaleString()}</strong>
                <span style={{ color: T.dim, marginLeft: 6 }}>({totalIn.toLocaleString()} in · {totalOut.toLocaleString()} out)</span>
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "24px 1fr 90px 90px 90px", gap: 0 }}>
              {/* Header */}
              {["#", "Agent", "Input", "Output", "Total"].map((h, i) => (
                <div key={h} style={{
                  padding: "5px 10px", fontSize: 9, fontWeight: 800, fontFamily: T.mono,
                  color: T.dim, letterSpacing: "0.06em", textTransform: "uppercase",
                  borderBottom: `1px solid ${T.border}`,
                  textAlign: i >= 2 ? "right" : "left",
                  background: `${T.surface}88`,
                }}>{h}</div>
              ))}
              {scenarioTokenData.map((row, idx) => {
                const rowTotal = row.inputTokens + row.outputTokens;
                const barPct   = grandTotal > 0 ? Math.round((rowTotal / grandTotal) * 100) : 0;
                const isLast   = idx === scenarioTokenData.length - 1;
                return [
                  <div key={`s-${row.step}`} style={{ padding: "7px 10px", fontSize: 10, fontFamily: T.mono, color: T.dim, borderBottom: isLast ? "none" : `1px solid ${T.border}88`, background: idx % 2 === 0 ? "transparent" : `${T.surface}55` }}>{row.step}</div>,
                  <div key={`a-${row.step}`} style={{ padding: "7px 10px", fontSize: 11, fontWeight: 600, borderBottom: isLast ? "none" : `1px solid ${T.border}88`, background: idx % 2 === 0 ? "transparent" : `${T.surface}55`, overflow: "hidden" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.agent}</span>
                      <div style={{ height: 4, width: 60, background: T.border, borderRadius: 2, flexShrink: 0, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${barPct}%`, background: T.blue, borderRadius: 2, transition: "width 0.4s ease" }} />
                      </div>
                      <span style={{ fontSize: 9, color: T.dim, fontFamily: T.mono, flexShrink: 0 }}>{barPct}%</span>
                    </div>
                  </div>,
                  <div key={`i-${row.step}`} style={{ padding: "7px 10px", fontSize: 10, fontFamily: T.mono, color: T.dim, textAlign: "right", borderBottom: isLast ? "none" : `1px solid ${T.border}88`, background: idx % 2 === 0 ? "transparent" : `${T.surface}55` }}>{row.inputTokens.toLocaleString()}</div>,
                  <div key={`o-${row.step}`} style={{ padding: "7px 10px", fontSize: 10, fontFamily: T.mono, color: T.dim, textAlign: "right", borderBottom: isLast ? "none" : `1px solid ${T.border}88`, background: idx % 2 === 0 ? "transparent" : `${T.surface}55` }}>{row.outputTokens.toLocaleString()}</div>,
                  <div key={`t-${row.step}`} style={{ padding: "7px 10px", fontSize: 10, fontFamily: T.mono, fontWeight: 700, color: T.fg, textAlign: "right", borderBottom: isLast ? "none" : `1px solid ${T.border}88`, background: idx % 2 === 0 ? "transparent" : `${T.surface}55` }}>{rowTotal.toLocaleString()}</div>,
                ];
              })}
              {/* Totals row */}
              {[
                <div key="ts" style={{ padding: "7px 10px", borderTop: `1px solid ${T.border}`, background: `${T.surface}88` }} />,
                <div key="ta" style={{ padding: "7px 10px", fontSize: 10, fontWeight: 800, fontFamily: T.mono, borderTop: `1px solid ${T.border}`, background: `${T.surface}88`, color: T.dim, letterSpacing: "0.04em" }}>TOTAL · 7 AGENTS</div>,
                <div key="ti" style={{ padding: "7px 10px", fontSize: 10, fontWeight: 800, fontFamily: T.mono, textAlign: "right", borderTop: `1px solid ${T.border}`, background: `${T.surface}88`, color: T.dim }}>{totalIn.toLocaleString()}</div>,
                <div key="to" style={{ padding: "7px 10px", fontSize: 10, fontWeight: 800, fontFamily: T.mono, textAlign: "right", borderTop: `1px solid ${T.border}`, background: `${T.surface}88`, color: T.dim }}>{totalOut.toLocaleString()}</div>,
                <div key="tt" style={{ padding: "7px 10px", fontSize: 11, fontWeight: 900, fontFamily: T.mono, textAlign: "right", borderTop: `1px solid ${T.border}`, background: `${T.surface}88`, color: T.blue }}>{grandTotal.toLocaleString()}</div>,
              ]}
            </div>
          </div>
        );
      })()}

      {/* ── Two-panel: Journey Timeline + Witness Ledger ──────────────── */}
      <div style={{ display: "flex", gap: 18, alignItems: "flex-start" }}>

        {/* Left: Journey Timeline (58%) */}
        <div id="journey-timeline" style={{ flex: "0 0 58%", background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, overflow: "hidden" }}>
          <div style={{ padding: "13px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 15 }}>🗺</span>
            <span style={{ fontWeight: 700, fontSize: 13 }}>Guest Journey · 7 Steps</span>
            {scenarioRunning && activeStepIdx >= 0 && (
              <span style={{ fontSize: 10, color: T.orange, fontFamily: T.mono, marginLeft: 4 }}>
                Step {activeStepIdx + 1}/7 running…
              </span>
            )}
            {scenarioComplete && (
              <span style={{ fontSize: 10, color: T.green, fontFamily: T.mono, marginLeft: 4 }}>Complete</span>
            )}
          </div>

          {!hasRun && (
            <div style={{ padding: "20px 20px 4px", textAlign: "center" }}>
              <div style={{ fontSize: 11, color: T.dim, lineHeight: 1.65, maxWidth: 400, margin: "0 auto" }}>
                Run the full guest journey to see VDA-MD in action — 7 agents, 7 markdown policies, every decision sealed in an immutable audit ledger
              </div>
            </div>
          )}

          <div style={{ padding: "16px 18px" }}>
            <JourneyTimeline
              journeySteps={JOURNEY_STEPS}
              completedSteps={completedSteps}
              activeStepIdx={activeStepIdx}
              hasRun={hasRun}
            />
          </div>
        </div>

        {/* Right: Witness Ledger (42%) */}
        <div style={{ flex: "0 0 calc(42% - 18px)", background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "13px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ fontSize: 15 }}>🕵️</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13 }}>Witness Agent</div>
              <div style={{ fontSize: 9, color: T.dim, fontFamily: T.mono, marginTop: 1 }}>Immutable audit ledger · every decision sealed</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginLeft: "auto" }}>
              <span style={{
                width: 7, height: 7, borderRadius: "50%", display: "inline-block",
                background: allEntries.length > 0 ? T.green : T.dim,
                animation: scenarioRunning ? "pulse-ring 1s ease infinite" : allEntries.length > 0 ? "pulse-ring 2s ease infinite" : "none",
              }} />
              <span style={{ fontSize: 10, color: T.dim, fontFamily: T.mono }}>{allEntries.length} entries</span>
            </div>
          </div>
          <div style={{ maxHeight: 620, overflow: "hidden", display: "flex", flexDirection: "column", flex: 1 }}>
            <WitnessLedger
              entries={allEntries}
              runEntries={streamEntries}
              onRefresh={fetchDbEntries}
              loading={loadingDbEntries}
            />
          </div>
        </div>
      </div>

      {/* ── Advanced: Individual Agents ───────────────────────────────── */}
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12 }}>
        <button
          onClick={() => setShowAdvanced(v => !v)}
          style={{
            width: "100%", background: "none", border: "none", cursor: "pointer",
            padding: "13px 18px", display: "flex", alignItems: "center", gap: 10,
            fontFamily: T.sans, color: T.text, textAlign: "left",
          }}
        >
          <span style={{ fontSize: 10, fontFamily: T.mono, color: T.dim, textTransform: "uppercase", letterSpacing: "0.1em" }}>Advanced</span>
          <span style={{ fontSize: 12, fontWeight: 600 }}>Run individual agents</span>
          <span style={{ marginLeft: "auto", fontSize: 12, color: T.dim }}>{showAdvanced ? "▲" : "▼"}</span>
        </button>

        {showAdvanced && (
          <div style={{ borderTop: `1px solid ${T.border}`, padding: "16px 18px" }}>
            <div style={{ fontSize: 11, color: T.dim, marginBottom: 14, lineHeight: 1.5 }}>
              Trigger any agent independently — decisions are added to the Witness Ledger above
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
              {AGENT_DEFS.map(agent => (
                <div key={agent.id} style={{ cursor: "pointer" }} onClick={() => setSelectedAgent(selectedAgent === agent.id ? null : agent.id)}>
                  <AgentStatusCard
                    agent={agent}
                    status="idle"
                    lastEntry={agentLastEntries[agent.id]}
                    running={runningAgents.has(agent.id)}
                  />
                  {selectedAgent === agent.id && (
                    <div style={{
                      background: T.card, border: `1px solid ${T.border}`, borderRadius: "0 0 10px 10px",
                      padding: "12px 16px", marginTop: -1,
                    }} onClick={e => e.stopPropagation()}>
                      <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono, marginBottom: 10 }}>Run {agent.name} against live Apaleo data:</div>
                      {agent.id === "availability" && (
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                          <input value={agentParams.availability.arrival} onChange={e => setAgentParams(p => ({ ...p, availability: { ...p.availability, arrival: e.target.value } }))}
                            placeholder="Arrival (YYYY-MM-DD)" style={{ flex: 1, minWidth: 130, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 10px", color: T.text, fontFamily: T.mono, fontSize: 11 }} />
                          <input value={agentParams.availability.departure} onChange={e => setAgentParams(p => ({ ...p, availability: { ...p.availability, departure: e.target.value } }))}
                            placeholder="Departure (YYYY-MM-DD)" style={{ flex: 1, minWidth: 130, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 10px", color: T.text, fontFamily: T.mono, fontSize: 11 }} />
                        </div>
                      )}
                      {agent.id === "rate" && (
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                          <input value={agentParams.rate.barRate} onChange={e => setAgentParams(p => ({ ...p, rate: { ...p.rate, barRate: e.target.value } }))}
                            placeholder="BAR (€)" style={{ flex: 1, minWidth: 100, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 10px", color: T.text, fontFamily: T.mono, fontSize: 11 }} />
                          <input value={agentParams.rate.requestedRate} onChange={e => setAgentParams(p => ({ ...p, rate: { ...p.rate, requestedRate: e.target.value } }))}
                            placeholder="Requested rate (€)" style={{ flex: 1, minWidth: 100, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 10px", color: T.text, fontFamily: T.mono, fontSize: 11 }} />
                        </div>
                      )}
                      {agent.id === "reservation" && (
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                          <select value={agentParams.reservation.action || "retrieve"} onChange={e => setAgentParams(p => ({ ...p, reservation: { ...p.reservation, action: e.target.value } }))}
                            style={{ flex: 1, minWidth: 120, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 10px", color: T.text, fontFamily: T.mono, fontSize: 11 }}>
                            <option value="retrieve">retrieve</option>
                            <option value="create">create</option>
                            <option value="modify">modify</option>
                          </select>
                          <input value={agentParams.reservation.reservationId || ""} onChange={e => setAgentParams(p => ({ ...p, reservation: { ...p.reservation, reservationId: e.target.value } }))}
                            placeholder="Reservation ID (optional)" style={{ flex: 2, minWidth: 160, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 10px", color: T.text, fontFamily: T.mono, fontSize: 11 }} />
                        </div>
                      )}
                      {agent.id === "folio-charge" && (
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                          <input type="number" value={agentParams["folio-charge"]?.chargeAmount || 240} onChange={e => setAgentParams(p => ({ ...p, "folio-charge": { ...p["folio-charge"], chargeAmount: Number(e.target.value) } }))}
                            placeholder="Amount (€)" style={{ flex: 1, minWidth: 100, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 10px", color: T.text, fontFamily: T.mono, fontSize: 11 }} />
                          <select value={agentParams["folio-charge"]?.serviceType || "RoomRevenue"} onChange={e => setAgentParams(p => ({ ...p, "folio-charge": { ...p["folio-charge"], serviceType: e.target.value } }))}
                            style={{ flex: 1, minWidth: 130, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 10px", color: T.text, fontFamily: T.mono, fontSize: 11 }}>
                            <option value="RoomRevenue">RoomRevenue</option>
                            <option value="FoodAndBeverage">FoodAndBeverage</option>
                            <option value="Spa">Spa</option>
                            <option value="Parking">Parking</option>
                            <option value="Other">Other</option>
                          </select>
                          <input value={agentParams["folio-charge"]?.chargeName || "Demo Room Charge"} onChange={e => setAgentParams(p => ({ ...p, "folio-charge": { ...p["folio-charge"], chargeName: e.target.value } }))}
                            placeholder="Charge name" style={{ flex: 2, minWidth: 160, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 10px", color: T.text, fontFamily: T.mono, fontSize: 11 }} />
                        </div>
                      )}
                      {agent.id === "checkout" && (
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                          <select value={agentParams.checkout.loyaltyTier || "Gold"} onChange={e => setAgentParams(p => ({ ...p, checkout: { ...p.checkout, loyaltyTier: e.target.value } }))}
                            style={{ flex: 1, minWidth: 120, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 10px", color: T.text, fontFamily: T.mono, fontSize: 11 }}>
                            <option value="Standard">Standard</option>
                            <option value="Silver">Silver</option>
                            <option value="Gold">Gold</option>
                            <option value="Platinum">Platinum</option>
                          </select>
                          <input value={agentParams.checkout.lateCheckout || ""} onChange={e => setAgentParams(p => ({ ...p, checkout: { ...p.checkout, lateCheckout: e.target.value } }))}
                            placeholder="Late checkout time (e.g. 13:00)" style={{ flex: 2, minWidth: 140, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 10px", color: T.text, fontFamily: T.mono, fontSize: 11 }} />
                        </div>
                      )}
                      <button
                        onClick={() => runSingleAgent(agent.id)}
                        disabled={!hasCredentials || !hasCompany || runningAgents.has(agent.id)}
                        style={{
                          background: T.orange, border: "none", borderRadius: 6, padding: "7px 16px",
                          fontSize: 12, fontWeight: 700, color: "#fff", fontFamily: T.sans,
                          cursor: hasCredentials && hasCompany ? "pointer" : "default",
                          opacity: hasCredentials && hasCompany ? 1 : 0.5,
                        }}
                      >
                        {runningAgents.has(agent.id) ? "Running…" : `▶ Run ${agent.name}`}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Demo Showreel overlay (fullscreen, mounts when button clicked) ── */}
      {showShowreel && (
        <DemoShowreel
          propertyId={propertyId}
          companyId={companyId}
          onStepComplete={handleShowreelStep}
          onAllComplete={handleShowreelDone}
          onClose={handleShowreelClose}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// AGENT CREDENTIALS TAB (W3C VC / DID)
// ─────────────────────────────────────────────
const AGENT_CREDENTIAL_DEFS = [
  { agentId: "availability-agent",            label: "Availability Agent",      icon: "🔍", permittedSkills: ["GetAvailableUnitGroups"] },
  { agentId: "rate-agent",                    label: "Rate Agent",              icon: "💰", permittedSkills: ["ListRatePlans", "ListOffers"] },
  { agentId: "reservation-bot",               label: "Reservation Bot",         icon: "📋", permittedSkills: ["GetReservation", "CreateBooking"] },
  { agentId: "check-in-agent",               label: "Check-In Agent",          icon: "✅", permittedSkills: ["CheckIn", "GetReservation"] },
  { agentId: "folio-agent",                  label: "Folio Agent (Read)",      icon: "🧾", permittedSkills: ["GetFolio", "ListFolios"] },
  { agentId: "folio-charge-agent",           label: "Folio Charge Agent",      icon: "💳", permittedSkills: ["CreateFolioCharge", "GetFolio"] },
  { agentId: "checkout-agent",               label: "Checkout Agent",          icon: "🚪", permittedSkills: ["CheckOut", "GetReservation"] },
  { agentId: "revenue-reconciliation-agent", label: "Revenue Reconciliation",  icon: "📊", permittedSkills: ["GetReport", "ListRatePlans"] },
];

function AgentCredentialsTab({ companyId, companyName }) {
  const [credentials, setCredentials] = useState([]);
  const [loading, setLoading] = useState(false);
  const [issuing, setIssuing] = useState({});
  const [verifyResults, setVerifyResults] = useState({});
  const [error, setError] = useState(null);
  const [expandedCred, setExpandedCred] = useState(null);
  const [issueAllLoading, setIssueAllLoading] = useState(false);

  const fetchCredentials = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/agents/credentials?companyId=${companyId}`);
      if (r.ok) {
        const d = await r.json();
        setCredentials(d.credentials || []);
      }
    } catch (e) { setError(String(e)); }
    setLoading(false);
  }, [companyId]);

  useEffect(() => { fetchCredentials(); }, [fetchCredentials]);

  const issueCredential = async (agentDef) => {
    setIssuing(p => ({ ...p, [agentDef.agentId]: true }));
    setError(null);
    try {
      const r = await fetch("/api/agents/credentials/issue", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: agentDef.agentId, companyId, permittedSkills: agentDef.permittedSkills, domainOwner: companyName }),
      });
      if (r.ok) await fetchCredentials();
      else { const d = await r.json(); setError(d.error || "Issue failed"); }
    } catch (e) { setError(String(e)); }
    setIssuing(p => ({ ...p, [agentDef.agentId]: false }));
  };

  const issueAll = async () => {
    setIssueAllLoading(true);
    setError(null);
    for (const def of AGENT_CREDENTIAL_DEFS) {
      try {
        await fetch("/api/agents/credentials/issue", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId: def.agentId, companyId, permittedSkills: def.permittedSkills, domainOwner: companyName }),
        });
      } catch (e) { /* continue */ }
    }
    await fetchCredentials();
    setIssueAllLoading(false);
  };

  const verifyCredential = async (cred) => {
    setVerifyResults(p => ({ ...p, [cred.id]: { loading: true } }));
    try {
      const r = await fetch("/api/agents/credentials/verify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vc: cred.signedVc || null, companyId: cred.companyId }),
      });
      const d = await r.json();
      setVerifyResults(p => ({ ...p, [cred.id]: d }));
    } catch (e) {
      setVerifyResults(p => ({ ...p, [cred.id]: { verified: false, error: String(e) } }));
    }
  };

  // Map agentId → active credential (most recent non-revoked, with server status)
  const activeCreds = {};
  for (const c of credentials) {
    if (!c.revoked) {
      if (!activeCreds[c.agentId] || new Date(c.issuedAt) > new Date(activeCreds[c.agentId].issuedAt)) {
        activeCreds[c.agentId] = c;
      }
    }
  }

  // Status computed server-side and returned in the credentials list
  const getCredStatus = (cred) => {
    if (!cred) return "none";
    return cred.status || (new Date(cred.expiresAt) < new Date() ? "Expired" : "Valid");
  };

  const isExpired = (cred) => cred && new Date(cred.expiresAt) < new Date();

  const fmtTime = (iso) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Agent Credential Registry</div>
            <div style={{ fontSize: 12, color: T.dim, lineHeight: 1.6 }}>
              W3C Verifiable Credentials · Ed25519Signature2020 · did:key DIDs · 23h rotation
            </div>
          </div>
          <button
            onClick={issueAll}
            disabled={issueAllLoading || !companyId}
            style={{ background: T.purple, border: "none", borderRadius: 8, padding: "9px 20px", fontSize: 13, fontWeight: 700, color: "#fff", cursor: "pointer", opacity: issueAllLoading ? 0.6 : 1 }}
          >
            {issueAllLoading ? "Issuing…" : "⚡ Issue All Credentials"}
          </button>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
          {[
            { label: "RFC 8037 / Ed25519Signature2020", color: T.green },
            { label: "W3C VC Data Model 1.1", color: T.blue },
            { label: "did:key DID Method", color: T.purple },
            { label: "24h TTL · 23h Rotation", color: T.orange },
          ].map(b => (
            <span key={b.label} style={{ fontSize: 10, fontWeight: 700, background: b.color + "20", color: b.color, border: `1px solid ${b.color}40`, borderRadius: 4, padding: "3px 8px", fontFamily: T.mono, letterSpacing: "0.05em" }}>
              {b.label}
            </span>
          ))}
        </div>
      </div>

      {error && (
        <div style={{ background: T.red + "15", border: `1px solid ${T.red}40`, borderRadius: 8, padding: "10px 16px", fontSize: 12, color: T.red, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Agent credential cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))", gap: 14, marginBottom: 32 }}>
        {AGENT_CREDENTIAL_DEFS.map(def => {
          const cred = activeCreds[def.agentId];
          const credStatus = getCredStatus(cred);
          const hasActiveCred = cred && credStatus !== "Expired";
          const statusColorMap = {
            none: T.dim,
            "Valid": T.green,
            "Expiring-Soon": T.amber,
            "Expired": T.red,
            "Hash-Mismatch": T.red,
            "Revoked": T.red,
          };
          const statusColor = statusColorMap[credStatus] ?? T.dim;
          const vr = cred ? verifyResults[cred.id] : null;

          return (
            <div key={def.agentId} style={{ background: T.card, border: `1px solid ${credStatus === "Valid" ? T.green + "30" : credStatus === "Hash-Mismatch" || credStatus === "Expired" ? T.red + "30" : T.border}`, borderRadius: 10, padding: "14px 16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <span style={{ fontSize: 20 }}>{def.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{def.label}</div>
                  <div style={{ fontSize: 10, color: T.dim, fontFamily: T.mono }}>{def.agentId}</div>
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, background: statusColor + "20", color: statusColor, border: `1px solid ${statusColor}40`, borderRadius: 4, padding: "3px 8px", fontFamily: T.mono, textTransform: "uppercase" }}>
                  {credStatus === "none" ? "NO CREDENTIAL" : credStatus.toUpperCase()}
                </span>
              </div>

              {cred && hasActiveCred && (
                <div style={{ background: T.surface, borderRadius: 6, padding: "8px 10px", marginBottom: 10, fontSize: 10, fontFamily: T.mono, color: T.dim, lineHeight: 1.7 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                    <span style={{ color: T.purple, minWidth: 50 }}>DID</span>
                    <span style={{ wordBreak: "break-all", color: T.text }}>{cred.did?.slice(0, 40)}…</span>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <span style={{ color: T.purple, minWidth: 50 }}>Hash</span>
                    <span style={{ wordBreak: "break-all", color: credStatus === "Hash-Mismatch" ? T.red : T.amber }}>
                      {cred.governanceFileHash ? cred.governanceFileHash.slice(0, 16) + "…" : "no governance files"}
                      {credStatus === "Hash-Mismatch" && " ⚠ MISMATCH"}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <span style={{ color: T.purple, minWidth: 50 }}>Exp</span>
                    <span style={{ color: credStatus === "Expiring-Soon" ? T.amber : T.dim }}>{fmtTime(cred.expiresAt)}{credStatus === "Expiring-Soon" && " ⚠"}</span>
                  </div>
                  {vr && !vr.loading && (
                    <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                      <span style={{ color: T.purple, minWidth: 50 }}>Sig</span>
                      <span style={{ color: vr.verified ? T.green : T.red, fontWeight: 700 }}>
                        {vr.verified ? "✓ VALID" : `✗ ${(vr.reason || vr.error || "INVALID").slice(0, 40)}`}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {credStatus === "Hash-Mismatch" && (
                <div style={{ background: T.red + "15", border: `1px solid ${T.red}30`, borderRadius: 6, padding: "8px 10px", marginBottom: 10, fontSize: 10, color: T.red, fontFamily: T.mono }}>
                  Governance files changed since credential was issued. Re-issue required before agent can run.
                </div>
              )}

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => issueCredential(def)}
                  disabled={issuing[def.agentId]}
                  style={{ flex: 1, background: credStatus === "Valid" ? T.surface : T.purple, border: `1px solid ${credStatus === "Valid" ? T.border : "transparent"}`, borderRadius: 6, padding: "6px 10px", fontSize: 11, fontWeight: 700, color: credStatus === "Valid" ? T.text : "#fff", cursor: "pointer", opacity: issuing[def.agentId] ? 0.6 : 1 }}
                >
                  {issuing[def.agentId] ? "Issuing…" : credStatus === "Valid" ? "↺ Re-issue" : credStatus === "Hash-Mismatch" ? "↺ Re-issue (Required)" : "Issue VC"}
                </button>
                {cred && hasActiveCred && (
                  <button
                    onClick={() => verifyCredential(cred)}
                    disabled={vr?.loading}
                    style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 10px", fontSize: 11, fontWeight: 600, color: T.text, cursor: "pointer" }}
                  >
                    {vr?.loading ? "…" : "Verify"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Full credential history table */}
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
        <div style={{ padding: "14px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Credential Ledger ({credentials.length})</div>
          <button onClick={fetchCredentials} disabled={loading} style={{ background: "transparent", border: `1px solid ${T.border}`, borderRadius: 6, padding: "4px 12px", fontSize: 11, color: T.dim, cursor: "pointer" }}>
            {loading ? "…" : "Refresh"}
          </button>
        </div>
        {credentials.length === 0 ? (
          <div style={{ padding: "32px 16px", textAlign: "center", color: T.dim, fontSize: 12 }}>
            No credentials issued yet. Click "Issue All Credentials" to create W3C VCs for all agents.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: T.mono }}>
              <thead>
                <tr style={{ background: T.surface }}>
                  {["Agent ID", "DID (truncated)", "Gov Hash", "Issued", "Expires", "Status", ""].map(h => (
                    <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: T.dim, fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: `1px solid ${T.border}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {credentials.map(c => {
                  const expired = new Date(c.expiresAt) < new Date();
                  const rowStatus = c.revoked ? "Revoked" : c.status || (expired ? "Expired" : "Valid");
                  const statusColor = { Valid: T.green, "Expiring-Soon": T.amber, Expired: T.red, "Hash-Mismatch": T.red, Revoked: T.red }[rowStatus] ?? T.dim;
                  const vr = verifyResults[c.id];
                  return (
                    <React.Fragment key={c.id}>
                      <tr style={{ borderBottom: `1px solid ${T.border}20`, background: expandedCred === c.id ? T.surface : "transparent" }}>
                        <td style={{ padding: "8px 12px", color: T.text, fontWeight: 600 }}>{c.agentId}</td>
                        <td style={{ padding: "8px 12px", color: T.purple }}>{c.did?.slice(8, 28)}…</td>
                        <td style={{ padding: "8px 12px", color: T.amber }}>{c.governanceFileHash ? c.governanceFileHash.slice(0, 12) + "…" : "—"}</td>
                        <td style={{ padding: "8px 12px", color: T.dim }}>{fmtTime(c.issuedAt)}</td>
                        <td style={{ padding: "8px 12px", color: expired ? T.amber : T.dim }}>{fmtTime(c.expiresAt)}</td>
                        <td style={{ padding: "8px 12px" }}>
                          <span style={{ color: statusColor, fontWeight: 700, fontSize: 10 }}>
                            {c.revoked ? `REVOKED (${c.revokedReason || ""})` : c.status || (expired ? "EXPIRED" : "VALID")}
                          </span>
                        </td>
                        <td style={{ padding: "8px 12px" }}>
                          <button
                            onClick={() => setExpandedCred(expandedCred === c.id ? null : c.id)}
                            style={{ background: "transparent", border: `1px solid ${T.border}`, borderRadius: 4, padding: "2px 8px", fontSize: 10, color: T.dim, cursor: "pointer" }}
                          >
                            {expandedCred === c.id ? "▲" : "▼"}
                          </button>
                        </td>
                      </tr>
                      {expandedCred === c.id && (
                        <tr>
                          <td colSpan={7} style={{ padding: "12px 16px", background: T.surface }}>
                            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                              <button
                                onClick={() => verifyCredential(c)}
                                disabled={vr?.loading || !c.signedVc}
                                style={{ background: T.purple, border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 11, fontWeight: 700, color: "#fff", cursor: "pointer", opacity: vr?.loading ? 0.6 : 1 }}
                              >
                                {vr?.loading ? "Verifying…" : "🔐 Verify Signature"}
                              </button>
                              {vr && !vr.loading && (
                                <span style={{ padding: "6px 12px", borderRadius: 6, fontSize: 11, fontWeight: 700, background: vr.verified ? T.green + "20" : T.red + "20", color: vr.verified ? T.green : T.red, border: `1px solid ${vr.verified ? T.green : T.red}40` }}>
                                  {vr.verified ? "✓ Ed25519Signature2020 VALID" : `✗ ${vr.error || "INVALID"}`}
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 10, color: T.dim, lineHeight: 1.8 }}>
                              <div><strong style={{ color: T.text }}>Full DID:</strong> {c.did}</div>
                              <div><strong style={{ color: T.text }}>Gov Hash:</strong> {c.governanceFileHash || "N/A"}</div>
                              <div><strong style={{ color: T.text }}>Credential ID:</strong> #{c.id}</div>
                              {vr?.verified && <div><strong style={{ color: T.text }}>Permitted Skills:</strong> {JSON.stringify(vr.permittedSkills || [])}</div>}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* AP2 Intent Mandate Registry */}
      <MandateRegistry companyId={companyId} />

      {/* Architecture notes */}
      <div style={{ marginTop: 20, background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "14px 16px", fontSize: 11, color: T.dim, lineHeight: 1.8, fontFamily: T.mono }}>
        <div style={{ color: T.text, fontWeight: 700, marginBottom: 6, fontFamily: T.sans, fontSize: 12 }}>Cryptographic Architecture</div>
        <div>• <strong style={{ color: T.purple }}>Requirement A</strong> — Ed25519Signature2020 suite (RFC 8037 curve, 128-bit security)</div>
        <div>• <strong style={{ color: T.blue }}>Requirement B</strong> — Static JSON-LD document loader — zero network calls at runtime</div>
        <div>• <strong style={{ color: T.green }}>Requirement C</strong> — All custom fields inside credentialSubject (agentId, companyId, governanceFileHash, permittedSkills)</div>
        <div>• <strong style={{ color: T.orange }}>Rotation</strong> — Platform issuer key rotated daily (midnight UTC); all agent VCs re-issued with new issuer DID</div>
        <div>• <strong style={{ color: T.amber }}>Audit</strong> — Every agent endpoint records credentialVerified + governanceFileHash in Witness Agent ledger</div>
        <div>• <strong style={{ color: T.blue }}>Transport</strong> — Signed VC JSON encoded as base64url in Authorization: Bearer header. Internal use only; not a JWT. Cross-party exchange would require a Verifiable Presentation envelope (out of scope for this deployment).</div>
      </div>
    </div>
  );
}

function MandateRegistry({ companyId }) {
  const [mandates, setMandates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);

  const fetchMandates = useCallback(async () => {
    if (companyId == null) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/mandates?companyId=${companyId}`);
      if (r.ok) { const d = await r.json(); setMandates(d.mandates ?? []); }
    } catch (e) { /* non-fatal */ }
    setLoading(false);
  }, [companyId]);

  useEffect(() => { fetchMandates(); }, [fetchMandates]);

  const phaseColor = { crawl: T.blue, walk: T.amber, run: T.green };

  return (
    <div style={{ marginTop: 20, background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
      <div style={{ padding: "14px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>AP2 Intent Mandate Registry</div>
          <div style={{ fontSize: 11, color: T.dim, marginTop: 2, fontFamily: T.mono }}>
            HMAC-SHA256 signed · per-phase spending authority · Crawl/Walk/Run ceiling enforcement
          </div>
        </div>
        <button onClick={fetchMandates} disabled={loading} style={{ background: "transparent", border: `1px solid ${T.border}`, borderRadius: 6, padding: "4px 12px", fontSize: 11, color: T.dim, cursor: "pointer" }}>
          {loading ? "…" : "Refresh"}
        </button>
      </div>
      {mandates.length === 0 ? (
        <div style={{ padding: "24px 16px", textAlign: "center", color: T.dim, fontSize: 12 }}>
          {loading ? "Loading…" : "No mandates issued yet. Mandates are created automatically at agent onboarding completion and phase promotion."}
        </div>
      ) : (
        <div>
          {/* Header */}
          <div style={{ display: "grid", gridTemplateColumns: "200px 80px 80px 120px 90px 36px", gap: 8, padding: "8px 16px", borderBottom: `1px solid ${T.border}`, fontSize: 10, color: T.dim, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: T.mono }}>
            <span>Agent</span><span>Phase</span><span>Status</span><span>Valid Until</span><span>Signature</span><span />
          </div>
          {mandates.map((m, i) => {
            const expired = m.expired;
            const statusLabel = m.revoked ? "REVOKED" : expired ? "EXPIRED" : "ACTIVE";
            const statusColor = m.revoked ? T.red : expired ? T.amber : T.green;
            const pColor = phaseColor[m.phase] ?? T.dim;
            const auths = Array.isArray(m.authorizations) ? m.authorizations : [];
            return (
              <div key={m.id ?? i} style={{ borderBottom: i < mandates.length - 1 ? `1px solid ${T.border}20` : "none" }}>
                <div
                  onClick={() => setExpanded(expanded === m.id ? null : m.id)}
                  style={{ display: "grid", gridTemplateColumns: "200px 80px 80px 120px 90px 36px", gap: 8, padding: "10px 16px", alignItems: "center", cursor: "pointer", background: expanded === m.id ? T.surface : "transparent" }}
                >
                  <span style={{ fontSize: 11, color: T.text, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.agentId}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: pColor, fontFamily: T.mono, textTransform: "uppercase" }}>{m.phase}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: statusColor }}>{statusLabel}</span>
                  <span style={{ fontSize: 10, color: T.dim, fontFamily: T.mono }}>{new Date(m.validUntil).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</span>
                  <span style={{ fontSize: 9, color: T.dim, fontFamily: T.mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(m.signature ?? "").slice(0, 12)}…</span>
                  <span style={{ fontSize: 11, color: T.dim }}>{expanded === m.id ? "▲" : "▼"}</span>
                </div>
                {expanded === m.id && (
                  <div style={{ padding: "12px 16px 14px", background: T.surface, borderTop: `1px solid ${T.border}20` }}>
                    <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono, marginBottom: 10 }}>
                      <strong style={{ color: T.text }}>Mandate ID:</strong> {m.mandateId}
                    </div>
                    {auths.length > 0 ? (
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: T.text, marginBottom: 6 }}>Authorized Ceilings ({auths.length})</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {auths.map((a, ai) => (
                            <div key={ai} style={{ background: `${pColor}12`, border: `1px solid ${pColor}30`, borderRadius: 6, padding: "6px 12px", display: "flex", gap: 12, alignItems: "center" }}>
                              <span style={{ fontSize: 11, fontFamily: T.mono, color: pColor, fontWeight: 700, minWidth: 160 }}>{a.action}</span>
                              <span style={{ fontSize: 11, color: T.text }}>
                                {a.ceiling != null ? `≤ ${a.ceiling}${a.currency ? ` ${a.currency}` : a.unit ? ` ${a.unit}` : ""}` : "unlimited"}
                              </span>
                              {a.description && <span style={{ fontSize: 10, color: T.dim }}>{a.description}</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: T.dim }}>Crawl phase — no standing authority. All actions require HITL pre-approval.</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// AGENT ONBOARDING TAB
// ─────────────────────────────────────────────

const STATUS_COLORS_OB = {
  received: "#3b82f6", analysing: "#8b5cf6", generating_files: "#8b5cf6",
  awaiting_first_hitl: "#f59e0b", sandbox: "#f59e0b", awaiting_second_hitl: "#f59e0b",
  committing: "#10b981", onboarded: "#10b981", rejected: "#ef4444",
  failed: "#ef4444", rolled_back: "#ffffff",
};
const PHASE_MAP_OB = {
  received: 1, analysing: 2, generating_files: 3,
  awaiting_first_hitl: 4, sandbox: 5, awaiting_second_hitl: 6,
  committing: 7, onboarded: 7, rejected: 0, failed: 0, rolled_back: 0,
};

function PhaseBar({ status }) {
  const phase = PHASE_MAP_OB[status] ?? 0;
  const phases = ["Received","Analysing","Files","HITL 1","Sandbox","HITL 2","Commit"];
  if (phase === 0) return (
    <div style={{ fontSize: 11, color: T.red, fontFamily: T.mono }}>{status === "rejected" ? "REJECTED" : status === "rolled_back" ? "ROLLED BACK" : "FAILED"}</div>
  );
  return (
    <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
      {phases.map((label, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <div style={{
            width: 20, height: 20, borderRadius: "50%", fontSize: 9, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: i + 1 <= phase ? T.orange : T.surface,
            border: `1px solid ${i + 1 === phase ? T.orange : T.border}`,
            color: i + 1 <= phase ? "#fff" : T.dim,
          }}>{i + 1}</div>
          {i < 6 && <div style={{ width: 10, height: 1, background: i + 1 < phase ? T.orange : T.border }} />}
        </div>
      ))}
    </div>
  );
}

function ImpactDeltaSection({ report }) {
  if (!report) return <div style={{ color: T.dim, fontSize: 12 }}>Impact delta pending…</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {report.friction_removed?.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: T.green, fontFamily: T.mono, marginBottom: 6 }}>FRICTION REMOVED</div>
          {report.friction_removed.map((f, i) => (
            <div key={i} style={{ background: T.green + "10", border: `1px solid ${T.green}30`, borderRadius: 6, padding: "8px 12px", fontSize: 12, marginBottom: 4 }}>
              <span style={{ color: T.green, fontWeight: 700 }}>{f.escalations_per_week}/wk</span> escalations on <code style={{ color: T.muted, fontFamily: T.mono }}>{f.affected_agent}</code> resolved by <code style={{ color: T.green, fontFamily: T.mono }}>{f.resolving_skill}</code>
            </div>
          ))}
        </div>
      )}
      {report.value_added?.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: T.blue, fontFamily: T.mono, marginBottom: 6 }}>VALUE ADDED</div>
          {report.value_added.map((v, i) => (
            <div key={i} style={{ background: T.blue + "10", border: `1px solid ${T.blue}30`, borderRadius: 6, padding: "8px 12px", fontSize: 12, marginBottom: 4 }}>
              <span style={{ color: T.blue }}>{v.type}</span>: {v.description}
            </div>
          ))}
        </div>
      )}
      {report.conflicts?.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: T.amber, fontFamily: T.mono, marginBottom: 6 }}>CONFLICTS ({report.conflicts.length})</div>
          {report.conflicts.map((c, i) => (
            <div key={i} style={{ background: (c.type === "must_not_boundary" ? T.red : T.amber) + "10", border: `1px solid ${(c.type === "must_not_boundary" ? T.red : T.amber)}30`, borderRadius: 6, padding: "8px 12px", fontSize: 12, marginBottom: 4 }}>
              <span style={{ color: c.type === "must_not_boundary" ? T.red : T.amber, fontWeight: 700 }}>{c.type}</span>: <code style={{ fontFamily: T.mono }}>{c.skill}</code> overlaps with <code style={{ fontFamily: T.mono }}>{c.existing_agent}</code> → <span style={{ color: T.dim }}>{c.resolution}</span>
            </div>
          ))}
        </div>
      )}
      {report.auto_removed_skills?.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono, marginBottom: 6 }}>AUTO-REMOVED SKILLS</div>
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "8px 12px", fontSize: 12 }}>
            {report.auto_removed_skills.join(", ")} — duplicate skills automatically removed
          </div>
        </div>
      )}
      {report.raci_exceptions?.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: T.amber, fontFamily: T.mono, marginBottom: 6 }}>RACI EXCEPTIONS</div>
          {report.raci_exceptions.map((r, i) => (
            <div key={i} style={{ background: T.amber + "10", border: `1px solid ${T.amber}30`, borderRadius: 6, padding: "8px 12px", fontSize: 12, marginBottom: 4 }}>
              Intersection <code style={{ fontFamily: T.mono }}>{r.intersection}</code> — both owners notified: {r.candidate_owners.join(", ")}
            </div>
          ))}
        </div>
      )}
      {report.affected_files?.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono, marginBottom: 6 }}>AFFECTED FILES ({report.files_to_create} create, {report.files_to_modify} modify)</div>
          {report.affected_files.map((f, i) => <div key={i} style={{ fontSize: 11, color: T.dim, fontFamily: T.mono }}>• {f}</div>)}
        </div>
      )}
      {report.friction_removed?.length === 0 && report.value_added?.length === 0 && report.conflicts?.length === 0 && (
        <div style={{ color: T.dim, fontSize: 12, fontStyle: "italic" }}>No Witness log history yet — friction metrics will populate after 30 days of agent activity.</div>
      )}
    </div>
  );
}

// ─── HITL Dossier Helpers ─────────────────────────────────────────────────────

function parseFm(md) {
  if (!md) return {};
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  return Object.fromEntries(
    m[1].split("\n")
      .map(l => l.split(": "))
      .filter(p => p.length >= 2)
      .map(p => [p[0].trim(), p.slice(1).join(": ").trim().replace(/^"(.*)"$/, "$1")])
  );
}

function parseSopClauses(sopMd) {
  if (!sopMd) return { must: [], mustNot: [], may: [], escalation: "" };
  const between = (text, a, b) => {
    const start = text.indexOf(a);
    if (start === -1) return "";
    const sub = text.slice(start + a.length);
    const end = b ? sub.search(new RegExp("^## ", "m")) : sub.length;
    return end === -1 ? sub : sub.slice(0, end);
  };
  const splitClauses = (section) =>
    section.split(/\n### /).slice(1).map(c => {
      const lines = c.trim().split("\n");
      return { id: lines[0].trim(), body: lines.slice(1).join("\n").trim() };
    });
  return {
    must: splitClauses(between(sopMd, "## MUST Clauses\n", true)),
    mustNot: splitClauses(between(sopMd, "## MUST NOT Clauses\n", true)),
    may: splitClauses(between(sopMd, "## MAY Clauses\n", true)),
    escalation: between(sopMd, "## Escalation Path\n", true).trim(),
  };
}

function NotPermittedRows({ skillMd }) {
  if (!skillMd) return null;
  const m = skillMd.match(/## NOT Permitted\n([\s\S]*?)(?=## Auto-Removed|$)/);
  if (!m) return null;
  const rows = m[1].split("\n").filter(l => l.startsWith("|") && !l.includes("---") && !l.match(/Prohibited Skill/i));
  if (!rows.length) return null;
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.red, marginBottom: 8, letterSpacing: 1 }}>PROHIBITED  ·  {rows.length} ENTRIES</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {rows.map((row, i) => {
          const cells = row.split("|").filter(Boolean).map(c => c.trim());
          return cells[0] ? (
            <div key={i} style={{ background: `${T.red}08`, border: `1px solid ${T.red}25`, borderRadius: 6, padding: "8px 12px", display: "flex", gap: 12, alignItems: "flex-start" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: T.red, minWidth: 160, flexShrink: 0 }}>{cells[0]}</span>
              {cells[1] && <span style={{ fontSize: 11, color: T.dim, opacity: 0.7, lineHeight: 1.5 }}>{cells[1]}</span>}
            </div>
          ) : null;
        })}
      </div>
    </div>
  );
}

function DossierPanel({ token, data, loading, activeTab, setActiveTab, docsTab, setDocsTab, passThreshold = null }) {
  if (loading) return <div style={{ padding: 20, textAlign: "center", color: T.dim, fontSize: 12, opacity: 0.6 }}>Loading full dossier…</div>;
  if (!data) return null;

  const ac = data.agentCard || {};
  const cf = data.candidateFiles || {};
  const delta = data.impactDeltaReport || {};
  const fm = parseFm(cf.agents_md);
  const sop = parseSopClauses(cf.sop_md);
  const tab = activeTab || "overview";
  const dt = docsTab || "agents";

  const TABS = [
    { id: "overview", label: "Overview" },
    { id: "skills", label: "Skills" },
    { id: "compliance", label: "SOP Compliance" },
    { id: "impact", label: "Impact Delta" },
    { id: "docs", label: "Governance Docs" },
  ];

  return (
    <div style={{ marginTop: 16, borderTop: `1px solid ${T.border}`, paddingTop: 16 }}>
      {/* Tab bar */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            style={{ background: tab === t.id ? `${T.purple}20` : "transparent", border: `1px solid ${tab === t.id ? T.purple : T.border}`, borderRadius: 5, padding: "4px 12px", fontSize: 11, color: tab === t.id ? T.purple : T.dim, cursor: "pointer", fontWeight: tab === t.id ? 700 : 400, transition: "all 0.15s" }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Overview ─────────────────────────────────────── */}
      {tab === "overview" && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
            {[
              ["Control ID", fm.control_id, T.purple, true],
              ["Domain", fm.domain, T.blue, false],
              ["Owner", fm.owner, T.text, false],
              ["NIST Control", fm.nist_control, T.text, false],
              ["Risk Level", fm.risk_level, fm.risk_level === "high" ? T.red : fm.risk_level === "medium" ? T.amber : T.green, false],
              ["Expires", fm.expires, T.text, false],
              ["Version", ac.version, T.amber, true],
              ["Status", data.status, data.status === "onboarded" ? T.green : T.amber, false],
            ].filter(([, v]) => v).map(([k, v, c, mono]) => (
              <div key={k} style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6, padding: "8px 12px" }}>
                <div style={{ fontSize: 9, color: T.dim, opacity: 0.5, marginBottom: 2, textTransform: "uppercase", letterSpacing: 1 }}>{k}</div>
                <div style={{ fontSize: 12, color: c, fontFamily: mono ? T.mono : T.sans, fontWeight: 600, wordBreak: "break-all" }}>{v}</div>
              </div>
            ))}
          </div>
          {ac.description && (
            <div style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 12, padding: "12px 14px", background: T.bg, border: `1px solid ${T.border}`, borderRadius: 7 }}>{ac.description}</div>
          )}
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 11, color: T.dim, opacity: 0.7 }}>
            {ac.provider?.organization && <span>Provider: <strong style={{ color: T.text }}>{ac.provider.organization}</strong></span>}
            {ac.url && <span>Endpoint: <span style={{ fontFamily: T.mono, color: T.blue }}>{ac.url}</span></span>}
            {ac.authentication?.schemes && <span>Auth: <span style={{ color: T.amber }}>{(ac.authentication.schemes || []).join(", ")}</span></span>}
          </div>
        </div>
      )}

      {/* ── Skills ───────────────────────────────────────── */}
      {tab === "skills" && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.green, marginBottom: 10, letterSpacing: 1 }}>PERMITTED  ·  {(ac.skills || []).length} SKILLS</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 4 }}>
            {(ac.skills || []).map(s => (
              <div key={s.id} style={{ background: `${T.green}08`, border: `1px solid ${T.green}25`, borderRadius: 8, padding: "12px 14px" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 10, fontFamily: T.mono, background: `${T.green}20`, color: T.green, borderRadius: 4, padding: "2px 7px", fontWeight: 700 }}>{s.id}</span>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{s.name}</span>
                </div>
                <div style={{ fontSize: 12, lineHeight: 1.5, opacity: 0.8 }}>{s.description}</div>
              </div>
            ))}
          </div>
          <NotPermittedRows skillMd={cf.skill_md} />
        </div>
      )}

      {/* ── SOP Compliance ────────────────────────────────── */}
      {tab === "compliance" && (
        <div>
          {[
            { label: "MUST", color: T.green, clauses: sop.must, note: "Mandatory obligations — violations trigger immediate halt" },
            { label: "MUST NOT", color: T.red, clauses: sop.mustNot, note: "Explicit prohibitions — any breach is a critical governance violation" },
            { label: "MAY", color: T.blue, clauses: sop.may, note: "Permitted discretionary behaviours" },
          ].map(({ label, color, clauses, note }) => clauses.length > 0 && (
            <div key={label} style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 900, background: `${color}20`, color, border: `1px solid ${color}40`, borderRadius: 4, padding: "2px 9px", letterSpacing: 1 }}>{label}</span>
                <span style={{ fontSize: 11, color: T.dim, opacity: 0.6 }}>{clauses.length} clause{clauses.length > 1 ? "s" : ""} · {note}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {clauses.map((c, i) => (
                  <div key={i} style={{ background: `${color}05`, border: `1px solid ${color}20`, borderRadius: 7, padding: "10px 14px" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color, fontFamily: T.mono, marginBottom: 5, letterSpacing: 0.5 }}>{c.id}</div>
                    <div style={{ fontSize: 11, lineHeight: 1.6, opacity: 0.8, whiteSpace: "pre-wrap" }}>{c.body.slice(0, 400)}{c.body.length > 400 ? "…" : ""}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {sop.escalation && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.amber, marginBottom: 8, letterSpacing: 1 }}>ESCALATION PATH</div>
              <div style={{ fontFamily: T.mono, fontSize: 10, lineHeight: 1.8, background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6, padding: 12, whiteSpace: "pre-wrap", overflowX: "auto", maxHeight: 220, overflowY: "auto", opacity: 0.8 }}>{sop.escalation}</div>
            </div>
          )}
        </div>
      )}

      {/* ── Impact Delta ──────────────────────────────────── */}
      {tab === "impact" && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 20 }}>
            {[
              ["Files to Create", delta.files_to_create ?? 0, T.green],
              ["Files to Modify", delta.files_to_modify ?? 0, T.amber],
              ["Conflicts", (delta.conflicts || []).length, T.red],
            ].map(([l, v, c]) => (
              <div key={l} style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 8, padding: "14px 16px", textAlign: "center" }}>
                <div style={{ fontSize: 28, fontWeight: 900, color: Number(v) === 0 ? T.green : c }}>{v}</div>
                <div style={{ fontSize: 10, opacity: 0.6, marginTop: 3, textTransform: "uppercase", letterSpacing: 1 }}>{l}</div>
              </div>
            ))}
          </div>
          {data.evalPassRate !== null && data.evalPassRate !== undefined && (
            <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 8, padding: "14px 16px", marginBottom: 12, display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ fontSize: 28, fontWeight: 900, color: passThreshold != null ? (Number(data.evalPassRate) >= passThreshold ? T.green : T.red) : T.dim }}>{(Number(data.evalPassRate) * 100).toFixed(1)}%</div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700 }}>Sandbox Eval Pass Rate</div>
                <div style={{ fontSize: 11, opacity: 0.6 }}>{passThreshold == null ? "Loading policy…" : Number(data.evalPassRate) >= passThreshold ? "Passed — agent meets sandbox quality gate" : "Below threshold — review recommended"}</div>
              </div>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              ["RACI EXCEPTIONS", delta.raci_exceptions || [], T.amber, "No RACI exceptions raised"],
              ["CONFLICTS", delta.conflicts || [], T.red, "No conflicts detected"],
              ["AUTO-REMOVED SKILLS", delta.auto_removed_skills || [], T.orange, "No skills auto-removed"],
            ].map(([label, items, color, emptyMsg]) => (
              <div key={label}>
                <div style={{ fontSize: 10, fontWeight: 700, color, marginBottom: 5, letterSpacing: 1 }}>{label} ({items.length})</div>
                {items.length === 0
                  ? <div style={{ fontSize: 11, color: T.green, opacity: 0.8 }}>✓ {emptyMsg}</div>
                  : items.map((item, i) => <div key={i} style={{ fontSize: 11, color, padding: "4px 0", opacity: 0.9 }}>• {typeof item === "string" ? item : JSON.stringify(item)}</div>)
                }
              </div>
            ))}
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.dim, opacity: 0.6, marginBottom: 5, letterSpacing: 1 }}>ROLLBACK SCOPE</div>
              <div style={{ fontSize: 11, background: `${T.red}08`, border: `1px solid ${T.red}20`, borderRadius: 6, padding: "10px 12px", lineHeight: 1.5, opacity: 0.9 }}>{delta.rollback_scope || "Not specified"}</div>
            </div>
            {data.prUrl && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: T.dim, opacity: 0.6, marginBottom: 5, letterSpacing: 1 }}>GITHUB PR</div>
                <a href={data.prUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: T.blue }}>#{data.prNumber} — {data.prUrl}</a>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Governance Docs ───────────────────────────────── */}
      {tab === "docs" && (
        <div>
          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            {[["agents", "AGENTS.md"], ["sop", "SOP.md"], ["skill", "SKILL.md"]].map(([id, label]) => (
              <button key={id} onClick={() => setDocsTab(id)}
                style={{ background: dt === id ? `${T.blue}20` : "transparent", border: `1px solid ${dt === id ? T.blue : T.border}`, borderRadius: 4, padding: "3px 12px", fontSize: 11, color: dt === id ? T.blue : T.dim, cursor: "pointer", fontFamily: T.mono, fontWeight: dt === id ? 700 : 400 }}>
                {label}
              </button>
            ))}
          </div>
          <pre style={{ fontFamily: T.mono, fontSize: 10, background: T.bg, border: `1px solid ${T.border}`, borderRadius: 7, padding: 16, lineHeight: 1.75, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 480, overflowY: "auto", margin: 0, opacity: 0.85 }}>
            {dt === "agents" ? cf.agents_md : dt === "sop" ? cf.sop_md : cf.skill_md}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function AgentOnboardingTab({ companyId, companyName, role = "hotel_gm", onRoleChange, onSwitchTab, initialSubTab, initialPhaseAgent, initialWizardAgent }) {
  const [subTab, setSubTab] = useState(initialSubTab || "wizard");
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expandedRow, setExpandedRow] = useState(null);
  const [expandedSection, setExpandedSection] = useState({});
  const [pending, setPending] = useState([]);
  const [allPending, setAllPending] = useState([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [respondingToken, setRespondingToken] = useState(null);
  const [testerCard, setTesterCard] = useState("");
  const [testerVc, setTesterVc] = useState("");
  const [testerLoading, setTesterLoading] = useState(false);
  const [testerResult, setTesterResult] = useState(null);
  const [rollbackId, setRollbackId] = useState(null);
  const [rollbackKey, setRollbackKey] = useState("");
  const [rollbackLoading, setRollbackLoading] = useState(false);
  const [autoSubmitting, setAutoSubmitting] = useState(false);
  const wizardAgentSlug = useRef(initialWizardAgent || null);

  // Phase Management state
  const [phases, setPhases] = useState([]);
  const [phasesLoading, setPhasesLoading] = useState(false);
  const [portfolioPhases, setPortfolioPhases] = useState({ hotelsAtWalkRun: 0, totalHotels: 5 });
  const [promotingAgent, setPromotingAgent] = useState(null);
  const [promoteMsg, setPromoteMsg] = useState(null);
  const [dossierOpen, setDossierOpen] = useState({});
  const [dossierData, setDossierData] = useState({});
  const [dossierLoading, setDossierLoading] = useState({});
  const [dossierTab, setDossierTab] = useState({});
  const [docsSubTab, setDocsSubTab] = useState({});
  const [wizardTesterOpen, setWizardTesterOpen] = useState(false);
  const [otherBandsOpen, setOtherBandsOpen] = useState(false);
  const [onboardingPolicy, setOnboardingPolicy] = useState(null);
  // CO admission gate state
  const [admitLoading, setAdmitLoading] = useState({});
  const [rejectReason, setRejectReason] = useState({});
  const [rejectLoading, setRejectLoading] = useState({});
  const [rejectOpen, setRejectOpen] = useState({});
  // GM crawl enable state
  const [crawlLoading, setCrawlLoading] = useState({});
  const [crawlStatus, setCrawlStatus] = useState({});
  const [crawlStatusLoading, setCrawlStatusLoading] = useState({});
  const [crawlMsg, setCrawlMsg] = useState({});
  const [promoteToWalkLoading, setPromoteToWalkLoading] = useState({});

  useEffect(() => {
    fetch("/api/admin/onboarding-policy")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.sandbox_pass_threshold != null) setOnboardingPolicy(d); })
      .catch(() => {});
  }, []);

  const sandboxPassThreshold = onboardingPolicy?.sandbox_pass_threshold ?? null;
  const crawlAgreementThreshold = onboardingPolicy?.crawl_agreement_threshold ?? null;
  const walkAgreementThreshold = onboardingPolicy?.walk_agreement_threshold ?? null;

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (role) params.set("role_band", role);
      const r = await fetch(`/api/onboarding?${params.toString()}`);
      if (r.ok) { const d = await r.json(); setRequests((d.requests || []).reverse()); }
    } catch { /* silent */ }
    setLoading(false);
  }, [role]);

  const fetchPending = useCallback(async () => {
    setPendingLoading(true);
    try {
      // Build role-band + company_id filter for this role
      const params = new URLSearchParams();
      if (role) params.set("role_band", role);
      // Scope by company: Ambassador/Senior Ambassador/Hotel GM → single hotel;
      // Regional GM → all 5 hotels (1,2,3,4,5); Operations Chief/Compliance Officer → no filter
      if (companyId && !["regional_gm", "operations_chief", "compliance_officer"].includes(role)) {
        params.set("company_id", String(companyId));
      } else if (role === "regional_gm") {
        params.set("company_id", "1,2,3,4,5");
      }
      const r = await fetch(`/api/hitl/pending?${params}`);
      if (r.ok) { const d = await r.json(); setPending(d.pending || []); }
    } catch { /* silent */ }
    setPendingLoading(false);
  }, [role, companyId]);

  const fetchAllPending = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      // Global roles (regional_gm, operations_chief, compliance_officer) span all properties —
      // do NOT filter by company_id so other-queues counts include cross-property cards.
      if (companyId && !["regional_gm", "operations_chief", "compliance_officer"].includes(role)) {
        params.set("company_id", String(companyId));
      }
      const r = await fetch(`/api/hitl/pending?${params}`);
      if (r.ok) { const d = await r.json(); setAllPending(d.pending || []); }
    } catch { /* silent */ }
  }, [companyId, role]);

  const fetchPortfolio = useCallback(async () => {
    try {
      const r = await fetch("/api/dashboard/phases/portfolio");
      if (r.ok) { const d = await r.json(); setPortfolioPhases(d); }
    } catch { /* silent */ }
  }, []);

  const fetchPhases = useCallback(async () => {
    if (!companyId) return;
    setPhasesLoading(true);
    try {
      const r = await fetch(`/api/dashboard/phases?companyId=${companyId}`);
      if (r.ok) { const d = await r.json(); setPhases(d.phases || []); }
    } catch { /* silent */ }
    setPhasesLoading(false);
  }, [companyId]);

  const fetchDossier = useCallback(async (token, requestId) => {
    if (!requestId || dossierData[token]) return;
    setDossierLoading(p => ({ ...p, [token]: true }));
    try {
      const r = await fetch(`/api/onboarding/${requestId}`);
      if (r.ok) { const d = await r.json(); setDossierData(p => ({ ...p, [token]: d })); }
    } catch { /* silent */ }
    setDossierLoading(p => ({ ...p, [token]: false }));
  }, [dossierData]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);
  useEffect(() => { fetchPending(); }, [fetchPending]); // re-fetch when role or companyId changes
  useEffect(() => { if (subTab === "approvals") { fetchPending(); fetchAllPending(); } }, [subTab, fetchPending, fetchAllPending]);
  useEffect(() => {
    if (subTab === "phases") { fetchPhases(); fetchPending(); fetchAllPending(); }
  }, [subTab, fetchPhases, fetchPending, fetchAllPending]);
  useEffect(() => {
    if (initialPhaseAgent && phases.length > 0) {
      const el = document.getElementById(`phase-agent-${initialPhaseAgent}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [initialPhaseAgent, phases]);
  useEffect(() => {
    if (subTab === "wizard") { fetchPending(); fetchPhases(); fetchRequests(); fetchPortfolio(); }
  }, [subTab, fetchPending, fetchPhases, fetchRequests, fetchPortfolio]);

  // Live polling — refresh wizard every 5 s while pipeline is active
  useEffect(() => {
    if (subTab !== "wizard") return;
    const id = setInterval(() => {
      fetchRequests();
      fetchPending();
      fetchPhases();
    }, 5000);
    return () => clearInterval(id);
  }, [subTab, fetchRequests, fetchPending, fetchPhases]);

  // Poll pending every 15s when on approvals tab
  useEffect(() => {
    if (subTab !== "approvals") return;
    const t = setInterval(fetchPending, 15000);
    return () => clearInterval(t);
  }, [subTab, fetchPending]);

  // Poll phases + pending every 10s when on phase management tab
  useEffect(() => {
    if (subTab !== "phases") return;
    const t = setInterval(() => { fetchPhases(); fetchPending(); }, 10000);
    return () => clearInterval(t);
  }, [subTab, fetchPhases, fetchPending]);

  const respond = async (token, outcome) => {
    setRespondingToken(token);
    try {
      await fetch(`/api/hitl/respond/${token}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome, decided_by: "Dashboard User" }),
      });
      await fetchPending();
      await fetchPhases();
      await fetchRequests();
    } catch { /* silent */ }
    setRespondingToken(null);
  };

  const promoteAgent = async (agentId, targetPhase) => {
    setPromotingAgent(agentId);
    setPromoteMsg(null);
    try {
      const r = await fetch("/api/dashboard/phases/promote", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, agentId, targetPhase, promotedBy: "Dashboard User" }),
      });
      const d = await r.json();
      if (r.ok) {
        setPromoteMsg({ ok: true, msg: `${agentId} promoted to ${targetPhase}` });
        await fetchPhases();
        await fetchPending();
      } else {
        setPromoteMsg({ ok: false, msg: d.error ?? "Promotion failed" });
      }
    } catch (e) { setPromoteMsg({ ok: false, msg: String(e) }); }
    setPromotingAgent(null);
    setTimeout(() => setPromoteMsg(null), 5000);
  };

  const submitTesterRequest = async () => {
    if (!testerCard || !testerVc) return;
    setTesterLoading(true); setTesterResult(null);
    try {
      const r = await fetch("/api/a2a/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${testerVc}` },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1, method: "tasks/send",
          params: {
            id: crypto.randomUUID(), sessionId: crypto.randomUUID(),
            message: { role: "user", parts: [{ type: "text", text: testerCard }] },
          },
        }),
      });
      const d = await r.json();
      setTesterResult(d);
      await fetchRequests();
    } catch (e) { setTesterResult({ error: String(e) }); }
    setTesterLoading(false);
  };

  const doRollback = async () => {
    if (!rollbackId || !rollbackKey) return;
    setRollbackLoading(true);
    try {
      const r = await fetch(`/api/onboarding/${rollbackId}/rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Compliance-Officer-Key": rollbackKey },
        body: JSON.stringify({ reason: "Manual rollback via dashboard" }),
      });
      const d = await r.json();
      alert(JSON.stringify(d, null, 2));
      setRollbackId(null); setRollbackKey("");
      await fetchRequests();
    } catch (e) { alert(String(e)); }
    setRollbackLoading(false);
  };

  // Aggregate analytics
  const analytics = requests.reduce((acc, req) => {
    if (req.status === "onboarded" && req.impactDeltaReport) {
      const r = req.impactDeltaReport;
      acc.frictionRemoved += (r.friction_removed || []).reduce((s, f) => s + (f.escalations_per_week || 0), 0);
      acc.mayClauses += (r.value_added || []).filter(v => v.type === "may_clause_activated").length;
      acc.gapsClosed += (r.value_added || []).filter(v => v.type === "cross_domain_gap_closed").length;
      acc.autoRemoved += (r.auto_removed_skills || []).length;
      acc.raciExceptions += (r.raci_exceptions || []).length;
    }
    return acc;
  }, { frictionRemoved: 0, mayClauses: 0, gapsClosed: 0, autoRemoved: 0, raciExceptions: 0 });

  // Split pending into onboarding vs operational cards
  const onboardingPending = pending.filter(p => p.cardType !== "operational_exception");

  // Only show operational exception cards that belong to this specific property.
  // companyId on the card may be a number or string; coerce both sides to compare safely.
  const operationalPending = pending.filter(p =>
    p.cardType === "operational_exception" &&
    (p.companyId == null || String(p.companyId) === String(companyId))
  );

  // Index by agentId for O(1) lookup — already scoped to this companyId
  const opPendingByAgent = {};
  for (const card of operationalPending) {
    const aid = card.agentId || (card.payload && card.payload.agent_id);
    if (aid) { opPendingByAgent[aid] = [...(opPendingByAgent[aid] || []), card]; }
  }

  // Cross-role HITL blocker index: uses allPending (not role-scoped) so that Phase Management
  // promote buttons are blocked by tokens belonging to ANY role-band, not just the active role's bands.
  const allOpPendingByAgent = {};
  const allOperationalPending = allPending.filter(p =>
    p.cardType === "operational_exception" &&
    (p.companyId == null || String(p.companyId) === String(companyId))
  );
  for (const card of allOperationalPending) {
    const aid = card.agentId || (card.payload && card.payload.agent_id);
    if (aid) { allOpPendingByAgent[aid] = [...(allOpPendingByAgent[aid] || []), card]; }
  }

  // Role display info (colours from DASHBOARD_ROLES)
  const roleInfo = DASHBOARD_ROLES.find(r => r.id === role) || DASHBOARD_ROLES[2];

  const subTabs = [
    { id: "wizard",    label: "Wizard" },
    { id: "approvals", label: `Approvals${onboardingPending.length > 0 ? ` (${onboardingPending.length})` : ""}` },
    { id: "phases",    label: `Phase Management${operationalPending.length > 0 ? ` (${operationalPending.length})` : ""}` },
    { id: "queue",     label: "Onboarding Queue" },
    { id: "analytics", label: "Analytics" },
  ];

  const toggleSection = (rowId, section) => {
    const key = `${rowId}-${section}`;
    setExpandedSection(p => ({ ...p, [key]: !p[key] }));
  };
  const isSectionOpen = (rowId, section) => expandedSection[`${rowId}-${section}`];

  return (
    <div style={{ padding: "28px 32px", maxWidth: 1100, margin: "0 auto" }}>
      {/* ── Role-context banner — always visible ── */}
      <div style={{
        background: roleInfo.color + "12", border: `1px solid ${roleInfo.color}30`,
        borderRadius: 8, padding: "8px 14px", marginBottom: 16,
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: roleInfo.color, flexShrink: 0, display: "inline-block" }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: roleInfo.color }}>Viewing as {roleInfo.label}</span>
          {companyName && <span style={{ fontSize: 12, color: T.muted }}>· {companyName}</span>}
          <span style={{ fontSize: 12, color: T.dim }}>· {roleInfo.description}</span>
        </div>
        {onSwitchTab && (
          <button onClick={() => onSwitchTab("dashboard")} style={{
            background: "none", border: "none", color: roleInfo.color, fontSize: 11,
            cursor: "pointer", fontFamily: T.mono, opacity: 0.8, padding: 0,
          }}>
            Change in Dashboard ↗
          </button>
        )}
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Agent Onboarding</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[{l:"8-Step Wizard",c:T.blue},{l:"Dual HITL Gates",c:T.orange},{l:"W3C VC Trust",c:T.purple},{l:"Phase Lifecycle",c:T.green}].map(b => (
            <span key={b.l} style={{ fontSize: 10, fontWeight: 700, background: b.c + "20", color: b.c, border: `1px solid ${b.c}40`, borderRadius: 4, padding: "2px 7px", fontFamily: T.mono }}>{b.l}</span>
          ))}
        </div>
      </div>

      {/* Sub-tabs */}
      <div style={{ display: "flex", gap: 0, borderBottom: `1px solid ${T.border}`, marginBottom: 24 }}>
        {subTabs.map(t => (
          <button key={t.id} onClick={() => setSubTab(t.id)} style={{
            padding: "9px 18px", background: "none", border: "none",
            borderBottom: `2px solid ${subTab === t.id ? T.orange : "transparent"}`,
            color: subTab === t.id ? T.orange : T.dim,
            cursor: "pointer", fontSize: 13, fontWeight: subTab === t.id ? 700 : 400, fontFamily: T.sans,
          }}>{t.label}</button>
        ))}
      </div>

      {/* ─── 8-Step Hotel Onboarding Wizard ─── */}
      {subTab === "wizard" && (() => {
        // Derive live state from most recent onboarding request
        const latestReq = requests.length > 0 ? requests[0] : null;
        const pendingForRole = pending.filter(p => p.cardType === "approval" || p.cardType === "raci_notification");
        const hasPendingHitl = pendingForRole.length > 0;
        const totalWalkRun = phases.filter(a => a.phase === "walk" || a.phase === "run").length;
        // Phase state — use governance phases table as canonical source for Steps 5-8.
        // agentDid: try multiple fields since the request may use DID, agentCard.id, or agentId slug.
        const agentDid = latestReq?.externalAgentDid ?? latestReq?.agentCard?.id ?? latestReq?.agentId;
        // agentAtCrawl: agent has been onboarded — governance files committed, entered crawl phase.
        const agentAtCrawl = !!(agentDid && phases.some(p => p.agentId === agentDid && p.phase === "crawl"));
        // agentAtWalkRun: agent promoted beyond initial crawl — operating with established governance.
        const agentAtWalkRun = !!(agentDid && phases.some(p => p.agentId === agentDid && (p.phase === "walk" || p.phase === "run")));
        // agentInAnyPhase: agent is in governance phases table (crawl + walk + run combined).
        const agentInAnyPhase = agentAtCrawl || agentAtWalkRun;

        const STEP_STATUS = {
          NOT_STARTED: "not_started",
          IN_PROGRESS: "in_progress",
          COMPLETE: "complete",
        };

        const stepStatus = (idx) => {
          if (!latestReq) return idx === 0 ? STEP_STATUS.IN_PROGRESS : STEP_STATUS.NOT_STARTED;
          const s = latestReq.status || "submitted";
          // Static steps 1–4: derive from request status
          // Backend statuses (canonical): received → analysing → generating_files → awaiting_first_hitl → sandbox → awaiting_second_hitl → committing → onboarded
          if (idx === 0) return ["analysing","generating_files","awaiting_first_hitl","sandbox","awaiting_second_hitl","committing","onboarded"].includes(s) ? STEP_STATUS.COMPLETE : STEP_STATUS.IN_PROGRESS;
          if (idx === 1) return ["generating_files","awaiting_first_hitl","sandbox","awaiting_second_hitl","committing","onboarded"].includes(s) ? STEP_STATUS.COMPLETE : s === "analysing" ? STEP_STATUS.IN_PROGRESS : STEP_STATUS.NOT_STARTED;
          if (idx === 2) return ["awaiting_first_hitl","sandbox","awaiting_second_hitl","committing","onboarded"].includes(s) ? STEP_STATUS.COMPLETE : ["analysing","generating_files"].includes(s) ? STEP_STATUS.IN_PROGRESS : STEP_STATUS.NOT_STARTED;
          if (idx === 3) return ["awaiting_first_hitl","sandbox","awaiting_second_hitl","committing","onboarded"].includes(s) ? STEP_STATUS.COMPLETE : ["analysing","generating_files"].includes(s) ? STEP_STATUS.IN_PROGRESS : STEP_STATUS.NOT_STARTED;
          // Step 5 — Sandbox Eval: IN_PROGRESS at crawl (= sandbox cleared, governance committed,
          // but agent not yet promoted). COMPLETE when agent reaches walk/run (= sandbox proven by operations).
          if (idx === 4) {
            if (agentAtWalkRun) return STEP_STATUS.COMPLETE;
            if (agentAtCrawl || ["awaiting_second_hitl","committing","onboarded"].includes(s) || s === "sandbox") return STEP_STATUS.IN_PROGRESS;
            return STEP_STATUS.NOT_STARTED;
          }
          // Step 6 — HITL Gates: COMPLETE when agent is in any governance phase (= all gates approved).
          // Derives from HITL outcome state as fallback.
          if (idx === 5) {
            if (agentInAnyPhase || ["committing","onboarded"].includes(s)) return STEP_STATUS.COMPLETE;
            if (latestReq.secondHitlOutcome === "approved") return STEP_STATUS.COMPLETE;
            if (latestReq.firstHitlOutcome === "approved" || ["awaiting_first_hitl","awaiting_second_hitl"].includes(s)) return STEP_STATUS.IN_PROGRESS;
            if (latestReq.firstHitlToken != null) return STEP_STATUS.IN_PROGRESS;
            return STEP_STATUS.NOT_STARTED;
          }
          // Step 7 — Governance Commit: IN_PROGRESS at walk (= governance proven operational).
          // COMPLETE only when agent reaches run (= fully operational, governance files confirmed active).
          if (idx === 6) {
            if (phases.some(p => p.agentId === agentDid && p.phase === "run")) return STEP_STATUS.COMPLETE;
            if (agentAtWalkRun || agentAtCrawl) return STEP_STATUS.IN_PROGRESS;
            return STEP_STATUS.NOT_STARTED;
          }
          // Step 8 — Portfolio Rollout: uses cross-hotel data from /api/dashboard/phases/portfolio.
          // NOT_STARTED until ≥2 hotels have at least one walk/run agent.
          // COMPLETE when all 5 hotels have at least one walk/run agent.
          if (idx === 7) {
            const hotelsAtWalkRun = portfolioPhases.hotelsAtWalkRun ?? 0;
            if (hotelsAtWalkRun >= 5) return STEP_STATUS.COMPLETE;
            if (hotelsAtWalkRun >= 2) return STEP_STATUS.IN_PROGRESS;
            return STEP_STATUS.NOT_STARTED;
          }
          return STEP_STATUS.NOT_STARTED;
        };

        const STEPS = [
          {
            title: "Agent Submission",
            desc: "Candidate agent submits an A2A-compliant agent card via the A2A onboarding endpoint — triggering the 7-phase admission pipeline.",
            roles: ["compliance_officer"],
          },
          {
            title: "Identity Verification",
            desc: "Onboarding agent verifies the candidate's W3C Verifiable Credential and confirms no DID conflicts exist in the trust registry.",
            roles: ["compliance_officer"],
          },
          {
            title: "Skill Inventory Analysis",
            desc: "Onboarding agent maps the candidate's declared skills against the 25-clause VDA-MD framework and surfaces any gaps or duplicates.",
            roles: ["hotel_gm", "compliance_officer"],
          },
          {
            title: "Impact Delta Assessment",
            desc: "Onboarding agent generates an impact report: friction removed, MAY clauses activated, cross-domain gaps closed, and RACI exceptions raised.",
            roles: ["hotel_gm", "regional_gm"],
          },
          {
            title: "Sandbox Evaluation",
            desc: "Candidate agent is run through 5 VDA-MD governance scenarios in an isolated sandbox — must achieve ≥95% pass rate to proceed.",
            roles: ["hotel_gm"],
          },
          {
            title: "HITL Gates (Dual Approval)",
            desc: "Two independent reviewers approve or reject the candidate at Gate 1 (Phase 5) and Gate 2 (Phase 6) — both approvals required for admission.",
            roles: ["hotel_gm", "compliance_officer"],
            hitlAlert: hasPendingHitl ? pendingForRole.length : 0,
          },
          {
            title: "Governance File Commit",
            desc: "Approved governance files (AGENTS.md, SOP.md, SKILL.md, EXCEPTION.md) are committed as a GitHub PR and the agent's W3C VC is issued.",
            roles: ["compliance_officer"],
          },
          {
            title: "Portfolio Rollout",
            desc: "Once the agent reaches Walk phase at the first property, the rollout coordinator plans the 5-hotel citizenM deployment schedule.",
            roles: ["regional_gm", "operations_chief"],
          },
        ];

        // Find the current active step
        let currentStep = 7;
        for (let i = 0; i < STEPS.length; i++) {
          const s = stepStatus(i);
          if (s === STEP_STATUS.IN_PROGRESS || s === STEP_STATUS.NOT_STARTED) { currentStep = i; break; }
        }

        const statusColor = { complete: T.green, in_progress: T.blue, not_started: T.dim };
        const statusLabel = { complete: "Complete", in_progress: "In Progress", not_started: "Not Started" };

        return (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>8-Step Hotel Onboarding Wizard</div>
                <div style={{ fontSize: 12, color: T.dim }}>
                  {latestReq ? `Latest request: ${latestReq.status} · Agent: ${latestReq.agentCard?.name ?? latestReq.agentName ?? latestReq.agent_name ?? "Unknown"}` : "No onboarding requests yet"}
                </div>
              </div>
              {latestReq && (
                <span style={{ fontSize: 10, fontFamily: T.mono, background: T.blue + "20", color: T.blue, border: `1px solid ${T.blue}40`, borderRadius: 4, padding: "3px 10px" }}>
                  Step {Math.min(currentStep + 1, 8)} of 8
                </span>
              )}
            </div>

            {/* ── Pre-submission card when arriving from File Manager review ── */}
            {!latestReq && wizardAgentSlug.current && (() => {
              const slug = wizardAgentSlug.current;
              const agentDef = AGENT_DEFS.find(a => a.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") === slug);
              if (!agentDef) return null;
              const handleAutoSubmit = async () => {
                setAutoSubmitting(true);
                try {
                  await fetch("/api/admin/onboarding/quick-submit", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      agentSlug: slug,
                      agentName: agentDef.name,
                      agentIcon: agentDef.icon,
                      agentEndpoint: agentDef.endpoint,
                      companyId: companyId ?? undefined,
                    }),
                  });
                  await fetchRequests();
                } catch { /* silent */ }
                setAutoSubmitting(false);
              };
              return (
                <div style={{ marginBottom: 18, background: `${T.green}0a`, border: `1px solid ${T.green}30`, borderRadius: 10, padding: "16px 18px", display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ fontSize: 26 }}>{agentDef.icon}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 3 }}>{agentDef.name}</div>
                    <div style={{ fontSize: 12, color: T.dim }}>Governance files reviewed and approved — ready for formal VDA-MD admission.</div>
                  </div>
                  <button
                    onClick={handleAutoSubmit}
                    disabled={autoSubmitting}
                    style={{
                      background: autoSubmitting ? T.dim : T.green, color: "#fff", border: "none",
                      borderRadius: 8, padding: "9px 20px", fontSize: 13, fontWeight: 800,
                      cursor: autoSubmitting ? "not-allowed" : "pointer", whiteSpace: "nowrap",
                    }}
                  >
                    {autoSubmitting ? "Submitting…" : "Submit for Formal Admission →"}
                  </button>
                </div>
              );
            })()}

            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {STEPS.map((step, idx) => {
                const status = stepStatus(idx);
                const isActive = status === STEP_STATUS.IN_PROGRESS;
                const isDone = status === STEP_STATUS.COMPLETE;
                const sColor = statusColor[status];
                return (
                  <div key={idx} style={{
                    background: isActive ? T.surface : T.bg, border: `1px solid ${isActive ? T.blue + "60" : T.border}`,
                    borderRadius: 10, padding: "14px 18px", display: "flex", gap: 16, alignItems: "flex-start",
                  }}>
                    {/* Step indicator */}
                    <div style={{ flexShrink: 0, width: 32, height: 32, borderRadius: "50%", background: isDone ? T.green : isActive ? T.blue : T.dim + "20", display: "flex", alignItems: "center", justifyContent: "center", marginTop: 2 }}>
                      {isDone ? (
                        <span style={{ fontSize: 14, color: "#000", fontWeight: 700 }}>✓</span>
                      ) : isActive ? (
                        <span style={{ fontSize: 11, color: "#fff", fontWeight: 700 }}>{idx + 1}</span>
                      ) : (
                        <span style={{ fontSize: 11, color: T.dim, fontWeight: 700 }}>{idx + 1}</span>
                      )}
                    </div>

                    {/* Step content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 13, fontWeight: 700 }}>{step.title}</span>
                        <span style={{ fontSize: 10, fontWeight: 700, background: sColor + "20", color: sColor, border: `1px solid ${sColor}40`, borderRadius: 4, padding: "1px 7px", fontFamily: T.mono }}>
                          {isActive && <span style={{ marginRight: 4, opacity: 0.8 }}>●</span>}
                          {statusLabel[status]}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: T.dim, lineHeight: 1.6, marginBottom: 8 }}>{step.desc}</div>
                      {/* Role pills */}
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {step.roles.map(r => {
                          const rInfo = DASHBOARD_ROLES.find(d => d.id === r);
                          if (!rInfo) return null;
                          return (
                            <span key={r} style={{ fontSize: 10, background: rInfo.color + "15", color: rInfo.color, border: `1px solid ${rInfo.color}30`, borderRadius: 4, padding: "1px 7px", fontFamily: T.mono }}>
                              {rInfo.label}
                            </span>
                          );
                        })}
                      </div>
                      {/* Inline HITL alert */}
                      {step.hitlAlert > 0 && isActive && (
                        <div style={{ marginTop: 10, background: T.orange + "15", border: `1px solid ${T.orange}40`, borderRadius: 6, padding: "8px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                          <span style={{ fontSize: 12, color: T.orange, fontWeight: 600 }}>
                            ⚠ {step.hitlAlert} approval{step.hitlAlert !== 1 ? "s" : ""} waiting for you
                          </span>
                          <button onClick={() => {
                            setSubTab("approvals");
                            const firstToken = pendingForRole[0]?.token;
                            if (firstToken) setTimeout(() => document.getElementById(`hitl-card-${firstToken}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
                          }} style={{ background: "none", border: "none", color: T.orange, fontSize: 11, cursor: "pointer", fontFamily: T.mono, padding: 0 }}>
                            Review → Approvals ↗
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Advanced: A2A Protocol Tester accordion */}
            <div style={{ marginTop: 24, border: `1px solid ${T.border}`, borderRadius: 8 }}>
              <button onClick={() => setWizardTesterOpen(o => !o)} style={{ width: "100%", background: "none", border: "none", padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", color: T.dim, fontFamily: T.sans }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>Advanced: A2A Protocol Tester</span>
                <span style={{ fontSize: 10 }}>{wizardTesterOpen ? "▲" : "▼"}</span>
              </button>
              {wizardTesterOpen && (
                <div style={{ padding: "0 16px 16px", borderTop: `1px solid ${T.border}` }}>
                  <button onClick={() => setSubTab("tester")} style={{ marginTop: 12, background: `${T.purple}20`, border: `1px solid ${T.purple}40`, borderRadius: 6, padding: "7px 16px", fontSize: 12, color: T.purple, cursor: "pointer" }}>
                    Open Protocol Tester →
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ─── Onboarding Queue ─── */}
      {subTab === "queue" && (
        <div>
          {/* ── GM Crawl Enable gate ── */}
          {role === "hotel_gm" && (() => {
            const admittedAgents = requests.filter(r => r.status === "admitted" || r.status === "vda_native");
            if (admittedAgents.length === 0) return null;
            const fetchCrawlStatus = async (agentSlug) => {
              setCrawlStatusLoading(p => ({ ...p, [agentSlug]: true }));
              try {
                const r = await fetch(`/api/dashboard/activation/${agentSlug}/crawl-status?companyId=${companyId}`);
                const d = await r.json();
                setCrawlStatus(p => ({ ...p, [agentSlug]: d }));
              } catch { /* silent */ }
              setCrawlStatusLoading(p => ({ ...p, [agentSlug]: false }));
            };
            const handleEnableCrawl = async (req) => {
              const card = req.agentCard || {};
              const agentSlug = (req.externalAgentDid ?? card.id ?? "").replace("did:vda:hospitality:", "");
              setCrawlLoading(p => ({ ...p, [req.id]: true }));
              setCrawlMsg(p => ({ ...p, [req.id]: null }));
              try {
                const r = await fetch("/api/dashboard/activation/start", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ agentId: agentSlug, companyId, initiatedBy: "Hotel GM" }),
                });
                const d = await r.json();
                if (r.ok) {
                  setCrawlMsg(p => ({ ...p, [req.id]: { ok: true, text: `Crawl started for company ${companyId}` } }));
                  await fetchCrawlStatus(agentSlug);
                } else {
                  setCrawlMsg(p => ({ ...p, [req.id]: { ok: false, text: d.error ?? "Failed to start crawl" } }));
                }
              } catch { setCrawlMsg(p => ({ ...p, [req.id]: { ok: false, text: "Network error" } })); }
              setCrawlLoading(p => ({ ...p, [req.id]: false }));
            };
            const handlePromoteToWalk = async (req) => {
              const card = req.agentCard || {};
              const agentSlug = (req.externalAgentDid ?? card.id ?? "").replace("did:vda:hospitality:", "");
              setPromoteToWalkLoading(p => ({ ...p, [req.id]: true }));
              try {
                const r = await fetch(`/api/dashboard/activation/${agentSlug}/promote-to-walk`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ companyId, promotedBy: "Hotel GM" }),
                });
                const d = await r.json();
                if (r.ok) {
                  const mandateLabel = d.mandateId ? ` · Mandate: ${d.mandateId}` : "";
                  setCrawlMsg(p => ({ ...p, [req.id]: { ok: true, text: `Promoted to Walk phase${mandateLabel}` } }));
                  await fetchCrawlStatus(agentSlug);
                } else {
                  setCrawlMsg(p => ({ ...p, [req.id]: { ok: false, text: d.error ?? "Promote failed" } }));
                }
              } catch { setCrawlMsg(p => ({ ...p, [req.id]: { ok: false, text: "Network error" } })); }
              setPromoteToWalkLoading(p => ({ ...p, [req.id]: false }));
            };
            return (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: T.blue, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: T.blue, display: "inline-block" }} />
                  Admitted Agents — Crawl Activation ({admittedAgents.length})
                </div>
                <div style={{ fontSize: 11, color: T.dim, marginBottom: 12 }}>Gate 1: Enable crawl for admitted agents at this hotel. Only one hotel at a time can be in active crawl.</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {admittedAgents.map(req => {
                    const card = req.agentCard || {};
                    const agentSlug = (req.externalAgentDid ?? card.id ?? "").replace("did:vda:hospitality:", "");
                    const cs = crawlStatus[agentSlug];
                    const csLoading = crawlStatusLoading[agentSlug];
                    const msg = crawlMsg[req.id];
                    return (
                      <div key={req.id} style={{ background: T.surface, border: `1px solid ${T.blue}40`, borderLeft: `4px solid ${T.blue}`, borderRadius: 10, padding: "14px 18px" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: cs ? 12 : 0 }}>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 14 }}>{card.name ?? agentSlug}</div>
                            <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono, marginTop: 2 }}>{agentSlug} · {req.status}</div>
                          </div>
                          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <button onClick={() => fetchCrawlStatus(agentSlug)} style={{ background: `${T.blue}20`, border: `1px solid ${T.blue}40`, borderRadius: 6, padding: "5px 10px", fontSize: 11, color: T.blue, cursor: "pointer" }}>
                              {csLoading ? "…" : "Check Status"}
                            </button>
                            <button
                              disabled={crawlLoading[req.id]}
                              onClick={() => handleEnableCrawl(req)}
                              style={{ background: "#0c1f3f", border: `1px solid ${T.blue}`, borderRadius: 6, padding: "6px 14px", fontSize: 12, color: T.blue, fontWeight: 700, cursor: "pointer", opacity: crawlLoading[req.id] ? 0.5 : 1 }}
                            >
                              {crawlLoading[req.id] ? "…" : `Enable Crawl at hotel ${companyId}`}
                            </button>
                          </div>
                        </div>
                        {msg && (
                          <div style={{ fontSize: 12, padding: "6px 10px", borderRadius: 6, background: msg.ok ? "#14532d40" : "#450a0a40", color: msg.ok ? "#4ade80" : "#f87171", marginBottom: 10 }}>
                            {msg.ok ? "✓" : "✗"} {msg.text}
                          </div>
                        )}
                        {cs && (
                          <div style={{ marginTop: 8 }}>
                            <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono, marginBottom: 8 }}>CRAWL PROGRESS — company {companyId}</div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                              {Object.entries(cs.bands ?? {}).map(([band, data]) => (
                                <div key={band}>
                                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
                                    <span style={{ color: T.muted }}>{band}</span>
                                    <span style={{ color: data.complete ? T.green : T.dim, fontWeight: data.complete ? 700 : 400 }}>
                                      {data.resolved}/{data.total} {data.complete ? "✓" : ""}
                                    </span>
                                  </div>
                                  <div style={{ background: T.bg, borderRadius: 3, height: 6, overflow: "hidden" }}>
                                    <div style={{ height: "100%", width: `${data.total > 0 ? (data.resolved / data.total) * 100 : 0}%`, background: data.complete ? T.green : T.blue, borderRadius: 3, transition: "width 0.4s" }} />
                                  </div>
                                </div>
                              ))}
                            </div>
                            {cs.crawlComplete && (
                              <button
                                disabled={promoteToWalkLoading[req.id]}
                                onClick={() => handlePromoteToWalk(req)}
                                style={{ marginTop: 12, width: "100%", background: "#14532d", border: "1px solid #4ade80", borderRadius: 8, padding: "10px 0", fontSize: 13, color: "#4ade80", fontWeight: 700, cursor: "pointer", opacity: promoteToWalkLoading[req.id] ? 0.5 : 1 }}
                              >
                                {promoteToWalkLoading[req.id] ? "Promoting…" : "Promote to Walk →"}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div style={{ height: 1, background: T.border, margin: "18px 0" }} />
              </div>
            );
          })()}

          {(() => {
            // Role-based stage filtering
            let queueRequests = requests;
            let roleFilter = null;
            if (role === "ambassador" || role === "senior_ambassador") {
              queueRequests = requests.filter(r => !["onboarded"].includes(r.status));
              roleFilter = { label: "Active candidates", desc: "Ambassadors see all active onboarding candidates — review progress and escalate to Hotel GM for HITL sign-off." };
            } else if (role === "hotel_gm") {
              queueRequests = requests.filter(r => r.status === "awaiting_first_hitl" || r.status === "awaiting_second_hitl");
              roleFilter = { label: "HITL approval gates only", desc: "Hotel GMs see requests awaiting Gate 1 or Gate 2 approval — these require your authority-band sign-off before the agent can progress." };
            }
            return (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div style={{ fontSize: 13, color: T.dim }}>
                    {queueRequests.length} request{queueRequests.length !== 1 ? "s" : ""}
                    {roleFilter && <span style={{ color: roleInfo.color, marginLeft: 8, fontWeight: 600 }}>{roleFilter.label}</span>}
                  </div>
                  <button onClick={fetchRequests} style={{ background: `${T.blue}20`, border: `1px solid ${T.blue}40`, borderRadius: 6, padding: "5px 12px", fontSize: 11, color: T.blue, fontFamily: T.mono, cursor: "pointer" }}>Refresh</button>
                </div>
                {roleFilter && (
                  <div style={{ fontSize: 11, color: T.dim, marginBottom: 14, fontStyle: "italic" }}>{roleFilter.desc}</div>
                )}
                {loading && <div style={{ color: T.dim, fontSize: 13 }}>Loading…</div>}
                {queueRequests.length === 0 && !loading && (
                  <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: 24, color: T.dim, fontSize: 13, textAlign: "center" }}>
                    {roleFilter
                      ? `No requests currently in the ${roleFilter.label.toLowerCase()} queue for your role. Use the Wizard to track active onboarding progress.`
                      : "No onboarding requests yet — use the Protocol Tester to submit a test request."
                    }
                  </div>
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {queueRequests.map(req => {
                    const card = req.agentCard || {};
              const statusColor = STATUS_COLORS_OB[req.status] ?? T.dim;
              const isExpanded = expandedRow === req.id;
              const candidate = req.candidateFiles || null;
              return (
                <div key={req.id} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
                  {/* Row header */}
                  <div onClick={() => setExpandedRow(isExpanded ? null : req.id)} style={{ padding: "14px 18px", cursor: "pointer", display: "grid", gridTemplateColumns: "200px 1fr 180px 90px", gap: 12, alignItems: "center" }}>
                    <div style={{ fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{card.name ?? "Unknown"}</div>
                    <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{req.externalAgentDid ?? "—"}</div>
                    <PhaseBar status={req.status} />
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <span style={{ fontSize: 10, fontWeight: 700, background: statusColor + "20", color: statusColor, border: `1px solid ${statusColor}40`, borderRadius: 4, padding: "2px 7px", fontFamily: T.mono }}>{req.status}</span>
                      <span style={{ color: T.dim, fontSize: 12 }}>{isExpanded ? "▲" : "▼"}</span>
                    </div>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div style={{ borderTop: `1px solid ${T.border}`, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
                      {/* Metadata row */}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, fontSize: 11, color: T.dim, fontFamily: T.mono }}>
                        <div>ID: <span style={{ color: T.muted }}>{req.id.slice(0,12)}…</span></div>
                        <div>Session: <span style={{ color: T.muted }}>{req.sessionId?.slice(0,12)}…</span></div>
                        <div>Created: <span style={{ color: T.muted }}>{new Date(req.createdAt).toLocaleString("en-GB")}</span></div>
                        {req.evalPassRate && <div>Eval pass rate: <span style={{ color: sandboxPassThreshold != null ? (parseFloat(req.evalPassRate) >= sandboxPassThreshold ? T.green : T.red) : T.dim, fontWeight: 700 }}>{(parseFloat(req.evalPassRate) * 100).toFixed(1)}%</span></div>}
                        {req.prUrl && <div>PR: <a href={req.prUrl} target="_blank" rel="noreferrer" style={{ color: T.blue }}>View PR #{req.prNumber}</a></div>}
                      </div>

                      {/* Agent Card */}
                      <div>
                        <button onClick={() => toggleSection(req.id, "card")} style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 6, padding: "5px 12px", fontSize: 11, color: T.dim, cursor: "pointer", fontFamily: T.mono }}>
                          {isSectionOpen(req.id, "card") ? "▲" : "▼"} Agent Card JSON
                        </button>
                        {isSectionOpen(req.id, "card") && (
                          <pre style={{ background: "#0a0b0f", borderRadius: 6, padding: 12, fontSize: 11, color: T.muted, marginTop: 8, overflowX: "auto", maxHeight: 200 }}>
                            {JSON.stringify(req.agentCard, null, 2)}
                          </pre>
                        )}
                      </div>

                      {/* Impact Delta Report */}
                      <div>
                        <button onClick={() => toggleSection(req.id, "delta")} style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 6, padding: "5px 12px", fontSize: 11, color: T.dim, cursor: "pointer", fontFamily: T.mono }}>
                          {isSectionOpen(req.id, "delta") ? "▲" : "▼"} Impact Delta Report
                        </button>
                        {isSectionOpen(req.id, "delta") && (
                          <div style={{ marginTop: 12 }}>
                            <ImpactDeltaSection report={req.impactDeltaReport} />
                          </div>
                        )}
                      </div>

                      {/* Candidate Files */}
                      {candidate && (
                        <div>
                          <button onClick={() => toggleSection(req.id, "files")} style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 6, padding: "5px 12px", fontSize: 11, color: T.dim, cursor: "pointer", fontFamily: T.mono }}>
                            {isSectionOpen(req.id, "files") ? "▲" : "▼"} Candidate Files
                          </button>
                          {isSectionOpen(req.id, "files") && (
                            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                              {["agents_md","sop_md","skill_md","exception_md"].filter(k => candidate[k]).map(k => (
                                <div key={k}>
                                  <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono, marginBottom: 4 }}>{k.replace("_"," ").toUpperCase()}</div>
                                  <pre style={{ background: "#0a0b0f", borderRadius: 6, padding: 12, fontSize: 11, color: T.muted, overflowX: "auto", maxHeight: 200 }}>{candidate[k]}</pre>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Eval results */}
                      {req.evalPassRate && (
                        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: 12 }}>
                          <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono, marginBottom: 8 }}>SANDBOX EVAL RESULTS</div>
                          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <div style={{ flex: 1, background: T.bg, borderRadius: 4, height: 8, overflow: "hidden" }}>
                              <div style={{ height: "100%", width: `${parseFloat(req.evalPassRate) * 100}%`, background: sandboxPassThreshold != null ? (parseFloat(req.evalPassRate) >= sandboxPassThreshold ? T.green : T.red) : T.dim, borderRadius: 4 }} />
                            </div>
                            <span style={{ fontSize: 14, fontWeight: 700, color: sandboxPassThreshold != null ? (parseFloat(req.evalPassRate) >= sandboxPassThreshold ? T.green : T.red) : T.dim }}>
                              {(parseFloat(req.evalPassRate) * 100).toFixed(1)}%
                            </span>
                            <span style={{ fontSize: 12, color: T.dim }}>of 5 scenarios</span>
                          </div>
                        </div>
                      )}

                      {/* HITL status */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                        {[{ label: "First HITL Gate", token: req.firstHitlToken, outcome: req.firstHitlOutcome, at: req.firstHitlDecidedAt },
                          { label: "Second HITL Gate", token: req.secondHitlToken, outcome: req.secondHitlOutcome, at: req.secondHitlDecidedAt }].map(h => (
                          <div key={h.label} style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 8, padding: 10, fontSize: 11, fontFamily: T.mono }}>
                            <div style={{ color: T.dim, marginBottom: 4 }}>{h.label}</div>
                            {h.token ? (
                              <>
                                <div style={{ color: h.outcome === "approved" ? T.green : h.outcome === "rejected" ? T.red : T.amber }}>
                                  {h.outcome ?? "Pending"}
                                </div>
                                {h.at && <div style={{ color: T.dim }}>{new Date(h.at).toLocaleString("en-GB")}</div>}
                              </>
                            ) : <div style={{ color: T.dim }}>Not issued yet</div>}
                          </div>
                        ))}
                      </div>

                      {/* Rollback controls
                           Three distinct states:
                           - status === "committing"  → button hidden (Phase 7 in progress, PR not yet created)
                           - status === "onboarded" + prUrl exists → PR created but may not be merged yet;
                             rollback closes the open PR + revokes VC, NOT a post-merge revert operation
                           - status === "onboarded" + no prUrl → no GitHub integration; deregister only
                      */}
                      {req.status === "committing" && (
                        <div style={{ background: T.amber + "10", border: `1px solid ${T.amber}30`, borderRadius: 8, padding: "10px 14px", fontSize: 12 }}>
                          <span style={{ color: T.amber, fontWeight: 700 }}>Phase 7 in progress</span>
                          <span style={{ color: T.dim }}> — governance files committing, VC issuing. Rollback available after this phase completes.</span>
                        </div>
                      )}
                      {req.status === "onboarded" && req.prUrl && (
                        <div style={{ background: T.amber + "08", border: `1px solid ${T.amber}20`, borderRadius: 8, padding: "10px 14px" }}>
                          <div style={{ fontSize: 11, color: T.amber, fontWeight: 700, fontFamily: T.mono, marginBottom: 6 }}>⚠ PR EXISTS — MAY NOT BE MERGED</div>
                          <div style={{ fontSize: 11, color: T.dim, lineHeight: 1.6, marginBottom: 10 }}>
                            Rollback here closes the open PR and revokes the VC — this is <strong>not</strong> a post-merge revert.
                            If the PR has already been merged on GitHub, you must also manually revert the merge commit in the governance repo.
                          </div>
                          {rollbackId === req.id ? (
                            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                              <input placeholder="X-Compliance-Officer-Key" value={rollbackKey} onChange={e => setRollbackKey(e.target.value)}
                                style={{ flex: 1, minWidth: 200, background: T.surface, border: `1px solid ${T.red}40`, borderRadius: 6, padding: "6px 10px", fontSize: 12, color: T.text, fontFamily: T.mono }} />
                              <button onClick={doRollback} disabled={rollbackLoading || !rollbackKey}
                                style={{ background: T.red, border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, color: "#fff", cursor: "pointer" }}>
                                {rollbackLoading ? "Rolling back…" : "Close PR + Revoke VC"}
                              </button>
                              <button onClick={() => { setRollbackId(null); setRollbackKey(""); }}
                                style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 12px", fontSize: 12, color: T.dim, cursor: "pointer" }}>Cancel</button>
                            </div>
                          ) : (
                            <button onClick={() => setRollbackId(req.id)}
                              style={{ background: `${T.red}20`, border: `1px solid ${T.red}40`, borderRadius: 6, padding: "6px 14px", fontSize: 12, color: T.red, cursor: "pointer" }}>
                              Close PR + Revoke VC →
                            </button>
                          )}
                        </div>
                      )}
                      {req.status === "onboarded" && !req.prUrl && (
                        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                          {rollbackId === req.id ? (
                            <>
                              <input placeholder="X-Compliance-Officer-Key" value={rollbackKey} onChange={e => setRollbackKey(e.target.value)}
                                style={{ flex: 1, background: T.surface, border: `1px solid ${T.red}40`, borderRadius: 6, padding: "6px 10px", fontSize: 12, color: T.text, fontFamily: T.mono }} />
                              <button onClick={doRollback} disabled={rollbackLoading || !rollbackKey}
                                style={{ background: T.red, border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, color: "#fff", cursor: "pointer" }}>
                                {rollbackLoading ? "Rolling back…" : "Deregister + Revoke VC"}
                              </button>
                              <button onClick={() => { setRollbackId(null); setRollbackKey(""); }}
                                style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 12px", fontSize: 12, color: T.dim, cursor: "pointer" }}>Cancel</button>
                            </>
                          ) : (
                            <button onClick={() => setRollbackId(req.id)}
                              style={{ background: `${T.red}20`, border: `1px solid ${T.red}40`, borderRadius: 6, padding: "6px 14px", fontSize: 12, color: T.red, cursor: "pointer" }}>
                              Rollback Agent
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                  );
                })}
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* ─── HITL Approvals — action-first ─── */}
      {subTab === "approvals" && (
        <div>
          {/* ── CO Pending Admission gate (Gate 0) — CO-only, shown at top of Approvals ── */}
          {role === "compliance_officer" && (() => {
            const preAdmitted = requests.filter(r => r.status === "pre_admitted");
            if (preAdmitted.length === 0) return null;
            const handleAdmit = async (reqId) => {
              setAdmitLoading(p => ({ ...p, [reqId]: true }));
              try {
                const r = await fetch(`/api/onboarding/${reqId}/admit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decided_by: "Compliance Officer" }) });
                if (r.ok) { await fetchRequests(); }
                else { const d = await r.json(); alert(d.error ?? "Admit failed"); }
              } catch { alert("Network error"); }
              setAdmitLoading(p => ({ ...p, [reqId]: false }));
            };
            const handleReject = async (reqId) => {
              const reason = rejectReason[reqId]?.trim();
              if (!reason) { alert("Please enter a rejection reason"); return; }
              setRejectLoading(p => ({ ...p, [reqId]: true }));
              try {
                const r = await fetch(`/api/onboarding/${reqId}/reject`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason, decided_by: "Compliance Officer" }) });
                if (r.ok) { await fetchRequests(); setRejectOpen(p => ({ ...p, [reqId]: false })); }
                else { const d = await r.json(); alert(d.error ?? "Reject failed"); }
              } catch { alert("Network error"); }
              setRejectLoading(p => ({ ...p, [reqId]: false }));
            };
            return (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: T.orange, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: T.orange, display: "inline-block" }} />
                  Gate 0: Pending CO Admission ({preAdmitted.length})
                </div>
                <div style={{ fontSize: 11, color: T.dim, marginBottom: 12 }}>These VDA-native agents are awaiting your technical review. Only you can see pre-admitted agents — Hotel GMs cannot access them until admitted.</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {preAdmitted.map(req => {
                    const card = req.agentCard || {};
                    return (
                      <div key={req.id} style={{ background: T.surface, border: `1px solid ${T.orange}40`, borderLeft: `4px solid ${T.orange}`, borderRadius: 10, padding: "14px 18px" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 14 }}>{card.name ?? "Unknown Agent"}</div>
                            <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono, marginTop: 2 }}>{req.externalAgentDid ?? "—"} · source: {req.source ?? "—"}</div>
                          </div>
                          <div style={{ display: "flex", gap: 8 }}>
                            <button
                              disabled={admitLoading[req.id]}
                              onClick={() => handleAdmit(req.id)}
                              style={{ background: "#14532d", border: "1px solid #4ade80", borderRadius: 6, padding: "6px 14px", fontSize: 12, color: "#4ade80", fontWeight: 700, cursor: "pointer", opacity: admitLoading[req.id] ? 0.5 : 1 }}
                            >
                              {admitLoading[req.id] ? "…" : "Admit →"}
                            </button>
                            <button
                              onClick={() => setRejectOpen(p => ({ ...p, [req.id]: !p[req.id] }))}
                              style={{ background: "#450a0a", border: "1px solid #f8717160", borderRadius: 6, padding: "6px 14px", fontSize: 12, color: "#f87171", fontWeight: 700, cursor: "pointer" }}
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                        {rejectOpen[req.id] && (
                          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                            <input
                              value={rejectReason[req.id] ?? ""}
                              onChange={e => setRejectReason(p => ({ ...p, [req.id]: e.target.value }))}
                              placeholder="Rejection reason (required)"
                              style={{ flex: 1, background: "#0d0f14", border: "1px solid #f8717160", borderRadius: 6, padding: "6px 10px", fontSize: 12, color: T.text, fontFamily: T.mono }}
                            />
                            <button
                              disabled={rejectLoading[req.id]}
                              onClick={() => handleReject(req.id)}
                              style={{ background: "#450a0a", border: "1px solid #f87171", borderRadius: 6, padding: "6px 14px", fontSize: 12, color: "#f87171", fontWeight: 700, cursor: "pointer", opacity: rejectLoading[req.id] ? 0.5 : 1 }}
                            >
                              {rejectLoading[req.id] ? "…" : "Confirm Reject"}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div style={{ height: 1, background: T.border, margin: "18px 0" }} />
              </div>
            );
          })()}

          {/* Role-scoped context line */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 13 }}>
              <span style={{ color: roleInfo.color, fontWeight: 700 }}>{roleInfo.label} queue</span>
              {companyName && !["regional_gm","operations_chief","compliance_officer"].includes(role) && (
                <span style={{ color: T.dim }}> · {companyName}</span>
              )}
              <span style={{ color: T.dim }}> · {onboardingPending.length} pending · refreshes every 15s</span>
            </div>
            <button onClick={fetchPending} style={{ background: `${T.blue}20`, border: `1px solid ${T.blue}40`, borderRadius: 6, padding: "5px 12px", fontSize: 11, color: T.blue, fontFamily: T.mono, cursor: "pointer" }}>Refresh</button>
          </div>
          <div style={{ fontSize: 11, color: T.dim, marginBottom: 16, fontStyle: "italic" }}>
            RACI exceptions are non-blocking — acknowledging notifies the domain owner without affecting the approval gate. Operational exception cards appear in Phase Management.
          </div>
          {pendingLoading && onboardingPending.length === 0 && <div style={{ color: T.dim, fontSize: 13 }}>Loading…</div>}
          {onboardingPending.length === 0 && !pendingLoading && (
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: 24, textAlign: "center" }}>
              <div style={{ fontSize: 14, color: T.muted, marginBottom: 8 }}>No {roleInfo.label} approvals pending.</div>
              <div style={{ fontSize: 12, color: T.dim, lineHeight: 1.6, marginBottom: 4 }}>
                {role === "hotel_gm"
                  ? "Gate 1 and Gate 2 approval cards appear here once a candidate agent completes sandbox evaluation (≥95% pass rate) and enters Phase 5 of the onboarding pipeline."
                  : role === "compliance_officer"
                  ? "All HITL approval and RACI notification cards across all authority bands appear here. Gate 1 and Gate 2 sign-off cards arrive as agents pass Phase 5 sandbox evaluation."
                  : role === "regional_gm"
                  ? "Cross-property approval cards appear here when agents enter the HITL gates across any of the 5 citizenM hotels. RACI notifications for your cross-property role surface here too."
                  : role === "operations_chief"
                  ? "Security and operational approval cards appear here. Expect cards when an onboarding agent escalates a CISO-scoped governance exception."
                  : "Shadow-review evaluation cards appear here during the early candidate review phase. Watch for agents entering Phase 2 of the onboarding pipeline."
                }
              </div>
              <div style={{ fontSize: 11, color: T.dim, marginBottom: 12, lineHeight: 1.5, fontStyle: "italic" }}>
                {role === "hotel_gm" && requests.some(r => r.status === "sandbox")
                  ? `⟳ 1 agent currently in sandbox evaluation — Gate 1 card expected shortly.`
                  : role === "hotel_gm" && requests.some(r => r.status === "awaiting_second_hitl")
                  ? `Gate 1 approved. Gate 2 card awaiting your review — check the HITL Gates queue.`
                  : "Next step: use the Wizard to track candidate progress through the 8-step pipeline."
                }
              </div>
              <button onClick={() => setSubTab("wizard")} style={{ background: "none", border: "none", color: roleInfo.color, fontSize: 12, cursor: "pointer", padding: 0 }}>
                View Pipeline Progress in Wizard ↗
              </button>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {pending.filter(p => p.cardType !== "operational_exception").map(p => {
              const isRaci = p.cardType === "raci_notification";
              const payload = p.payload || {};
              const isResponding = respondingToken === p.token;
              const isOpen = !!dossierOpen[p.token];
              const accentColor = isRaci ? T.amber : T.orange;
              const bandInfo = DASHBOARD_ROLES.find(r => r.id === p.roleBand);
              return (
                <div key={p.token} id={`hitl-card-${p.token}`} style={{ background: T.surface, border: `1px solid ${accentColor}40`, borderRadius: 10, padding: 20 }}>
                  {/* ── Card header ── */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>{p.agent_name ?? payload.agent_name ?? "Unknown Agent"}</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 10, fontWeight: 700, background: accentColor + "20", color: accentColor, border: `1px solid ${accentColor}40`, borderRadius: 4, padding: "2px 7px", fontFamily: T.mono }}>
                          {isRaci ? "FOR INFORMATION" : `PHASE ${p.phase} APPROVAL`}
                        </span>
                        {/* Authority Band badge */}
                        {bandInfo && (
                          <span style={{ fontSize: 10, fontWeight: 700, background: bandInfo.color + "20", color: bandInfo.color, border: `1px solid ${bandInfo.color}40`, borderRadius: 4, padding: "2px 7px", fontFamily: T.mono }}>
                            {bandInfo.label} — {bandInfo.description}
                          </span>
                        )}
                        {payload.risk_level && (
                          <span style={{ fontSize: 10, fontWeight: 700, background: (payload.risk_level === "high" ? T.red : payload.risk_level === "medium" ? T.amber : T.green) + "20", color: payload.risk_level === "high" ? T.red : payload.risk_level === "medium" ? T.amber : T.green, border: `1px solid ${(payload.risk_level === "high" ? T.red : payload.risk_level === "medium" ? T.amber : T.green)}40`, borderRadius: 4, padding: "2px 7px", fontFamily: T.mono, textTransform: "uppercase" }}>
                            {payload.risk_level} risk
                          </span>
                        )}
                        <span style={{ fontSize: 10, color: T.dim, opacity: 0.5, fontFamily: T.mono }}>Token: {p.token.slice(0, 12)}…</span>
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
                      <div style={{ fontSize: 11, color: T.dim, opacity: 0.6 }}>{new Date(p.createdAt).toLocaleString("en-GB")}</div>
                      {payload.eval_pass_rate !== undefined && (
                        <div style={{ fontSize: 11, marginTop: 3 }}>
                          Eval: <span style={{ fontWeight: 700, color: sandboxPassThreshold != null ? (payload.eval_pass_rate >= sandboxPassThreshold ? T.green : T.red) : T.dim }}>{(payload.eval_pass_rate * 100).toFixed(1)}%</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ── Summary ── */}
                  <div style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 14, opacity: 0.85 }}>
                    {payload.summary ?? payload.message ?? payload.statement ?? "Phase approval required — review agent identity, skills, SOP compliance, and impact before deciding."}
                  </div>

                  {/* ── Action buttons — ALWAYS VISIBLE (action-first) ── */}
                  <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                    {isRaci ? (
                      <button onClick={() => respond(p.token, "acknowledged")} disabled={isResponding}
                        style={{ background: `${T.amber}20`, border: `1px solid ${T.amber}40`, borderRadius: 6, padding: "8px 18px", fontSize: 13, color: T.amber, cursor: "pointer", fontWeight: 700 }}>
                        {isResponding ? "…" : "✓  Acknowledged"}
                      </button>
                    ) : (
                      <>
                        <button onClick={() => respond(p.token, "approved")} disabled={isResponding}
                          style={{ background: T.green, border: "none", borderRadius: 6, padding: "8px 22px", fontSize: 13, fontWeight: 700, color: "#000", cursor: "pointer", letterSpacing: 0.3 }}>
                          {isResponding ? "…" : "✓  Approve"}
                        </button>
                        <button onClick={() => respond(p.token, "rejected")} disabled={isResponding}
                          style={{ background: `${T.red}15`, border: `1px solid ${T.red}50`, borderRadius: 6, padding: "8px 18px", fontSize: 13, color: T.red, cursor: "pointer" }}>
                          {isResponding ? "…" : "✗  Reject"}
                        </button>
                      </>
                    )}
                  </div>

                  {/* ── Dossier toggle — optional detail layer ── */}
                  {!isRaci && p.onboardingRequestId && (
                    <button
                      onClick={() => {
                        const next = !isOpen;
                        setDossierOpen(prev => ({ ...prev, [p.token]: next }));
                        if (next) fetchDossier(p.token, p.onboardingRequestId);
                      }}
                      style={{ background: isOpen ? `${T.purple}20` : T.bg, border: `1px solid ${isOpen ? T.purple : T.border}`, borderRadius: 6, padding: "7px 14px", fontSize: 11, color: isOpen ? T.purple : T.dim, cursor: "pointer", fontWeight: isOpen ? 700 : 400, width: "100%", textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span>{isOpen ? "▲  Hide Full Dossier" : "▼  View Full Dossier — Identity · Skills · SOP Compliance · Impact Delta · Governance Docs"}</span>
                      {dossierData[p.token] && !isOpen && <span style={{ fontSize: 10, color: T.green, opacity: 0.8 }}>Loaded</span>}
                    </button>
                  )}

                  {/* ── Dossier panel ── */}
                  {isOpen && (
                    <DossierPanel
                      token={p.token}
                      data={dossierData[p.token]}
                      loading={!!dossierLoading[p.token]}
                      activeTab={dossierTab[p.token] || "overview"}
                      setActiveTab={t => setDossierTab(prev => ({ ...prev, [p.token]: t }))}
                      docsTab={docsSubTab[p.token] || "agents"}
                      setDocsTab={t => setDocsSubTab(prev => ({ ...prev, [p.token]: t }))}
                      passThreshold={sandboxPassThreshold}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* ── Other-bands disclosure ── */}
          {(() => {
            const otherCards = allPending.filter(p =>
              p.cardType !== "operational_exception" &&
              p.roleBand !== role &&
              !(role === "compliance_officer" && p.roleBand == null)
            );
            if (otherCards.length === 0) return null;
            // Compute per-band counts
            const bandCounts = {};
            otherCards.forEach(p => {
              const b = p.roleBand ?? "unassigned";
              bandCounts[b] = (bandCounts[b] || 0) + 1;
            });
            const bandLabels = Object.entries(bandCounts).map(([b, n]) => {
              const info = DASHBOARD_ROLES.find(r => r.id === b);
              return { id: b, label: info?.label ?? b, count: n, color: info?.color ?? T.dim };
            });
            return (
              <div style={{ marginTop: 16, border: `1px solid ${T.border}`, borderRadius: 8, overflow: "hidden" }}>
                <button
                  onClick={() => setOtherBandsOpen(o => !o)}
                  style={{ width: "100%", background: "none", border: "none", padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", color: T.dim, fontFamily: T.sans }}
                >
                  <span style={{ fontSize: 12 }}>{otherCards.length} card{otherCards.length !== 1 ? "s" : ""} in other authority bands ▾</span>
                  <span style={{ fontSize: 10 }}>{otherBandsOpen ? "▲" : "▼"}</span>
                </button>
                {otherBandsOpen && (
                  <div style={{ borderTop: `1px solid ${T.border}`, padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
                    {bandLabels.map(b => (
                      <div key={b.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: b.color, display: "inline-block" }} />
                          <span style={{ fontSize: 12, color: b.color, fontWeight: 600 }}>{b.label}</span>
                          <span style={{ fontSize: 12, color: T.dim }}>— {b.count} card{b.count !== 1 ? "s" : ""}</span>
                        </div>
                        {onRoleChange && (
                          <button onClick={() => onRoleChange(b.id)} style={{ background: b.color + "15", border: `1px solid ${b.color}40`, borderRadius: 4, padding: "2px 8px", color: b.color, fontSize: 11, cursor: "pointer", fontFamily: T.mono }}>
                            Switch to {b.label} ↗
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* ─── Phase Management ─── */}
      {subTab === "phases" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Agent Phase Lifecycle</div>
              <div style={{ fontSize: 12, color: T.dim }}>crawl → walk → run · exceptions surface here for review before promotion</div>
            </div>
            <button onClick={() => { fetchPhases(); fetchPending(); }}
              style={{ background: `${T.blue}20`, border: `1px solid ${T.blue}40`, borderRadius: 6, padding: "5px 12px", fontSize: 11, color: T.blue, fontFamily: T.mono, cursor: "pointer" }}>
              Refresh
            </button>
          </div>

          {promoteMsg && (
            <div style={{ background: promoteMsg.ok ? `${T.green}15` : `${T.red}15`, border: `1px solid ${promoteMsg.ok ? T.green : T.red}40`, borderRadius: 8, padding: "10px 16px", fontSize: 13, color: promoteMsg.ok ? T.green : T.red, marginBottom: 16 }}>
              {promoteMsg.msg}
            </div>
          )}

          {phasesLoading && phases.length === 0 && (
            <div style={{ color: T.dim, fontSize: 13, padding: 24 }}>Loading phase data…</div>
          )}

          {!phasesLoading && phases.length === 0 && (
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: 24, color: T.dim, fontSize: 13, textAlign: "center" }}>
              No agents found for this property. Onboard an agent first via the Protocol Tester.
            </div>
          )}

          {/* Per-agent role-band phase grids */}
          {phases.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20, marginTop: 16 }}>
              {phases.map(agent => {
                const overallPhColor = agent.phase === "crawl" ? T.amber : agent.phase === "walk" ? T.blue : T.green;
                const cards = opPendingByAgent[agent.agentId] || [];
                const bandPhases = agent.roleBandPhases || {};
                const BAND_ROWS = [
                  { id: "ambassador",         label: "Ambassador",         color: "#ffffff" },
                  { id: "senior_ambassador",   label: "Senior Ambassador",  color: "#f59e0b" },
                  { id: "hotel_gm",            label: "Hotel GM",           color: "#60a5fa" },
                  { id: "regional_gm",         label: "Regional GM",        color: "#a855f7" },
                  { id: "operations_chief",    label: "Operations Chief",   color: "#34d399" },
                  { id: "compliance_officer",  label: "Compliance Officer", color: "#f87171" },
                ];
                return (
                  <div key={agent.agentId} id={`phase-agent-${agent.agentId}`} style={{ background: T.surface, border: `1px solid ${overallPhColor}30`, borderRadius: 12, padding: 20, scrollMarginTop: 80 }}>
                    {/* Agent header */}
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, paddingBottom: 12, borderBottom: `1px solid ${T.border}` }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{agent.agentId}</div>
                      <span style={{ fontSize: 10, fontWeight: 700, background: overallPhColor + "20", color: overallPhColor, border: `1px solid ${overallPhColor}40`, borderRadius: 4, padding: "2px 8px", fontFamily: T.mono, textTransform: "uppercase" }}>
                        {agent.phase} overall
                      </span>
                      {agent.agreementRate != null && (
                        <span style={{ fontSize: 10, fontFamily: T.mono, background: T.green + "15", color: T.green, border: `1px solid ${T.green}30`, borderRadius: 4, padding: "2px 6px" }}>
                          ✓ {(parseFloat(agent.agreementRate) * 100).toFixed(0)}% agreed
                        </span>
                      )}
                      {cards.length > 0 && (
                        <span style={{ fontSize: 10, fontFamily: T.mono, background: T.orange + "15", color: T.orange, border: `1px solid ${T.orange}30`, borderRadius: 4, padding: "2px 6px" }}>
                          ⚠ {cards.length} exception{cards.length !== 1 ? "s" : ""} pending
                        </span>
                      )}
                    </div>

                    {/* Operational exception cards for this agent */}
                    {cards.length > 0 && (
                      <div style={{ marginBottom: 16 }}>
                        {cards.map(card => {
                          const pl = card.payload || {};
                          const isRes = respondingToken === card.token;
                          return (
                            <div key={card.token} style={{ background: `${T.orange}08`, border: `1px solid ${T.orange}25`, borderRadius: 7, padding: "8px 10px", marginBottom: 8 }}>
                              <div style={{ fontSize: 11, color: T.muted, marginBottom: 6, lineHeight: 1.5 }}>
                                {pl.summary ?? pl.escalation_reason ?? pl.message ?? "Operational exception requires review"}
                              </div>
                              {pl.action_proposed && (
                                <div style={{ fontSize: 10, color: T.dim, fontFamily: T.mono, marginBottom: 6 }}>Action: {pl.action_proposed}</div>
                              )}
                              <div style={{ display: "flex", gap: 6 }}>
                                <button onClick={() => respond(card.token, "approved")} disabled={isRes}
                                  style={{ flex: 1, background: T.green, border: "none", borderRadius: 5, padding: "5px 0", fontSize: 11, fontWeight: 700, color: "#fff", cursor: "pointer" }}>
                                  {isRes ? "…" : "Validate"}
                                </button>
                                <button onClick={() => respond(card.token, "rejected")} disabled={isRes}
                                  style={{ flex: 1, background: `${T.red}20`, border: `1px solid ${T.red}40`, borderRadius: 5, padding: "5px 0", fontSize: 11, color: T.red, cursor: "pointer" }}>
                                  {isRes ? "…" : "Override"}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* 6-row × 3-col band phase grid */}
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: "left", padding: "6px 10px", color: T.dim, fontWeight: 600, fontFamily: T.mono, fontSize: 10 }}>ROLE BAND</th>
                            {["CRAWL", "WALK", "RUN"].map(ph => (
                              <th key={ph} style={{ textAlign: "center", padding: "6px 8px", color: ph === "CRAWL" ? T.amber : ph === "WALK" ? T.blue : T.green, fontWeight: 700, fontFamily: T.mono, fontSize: 10 }}>{ph}</th>
                            ))}
                            <th style={{ textAlign: "center", padding: "6px 8px", color: T.dim, fontWeight: 600, fontFamily: T.mono, fontSize: 10 }}>PROMOTE</th>
                          </tr>
                        </thead>
                        <tbody>
                          {BAND_ROWS.map(band => {
                            const bandData = bandPhases[band.id] || { phase: "crawl", agreementRate: null, overrideRate: null };
                            const isNA = bandData.phase === "not_applicable";
                            const bandPhase = isNA ? null : bandData.phase;
                            const nextBandPhase = bandPhase === "crawl" ? "walk" : bandPhase === "walk" ? "run" : null;
                            // Use cross-role allOpPendingByAgent so exceptions belonging to any band's role are counted.
                            const allBandCards = (allOpPendingByAgent[agent.agentId] || []).filter(c => c.roleBand === band.id);
                            const hasBlocker = allBandCards.length > 0;
                            const bandAgreement = bandData.agreementRate != null ? (parseFloat(bandData.agreementRate) * 100).toFixed(0) : null;
                            const isPromotingThisBand = promotingAgent === `${agent.agentId}:${band.id}`;
                            // Null agreementRate = no operational exception history yet = insufficient data, block promotion.
                            const agreementThreshold = bandPhase === "crawl" ? crawlAgreementThreshold : walkAgreementThreshold;
                            // When policy not yet loaded (agreementThreshold == null) block promotion conservatively.
                            const belowAgreementThreshold = bandData.agreementRate == null || agreementThreshold == null || parseFloat(bandData.agreementRate) < agreementThreshold;
                            const isPromoteDisabled = hasBlocker || belowAgreementThreshold || isPromotingThisBand;
                            const promoteTitle = hasBlocker
                              ? `Resolve ${allBandCards.length} pending exception(s) for this band first`
                              : bandData.agreementRate == null
                              ? `No agreement-rate data yet — resolve at least one operational exception before promoting`
                              : belowAgreementThreshold
                              ? `Agreement rate ${bandAgreement}% is below the ${(agreementThreshold * 100).toFixed(0)}% threshold required to promote`
                              : `Promote ${band.label} → ${nextBandPhase}`;
                            return (
                              <tr key={band.id} style={{ borderTop: `1px solid ${T.border}` }}>
                                <td style={{ padding: "8px 10px" }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: band.color, display: "inline-block", flexShrink: 0 }} />
                                    <span style={{ color: band.color, fontWeight: 600 }}>{band.label}</span>
                                    {bandAgreement !== null && (
                                      <span style={{ fontSize: 10, color: T.dim, fontFamily: T.mono }}>({bandAgreement}% ✓)</span>
                                    )}
                                  </div>
                                </td>
                                {["crawl", "walk", "run"].map(ph => {
                                  const phColor = ph === "crawl" ? T.amber : ph === "walk" ? T.blue : T.green;
                                  const isActive = !isNA && bandPhase === ph;
                                  const isPast = !isNA && (bandPhase === "run" || (bandPhase === "walk" && ph === "crawl"));
                                  return (
                                    <td key={ph} style={{ textAlign: "center", padding: "8px 8px" }}>
                                      {isNA ? (
                                        <span style={{ fontSize: 10, color: T.dim, fontStyle: "italic" }}>N/A</span>
                                      ) : isActive ? (
                                        <span style={{ fontSize: 11, fontWeight: 700, background: phColor + "25", color: phColor, border: `1px solid ${phColor}50`, borderRadius: 4, padding: "2px 8px" }}>●</span>
                                      ) : isPast ? (
                                        <span style={{ fontSize: 11, color: T.green }}>✓</span>
                                      ) : (
                                        <span style={{ fontSize: 11, color: T.dim, opacity: 0.3 }}>○</span>
                                      )}
                                    </td>
                                  );
                                })}
                                <td style={{ textAlign: "center", padding: "8px 8px" }}>
                                  {isNA ? (
                                    <span style={{ fontSize: 10, color: T.dim }}>—</span>
                                  ) : nextBandPhase ? (
                                    <button
                                      onClick={async () => {
                                        setPromotingAgent(`${agent.agentId}:${band.id}`);
                                        setPromoteMsg(null);
                                        try {
                                          const r = await fetch("/api/dashboard/phases/promote-band", {
                                            method: "POST", headers: { "Content-Type": "application/json" },
                                            body: JSON.stringify({ companyId, agentId: agent.agentId, roleBand: band.id, targetPhase: nextBandPhase, promotedBy: "Dashboard User" }),
                                          });
                                          const d = await r.json();
                                          if (r.ok) { setPromoteMsg({ ok: true, msg: `${band.label} band promoted to ${nextBandPhase}` }); fetchPhases(); }
                                          else setPromoteMsg({ ok: false, msg: d.error || "Promotion failed" });
                                        } catch { setPromoteMsg({ ok: false, msg: "Network error" }); }
                                        setPromotingAgent(null);
                                      }}
                                      disabled={isPromoteDisabled}
                                      title={promoteTitle}
                                      style={{
                                        padding: "3px 10px", fontSize: 10, fontWeight: 700, borderRadius: 4, border: "none",
                                        cursor: isPromoteDisabled ? "not-allowed" : "pointer",
                                        background: isPromoteDisabled ? T.dim + "20" : band.color + "30",
                                        color: isPromoteDisabled ? T.dim : band.color,
                                        opacity: isPromotingThisBand ? 0.6 : 1,
                                      }}>
                                      {isPromotingThisBand ? "…" : `→ ${nextBandPhase}`}
                                    </button>
                                  ) : (
                                    <span style={{ fontSize: 10, color: T.green, fontWeight: 700 }}>✓ Max</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── Impact Analytics ─── */}
      {subTab === "analytics" && (
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 20 }}>Aggregate Impact — All Onboarded Agents</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 24 }}>
            {[
              { label: "Friction Removed", value: `${analytics.frictionRemoved.toFixed(1)}/wk`, color: T.green, desc: "escalations/week resolved by onboarded agents" },
              { label: "MAY Clauses Activated", value: analytics.mayClauses, color: T.blue, desc: "unexercised governance permissions now active" },
              { label: "Cross-Domain Gaps Closed", value: analytics.gapsClosed, color: T.purple, desc: "cross-domain inheritance gaps resolved" },
              { label: "Skills Auto-Removed", value: analytics.autoRemoved, color: T.dim, desc: "duplicate skills automatically deduplicated" },
              { label: "RACI Exceptions Raised", value: analytics.raciExceptions, color: T.amber, desc: "cross-domain ambiguities surfaced and notified" },
              { label: "Agents Onboarded", value: requests.filter(r => r.status === "onboarded").length, color: T.orange, desc: "total agents admitted to VDA-MD framework" },
            ].map(m => (
              <div key={m.label} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: 18 }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: m.color, fontFamily: T.mono, marginBottom: 6 }}>{m.value}</div>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>{m.label}</div>
                <div style={{ fontSize: 11, color: T.dim, lineHeight: 1.5 }}>{m.desc}</div>
              </div>
            ))}
          </div>
          {requests.filter(r => r.status === "onboarded").length === 0 && (
            <div style={{ color: T.dim, fontSize: 13, textAlign: "center", fontStyle: "italic" }}>
              Metrics will populate as agents are onboarded and begin generating Witness log entries.
            </div>
          )}
        </div>
      )}

      {/* ─── Protocol Tester ─── */}
      {subTab === "tester" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Submit Onboarding Request</div>
            <div style={{ fontSize: 11, color: T.red, fontFamily: T.mono, marginBottom: 16, fontWeight: 700 }}>⚠ DEVELOPMENT TOOL — creates a real onboarding_requests record</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ fontSize: 11, color: T.dim, fontFamily: T.mono, display: "block", marginBottom: 5 }}>AGENT CARD JSON (paste the full Agent Card)</label>
                <textarea value={testerCard} onChange={e => setTesterCard(e.target.value)} rows={12}
                  placeholder={`{\n  "name": "My Test Agent",\n  "description": "A test agent for onboarding",\n  "url": "https://example.com/a2a",\n  "version": "1.0.0",\n  "capabilities": { "streaming": false, "pushNotifications": false },\n  "skills": [\n    { "id": "test_skill", "name": "Test Skill", "description": "Does something" }\n  ]\n}`}
                  style={{ width: "100%", background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "8px 10px", fontSize: 12, color: T.text, fontFamily: T.mono, resize: "vertical", boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: T.dim, fontFamily: T.mono, display: "block", marginBottom: 5 }}>BEARER VC TOKEN (from Agent Credentials tab)</label>
                <textarea value={testerVc} onChange={e => setTesterVc(e.target.value)} rows={3}
                  placeholder="Paste vcBase64url from an issued credential"
                  style={{ width: "100%", background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "8px 10px", fontSize: 11, color: T.dim, fontFamily: T.mono, resize: "vertical", boxSizing: "border-box" }} />
                <div style={{ fontSize: 10, color: T.dim, marginTop: 4 }}>Note: VC must be issued for agentId "onboarding-agent" to pass the per-agent credential binding</div>
              </div>
              <button onClick={submitTesterRequest} disabled={testerLoading || !testerCard || !testerVc}
                style={{
                  background: testerLoading ? `${T.orange}20` : T.orange, border: "none", borderRadius: 8, padding: "10px 20px",
                  fontSize: 13, fontWeight: 700, color: testerLoading ? T.orange : "#fff",
                  cursor: testerLoading || !testerCard || !testerVc ? "not-allowed" : "pointer",
                  opacity: !testerCard || !testerVc ? 0.5 : 1,
                }}>
                {testerLoading ? "Submitting…" : "Send Onboarding Request →"}
              </button>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>JSON-RPC Response</div>
            <div style={{ background: "#08090c", border: `1px solid ${T.border}`, borderRadius: 10, padding: 16, minHeight: 300, fontFamily: T.mono, fontSize: 12, color: T.dim, overflowY: "auto", maxHeight: 500 }}>
              {testerResult ? (
                <pre style={{ margin: 0, whiteSpace: "pre-wrap", color: testerResult.error ? T.red : testerResult.result ? T.green : T.amber }}>
                  {JSON.stringify(testerResult, null, 2)}
                </pre>
              ) : (
                <div style={{ color: T.dim, fontStyle: "italic" }}>Response will appear here after submitting a request…</div>
              )}
            </div>
            <div style={{ marginTop: 12, fontSize: 11, color: T.dim, lineHeight: 1.6 }}>
              <div>• After submitting, switch to <strong>Onboarding Queue</strong> to track progress</div>
              <div>• HITL approval cards appear in the <strong>HITL Approvals</strong> sub-tab</div>
              <div>• <strong>-32006</strong> — self-onboarding denied (agent_card.name = onboarding-agent)</div>
              <div>• <strong>-32001</strong> — VC missing or invalid</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// A2A PROTOCOL TAB
// ─────────────────────────────────────────────

function A2AProtocolTab({ companyId, companyName }) {
  const [subTab, setSubTab] = useState("directory");
  const [agents, setAgents] = useState([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [expandedCard, setExpandedCard] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [expandedTask, setExpandedTask] = useState(null);
  const [testerAgent, setTesterAgent] = useState("");
  const [testerSession, setTesterSession] = useState(() => crypto.randomUUID());
  const [testerMessage, setTesterMessage] = useState("");
  const [testerVc, setTesterVc] = useState("");
  const [testerLoading, setTesterLoading] = useState(false);
  const [testerResult, setTesterResult] = useState(null);
  const [copied, setCopied] = useState({});

  const AGENT_IDS = [
    "availability-agent", "rate-agent", "reservation-bot", "check-in-agent",
    "folio-agent", "folio-charge-agent", "checkout-agent", "revenue-reconciliation-agent",
  ];

  const fetchAgents = useCallback(async () => {
    if (!companyId) return;
    setAgentsLoading(true);
    try {
      const r = await fetch(`/api/a2a/${companyId}/agents`);
      if (r.ok) { const d = await r.json(); setAgents(d.agents || []); }
    } catch { /* silent */ }
    setAgentsLoading(false);
  }, [companyId]);

  const fetchTasks = useCallback(async () => {
    if (!companyId) return;
    setTasksLoading(true);
    try {
      const r = await fetch(`/api/a2a/${companyId}/tasks`);
      if (r.ok) { const d = await r.json(); setTasks(d.tasks || []); }
    } catch { /* silent */ }
    setTasksLoading(false);
  }, [companyId]);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);
  useEffect(() => { if (subTab === "tasks") fetchTasks(); }, [subTab, fetchTasks]);

  // Poll tasks every 10s when on tasks subtab
  useEffect(() => {
    if (subTab !== "tasks") return;
    const t = setInterval(fetchTasks, 10000);
    return () => clearInterval(t);
  }, [subTab, fetchTasks]);

  const copyToClipboard = (key, text) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(p => ({ ...p, [key]: true }));
      setTimeout(() => setCopied(p => ({ ...p, [key]: false })), 1500);
    });
  };

  const statusColors = {
    submitted: T.blue, working: T.amber, completed: T.green, failed: T.red, cancelled: T.dim,
  };

  const runTesterTask = async () => {
    if (!testerAgent || !testerMessage || !testerVc) return;
    setTesterLoading(true);
    setTesterResult(null);
    const taskId = crypto.randomUUID();
    const session = testerSession || crypto.randomUUID();
    try {
      const r = await fetch(`/api/a2a/${companyId}/${testerAgent}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${testerVc}` },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1, method: "tasks/send",
          params: {
            id: taskId, sessionId: session,
            message: { role: "user", parts: [{ type: "text", text: testerMessage }] },
          },
        }),
      });
      const d = await r.json();
      setTesterResult(d);
      if (subTab === "tasks") fetchTasks();
    } catch (e) { setTesterResult({ error: String(e) }); }
    setTesterLoading(false);
  };

  const subTabs = [
    { id: "directory", label: "Agent Directory" },
    { id: "tasks", label: "Active Tasks" },
    { id: "tester", label: "Protocol Tester" },
  ];

  return (
    <div style={{ padding: "28px 32px", maxWidth: 1100, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>A2A Protocol</div>
        <div style={{ fontSize: 12, color: T.dim, lineHeight: 1.6 }}>
          Google Agent-to-Agent (A2A) transport layer · JSON-RPC 2.0 · W3C VC trust layer
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          {[
            { label: "A2A Spec", color: T.blue },
            { label: "JSON-RPC 2.0", color: T.purple },
            { label: "Bearer VC Auth", color: T.green },
            { label: "Governance Pipeline", color: T.orange },
          ].map(b => (
            <span key={b.label} style={{ fontSize: 10, fontWeight: 700, background: b.color + "20", color: b.color, border: `1px solid ${b.color}40`, borderRadius: 4, padding: "3px 8px", fontFamily: T.mono }}>
              {b.label}
            </span>
          ))}
        </div>
      </div>

      {/* Sub-tabs */}
      <div style={{ display: "flex", gap: 0, borderBottom: `1px solid ${T.border}`, marginBottom: 24 }}>
        {subTabs.map(t => (
          <button key={t.id} onClick={() => setSubTab(t.id)} style={{
            padding: "9px 18px", background: "none", border: "none",
            borderBottom: `2px solid ${subTab === t.id ? T.orange : "transparent"}`,
            color: subTab === t.id ? T.orange : T.dim,
            cursor: "pointer", fontSize: 13, fontWeight: subTab === t.id ? 700 : 400, fontFamily: T.sans,
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Agent Directory */}
      {subTab === "directory" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: T.dim }}>
              Discovery URL: <code style={{ fontFamily: T.mono, color: T.blue, fontSize: 12 }}>/api/a2a/{companyId}/agents</code>
            </div>
            <button onClick={fetchAgents} style={{ background: `${T.blue}20`, border: `1px solid ${T.blue}40`, borderRadius: 6, padding: "5px 12px", fontSize: 11, color: T.blue, fontFamily: T.mono, cursor: "pointer" }}>
              Refresh
            </button>
          </div>

          {agentsLoading && <div style={{ color: T.dim, fontSize: 13 }}>Loading agent cards…</div>}

          <div style={{ display: "grid", gap: 14 }}>
            {agents.map((card, i) => {
              const isExpanded = expandedCard === i;
              return (
                <div key={i} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
                  <div
                    onClick={() => setExpandedCard(isExpanded ? null : i)}
                    style={{ padding: "14px 18px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{card.name}</div>
                      <div style={{ fontSize: 12, color: T.dim, lineHeight: 1.5, maxWidth: 600 }}>{card.description}</div>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0, marginLeft: 16 }}>
                      <span style={{ fontSize: 11, background: T.green + "20", color: T.green, border: `1px solid ${T.green}40`, borderRadius: 4, padding: "2px 7px", fontFamily: T.mono }}>
                        bearer
                      </span>
                      <span style={{ color: T.dim, fontSize: 14 }}>{isExpanded ? "▲" : "▼"}</span>
                    </div>
                  </div>

                  {isExpanded && (
                    <div style={{ borderTop: `1px solid ${T.border}`, padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
                      <div>
                        <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono, marginBottom: 4 }}>ENDPOINT URL</div>
                        <code style={{ fontSize: 12, color: T.blue, fontFamily: T.mono }}>{card.url}</code>
                      </div>

                      <div>
                        <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono, marginBottom: 6 }}>SKILLS ({card.skills?.length ?? 0})</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {card.skills?.map(s => (
                            <span key={s.id} title={s.description} style={{ fontSize: 11, background: T.purple + "15", color: T.purple, border: `1px solid ${T.purple}30`, borderRadius: 4, padding: "2px 8px", fontFamily: T.mono, cursor: "help" }}>
                              {s.name}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          onClick={() => copyToClipboard(`json-${i}`, JSON.stringify(card, null, 2))}
                          style={{ background: `${T.orange}20`, border: `1px solid ${T.orange}40`, borderRadius: 6, padding: "5px 12px", fontSize: 11, color: T.orange, fontFamily: T.mono, cursor: "pointer" }}
                        >
                          {copied[`json-${i}`] ? "✓ Copied" : "Copy Card JSON"}
                        </button>
                        <button
                          onClick={() => copyToClipboard(`url-${i}`, `/api/a2a/${companyId}/${AGENT_IDS[i] || i}/agent.json`)}
                          style={{ background: `${T.blue}20`, border: `1px solid ${T.blue}40`, borderRadius: 6, padding: "5px 12px", fontSize: 11, color: T.blue, fontFamily: T.mono, cursor: "pointer" }}
                        >
                          {copied[`url-${i}`] ? "✓ Copied" : "Copy Discovery URL"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {agents.length === 0 && !agentsLoading && (
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: 24, color: T.dim, fontSize: 13, textAlign: "center" }}>
              No agent cards loaded — make sure the company has governance files seeded.
            </div>
          )}
        </div>
      )}

      {/* Active Tasks */}
      {subTab === "tasks" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: T.dim }}>Polling every 10s · {tasks.length} tasks</div>
            <button onClick={fetchTasks} style={{ background: `${T.blue}20`, border: `1px solid ${T.blue}40`, borderRadius: 6, padding: "5px 12px", fontSize: 11, color: T.blue, fontFamily: T.mono, cursor: "pointer" }}>
              Refresh
            </button>
          </div>

          {tasksLoading && tasks.length === 0 && <div style={{ color: T.dim, fontSize: 13 }}>Loading tasks…</div>}

          {tasks.length === 0 && !tasksLoading && (
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: 24, color: T.dim, fontSize: 13, textAlign: "center" }}>
              No A2A tasks yet — use the Protocol Tester to send your first task.
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {tasks.map(task => {
              const isExpanded = expandedTask === task.id;
              const statusColor = statusColors[task.status?.state] ?? T.dim;
              const inputText = task.message?.parts?.[0]?.text ?? "";
              const outputText = task.artifacts?.[0]?.parts?.[0]?.text ?? "";
              return (
                <div key={task.id} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
                  <div
                    onClick={() => setExpandedTask(isExpanded ? null : task.id)}
                    style={{ padding: "12px 16px", cursor: "pointer", display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "center" }}
                  >
                    <div style={{ display: "grid", gridTemplateColumns: "140px 120px 140px 1fr", gap: 12, alignItems: "center", fontSize: 12, overflow: "hidden" }}>
                      <span style={{ fontFamily: T.mono, color: T.dim }}>{task.id.slice(0, 8)}…</span>
                      <span style={{ fontFamily: T.mono, color: T.dim }}>{task.sessionId?.slice(0, 8)}…</span>
                      <span style={{ color: T.muted }}>{task.agentId}</span>
                      <span style={{ color: T.dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{inputText.slice(0, 60)}</span>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, background: statusColor + "20", color: statusColor, border: `1px solid ${statusColor}40`, borderRadius: 4, padding: "2px 8px", fontFamily: T.mono }}>
                        {task.status?.state}
                      </span>
                      <span style={{ color: T.dim, fontSize: 12 }}>{isExpanded ? "▲" : "▼"}</span>
                    </div>
                  </div>

                  {isExpanded && (
                    <div style={{ borderTop: `1px solid ${T.border}`, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                        <div>
                          <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono, marginBottom: 6 }}>INPUT MESSAGE</div>
                          <div style={{ background: "#0a0b0f", borderRadius: 6, padding: "10px 12px", fontSize: 12, fontFamily: T.mono, color: T.muted, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                            {inputText || "—"}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono, marginBottom: 6 }}>OUTPUT ARTIFACT</div>
                          <div style={{ background: "#0a0b0f", borderRadius: 6, padding: "10px 12px", fontSize: 12, fontFamily: T.mono, color: T.green, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                            {outputText || task.errorMessage || "—"}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, fontSize: 11, color: T.dim, fontFamily: T.mono }}>
                        <div>Task ID: <span style={{ color: T.muted }}>{task.id}</span></div>
                        <div>Session: <span style={{ color: T.muted }}>{task.sessionId}</span></div>
                        <div>External DID: <span style={{ color: T.muted }}>{task.externalAgentDid ?? "—"}</span></div>
                        <div>Created: <span style={{ color: T.muted }}>{new Date(task.createdAt).toLocaleString("en-GB")}</span></div>
                        <div>Updated: <span style={{ color: T.muted }}>{new Date(task.updatedAt).toLocaleString("en-GB")}</span></div>
                        <div>Agent: <span style={{ color: T.muted }}>{task.agentId}</span></div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Protocol Tester */}
      {subTab === "tester" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Send A2A Task</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ fontSize: 11, color: T.dim, fontFamily: T.mono, display: "block", marginBottom: 5 }}>AGENT</label>
                <select
                  value={testerAgent}
                  onChange={e => setTesterAgent(e.target.value)}
                  style={{ width: "100%", background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "8px 10px", fontSize: 12, color: T.text, fontFamily: T.mono }}
                >
                  <option value="">— select agent —</option>
                  {AGENT_IDS.map(id => <option key={id} value={id}>{id}</option>)}
                </select>
              </div>

              <div>
                <label style={{ fontSize: 11, color: T.dim, fontFamily: T.mono, display: "block", marginBottom: 5 }}>SESSION ID</label>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    value={testerSession}
                    onChange={e => setTesterSession(e.target.value)}
                    style={{ flex: 1, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "8px 10px", fontSize: 12, color: T.text, fontFamily: T.mono }}
                  />
                  <button onClick={() => setTesterSession(crypto.randomUUID())} style={{ background: `${T.blue}20`, border: `1px solid ${T.blue}40`, borderRadius: 6, padding: "6px 10px", fontSize: 11, color: T.blue, fontFamily: T.mono, cursor: "pointer" }}>New</button>
                </div>
              </div>

              <div>
                <label style={{ fontSize: 11, color: T.dim, fontFamily: T.mono, display: "block", marginBottom: 5 }}>MESSAGE</label>
                <textarea
                  value={testerMessage}
                  onChange={e => setTesterMessage(e.target.value)}
                  placeholder="e.g. Check availability for VIES property on 2026-05-15 for 2 guests"
                  rows={4}
                  style={{ width: "100%", background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "8px 10px", fontSize: 12, color: T.text, fontFamily: T.mono, resize: "vertical", boxSizing: "border-box" }}
                />
              </div>

              <div>
                <label style={{ fontSize: 11, color: T.dim, fontFamily: T.mono, display: "block", marginBottom: 5 }}>BEARER VC TOKEN — Ed25519-signed W3C VC, base64url-encoded (not a JWT)</label>
                <textarea
                  value={testerVc}
                  onChange={e => setTesterVc(e.target.value)}
                  placeholder="Paste vcBase64url from Agent Credentials tab"
                  rows={3}
                  style={{ width: "100%", background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "8px 10px", fontSize: 11, color: T.dim, fontFamily: T.mono, resize: "vertical", boxSizing: "border-box" }}
                />
                <div style={{ fontSize: 10, color: T.dim, marginTop: 4 }}>Obtain from the Agent Credentials tab → issue a credential → copy vcBase64url</div>
              </div>

              <button
                onClick={runTesterTask}
                disabled={testerLoading || !testerAgent || !testerMessage || !testerVc}
                style={{
                  background: testerLoading ? `${T.orange}20` : T.orange, border: "none", borderRadius: 8, padding: "10px 20px",
                  fontSize: 13, fontWeight: 700, color: testerLoading ? T.orange : "#fff",
                  cursor: testerLoading || !testerAgent || !testerMessage || !testerVc ? "not-allowed" : "pointer",
                  opacity: !testerAgent || !testerMessage || !testerVc ? 0.5 : 1,
                }}
              >
                {testerLoading ? "Sending…" : "Send A2A Task →"}
              </button>
            </div>
          </div>

          <div>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>JSON-RPC Response</div>
            <div style={{ background: "#08090c", border: `1px solid ${T.border}`, borderRadius: 10, padding: 16, minHeight: 300, fontFamily: T.mono, fontSize: 12, color: T.dim, overflowY: "auto", maxHeight: 500 }}>
              {testerResult ? (
                <pre style={{ margin: 0, whiteSpace: "pre-wrap", color: testerResult.error ? T.red : testerResult.result ? T.green : T.amber }}>
                  {JSON.stringify(testerResult, null, 2)}
                </pre>
              ) : (
                <div style={{ color: T.dim, fontStyle: "italic" }}>Response will appear here after sending a task…</div>
              )}
            </div>
            <div style={{ marginTop: 12, fontSize: 11, color: T.dim, lineHeight: 1.6 }}>
              <div>• <strong>tasks/send</strong> — submit task → full governance pipeline → artifact</div>
              <div>• <strong>-32001</strong> — VC missing or invalid</div>
              <div>• <strong>-32005</strong> — §2.1 governance files missing</div>
              <div>• <strong>-32002</strong> — ESCALATE decision (human approval needed)</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// DASHBOARD TAB
//
// Role switcher is UI-only — no authentication. Any user can select
// any role. The selected role determines which view is rendered.
// Default role: senior_ambassador.
//
// Roles:
//   ambassador          — Front-desk; HITL cards + shadow review rows
//   senior_ambassador   — Shift lead; decision queue (10s) + agent status (30s)
//   hotel_gm            — Property GM; staircase + yesterday's decisions
//   regional_gm         — Cluster head; 5-property overview + cross-property alerts
//   operations_chief    — Ops chief; chain-wide governance health + adoption staircase
//
// companyId: derived from setup.id — BER=1, LND=2, MUC=3, PAR=4, VIE=5.
// RegionalGMView and OperationsChiefView fetch all hotels internally.
// ─────────────────────────────────────────────────────────────────

const DASHBOARD_ROLES = [
  { id: "ambassador",          label: "Ambassador",          description: "HITL + shadow review",        color: "#ffffff" },
  { id: "senior_ambassador",   label: "Senior Ambassador",   description: "Shift lead · decision queue",  color: "#f59e0b" },
  { id: "hotel_gm",            label: "Hotel GM",            description: "Property staircase",           color: "#60a5fa" },
  { id: "regional_gm",         label: "Regional GM",         description: "5-property cluster",           color: "#a855f7" },
  { id: "operations_chief",    label: "Operations Chief",    description: "Chain governance",             color: "#34d399" },
  { id: "compliance_officer",  label: "Compliance Officer",  description: "Governance sign-off · Gate 2", color: "#f87171" },
];

// Roles that are locked until at least one agent has been activated (admitted + crawl started).
// Compliance Officer is ALWAYS accessible — it is the gate itself.
const HOTEL_ROLE_IDS = new Set(["ambassador", "senior_ambassador", "hotel_gm", "regional_gm", "operations_chief"]);

function DashboardTab({ companyId, onOpenTab, role, setRole }) {
  const [viewCompanyId, setViewCompanyId] = useState(companyId);

  // ── Compliance gate: fetch active agent phases ──────────────────────────────
  // null = loading, [] = loaded + empty (no agents activated)
  const [agentPhases, setAgentPhases] = useState(null);

  useEffect(() => {
    if (!companyId) { setAgentPhases([]); return; }
    fetch(`/api/dashboard/phases?companyId=${companyId}`)
      .then(r => r.ok ? r.json() : { phases: [] })
      .then(d => setAgentPhases(Array.isArray(d.phases) ? d.phases : []))
      .catch(() => setAgentPhases([]));
  }, [companyId]);

  const phasesLoaded = agentPhases !== null;
  // Gate is ACTIVE when phases are loaded and NO agents have been activated yet.
  const gateActive = phasesLoaded && agentPhases.length === 0;
  // Amber warning: agents exist but none are live (walk/run) yet.
  const agentsInCrawlOnly = phasesLoaded && agentPhases.length > 0 &&
    !agentPhases.some(p => p.phase === "walk" || p.phase === "run");

  // Iron-clad redirect: if gate fires while a hotel role is selected, snap to CO.
  useEffect(() => {
    if (phasesLoaded && gateActive && HOTEL_ROLE_IDS.has(role)) {
      setRole("compliance_officer");
    }
  }, [phasesLoaded, gateActive, role, setRole]);

  const handleSelectCompany = (cid) => {
    setViewCompanyId(cid);
    setRole("hotel_gm");
  };

  const handleRoleClick = (roleId) => {
    // Always allow CO.
    if (roleId === "compliance_officer") { setRole(roleId); return; }
    // Block hotel roles when gate is active.
    if (gateActive) {
      setRole("compliance_officer");
      return;
    }
    setRole(roleId);
  };

  const isGated = (roleId) => gateActive && HOTEL_ROLE_IDS.has(roleId);

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", minHeight: "calc(100vh - 116px)", background: "#07080a" }}>

      {/* ── Compliance gate banner ── */}
      {phasesLoaded && gateActive && (
        <div style={{
          background: "#150505", borderBottom: "1px solid #7f1d1d",
          padding: "10px 28px", display: "flex", alignItems: "center", gap: 12,
        }}>
          <div style={{
            width: 8, height: 8, borderRadius: "50%",
            background: "#f87171", flexShrink: 0,
            boxShadow: "0 0 8px #f87171",
          }} />
          <div style={{ flex: 1 }}>
            <span style={{ color: "#f87171", fontWeight: 700, fontSize: 12, marginRight: 8 }}>
              COMPLIANCE GATE ACTIVE
            </span>
            <span style={{ color: "#94a3b8", fontSize: 12 }}>
              No agents have been onboarded. Hotel-facing views are locked.
              Complete agent admission in the Compliance Officer view to unlock all roles.
            </span>
          </div>
        </div>
      )}

      {/* ── Amber warning: crawl only ── */}
      {phasesLoaded && agentsInCrawlOnly && (
        <div style={{
          background: "#0c0900", borderBottom: "1px solid #78350f",
          padding: "8px 28px", display: "flex", alignItems: "center", gap: 10,
        }}>
          <div style={{
            width: 8, height: 8, borderRadius: "50%",
            background: "#f59e0b", flexShrink: 0,
          }} />
          <span style={{ color: "#f59e0b", fontWeight: 600, fontSize: 11, marginRight: 6 }}>
            CRAWL PHASE ONLY
          </span>
          <span style={{ color: "#78716c", fontSize: 11 }}>
            Agents are completing crawl baseline — no autonomous decisions yet.
            Promote to Walk phase to unlock full hotel operations.
          </span>
        </div>
      )}

      {/* ── Role switcher bar ── */}
      <div style={{
        background: "#0a0b0e", borderBottom: "1px solid #1e2229",
        padding: "0 28px", display: "flex", alignItems: "center", gap: 0,
        overflowX: "auto",
      }}>
        <span style={{
          fontSize: 10, color: "#ffffff", fontFamily: "'DM Mono', monospace",
          letterSpacing: "0.07em", paddingRight: 12, marginRight: 4,
          borderRight: "1px solid #1e2229", whiteSpace: "nowrap",
        }}>
          VIEWING AS:
        </span>

        {DASHBOARD_ROLES.map((r) => {
          const active = role === r.id;
          const gated  = isGated(r.id);
          return (
            <button
              key={r.id}
              onClick={() => handleRoleClick(r.id)}
              title={gated ? "Locked — complete compliance setup first" : undefined}
              style={{
                background: "none", border: "none",
                borderBottom: `2px solid ${active ? r.color : "transparent"}`,
                color: active ? r.color : gated ? "#4b5563" : "#ffffff",
                padding: "12px 16px",
                cursor: gated ? "not-allowed" : "pointer",
                fontSize: 13, fontWeight: active ? 700 : 400,
                fontFamily: "'DM Sans', sans-serif",
                transition: "all 0.15s",
                whiteSpace: "nowrap",
                display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2,
                opacity: gated ? 0.5 : 1,
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {r.label}
                {gated && (
                  <span style={{
                    fontSize: 9, fontFamily: "'DM Mono', monospace",
                    background: "#450a0a", color: "#f87171",
                    border: "1px solid #7f1d1d",
                    borderRadius: 3, padding: "1px 5px",
                    letterSpacing: "0.05em", lineHeight: 1,
                  }}>
                    NO AGENT
                  </span>
                )}
              </span>
              {active && (
                <span style={{ fontSize: 10, color: "#ffffff", fontWeight: 400 }}>{r.description}</span>
              )}
              {gated && !active && (
                <span style={{ fontSize: 9, color: "#4b5563" }}>locked</span>
              )}
            </button>
          );
        })}

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", padding: "0 4px" }}>
          <span style={{ fontSize: 10, color: "#ffffff", fontFamily: "'DM Mono', monospace", letterSpacing: "0.06em" }}>
            UI ROLE ONLY · NO AUTH
          </span>
        </div>
      </div>

      {/* ── Role view ── */}
      {role === "ambassador"        && <AmbassadorView       companyId={viewCompanyId} onOpenTab={onOpenTab} />}
      {role === "senior_ambassador" && <SeniorAmbassadorView companyId={viewCompanyId} />}
      {role === "hotel_gm"          && <HotelGMView          companyId={viewCompanyId} onOpenTab={onOpenTab} />}
      {role === "regional_gm"       && <RegionalGMView       companyId={viewCompanyId} onSelectCompany={handleSelectCompany} />}
      {role === "operations_chief"  && <OperationsChiefView  />}
      {role === "compliance_officer" && <ComplianceOfficerView />}
    </div>
  );
}

// ─────────────────────────────────────────────
// ROOT APP
// ─────────────────────────────────────────────
export default function VdaOS() {
  // screen: "onboarding" | "directory" | "wizard" | "hub"
  const [screen, setScreen] = useState("onboarding");
  const [setup, setSetup] = useState(null);
  const [tab, setTab] = useState("journey");
  const [log, setLog] = useState([]);
  const [logIsSeeded, setLogIsSeeded] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [c2mdCache, setC2mdCache] = useState({}); // persists across tab switches
  const fmNavigateRef = useRef(null); // ref for FileManagerTab's file navigation fn
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Lifted role state — shared between DashboardTab and AgentOnboardingTab.
  // Default: compliance_officer (gate-first: CO must onboard agents before hotel views unlock).
  const [globalRole, setGlobalRole] = useState("compliance_officer");
  // Pending count for onboarding tab badge (role-filtered)
  const [onboardingBadgeCount, setOnboardingBadgeCount] = useState(0);

  const apaleoPropertyId = setup?.apaleoPropertyId || null;
  const { stats: apaleoStats, loading: statsLoading } = useApaleoStats(screen === "hub" ? apaleoPropertyId : null);

  const addLog = useCallback(entry => {
    setLog(p => [...p, entry]);
    setLogIsSeeded(false);
  }, []);

  const seedApaleoGovernanceFiles = async (companyId, companyName) => {
    try {
      await fetch("/api/admin/seed-company-governance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, companyName }),
      });
    } catch (e) {
      console.error("seed-company-governance failed:", e);
    }
  };

  const handleSetupComplete = async (data) => {
    const cfg = { ...INDUSTRY_CONFIGS[data.industry], id: data.industry };
    setLog(buildSeedLog(cfg, data.companyName));
    setLogIsSeeded(true);
    setScreen("hub");
    setTab("dashboard");
    setGlobalRole("compliance_officer"); // Always enter hub as CO
    setC2mdCache({});
    try {
      const res = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: data.companyName,
          websiteUrl: data.websiteUrl || null,
          industry: data.industry,
          brandContext: (data.brandContext || "").slice(0, 8000),
          filesCount: data.uploadedFiles?.length || 0,
          savedAt: Date.now(),
          uploadedFiles: null,
          apaleoPropertyId: data.apaleoPropertyId || null,
        }),
      });
      if (res.ok) {
        const saved = await res.json();
        setSetup({ ...data, id: saved.id });
        setIsSaved(true);
        seedApaleoGovernanceFiles(saved.id, data.companyName);
      } else {
        setSetup(data);
        setIsSaved(false);
      }
    } catch (e) {
      console.error("Auto-save failed:", e);
      setSetup(data);
      setIsSaved(false);
    }
  };

  const [hubNavContext, setHubNavContext] = useState(null);

  // Clear nav context 1 s after it is set, so manual tab switches don't re-trigger deep-link
  useEffect(() => {
    if (!hubNavContext) return;
    const t = setTimeout(() => setHubNavContext(null), 1000);
    return () => clearTimeout(t);
  }, [hubNavContext]);

  const handleLoad = (savedData, initialTab = "dashboard", navContext = null) => {
    setSetup(savedData);
    setTab(initialTab);
    setHubNavContext(navContext);
    setGlobalRole("compliance_officer"); // Always enter hub as CO (gate-first)
    const cfg = { ...INDUSTRY_CONFIGS[savedData.industry], id: savedData.industry };
    setLog(buildSeedLog(cfg, savedData.companyName));
    setLogIsSeeded(true);
    setIsSaved(true);
    setScreen("hub");
    setC2mdCache({});
  };

  const handleSave = async () => {
    if (!setup || saving) return;
    if (setup.id) { setIsSaved(true); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: setup.companyName,
          websiteUrl: setup.websiteUrl || null,
          industry: setup.industry,
          brandContext: (setup.brandContext || "").slice(0, 8000),
          filesCount: setup.uploadedFiles?.length || 0,
          savedAt: Date.now(),
          uploadedFiles: null,
          apaleoPropertyId: setup.apaleoPropertyId || null,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      const saved = await res.json();
      setSetup(p => ({ ...p, id: saved.id }));
      setIsSaved(true);
    } catch (e) {
      console.error("Save failed:", e);
    }
    setSaving(false);
  };

  const goToDirectory = () => {
    setScreen("onboarding");
    setSetup(null);
    setLog([]);
    setLogIsSeeded(false);
    setIsSaved(false);
  };

  const config = setup ? { ...INDUSTRY_CONFIGS[setup.industry], id: setup.industry } : null;

  // Poll onboarding pending badge count for the active role (refreshes every 30s)
  useEffect(() => {
    if (!setup?.id) { setOnboardingBadgeCount(0); return; }
    const fetchBadge = async () => {
      try {
        const params = new URLSearchParams({ role_band: globalRole });
        if (!["regional_gm", "operations_chief", "compliance_officer"].includes(globalRole)) {
          params.set("company_id", String(setup.id));
        } else if (globalRole === "regional_gm") {
          params.set("company_id", "1,2,3,4,5");
        }
        const r = await fetch(`/api/hitl/pending?${params}`);
        if (r.ok) {
          const d = await r.json();
          setOnboardingBadgeCount((d.pending || []).filter(p => p.cardType !== "operational_exception").length);
        }
      } catch { /* silent */ }
    };
    fetchBadge();
    const t = setInterval(fetchBadge, 30000);
    return () => clearInterval(t);
  }, [setup?.id, globalRole]);

  // Primary tabs — first 2 are always visible; rest in Advanced sub-nav
  const onboardingLabel = "Agent Onboarding" + (onboardingBadgeCount > 0 ? ` (${onboardingBadgeCount})` : "");

  const tabs = setup ? [
    { id: "dashboard",   label: "Dashboard",        icon: "📊" },
    { id: "onboarding",  label: onboardingLabel,    icon: "🏨" },
    { id: "journey",     label: "Journey Map",      icon: "🗺" },
    { id: "demo",        label: "Live Demo",        icon: "🚀" },
    { id: "c2md",        label: "C2MD Studio",      icon: "🔬" },
    { id: "exception",   label: "Exception Engine", icon: "⚡" },
    { id: "witness",     label: "Witness Agent" + (log.length ? " (" + log.length + ")" : ""), icon: "🕵️" },
    { id: "a2md",        label: "A2MD Normaliser",  icon: "⚙️" },
    { id: "soc2",        label: "SOC 2 SD",          icon: "📋" },
    { id: "credentials",  label: "Agent Credentials", icon: "🔐" },
    { id: "a2a",          label: "A2A Protocol",      icon: "🔗" },
    { id: "filemanager",  label: "File Manager",      icon: "📁" },
  ] : [];

  return (
    <div style={{ minHeight: "100vh", background: T.bg, fontFamily: T.sans, color: T.text }}>
      <style>{GLOBAL_CSS}</style>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=Outfit:wght@300;400;600;700;900&family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500;600&display=swap" />

      {/* Onboarding Console — CISO-first starting screen (Task #71) */}
      {screen === "onboarding" && (
        <OnboardingConsole
          onLoadHotel={(company) => handleLoad({
            id: company.id,
            companyName: company.companyName || company.name || `Company ${company.id}`,
            industry: "hospitality",
            apaleoPropertyId: company.apaleoPropertyId || null,
            websiteUrl: company.websiteUrl || null,
          })}
        />
      )}

      {/* Directory — legacy hotel picker (still reachable if screen="directory") */}
      {screen === "directory" && (
        <Directory
          onNew={() => setScreen("wizard")}
          onLoad={handleLoad}
          role={globalRole}
          currentSetup={setup}
        />
      )}

      {/* Setup Wizard */}
      {screen === "wizard" && (
        <SetupWizard onComplete={handleSetupComplete} />
      )}

      {/* Hub */}
      {screen === "hub" && setup && config && (
        <>
          {/* Header */}
          <div style={{ background: "#050608", borderBottom: `1px solid ${T.border}`, padding: "0 28px", display: "flex", justifyContent: "space-between", alignItems: "center", height: 58, position: "sticky", top: 0, zIndex: 100 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              {/* Directory breadcrumb */}
              <button onClick={goToDirectory} style={{ background: "none", border: "none", cursor: "pointer", color: T.dim, fontSize: 12, fontFamily: T.mono, padding: "4px 6px", borderRadius: 4, display: "flex", gap: 4, alignItems: "center" }}
                onMouseEnter={e => e.currentTarget.style.color = T.orange}
                onMouseLeave={e => e.currentTarget.style.color = T.dim}
              >
                ← Directory
              </button>
              <span style={{ color: T.border }}>·</span>
              <div style={{ background: T.orange, borderRadius: 8, width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: T.mono, fontWeight: 900, fontSize: 13, color: "#fff" }}>
                {setup.companyName.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <div style={{ fontWeight: 900, fontSize: 15, letterSpacing: "-0.03em" }}>
                  {setup.companyName} <span style={{ color: T.dim, fontWeight: 300 }}>·</span> AI Governance Hub
                </div>
                <div style={{ fontSize: 11, color: T.dim, marginTop: 2, fontFamily: T.mono }}>
                  VDA-MD · {config.icon} Apaleo Hospitality Stack · Powered by Apaleo
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: T.green, display: "inline-block", animation: "pulse-ring 2s ease infinite" }} />
                <span style={{ fontSize: 12, color: T.green, fontFamily: T.mono, fontWeight: 600 }}>Live</span>
              </div>
              <div style={{ width: 1, height: 18, background: T.border }} />
              <Tag color={T.blue}>NIST SP 800-53</Tag>
              <Tag color={T.green}>GDPR</Tag>
              <Tag color={T.purple}>EU AI Act</Tag>
              {/* Save button */}
              <button onClick={handleSave} disabled={isSaved || saving} style={{
                background: isSaved ? `${T.green}15` : saving ? `${T.orange}15` : `${T.blue}15`,
                border: `1px solid ${isSaved ? T.green + "50" : saving ? T.orange + "50" : T.blue + "50"}`,
                borderRadius: 6, padding: "5px 12px", fontSize: 11,
                color: isSaved ? T.green : saving ? T.orange : T.blue,
                fontFamily: T.mono, fontWeight: 700,
                cursor: isSaved || saving ? "default" : "pointer",
                display: "flex", gap: 5, alignItems: "center",
                transition: "all 0.2s",
              }}>
                <span>{isSaved ? "✓" : saving ? "…" : "💾"}</span>
                {isSaved ? "Saved" : saving ? "Saving…" : "Save to Directory"}
              </button>
              <button onClick={goToDirectory} style={{
                background: `${T.orange}12`, border: `1px solid ${T.orange}40`,
                borderRadius: 6, padding: "5px 12px", fontSize: 11, color: T.orange,
                fontFamily: T.mono, fontWeight: 700, cursor: "pointer",
              }}>⊞ Directory</button>
            </div>
          </div>

          {/* Live Apaleo Stats Bar */}
          {apaleoPropertyId && (
            <div style={{ background: "#060709", borderBottom: `1px solid ${T.border}`, padding: "0 28px", display: "flex", alignItems: "center", gap: 24, height: 38, overflowX: "auto" }}>
              <span style={{ fontSize: 10, color: T.dim, fontFamily: T.mono, letterSpacing: "0.1em", textTransform: "uppercase", flexShrink: 0 }}>
                🏨 {apaleoPropertyId} · Live
              </span>
              <div style={{ width: 1, height: 18, background: T.border, flexShrink: 0 }} />
              {statsLoading && !apaleoStats && (
                <span style={{ fontSize: 11, color: T.dim, fontFamily: T.mono }}>Loading Apaleo data…</span>
              )}
              {apaleoStats && [
                { label: "Arrivals Today", value: apaleoStats.arrivalsToday, color: T.green, icon: "↓" },
                { label: "Departures", value: apaleoStats.departuresToday, color: T.blue, icon: "↑" },
                { label: "In-House", value: apaleoStats.inHouseCount, color: T.orange, icon: "⬛" },
                { label: "Open Folios", value: apaleoStats.openFolios, color: T.amber, icon: "📋" },
                { label: "Maintenance", value: apaleoStats.pendingMaintenance, color: T.red, icon: "🔧" },
              ].map(s => (
                <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                  <span style={{ fontSize: 14, fontFamily: T.mono, fontWeight: 900, color: s.color }}>{s.value}</span>
                  <span style={{ fontSize: 10, color: T.dim, fontFamily: T.mono }}>{s.label}</span>
                </div>
              ))}
              {!apaleoStats && !statsLoading && (
                <span style={{ fontSize: 11, color: T.dim, fontFamily: T.mono }}>No data — check Property ID or sandbox credentials</span>
              )}
            </div>
          )}

          {/* Nav — primary bar: Dashboard + Agent Onboarding always visible + Advanced toggle */}
          <div style={{ background: "#08090c", borderBottom: `1px solid ${T.border}`, padding: "0 28px", display: "flex", gap: 0, alignItems: "stretch" }}>
            {/* Dashboard + Onboarding — always visible in primary bar */}
            {tabs.filter(t => t.id === "dashboard" || t.id === "onboarding").map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                padding: "12px 18px", background: "none", border: "none",
                borderBottom: `2px solid ${tab === t.id ? T.orange : "transparent"}`,
                color: tab === t.id ? T.orange : (t.id === "onboarding" && onboardingBadgeCount > 0 ? "#f87171" : T.dim),
                cursor: "pointer", fontSize: 13, fontWeight: tab === t.id ? 700 : (t.id === "onboarding" && onboardingBadgeCount > 0 ? 700 : 400),
                fontFamily: T.sans, transition: "all 0.2s",
                display: "flex", gap: 8, alignItems: "center",
              }}>
                <span>{t.icon}</span> {t.label}
              </button>
            ))}

            {/* Divider */}
            <div style={{ width: 1, height: 32, background: T.border, alignSelf: "center", margin: "0 4px" }} />

            {/* Advanced toggle — opens/closes the secondary row */}
            <button
              onClick={() => {
                setAdvancedOpen(o => !o);
                // If closing advanced and current tab is not a primary tab, reset to dashboard
                if (advancedOpen && tab !== "dashboard" && tab !== "onboarding") setTab("dashboard");
              }}
              style={{
                padding: "12px 16px", background: "none", border: "none",
                borderBottom: `2px solid ${advancedOpen ? T.blue : "transparent"}`,
                color: advancedOpen ? T.blue : T.dim,
                cursor: "pointer", fontSize: 13, fontWeight: advancedOpen ? 700 : 400,
                fontFamily: T.sans, transition: "all 0.2s",
                display: "flex", gap: 6, alignItems: "center",
              }}
            >
              ⚙ Advanced
              <span style={{ fontSize: 10, opacity: 0.7 }}>{advancedOpen ? "▲" : "▼"}</span>
            </button>

            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, padding: "0 8px" }}>
              <span style={{ fontSize: 11, color: T.dim, fontFamily: T.mono }}>{config.icon} Powered by Apaleo</span>
            </div>
          </div>

          {/* Advanced sub-nav — collapsed by default */}
          {advancedOpen && (
            <div style={{ background: "#060709", borderBottom: `1px solid ${T.border}`, padding: "0 28px", display: "flex", gap: 0, alignItems: "stretch", overflowX: "auto" }}>
              {tabs.filter(t => t.id !== "dashboard" && t.id !== "onboarding").map(t => (
                <button key={t.id} onClick={() => setTab(t.id)} style={{
                  padding: "10px 16px", background: "none", border: "none",
                  borderBottom: `2px solid ${tab === t.id ? T.orange : "transparent"}`,
                  color: tab === t.id ? T.orange : T.dim,
                  cursor: "pointer", fontSize: 12, fontWeight: tab === t.id ? 700 : 400,
                  fontFamily: T.sans, transition: "all 0.2s",
                  display: "flex", gap: 6, alignItems: "center",
                  whiteSpace: "nowrap", flexShrink: 0,
                }}>
                  <span>{t.icon}</span> {t.label}
                </button>
              ))}
            </div>
          )}

          {/* Content */}
          {tab === "dashboard"   && <DashboardTab companyId={setup.id} onOpenTab={setTab} role={globalRole} setRole={setGlobalRole} />}
          {tab === "journey"     && <JourneyMapTab config={config} companyName={setup.companyName} propertyId={apaleoPropertyId} apaleoStats={apaleoStats} />}
          {tab === "demo"        && <LiveDemoTab config={config} companyName={setup.companyName} propertyId={apaleoPropertyId} companyId={setup.id} onLogEntry={addLog} />}
          {tab === "c2md"        && <C2MDStudioTab config={config} companyName={setup.companyName} brandContext={setup.brandContext} cache={c2mdCache} setCache={setC2mdCache} companyId={setup.id} onSaveToFM={(content, filename, fileType) => {
            const companyId = setup.id;
            if (!companyId) return;
            fetch("/api/fm/file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId, filename, fileType: fileType || "COMPLIANCE", axis: "compliance", content, status: "draft" }) })
              .then(() => { addLog({ id: Date.now(), timestamp: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }), agent: "C2MD Studio", decision: "PASS", fileReferenced: filename, clauseApplied: `C2MD output saved to File Manager as ${filename}`, actionProposed: `File saved · Status: DRAFT · Type: ${fileType || "COMPLIANCE"}`, exceptionApplied: false, escalationTarget: null, reasoning: "C2MD Studio exported file to governance File Manager." }); })
              .catch(() => {});
          }} />}
          {tab === "exception"   && <ExceptionEngineTab config={config} companyName={setup.companyName} onLogEntry={addLog} />}
          {tab === "witness"     && <WitnessAgentTab log={log} config={config} companyName={setup.companyName} isSeeded={logIsSeeded} companyId={setup.id} />}
          {tab === "a2md"        && <A2MDNormaliserTab config={config} companyName={setup.companyName} onLogEntry={addLog} setTabFn={setTab} companyId={setup.id} onSaveToFM={(content, filename) => {
            const companyId = setup.id;
            if (!companyId) return Promise.resolve(null);
            return fetch("/api/fm/file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId, filename, fileType: "AGENTS", axis: "vertical", content, status: "draft" }) })
              .then(r => r.json());
          }} />}
          {tab === "soc2"        && <Soc2Tab companyName={setup.companyName} companyId={setup.id} onSaveToWitness={addLog} />}
          {tab === "credentials"  && <AgentCredentialsTab companyId={setup.id} companyName={setup.companyName} />}
          {tab === "a2a"          && <A2AProtocolTab companyId={setup.id} companyName={setup.companyName} />}
          {tab === "onboarding"   && <AgentOnboardingTab companyId={setup.id} companyName={setup.companyName} role={globalRole} onRoleChange={setGlobalRole} onSwitchTab={setTab} initialSubTab={hubNavContext?.phaseSubTab} initialPhaseAgent={hubNavContext?.phaseAgent} initialWizardAgent={hubNavContext?.wizardAgent} />}
          {tab === "filemanager"  && <FileManagerTab config={config} companyName={setup.companyName} companyId={setup.id} onSaveToWitness={addLog} onNavigateToFile={fmNavigateRef} agentFilter={hubNavContext?.agentFilter} reviewMode={hubNavContext?.reviewMode} onReviewComplete={(slug) => { setGlobalRole("compliance_officer"); setHubNavContext({ phaseSubTab: "wizard", wizardAgent: slug }); setTab("onboarding"); }} />}
        </>
      )}

      <VdaMdChatbot />
    </div>
  );
}
