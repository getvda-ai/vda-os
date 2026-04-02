export interface ComplianceGuardResult {
  allowed: boolean;
  violations: string[];
  hint: string;
}

const IMMUTABLE_LEGAL_TERMS: { label: string; pattern: RegExp }[] = [
  { label: "GDPR",      pattern: /GDPR|General Data Protection Regulation|data subject rights?|Article 22/gi },
  { label: "EU AI Act", pattern: /EU AI Act|Artificial Intelligence Act|GPAI|high-risk AI|prohibited AI/gi },
  { label: "ISO 42001", pattern: /ISO 42001|AI management system/gi },
];

const AUDIT_SIGNOFF_TERMS: { label: string; pattern: RegExp }[] = [
  { label: "NIST SP 800-53", pattern: /NIST|SP 800-53|AC-\d+|AU-\d+|IR-\d+|SA-\d+|SC-\d+|RA-\d+|SI-\d+/gi },
  { label: "SOC 2",          pattern: /SOC 2|SOC2|AICPA SOC|Trust Service Criteria/gi },
  { label: "ISO 27001",      pattern: /ISO 27001|ISMS|information security management/gi },
];

function countTermMatches(content: string, pattern: RegExp): number {
  return (content.match(pattern) ?? []).length;
}

/**
 * VDA-MK §3 & §4 compliance guard.
 *
 * §3 — IMMUTABLE: any reduction of GDPR / EU AI Act / ISO 42001 references is
 *      a hard block (HTTP 409) regardless of signedOffBy.
 * §4 — SIGNOFF REQUIRED: any reduction of NIST / SOC 2 / ISO 27001 references
 *      requires `signedOffBy` to be provided; unsigned reductions are rejected.
 *
 * Used by both fileManager.ts (PUT file edits) and seed.ts (SOC 2 SD regeneration).
 */
export function checkComplianceGuards(
  existingContent: string,
  newContent: string,
  signedOffBy?: string,
): ComplianceGuardResult {
  const violations: string[] = [];

  for (const term of IMMUTABLE_LEGAL_TERMS) {
    const before = countTermMatches(existingContent, term.pattern);
    const after  = countTermMatches(newContent, term.pattern);
    if (before > 0 && after < before) {
      violations.push(
        `IMMUTABLE [§3]: "${term.label}" references reduced from ${before} to ${after}. ` +
        `Legal compliance clauses (GDPR, EU AI Act, ISO 42001) cannot be removed from VDA-MD governance files.`,
      );
    }
  }

  if (violations.length > 0) {
    return {
      allowed: false,
      violations,
      hint: "Restore the removed compliance clauses to proceed. GDPR, EU AI Act, and ISO 42001 references are immutable under VDA-MK §3.",
    };
  }

  const auditViolations: string[] = [];
  for (const term of AUDIT_SIGNOFF_TERMS) {
    const before = countTermMatches(existingContent, term.pattern);
    const after  = countTermMatches(newContent, term.pattern);
    if (before > 0 && after < before) {
      auditViolations.push(
        `SIGNOFF REQUIRED [§4]: "${term.label}" references reduced from ${before} to ${after}.`,
      );
    }
  }

  if (auditViolations.length > 0 && !signedOffBy) {
    return {
      allowed: false,
      violations: auditViolations,
      hint:
        "Reducing audit standard references (NIST, SOC 2, ISO 27001) requires accountable owner signoff. " +
        "Provide `signedOffBy` in the request body, or restore the removed references.",
    };
  }

  return { allowed: true, violations: [], hint: "" };
}
