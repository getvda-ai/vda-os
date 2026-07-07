import { randomUUID } from "node:crypto";
import { GoogleAuth } from "google-auth-library";
import type Anthropic from "@anthropic-ai/sdk";
import type { Message } from "@anthropic-ai/sdk/resources/messages/messages";

/**
 * Gemini-on-Vertex client presented behind the Anthropic `messages.create`
 * interface.
 *
 * The VDA-MD decision engine speaks the Anthropic Messages shape (system +
 * messages + `tool_use`/`tool_result` loop). Claude-on-Vertex is quota-blocked
 * on the target project, so we translate that shape to Gemini's
 * `generateContent` at the provider boundary and translate the response back —
 * so the engine, the `/api/ai/messages` proxy, Witness manifests, and the MCP
 * tool-use loop all stay provider-agnostic.
 *
 * Auth: Application Default Credentials (no API key).
 * Streaming is not used by the engine and is not implemented.
 */

const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

function endpointHost(region: string): string {
  return region === "global"
    ? "aiplatform.googleapis.com"
    : `${region}-aiplatform.googleapis.com`;
}

/** Anthropic `system` may be a string or an array of text blocks (cacheable). */
function systemToText(system: unknown): string | undefined {
  if (!system) return undefined;
  if (typeof system === "string") return system;
  if (Array.isArray(system)) {
    return system
      .map((b) => (typeof b === "string" ? b : (b as { text?: string })?.text ?? ""))
      .filter(Boolean)
      .join("\n\n");
  }
  return undefined;
}

type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

/** Collect tool_use id → tool name across the whole conversation so that
 *  Anthropic `tool_result` (which references only an id) can be mapped to a
 *  Gemini `functionResponse` (which needs the function name). */
function buildToolNameMap(messages: AnthropicMessage[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue;
    for (const block of m.content) {
      if (block && typeof block === "object" && (block as AnyBlock).type === "tool_use") {
        const b = block as ToolUseBlock;
        if (b.id && b.name) map.set(b.id, b.name);
      }
    }
  }
  return map;
}

function stringifyToolResultContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === "string") return c;
        const block = c as { type?: string; text?: string };
        if (block?.type === "text") return block.text ?? "";
        return JSON.stringify(c);
      })
      .join("\n");
  }
  if (content == null) return "";
  return JSON.stringify(content);
}

type AnyBlock = { type?: string; [k: string]: unknown };
type ToolUseBlock = { type: "tool_use"; id: string; name: string; input?: unknown };
type ToolResultBlock = { type: "tool_result"; tool_use_id: string; content?: unknown };
type TextBlock = { type: "text"; text: string };
type AnthropicMessage = { role: "user" | "assistant"; content: string | AnyBlock[] };

function messageToGeminiContent(
  m: AnthropicMessage,
  toolNames: Map<string, string>,
): { role: "user" | "model"; parts: GeminiPart[] } {
  const role = m.role === "assistant" ? "model" : "user";
  if (typeof m.content === "string") {
    return { role, parts: [{ text: m.content }] };
  }
  const parts: GeminiPart[] = [];
  for (const block of m.content) {
    const type = (block as AnyBlock).type;
    if (type === "text") {
      parts.push({ text: (block as TextBlock).text ?? "" });
    } else if (type === "tool_use") {
      const b = block as ToolUseBlock;
      parts.push({
        functionCall: { name: b.name, args: (b.input as Record<string, unknown>) ?? {} },
      });
    } else if (type === "tool_result") {
      const b = block as ToolResultBlock;
      const name = toolNames.get(b.tool_use_id) ?? b.tool_use_id;
      parts.push({
        functionResponse: {
          name,
          response: { result: stringifyToolResultContent(b.content) },
        },
      });
    }
  }
  if (parts.length === 0) parts.push({ text: "" });
  return { role, parts };
}

