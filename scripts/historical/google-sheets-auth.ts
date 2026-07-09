import { getSheetsClient } from "../../api/services/googleSheets/auth";

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function createGoogleSheetsClient() {
  return getSheetsClient();
}
