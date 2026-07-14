const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 900;
const DEFAULT_REFRESH_TOKEN_TTL_DAYS = 90;

export type ExtensionAuthConfig = {
  accessTokenSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenSecret: string;
  refreshTokenTtlDays: number;
};

export function getExtensionAuthConfig(): ExtensionAuthConfig {
  const accessTokenSecret = requiredSecret("EXTENSION_ACCESS_TOKEN_SECRET");
  const refreshTokenSecret = requiredSecret("EXTENSION_REFRESH_TOKEN_SECRET");

  return {
    accessTokenSecret,
    refreshTokenSecret,
    accessTokenTtlSeconds: readPositiveInteger(
      "EXTENSION_ACCESS_TOKEN_TTL_SECONDS",
      DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
    ),
    refreshTokenTtlDays: readPositiveInteger(
      "EXTENSION_REFRESH_TOKEN_TTL_DAYS",
      DEFAULT_REFRESH_TOKEN_TTL_DAYS,
    ),
  };
}

function requiredSecret(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function readPositiveInteger(name: string, defaultValue: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return defaultValue;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}