/** Strip JSON-Schema keywords Gemini's OpenAPI-subset rejects. */
function sanitizeSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(sanitizeSchema);
  if (!schema || typeof schema !== "object") return schema;
  const src = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const DROP = new Set([
    "$schema",
    "additionalProperties",
    "title",
    "default",
    "$id",
    "$ref",
    "definitions",
    "examples",
  ]);
  for (const [k, v] of Object.entries(src)) {
    if (DROP.has(k)) continue;
    if (k === "properties" && v && typeof v === "object") {
      const props: Record<string, unknown> = {};
      for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) {
        props[pk] = sanitizeSchema(pv);
      }
      out[k] = props;
    } else if (k === "items") {
      out[k] = sanitizeSchema(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function toGeminiTools(tools: unknown): unknown {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  const functionDeclarations = tools
    .filter((t) => t && typeof t === "object")
    .map((t) => {
      const tool = t as { name: string; description?: string; input_schema?: unknown };
      const params = sanitizeSchema(tool.input_schema) as Record<string, unknown> | undefined;
      const decl: Record<string, unknown> = {
        name: tool.name,
        description: tool.description ?? "",
      };
      // Only attach parameters when there is at least one property; Gemini
      // rejects an empty object-typed schema with no properties.
      if (
        params &&
        params.properties &&
        Object.keys(params.properties as Record<string, unknown>).length > 0
      ) {
        decl.parameters = params;
      }
      return decl;
    });
  return [{ functionDeclarations }];
}

function toolChoiceToConfig(toolChoice: unknown): unknown {
  if (!toolChoice || typeof toolChoice !== "object") return undefined;
  const tc = toolChoice as { type?: string };
  const mode =
    tc.type === "any" || tc.type === "tool" ? "ANY" : tc.type === "none" ? "NONE" : "AUTO";
  return { functionCallingConfig: { mode } };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<Record<string, unknown>> };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    cachedContentTokenCount?: number;
  };
}

function geminiToAnthropicMessage(json: GeminiResponse, model: string): Message {
  const candidate = json.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const content: Array<Record<string, unknown>> = [];
  let sawToolUse = false;
  for (const part of parts) {
    if (typeof part.text === "string" && part.text.length > 0) {
      content.push({ type: "text", text: part.text });
    } else if (part.functionCall) {
      sawToolUse = true;
      const fc = part.functionCall as { name: string; args?: Record<string, unknown> };
      content.push({
        type: "tool_use",
        id: `toolu_${fc.name}_${randomUUID().slice(0, 8)}`,
        name: fc.name,
        input: fc.args ?? {},
      });
    }
  }
  if (content.length === 0) content.push({ type: "text", text: "" });

  const finish = candidate?.finishReason;
  const stop_reason = sawToolUse
    ? "tool_use"
    : finish === "MAX_TOKENS"
      ? "max_tokens"
      : "end_turn";

  const usage = json.usageMetadata ?? {};
  return {
    id: `msg_${randomUUID().slice(0, 12)}`,
    type: "message",
    role: "assistant",
    model,
    content: content as unknown as Message["content"],
    stop_reason: stop_reason as Message["stop_reason"],
    stop_sequence: null,
    usage: {
      input_tokens: usage.promptTokenCount ?? 0,
      output_tokens: usage.candidatesTokenCount ?? 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: usage.cachedContentTokenCount ?? 0,
    },
  } as unknown as Message;
}

export function createVertexGeminiClient(opts: {
  projectId: string;
  region: string;
  model: string;
}): Anthropic {
  const { projectId, region, model } = opts;
  const auth = new GoogleAuth({ scopes: CLOUD_PLATFORM_SCOPE });

  async function createMessage(params: Record<string, unknown>): Promise<Message> {
    const messages = (params.messages as AnthropicMessage[]) ?? [];
    const toolNames = buildToolNameMap(messages);

    const body: Record<string, unknown> = {
      contents: messages.map((m) => messageToGeminiContent(m, toolNames)),
      generationConfig: {
        maxOutputTokens: (params.max_tokens as number) ?? 4096,
      },
    };
    const systemText = systemToText(params.system);
    if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };
    const geminiTools = toGeminiTools(params.tools);
    if (geminiTools) body.tools = geminiTools;
    const toolConfig = toolChoiceToConfig(params.tool_choice);
    if (toolConfig) body.toolConfig = toolConfig;

    // Callers pass a Claude alias in `model`; Gemini uses its own id (opts.model),
    // unless the caller explicitly passed a gemini-* id.
    const requested = String(params.model ?? "");
    const useModel = requested.startsWith("gemini") ? requested : model;

    const url =
      `https://${endpointHost(region)}/v1/projects/${projectId}` +
      `/locations/${region}/publishers/google/models/${useModel}:generateContent`;

    const token = await auth.getAccessToken();
    if (!token) {
      throw new Error(
        "Could not obtain a Google access token. Configure ADC via `gcloud auth application-default login` or a service account.",
      );
    }

    const resp = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      throw new Error(
        `Vertex Gemini generateContent ${resp.status} for model ${useModel} (${region}): ${detail.slice(0, 800)}`,
      );
    }
    const json = (await resp.json()) as GeminiResponse;
    return geminiToAnthropicMessage(json, useModel);
  }

  const shim = {
    messages: { create: (params: Record<string, unknown>) => createMessage(params) },
  };
  return shim as unknown as Anthropic;
}
