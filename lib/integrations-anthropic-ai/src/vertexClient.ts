import { GoogleAuth } from "google-auth-library";
import type Anthropic from "@anthropic-ai/sdk";
import type { Message } from "@anthropic-ai/sdk/resources/messages/messages";

/**
 * Minimal, version-proof Claude-on-Vertex client.
 *
 * The official `@anthropic-ai/vertex-sdk` rewrites the request URL via a private
 * middleware that is coupled to a specific `@anthropic-ai/sdk` internal request
 * pipeline; that coupling silently breaks across core-SDK majors (the request
 * lands on `/v1/v1/messages` and 404s). Since the rest of the codebase only ever
 * calls `anthropic.messages.create(...)` (non-streaming), we implement exactly
 * that against Vertex's `:rawPredict` endpoint, which returns the *identical*
 * Anthropic Messages response schema — so tool-use, usage and content blocks all
 * flow through unchanged.
 *
 * Auth is Application Default Credentials (no API key). Run
 * `gcloud auth application-default login` locally, or use a service account /
 * workload identity in cloud.
 */

const DEFAULT_VERTEX_ANTHROPIC_VERSION = "vertex-2023-10-16";

function endpointHost(region: string): string {
  // The multi-region "global" endpoint has no region prefix.
  return region === "global"
    ? "aiplatform.googleapis.com"
    : `${region}-aiplatform.googleapis.com`;
}

export function createVertexAnthropicClient(opts: {
  projectId: string;
  region: string;
}): Anthropic {
  const { projectId, region } = opts;
  const auth = new GoogleAuth({
    scopes: "https://www.googleapis.com/auth/cloud-platform",
  });

  async function createMessage(params: Record<string, unknown>): Promise<Message> {
    const model = String(params.model ?? "");
    if (!model) throw new Error("Vertex messages.create: `model` is required.");

    // Vertex carries the model in the URL, not the body, and requires
    // `anthropic_version`. Streaming is not used by the decision engine; force
    // non-streaming so a stray `stream:true` can't change the wire shape.
    const { model: _omitModel, stream: _omitStream, ...rest } = params;
    const body = { ...rest, anthropic_version: DEFAULT_VERTEX_ANTHROPIC_VERSION };

    const url =
      `https://${endpointHost(region)}/v1/projects/${projectId}` +
      `/locations/${region}/publishers/anthropic/models/${model}:rawPredict`;

    const token = await auth.getAccessToken();
    if (!token) {
      throw new Error(
        "Could not obtain a Google access token. Configure ADC via `gcloud auth application-default login` or a service account.",
      );
    }

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      throw new Error(
        `Vertex rawPredict ${resp.status} for model ${model} (${region}): ${detail.slice(0, 800)}`,
      );
    }
    return (await resp.json()) as Message;
  }

  // Structural shim: the codebase only touches `.messages.create`. Present it as
  // an Anthropic client to keep every call site provider-agnostic.
  const shim = {
    messages: {
      create: (params: Record<string, unknown>) => createMessage(params),
    },
  };
  return shim as unknown as Anthropic;
}
