import path from "node:path";
import { google, type sheets_v4 } from "googleapis";
import {
  getGoogleServiceAccountJsonBase64EnvVar,
  getGoogleServiceAccountJsonEnvVar,
  isTestMode,
} from "../../config/domain";
import { logger } from "../../logger";
import {
  formatGoogleApiError,
  resolveAuthConfigSummary,
  type GoogleAuthConfigSummary,
} from "../../utils/googleSheetsDiagnostics";

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

type ServiceAccountCredentials = {
  client_email?: string;
  private_key?: string;
  [key: string]: unknown;
};

let cachedSheetsClient: sheets_v4.Sheets | null = null;
let loggedAuthConfig = false;

export function getSheetsClient(): sheets_v4.Sheets {
  if (cachedSheetsClient) {
    return cachedSheetsClient;
  }

  const authSummary = resolveAuthConfigSummary();
  logAuthConfigOnce(authSummary);

  const credentials = getServiceAccountCredentials();
  const serviceAccountFile = getServiceAccountFile();
  if (!credentials && !serviceAccountFile) {
    const requiredEnvVar = getGoogleServiceAccountJsonEnvVar();
    const message = isTestMode()
      ? `Google Sheets auth is not configured for TEST_MODE=true: set ${requiredEnvVar}`
      : `Google Sheets auth is not configured: set ${requiredEnvVar} or SERVICE_ACCOUNT_LOCAL_FILE`;
    logger.error({ msg: "sheets.auth.missing", auth: authSummary }, message);
    throw new Error(message);
  }

  if (!credentials && serviceAccountFile?.startsWith("=")) {
    logger.warn({
      msg: "sheets.auth.key_file_malformed",
      keyFile: serviceAccountFile,
      hint: "SERVICE_ACCOUNT_LOCAL_FILE looks like it has a stray '=' prefix; fix .env or use GOOGLE_SERVICE_ACCOUNT_JSON",
    });
  }

  const auth = new google.auth.GoogleAuth({
    ...(credentials
      ? { credentials }
      : { keyFile: path.join(process.cwd(), serviceAccountFile!) }),
    scopes: [SHEETS_SCOPE],
  });

  cachedSheetsClient = google.sheets({ version: "v4", auth });
  return cachedSheetsClient;
}

function logAuthConfigOnce(authSummary: GoogleAuthConfigSummary): void {
  if (loggedAuthConfig) {
    return;
  }

  loggedAuthConfig = true;
  logger.info({
    msg: "sheets.auth.config",
    authSource: authSummary.authSource,
    clientEmail: authSummary.clientEmail ?? null,
    projectId: authSummary.projectId ?? null,
    privateKeyPresent: authSummary.privateKeyPresent,
    keyFile: authSummary.keyFile ?? null,
    scope: SHEETS_SCOPE,
  });
}

function getServiceAccountCredentials(): ServiceAccountCredentials | undefined {
  const jsonEnvVar = getGoogleServiceAccountJsonEnvVar();
  const base64JsonEnvVar = getGoogleServiceAccountJsonBase64EnvVar();
  const rawJson = process.env[jsonEnvVar]?.trim();
  const base64Json = process.env[base64JsonEnvVar]?.trim();
  const value =
    rawJson ??
    (base64Json ? Buffer.from(base64Json, "base64").toString("utf8") : undefined);

  if (!value) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value) as ServiceAccountCredentials;
    if (typeof parsed.private_key === "string") {
      parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
    }

    if (!parsed.client_email?.trim()) {
      logger.warn({
        msg: "sheets.auth.credentials_incomplete",
        hasPrivateKey: Boolean(parsed.private_key?.trim()),
      });
    }

    return parsed;
  } catch (error) {
    const details = formatGoogleApiError(error);
    logger.error(
      {
        err: error,
        msg: "sheets.auth.json_parse_failed",
        authSource: rawJson ? jsonEnvVar : base64JsonEnvVar,
        parseError: details.message,
        hint: details.hint,
      },
      "Failed to parse Google service account JSON from environment",
    );
    throw error;
  }
}

function getServiceAccountFile(): string | undefined {
  if (isTestMode()) {
    return undefined;
  }

  return process.env.SERVICE_ACCOUNT_LOCAL_FILE?.trim() || undefined;
}
