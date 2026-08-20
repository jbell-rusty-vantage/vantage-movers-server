import { createHash, randomBytes } from "node:crypto";
import { google, type Auth } from "googleapis";
import { getGoogleDriveOAuthConfig } from "../../config/domain";
import { connectMongo } from "../../db";
import { GoogleDriveConnection } from "../../models/GoogleDriveConnection";
import { GoogleOAuthState } from "../../models/GoogleOAuthState";
import {
  BadRequestError,
  IntegrationError,
  NotFoundError,
  UnauthorizedError,
} from "../errors";
import {
  decryptGoogleRefreshToken,
  encryptGoogleRefreshToken,
} from "./tokenEncryption";
import {
  ALLOWED_GOOGLE_OAUTH_SCOPES,
  assertAllowedOAuthScopes,
  normalizeOAuthScopes,
} from "./oauthScopes";

const OAUTH_SCOPES = [...ALLOWED_GOOGLE_OAUTH_SCOPES];
const STATE_TTL_MS = 10 * 60 * 1_000;

export type GoogleDriveConnectionStatus =
  | {
      connected: false;
      owner_email: string;
    }
  | {
      connected: true;
      owner_email: string;
      google_email: string;
      scopes: string[];
      connected_at: Date;
      updated_at: Date;
      last_used_at?: Date;
    };

export async function beginGoogleDriveOAuth(): Promise<{
  authorization_url: string;
  expires_at: Date;
}> {
  const config = getGoogleDriveOAuthConfig();
  await connectMongo();

  const state = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + STATE_TTL_MS);
  await GoogleOAuthState.create({
    nonce_hash: hashOAuthState(state),
    owner_email: config.ownerEmail,
    expires_at: expiresAt,
  });

  const client = createOAuthClient();
  const authorizationUrl = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    login_hint: config.ownerEmail,
    scope: OAUTH_SCOPES,
    state,
  });

  return {
    authorization_url: authorizationUrl,
    expires_at: expiresAt,
  };
}

export async function completeGoogleDriveOAuth(
  code: string,
  state: string,
): Promise<GoogleDriveConnectionStatus> {
  const config = getGoogleDriveOAuthConfig();
  await connectMongo();

  const consumedState = await GoogleOAuthState.findOneAndDelete({
    nonce_hash: hashOAuthState(state),
    expires_at: { $gt: new Date() },
  }).lean();
  if (!consumedState || consumedState.owner_email !== config.ownerEmail) {
    throw new BadRequestError(
      "Google authorization session is invalid or expired. Start the connection again.",
    );
  }

  const client = createOAuthClient();
  let tokenResponse;
  try {
    tokenResponse = await client.getToken(code);
  } catch (error) {
    throw new IntegrationError(
      "Google could not complete authorization. Start the connection again.",
      { cause: error, internalMessage: internalErrorMessage(error) },
    );
  }
  const tokens = tokenResponse.tokens;

  if (!tokens.id_token) {
    throw new UnauthorizedError(
      "Google did not return a verifiable account identity.",
    );
  }
  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: config.clientId,
  });
  const payload = ticket.getPayload();
  const googleEmail = payload?.email?.trim().toLowerCase();
  if (!googleEmail || payload?.email_verified !== true) {
    throw new UnauthorizedError(
      "Google did not return a verified email address.",
    );
  }
  if (googleEmail !== config.ownerEmail) {
    throw new UnauthorizedError(
      "The connected Google account is not authorized for reporting.",
      { statusCode: 403 },
    );
  }
  const grantedScopes = normalizeOAuthScopes(tokens.scope);
  assertAllowedOAuthScopes(grantedScopes, "oauth_callback");
  if (!tokens.refresh_token) {
    throw new IntegrationError(
      "Google did not return offline access. Revoke the existing Vantage authorization in Google Account permissions and connect again.",
    );
  }

  const encrypted = encryptGoogleRefreshToken(
    tokens.refresh_token,
    config.tokenEncryptionKey,
    config.ownerEmail,
  );
  const now = new Date();
  await GoogleDriveConnection.findOneAndUpdate(
    { owner_email: config.ownerEmail },
    {
      $set: {
        owner_email: config.ownerEmail,
        google_email: googleEmail,
        ...encrypted,
        scopes: grantedScopes,
        connected_at: now,
      },
      $unset: { last_used_at: 1 },
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  );

  return getGoogleDriveConnectionStatus();
}

