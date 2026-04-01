import { Router, type IRouter } from "express";
import healthRouter from "./health";
import aiProxyRouter from "./ai-proxy";
import companiesRouter from "./companies";
import fileManagerRouter from "./fileManager";
import apaleoRouter from "./apaleo";

const router: IRouter = Router();

router.use(healthRouter);
router.use(aiProxyRouter);
router.use(companiesRouter);
router.use(fileManagerRouter);
router.use(apaleoRouter);

export default router;
