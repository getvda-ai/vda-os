import { Router, type IRouter } from "express";
import { anthropic } from "@workspace/integrations-anthropic-ai";

const router: IRouter = Router();

const MODEL_MAP: Record<string, string> = {
  "claude-sonnet-4-20250514": "claude-sonnet-4-6",
  "claude-opus-4-20250514": "claude-opus-4-6",
  "claude-haiku-4-20250514": "claude-haiku-4-5",
};

export function resolveModel(requested: string): string {
  if (MODEL_MAP[requested]) return MODEL_MAP[requested];
  const supported = ["claude-sonnet-4-6", "claude-sonnet-4-5", "claude-opus-4-6", "claude-opus-4-5", "claude-opus-4-1", "claude-haiku-4-5"];
  if (supported.includes(requested)) return requested;
  return "claude-sonnet-4-6";
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
  const createParams: Record<string, unknown> = {
    model: resolvedModel,
    max_tokens: params.max_tokens || 4096,
    messages: params.messages,
  };
  const cachedSystem = toCacheableSystem(params.system);
  if (cachedSystem) createParams.system = cachedSystem;
  if (params.tools && params.tools.length > 0) createParams.tools = params.tools;
  const response = await anthropic.messages.create(createParams as Parameters<typeof anthropic.messages.create>[0]);
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
  const createParams: Record<string, unknown> = {
    model: resolvedModel,
    max_tokens: params.max_tokens || 4096,
    messages: params.messages,
  };
  const cachedSystem = toCacheableSystem(params.system);
  if (cachedSystem) createParams.system = cachedSystem;
  if (params.tools && params.tools.length > 0) createParams.tools = params.tools;
  const response = await anthropic.messages.create(createParams as Parameters<typeof anthropic.messages.create>[0]);
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

    const cachedSystem = toCacheableSystem(system);
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
