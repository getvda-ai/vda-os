import Anthropic from "@anthropic-ai/sdk";
import { createVertexAnthropicClient } from "./vertexClient";
import { createVertexGeminiClient } from "./vertexGeminiClient";

/**
 * AI provider selection — VDA-MD keeps the model provider behind this single
 * client so the decision engine and `/api/ai/messages` proxy never hardcode a
 * vendor SDK. Backends:
 *
 *   - "vertex"    → Google Vertex AI (ADC auth, no API key). Sub-selected by
 *                   VERTEX_MODEL_FAMILY:
 *                     · "gemini" (default) → Gemini via `generateContent`,
 *                       translated to/from the Anthropic Messages shape.
 *                     · "claude"          → Claude via `:rawPredict` (requires
 *                       Anthropic-model quota granted on the GCP project).
 *   - "anthropic" → Anthropic API (or a compatible gateway) via `@anthropic-ai/sdk`.
 *
 * Selection: `AI_PROVIDER` env var wins. If unset, Vertex is used when a Vertex
 * project is discoverable and no Anthropic key is present; otherwise Anthropic.
 *
 * Every backend exposes the identical `.messages.create()` surface and the same
 * message/tool types, so all downstream code is provider-agnostic.
 */

const explicitProvider = (process.env.AI_PROVIDER || "").trim().toLowerCase();
const vertexModelFamily = (process.env.VERTEX_MODEL_FAMILY || "gemini").trim().toLowerCase();

const vertexProjectId =
  process.env.ANTHROPIC_VERTEX_PROJECT_ID ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.GCLOUD_PROJECT ||
  process.env.GCP_PROJECT ||
  "";

const vertexRegion =
  process.env.CLOUD_ML_REGION ||
  process.env.ANTHROPIC_VERTEX_REGION ||
  process.env.VERTEX_REGION ||
  "global";

const vertexGeminiModel = process.env.VERTEX_GEMINI_MODEL || "gemini-2.5-flash";

const hasAnthropicKey = Boolean(
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY,
);

const useVertex =
  explicitProvider === "vertex" ||
  (explicitProvider !== "anthropic" && !hasAnthropicKey && Boolean(vertexProjectId));

function makeVertexClient(): Anthropic {
  if (!vertexProjectId) {
    throw new Error(
      "AI_PROVIDER=vertex requires a project. Set ANTHROPIC_VERTEX_PROJECT_ID (or GOOGLE_CLOUD_PROJECT) and ensure Application Default Credentials are configured (`gcloud auth application-default login`).",
    );
  }
  if (vertexModelFamily === "claude") {
    return createVertexAnthropicClient({
      projectId: vertexProjectId,
      region: vertexRegion,
    });
  }
  return createVertexGeminiClient({
    projectId: vertexProjectId,
    region: vertexRegion,
    model: vertexGeminiModel,
  });
}

function makeAnthropicClient(): Anthropic {
  const apiKey =
    process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "No AI provider configured. Set AI_PROVIDER=vertex (with a Vertex project + ADC) or provide ANTHROPIC_API_KEY / AI_INTEGRATIONS_ANTHROPIC_API_KEY.",
    );
  }
  return new Anthropic({
    apiKey,
    // Optional gateway base URL (e.g. Replit AI integration). Omit for api.anthropic.com.
    ...(process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL
      ? { baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL }
      : {}),
  });
}

export const anthropic: Anthropic = useVertex
  ? makeVertexClient()
  : makeAnthropicClient();

/** Which backend the exported `anthropic` client is talking to. */
export const AI_BACKEND: "vertex" | "anthropic" = useVertex ? "vertex" : "anthropic";
