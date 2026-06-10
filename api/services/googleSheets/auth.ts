import { google, type sheets_v4 } from "googleapis";
import {
  getGoogleServiceAccountJsonEnvVar,
  isTestMode,
} from "../../config/domain";
import { logger } from "../../logger";
import {
  resolveAuthConfigSummary,
  type GoogleAuthConfigSummary,
} from "./diagnostics";
import {
  getGoogleServiceAccountAuthSource,
  getGoogleServiceAccountFile,
} from "../googleAuth/serviceAccount";

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

let cachedSheetsClient: ReturnType<typeof google.sheets> | null = null;
let loggedAuthConfig = false;

export function getSheetsClient(): sheets_v4.Sheets {
  if (cachedSheetsClient) {
    return cachedSheetsClient;
  }

  const authSummary = resolveAuthConfigSummary();
  logAuthConfigOnce(authSummary);

  const authSource = getGoogleServiceAccountAuthSource();
  const serviceAccountFile = getGoogleServiceAccountFile();
  if (!authSource) {
    const requiredEnvVar = getGoogleServiceAccountJsonEnvVar();
    const message = isTestMode()
      ? `Google Sheets auth is not configured for TEST_MODE=true: set ${requiredEnvVar}`
      : `Google Sheets auth is not configured: set ${requiredEnvVar} or SERVICE_ACCOUNT_LOCAL_FILE`;
    logger.error({ msg: "sheets.auth.missing", auth: authSummary }, message);
    throw new Error(message);
  }

  if (serviceAccountFile?.startsWith("=")) {
    logger.warn({
      msg: "sheets.auth.key_file_malformed",
      keyFile: serviceAccountFile,
      hint: "SERVICE_ACCOUNT_LOCAL_FILE looks like it has a stray '=' prefix; fix .env or use GOOGLE_SERVICE_ACCOUNT_JSON",
    });
  }

  const auth = new google.auth.GoogleAuth({
    ...authSource,
    scopes: [SHEETS_SCOPE],
  });

  cachedSheetsClient = google.sheets({
    version: "v4",
    auth,
  } as unknown as sheets_v4.Options);
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

