/**
 * exceptionAuthorityReader.ts
 * Reads EXCEPTION_AUTHORITY.md and onboarding-policy.md from the governance_files
 * table at runtime. No hardcoded thresholds anywhere in this file.
 */
import yaml from "js-yaml";
import { db, governanceFiles, exceptionBaselines } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ExceptionRule {
  exception_class: string;
  description?: string;
  ceiling?: string | number | null;
  ceiling_type?: string;
  conditions?: string[];
  authority: string;
  escalate_to?: string | null;
  must_log?: boolean;
}

export interface BandAuthority {
  exceptions: ExceptionRule[];
  rejectedClasses: string[];
}

export interface ExceptionAuthority {
  roleBands: Record<string, { exceptions: ExceptionRule[] }>;
  mustNotOverride: string[];
  escalationTargets: Record<string, string>;
}

export interface ClauseThreshold {
  must: number;
  must_not: number;
  may: number;
}

export interface OnboardingPolicy {
  sandbox_pass_threshold: number;
  crawl_agreement_threshold: number;
  walk_agreement_threshold: number;
  minimum_clause_counts: Record<string, ClauseThreshold>;
  front_line_bands: string[];
  cross_property_bands: string[];
  valid_transitions: Record<string, string>;
}

// ─── In-memory policy cache (60 s) ───────────────────────────────────────────

let _policyCache: OnboardingPolicy | null = null;
let _policyCacheTs = 0;
const POLICY_CACHE_TTL_MS = 60_000;

// ─── Internal YAML parser for EXCEPTION_AUTHORITY.md ─────────────────────────
// Files use a single-document YAML body after front-matter is stripped.
// The canonical format has top-level keys: role_bands, must_not_override, escalation_targets.
// role_bands is a map of band name → { exceptions: ExceptionRule[] }.

function stripFrontMatter(content: string): string {
  // Strip the ---...--- front-matter block (first occurrence only).
  return content.replace(/^---[\s\S]*?---\s*\n/, "");
}

