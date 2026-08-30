import app from "./app";
import { logger } from "./lib/logger";
import { startCredentialRotationScheduler } from "./lib/credentialRotation.js";
import { startGovernanceIntegrityCheck } from "./lib/governanceIntegrityCheck.js";
import { seedOnboardingAgentGovernanceFiles } from "./onboarding/seedOnboardingAgent.js";
import { seedVdaNativeAgents } from "./onboarding/seedVdaNativeAgents.js";
import { backfillRoleBand } from "./lib/backfillRoleBand.js";
import { seedPlatformGovernanceFiles } from "./routes/admin.js";
import { seedCompanyGovernance } from "./routes/seed.js";
import { seedStayAgentGovernance } from "./lib/seedStayAgent.js";
import { reissueMandatesIfLegacy, recoverOrphanedMandates } from "./lib/mandateIssuer.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startCredentialRotationScheduler();
  startGovernanceIntegrityCheck();
  seedOnboardingAgentGovernanceFiles().catch(err =>
    logger.warn({ err }, "Onboarding agent seed deferred")
  );
  seedVdaNativeAgents().catch(err =>
    logger.warn({ err }, "VDA native agents seed deferred")
  );
  backfillRoleBand().catch(err =>
    logger.warn({ err }, "Role band backfill deferred")
  );
  seedPlatformGovernanceFiles().catch(err =>
    logger.warn({ err }, "Platform governance files seed deferred")
  );
  // Seed all canonical VDA-MD AGENTS/SOP/SKILL files at companyId=0 (platform).
  // The CISO sandbox evaluates against companyId=0 — these files MUST exist at genesis.
  seedCompanyGovernance(0, "citizenM").catch(err =>
    logger.warn({ err }, "Platform VDA-MD canonical governance seed deferred")
  );
  // Stay Agent governance (AGENTS/SOP/SKILL/EXCEPTION_AUTHORITY) at platform baseline.
  seedStayAgentGovernance(0).catch(err =>
    logger.warn({ err }, "Stay Agent governance seed deferred")
  );
  reissueMandatesIfLegacy().catch(err =>
    logger.warn({ err }, "Mandate Ed25519 migration deferred")
  );
  recoverOrphanedMandates().catch(err =>
    logger.warn({ err }, "Mandate orphan recovery deferred")
  );
});
