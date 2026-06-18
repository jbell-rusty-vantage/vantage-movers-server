import path from "node:path";
import process from "node:process";
import { google } from "googleapis";
import dotenv from "dotenv";

dotenv.config();

export function requiredEnv(name: string): string {
  const raw = process.env[name];
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) {
    throw new Error(`Missing ${name}. Set it in .env.`);
  }
  return value;
}

export function createGoogleSheetsClient(): ReturnType<typeof google.sheets> {
  const auth = new google.auth.GoogleAuth({
    ...getServiceAccountAuthSource(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  return google.sheets({ version: "v4", auth });
}

function getServiceAccountAuthSource():
  | { credentials: Record<string, unknown> }
  | { keyFile: string } {
  const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  const base64Json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64?.trim();
  const jsonValue =
    rawJson ??
    (base64Json ? Buffer.from(base64Json, "base64").toString("utf8") : undefined);

  if (jsonValue) {
    const credentials = JSON.parse(jsonValue) as Record<string, unknown>;
    if (typeof credentials.private_key === "string") {
      credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
    }
    return { credentials };
  }

  const serviceAccountFile = requiredEnv("SERVICE_ACCOUNT_LOCAL_FILE");
  return { keyFile: path.join(process.cwd(), serviceAccountFile) };
}
