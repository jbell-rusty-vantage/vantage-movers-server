import path from "node:path";
import process from "node:process";
import { google } from "googleapis";

const SERVICE_ACCOUNT_FILE = "just-cosmos-437222-b7-f8ab65674d85.json";

const EXPECTED_SHEETS = [
  "Leads",
  "Calls",
  "Bad_Leads",
  "Cost",
  "Key",
  "ZipCodeKey",
] as const;

async function main(): Promise<void> {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID?.trim();
  if (!spreadsheetId) {
    console.error(
      "Missing GOOGLE_SHEET_ID. Set it in .env and run with: node --env-file=.env … (see package.json sheets:list-tabs).",
    );
    process.exit(1);
  }

  const keyFile = path.join(process.cwd(), SERVICE_ACCOUNT_FILE);

  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheets = google.sheets({ version: "v4", auth });

  const { data } = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "properties.title,sheets.properties.title",
  });

  const title = data.properties?.title ?? "(untitled)";
  console.log("Spreadsheet:", title);
  console.log("Spreadsheet ID:", spreadsheetId);

  const names =
    data.sheets
      ?.map((s) => s.properties?.title)
      .filter((t): t is string => typeof t === "string" && t.length > 0) ?? [];

  console.log("\nSheet names (" + names.length + "):");
  for (const name of names) {
    console.log(" -", name);
  }

  const expectedSet = new Set<string>(EXPECTED_SHEETS);
  const missing = EXPECTED_SHEETS.filter((e) => !names.includes(e));
  const extra = names.filter((n) => !expectedSet.has(n));

  console.log("\nExpected tabs check:");
  if (missing.length === 0 && extra.length === 0) {
    console.log("All expected sheets present; no extra sheets.");
  } else {
    if (missing.length > 0) {
      console.log("Missing from spreadsheet:", missing.join(", "));
    }
    if (extra.length > 0) {
      console.log("Sheets not in expected list:", extra.join(", "));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
