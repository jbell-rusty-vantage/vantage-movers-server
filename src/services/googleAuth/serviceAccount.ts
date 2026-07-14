import path from "node:path";
import { google } from "googleapis";
import {
  getGoogleServiceAccountJsonBase64EnvVar,
  getGoogleServiceAccountJsonEnvVar,
  isTestMode,
} from "../../config/domain";
import { logger } from "../../logger";

export type ServiceAccountCredentials = {
  client_email?: string;
  private_key?: string;
  project_id?: string;
  [key: string]: unknown;
};

export type GoogleServiceAccountAuthSource =
  | { credentials: ServiceAccountCredentials }
  | { keyFile: string };

export function createGoogleServiceAccountAuth(scopes: string[]) {
  const authSource = getGoogleServiceAccountAuthSource();
  if (!authSource) {
    const requiredEnvVar = getGoogleServiceAccountJsonEnvVar();
    const message = isTestMode()
      ? `Google service account auth is not configured for TEST_MODE=true: set ${requiredEnvVar}`
      : `Google service account auth is not configured: set ${requiredEnvVar} or SERVICE_ACCOUNT_LOCAL_FILE`;
    throw new Error(message);
  }

  return new google.auth.GoogleAuth({
    ...authSource,
    scopes,
  });
}

export function getGoogleServiceAccountAuthSource():
  | GoogleServiceAccountAuthSource
  | undefined {
  const credentials = getGoogleServiceAccountCredentials();
  if (credentials) {
    return { credentials };
  }

  const serviceAccountFile = getGoogleServiceAccountFile();
  if (serviceAccountFile) {
    return { keyFile: path.join(process.cwd(), serviceAccountFile) };
  }

  return undefined;
}

export function getGoogleServiceAccountCredentials():
  | ServiceAccountCredentials
  | undefined {
  const jsonEnvVar = getGoogleServiceAccountJsonEnvVar();
  const base64JsonEnvVar = getGoogleServiceAccountJsonBase64EnvVar();
  const rawJson = process.env[jsonEnvVar]?.trim();
  const base64Json = process.env[base64JsonEnvVar]?.trim();
  const value =
    rawJson ??
    (base64Json
      ? Buffer.from(base64Json, "base64").toString("utf8")
      : undefined);

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
        msg: "google.auth.credentials_incomplete",
        hasPrivateKey: Boolean(parsed.private_key?.trim()),
      });
    }

    return parsed;
  } catch (error) {
    logger.error(
      {
        err: error,
        msg: "google.auth.json_parse_failed",
        authSource: rawJson ? jsonEnvVar : base64JsonEnvVar,
      },
      "Failed to parse Google service account JSON from environment",
    );
    throw error;
  }
}

export function getGoogleServiceAccountFile(): string | undefined {
  if (isTestMode()) {
    return undefined;
  }

  return process.env.SERVICE_ACCOUNT_LOCAL_FILE?.trim() || undefined;
}

export function getGoogleServiceAccountProjectId(): string | undefined {
  const credentialsProjectId = getGoogleServiceAccountCredentials()?.project_id?.trim();
  return (
    credentialsProjectId ||
    process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
    process.env.GCLOUD_PROJECT?.trim()
  );
}
