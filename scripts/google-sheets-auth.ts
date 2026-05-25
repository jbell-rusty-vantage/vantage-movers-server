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
  const serviceAccountFile = requiredEnv("SERVICE_ACCOUNT_LOCAL_FILE");
  const keyFile = path.join(process.cwd(), serviceAccountFile);

  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  return google.sheets({ version: "v4", auth });
}
