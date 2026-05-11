import path from "node:path";
import process from "node:process";
import { google } from "googleapis";
import dotenv from "dotenv";
dotenv.config();

const SERVICE_ACCOUNT_FILE = process.env.SERVICE_ACCOUNT_LOCAL_FILE;
if (!SERVICE_ACCOUNT_FILE) {
  console.error(
    "Missing SERVICE_ACCOUNT_LOCAL_FILE. Set it in .env (see package.json sheets:copy-structure-to-main).",
  );
  process.exit(1);
}

/** 1-based column index → A1 column letters */
function columnIndexToLetters(column: number): string {
  let n = column;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function escapeSheetTitleForRange(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

type SheetInfo = {
  title: string;
  rowCount: number;
  columnCount: number;
};

async function main(): Promise<void> {
  const sourceId = process.env.GOOGLE_SHEET_ID?.trim();
  const destId = process.env.MAIN_GOOGLE_SHEET_ID?.trim();

  if (!sourceId) {
    console.error(
      "Missing GOOGLE_SHEET_ID. Set it in .env (see package.json sheets:copy-structure-to-main).",
    );
    process.exit(1);
  }
  if (!destId) {
    console.error(
      "Missing MAIN_GOOGLE_SHEET_ID. Set it in .env (see package.json sheets:copy-structure-to-main).",
    );
    process.exit(1);
  }
  if (sourceId === destId) {
    console.error(
      "GOOGLE_SHEET_ID and MAIN_GOOGLE_SHEET_ID must be different spreadsheets.",
    );
    process.exit(1);
  }

  const keyFile = path.join(process.cwd(), SERVICE_ACCOUNT_FILE!);

  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheetsApi = google.sheets({ version: "v4", auth });

  const { data: srcMeta } = await sheetsApi.spreadsheets.get({
    spreadsheetId: sourceId,
    fields:
      "properties.title,sheets(properties(title,gridProperties(rowCount,columnCount)))",
  });

  const srcSheets: SheetInfo[] =
    srcMeta.sheets
      ?.map((s): SheetInfo | null => {
        const title = s.properties?.title;
        if (!title) return null;
        const gp = s.properties?.gridProperties;
        return {
          title,
          rowCount: gp?.rowCount ?? 1000,
          columnCount: gp?.columnCount ?? 26,
        };
      })
      .filter((x): x is SheetInfo => x !== null) ?? [];

  if (srcSheets.length === 0) {
    console.log("Source spreadsheet has no sheets.");
    return;
  }

  const rowRanges = srcSheets.map((s) => {
    const endCol = columnIndexToLetters(s.columnCount);
    return `${escapeSheetTitleForRange(s.title)}!A1:${endCol}1`;
  });

  const { data: batchValues } = await sheetsApi.spreadsheets.values.batchGet({
    spreadsheetId: sourceId,
    ranges: rowRanges,
    majorDimension: "ROWS",
    valueRenderOption: "FORMATTED_VALUE",
  });

  const valueRanges = batchValues.valueRanges ?? [];

  const { data: dstMeta } = await sheetsApi.spreadsheets.get({
    spreadsheetId: destId,
    fields: "sheets(properties(title))",
  });

  const destTitles = new Set(
    dstMeta.sheets
      ?.map((s) => s.properties?.title)
      .filter((t): t is string => typeof t === "string" && t.length > 0) ?? [],
  );

  const addRequests = srcSheets
    .filter((s) => !destTitles.has(s.title))
    .map((s) => ({
      addSheet: {
        properties: {
          title: s.title,
          gridProperties: {
            rowCount: s.rowCount,
            columnCount: s.columnCount,
          },
        },
      },
    }));

  if (addRequests.length > 0) {
    await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: destId,
      requestBody: { requests: addRequests },
    });
    console.log(
      `Created ${addRequests.length} missing sheet(s) on destination.`,
    );
  }

  const clearRanges = srcSheets.map(
    (s) => `${escapeSheetTitleForRange(s.title)}!1:1`,
  );

  await sheetsApi.spreadsheets.values.batchClear({
    spreadsheetId: destId,
    requestBody: { ranges: clearRanges },
  });

  const updateData = srcSheets.map((s, i) => {
    const firstRow = valueRanges[i]?.values?.[0];
    const row = Array.isArray(firstRow)
      ? firstRow.map((c) => (c ?? "") as string | number | boolean)
      : [];
    return {
      range: `${escapeSheetTitleForRange(s.title)}!A1`,
      majorDimension: "ROWS" as const,
      values: [row],
    };
  });

  await sheetsApi.spreadsheets.values.batchUpdate({
    spreadsheetId: destId,
    requestBody: {
      valueInputOption: "RAW",
      data: updateData,
    },
  });

  console.log(
    `Copied sheet tab names and row-1 column headers only (${srcSheets.length} sheet(s)) from`,
    sourceId,
    "→",
    destId,
  );
  for (const s of srcSheets) {
    console.log(` - ${s.title}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