export async function getGoogleDriveConnectionStatus():
  Promise<GoogleDriveConnectionStatus> {
  const config = getGoogleDriveOAuthConfig();
  await connectMongo();
  const connection = await GoogleDriveConnection.findOne({
    owner_email: config.ownerEmail,
  }).lean();
  if (!connection) {
    return { connected: false, owner_email: config.ownerEmail };
  }

  assertAllowedOAuthScopes(connection.scopes, "stored_connection");
  return {
    connected: true,
    owner_email: connection.owner_email,
    google_email: connection.google_email,
    scopes: connection.scopes,
    connected_at: connection.connected_at,
    updated_at: connection.updated_at,
    ...(connection.last_used_at
      ? { last_used_at: connection.last_used_at }
      : {}),
  };
}

export async function disconnectGoogleDrive(): Promise<{
  disconnected: boolean;
  google_revoked: boolean;
}> {
  const config = getGoogleDriveOAuthConfig();
  await connectMongo();
  const connection = await GoogleDriveConnection.findOne({
    owner_email: config.ownerEmail,
  }).lean();
  if (!connection) {
    return { disconnected: false, google_revoked: false };
  }

  const refreshToken = decryptGoogleRefreshToken(
    encryptedTokenFromConnection(connection),
    config.tokenEncryptionKey,
    config.ownerEmail,
  );
  let googleRevoked = false;
  try {
    await createOAuthClient().revokeToken(refreshToken);
    googleRevoked = true;
  } catch {
    // Local deletion is still required: it immediately prevents Vantage from
    // using the token even if Google's revocation endpoint is unavailable.
  }
  await GoogleDriveConnection.deleteOne({
    owner_email: config.ownerEmail,
  });
  return { disconnected: true, google_revoked: googleRevoked };
}

export async function getConnectedGoogleOAuthClient():
  Promise<Auth.OAuth2Client> {
  const config = getGoogleDriveOAuthConfig();
  await connectMongo();
  const connection = await GoogleDriveConnection.findOne({
    owner_email: config.ownerEmail,
  }).lean();
  if (!connection) {
    throw new NotFoundError(
      "Google Drive is not connected. Complete the owner authorization first.",
    );
  }
  assertAllowedOAuthScopes(connection.scopes, "oauth_client");

  const client = createOAuthClient();
  client.setCredentials({
    refresh_token: decryptGoogleRefreshToken(
      encryptedTokenFromConnection(connection),
      config.tokenEncryptionKey,
      config.ownerEmail,
    ),
  });
  await GoogleDriveConnection.updateOne(
    { owner_email: config.ownerEmail },
    { $set: { last_used_at: new Date() } },
  );
  return client;
}

export type GoogleDriveAccessTokenHealth = {
  healthy: true;
  access_token: string;
  expires_at: Date;
  google_email: string;
} | {
  healthy: false;
  reason: "not_connected" | "refresh_failed" | "scope_violation";
  google_email?: string;
};

