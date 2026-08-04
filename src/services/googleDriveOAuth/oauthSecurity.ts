import { AppError } from "../errors";
import { OAuthScopeViolationError } from "./oauthScopes";

export type GoogleDriveErrorCategory =
  | "invalid_request"
  | "owner_access_required"
  | "oauth_not_connected"
  | "oauth_scope_violation"
  | "oauth_identity_rejected"
  | "oauth_session_invalid"
  | "oauth_provider_error"
  | "oauth_refresh_failed"
  | "google_drive_unavailable";

export function googleDriveOwnerAccessRequiredResponse(): {
  status: number;
  body: Record<string, unknown>;
} {
  return {
    status: 403,
    body: {
      ok: false,
      code: "owner_access_required" satisfies GoogleDriveErrorCategory,
      error: "Signed owner dashboard access is required.",
    },
  };
}

export function sanitizeGoogleDriveApiError(error: unknown): {
  status: number;
  body: Record<string, unknown>;
} {
  if (error instanceof OAuthScopeViolationError) {
    return {
      status: 403,
      body: {
        ok: false,
        code: "oauth_scope_violation",
        error: "Google Drive authorization scopes are not permitted.",
      },
    };
  }
  if (error instanceof AppError) {
    const category = categorizeAppError(error);
    return {
      status: error.statusCode,
      body: {
        ok: false,
        code: category,
        error: publicMessageForCategory(category),
      },
    };
  }
  return {
    status: 500,
    body: {
      ok: false,
      code: "google_drive_unavailable",
      error: "Google Drive integration is temporarily unavailable.",
    },
  };
}

export function categorizeOAuthCallbackFailure(error: unknown): GoogleDriveErrorCategory {
  if (error instanceof OAuthScopeViolationError) return "oauth_scope_violation";
  if (error instanceof AppError) return categorizeAppError(error);
  return "google_drive_unavailable";
}

export function publicMessageForCategory(
  category: GoogleDriveErrorCategory,
): string {
  switch (category) {
    case "invalid_request":
      return "The Google Drive request is invalid.";
    case "owner_access_required":
      return "Signed owner dashboard access is required.";
    case "oauth_not_connected":
      return "Google Drive is not connected.";
    case "oauth_scope_violation":
      return "Google Drive authorization scopes are not permitted.";
    case "oauth_identity_rejected":
      return "The connected Google account is not authorized for reporting.";
    case "oauth_session_invalid":
      return "Google authorization session is invalid or expired. Start the connection again.";
    case "oauth_provider_error":
      return "Google could not complete authorization. Start the connection again.";
    case "oauth_refresh_failed":
      return "Google Drive access token refresh failed. Reconnect owner OAuth.";
    case "google_drive_unavailable":
      return "Google Drive integration is temporarily unavailable.";
  }
}

function categorizeAppError(error: AppError): GoogleDriveErrorCategory {
  const status = error.statusCode;
  const code = error.code?.toLowerCase() ?? "";
  if (status === 400) return "invalid_request";
  if (status === 401 && code.includes("unauthorized")) return "oauth_identity_rejected";
  if (status === 403) {
    if (code.includes("scope")) return "oauth_scope_violation";
    return "oauth_identity_rejected";
  }
  if (status === 404) return "oauth_not_connected";
  if (status === 502 || status === 503) return "oauth_provider_error";
  if (status >= 500) return "google_drive_unavailable";
  return "invalid_request";
}

export function sanitizeGoogleDriveCallbackLog(error: unknown): {
  category: GoogleDriveErrorCategory;
  errorName: string;
} {
  return {
    category: categorizeOAuthCallbackFailure(error),
    errorName: error instanceof Error ? error.name : "UnknownError",
  };
}