function parseExceptionAuthorityBody(body: string): ExceptionAuthority {
  // Parse as a single YAML document. Throws deterministically on any parse error.
  let doc: unknown;
  try {
    doc = yaml.load(body);
  } catch (err) {
    throw new Error(`[exceptionAuthorityReader] EXCEPTION_AUTHORITY.md is not valid YAML: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!doc || typeof doc !== "object") {
    throw new Error("[exceptionAuthorityReader] EXCEPTION_AUTHORITY.md parsed to a non-object — check file format");
  }

  const obj = doc as Record<string, unknown>;

  // Parse role_bands: { ambassador: { exceptions: [...] }, ... }
  const roleBands: Record<string, { exceptions: ExceptionRule[] }> = {};
  const rawBands = obj.role_bands;
  if (rawBands && typeof rawBands === "object" && !Array.isArray(rawBands)) {
    for (const [band, data] of Object.entries(rawBands as Record<string, unknown>)) {
      if (!data || typeof data !== "object") continue;
      const bandData = data as Record<string, unknown>;
      const exceptions: ExceptionRule[] = Array.isArray(bandData.exceptions)
        ? (bandData.exceptions as ExceptionRule[])
        : [];
      roleBands[band] = { exceptions };
    }
  }

  const mustNotOverride: string[] = Array.isArray(obj.must_not_override)
    ? (obj.must_not_override as string[])
    : [];

  const escalationTargets: Record<string, string> =
    obj.escalation_targets && typeof obj.escalation_targets === "object" && !Array.isArray(obj.escalation_targets)
      ? (obj.escalation_targets as Record<string, string>)
      : {};

  return { roleBands, mustNotOverride, escalationTargets };
}

function parseOnboardingPolicyBody(body: string): OnboardingPolicy {
  // Strip markdown heading lines and --- dividers, then parse as YAML
  const yamlLines = body
    .split("\n")
    .filter((line) => {
      if (/^#{1,6}\s/.test(line)) return false;
      if (/^---\s*$/.test(line)) return false;
      return true;
    })
    .join("\n");

  const parsed = yaml.load(yamlLines) as Partial<OnboardingPolicy>;

  // Normalise minimum_clause_counts — the spec uses { must, must_not, may } objects
  // but the fileManager.ts uses { must, mustNot, may } — we keep as must_not here.
  const sb = parsed?.sandbox_pass_threshold;
  const ca = parsed?.crawl_agreement_threshold;
  const wa = parsed?.walk_agreement_threshold;
  if (sb == null || ca == null || wa == null) {
    throw new Error(
      "onboarding-policy.md is missing required threshold field(s): " +
      [sb == null ? "sandbox_pass_threshold" : null, ca == null ? "crawl_agreement_threshold" : null, wa == null ? "walk_agreement_threshold" : null]
        .filter(Boolean).join(", ")
    );
  }
  const policy: OnboardingPolicy = {
    sandbox_pass_threshold: Number(sb),
    crawl_agreement_threshold: Number(ca),
    walk_agreement_threshold: Number(wa),
    minimum_clause_counts: (parsed?.minimum_clause_counts as Record<string, ClauseThreshold>) ?? {},
    front_line_bands: (parsed?.front_line_bands as string[]) ?? [],
    cross_property_bands: (parsed?.cross_property_bands as string[]) ?? [],
    valid_transitions: (parsed?.valid_transitions as Record<string, string>) ?? {},
  };

  return policy;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch and parse the EXCEPTION_AUTHORITY.md for an agent.
 * Checks the requested companyId first, then falls back to companyId=0
 * (platform-level files seeded by the governance seed script).
 * Returns null if no file is found at either level.
 */
export async function getExceptionAuthority(
  agentId: string,
  companyId: number
): Promise<ExceptionAuthority | null> {
  const lookupIds = companyId === 0 ? [0] : [companyId, 0];

  for (const cid of lookupIds) {
    const rows = await db
      .select({ content: governanceFiles.content })
      .from(governanceFiles)
      .where(
        and(
          eq(governanceFiles.agentId, agentId),
          eq(governanceFiles.companyId, cid),
          eq(governanceFiles.fileType, "EXCEPTION_AUTHORITY"),
          eq(governanceFiles.isArchived, false)
        )
      )
      .limit(1);

    if (rows[0]) {
      try {
        const body = stripFrontMatter(rows[0].content);
        return parseExceptionAuthorityBody(body);
      } catch (err) {
        logger.error({ err, agentId, companyId: cid }, "[exceptionAuthorityReader] Parse error");
        return null;
      }
    }
  }

  logger.warn({ agentId, companyId }, "[exceptionAuthorityReader] No EXCEPTION_AUTHORITY.md found at any level");
  return null;
}

/**
 * Return all exception rules for a specific role band, plus rejected classes
 * from exception_baselines.
 * Returns null if EXCEPTION_AUTHORITY.md is not seeded.
 */
export async function getRoleBandAuthority(
  agentId: string,
  companyId: number,
  roleBand: string
): Promise<BandAuthority | null> {
  const authority = await getExceptionAuthority(agentId, companyId);
  if (!authority) return null;

  const bandData = authority.roleBands[roleBand];
  const exceptions: ExceptionRule[] = bandData?.exceptions ?? [];

  const rejected = await getRejectedClasses(agentId, companyId);

  return { exceptions, rejectedClasses: rejected };
}

/**
 * Return a single exception rule for a specific agent / band / class.
 * Returns null if not found or file missing.
 */
export async function getExceptionClass(
  agentId: string,
  companyId: number,
  roleBand: string,
  exceptionClass: string
): Promise<ExceptionRule | null> {
  const band = await getRoleBandAuthority(agentId, companyId, roleBand);
  if (!band) return null;
  return band.exceptions.find((e) => e.exception_class === exceptionClass) ?? null;
}

/**
 * Derive the role_band for a given escalation label by reading the agent's
 * escalation_targets map in EXCEPTION_AUTHORITY.md.
 * Falls back to searching companyId=0 if the company-specific file is missing.
 * Returns null if neither exists.
 */
export async function getEscalationTarget(
  agentId: string,
  escalationLabel: string
): Promise<string | null> {
  // Try companyId=0 (platform-level) first — native agents only have companyId=0 files
  const authority = await getExceptionAuthority(agentId, 0);
  if (!authority) {
    logger.warn({ agentId, escalationLabel }, "[exceptionAuthorityReader] No EXCEPTION_AUTHORITY.md for getEscalationTarget");
    return null;
  }

  const band = authority.escalationTargets[escalationLabel];
  if (!band) {
    logger.warn({ agentId, escalationLabel }, "[exceptionAuthorityReader] escalation_target not found in map");
  }
  return band ?? null;
}

/**
 * Read the platform onboarding-policy.md (companyId=0, agent_id=onboarding-agent).
 * Cached for 60 seconds.
 * Throws if the file is missing — no fallbacks.
 */
export async function getOnboardingPolicy(): Promise<OnboardingPolicy> {
  const now = Date.now();
  if (_policyCache && now - _policyCacheTs < POLICY_CACHE_TTL_MS) {
    return _policyCache;
  }

  const rows = await db
    .select({ content: governanceFiles.content })
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

  if (!rows[0]) {
    throw new Error("[exceptionAuthorityReader] onboarding-policy.md not seeded at companyId=0");
  }

  const body = stripFrontMatter(rows[0].content);
  const policy = parseOnboardingPolicyBody(body);

  _policyCache = policy;
  _policyCacheTs = now;
  return policy;
}

/**
 * Return the list of exception classes that have been explicitly rejected
 * for a given agent + company in exception_baselines.
 */
export async function getRejectedClasses(
  agentId: string,
  companyId: number
): Promise<string[]> {
  const rows = await db
    .select({ exceptionClass: exceptionBaselines.exceptionClass })
    .from(exceptionBaselines)
    .where(
      and(
        eq(exceptionBaselines.agentId, agentId),
        eq(exceptionBaselines.companyId, companyId),
        eq(exceptionBaselines.rejected, true)
      )
    );
  return rows.map((r) => r.exceptionClass);
}