export async function getGoogleDriveAccessTokenHealth(): Promise<GoogleDriveAccessTokenHealth> {
  const config = getGoogleDriveOAuthConfig();
  await connectMongo();
  const connection = await GoogleDriveConnection.findOne({
    owner_email: config.ownerEmail,
  }).lean();
  if (!connection) {
    return { healthy: false, reason: "not_connected" };
  }
  try {
    assertAllowedOAuthScopes(connection.scopes, "access_token_health");
  } catch {
    return {
      healthy: false,
      reason: "scope_violation",
      google_email: connection.google_email,
    };
  }

  const client = createOAuthClient();
  client.setCredentials({
    refresh_token: decryptGoogleRefreshToken(
      encryptedTokenFromConnection(connection),
      config.tokenEncryptionKey,
      config.ownerEmail,
    ),
  });

  try {
    const tokenResponse = await client.getAccessToken();
    const accessToken =
      typeof tokenResponse.token === "string" ? tokenResponse.token : undefined;
    if (!accessToken) {
      return {
        healthy: false,
        reason: "refresh_failed",
        google_email: connection.google_email,
      };
    }
    const expiry = client.credentials.expiry_date
      ? new Date(client.credentials.expiry_date)
      : new Date(Date.now() + 3_600_000);
    await GoogleDriveConnection.updateOne(
      { owner_email: config.ownerEmail },
      { $set: { last_used_at: new Date() } },
    );
    return {
      healthy: true,
      access_token: accessToken,
      expires_at: expiry,
      google_email: connection.google_email,
    };
  } catch {
    return {
      healthy: false,
      reason: "refresh_failed",
      google_email: connection.google_email,
    };
  }
}

export function sanitizeGoogleDriveConnectionStatus(
  status: GoogleDriveConnectionStatus,
): Record<string, unknown> {
  if (!status.connected) {
    return {
      connected: false,
    };
  }
  return {
    connected: true,
    google_email: status.google_email,
    scopes: status.scopes,
    connected_at: status.connected_at,
    updated_at: status.updated_at,
    ...(status.last_used_at ? { last_used_at: status.last_used_at } : {}),
  };
}

export function assertGoogleDriveSecretsRedacted(payload: unknown): void {
  const forbidden = [
    "client_secret",
    "clientSecret",
    "refresh_token",
    "refreshToken",
    "encrypted_refresh_token",
    "refresh_token_iv",
    "refresh_token_auth_tag",
    "token_encryption_key",
    "tokenEncryptionKey",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY",
  ];
  const seen = new Set<string>();
  walkForForbiddenKeys(payload, forbidden, seen, "");
  if (seen.size > 0) {
    throw new Error(
      `Google OAuth response leaked forbidden keys: ${[...seen].join(", ")}`,
    );
  }
}

function walkForForbiddenKeys(
  value: unknown,
  forbidden: string[],
  seen: Set<string>,
  path: string,
): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      walkForForbiddenKeys(item, forbidden, seen, `${path}[${index}]`),
    );
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.trim();
    if (
      forbidden.some(
        (candidate) => candidate.toLowerCase() === normalized.toLowerCase(),
      )
    ) {
      seen.add(path ? `${path}.${normalized}` : normalized);
    }
    walkForForbiddenKeys(
      nested,
      forbidden,
      seen,
      path ? `${path}.${normalized}` : normalized,
    );
  }
}

export function hashOAuthState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

function createOAuthClient(): Auth.OAuth2Client {
  const config = getGoogleDriveOAuthConfig();
  return new google.auth.OAuth2(
    config.clientId,
    config.clientSecret,
    config.redirectUri,
  );
}

function internalErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function encryptedTokenFromConnection(connection: {
  encrypted_refresh_token: string;
  refresh_token_iv: string;
  refresh_token_auth_tag: string;
  encryption_version: number;
}) {
  if (connection.encryption_version !== 1) {
    throw new Error(
      `Unsupported Google OAuth token encryption version: ${connection.encryption_version}`,
    );
  }
  return {
    encrypted_refresh_token: connection.encrypted_refresh_token,
    refresh_token_iv: connection.refresh_token_iv,
    refresh_token_auth_tag: connection.refresh_token_auth_tag,
    encryption_version: 1 as const,
  };
}
