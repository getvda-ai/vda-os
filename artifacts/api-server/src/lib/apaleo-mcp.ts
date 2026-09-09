import { logger } from "./logger.js";
import { getApaleoToken } from "./apaleo-auth.js";

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpToolCallResult {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

// Calls Apaleo's MCP server DIRECTLY, injecting the bearer itself.
//
// It used to self-call the transparent proxy at http://localhost:${PORT}/api/mcp,
// which is where mcp-proxy.ts adds the token. That works on a long-lived server
// and FAILS ON SERVERLESS: on Vercel there is no localhost listener for the
// function to call back into, so every write died as "fetch failed" and the
// executor — correctly — recorded SANDBOX_NO_WRITE. The demo's headline claim,
// that a Witness entry carries a real Apaleo id, was therefore unreachable from
// the deployed environment while looking like an Apaleo sandbox limitation.
//
// The proxy still exists and is still the right thing for EXTERNAL MCP clients
// that need auth injected. It was never the right thing for this process, which
// already holds the credentials and was paying a network hop to borrow them.
const APALEO_MCP_URL = process.env.APALEO_MCP_URL ?? "https://mcp.apaleo.com/mcp";
const MCP_TOOLS_CACHE_TTL_MS = 5 * 60_000;

let mcpSessionId: string | null = null;
let mcpToolsCache: McpToolDefinition[] | null = null;
let mcpToolsCacheTime = 0;
let mcpRequestId = 1;

/**
 * Whether an Apaleo MCP call can even be attempted.
 *
 * This returned a bare `true` while auth lived in the proxy, which meant "not
 * configured" was indistinguishable from "configured and broken" — the executor
 * would report a write as attempted-and-failed when no credential existed at all.
 * Now that this module holds the credential, it can answer honestly.
 */
export function isMcpConfigured(): boolean {
  return Boolean(process.env.APALEO_CLIENT_ID && process.env.APALEO_CLIENT_SECRET);
}

async function mcpPost(body: object): Promise<unknown> {
  // Apaleo's MCP is on the session-based revision (Mcp-Session-Id, 2024-11-05),
  // not the 2026-07-28 stateless one. The session header below is not legacy
  // clutter — it is what that server requires.
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${await getApaleoToken()}`,
  };

  if (mcpSessionId) {
    headers["Mcp-Session-Id"] = mcpSessionId;
  }

  const resp = await fetch(APALEO_MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    if (resp.status === 404 || resp.status === 401) {
      mcpSessionId = null;
    }
    throw new Error(`MCP request failed ${resp.status}: ${text.slice(0, 300)}`);
  }

  const sid =
    resp.headers.get("mcp-session-id") ||
    resp.headers.get("Mcp-Session-Id");
  if (sid) mcpSessionId = sid;

  const contentType = resp.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    return parseSSEResponse(resp);
  }

  const text = await resp.text();
  if (!text.trim()) return null;

  const parsed = JSON.parse(text) as {
    result?: unknown;
    error?: unknown;
    [k: string]: unknown;
  };
  if (parsed.error) throw new Error(`MCP error: ${JSON.stringify(parsed.error)}`);
  return parsed.result ?? parsed;
}

async function parseSSEResponse(resp: Response): Promise<unknown> {
  const text = await resp.text();
  // Collect all parseable result events; prefer the last one (most terminal)
  // so multi-event SSE sequences resolve correctly.
  let lastResult: unknown = null;
  let firstError: Error | null = null;

  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const parsed = JSON.parse(data) as {
        result?: unknown;
        error?: unknown;
        tools?: unknown;
        content?: unknown;
        [k: string]: unknown;
      };
      if (parsed.error) {
        // Capture first error but continue scanning (a later event may succeed)
        firstError = firstError ?? new Error(`MCP error: ${JSON.stringify(parsed.error)}`);
        continue;
      }
      if (parsed.result !== undefined) {
        lastResult = parsed.result;
      } else if (parsed.tools !== undefined || parsed.content !== undefined) {
        lastResult = parsed;
      }
    } catch (e) {
      if (e instanceof SyntaxError) continue;
      throw e;
    }
  }

  if (lastResult !== null) return lastResult;
  if (firstError) throw firstError;
  return null;
}

async function ensureSession(): Promise<void> {
  if (mcpSessionId) return;
  try {
    await mcpPost({
      jsonrpc: "2.0",
      id: mcpRequestId++,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "VDA-MD Agent Suite", version: "1.0.0" },
      },
    });
    logger.info({ sessionId: mcpSessionId }, "MCP session initialized");
  } catch (err) {
    logger.warn({ err }, "MCP initialize failed — session may still work via REST fallback");
    throw err;
  }
}

export async function listMcpTools(): Promise<McpToolDefinition[]> {
  const now = Date.now();
  if (mcpToolsCache && now - mcpToolsCacheTime < MCP_TOOLS_CACHE_TTL_MS) {
    return mcpToolsCache;
  }

  await ensureSession();

  const result = (await mcpPost({
    jsonrpc: "2.0",
    id: mcpRequestId++,
    method: "tools/list",
    params: {},
  })) as { tools?: McpToolDefinition[] } | null;

  const tools = result?.tools ?? [];
  mcpToolsCache = tools;
  mcpToolsCacheTime = now;
  logger.info({ toolCount: tools.length }, "Apaleo MCP tools loaded");
  return tools;
}

export async function callMcpTool(
  toolName: string,
  toolArgs: Record<string, unknown>
): Promise<McpToolCallResult> {
  await ensureSession();

  const result = await mcpPost({
    jsonrpc: "2.0",
    id: mcpRequestId++,
    method: "tools/call",
    params: { name: toolName, arguments: toolArgs },
  });

  return (result as McpToolCallResult) ?? { content: [], isError: false };
}

export function clearMcpToolsCache(): void {
  mcpToolsCache = null;
  mcpToolsCacheTime = 0;
  mcpSessionId = null;
  mcpRequestId = 1;
}
