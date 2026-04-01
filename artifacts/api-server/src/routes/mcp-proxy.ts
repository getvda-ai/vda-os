import { Router } from "express";
import { getApaleoToken } from "../lib/apaleo";
import { logger } from "../lib/logger";

const router = Router();

const APALEO_MCP_URL = "https://mcp.apaleo.com/mcp";

// ─── Apaleo MCP Transparent Proxy ────────────────────────────────────────────
// Proxies all MCP protocol traffic to Apaleo's MCP server.
// Automatically refreshes the Apaleo bearer token (cached, expires in 60min).
// Supports both regular JSON and SSE streaming responses.
// ─────────────────────────────────────────────────────────────────────────────

async function handleMcp(req: any, res: any) {
  try {
    const token = await getApaleoToken();

    const forwardHeaders: Record<string, string> = {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    };

    // Forward MCP session ID if present
    if (req.headers["mcp-session-id"]) {
      forwardHeaders["Mcp-Session-Id"] = req.headers["mcp-session-id"] as string;
    }

    const upstreamResp = await fetch(APALEO_MCP_URL, {
      method: req.method,
      headers: forwardHeaders,
      body: req.method === "POST" ? JSON.stringify(req.body) : undefined,
    });

    // Forward session ID from upstream back to client
    const sessionId = upstreamResp.headers.get("mcp-session-id");
    if (sessionId) {
      res.setHeader("Mcp-Session-Id", sessionId);
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Mcp-Session-Id, Authorization");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

    const contentType = upstreamResp.headers.get("content-type") || "application/json";
    res.setHeader("Content-Type", contentType);

    const isSSE = contentType.includes("text/event-stream");

    if (isSSE) {
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.status(upstreamResp.status);

      if (!upstreamResp.body) {
        res.end();
        return;
      }

      const reader = (upstreamResp.body as any).getReader();
      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            res.end();
            break;
          }
          res.write(value);
        }
      };
      await pump();
    } else {
      const body = await upstreamResp.text();
      res.status(upstreamResp.status).send(body);
    }
  } catch (err: any) {
    logger.error({ err: err.message }, "MCP proxy error");
    res.status(502).json({ error: "MCP proxy error", detail: err.message });
  }
}

router.options("/mcp", (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Mcp-Session-Id, Authorization");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
  res.status(204).end();
});

router.all("/mcp", handleMcp);

export default router;
