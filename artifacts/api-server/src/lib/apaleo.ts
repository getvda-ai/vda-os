import { logger } from "./logger";

const APALEO_TOKEN_URL = "https://identity.apaleo.com/connect/token";
const APALEO_API_BASE = "https://api.apaleo.com";

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

export async function getApaleoToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 30_000) {
    return tokenCache.accessToken;
  }

  const clientId = process.env.APALEO_CLIENT_ID;
  const clientSecret = process.env.APALEO_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("APALEO_CLIENT_ID and APALEO_CLIENT_SECRET must be set");
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });

  if (process.env.APALEO_SCOPES) {
    body.set("scope", process.env.APALEO_SCOPES);
  }

  const resp = await fetch(APALEO_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    logger.error({ status: resp.status, body: text }, "Apaleo token request failed");
    throw new Error(`Apaleo OAuth failed: ${resp.status} ${text}`);
  }

  const data = await resp.json() as { access_token: string; expires_in: number };
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };

  logger.info("Apaleo access token refreshed");
  return tokenCache.accessToken;
}

export async function apaleoFetch<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await getApaleoToken();
  const url = `${APALEO_API_BASE}${path}`;

  const resp = await fetch(url, {
    ...options,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!resp.ok) {
    const text = await resp.text();
    logger.error({ status: resp.status, url, body: text }, "Apaleo API request failed");
    throw new Error(`Apaleo API error ${resp.status}: ${text}`);
  }

  if (resp.status === 204) return {} as T;
  return resp.json() as Promise<T>;
}

export function buildQueryString(params: Record<string, string | number | boolean | undefined>): string {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  return qs ? `?${qs}` : "";
}
