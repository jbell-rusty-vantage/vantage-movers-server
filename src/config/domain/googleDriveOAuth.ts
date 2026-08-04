import { isReportingGoogleDeliveryEnabled } from "./reporting";

const DEFAULT_CALLBACK_PATH =
  "/api/v1/admin/google-drive/oauth/callback";

export type GoogleDriveOAuthConfig = {  clientId: string;
  clientSecret: string;
  redirectUri: string;
  ownerEmail: string;
  tokenEncryptionKey: Buffer;
  exportFolderId?: string;
  completionRedirectUrl?: string;
  trustedAdminOrigin: string;
};

export type GoogleDriveOAuthPublicConfig = {
  clientId: string;
  redirectUri: string;
  ownerEmailConfigured: boolean;
  exportFolderConfigured: boolean;
  pickerConfigured: boolean;
  trustedAdminOriginConfigured: boolean;
  reportingDeliveryEnabled: boolean;
};

export function isProductionGoogleDriveEnvironment(): boolean {
  const nodeEnv = process.env.NODE_ENV?.trim().toLowerCase();
  const vercelEnv = process.env.VERCEL_ENV?.trim().toLowerCase();
  return nodeEnv === "production" || vercelEnv === "production";
}

export function assertTrustedCompletionRedirectUrl(
  completionRedirectUrl: string,
  trustedAdminOrigin: string,
  production = isProductionGoogleDriveEnvironment(),
): void {
  let redirect: URL;
  let trusted: URL;
  try {
    redirect = new URL(completionRedirectUrl);
    trusted = new URL(trustedAdminOrigin);
  } catch {
    throw new Error(
      "GOOGLE_OAUTH_COMPLETION_REDIRECT_URL and GOOGLE_OAUTH_TRUSTED_ADMIN_ORIGIN must be valid absolute URLs",
    );
  }

  if (redirect.protocol !== "https:" && redirect.hostname !== "localhost") {
    throw new Error(
      "GOOGLE_OAUTH_COMPLETION_REDIRECT_URL must use HTTPS unless it targets localhost",
    );
  }
  if (trusted.protocol !== "https:" && trusted.hostname !== "localhost") {
    throw new Error(
      "GOOGLE_OAUTH_TRUSTED_ADMIN_ORIGIN must use HTTPS unless it targets localhost",
    );
  }
  if (production && redirect.hostname === "localhost") {
    throw new Error(
      "GOOGLE_OAUTH_COMPLETION_REDIRECT_URL cannot target localhost in production",
    );
  }
  if (production && trusted.hostname === "localhost") {
    throw new Error(
      "GOOGLE_OAUTH_TRUSTED_ADMIN_ORIGIN cannot target localhost in production",
    );
  }
  if (redirect.origin !== trusted.origin) {
    throw new Error(
      "GOOGLE_OAUTH_COMPLETION_REDIRECT_URL must match GOOGLE_OAUTH_TRUSTED_ADMIN_ORIGIN",
    );
  }
}

export function getGoogleDriveOAuthConfig(): GoogleDriveOAuthConfig {
  const clientId = requiredEnv("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = requiredEnv("GOOGLE_OAUTH_CLIENT_SECRET");
  const ownerEmail = requiredEnv("GOOGLE_OAUTH_OWNER_EMAIL").toLowerCase();
  const redirectUri =
    process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() ||
    `https://vantage-movers-main-server.vercel.app${DEFAULT_CALLBACK_PATH}`;
  const tokenEncryptionKey = decodeEncryptionKey(
    requiredEnv("GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY"),
  );
  const trustedAdminOrigin = requiredEnv("GOOGLE_OAUTH_TRUSTED_ADMIN_ORIGIN");

  assertHttpUrl("GOOGLE_OAUTH_REDIRECT_URI", redirectUri);
  assertHttpUrl("GOOGLE_OAUTH_TRUSTED_ADMIN_ORIGIN", trustedAdminOrigin);
  const completionRedirectUrl =
    process.env.GOOGLE_OAUTH_COMPLETION_REDIRECT_URL?.trim() || undefined;
  if (completionRedirectUrl) {
    assertHttpUrl(
      "GOOGLE_OAUTH_COMPLETION_REDIRECT_URL",
      completionRedirectUrl,
    );
    assertTrustedCompletionRedirectUrl(
      completionRedirectUrl,
      trustedAdminOrigin,
    );
  }

  return {
    clientId,
    clientSecret,
    redirectUri,
    ownerEmail,
    tokenEncryptionKey,
    exportFolderId:
      process.env.GOOGLE_DRIVE_EXPORT_FOLDER_ID?.trim() || undefined,
    completionRedirectUrl,
    trustedAdminOrigin,
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function decodeEncryptionKey(value: string): Buffer {
  const key = Buffer.from(value, "base64");
  if (key.length !== 32 || key.toString("base64") !== value) {
    throw new Error(
      "GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY must be exactly 32 random bytes encoded as canonical base64",
    );
  }
  return key;
}

export function getGoogleDriveOAuthPublicConfig(): GoogleDriveOAuthPublicConfig {
  const config = getGoogleDriveOAuthConfig();
  const pickerApiKey = process.env.GOOGLE_PICKER_API_KEY?.trim();
  const pickerAppId = process.env.GOOGLE_PICKER_APP_ID?.trim();
  return {
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    ownerEmailConfigured: Boolean(config.ownerEmail),
    exportFolderConfigured: Boolean(config.exportFolderId),
    pickerConfigured: Boolean(pickerApiKey && pickerAppId),
    trustedAdminOriginConfigured: Boolean(config.trustedAdminOrigin),
    reportingDeliveryEnabled: isReportingGoogleDeliveryEnabled(),
  };
}

export const GOOGLE_SHEETS_PROVIDER_MAX_CELLS = 10_000_000;

function assertHttpUrl(name: string, value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid absolute URL`);
  }
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new Error(`${name} must use HTTPS unless it targets localhost`);
  }
}
