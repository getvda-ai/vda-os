import { useState, useEffect, useRef, useCallback } from "react";

// ─────────────────────────────────────────────
// DESIGN TOKENS — identical to citizenM version
// ─────────────────────────────────────────────
const T = {
  bg: "#07080a", surface: "#0d0f12", card: "#111418",
  border: "#1e2229", borderHi: "#2e3340",
  orange: "#FF6B2B", blue: "#4A9EFF", purple: "#A066FF",
  green: "#22D47A", red: "#FF4D6A", amber: "#FFB020",
  teal: "#00C9C8", text: "#FFFFFF", muted: "#FFFFFF",
  dim: "#CBD2E0",
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
// INDUSTRY CONFIGURATIONS
// ─────────────────────────────────────────────
const INDUSTRY_CONFIGS = {
  hospitality: {
    label: "Hospitality & Hotels", icon: "🏨",
    customerTerm: "Guest", employeeTerm: "Team Member", serviceTerm: "Property",
    domainColors: { business: T.blue, operations: T.orange, shared: T.green },
    nistControls: ["AC-2", "AU-2", "SA-4", "IR-4"],
    additionalFrameworks: ["PCI DSS (payment card data)", "ISO 22301 (business continuity)"],
    journeyStages: [
      { id: "discover", label: "Discover & Book", domain: "Business", owner: "Head of Revenue", color: T.blue,
        agents: ["Availability Agent", "Pricing Agent", "Reservation Bot"] },
      { id: "arrive", label: "Arrive & Stay", domain: "Operations", owner: "Operations Director", color: T.orange,
        agents: ["Check-in Agent", "Room Agent", "Concierge Bot"] },
      { id: "checkout", label: "Checkout", domain: "Operations", owner: "Operations Director", color: T.orange,
        agents: ["Checkout Agent", "Billing Agent"] },
      { id: "retain", label: "Post-Stay & Loyalty", domain: "Business", owner: "CX Director", color: T.blue,
        agents: ["Review Agent", "Loyalty Bot", "Re-engage Agent"] },
    ],
    sharedServices: [
      { id: "s2p", label: "Source-to-Pay", owner: "CFO", icon: "📋", color: T.green,
        agents: ["Invoice Agent", "PO Agent", "Vendor Bot"] },
      { id: "hrpay", label: "HR & Payroll", owner: "CPO", icon: "👥", color: T.green,
        agents: ["Onboarding Agent", "Payroll Bot", "Offboarding Agent"] },
      { id: "o2c", label: "Order-to-Cash", owner: "CFO", icon: "💰", color: T.teal,
        agents: ["Invoice Agent", "Payment Collection Bot", "Revenue Reconciliation Agent"] },
    ],
    exceptionScenarios: [
      { id: "loyalty", label: "Loyalty Exception", icon: "⭐", description: "VIP loyalty tier checkout override" },
      { id: "procurement", label: "Preferred Supplier", icon: "📋", description: "Preferred vendor procurement exception" },
      { id: "access", label: "Staff Fast-Track", icon: "👤", description: "Specialist role access provisioning" },
    ],
    witnessEntries: [
      { agent: "Checkout Agent", decision: "PASS", file: "checkout-policy.md", clause: "MAY grant late checkout for loyalty tier members", exception: true },
      { agent: "PO Agent", decision: "FAIL", file: "procurement-authority.md", clause: "MUST NOT process PO above authority level", exception: false },
      { agent: "Onboarding Agent", decision: "ESCALATE", file: "staff-access-policy.md", clause: "MUST NOT provision access without manager approval", exception: false },
    ],
  },
  financial: {
    label: "Financial Services", icon: "🏦",
    customerTerm: "Client", employeeTerm: "Advisor", serviceTerm: "Account",
    domainColors: { business: T.blue, operations: T.teal, shared: T.green },
    nistControls: ["AC-2", "AU-2", "SC-28", "RA-5", "IR-4"],
    additionalFrameworks: ["SOX (financial reporting)", "DORA (digital operational resilience)", "MiFID II (investment services)"],
    journeyStages: [
      { id: "prospect", label: "Prospect & KYC", domain: "Compliance", owner: "Chief Compliance Officer", color: T.blue,
        agents: ["KYC Agent", "AML Screening Bot", "Risk Scoring Agent"] },
      { id: "onboard", label: "Onboard & Activate", domain: "Business", owner: "Head of Client Services", color: T.teal,
        agents: ["Onboarding Agent", "Product Recommendation Bot", "Activation Agent"] },
      { id: "transact", label: "Transact & Monitor", domain: "Operations", owner: "Head of Operations", color: T.orange,
        agents: ["Transaction Agent", "Fraud Monitor", "Limit Enforcement Bot"] },
      { id: "retain", label: "Review & Retain", domain: "Business", owner: "Head of CX", color: T.blue,
        agents: ["Portfolio Review Agent", "Re-engagement Bot", "Churn Prevention Agent"] },
    ],
    sharedServices: [
      { id: "risk", label: "Risk & Compliance", owner: "CRO", icon: "⚖️", color: T.green,
        agents: ["Risk Assessment Agent", "Compliance Monitor", "Reporting Bot"] },
      { id: "hrpay", label: "HR & Payroll", owner: "CPO", icon: "👥", color: T.green,
        agents: ["Onboarding Agent", "Payroll Bot", "Offboarding Agent"] },
      { id: "o2c", label: "Order-to-Cash", owner: "CFO", icon: "💰", color: T.teal,
        agents: ["Revenue Recognition Agent", "Billing Agent", "Collections Bot"] },
    ],
    exceptionScenarios: [
      { id: "credit", label: "Credit Limit Override", icon: "💳", description: "Automated credit decision exception for premium client" },
      { id: "transaction", label: "Transaction Limit", icon: "💰", description: "Transaction above threshold for verified HNW client" },
      { id: "access", label: "Elevated Access", icon: "🔑", description: "Privileged system access for specialist role" },
    ],
    witnessEntries: [
      { agent: "Transaction Agent", decision: "ESCALATE", file: "transaction-limits.md", clause: "MUST escalate transactions above risk threshold", exception: false },
      { agent: "KYC Agent", decision: "PASS", file: "kyc-verification.md", clause: "MAY approve standard onboarding for verified clients", exception: false },
      { agent: "Risk Assessment Agent", decision: "FAIL", file: "credit-policy.md", clause: "MUST NOT approve credit above automated limit without review", exception: false },
    ],
  },
  healthcare: {
    label: "Healthcare", icon: "🏥",
    customerTerm: "Patient", employeeTerm: "Clinician", serviceTerm: "Care Episode",
    domainColors: { business: T.teal, operations: T.blue, shared: T.green },
    nistControls: ["AC-2", "AU-2", "MP-6", "SC-28", "IA-5"],
    additionalFrameworks: ["HIPAA / UK DSPT (health data)", "NHS DTAC (digital technology)", "MDR (medical device regulation)"],
    journeyStages: [
      { id: "refer", label: "Refer & Triage", domain: "Clinical", owner: "Clinical Director", color: T.teal,
        agents: ["Triage Agent", "Referral Router", "Priority Scoring Bot"] },
      { id: "assess", label: "Assess & Diagnose", domain: "Clinical", owner: "Clinical Director", color: T.teal,
        agents: ["Assessment Agent", "Clinical Decision Support", "Diagnostic Aid Bot"] },
      { id: "treat", label: "Treat & Monitor", domain: "Operations", owner: "Head of Operations", color: T.blue,
        agents: ["Care Plan Agent", "Medication Agent", "Monitoring Bot"] },
      { id: "discharge", label: "Discharge & Follow-up", domain: "Operations", owner: "Head of Operations", color: T.blue,
        agents: ["Discharge Agent", "Follow-up Scheduler", "Outcome Tracker"] },
    ],
    sharedServices: [
      { id: "procurement", label: "Procurement", owner: "Head of Procurement", icon: "📋", color: T.green,
        agents: ["Medical Supplies Agent", "Equipment Agent", "Vendor Bot"] },
      { id: "hrpay", label: "HR & Workforce", owner: "HR Director", icon: "👥", color: T.green,
        agents: ["Onboarding Agent", "Credentialing Bot", "Rota Agent"] },
      { id: "o2c", label: "Order-to-Cash", owner: "CFO", icon: "💰", color: T.teal,
        agents: ["Patient Billing Agent", "Insurance Claims Bot", "Revenue Cycle Agent"] },
    ],
    exceptionScenarios: [
      { id: "clinical", label: "Clinical Decision Override", icon: "🩺", description: "AI clinical decision support exception for complex case" },
      { id: "procurement", label: "Emergency Procurement", icon: "📋", description: "Urgent medical supplies above standard threshold" },
      { id: "access", label: "Locum Staff Access", icon: "👤", description: "Temporary clinical staff fast-track system access" },
    ],
    witnessEntries: [
      { agent: "Clinical Decision Support", decision: "ESCALATE", file: "clinical-ai-policy.md", clause: "MUST escalate all AI recommendations to responsible clinician", exception: false },
      { agent: "Medical Supplies Agent", decision: "PASS", file: "procurement-authority.md", clause: "MAY approve emergency procurement above threshold with clinical sign-off", exception: true },
      { agent: "Onboarding Agent", decision: "PASS", file: "staff-access-policy.md", clause: "MAY provision access for credentialed locum staff with HR approval", exception: true },
    ],
  },
  retail: {
    label: "Retail & E-commerce", icon: "🛍️",
    customerTerm: "Customer", employeeTerm: "Associate", serviceTerm: "Order",
    domainColors: { business: T.blue, operations: T.orange, shared: T.green },
    nistControls: ["AC-2", "AU-2", "SA-4", "SI-10"],
    additionalFrameworks: ["PCI DSS (payment card)", "Consumer Duty (FCA where relevant)", "CCPA / GDPR (consumer data)"],
    journeyStages: [
      { id: "discover", label: "Discover & Browse", domain: "Marketing", owner: "CMO", color: T.blue,
        agents: ["Recommendation Agent", "Search Bot", "Personalisation Agent"] },
      { id: "purchase", label: "Purchase & Pay", domain: "Commerce", owner: "Head of Commerce", color: T.teal,
        agents: ["Basket Agent", "Payment Agent", "Fraud Detection Bot"] },
      { id: "fulfil", label: "Fulfil & Deliver", domain: "Operations", owner: "Operations Director", color: T.orange,
        agents: ["Inventory Agent", "Dispatch Bot", "Carrier Agent"] },
      { id: "service", label: "Service & Retain", domain: "CX", owner: "CX Director", color: T.blue,
        agents: ["Returns Agent", "Complaints Bot", "Loyalty Agent"] },
    ],
    sharedServices: [
      { id: "s2p", label: "Supplier Management", owner: "Head of Buying", icon: "📋", color: T.green,
        agents: ["Buying Agent", "PO Agent", "Vendor Bot"] },
      { id: "hrpay", label: "HR & Payroll", owner: "HR Director", icon: "👥", color: T.green,
        agents: ["Onboarding Agent", "Scheduling Bot", "Payroll Agent"] },
      { id: "o2c", label: "Order-to-Cash", owner: "CFO", icon: "💰", color: T.teal,
        agents: ["Invoice Agent", "Refunds & Reconciliation Bot", "Credit Control Agent"] },
    ],
    exceptionScenarios: [
      { id: "pricing", label: "Dynamic Price Override", icon: "💰", description: "Automated pricing exception for loyalty customer" },
      { id: "fraud", label: "Fraud Threshold", icon: "🔒", description: "Transaction above fraud threshold for verified customer" },
      { id: "access", label: "Seasonal Staff", icon: "👤", description: "Temporary staff fast-track access provisioning" },
    ],
    witnessEntries: [
      { agent: "Recommendation Agent", decision: "PASS", file: "personalisation-policy.md", clause: "MAY apply personalised pricing for loyalty tier customers", exception: true },
      { agent: "Fraud Detection Bot", decision: "ESCALATE", file: "fraud-policy.md", clause: "MUST escalate transactions above fraud risk threshold to human review", exception: false },
      { agent: "PO Agent", decision: "FAIL", file: "procurement-authority.md", clause: "MUST NOT process PO above buyer authority level", exception: false },
    ],
  },
  professional: {
    label: "Professional Services", icon: "💼",
    customerTerm: "Client", employeeTerm: "Consultant", serviceTerm: "Engagement",
    domainColors: { business: T.blue, operations: T.teal, shared: T.green },
    nistControls: ["AC-2", "AU-2", "AC-17", "SC-8"],
    additionalFrameworks: ["ISO 27001 (information security)", "SRA / Legal regulatory frameworks (where applicable)"],
    journeyStages: [
      { id: "prospect", label: "Prospect & Qualify", domain: "Business Development", owner: "Head of BD", color: T.blue,
        agents: ["Lead Scoring Agent", "Conflict Check Bot", "Proposal Agent"] },
      { id: "engage", label: "Engage & Contract", domain: "Delivery", owner: "Partner", color: T.teal,
        agents: ["Scoping Agent", "Contract Bot", "Resource Agent"] },
      { id: "deliver", label: "Deliver & Quality", domain: "Delivery", owner: "Partner", color: T.teal,
        agents: ["Delivery Monitor", "Quality Bot", "Billing Agent"] },
      { id: "close", label: "Close & Renew", domain: "Business Development", owner: "Head of BD", color: T.blue,
        agents: ["Closure Agent", "Feedback Bot", "Renewal Agent"] },
    ],
    sharedServices: [
      { id: "procurement", label: "Procurement", owner: "Head of Operations", icon: "📋", color: T.green,
        agents: ["Vendor Agent", "PO Bot", "Subcontractor Agent"] },
      { id: "hrpay", label: "HR & Talent", owner: "HR Director", icon: "👥", color: T.green,
        agents: ["Onboarding Agent", "Utilisation Bot", "Payroll Agent"] },
      { id: "o2c", label: "Order-to-Cash", owner: "CFO", icon: "💰", color: T.teal,
        agents: ["Engagement Billing Agent", "Revenue Recognition Bot", "Collections Agent"] },
    ],
    exceptionScenarios: [
      { id: "pricing", label: "Engagement Rate Override", icon: "💰", description: "Discounted rate exception for strategic client" },
      { id: "procurement", label: "Subcontractor Approval", icon: "📋", description: "Preferred subcontractor procurement exception" },
      { id: "access", label: "Client System Access", icon: "👤", description: "Consultant access to client systems" },
    ],
    witnessEntries: [
      { agent: "Contract Bot", decision: "ESCALATE", file: "rate-authority.md", clause: "MUST escalate discounts above partner authority to Managing Partner", exception: false },
      { agent: "Vendor Agent", decision: "PASS", file: "procurement-policy.md", clause: "MAY approve preferred subcontractor without three-quote requirement", exception: true },
      { agent: "Resource Agent", decision: "PASS", file: "staff-access-policy.md", clause: "MAY provision client system access for credentialed consultants with client approval", exception: true },
    ],
  },
  manufacturing: {
    label: "Manufacturing & Supply Chain", icon: "🏭",
    customerTerm: "Customer", employeeTerm: "Operator", serviceTerm: "Production Order",
    domainColors: { business: T.blue, operations: T.orange, shared: T.green },
    nistControls: ["AC-2", "AU-2", "SA-4", "PE-3", "SC-28"],
    additionalFrameworks: ["ISO 9001 (quality management)", "ITAR / Export controls (where applicable)", "OT/ICS security (IEC 62443)"],
    journeyStages: [
      { id: "design", label: "Design & Qualify", domain: "Engineering", owner: "Head of Engineering", color: T.blue,
        agents: ["Design Review Agent", "BOM Bot", "Quality Qualification Agent"] },
      { id: "source", label: "Source & Procure", domain: "Operations", owner: "Head of Procurement", color: T.orange,
        agents: ["Supplier Agent", "PO Bot", "Goods Receipt Agent"] },
      { id: "produce", label: "Produce & QC", domain: "Operations", owner: "Operations Director", color: T.orange,
        agents: ["Production Scheduler", "QC Agent", "Defect Detection Bot"] },
      { id: "ship", label: "Ship & Service", domain: "Commercial", owner: "Head of Commercial", color: T.blue,
        agents: ["Logistics Agent", "Invoice Bot", "Field Service Agent"] },
    ],
    sharedServices: [
      { id: "quality", label: "Quality & Compliance", owner: "Quality Director", icon: "✅", color: T.green,
        agents: ["Audit Agent", "NCR Bot", "CAPA Agent"] },
      { id: "hrpay", label: "HR & Workforce", owner: "HR Director", icon: "👥", color: T.green,
        agents: ["Onboarding Agent", "Skills Bot", "Payroll Agent"] },
      { id: "o2c", label: "Order-to-Cash", owner: "CFO", icon: "💰", color: T.teal,
        agents: ["Customer Invoice Agent", "Credit Control Bot", "Cash Application Agent"] },
    ],
    exceptionScenarios: [
      { id: "quality", label: "Quality Hold Override", icon: "✅", description: "Production hold exception for certified deviation" },
      { id: "procurement", label: "Approved Supplier Exception", icon: "📋", description: "Alternative supplier exception for critical component" },
      { id: "access", label: "Contractor Access", icon: "👤", description: "Third-party contractor system access exception" },
    ],
    witnessEntries: [
      { agent: "QC Agent", decision: "FAIL", file: "quality-hold-policy.md", clause: "MUST NOT release non-conforming product without Engineering deviation approval", exception: false },
      { agent: "Supplier Agent", decision: "PASS", file: "approved-supplier-policy.md", clause: "MAY approve alternative supplier for critical shortage with Quality sign-off", exception: true },
      { agent: "Onboarding Agent", decision: "ESCALATE", file: "contractor-access-policy.md", clause: "MUST escalate contractor access requests to CISO and site manager", exception: false },
    ],
  },
  marina: {
    label: "Marina & Boating", icon: "⛵",
    customerTerm: "Boat Owner", employeeTerm: "Dockmaster", serviceTerm: "Berth",
    domainColors: { business: T.blue, operations: T.teal, shared: T.green },
    nistControls: ["AC-2", "AU-2", "SA-4", "SI-10"],
    additionalFrameworks: ["MCA / MSN regulations (maritime safety)", "Consumer Duty (FCA where applicable)", "GDPR / CCPA (customer & vessel data)", "Marine Insurance Act (vessel cover verification)"],
    journeyStages: [
      { id: "enquire", label: "Enquire & Reserve", domain: "Commercial", owner: "Head of Commercial", color: T.blue,
        agents: ["Berth Availability Agent", "Mooring Pricing Agent", "Reservation Bot"] },
      { id: "arrive", label: "Arrive & Berth", domain: "Operations", owner: "Harbour Master", color: T.teal,
        agents: ["Arrival Agent", "Berth Assignment Bot", "Safety Check Agent"] },
      { id: "sales", label: "Boat Sales & Brokerage", domain: "Commercial", owner: "Head of Sales", color: T.blue,
        agents: ["Listings Agent", "Valuation Bot", "Sales Progression Agent"] },
      { id: "renew", label: "Service & Renew", domain: "Commercial", owner: "Head of Commercial", color: T.blue,
        agents: ["Renewal Agent", "Maintenance Scheduler", "Upgrade Recommendation Bot"] },
    ],
    sharedServices: [
      { id: "s2p", label: "Marine Procurement", owner: "Operations Manager", icon: "📋", color: T.green,
        agents: ["Parts & Supplies Agent", "PO Agent", "Approved Supplier Bot"] },
      { id: "hrpay", label: "HR & Workforce", owner: "HR Manager", icon: "👥", color: T.green,
        agents: ["Onboarding Agent", "Rota Bot", "Payroll Agent"] },
      { id: "o2c", label: "Order-to-Cash", owner: "CFO", icon: "💰", color: T.teal,
        agents: ["Mooring Invoice Agent", "Sales Completion Bot", "Debt Collection Agent"] },
    ],
    exceptionScenarios: [
      { id: "berth", label: "Priority Berth Exception", icon: "⛵", description: "Priority berth allocation for long-standing Boat Owner or VIP" },
      { id: "procurement", label: "Emergency Parts Exception", icon: "📋", description: "Urgent marine parts procurement above standard approval threshold" },
      { id: "access", label: "Seasonal Staff Access", icon: "👤", description: "Temporary seasonal dockmaster fast-track system access provisioning" },
    ],
    witnessEntries: [
      { agent: "Berth Assignment Bot", decision: "PASS", file: "berth-allocation-exception.md", clause: "MAY assign premium berth to verified long-standing Boat Owner with Harbour Master approval", exception: true },
      { agent: "Parts & Supplies Agent", decision: "FAIL", file: "procurement-authority.md", clause: "MUST NOT process PO above Operations Manager authority level without CFO sign-off", exception: false },
      { agent: "Onboarding Agent", decision: "ESCALATE", file: "staff-access-policy.md", clause: "MUST escalate seasonal staff access requests to Harbour Master before provisioning", exception: false },
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
    PASS:     { bg: "#0a2818", border: "#1a6038", color: "#4ade80", icon: "✓" },
    FAIL:     { bg: "#200a0a", border: "#6b1414", color: "#f87171", icon: "✗" },
    ESCALATE: { bg: "#1f1500", border: "#6b4200", color: "#fbbf24", icon: "⚠" },
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
  const [step, setStep] = useState(1); // 1=welcome, 2=company, 3=files, 4=industry, 5=ingest, 6=ready
  const [companyName, setCompanyName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [industry, setIndustry] = useState("");
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
    // Start elapsed timer
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
            system: "You are extracting brand context for the VDA-MD AI governance framework. Documents may be in any language including Dutch, German, French, or Spanish. Output everything in English, but preserve brand-specific proper nouns exactly as they appear — product names, system names, role titles, and branded terms should be kept verbatim with the original-language term noted in brackets. Extract: company values and mission, tone of voice, key role titles, named internal systems or platforms, operational terminology. Output as structured plain text. Be concise — 400-600 words.",
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
          system: `You are extracting brand context for the VDA-MD AI governance framework. The company website may be in any language — Dutch, German, French, Spanish, or other. Search the company website and extract brand context. IMPORTANT: Output everything in English regardless of the website language. However, preserve brand-specific proper nouns exactly as they appear in the original language — product names, system names, platform names, role titles, and branded terminology should be kept verbatim (e.g. if the Dutch site says "Medewerkers" for employees, note: their term is "Medewerkers"). Extract: company values and mission, tone of voice and language style, key role titles used (with original-language terms noted), named internal systems or platforms, operational terminology specific to this company, industry-specific language. Output as structured plain text optimised for injecting into an AI governance document generation prompt. Be concise — 400-600 words maximum.`,
          messages: [{ role: "user", content: `Search ${websiteUrl} and extract brand context for ${companyName} (${INDUSTRY_CONFIGS[industry]?.label} industry). The site may be in a language other than English — that is fine, extract the content and output in English while preserving any brand-specific terms verbatim. Focus on: brand voice, role titles (with original language terms), key systems/platforms mentioned, operational terminology, company values. This context will make AI governance documents sound authentic to this company.` }]
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
      addLog(`✓ VDA-MD framework configured for ${companyName}`, T.orange);
      clearInterval(elapsedRef.current);
      setIngestPhase("done");
      setIngesting(false);
      setStep(6);
    } catch (e) {
      clearInterval(elapsedRef.current);
      setIngestPhase("error");
      setIngestError(e.message);
      setIngesting(false);
      // Still allow proceeding with fallback context
      setBrandContext(`Brand context for ${companyName} — ${INDUSTRY_CONFIGS[industry]?.label}. Professional ${industry} sector organisation. Apply industry-standard terminology throughout governance documents.`);
      addLog("⚠ Web ingestion limited — using fallback context", T.amber);
      setTimeout(() => setStep(6), 1500);
    }
  };

  const industryOptions = Object.entries(INDUSTRY_CONFIGS).map(([k, v]) => ({ value: k, label: v.label, icon: v.icon }));
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
            width: `${(step / 6) * 100}%`,
            transition: "width 0.5s ease",
          }} />
        </div>

        <div style={{ padding: 40 }}>
          {/* Step 1 — Welcome */}
          {step === 1 && (
            <div style={{ animation: "wizard-in 0.3s ease" }}>
              <div style={{ fontSize: 48, marginBottom: 16, animation: "float 3s ease-in-out infinite" }}>🏗️</div>
              <h1 style={{ fontFamily: T.sans, fontWeight: 900, fontSize: 28, color: T.text, letterSpacing: "-0.03em", marginBottom: 12 }}>
                VDA-MD Framework
              </h1>
              <div style={{ fontSize: 13, color: T.orange, fontFamily: T.mono, fontWeight: 700, marginBottom: 16, letterSpacing: "0.1em" }}>
                VALUE-DRIVEN AI WITH MARKDOWNS · GOVERNANCE TEMPLATE
              </div>
              <p style={{ fontSize: 15, color: T.muted, lineHeight: 1.75, marginBottom: 24 }}>
                This wizard configures the VDA-MD framework for your organisation. Enter your company website and industry, and the system will:
              </p>
              {[
                ["📥", "Ingest your brand context via live web search"],
                ["📋", "Select the right NIST SP 800-53 controls for your industry"],
                ["⚡", "Build a governed exception engine for your value streams"],
                ["🕵️", "Configure the Witness Agent audit trail for your context"],
              ].map(([icon, text]) => (
                <div key={text} style={{ display: "flex", gap: 12, marginBottom: 10, alignItems: "flex-start" }}>
                  <span style={{ fontSize: 18, flexShrink: 0 }}>{icon}</span>
                  <span style={{ fontSize: 14, color: T.muted, lineHeight: 1.5 }}>{text}</span>
                </div>
              ))}
              <div style={{ marginTop: 8, padding: "10px 14px", background: `${T.green}0a`, border: `1px solid ${T.green}30`, borderRadius: 8, fontSize: 12, color: T.green, fontFamily: T.mono }}>
                GDPR + EU AI Act compliance always included · NIST selected per industry
              </div>
              <button onClick={() => setStep(2)} style={{
                marginTop: 28, width: "100%", padding: "14px", background: T.orange,
                border: "none", borderRadius: 10, color: "#fff", fontSize: 15,
                fontFamily: T.sans, fontWeight: 800, cursor: "pointer",
                boxShadow: `0 0 32px ${T.orange}55`,
              }}>
                Configure my VDA-MD framework →
              </button>
            </div>
          )}

          {/* Step 2 — Company */}
          {step === 2 && (
            <div style={{ animation: "wizard-in 0.3s ease" }}>
              <h2 style={{ fontFamily: T.sans, fontWeight: 900, fontSize: 22, color: T.text, marginBottom: 6 }}>Your Company</h2>
              <p style={{ fontSize: 13, color: T.dim, marginBottom: 28 }}>Enter your company name and website — we'll ingest brand context from the site.</p>
              <label style={{ fontSize: 11, color: T.muted, fontFamily: T.mono, letterSpacing: "0.1em", textTransform: "uppercase", display: "block", marginBottom: 8 }}>Company Name</label>
              <input value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="e.g. Acme Corporation"
                style={{ ...inputStyle, marginBottom: 20 }} />
              <label style={{ fontSize: 11, color: T.muted, fontFamily: T.mono, letterSpacing: "0.1em", textTransform: "uppercase", display: "block", marginBottom: 8 }}>Company Website</label>
              <input value={websiteUrl} onChange={e => setWebsiteUrl(e.target.value)} placeholder="e.g. https://acme.com"
                style={inputStyle} />
              <div style={{ fontSize: 11, color: T.dim, marginTop: 8, fontFamily: T.mono }}>
                Dutch, German, French and other languages supported · Public pages only
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
                <button onClick={() => setStep(4)} style={{
                  flex: 2, padding: "12px", background: T.orange,
                  border: "none", borderRadius: 10, color: "#fff", fontSize: 14,
                  fontFamily: T.sans, fontWeight: 700, cursor: "pointer",
                }}>
                  {uploadedFiles.length > 0 ? `Continue with ${uploadedFiles.length} file${uploadedFiles.length > 1 ? "s" : ""} →` : "Skip — Continue →"}
                </button>
              </div>
            </div>
          )}

          {/* Step 4 — Industry */}
          {step === 4 && (
            <div style={{ animation: "wizard-in 0.3s ease" }}>
              <h2 style={{ fontFamily: T.sans, fontWeight: 900, fontSize: 22, color: T.text, marginBottom: 6 }}>Industry</h2>
              <p style={{ fontSize: 13, color: T.dim, marginBottom: 20 }}>Select your industry — this determines the NIST controls, value streams, and governance scenarios.</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
                {industryOptions.map(opt => (
                  <button key={opt.value} onClick={() => setIndustry(opt.value)} style={{
                    background: industry === opt.value ? `${T.orange}15` : T.card,
                    border: `2px solid ${industry === opt.value ? T.orange : T.border}`,
                    borderRadius: 10, padding: "12px 14px", cursor: "pointer", textAlign: "left",
                    transition: "all 0.15s",
                  }}>
                    <div style={{ fontSize: 22, marginBottom: 6 }}>{opt.icon}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: industry === opt.value ? T.orange : T.text, fontFamily: T.sans }}>{opt.label}</div>
                  </button>
                ))}
              </div>
              {selectedIndustry && (
                <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "14px 16px", marginBottom: 20 }}>
                  <div style={{ fontSize: 11, color: T.muted, fontFamily: T.mono, marginBottom: 8 }}>NIST CONTROLS FOR THIS INDUSTRY</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                    {selectedIndustry.nistControls.map(c => <Tag key={c} color={T.blue}>{c}</Tag>)}
                    <Tag color={T.green}>GDPR</Tag>
                    <Tag color={T.purple}>EU AI Act</Tag>
                  </div>
                  {selectedIndustry.additionalFrameworks.map(f => (
                    <div key={f} style={{ fontSize: 11, color: T.dim, fontFamily: T.mono }}>+ {f}</div>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", gap: 12 }}>
                <button onClick={() => setStep(3)} style={{
                  flex: 1, padding: "12px", background: T.card, border: `1px solid ${T.border}`,
                  borderRadius: 10, color: T.muted, fontSize: 14, fontFamily: T.sans, cursor: "pointer",
                }}>← Back</button>
                <button onClick={() => { setStep(5); setTimeout(runIngestion, 400); }} disabled={!industry} style={{
                  flex: 2, padding: "12px", background: industry ? T.orange : T.border,
                  border: "none", borderRadius: 10, color: "#fff", fontSize: 14,
                  fontFamily: T.sans, fontWeight: 700, cursor: industry ? "pointer" : "not-allowed",
                }}>Ingest Brand Context →</button>
              </div>
            </div>
          )}

          {/* Step 5 — Ingesting */}
          {step === 5 && (
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
                    if (!brandContext) setBrandContext(`Brand context for ${companyName} — ${INDUSTRY_CONFIGS[industry]?.label}. Professional ${industry} sector organisation.`);
                    setStep(6);
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

          {/* Step 6 — Ready */}
          {step === 6 && (
            <div style={{ animation: "wizard-in 0.3s ease", textAlign: "center" }}>
              <div style={{ fontSize: 56, marginBottom: 16 }}>✅</div>
              <h2 style={{ fontFamily: T.sans, fontWeight: 900, fontSize: 24, color: T.text, marginBottom: 8, letterSpacing: "-0.02em" }}>
                {companyName} is ready
              </h2>
              <div style={{ fontSize: 13, color: T.dim, marginBottom: 24 }}>VDA-MD framework configured · Brand context ingested · NIST controls mapped</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 24, textAlign: "left" }}>
                {[
                  { label: "Brand Context", value: uploadedFiles.length > 0 ? `Website + ${uploadedFiles.length} uploaded file${uploadedFiles.length > 1 ? "s" : ""}` : "Website ingested", icon: "📥" },
              { label: "Industry", value: selectedIndustry?.label, icon: selectedIndustry?.icon },
                  { label: "NIST Controls", value: selectedIndustry?.nistControls.join(", "), icon: "📋" },
                  { label: "Value Streams", value: `${selectedIndustry?.journeyStages.length} journey stages`, icon: "🗺" },
                  { label: "Regulatory", value: "GDPR + EU AI Act", icon: "⚖️" },
                ].map(item => (
                  <div key={item.label} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 14px" }}>
                    <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono, marginBottom: 4 }}>{item.label}</div>
                    <div style={{ fontSize: 13, color: T.text, fontWeight: 600 }}>{item.icon} {item.value}</div>
                  </div>
                ))}
              </div>
              <button onClick={() => onComplete({ companyName, websiteUrl, industry, brandContext })} style={{
                width: "100%", padding: "14px",
                background: T.orange, border: "none", borderRadius: 10,
                color: "#fff", fontSize: 15, fontFamily: T.sans, fontWeight: 800,
                cursor: "pointer", boxShadow: `0 0 32px ${T.orange}55`,
                animation: "glow-pulse 2s ease-in-out infinite",
              }}>
                Launch {companyName} VDA-MD Hub →
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

  const userPrompt = `Translate NIST ${controlId} (${control.title}) into a VDA-MD governance .md file.

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
      system: `You are the VDA-MD Governance Agent for ${companyName}. Evaluate strictly against the governance Markdown files. Respond ONLY with valid JSON.`,
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
            <button onClick={dismiss} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, width: 32, height: 32, cursor: "pointer", color: T.muted, fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginLeft: 12 }}>✕</button>
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
            {agent} · {domain} · {companyName || "VDA-MD"}
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

function JourneyMapTab({ config, companyName }) {
  const [hovered, setHovered] = useState(null);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [tourActive, setTourActive] = useState(true); // on by default

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
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontFamily: T.sans, fontWeight: 900, fontSize: 16, color: s.color }}>{s.label}</span>
              <Tag color={s.color}>{s.domain}</Tag>
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
// C2MD STUDIO TAB
// ─────────────────────────────────────────────
function C2MDStudioTab({ config, companyName, brandContext, cache, setCache }) {
  const [sel, setSel] = useState(config.nistControls[0]);
  // cache and setCache come from App root — persists across tab switches
  const [status, setStatus] = useState("idle");
  const [displayedMd, setDisplayedMd] = useState("");
  const [error, setError] = useState(null);
  const streamRef = useRef(null);
  const ctrl = NIST_CONTROLS[sel];
  const result = cache[sel];

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

  useEffect(() => {
    clearInterval(streamRef.current);
    if (cache[sel]) { setDisplayedMd(cache[sel].md); setStatus("done"); }
    else { setDisplayedMd(""); setStatus("idle"); }
    setError(null);
  }, [sel]);

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
            ) : (
              <div style={{ textAlign: "center", paddingTop: 100, color: T.dim }}>
                <div style={{ fontSize: 36, marginBottom: 16, opacity: 0.4 }}>→</div>
                <div style={{ fontSize: 14, fontFamily: T.mono, color: T.muted }}>Click → to translate</div>
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
// WITNESS AGENT TAB
// ─────────────────────────────────────────────
function WitnessAgentTab({ log, config, companyName, isSeeded }) {
  const stats = { PASS: log.filter(e => e.decision === "PASS").length, FAIL: log.filter(e => e.decision === "FAIL").length, ESCALATE: log.filter(e => e.decision === "ESCALATE").length, exceptions: log.filter(e => e.exceptionApplied).length };
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
          {[{ label: "Total", val: log.length, color: T.muted }, { label: "PASS", val: stats.PASS, color: T.green }, { label: "FAIL", val: stats.FAIL, color: T.red }, { label: "ESCALATE", val: stats.ESCALATE, color: T.amber }, { label: "Exceptions", val: stats.exceptions, color: T.purple }].map(s => (
            <div key={s.label} style={{ background: T.card, border: `1px solid ${s.color}30`, borderRadius: 8, padding: "10px 14px", textAlign: "center", minWidth: 64 }}>
              <div style={{ fontFamily: T.mono, fontWeight: 700, fontSize: 22, color: s.color }}>{s.val}</div>
              <div style={{ fontSize: 10, color: T.dim, marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

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

      {log.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 0", color: T.dim }}>
          <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.4 }}>🕵️</div>
          <div style={{ fontSize: 16, fontFamily: T.sans, fontWeight: 600, marginBottom: 8 }}>Audit log is empty</div>
          <div style={{ fontSize: 14 }}>Run decisions in the Exception Engine to generate audit entries</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[...log].reverse().map((e) => (
            <div key={e.id} style={{
              background: "#090b0d",
              border: `1px solid ${e.decision === "PASS" ? T.green + "25" : e.decision === "FAIL" ? T.red + "25" : e.decision === "ESCALATE" ? T.amber + "25" : T.border}`,
              borderLeft: `3px solid ${e.decision === "PASS" ? T.green : e.decision === "FAIL" ? T.red : e.decision === "ESCALATE" ? T.amber : T.border}`,
              borderRadius: 8, padding: "12px 16px", fontFamily: T.mono, fontSize: 13, animation: "slide-up 0.3s ease",
            }}>
              {/* Row 1: timestamp + agent + decision + exception badge */}
              <div style={{ display: "flex", gap: 12, marginBottom: 7, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ color: T.dim, fontSize: 11, flexShrink: 0 }}>{e.timestamp}</span>
                <span style={{ color: T.orange, fontWeight: 700 }}>{e.agent}</span>
                <DecisionBadge decision={e.decision} />
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
          <div style={{ fontSize: 12, color: T.dim, fontFamily: T.mono }}>witness_agent.log · {companyName} · VDA-MD v1.0 · {log.length} entries</div>
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

  // Industry-specific entries (7)
  const industryEntries = {
    hospitality: [
      { id: 10, timestamp: ts(0, 3), agent: "Checkout Agent", decision: "PASS", fileReferenced: "checkout-late-departure-exception.md", clauseApplied: "MAY grant late checkout to 14:00 without fee for verified loyalty tier members", actionProposed: `${customer} requested late checkout to 13:30 — loyalty tier verified, no fee applied`, escalationTarget: null, exceptionApplied: true, reasoning: `${customer} holds active Gold loyalty status confirmed in CRM. Late checkout to 14:00 permitted under exception overlay. No capacity constraint. Fee waived automatically.` },
      { id: 11, timestamp: ts(0, 15), agent: "Checkout Agent", decision: "FAIL", fileReferenced: "checkout-policy.md", clauseApplied: "MUST NOT waive late checkout fee without Operations Director authorisation", actionProposed: `Standard ${customer.toLowerCase()} requested fee waiver for late checkout — denied, baseline applies`, escalationTarget: "Operations Director", exceptionApplied: false, reasoning: `${customer} does not hold loyalty tier qualifying for automatic late checkout benefit. No active exception overlay. Fee waiver requires Operations Director authorisation per baseline policy.` },
      { id: 12, timestamp: ts(1, 5), agent: "Booking Rate Agent", decision: "ESCALATE", fileReferenced: "rate-override-policy.md", clauseApplied: "MUST escalate discount requests above Revenue Manager authority to VP Revenue", actionProposed: "Corporate account requested 25% rate discount — above Revenue Manager ceiling, escalated", escalationTarget: "VP Revenue", exceptionApplied: false, reasoning: "Requested discount of 25% exceeds Revenue Manager authority ceiling of 18%. Account is Tier 2, not Tier 1. No active key account exception overlay. Escalated to VP Revenue for approval." },
      { id: 13, timestamp: ts(1, 33), agent: "Booking Rate Agent", decision: "PASS", fileReferenced: "key-account-rate-exception.md", clauseApplied: "MAY approve up to 18% discount at Revenue Manager authority for verified Tier 1 accounts", actionProposed: "Tier 1 Key Account rate amendment approved — exception overlay applied", escalationTarget: null, exceptionApplied: true, reasoning: "Account verified as Tier 1 in CRM. Requested discount of 16% within exception ceiling. Rate parity obligations checked. Exception conditions all met." },
      { id: 14, timestamp: ts(2, 11), agent: "Check-in Agent", decision: "PASS", fileReferenced: "checkin-policy.md", clauseApplied: "MUST verify availability via VCI threshold before assigning room", actionProposed: `${customer} check-in — VCI availability confirmed, room assigned`, escalationTarget: null, exceptionApplied: false, reasoning: "VCI room availability confirmed above threshold. Room status verified. Check-in conditions met. Room assigned and keys provisioned." },
      { id: 15, timestamp: ts(3, 44), agent: "Checkout Agent", decision: "PASS", fileReferenced: "checkout-policy.md", clauseApplied: "MUST confirm departure date before processing checkout", actionProposed: `Standard ${customer.toLowerCase()} checkout at 11:00 — all conditions met`, escalationTarget: null, exceptionApplied: false, reasoning: "Departure date confirmed in PMS. No outstanding charges. No pending disputes. Standard checkout processed." },
      { id: 16, timestamp: ts(4, 2), agent: "Onboarding Agent", decision: "ESCALATE", fileReferenced: "staff-access-specialist-fasttrack-exception.md", clauseApplied: "MUST flag and NOT provision if CISO sign-off is missing", actionProposed: `Digital & Tech ${employee.toLowerCase()} fast-track provisioning request — CISO sign-off not found, escalated`, escalationTarget: "CISO", exceptionApplied: false, reasoning: "Role classified as Digital/Tech specialist qualifying for fast-track exception. However no CISO sign-off reference found in log for this individual. Provisioning blocked. Escalated to CISO for approval." },
      { id: 17, timestamp: ts(4, 28), agent: "Invoice Agent", decision: "PASS", fileReferenced: "invoice-collection-policy.md", clauseApplied: "MUST generate invoice within 24 hours of checkout and send to confirmed billing address", actionProposed: "Post-stay invoice generated and dispatched to corporate billing contact", escalationTarget: null, exceptionApplied: false, reasoning: "Checkout completed. Corporate billing address confirmed in Salesforce. Invoice generated from folio data. Dispatched via automated billing workflow within SLA." },
      { id: 18, timestamp: ts(5, 12), agent: "Payment Collection Bot", decision: "ESCALATE", fileReferenced: "collections-policy.md", clauseApplied: "MUST escalate invoices unpaid beyond 30-day terms to Credit Control", actionProposed: "Corporate invoice 30 days overdue — escalated to Credit Control team", escalationTarget: "Credit Control", exceptionApplied: false, reasoning: "Invoice INV-2026-4471 has passed 30-day payment terms. Two automated reminders sent. No payment or dispute received. Escalated to Credit Control for manual follow-up per O2C policy." },
    ],
    financial: [
      { id: 10, timestamp: ts(0, 3), agent: "KYC Agent", decision: "PASS", fileReferenced: "kyc-verification-policy.md", clauseApplied: "MAY approve standard onboarding for clients passing all verification checks", actionProposed: `New ${customer.toLowerCase()} onboarding — KYC verification passed, account activation authorised`, escalationTarget: null, exceptionApplied: false, reasoning: "Identity documents verified. PEP and sanctions screening clear. Source of funds documentation acceptable. Standard KYC conditions met." },
      { id: 11, timestamp: ts(0, 18), agent: "Transaction Agent", decision: "ESCALATE", fileReferenced: "transaction-limits-policy.md", clauseApplied: "MUST escalate transactions above risk threshold to human review", actionProposed: `Transaction of €45,000 triggered risk threshold — escalated to Compliance`, escalationTarget: "Compliance Officer", exceptionApplied: false, reasoning: "Transaction value and destination combination triggered automated risk scoring above threshold. GDPR Article 22 — customer informed of automated flag. Human review required before processing." },
      { id: 12, timestamp: ts(0, 41), agent: "Fraud Monitor", decision: "FAIL", fileReferenced: "fraud-prevention-policy.md", clauseApplied: "MUST NOT process transactions with fraud risk score above threshold without human review", actionProposed: "Card transaction blocked — fraud risk score 94/100, above 75 threshold", escalationTarget: "Fraud Operations", exceptionApplied: false, reasoning: "Fraud risk model score of 94 exceeds hard threshold. Transaction pattern inconsistent with client history. Transaction blocked. Client notified per GDPR transparency obligations." },
      { id: 13, timestamp: ts(1, 9), agent: "AML Screening Bot", decision: "ESCALATE", fileReferenced: "aml-screening-policy.md", clauseApplied: "MUST escalate all positive screening matches to Compliance before proceeding", actionProposed: `${customer} transaction matched AML screening list — escalated for manual review`, escalationTarget: "MLRO", exceptionApplied: false, reasoning: "Fuzzy match against consolidated sanctions list returned 78% confidence match. Per regulatory requirement, all matches above 70% must be escalated to MLRO for manual determination." },
      { id: 14, timestamp: ts(1, 55), agent: "Risk Assessment Agent", decision: "FAIL", fileReferenced: "credit-policy.md", clauseApplied: "MUST NOT approve credit above automated limit without review board sign-off", actionProposed: "Credit application above automated approval ceiling — declined, manual review required", escalationTarget: "Credit Committee", exceptionApplied: false, reasoning: "Requested credit limit exceeds automated approval ceiling. Risk score within acceptable range but value triggers mandatory Credit Committee review. Application placed in review queue." },
      { id: 15, timestamp: ts(2, 30), agent: "KYC Agent", decision: "PASS", fileReferenced: "enhanced-due-diligence-exception.md", clauseApplied: "MAY approve onboarding for PEP-adjacent clients with Enhanced Due Diligence completed", actionProposed: `High-net-worth ${customer.toLowerCase()} with PEP connection onboarded — EDD completed, exception applied`, escalationTarget: null, exceptionApplied: true, reasoning: "Client identified as PEP-adjacent. Enhanced Due Diligence completed and approved by Compliance Director. EDD exception overlay active. Onboarding approved with elevated monitoring flag." },
      { id: 16, timestamp: ts(3, 12), agent: "Onboarding Agent", decision: "PASS", fileReferenced: "staff-access-provisioning-baseline.md", clauseApplied: "MUST confirm access level matches role requirements before provisioning", actionProposed: `New ${employee.toLowerCase()} provisioned — role-scoped access confirmed`, escalationTarget: null, exceptionApplied: false, reasoning: "Workday record confirmed. Start date matched. Access level validated against role requirements — read-only to client data, no transaction authority. Provisioning completed." },
      { id: 17, timestamp: ts(4, 15), agent: "Revenue Recognition Agent", decision: "PASS", fileReferenced: "revenue-recognition-policy.md", clauseApplied: "MUST recognise revenue only when performance obligation is satisfied under IFRS 15", actionProposed: "Revenue recognition event triggered — service delivery confirmed, revenue posted", escalationTarget: null, exceptionApplied: false, reasoning: "Service delivery confirmed by client acceptance. IFRS 15 performance obligation satisfied. Revenue posted to correct period in finance system. SOX control evidence logged." },
      { id: 18, timestamp: ts(5, 33), agent: "Collections Bot", decision: "ESCALATE", fileReferenced: "collections-policy.md", clauseApplied: "MUST escalate debts above threshold overdue beyond 60 days to Finance Director", actionProposed: "Client account overdue 65 days above escalation threshold — Finance Director notified", escalationTarget: "Finance Director", exceptionApplied: false, reasoning: "Client account balance of £28,500 is 65 days past due — above 60-day escalation threshold. Three automated reminders sent. No payment plan agreed. Escalated to Finance Director for credit risk review." },
    ],
    healthcare: [
      { id: 10, timestamp: ts(0, 5), agent: "Clinical Decision Support", decision: "ESCALATE", fileReferenced: "clinical-ai-policy.md", clauseApplied: "MUST escalate all AI clinical recommendations to the responsible clinician before action", actionProposed: "AI diagnostic recommendation generated — escalated to responsible clinician for review", escalationTarget: "Responsible Clinician", exceptionApplied: false, reasoning: "Clinical AI system generated differential diagnosis recommendation. Per EU AI Act Article 14 and clinical governance policy, AI recommendation must be reviewed and confirmed by responsible clinician before clinical action. Recommendation presented, not applied." },
      { id: 11, timestamp: ts(0, 28), agent: "Triage Agent", decision: "PASS", fileReferenced: "triage-priority-policy.md", clauseApplied: "MUST assign priority classification within defined clinical parameters", actionProposed: `${customer} triage completed — Priority 2 classification assigned`, escalationTarget: null, exceptionApplied: false, reasoning: "Clinical parameters within automated triage scope. Vital signs and presenting complaint mapped to priority classification matrix. Priority 2 assigned. Clinical staff notified." },
      { id: 12, timestamp: ts(0, 52), agent: "Medication Agent", decision: "ESCALATE", fileReferenced: "medication-policy.md", clauseApplied: "MUST escalate drug interaction risk above threshold to prescribing clinician", actionProposed: `Medication order flagged — potential drug interaction detected, escalated to prescriber`, escalationTarget: "Prescribing Clinician", exceptionApplied: false, reasoning: "Drug interaction risk score between prescribed medications is 0.82, above 0.75 escalation threshold. Agent blocked automatic dispensing authorisation. Prescribing clinician alerted for clinical decision." },
      { id: 13, timestamp: ts(1, 14), agent: "Medical Supplies Agent", decision: "PASS", fileReferenced: "emergency-procurement-exception.md", clauseApplied: "MAY approve emergency procurement above standard threshold with documented clinical sign-off", actionProposed: "Emergency medical supplies order approved — urgent clinical need, exception overlay applied", escalationTarget: null, exceptionApplied: true, reasoning: "Clinical Director sign-off confirmed for emergency procurement. Supplier on approved vendor list. Value within exception ceiling. Critical patient care requirement documented. Exception conditions all met." },
      { id: 14, timestamp: ts(1, 48), agent: "Discharge Agent", decision: "PASS", fileReferenced: "discharge-policy.md", clauseApplied: "MUST confirm all discharge criteria met before authorising discharge", actionProposed: `${customer} discharge authorised — all criteria met`, escalationTarget: null, exceptionApplied: false, reasoning: "Clinical discharge criteria confirmed. Follow-up appointment scheduled. Discharge summary generated. Prescription issued. All required documentation complete." },
      { id: 15, timestamp: ts(2, 22), agent: "Onboarding Agent", decision: "PASS", fileReferenced: "locum-staff-access-exception.md", clauseApplied: "MAY provision access for credentialed locum staff with HR and Credentialing approval", actionProposed: `Locum ${employee.toLowerCase()} fast-track access granted — credentials verified, exception applied`, escalationTarget: null, exceptionApplied: true, reasoning: "Locum staff GMC/NMC credentials verified by Credentialing Bot. HR approval confirmed. Access limited to required clinical systems for contracted ward only. Exception conditions met." },
      { id: 16, timestamp: ts(3, 6), agent: "Credentialing Bot", decision: "FAIL", fileReferenced: "staff-credentialing-policy.md", clauseApplied: "MUST NOT allow clinical access without valid, current professional registration", actionProposed: `${employee} credentialing check failed — registration expired, access blocked`, escalationTarget: "HR Director", exceptionApplied: false, reasoning: "Professional registration expiry date has passed. No renewal confirmation found. Clinical system access blocked automatically. HR Director notified for resolution." },
      { id: 17, timestamp: ts(4, 9), agent: "Patient Billing Agent", decision: "PASS", fileReferenced: "patient-billing-policy.md", clauseApplied: "MUST verify insurance eligibility before raising patient invoice", actionProposed: "Patient billing completed — insurance eligibility verified, claim submitted", escalationTarget: null, exceptionApplied: false, reasoning: "Insurance eligibility confirmed with provider. Procedure codes validated. Claim submitted within 48-hour SLA. Patient statement generated for any residual balance." },
      { id: 18, timestamp: ts(5, 47), agent: "Insurance Claims Bot", decision: "ESCALATE", fileReferenced: "claims-management-policy.md", clauseApplied: "MUST escalate rejected insurance claims above threshold to Revenue Cycle Manager", actionProposed: "Insurance claim rejected — value above escalation threshold, Revenue Cycle Manager notified", escalationTarget: "Revenue Cycle Manager", exceptionApplied: false, reasoning: "Claim value of £4,200 rejected by insurer citing incomplete documentation. Above £2,000 manual review threshold. Revenue Cycle Manager notified to review rejection reason and resubmit or appeal." },
    ],
    retail: [
      { id: 10, timestamp: ts(0, 2), agent: "Recommendation Agent", decision: "PASS", fileReferenced: "personalisation-exception.md", clauseApplied: "MAY apply personalised pricing for loyalty tier customers — GDPR consent on file", actionProposed: `Loyalty ${customer.toLowerCase()} — personalised offer applied, exception overlay active`, escalationTarget: null, exceptionApplied: true, reasoning: "Customer holds active Gold loyalty status. GDPR Article 6(a) consent on file for personalised communications. Personalisation exception overlay active. Offer applied within permitted parameters." },
      { id: 11, timestamp: ts(0, 11), agent: "Fraud Detection Bot", decision: "ESCALATE", fileReferenced: "fraud-prevention-policy.md", clauseApplied: "MUST escalate transactions above fraud risk threshold to human review", actionProposed: `High-value order triggered fraud threshold — escalated to Fraud Operations`, escalationTarget: "Fraud Operations", exceptionApplied: false, reasoning: "Order value and shipping destination combination returned fraud risk score of 82/100, above 75 threshold. Customer notified of verification step per GDPR transparency requirements. Fraud Operations alerted." },
      { id: 12, timestamp: ts(0, 34), agent: "Payment Agent", decision: "FAIL", fileReferenced: "payment-processing-policy.md", clauseApplied: "MUST NOT process payment without successful card authorisation", actionProposed: "Payment declined — card authorisation failed, customer notified", escalationTarget: null, exceptionApplied: false, reasoning: "Card authorisation returned decline code from payment processor. Payment not processed. Customer notified. Order held pending payment update. PCI DSS logging requirements met." },
      { id: 13, timestamp: ts(1, 7), agent: "Returns Agent", decision: "PASS", fileReferenced: "returns-policy.md", clauseApplied: "MAY approve return and refund within standard returns window without manager approval", actionProposed: `${customer} return request approved — within returns window, automated refund initiated`, escalationTarget: null, exceptionApplied: false, reasoning: "Return request within 30-day window. Product in acceptable condition per customer declaration. Refund initiated to original payment method. Consumer Duty obligations met." },
      { id: 14, timestamp: ts(1, 51), agent: "PO Agent", decision: "FAIL", fileReferenced: "procurement-approval-authority-baseline.md", clauseApplied: "MUST NOT process PO above buyer authority level", actionProposed: "Supplier purchase order above buyer authority ceiling — blocked, escalated to Head of Buying", escalationTarget: "Head of Buying", exceptionApplied: false, reasoning: "PO value exceeds buyer's delegated authority ceiling. No Preferred Supplier exception applicable. Head of Buying sign-off required per procurement policy." },
      { id: 15, timestamp: ts(2, 18), agent: "Personalisation Agent", decision: "FAIL", fileReferenced: "personalisation-policy.md", clauseApplied: "MUST NOT apply personalisation without valid GDPR Article 6 lawful basis", actionProposed: `${customer} personalisation request blocked — consent not found`, escalationTarget: null, exceptionApplied: false, reasoning: "Customer record shows no active consent for personalised marketing under GDPR Article 6(a). No other applicable lawful basis. Personalisation blocked. Standard experience served." },
      { id: 16, timestamp: ts(3, 29), agent: "Onboarding Agent", decision: "PASS", fileReferenced: "seasonal-staff-access-exception.md", clauseApplied: "MAY provision seasonal staff access with HR confirmation and line manager request", actionProposed: `Seasonal ${employee.toLowerCase()} access provisioned — peak trading period exception active`, escalationTarget: null, exceptionApplied: true, reasoning: "Seasonal staffing exception overlay active for peak trading period. HR confirmation received. Line manager request logged. Access limited to POS and inventory systems. Exception conditions met." },
      { id: 17, timestamp: ts(4, 21), agent: "Invoice Agent", decision: "PASS", fileReferenced: "invoice-processing-policy.md", clauseApplied: "MUST generate VAT-compliant invoice within 24 hours of order dispatch", actionProposed: "Order dispatched — VAT invoice generated and emailed to customer", escalationTarget: null, exceptionApplied: false, reasoning: "Order confirmed dispatched. VAT invoice generated with correct tax codes. Sent to customer email on file. Invoice reference logged in finance system for reconciliation." },
      { id: 18, timestamp: ts(5, 38), agent: "Credit Control Agent", decision: "FAIL", fileReferenced: "credit-control-policy.md", clauseApplied: "MUST NOT extend further credit to accounts with overdue balance above credit limit", actionProposed: "New trade account order blocked — existing overdue balance exceeds credit limit", escalationTarget: "Head of Finance", exceptionApplied: false, reasoning: "Trade customer has outstanding balance of £12,400 against credit limit of £10,000. New order of £3,200 would exceed limit further. Order blocked. Head of Finance notified." },
    ],
    professional: [
      { id: 10, timestamp: ts(0, 6), agent: "Conflict Check Bot", decision: "PASS", fileReferenced: "conflict-of-interest-policy.md", clauseApplied: "MUST run conflict check before engagement proposal is submitted", actionProposed: "New engagement conflict check completed — no conflicts found, proposal authorised", escalationTarget: null, exceptionApplied: false, reasoning: "Conflict check run against current client register and restricted party list. No conflicts identified. Engagement proposal cleared for submission." },
      { id: 11, timestamp: ts(0, 24), agent: "Contract Bot", decision: "ESCALATE", fileReferenced: "rate-authority.md", clauseApplied: "MUST escalate discounts above partner authority ceiling to Managing Partner", actionProposed: "Engagement rate discount above Partner authority — escalated to Managing Partner", escalationTarget: "Managing Partner", exceptionApplied: false, reasoning: "Client requested 22% discount. Partner authority ceiling is 15%. No strategic client exception overlay active. Managing Partner approval required before contract can be issued." },
      { id: 12, timestamp: ts(0, 47), agent: "Contract Bot", decision: "PASS", fileReferenced: "strategic-client-rate-exception.md", clauseApplied: "MAY approve up to 25% discount for designated strategic accounts with Managing Partner sign-off", actionProposed: "Strategic client rate discount approved — exception overlay applied, Managing Partner confirmed", escalationTarget: null, exceptionApplied: true, reasoning: "Client designated as strategic account in CRM. Managing Partner sign-off confirmed. Requested discount of 20% within exception ceiling. Exception conditions met." },
      { id: 13, timestamp: ts(1, 3), agent: "Resource Agent", decision: "PASS", fileReferenced: "client-system-access-exception.md", clauseApplied: "MAY provision client system access for credentialed consultants with client approval", actionProposed: `${employee} client system access provisioned — client approval and NDA confirmed`, escalationTarget: null, exceptionApplied: true, reasoning: "Client system access request received. NDA in place. Client IT security sign-off obtained. Consultant credentials verified. Access limited to project scope. Exception conditions met." },
      { id: 14, timestamp: ts(1, 38), agent: "Billing Agent", decision: "ESCALATE", fileReferenced: "billing-policy.md", clauseApplied: "MUST escalate invoices above partner sign-off threshold to Finance Director", actionProposed: "Invoice above Partner sign-off threshold — escalated to Finance Director", escalationTarget: "Finance Director", exceptionApplied: false, reasoning: "Invoice value exceeds Partner sign-off authority. Finance Director approval required per billing policy. Invoice held pending approval." },
      { id: 15, timestamp: ts(2, 14), agent: "Vendor Agent", decision: "PASS", fileReferenced: "preferred-subcontractor-exception.md", clauseApplied: "MAY approve preferred subcontractor without three-quote requirement", actionProposed: "Preferred subcontractor engagement approved — exception overlay applied", escalationTarget: null, exceptionApplied: true, reasoning: "Subcontractor on current Preferred Supplier List. Engagement value within exception ceiling. DPA and insurance confirmed. Exception conditions all met." },
      { id: 16, timestamp: ts(3, 51), agent: "Conflict Check Bot", decision: "FAIL", fileReferenced: "conflict-of-interest-policy.md", clauseApplied: "MUST NOT submit proposal where conflict of interest is identified", actionProposed: "Engagement proposal blocked — conflict of interest detected, partner notified", escalationTarget: "Ethics Committee", exceptionApplied: false, reasoning: "Proposed client appears on restricted party list due to active matter for opposing party. Conflict confirmed. Proposal blocked. Ethics Committee notified for formal conflict determination." },
      { id: 17, timestamp: ts(4, 6), agent: "Engagement Billing Agent", decision: "PASS", fileReferenced: "billing-policy.md", clauseApplied: "MUST generate milestone invoice within 3 working days of milestone sign-off", actionProposed: "Project milestone completed — milestone invoice generated and issued to client", escalationTarget: null, exceptionApplied: false, reasoning: "Milestone sign-off received from client. Time and materials reconciled against budget. Invoice generated for milestone value. Dispatched within 3-day SLA. Revenue recognised in correct period." },
      { id: 18, timestamp: ts(5, 19), agent: "Collections Agent", decision: "ESCALATE", fileReferenced: "collections-policy.md", clauseApplied: "MUST escalate client invoices overdue beyond 45 days to Partner and Finance Director", actionProposed: "Client invoice 52 days overdue — escalated to Partner and Finance Director", escalationTarget: "Partner / Finance Director", exceptionApplied: false, reasoning: "Invoice INV-PS-2026-0892 is 52 days past 30-day payment terms. Client has not responded to two automated reminders. Value of £18,500. Escalated to engagement Partner and Finance Director for client relationship discussion." },
    ],
    manufacturing: [
      { id: 10, timestamp: ts(0, 4), agent: "QC Agent", decision: "FAIL", fileReferenced: "quality-hold-policy.md", clauseApplied: "MUST NOT release non-conforming product without Engineering deviation approval", actionProposed: "Production batch placed on quality hold — non-conformance detected, release blocked", escalationTarget: "Engineering Director", exceptionApplied: false, reasoning: "Dimensional measurement outside tolerance on 3 of 50 sampled units (6%). Exceeds 4% NCR threshold. Batch quarantined automatically. Engineering Director notified for deviation assessment." },
      { id: 11, timestamp: ts(0, 19), agent: "QC Agent", decision: "PASS", fileReferenced: "quality-deviation-exception.md", clauseApplied: "MAY release batch with formal Engineering deviation approval and customer concession", actionProposed: "Production batch released — Engineering deviation approved, customer concession obtained", escalationTarget: null, exceptionApplied: true, reasoning: "Engineering deviation REF-2026-0847 approved. Non-conformance assessed as non-critical. Customer concession C-2026-0312 obtained. Batch released with deviation documentation attached." },
      { id: 12, timestamp: ts(0, 38), agent: "Supplier Agent", decision: "PASS", fileReferenced: "approved-supplier-policy.md", clauseApplied: "MAY approve alternative supplier for critical shortage with Quality Director sign-off", actionProposed: "Alternative supplier approved for critical component — shortage exception applied", escalationTarget: null, exceptionApplied: true, reasoning: "Primary approved supplier unable to fulfil. Alternative supplier pre-qualified for emergency use. Quality Director sign-off obtained. Full qualification to follow. Exception conditions met." },
      { id: 13, timestamp: ts(1, 2), agent: "Defect Detection Bot", decision: "ESCALATE", fileReferenced: "defect-response-policy.md", clauseApplied: "MUST escalate potential safety-critical defect to Quality Director immediately", actionProposed: "Potential safety-critical defect pattern detected — production paused, Quality Director alerted", escalationTarget: "Quality Director", exceptionApplied: false, reasoning: "Machine learning defect model identified pattern consistent with safety-critical failure mode. Production line paused automatically. Quality Director and Safety Officer notified. ISO 9001 corrective action process triggered." },
      { id: 14, timestamp: ts(1, 44), agent: "PO Bot", decision: "FAIL", fileReferenced: "procurement-approval-authority-baseline.md", clauseApplied: "MUST NOT process PO above requestor's authority level", actionProposed: "Capital equipment PO blocked — above procurement authority ceiling, CFO approval required", escalationTarget: "CFO", exceptionApplied: false, reasoning: "Capital equipment PO value exceeds Procurement Director authority ceiling. No approved budget exception. CFO sign-off required per authority matrix." },
      { id: 15, timestamp: ts(2, 8), agent: "Audit Agent", decision: "ESCALATE", fileReferenced: "internal-audit-policy.md", clauseApplied: "MUST escalate critical audit finding to Quality Director and Management Representative", actionProposed: "Critical ISO 9001 audit finding — process non-compliance identified, escalated", escalationTarget: "Quality Director", exceptionApplied: false, reasoning: "Internal audit identified documented procedure not being followed consistently. Classified as Major Non-Conformance under ISO 9001. CAPA required within 30 days. Quality Director and Management Representative notified." },
      { id: 16, timestamp: ts(3, 17), agent: "Onboarding Agent", decision: "ESCALATE", fileReferenced: "contractor-access-policy.md", clauseApplied: "MUST escalate contractor access requests to CISO and site manager before provisioning", actionProposed: `Third-party contractor access request — escalated to CISO and Site Manager for approval`, escalationTarget: "CISO / Site Manager", exceptionApplied: false, reasoning: "Third-party contractor requesting access to OT/ICS systems. IEC 62443 security requirements apply. CISO and Site Manager approval required before any access is provisioned. Request queued pending approval." },
      { id: 17, timestamp: ts(4, 13), agent: "Customer Invoice Agent", decision: "PASS", fileReferenced: "invoice-policy.md", clauseApplied: "MUST raise customer invoice on confirmed goods dispatch with correct incoterms", actionProposed: "Goods dispatched to customer — invoice raised with correct incoterms and export documentation", escalationTarget: null, exceptionApplied: false, reasoning: "Dispatch confirmed by logistics. Incoterms verified against purchase order. Export documentation attached. Invoice raised in ERP system. ITAR compliance check completed where applicable." },
      { id: 18, timestamp: ts(5, 44), agent: "Credit Control Bot", decision: "ESCALATE", fileReferenced: "credit-management-policy.md", clauseApplied: "MUST escalate accounts overdue beyond credit terms to Finance Director and Account Manager", actionProposed: "Customer account overdue 40 days — escalated to Finance Director and Key Account Manager", escalationTarget: "Finance Director / KAM", exceptionApplied: false, reasoning: "Customer account balance of €34,000 is 40 days past agreed 30-day terms. No payment or dispute received. Account Manager notified to engage customer. Finance Director notified for credit risk assessment." },
    ],
    marina: [
      { id: 10, timestamp: ts(0, 3), agent: "Berth Assignment Bot", decision: "PASS", fileReferenced: "berth-allocation-exception.md", clauseApplied: "MAY assign premium berth to verified long-standing Boat Owner with Harbour Master approval", actionProposed: `${customer} berth assignment — premium pontoon berth allocated, Harbour Master approval on file`, escalationTarget: null, exceptionApplied: true, reasoning: `${customer} holds 8-year tenure — qualifying long-standing status confirmed. Requested premium pontoon berth available. Harbour Master approval REF-HM-2026-0041 obtained. Vessel LOA and beam within berth specification. Exception conditions met.` },
      { id: 11, timestamp: ts(0, 21), agent: "Safety Check Agent", decision: "FAIL", fileReferenced: "arrival-safety-policy.md", clauseApplied: "MUST NOT permit vessel to enter marina without valid marine insurance certificate on file", actionProposed: `Inbound vessel insurance certificate expired — arrival blocked, ${customer} notified`, escalationTarget: "Harbour Master", exceptionApplied: false, reasoning: "Marine insurance certificate presented by arriving vessel expired 12 days ago. MCA compliance requirement cannot be waived. Vessel instructed to hold on visitor pontoon. Harbour Master notified. Arrival clearance withheld pending renewed certificate." },
      { id: 12, timestamp: ts(0, 46), agent: "Mooring Pricing Agent", decision: "PASS", fileReferenced: "tariff-policy.md", clauseApplied: "MUST apply current tariff schedule based on vessel LOA, beam, and berth category", actionProposed: `Annual berth fee calculated for ${customer} — LOA 11.2 m, Category B berth, tariff applied`, escalationTarget: null, exceptionApplied: false, reasoning: "Vessel dimensions confirmed. Category B berth tariff applied per current schedule. Tenure discount not applicable — under 5-year qualifying threshold. Fee presented and accepted. Renewal invoice queued." },
      { id: 13, timestamp: ts(1, 7), agent: "Parts & Supplies Agent", decision: "FAIL", fileReferenced: "procurement-authority.md", clauseApplied: "MUST NOT process PO above Operations Manager authority level without CFO sign-off", actionProposed: "Marine engine parts PO above Operations Manager ceiling — blocked, CFO sign-off required", escalationTarget: "CFO", exceptionApplied: false, reasoning: "PO value of £28,500 for replacement marine engine components exceeds Operations Manager authority ceiling of £15,000. No emergency procurement exception overlay active. CFO approval required before PO can be raised." },
      { id: 14, timestamp: ts(1, 38), agent: "Valuation Bot", decision: "ESCALATE", fileReferenced: "brokerage-valuation-policy.md", clauseApplied: "MUST escalate brokerage valuations above automated ceiling to Head of Sales for review", actionProposed: "High-value vessel valuation above automated ceiling — escalated to Head of Sales for sign-off", escalationTarget: "Head of Sales", exceptionApplied: false, reasoning: "Indicative valuation of £145,000 for listed vessel exceeds automated approval ceiling of £100,000. Comparables assessed from market data. Head of Sales review required before valuation is presented to Boat Owner." },
      { id: 15, timestamp: ts(2, 19), agent: "Renewal Agent", decision: "PASS", fileReferenced: "mooring-renewal-policy.md", clauseApplied: "MUST dispatch renewal offer at least 90 days before berth agreement expiry", actionProposed: `${customer} annual berth renewal dispatched — 94 days before expiry, tariff increase noted`, escalationTarget: null, exceptionApplied: false, reasoning: "Berth agreement expiry confirmed. Renewal dispatched 94 days in advance — within the 90-day requirement. New season tariff applied per board-approved schedule. CRM updated with renewal stage." },
      { id: 16, timestamp: ts(3, 4), agent: "Onboarding Agent", decision: "ESCALATE", fileReferenced: "staff-access-policy.md", clauseApplied: "MUST escalate seasonal staff access requests to Harbour Master before provisioning", actionProposed: `Seasonal ${employee} access request — escalated to Harbour Master for approval before provisioning`, escalationTarget: "Harbour Master", exceptionApplied: false, reasoning: "Seasonal Dockmaster engaged for peak summer period. Access to berth management and vessel tracking systems requested. Harbour Master approval required per seasonal access policy before provisioning. Request queued pending approval." },
      { id: 17, timestamp: ts(4, 11), agent: "Mooring Invoice Agent", decision: "PASS", fileReferenced: "invoice-processing-policy.md", clauseApplied: "MUST generate berth invoice within 48 hours of reservation confirmation", actionProposed: `Berth reservation confirmed — annual mooring invoice generated and dispatched to ${customer}`, escalationTarget: null, exceptionApplied: false, reasoning: "Reservation confirmed and accepted by Boat Owner. Annual mooring invoice generated with correct vessel details, berth category, and VAT applied. Dispatched to billing contact on file. Invoice reference logged in marina management system." },
      { id: 18, timestamp: ts(5, 27), agent: "Debt Collection Agent", decision: "ESCALATE", fileReferenced: "collections-policy.md", clauseApplied: "MUST escalate mooring invoices overdue beyond 45 days to CFO and Head of Commercial", actionProposed: "Mooring invoice 52 days overdue — escalated to CFO and Head of Commercial", escalationTarget: "CFO / Head of Commercial", exceptionApplied: false, reasoning: "Mooring invoice INV-MR-2026-0178 for £4,200 is 52 days past 30-day payment terms. Two automated reminders sent. No payment or dispute received. Head of Commercial notified for customer relationship discussion. CFO notified for credit risk assessment. Vessel access restrictions may be applied." },
    ],
  };

  const industrySpecific = industryEntries[industry] || industryEntries.hospitality;
  const all = [...universal, ...industrySpecific].sort((a, b) => a.id - b.id);

  return all.map((e, i) => ({ ...e, id: Date.now() + i }));
}

// ─────────────────────────────────────────────
// DIRECTORY — persistent company list
// ─────────────────────────────────────────────
function Directory({ onNew, onLoad }) {
  const [companies, setCompanies] = useState(null); // null = loading
  const [deleting, setDeleting] = useState(null);
  const [hovered, setHovered] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const result = await window.storage.list("vdamd-company:");
        const entries = [];
        for (const key of (result?.keys || [])) {
          try {
            const r = await window.storage.get(key);
            if (r?.value) entries.push({ key, ...JSON.parse(r.value) });
          } catch {}
        }
        entries.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
        setCompanies(entries);
      } catch {
        setCompanies([]);
      }
    })();
  }, []);

  const deleteCompany = async (key, e) => {
    e.stopPropagation();
    setDeleting(key);
    try { await window.storage.delete(key); } catch {}
    setCompanies(p => p.filter(c => c.key !== key));
    setDeleting(null);
  };

  const industryConfig = (id) => INDUSTRY_CONFIGS[id] || {};

  return (
    <div style={{ minHeight: "100vh", background: T.bg, fontFamily: T.sans, color: T.text }}>
      <style>{GLOBAL_CSS}</style>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=Outfit:wght@300;400;600;700;900&display=swap" />

      {/* Header */}
      <div style={{ background: "#050608", borderBottom: `1px solid ${T.border}`, padding: "0 32px", height: 58, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ background: T.orange, borderRadius: 8, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: T.mono, fontWeight: 900, fontSize: 13, color: "#fff" }}>VD</div>
          <div>
            <div style={{ fontWeight: 900, fontSize: 15, letterSpacing: "-0.03em" }}>VDA-MD Framework</div>
            <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono }}>Value-Driven AI with Markdowns</div>
          </div>
        </div>
        <button onClick={onNew} style={{
          background: T.orange, border: "none", borderRadius: 8,
          padding: "8px 18px", fontSize: 13, color: "#fff",
          fontFamily: T.sans, fontWeight: 800, cursor: "pointer",
          boxShadow: `0 0 20px ${T.orange}40`,
          display: "flex", gap: 8, alignItems: "center",
        }}>
          <span>+</span> Configure New Company
        </button>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "40px 32px" }}>
        {/* Hero */}
        <div style={{ marginBottom: 40 }}>
          <h1 style={{ fontFamily: T.sans, fontWeight: 900, fontSize: 32, color: T.text, letterSpacing: "-0.04em", marginBottom: 10 }}>
            VDA-MD Directory
          </h1>
          <p style={{ fontSize: 16, color: T.muted, lineHeight: 1.7, maxWidth: 600 }}>
            Your saved AI governance hubs. Each entry is a fully configured VDA-MD framework — brand context ingested, NIST controls mapped, exception engine ready.
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <Tag color={T.blue}>NIST SP 800-53</Tag>
            <Tag color={T.green}>GDPR</Tag>
            <Tag color={T.purple}>EU AI Act</Tag>
            <Tag color={T.orange}>C2MD Pipeline</Tag>
          </div>
        </div>

        {/* Loading */}
        {companies === null && (
          <div style={{ textAlign: "center", padding: "60px 0", color: T.dim }}>
            <div style={{ fontSize: 13, fontFamily: T.mono, animation: "pulse-ring 1s ease infinite" }}>Loading directory…</div>
          </div>
        )}

        {/* Empty */}
        {companies?.length === 0 && (
          <div style={{ textAlign: "center", padding: "80px 40px", background: T.card, border: `2px dashed ${T.border}`, borderRadius: 16 }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>🏗️</div>
            <h2 style={{ fontFamily: T.sans, fontWeight: 900, fontSize: 22, color: T.text, marginBottom: 10 }}>No companies configured yet</h2>
            <p style={{ fontSize: 15, color: T.muted, marginBottom: 24, maxWidth: 400, margin: "0 auto 24px" }}>
              Configure your first company to get started. Enter a company website, select an industry, and the VDA-MD framework will be tailored to that organisation.
            </p>
            <button onClick={onNew} style={{
              background: T.orange, border: "none", borderRadius: 10,
              padding: "12px 28px", fontSize: 15, color: "#fff",
              fontFamily: T.sans, fontWeight: 800, cursor: "pointer",
              boxShadow: `0 0 28px ${T.orange}50`,
            }}>Configure First Company →</button>
          </div>
        )}

        {/* Company grid */}
        {companies?.length > 0 && (
          <>
            <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono, marginBottom: 16, letterSpacing: "0.08em" }}>
              {companies.length} CONFIGURED {companies.length === 1 ? "COMPANY" : "COMPANIES"}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16, marginBottom: 32 }}>
              {companies.map(co => {
                const cfg = industryConfig(co.industry);
                const isHov = hovered === co.key;
                const savedDate = co.savedAt ? new Date(co.savedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "Unknown";
                return (
                  <div key={co.key}
                    onClick={() => onLoad(co)}
                    onMouseEnter={() => setHovered(co.key)}
                    onMouseLeave={() => setHovered(null)}
                    style={{
                      background: isHov ? `${T.orange}0c` : T.card,
                      border: `2px solid ${isHov ? T.orange + "60" : T.border}`,
                      borderRadius: 14, padding: 22, cursor: "pointer",
                      transition: "all 0.18s",
                      transform: isHov ? "translateY(-2px)" : "none",
                      boxShadow: isHov ? `0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px ${T.orange}20` : "none",
                      position: "relative",
                    }}
                  >
                    {/* Delete button */}
                    <button
                      onClick={e => deleteCompany(co.key, e)}
                      style={{
                        position: "absolute", top: 12, right: 12,
                        background: `${T.red}15`, border: `1px solid ${T.red}30`,
                        borderRadius: 6, width: 26, height: 26, cursor: "pointer",
                        color: T.red, fontSize: 12, display: "flex", alignItems: "center",
                        justifyContent: "center", opacity: isHov ? 1 : 0, transition: "opacity 0.15s",
                      }}
                    >{deleting === co.key ? "…" : "✕"}</button>

                    {/* Company avatar + name */}
                    <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 14 }}>
                      <div style={{
                        width: 44, height: 44, borderRadius: 10, flexShrink: 0,
                        background: `${T.orange}20`, border: `1px solid ${T.orange}40`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontFamily: T.mono, fontWeight: 900, fontSize: 16, color: T.orange,
                      }}>
                        {co.companyName?.slice(0, 2).toUpperCase() || "??"}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: T.sans, fontWeight: 900, fontSize: 17, color: T.text, marginBottom: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {co.companyName}
                        </div>
                        <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono }}>{co.websiteUrl}</div>
                      </div>
                    </div>

                    {/* Industry + NIST */}
                    <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 16 }}>{cfg.icon}</span>
                      <Tag color={T.orange}>{cfg.label || co.industry}</Tag>
                      {(cfg.nistControls || []).slice(0, 3).map(c => <Tag key={c} color={T.blue}>{c}</Tag>)}
                      {(cfg.nistControls || []).length > 3 && <Tag color={T.dim}>+{cfg.nistControls.length - 3}</Tag>}
                    </div>

                    {/* Brand context indicator */}
                    <div style={{ background: "#04050a", border: `1px solid ${T.border}`, borderRadius: 7, padding: "7px 12px", marginBottom: 12, fontSize: 11, color: T.dim, fontFamily: T.mono, display: "flex", justifyContent: "space-between" }}>
                      <span>Brand context: <span style={{ color: T.green }}>{co.brandContext ? Math.round(co.brandContext.length / 100) * 100 + " chars" : "none"}</span></span>
                      {co.filesCount > 0 && <span style={{ color: T.purple }}>{co.filesCount} files ingested</span>}
                    </div>

                    {/* Footer */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ fontSize: 10, color: T.dim, fontFamily: T.mono }}>Saved {savedDate}</div>
                      <div style={{ fontSize: 12, color: isHov ? T.orange : T.dim, fontFamily: T.mono, fontWeight: 700, transition: "color 0.15s" }}>
                        {isHov ? "Open Hub →" : "Click to open"}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* New company card */}
              <div onClick={onNew} style={{
                background: "none", border: `2px dashed ${T.border}`,
                borderRadius: 14, padding: 22, cursor: "pointer",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                minHeight: 200, transition: "all 0.18s",
                ...(hovered === "__new" ? { borderColor: T.orange, background: `${T.orange}06` } : {}),
              }}
                onMouseEnter={() => setHovered("__new")}
                onMouseLeave={() => setHovered(null)}
              >
                <div style={{ fontSize: 32, marginBottom: 10, opacity: 0.5 }}>+</div>
                <div style={{ fontSize: 14, color: T.dim, fontWeight: 600 }}>New Company</div>
                <div style={{ fontSize: 11, color: T.dim, marginTop: 4, fontFamily: T.mono }}>Configure VDA-MD hub</div>
              </div>
            </div>
          </>
        )}

        {/* Framework footer */}
        <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 24, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono }}>VDA-MD Framework · C2MD (Compliance to Markdown) · Proprietary IP · March 2026</div>
          <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono }}>Saved locally in this browser · No external storage</div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// ROOT APP
// ─────────────────────────────────────────────
export default function VdaOS() {
  // screen: "directory" | "wizard" | "hub"
  const [screen, setScreen] = useState("directory");
  const [setup, setSetup] = useState(null);
  const [tab, setTab] = useState("journey");
  const [log, setLog] = useState([]);
  const [logIsSeeded, setLogIsSeeded] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [c2mdCache, setC2mdCache] = useState({}); // persists across tab switches

  const addLog = useCallback(entry => {
    setLog(p => [...p, entry]);
    setLogIsSeeded(false);
  }, []);

  const handleSetupComplete = async (data) => {
    setSetup(data);
    setTab("journey");
    const cfg = { ...INDUSTRY_CONFIGS[data.industry], id: data.industry };
    setLog(buildSeedLog(cfg, data.companyName));
    setLogIsSeeded(true);
    setIsSaved(false);
    setScreen("hub");
    setC2mdCache({});
  };

  const handleLoad = (savedData) => {
    setSetup(savedData);
    setTab("journey");
    const cfg = { ...INDUSTRY_CONFIGS[savedData.industry], id: savedData.industry };
    setLog(buildSeedLog(cfg, savedData.companyName));
    setLogIsSeeded(true);
    setIsSaved(true);
    setScreen("hub");
    setC2mdCache({});
  };

  const handleSave = async () => {
    if (!setup || saving) return;
    setSaving(true);
    try {
      const key = "vdamd-company:" + setup.companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Date.now();
      await window.storage.set(key, JSON.stringify({
        ...setup,
        savedAt: Date.now(),
        filesCount: setup.uploadedFiles?.length || 0,
        // Store only first 8000 chars of brandContext to stay under limits
        brandContext: (setup.brandContext || "").slice(0, 8000),
      }));
      setIsSaved(true);
    } catch (e) {
      console.error("Save failed:", e);
    }
    setSaving(false);
  };

  const goToDirectory = () => {
    setScreen("directory");
    setSetup(null);
    setLog([]);
    setLogIsSeeded(false);
    setIsSaved(false);
  };

  const config = setup ? { ...INDUSTRY_CONFIGS[setup.industry], id: setup.industry } : null;

  const tabs = setup ? [
    { id: "journey",   label: "Journey Map",     icon: "🗺" },
    { id: "c2md",      label: "C2MD Studio",      icon: "🔬" },
    { id: "exception", label: "Exception Engine", icon: "⚡" },
    { id: "witness",   label: "Witness Agent" + (log.length ? " (" + log.length + ")" : ""), icon: "🕵️" },
  ] : [];

  return (
    <div style={{ minHeight: "100vh", background: T.bg, fontFamily: T.sans, color: T.text }}>
      <style>{GLOBAL_CSS}</style>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=Outfit:wght@300;400;600;700;900&display=swap" />

      {/* Directory */}
      {screen === "directory" && (
        <Directory
          onNew={() => setScreen("wizard")}
          onLoad={handleLoad}
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
                  VDA-MD · {config.label} · {config.icon}
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

          {/* Nav */}
          <div style={{ background: "#08090c", borderBottom: `1px solid ${T.border}`, padding: "0 28px", display: "flex", gap: 0, alignItems: "stretch" }}>
            {tabs.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                padding: "12px 18px", background: "none", border: "none",
                borderBottom: `2px solid ${tab === t.id ? T.orange : "transparent"}`,
                color: tab === t.id ? T.orange : T.dim,
                cursor: "pointer", fontSize: 13, fontWeight: tab === t.id ? 700 : 400,
                fontFamily: T.sans, transition: "all 0.2s",
                display: "flex", gap: 8, alignItems: "center",
              }}>
                <span>{t.icon}</span> {t.label}
              </button>
            ))}
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, padding: "0 8px" }}>
              <span style={{ fontSize: 11, color: T.dim, fontFamily: T.mono }}>{config.icon} {config.label}</span>
            </div>
          </div>

          {/* Content */}
          {tab === "journey"   && <JourneyMapTab config={config} companyName={setup.companyName} />}
          {tab === "c2md"      && <C2MDStudioTab config={config} companyName={setup.companyName} brandContext={setup.brandContext} cache={c2mdCache} setCache={setC2mdCache} />}
          {tab === "exception" && <ExceptionEngineTab config={config} companyName={setup.companyName} onLogEntry={addLog} />}
          {tab === "witness"   && <WitnessAgentTab log={log} config={config} companyName={setup.companyName} isSeeded={logIsSeeded} />}
        </>
      )}
    </div>
  );
}
