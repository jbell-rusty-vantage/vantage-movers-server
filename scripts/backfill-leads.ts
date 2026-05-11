import { google } from "googleapis";
import dotenv from "dotenv";
import path from "node:path";
dotenv.config();

async function main(): Promise<void> {
  const keyFile = path.join(
    process.cwd(),
    process.env.SERVICE_ACCOUNT_LOCAL_FILE!,
  );

  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheetsApi = google.sheets({ version: "v4", auth });

  const spreadsheetId = process.env.MAIN_GOOGLE_SHEET_ID!;

  const { data: meta } = await sheetsApi.spreadsheets.get({
    spreadsheetId,
    fields: "properties.title,sheets(properties(title))",
  });

  console.log(meta);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
