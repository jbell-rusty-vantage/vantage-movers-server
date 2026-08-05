export const GOOGLE_DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

/** Google often returns the OIDC email scope as this full URI instead of "email". */
export const GOOGLE_USERINFO_EMAIL_SCOPE =
  "https://www.googleapis.com/auth/userinfo.email";

export const ALLOWED_GOOGLE_OAUTH_SCOPES = [
  "openid",
  "email",
  GOOGLE_DRIVE_FILE_SCOPE,
] as const;

export type AllowedGoogleOAuthScope = (typeof ALLOWED_GOOGLE_OAUTH_SCOPES)[number];

const SCOPE_ALIASES: Record<string, string> = {
  [GOOGLE_USERINFO_EMAIL_SCOPE]: "email",
};

export function normalizeOAuthScopes(
  value: string | readonly string[] | null | undefined,
): string[] {
  const tokens = Array.isArray(value)
    ? [...value]
    : typeof value === "string"
      ? value.split(/\s+/).filter(Boolean)
      : [];
  return [
    ...new Set(
      tokens
        .map((token) => token.trim())
        .filter(Boolean)
        .map((token) => SCOPE_ALIASES[token] ?? token),
    ),
  ].sort();
}

export function scopesMatchAllowedSet(scopes: readonly string[]): boolean {
  const normalized = normalizeOAuthScopes([...scopes]);
  const allowed = normalizeOAuthScopes([...ALLOWED_GOOGLE_OAUTH_SCOPES]);
  if (normalized.length !== allowed.length) return false;
  return normalized.every((scope, index) => scope === allowed[index]);
}

export function assertAllowedOAuthScopes(
  scopes: readonly string[],
  context: string,
): AllowedGoogleOAuthScope[] {
  if (!scopesMatchAllowedSet(scopes)) {
    throw new OAuthScopeViolationError(context);
  }
  return [...ALLOWED_GOOGLE_OAUTH_SCOPES];
}

export class OAuthScopeViolationError extends Error {
  readonly code = "google_oauth_scope_violation" as const;

  constructor(context: string) {
    super(`Google OAuth scopes are not permitted (${context}).`);
    this.name = "OAuthScopeViolationError";
  }
}
