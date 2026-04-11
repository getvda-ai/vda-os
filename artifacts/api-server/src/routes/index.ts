import { Router, type IRouter } from "express";
import healthRouter from "./health";
import aiProxyRouter from "./ai-proxy";
import companiesRouter from "./companies";
import fileManagerRouter from "./fileManager";
import apaleoRouter from "./apaleo";
import agentsRouter from "./agents";
import mcpProxyRouter from "./mcp-proxy";
import seedRouter from "./seed";
import a2aRouter from "./a2a";
import hitlRouter from "./hitl";
import onboardingRollbackRouter from "../onboarding/onboardingRollback";

const router: IRouter = Router();

router.use(healthRouter);
router.use(aiProxyRouter);
router.use(companiesRouter);
router.use(fileManagerRouter);
router.use(apaleoRouter);
router.use(agentsRouter);
router.use(mcpProxyRouter);
router.use(seedRouter);
router.use(a2aRouter);
router.use(hitlRouter);
router.use(onboardingRollbackRouter);

export default router;
