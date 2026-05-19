type ServiceAccountCredentials = {
  client_email?: string;
  private_key?: string;
  project_id?: string;
  [key: string]: unknown;
};

export type GoogleAuthConfigSummary = {
  authSource: "env_json" | "env_base64" | "key_file" | "missing";
  keyFile?: string;
  clientEmail?: string;
  projectId?: string;
  privateKeyPresent: boolean;
};

export type GoogleApiErrorDetails = {
  message: string;
  code?: number | string;
  status?: number;
  reasons: string[];
  hint?: string;
};

export function resolveAuthConfigSummary(): GoogleAuthConfigSummary {
  const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  const base64Json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64?.trim();
  const keyFile = process.env.SERVICE_ACCOUNT_LOCAL_FILE?.trim();

  if (rawJson) {
    return summarizeParsedCredentials("env_json", parseCredentialsJson(rawJson));
  }

  if (base64Json) {
    return summarizeParsedCredentials(
      "env_base64",
      parseCredentialsJson(Buffer.from(base64Json, "base64").toString("utf8")),
    );
  }

  if (keyFile) {
    return {
      authSource: "key_file",
      keyFile,
      privateKeyPresent: false,
    };
  }

  return {
    authSource: "missing",
    privateKeyPresent: false,
  };
}

function summarizeParsedCredentials(
  authSource: "env_json" | "env_base64",
  credentials: ServiceAccountCredentials,
): GoogleAuthConfigSummary {
  return {
    authSource,
    clientEmail: credentials.client_email,
    projectId: credentials.project_id,
    privateKeyPresent: Boolean(credentials.private_key?.trim()),
  };
}

function parseCredentialsJson(value: string): ServiceAccountCredentials {
  const parsed = JSON.parse(value) as ServiceAccountCredentials;
  if (typeof parsed.private_key === "string") {
    parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  }
  return parsed;
}

export function formatGoogleApiError(error: unknown): GoogleApiErrorDetails {
  if (!(error instanceof Error)) {
    return {
      message: "Unknown Sheets sync error",
      reasons: [],
    };
  }

  const apiError = error as Error & {
    code?: number | string;
    status?: number;
    errors?: Array<{ reason?: string; message?: string }>;
    response?: { status?: number; data?: { error?: { message?: string; errors?: Array<{ reason?: string }> } } };
  };

  const status = apiError.response?.status ?? apiError.status;
  const responseErrors = apiError.response?.data?.error?.errors ?? apiError.errors ?? [];
  const reasons = responseErrors
    .map((entry) => entry.reason?.trim())
    .filter((reason): reason is string => Boolean(reason));
  const responseMessage = apiError.response?.data?.error?.message?.trim();

  return {
    message: responseMessage || apiError.message || "Google API request failed",
    code: apiError.code,
    status,
    reasons,
    hint: permissionHint(status, reasons, apiError.message),
  };
}

function permissionHint(
  status: number | undefined,
  reasons: string[],
  message: string,
): string | undefined {
  const normalized = message.toLowerCase();
  const reasonSet = new Set(reasons.map((reason) => reason.toLowerCase()));

  if (
    reasonSet.has("accessnotconfigured") ||
    reasonSet.has("service_disabled") ||
    normalized.includes("has not been used in project") ||
    normalized.includes("it is disabled")
  ) {
    return "Enable the Google Sheets API for the service account GCP project (APIs & Services → Library → Google Sheets API → Enable), then retry after a few minutes.";
  }

  if (status === 403 || reasonSet.has("forbidden") || normalized.includes("permission")) {
    return "Share each target spreadsheet with the service account client_email as Editor (or Viewer if read-only).";
  }

  if (status === 404 || reasonSet.has("notfound") || normalized.includes("not found")) {
    return "Verify MASTER_LEADS_SHEET_ID and source sheet env IDs match spreadsheets the service account can access.";
  }

  if (status === 401 || normalized.includes("invalid_grant") || normalized.includes("unauthorized")) {
    return "Check GOOGLE_SERVICE_ACCOUNT_JSON / key file: valid JSON, unexpired key, and matching client_email in Google Cloud.";
  }

  if (normalized.includes("invalid json") || normalized.includes("unexpected token")) {
    return "GOOGLE_SERVICE_ACCOUNT_JSON may be malformed; re-run sheets:minify-service-account and paste the one-line output.";
  }

  return undefined;
}

export function redactSpreadsheetId(spreadsheetId: string): string {
  const trimmed = spreadsheetId.trim();
  if (trimmed.length <= 12) {
    return trimmed;
  }

  return `${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`;
}
