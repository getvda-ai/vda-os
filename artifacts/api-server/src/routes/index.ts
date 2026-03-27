import { Router, type IRouter } from "express";
import healthRouter from "./health";
import aiProxyRouter from "./ai-proxy";
import companiesRouter from "./companies";

const router: IRouter = Router();

router.use(healthRouter);
router.use(aiProxyRouter);
router.use(companiesRouter);

export default router;
