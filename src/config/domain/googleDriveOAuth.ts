const DEFAULT_OWNER_EMAIL = "jbell@vantagehomemovers.com";
const DEFAULT_CALLBACK_PATH =
  "/api/v1/admin/google-drive/oauth/callback";

export type GoogleDriveOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  ownerEmail: string;
  tokenEncryptionKey: Buffer;
  exportFolderId?: string;
  completionRedirectUrl?: string;
};

export function getGoogleDriveOAuthConfig(): GoogleDriveOAuthConfig {
  const clientId = requiredEnv("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = requiredEnv("GOOGLE_OAUTH_CLIENT_SECRET");
  const ownerEmail = (
    process.env.GOOGLE_OAUTH_OWNER_EMAIL?.trim() || DEFAULT_OWNER_EMAIL
  ).toLowerCase();
  const redirectUri =
    process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() ||
    `https://vantage-movers-main-server.vercel.app${DEFAULT_CALLBACK_PATH}`;
  const tokenEncryptionKey = decodeEncryptionKey(
    requiredEnv("GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY"),
  );

  assertHttpUrl("GOOGLE_OAUTH_REDIRECT_URI", redirectUri);
  const completionRedirectUrl =
    process.env.GOOGLE_OAUTH_COMPLETION_REDIRECT_URL?.trim() || undefined;
  if (completionRedirectUrl) {
    assertHttpUrl(
      "GOOGLE_OAUTH_COMPLETION_REDIRECT_URL",
      completionRedirectUrl,
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
