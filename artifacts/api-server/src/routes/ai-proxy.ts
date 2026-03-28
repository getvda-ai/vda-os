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

export async function callAI(params: {
  model?: string;
  max_tokens?: number;
  system?: string;
  messages: { role: "user" | "assistant"; content: string }[];
}): Promise<string> {
  const resolvedModel = resolveModel(params.model || "claude-sonnet-4-6");
  const response = await anthropic.messages.create({
    model: resolvedModel,
    max_tokens: params.max_tokens || 8192,
    messages: params.messages,
    ...(params.system ? { system: params.system } : {}),
  });
  const block = response.content[0];
  return block?.type === "text" ? block.text : "";
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

    if (system) params.system = system;
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
