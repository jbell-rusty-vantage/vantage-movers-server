import path from "node:path";
import process from "node:process";
import { google } from "googleapis";
import dotenv from "dotenv";
dotenv.config();

const SERVICE_ACCOUNT_FILE = process.env.SERVICE_ACCOUNT_LOCAL_FILE;
if (!SERVICE_ACCOUNT_FILE) {
  console.error(
    "Missing SERVICE_ACCOUNT_LOCAL_FILE. Set it in .env (see package.json sheets:list-formulas).",
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

function a1Cell(row1Based: number, col1Based: number): string {
  return `${columnIndexToLetters(col1Based)}${row1Based}`;
}

function escapeSheetTitleForRange(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

function formulaFromUserEnteredValue(
  uv: Record<string, unknown> | null | undefined,
): string | null {
  if (!uv) return null;
  const fv = uv.formulaValue;
  if (typeof fv === "string" && fv.startsWith("=")) return fv;
  const sv = uv.stringValue;
  if (typeof sv === "string" && sv.startsWith("=")) return sv;
  return null;
}

async function formulasViaValuesGet(params: {
  spreadsheetId: string;
  range: string;
  sheetTitle: string;
  sheetsApi: ReturnType<typeof google.sheets>;
}): Promise<number> {
  const { spreadsheetId, range, sheetTitle, sheetsApi } = params;
  const { data } = await sheetsApi.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: "FORMULA",
    majorDimension: "ROWS",
  });

  const rows = data.values ?? [];
  let count = 0;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;
    const rowNum = r + 1;
    for (let c = 0; c < row.length; c++) {
      const v = row[c];
      if (typeof v !== "string" || !v.startsWith("=")) continue;
      const addr = `${escapeSheetTitleForRange(sheetTitle)}!${a1Cell(rowNum, c + 1)}`;
      console.log(`${addr}\n  ${v}`);
      count++;
    }
  }
  return count;
}

async function main(): Promise<void> {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID?.trim();
  if (!spreadsheetId) {
    console.error(
      "Missing GOOGLE_SHEET_ID. Set it in .env and run: pnpm run sheets:list-formulas",
    );
    process.exit(1);
  }

  const keyFile = path.join(process.cwd(), SERVICE_ACCOUNT_FILE!);

  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheetsApi = google.sheets({ version: "v4", auth });

  const { data: meta } = await sheetsApi.spreadsheets.get({
    spreadsheetId,
    fields:
      "properties.title,sheets(properties(title,gridProperties(rowCount,columnCount)))",
  });

  const spreadTitle = meta.properties?.title ?? "(untitled)";
  console.log("Spreadsheet:", spreadTitle);
  console.log("Spreadsheet ID:", spreadsheetId);
  console.log("");

  const sheetMetas =
    meta.sheets
      ?.map((s) => {
        const title = s.properties?.title;
        const gp = s.properties?.gridProperties;
        const rowCount = gp?.rowCount ?? 1000;
        const columnCount = gp?.columnCount ?? 26;
        return title
          ? {
              title,
              rowCount,
              columnCount,
              range: `${escapeSheetTitleForRange(title)}!A1:${columnIndexToLetters(columnCount)}${rowCount}`,
            }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null) ?? [];

  if (sheetMetas.length === 0) {
    console.log("No sheets found.");
    return;
  }

  const { data: grid } = await sheetsApi.spreadsheets.get({
    spreadsheetId,
    ranges: sheetMetas.map((s) => s.range),
    includeGridData: true,
    fields: "sheets(properties(title),data(rowData(values(userEnteredValue))))",
  });

  let totalFormulas = 0;

  for (const sm of sheetMetas) {
    const sheet = grid.sheets?.find(
      (s) => s.properties?.title?.trim() === sm.title.trim(),
    );
    const rowData = sheet?.data?.[0]?.rowData;
    console.log(`━━ ${sm.title} (${sm.range}) ━━`);

    let count = 0;

    if (!rowData?.length) {
      console.log(
        "(no grid data in batch response — falling back to values.get with FORMULA)",
      );
      count = await formulasViaValuesGet({
        spreadsheetId,
        range: sm.range,
        sheetTitle: sm.title,
        sheetsApi,
      });
    } else {
      for (let r = 0; r < rowData.length; r++) {
        const cells = rowData[r]?.values;
        if (!cells?.length) continue;
        const rowNum = r + 1;
        for (let c = 0; c < cells.length; c++) {
          const uv = cells[c]?.userEnteredValue as
            | Record<string, unknown>
            | undefined;
          const formula = formulaFromUserEnteredValue(uv);
          if (!formula) continue;
          const addr = `${escapeSheetTitleForRange(sm.title)}!${a1Cell(rowNum, c + 1)}`;
          console.log(`${addr}\n  ${formula}`);
          count++;
        }
      }
    }

    console.log(`— ${count} formula cell(s) on this sheet\n`);
    totalFormulas += count;
  }

  console.log(`Total formula cells (all listed sheets): ${totalFormulas}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
