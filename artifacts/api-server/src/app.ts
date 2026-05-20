import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { getPlatformCard } from "./a2a/agentCardRegistry";
import { buildUcpServiceDescriptor } from "./lib/ucpOffer";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// /.well-known/agent.json — public A2A platform card (no /api prefix)
app.get("/.well-known/agent.json", (_req, res) => {
  res.json(getPlatformCard());
});

// /.well-known/ucp.json — UCP 2026 Service Descriptor (no /api prefix)
app.get("/.well-known/ucp.json", (_req, res) => {
  const baseUrl = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : process.env.REPLIT_URL ?? "http://localhost:8080";
  res.json(buildUcpServiceDescriptor(baseUrl.replace(/\/$/, "")));
});

app.use("/api", router);

export default app;
