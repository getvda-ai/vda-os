import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import router from "./routes";
import { logger } from "./lib/logger";
import { getPlatformCard } from "./a2a/agentCardRegistry";
import { buildUcpServiceDescriptor } from "./lib/ucpOffer";
import { signDidAuthChallenge, stayIdentity } from "./identity/stayIdentity";

const app: Express = express();

// ── Stay Agent Console (self-contained HTML, hits the live API same-origin) ──
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const _pubColocated = path.join(__dirname, "public");
const _pubSibling = path.join(__dirname, "../public");
const PUBLIC_DIR = existsSync(_pubColocated) ? _pubColocated : _pubSibling;
function serveConsole(_req: express.Request, res: express.Response) {
  try {
    res.type("html").send(readFileSync(path.join(PUBLIC_DIR, "stay-console.html"), "utf-8"));
  } catch {
    res.status(404).send("Stay Agent console not found");
  }
}
app.get("/", (_req, res) => res.redirect("/stay"));
app.get("/stay", serveConsole);

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

// ── Stay Agent's OWN identity (did:web + signed A2A card) ───────────────────
// These three are the public surface of the identity assembled in identity/stayIdentity.ts.
// When the key is not provisioned they 503 with a reason rather than serving a document
// built from an in-process key — an identity that rotates on every cold start reads as
// tampering to anyone who cached it. See the header of stayIdentity.ts.
function identityUnavailable(res: express.Response) {
  const state = stayIdentity.state;
  res.status(503).json({
    error: "identity_not_provisioned",
    did: stayIdentity.did,
    reason: state.provisioned ? "unknown" : state.reason,
    remedy: "Set STAY_DID_PRIVATE_KEY_B64 in this deployment (see scripts/gen-stay-did-key.mjs).",
  });
}

// did:web:<host> resolves here. Served as a stable document — the key rotates only via a
// real genesis, and the rotationLog is where that would show up.
app.get("/.well-known/did.json", (_req, res) => {
  if (!stayIdentity.didDocument) return identityUnavailable(res);
  res.setHeader("Cache-Control", "public, max-age=3600");
  if (stayIdentity.state.provisioned && stayIdentity.state.ephemeral) {
    res.setHeader("X-Stay-Identity", "ephemeral-dev");
  }
  res.type("application/json").json(stayIdentity.didDocument);
});

// Stay Agent's own signed A2A card. Distinct from /.well-known/agent.json above, which is
// the vda-os PLATFORM card and predates this agent having an identity.
app.get("/.well-known/agent-card.json", (_req, res) => {
  if (!stayIdentity.card) return identityUnavailable(res);
  res.setHeader("Cache-Control", "public, max-age=300");
  if (stayIdentity.state.provisioned && stayIdentity.state.ephemeral) {
    res.setHeader("X-Stay-Identity", "ephemeral-dev");
  }
  res.json(stayIdentity.card);
});

// Holder-binding: prove control of the DID over a caller-supplied nonce. Deliberately
// unauthenticated — a challenge response reveals nothing a verifier could not already get
// by reading the public key, and requiring auth here would defeat the purpose.
app.post("/.well-known/did-auth", (req, res) => {
  if (!stayIdentity.key) return identityUnavailable(res);

  const body = (req.body ?? {}) as { challenge?: unknown; domain?: unknown };
  const challenge = typeof body.challenge === "string" ? body.challenge.trim() : "";
  // A nonce shorter than this is not worth signing; the ceiling stops us signing a payload
  // a caller chose the bulk of.
  if (challenge.length < 16 || challenge.length > 512) {
    res.status(400).json({
      error: "invalid_challenge",
      message: "body.challenge must be a caller-generated nonce, 16–512 characters.",
    });
    return;
  }
  const domain =
    typeof body.domain === "string" && body.domain.trim().length > 0 && body.domain.length <= 253
      ? body.domain.trim()
      : null;

  res.json(signDidAuthChallenge(stayIdentity, challenge, domain));
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
