import app from "./app";
import { logger } from "./lib/logger";
import { startCredentialRotationScheduler } from "./lib/credentialRotation.js";
import { startGovernanceIntegrityCheck } from "./lib/governanceIntegrityCheck.js";
import { seedOnboardingAgentGovernanceFiles } from "./onboarding/seedOnboardingAgent.js";
import { backfillRoleBand } from "./lib/backfillRoleBand.js";
import { seedPlatformGovernanceFiles } from "./routes/admin.js";

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
  backfillRoleBand().catch(err =>
    logger.warn({ err }, "Role band backfill deferred")
  );
  seedPlatformGovernanceFiles().catch(err =>
    logger.warn({ err }, "Platform governance files seed deferred")
  );
});
