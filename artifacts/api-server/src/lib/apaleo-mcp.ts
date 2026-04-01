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

const APALEO_MCP_URL = "https://mcp.apaleo.com/mcp";
const MCP_TOOLS_CACHE_TTL_MS = 5 * 60_000;

let mcpSessionId: string | null = null;
let mcpToolsCache: McpToolDefinition[] | null = null;
let mcpToolsCacheTime = 0;
let mcpRequestId = 1;

export function isMcpConfigured(): boolean {
  return true;
}

async function mcpPost(body: object): Promise<unknown> {
  const token = await getApaleoToken();

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
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
      if (parsed.error) throw new Error(`MCP error: ${JSON.stringify(parsed.error)}`);
      if (parsed.result !== undefined) return parsed.result;
      if (parsed.tools !== undefined || parsed.content !== undefined) return parsed;
    } catch (e) {
      if (e instanceof SyntaxError) continue;
      throw e;
    }
  }
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
        clientInfo: { name: "VDA-MK Agent Suite", version: "1.0.0" },
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
