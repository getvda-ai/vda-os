import { logger } from "./logger.js";
import type { ApaleoTokenResponse } from "./apaleo-types.js";

const APALEO_TOKEN_URL = "https://identity.apaleo.com/connect/token";

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
    throw new Error(
      "APALEO_CLIENT_ID and APALEO_CLIENT_SECRET environment variables are required"
    );
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(APALEO_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Apaleo OAuth token request failed: ${response.status} ${response.statusText} — ${text}`
    );
  }

  const data = (await response.json()) as ApaleoTokenResponse;

  tokenCache = {
    accessToken: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };

  logger.info(
    { expiresIn: data.expires_in },
    "Apaleo access token refreshed"
  );

  return tokenCache.accessToken;
}

export function getTokenExpiry(): string | undefined {
  if (!tokenCache) return undefined;
  return new Date(tokenCache.expiresAt).toISOString();
}

export function clearTokenCache(): void {
  tokenCache = null;
}
