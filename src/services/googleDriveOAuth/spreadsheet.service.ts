import { google, type sheets_v4 } from "googleapis";
import { getGoogleDriveOAuthConfig } from "../../config/domain";
import { BadRequestError, IntegrationError } from "../errors";
import { getConnectedGoogleOAuthClient } from "./googleDriveOAuth.service";

const SPREADSHEET_MIME_TYPE =
  "application/vnd.google-apps.spreadsheet";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

export type CreateOAuthSpreadsheetInput = {
  title: string;
  folderId?: string;
};

export type CreateGoogleDriveFolderInput = {
  name: string;
  parentFolderId?: string;
};

export async function createGoogleDriveFolder(
  input: CreateGoogleDriveFolderInput,
): Promise<{
  folder_id: string;
  name: string;
  folder_url: string;
}> {
  const auth = await getConnectedGoogleOAuthClient();
  const config = getGoogleDriveOAuthConfig();
  const drive = google.drive({ version: "v3", auth });
  const requestBody = createGoogleDriveFolderRequest({
    name: input.name,
    parentFolderId: input.parentFolderId ?? config.exportFolderId,
  });

  try {
    const created = await drive.files.create({
      requestBody,
      fields: "id,name,webViewLink",
      supportsAllDrives: true,
    });
    const folderId = created.data.id;
    if (!folderId) {
      throw new Error("Google Drive returned no folder ID");
    }
    return {
      folder_id: folderId,
      name: created.data.name ?? input.name,
      folder_url:
        created.data.webViewLink ??
        `https://drive.google.com/drive/folders/${folderId}`,
    };
  } catch (error) {
    throw new IntegrationError("Google Drive could not create the folder.", {
      cause: error,
      internalMessage:
        error instanceof Error ? error.message : String(error),
      metadata: { hasParentFolderId: Boolean(requestBody.parents?.length) },
    });
  }
}

export function createGoogleDriveFolderRequest(input: CreateGoogleDriveFolderInput) {
  const parentFolderId = normalizeFolderId(input.parentFolderId);
  return {
    name: input.name,
    mimeType: FOLDER_MIME_TYPE,
    ...(parentFolderId ? { parents: [parentFolderId] } : {}),
  };
}

export async function createOAuthTestSpreadsheet(
  input: CreateOAuthSpreadsheetInput,
): Promise<{
  spreadsheet_id: string;
  spreadsheet_url: string;
  title: string;
}> {
  const auth = await getConnectedGoogleOAuthClient();
  const drive = google.drive({ version: "v3", auth });
  const sheets = google.sheets({ version: "v4", auth });
  const config = getGoogleDriveOAuthConfig();
  const folderId = normalizeFolderId(input.folderId ?? config.exportFolderId);

  let spreadsheetId: string | undefined;
  try {
    const created = await drive.files.create({
      requestBody: {
        name: input.title,
        mimeType: SPREADSHEET_MIME_TYPE,
        ...(folderId ? { parents: [folderId] } : {}),
      },
      fields: "id,webViewLink",
      supportsAllDrives: true,
    });
    spreadsheetId = created.data.id ?? undefined;
    if (!spreadsheetId) {
      throw new Error("Google Drive returned no spreadsheet ID");
    }

    await configureTestTabs(sheets, spreadsheetId);
    return {
      spreadsheet_id: spreadsheetId,
      spreadsheet_url:
        created.data.webViewLink ??
        `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
      title: input.title,
    };
  } catch (error) {
    if (spreadsheetId) {
      try {
        await drive.files.update({
          fileId: spreadsheetId,
          requestBody: { trashed: true },
          supportsAllDrives: true,
        });
      } catch {
        // Preserve the original configuration failure.
      }
    }
    throw new IntegrationError(
      "Google Drive could not create the test spreadsheet.",
      {
        cause: error,
        internalMessage:
          error instanceof Error ? error.message : String(error),
        metadata: { hasFolderId: Boolean(folderId) },
      },
    );
  }
}

export function normalizeFolderId(
  value: string | undefined,
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const match = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  const id = match?.[1] ?? trimmed;
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new BadRequestError("Google Drive folder ID is invalid.");
  }
  return id;
}

async function configureTestTabs(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
): Promise<void> {
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId,title))",
  });
  const firstSheetId = spreadsheet.data.sheets?.[0]?.properties?.sheetId;
  if (firstSheetId === undefined || firstSheetId === null) {
    throw new Error("The new spreadsheet has no default sheet");
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          updateSheetProperties: {
            properties: { sheetId: firstSheetId, title: "Summary" },
            fields: "title",
          },
        },
        { addSheet: { properties: { title: "Customers" } } },
        { addSheet: { properties: { title: "Moves" } } },
        {
          updateSheetProperties: {
            properties: {
              sheetId: firstSheetId,
              gridProperties: { frozenRowCount: 1 },
            },
            fields: "gridProperties.frozenRowCount",
          },
        },
      ],
    },
  });

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [
        {
          range: "Summary!A1:B4",
          values: [
            ["Field", "Value"],
            ["Status", "Owner OAuth creation test succeeded"],
            ["Created at", new Date().toISOString()],
            ["Tabs created", 3],
          ],
        },
        {
          range: "Customers!A1:C2",
          values: [
            ["Customer ID", "Name", "Collection"],
            ["sample-customer-1", "Sample Customer", "customers"],
          ],
        },
        {
          range: "Moves!A1:D2",
          values: [
            ["Move ID", "Customer ID", "Status", "Collection"],
            ["sample-move-1", "sample-customer-1", "test", "moves"],
          ],
        },
      ],
    },
  });
}
