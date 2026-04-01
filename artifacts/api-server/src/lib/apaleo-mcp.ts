import { logger } from "./logger.js";

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpToolCallResult {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

let mcpToolsCache: McpToolDefinition[] | null = null;
let mcpToolsCacheTime = 0;
const MCP_CACHE_TTL_MS = 60_000;

function getMcpConfig(): { url: string; token: string } | null {
  const url = process.env.APALEO_MCP_URL;
  const token = process.env.APALEO_MCP_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

export function isMcpConfigured(): boolean {
  return getMcpConfig() !== null;
}

export async function listMcpTools(): Promise<McpToolDefinition[]> {
  const config = getMcpConfig();
  if (!config) {
    return [];
  }

  const now = Date.now();
  if (mcpToolsCache && now - mcpToolsCacheTime < MCP_CACHE_TTL_MS) {
    return mcpToolsCache;
  }

  try {
    const response = await fetch(`${config.url}/tools/list`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`MCP tools/list failed: ${response.status} — ${text}`);
    }

    const data = (await response.json()) as { tools?: McpToolDefinition[] };
    const tools = data.tools ?? [];
    mcpToolsCache = tools;
    mcpToolsCacheTime = now;
    return tools;
  } catch (err) {
    logger.error({ err }, "Failed to list MCP tools");
    throw err;
  }
}

export async function callMcpTool(
  toolName: string,
  toolArgs: Record<string, unknown>
): Promise<McpToolCallResult> {
  const config = getMcpConfig();
  if (!config) {
    throw new Error(
      "Apaleo MCP server is not configured. Set APALEO_MCP_URL and APALEO_MCP_TOKEN."
    );
  }

  const response = await fetch(`${config.url}/tools/call`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: toolName, arguments: toolArgs }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `MCP tools/call failed for "${toolName}": ${response.status} — ${text}`
    );
  }

  return response.json() as Promise<McpToolCallResult>;
}

export function clearMcpToolsCache(): void {
  mcpToolsCache = null;
  mcpToolsCacheTime = 0;
}
