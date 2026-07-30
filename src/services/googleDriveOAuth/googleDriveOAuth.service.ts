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

const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const OAUTH_SCOPES = ["openid", "email", DRIVE_FILE_SCOPE] as const;
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
    include_granted_scopes: true,
    login_hint: config.ownerEmail,
    scope: [...OAUTH_SCOPES],
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
      { cause: error, internalMessage: errorMessage(error) },
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
      `Connect Google Drive using ${config.ownerEmail}.`,
      { statusCode: 403 },
    );
  }
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
        scopes: parseScopes(tokens.scope),
        connected_at: now,
      },
      $unset: { last_used_at: 1 },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
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

function parseScopes(value: string | null | undefined): string[] {
  return value?.split(/\s+/).filter(Boolean) ?? [...OAUTH_SCOPES];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
