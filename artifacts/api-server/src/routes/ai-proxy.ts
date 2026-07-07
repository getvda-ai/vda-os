import { Router, type IRouter } from "express";
import {
  anthropic,
  AI_BACKEND,
  type Message,
  type MessageParam,
  type Tool,
  type MessageCreateParamsNonStreaming,
} from "@workspace/integrations-anthropic-ai";

const router: IRouter = Router();

const MODEL_MAP: Record<string, string> = {
  "claude-sonnet-4-20250514": "claude-sonnet-4-6",
  "claude-opus-4-20250514": "claude-opus-4-6",
  "claude-haiku-4-20250514": "claude-haiku-4-5",
};

/**
 * Canonical → Vertex Model Garden model IDs. Vertex uses `<model>@<version>`
 * publisher IDs, not the gateway aliases the rest of the codebase passes around.
 * Each is overridable by env so the deployment can pin whatever is enabled in
 * its Model Garden / region without a code change.
 */
const VERTEX_MODEL_MAP: Record<string, string> = {
  "claude-opus-4-6": process.env.VERTEX_CLAUDE_OPUS || "claude-opus-4-1@20250805",
  "claude-opus-4-5": process.env.VERTEX_CLAUDE_OPUS || "claude-opus-4-1@20250805",
  "claude-opus-4-1": process.env.VERTEX_CLAUDE_OPUS || "claude-opus-4-1@20250805",
  "claude-sonnet-4-6": process.env.VERTEX_CLAUDE_SONNET || "claude-sonnet-4-5@20250929",
  "claude-sonnet-4-5": process.env.VERTEX_CLAUDE_SONNET || "claude-sonnet-4-5@20250929",
  "claude-haiku-4-5": process.env.VERTEX_CLAUDE_HAIKU || "claude-haiku-4-5@20251001",
};

export function resolveModel(requested: string): string {
  // Normalise to a canonical gateway alias first.
  let canonical: string;
  if (MODEL_MAP[requested]) canonical = MODEL_MAP[requested];
  else {
    const supported = ["claude-sonnet-4-6", "claude-sonnet-4-5", "claude-opus-4-6", "claude-opus-4-5", "claude-opus-4-1", "claude-haiku-4-5"];
    canonical = supported.includes(requested) ? requested : "claude-sonnet-4-6";
  }
  // On Vertex, translate the canonical alias into a Model Garden publisher ID.
  if (AI_BACKEND === "vertex") {
    // If the caller already passed a Vertex-style `<model>@<version>` id, honour it.
    if (requested.includes("@")) return requested;
    return VERTEX_MODEL_MAP[canonical] || VERTEX_MODEL_MAP["claude-sonnet-4-6"];
  }
  return canonical;
}

function toCacheableSystem(system: string | undefined) {
  if (!system) return undefined;
  return [{ type: "text" as const, text: system, cache_control: { type: "ephemeral" as const } }];
}

type AnthropicUsageWithCache = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

export async function callAI(params: {
  model?: string;
  max_tokens?: number;
  system?: string;
  messages: { role: "user" | "assistant"; content: string }[];
}): Promise<string> {
  const resolvedModel = resolveModel(params.model || "claude-sonnet-4-6");
  const cachedSystem = toCacheableSystem(params.system);
  const response = await anthropic.messages.create({
    model: resolvedModel,
    max_tokens: params.max_tokens || 8192,
    messages: params.messages,
    ...(cachedSystem ? { system: cachedSystem } : {}),
  });
  const block = response.content[0];
  return block?.type === "text" ? block.text : "";
}

export async function callAIWithUsage(params: {
  model?: string;
  max_tokens?: number;
  system?: string;
  messages: { role: "user" | "assistant"; content: string }[];
}): Promise<{
  text: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}> {
  const resolvedModel = resolveModel(params.model || "claude-sonnet-4-6");
  const cachedSystem = toCacheableSystem(params.system);
  const response = await anthropic.messages.create({
    model: resolvedModel,
    max_tokens: params.max_tokens || 8192,
    messages: params.messages,
    ...(cachedSystem ? { system: cachedSystem } : {}),
  });
  const block = response.content[0];
  const usage = response.usage as AnthropicUsageWithCache;
  return {
    text: block?.type === "text" ? block.text : "",
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheCreationTokens: usage?.cache_creation_input_tokens ?? 0,
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
  };
}

export async function callAIFull(params: {
  model?: string;
  max_tokens?: number;
  system?: string;
  messages: unknown[];
  tools?: unknown[];
}): Promise<{
  content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
  stop_reason: string;
}> {
  const resolvedModel = resolveModel(params.model || "claude-sonnet-4-6");
  const cachedSystem = toCacheableSystem(params.system);
  const createParams: MessageCreateParamsNonStreaming = {
    model: resolvedModel,
    max_tokens: params.max_tokens || 4096,
    messages: params.messages as MessageParam[],
    ...(cachedSystem ? { system: cachedSystem } : {}),
    ...(params.tools && params.tools.length > 0 ? { tools: params.tools as Tool[] } : {}),
  };
  const response: Message = await anthropic.messages.create(createParams);
  return {
    content: response.content as Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>,
    stop_reason: response.stop_reason ?? "end_turn",
  };
}

export async function callAIFullWithUsage(params: {
  model?: string;
  max_tokens?: number;
  system?: string;
  messages: unknown[];
  tools?: unknown[];
}): Promise<{
  content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
  stop_reason: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}> {
  const resolvedModel = resolveModel(params.model || "claude-sonnet-4-6");
  const cachedSystem = toCacheableSystem(params.system);
  const createParams: MessageCreateParamsNonStreaming = {
    model: resolvedModel,
    max_tokens: params.max_tokens || 4096,
    messages: params.messages as MessageParam[],
    ...(cachedSystem ? { system: cachedSystem } : {}),
    ...(params.tools && params.tools.length > 0 ? { tools: params.tools as Tool[] } : {}),
  };
  const response: Message = await anthropic.messages.create(createParams);
  const usage = response.usage as AnthropicUsageWithCache;
  return {
    content: response.content as Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>,
    stop_reason: response.stop_reason ?? "end_turn",
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheCreationTokens: usage?.cache_creation_input_tokens ?? 0,
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
  };
}

router.post("/ai/messages", async (req, res) => {
  try {
    const { model, max_tokens, system, messages, tools, tool_choice, ...rest } = req.body;

    const resolvedModel = resolveModel(model || "claude-sonnet-4-6");

    const params: Parameters<typeof anthropic.messages.create>[0] = {
      model: resolvedModel,
      max_tokens: max_tokens || 8192,
      messages,
      ...rest,
    };

    const cachedSystem = typeof system === "string" ? toCacheableSystem(system) : system;
    if (cachedSystem) params.system = cachedSystem;
    if (tools) params.tools = tools;
    if (tool_choice) params.tool_choice = tool_choice;

    const response = await anthropic.messages.create(params);
    res.json(response);
  } catch (err: unknown) {
    req.log.error({ err }, "AI proxy error");
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: { message } });
  }
});

export default router;
