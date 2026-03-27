import { Router, type IRouter } from "express";
import healthRouter from "./health";
import aiProxyRouter from "./ai-proxy";

const router: IRouter = Router();

router.use(healthRouter);
router.use(aiProxyRouter);

export default router;
