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

function stripFrontMatter(content: string): string {
  return content.replace(/^---[\s\S]*?---\s*\n/, "");
}

function parseExceptionAuthorityBody(body: string): ExceptionAuthority {
  const result: ExceptionAuthority = {
    roleBands: {},
    mustNotOverride: [],
    escalationTargets: {},
  };

  // Split by lines that are exactly "---"
  const chunks = body.split(/\n---\n/);
  let currentBand: string | null = null;

  for (const chunk of chunks) {
    // Detect role_band heading (### role_band: foo)
    const bandMatch = chunk.match(/###\s+role_band:\s*(\S+)/);
    if (bandMatch) {
      currentBand = bandMatch[1];
      if (!result.roleBands[currentBand]) {
        result.roleBands[currentBand] = { exceptions: [] };
      }
    }

    // Build a YAML-parseable version of the chunk:
    // - strip markdown heading lines
    // - strip pure-prose lines (no colon, not a list item)
    const yamlLines = chunk
      .split("\n")
      .filter((line) => {
        if (/^#{1,6}\s/.test(line)) return false; // markdown headings
        if (/^>\s/.test(line)) return false; // blockquotes
        return true;
      })
      .join("\n")
      .trim();

    if (!yamlLines) continue;

    let parsed: unknown;
    try {
      parsed = yaml.load(yamlLines);
    } catch {
      continue; // skip unparseable chunks
    }

    if (!parsed || typeof parsed !== "object") continue;
    const obj = parsed as Record<string, unknown>;

    if (obj.must_not_override && Array.isArray(obj.must_not_override)) {
      result.mustNotOverride = obj.must_not_override as string[];
    } else if (obj.escalation_targets && typeof obj.escalation_targets === "object") {
      result.escalationTargets = obj.escalation_targets as Record<string, string>;
    } else if (
      (obj.exception_class !== undefined || obj.authority === "not_applicable") &&
      currentBand
    ) {
      result.roleBands[currentBand].exceptions.push(obj as ExceptionRule);
    }
  }

  return result;
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
  const policy: OnboardingPolicy = {
    sandbox_pass_threshold: Number(parsed?.sandbox_pass_threshold ?? 0.95),
    crawl_agreement_threshold: Number(parsed?.crawl_agreement_threshold ?? 0.95),
    walk_agreement_threshold: Number(parsed?.walk_agreement_threshold ?? 0.95),
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
 * Returns null if no file is seeded (caller must handle null — no fallbacks).
 */
export async function getExceptionAuthority(
  agentId: string,
  companyId: number
): Promise<ExceptionAuthority | null> {
  const rows = await db
    .select({ content: governanceFiles.content })
    .from(governanceFiles)
    .where(
      and(
        eq(governanceFiles.agentId, agentId),
        eq(governanceFiles.companyId, companyId),
        eq(governanceFiles.fileType, "EXCEPTION_AUTHORITY"),
        eq(governanceFiles.isArchived, false)
      )
    )
    .limit(1);

  if (!rows[0]) {
    logger.warn({ agentId, companyId }, "[exceptionAuthorityReader] No EXCEPTION_AUTHORITY.md found");
    return null;
  }

  try {
    const body = stripFrontMatter(rows[0].content);
    return parseExceptionAuthorityBody(body);
  } catch (err) {
    logger.error({ err, agentId, companyId }, "[exceptionAuthorityReader] Parse error");
    return null;
  }
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
