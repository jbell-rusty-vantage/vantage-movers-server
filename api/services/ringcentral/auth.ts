import { getRequiredEnv } from "../../config/domain";
import { logger } from "../../logger";
import { createTokenStore } from "./token-store";
import type { RingCentralTokenCache, TokenStore } from "./types";

const TOKEN_EXPIRY_BUFFER_MS = 120_000;
const tokenStore = createTokenStore();

type RingCentralTokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
  refresh_token_expires_in?: unknown;
  scope?: unknown;
  owner_id?: unknown;
  endpoint_id?: unknown;
};

export class RingCentralAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "RingCentralAuthError";
  }
}

export async function exchangeJwtForToken(): Promise<RingCentralTokenCache> {
  const token = await postTokenRequest(
    new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: getRequiredEnv("RC_JWT"),
    }),
    "jwt",
  );
  await tokenStore.set(token);
  logTokenSummary("ringcentral.auth.jwt_exchange.succeeded", token);
  return token;
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<RingCentralTokenCache> {
  const token = await postTokenRequest(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    "refresh",
  );
  await tokenStore.set(token);
  logTokenSummary("ringcentral.auth.refresh.succeeded", token);
  return token;
}

export async function getValidToken(): Promise<RingCentralTokenCache> {
  const cached = await tokenStore.get();
  const now = Date.now();

  if (
    cached &&
    cached.access_token_expires_at - now > TOKEN_EXPIRY_BUFFER_MS
  ) {
    return cached;
  }

  if (
    cached?.refresh_token &&
    cached.refresh_token_expires_at &&
    cached.refresh_token_expires_at - now > TOKEN_EXPIRY_BUFFER_MS
  ) {
    try {
      return await refreshAccessToken(cached.refresh_token);
    } catch (error) {
      logger.warn({
        msg: "ringcentral.auth.refresh.failed",
        status: error instanceof RingCentralAuthError ? error.status : null,
      });
      await tokenStore.del();
    }
  }

  return exchangeJwtForToken();
}

export async function clearRingCentralTokenCache(): Promise<void> {
  await tokenStore.del();
}

export function getRingCentralTokenStore(): TokenStore {
  return tokenStore;
}

async function postTokenRequest(
  form: URLSearchParams,
  grant: "jwt" | "refresh",
): Promise<RingCentralTokenCache> {
  const response = await fetch(`${getRequiredEnv("RC_SERVER_URL")}/restapi/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${getBasicAuthValue()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });

  const payload = (await readJson(response)) as RingCentralTokenResponse;
  if (!response.ok) {
    logger.warn({
      msg: "ringcentral.auth.token_request.failed",
      grant,
      status: response.status,
    });
    throw new RingCentralAuthError(
      `RingCentral ${grant} token request failed with status ${response.status}`,
      response.status,
    );
  }

  return normalizeTokenResponse(payload);
}

function normalizeTokenResponse(
  payload: RingCentralTokenResponse,
): RingCentralTokenCache {
  if (typeof payload.access_token !== "string" || !payload.access_token) {
    throw new Error("RingCentral token response did not include access_token");
  }

  const expiresInSeconds = toNumber(payload.expires_in);
  if (!expiresInSeconds || expiresInSeconds <= 0) {
    throw new Error("RingCentral token response did not include expires_in");
  }

  const issuedAt = Date.now();
  const refreshTokenExpiresInSeconds = toNumber(
    payload.refresh_token_expires_in,
  );

  return {
    access_token: payload.access_token,
    refresh_token:
      typeof payload.refresh_token === "string" ? payload.refresh_token : undefined,
    token_type:
      typeof payload.token_type === "string" ? payload.token_type : undefined,
    scope: typeof payload.scope === "string" ? payload.scope : undefined,
    owner_id: valueToString(payload.owner_id),
    endpoint_id: valueToString(payload.endpoint_id),
    issued_at: issuedAt,
    access_token_expires_at: issuedAt + expiresInSeconds * 1000,
    refresh_token_expires_at: refreshTokenExpiresInSeconds
      ? issuedAt + refreshTokenExpiresInSeconds * 1000
      : null,
    raw: payload,
  };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

function getBasicAuthValue(): string {
  return Buffer.from(
    `${getRequiredEnv("RC_CLIENT_ID")}:${getRequiredEnv("RC_CLIENT_SECRET")}`,
  ).toString("base64");
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function valueToString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return undefined;
}

function logTokenSummary(message: string, token: RingCentralTokenCache): void {
  logger.info({
    msg: message,
    scope: token.scope ?? null,
    owner_id: token.owner_id ?? null,
    endpoint_id: token.endpoint_id ?? null,
    issued_at: token.issued_at,
    access_token_expires_at: token.access_token_expires_at,
    refresh_token_expires_at: token.refresh_token_expires_at ?? null,
  });
}
