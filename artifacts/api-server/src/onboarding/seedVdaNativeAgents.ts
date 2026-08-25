/**
 * Seeds all 8 VDA native agents into onboarding_requests with
 * source="vda_native", status="pre_admitted" — idempotent.
 * Called once at server startup so the OnboardingConsole shows
 * "Pending admission" for every agent on first load.
 *
 * Agent metadata is derived directly from AGENT_DEFS in agentCardRegistry
 * to avoid duplication and drift.
 */
import { db, onboardingRequests } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { AGENT_DEFS } from "../a2a/agentCardRegistry.js";
import { logger } from "../lib/logger.js";

const PLATFORM_PROVIDER = { organization: "A Hotel Berlin · VDA-MD Platform", url: "https://aihospitalityalliance.com" };

const NATIVE_AGENT_IDS = Object.keys(AGENT_DEFS).filter(id => id !== "onboarding-agent");

export async function seedVdaNativeAgents(): Promise<void> {
  let inserted = 0;
  let skipped = 0;

  for (const agentId of NATIVE_AGENT_IDS) {
    const def = AGENT_DEFS[agentId];
    const did = `did:vda:hospitality:${agentId}`;

    try {
      const existing = await db
        .select({ id: onboardingRequests.id })
        .from(onboardingRequests)
        .where(
          and(
            eq(onboardingRequests.source, "vda_native"),
            eq(onboardingRequests.externalAgentDid, did)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        skipped++;
        continue;
      }

      await db.insert(onboardingRequests).values({
        sessionId: `vda-native-${agentId}-${Date.now()}`,
        externalAgentDid: did,
        agentCard: {
          id: agentId,
          name: def.name,
          description: def.description,
          version: "1.0.0",
          skills: def.defaultSkills,
          url: `/api/a2a/0/${agentId}`,
          provider: PLATFORM_PROVIDER,
        },
        source: "vda_native",
        status: "pre_admitted",
      });

      inserted++;
      logger.info({ agentId }, "[seed] VDA native agent seeded as pre_admitted");
    } catch (err) {
      logger.warn({ err, agentId }, "[seed] Failed to seed VDA native agent");
    }
  }

  logger.info({ inserted, skipped, total: NATIVE_AGENT_IDS.length }, "[seed] VDA native agents seed complete");
}
