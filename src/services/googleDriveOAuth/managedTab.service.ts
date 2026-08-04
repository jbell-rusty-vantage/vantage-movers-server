import { google, type sheets_v4 } from "googleapis";
import { getConnectedGoogleOAuthClient } from "./googleDriveOAuth.service";
import { IntegrationError, BadRequestError } from "../errors";
import {
  ownershipMarkerMatchesDestination,
  REPORTING_OWNERSHIP_MARKER_CELL,
  serializeReportingOwnershipMarker,
} from "../reporting/ownershipMarker";

export type SheetsWorkbookClient = {
  listSheets(spreadsheetId: string): Promise<
    Array<{
      sheetId: number;
      title: string;
      rowCount?: number;
      columnCount?: number;
    }>
  >;
  readCell(spreadsheetId: string, range: string): Promise<string | undefined>;
  createManagedTab(input: {
    spreadsheetId: string;
    destinationId: string;
    tabName: string;
  }): Promise<{ immutableSheetId: number; name: string }>;
  renameManagedTab(input: {
    spreadsheetId: string;
    destinationId: string;
    immutableSheetId: number;
    currentTabName: string;
    nextTabName: string;
  }): Promise<{ immutableSheetId: number; name: string }>;
};

export async function createSheetsWorkbookClient(): Promise<SheetsWorkbookClient> {
  const auth = await getConnectedGoogleOAuthClient();
  const sheets = google.sheets({
    version: "v4",
    auth,
  } as unknown as sheets_v4.Options);
  return createSheetsWorkbookClientFromApi(sheets);
}

export function createSheetsWorkbookClientFromApi(
  sheets: sheets_v4.Sheets,
): SheetsWorkbookClient {
  return {
    async listSheets(spreadsheetId) {
      const response = await sheets.spreadsheets.get({
        spreadsheetId,
        fields:
          "sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))",
      });
      return (response.data.sheets ?? [])
        .map((sheet) => sheet.properties)
        .filter(
          (
            properties,
          ): properties is sheets_v4.Schema$SheetProperties & {
            sheetId: number;
            title: string;
          } =>
            properties?.sheetId !== undefined &&
            properties.sheetId !== null &&
            typeof properties.title === "string",
        )
        .map((properties) => ({
          sheetId: properties.sheetId,
          title: properties.title,
          rowCount: properties.gridProperties?.rowCount ?? undefined,
          columnCount: properties.gridProperties?.columnCount ?? undefined,
        }));
    },
    async readCell(spreadsheetId, range) {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range,
        majorDimension: "ROWS",
      });
      const value = response.data.values?.[0]?.[0];
      return typeof value === "string" ? value : undefined;
    },
    async createManagedTab(input) {
      const existing = await this.listSheets(input.spreadsheetId);
      if (existing.some((sheet) => sheet.title === input.tabName)) {
        throw new BadRequestError(
          "A tab with that name already exists. Choose a different managed tab name.",
        );
      }

      const addResponse = await sheets.spreadsheets.batchUpdate({
        spreadsheetId: input.spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: input.tabName,
                  hidden: false,
                },
              },
            },
          ],
        },
      });
      const sheetId =
        addResponse.data.replies?.[0]?.addSheet?.properties?.sheetId;
      if (sheetId === undefined || sheetId === null) {
        throw new IntegrationError("Google Sheets did not return a managed tab ID.");
      }

      await sheets.spreadsheets.values.update({
        spreadsheetId: input.spreadsheetId,
        range: `${input.tabName}!${REPORTING_OWNERSHIP_MARKER_CELL}`,
        valueInputOption: "RAW",
        requestBody: {
          values: [[serializeReportingOwnershipMarker(input.destinationId)]],
        },
      });

      return {
        immutableSheetId: sheetId,
        name: input.tabName,
      };
    },
    async renameManagedTab(input) {
      await verifyManagedTabOwnership({
        spreadsheetId: input.spreadsheetId,
        destinationId: input.destinationId,
        immutableSheetId: input.immutableSheetId,
        tabName: input.currentTabName,
        client: this,
      });

      const trimmedNextName = input.nextTabName.trim();
      if (!trimmedNextName) {
        throw new BadRequestError("Managed tab name is required.");
      }
      if (trimmedNextName === input.currentTabName) {
        return {
          immutableSheetId: input.immutableSheetId,
          name: input.currentTabName,
        };
      }

      const existing = await this.listSheets(input.spreadsheetId);
      if (
        existing.some(
          (sheet) =>
            sheet.sheetId !== input.immutableSheetId &&
            sheet.title === trimmedNextName,
        )
      ) {
        throw new BadRequestError(
          "A tab with that name already exists. Choose a different managed tab name.",
        );
      }

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: input.spreadsheetId,
        requestBody: {
          requests: [
            {
              updateSheetProperties: {
                properties: {
                  sheetId: input.immutableSheetId,
                  title: trimmedNextName,
                },
                fields: "title",
              },
            },
          ],
        },
      });

      await verifyManagedTabOwnership({
        spreadsheetId: input.spreadsheetId,
        destinationId: input.destinationId,
        immutableSheetId: input.immutableSheetId,
        tabName: trimmedNextName,
        client: this,
      });

      return {
        immutableSheetId: input.immutableSheetId,
        name: trimmedNextName,
      };
    },
  };
}

export async function verifyManagedTabOwnership(input: {
  spreadsheetId: string;
  destinationId: string;
  immutableSheetId: number;
  tabName: string;
  client?: SheetsWorkbookClient;
}): Promise<{ humanCreatedTabTakeover: false }> {
  const client = input.client ?? (await createSheetsWorkbookClient());
  const sheets = await client.listSheets(input.spreadsheetId);
  const managed = sheets.find((sheet) => sheet.sheetId === input.immutableSheetId);
  if (!managed || managed.title !== input.tabName) {
    throw new BadRequestError(
      "The managed reporting tab is missing or no longer matches the destination record.",
    );
  }

  for (const sheet of sheets) {
    if (sheet.sheetId === input.immutableSheetId) continue;
    if (sheet.title !== input.tabName) continue;
    throw new BadRequestError(
      "A human-created tab already uses the managed tab name. Choose another name.",
    );
  }

  const marker = await client.readCell(
    input.spreadsheetId,
    `${input.tabName}!${REPORTING_OWNERSHIP_MARKER_CELL}`,
  );
  if (!ownershipMarkerMatchesDestination(marker, input.destinationId)) {
    throw new BadRequestError(
      "The selected tab is not a Vantage-managed reporting tab.",
    );
  }

  return { humanCreatedTabTakeover: false };
}

export async function assertNoHumanTabNameCollision(input: {
  spreadsheetId: string;
  tabName: string;
  client?: SheetsWorkbookClient;
}): Promise<void> {
  const client = input.client ?? (await createSheetsWorkbookClient());
  const sheets = await client.listSheets(input.spreadsheetId);
  if (sheets.some((sheet) => sheet.title === input.tabName)) {
    throw new BadRequestError(
      "A tab with that name already exists. Choose a different managed tab name.",
    );
  }
}
