import { BadRequestError } from "../../errors";
import {
  ownershipMarkerMatchesDestination,
  serializeReportingOwnershipMarker,
  REPORTING_OWNERSHIP_MARKER_CELL,
} from "../ownershipMarker";
import type { LiteralCell } from "./cellSerialization";
import {
  assertSafeToTrashReportingArtifact,
  type ReportingDriveAdapter,
  type ReportingDriveFile,
} from "./reportingDriveAdapter";
import {
  REPORTING_VALUE_INPUT_OPTION,
  assertBoundedWrite,
  rangesEqual,
  type ReportingSheetsAdapter,
} from "./reportingSheetsAdapter";
import {
  REPORTING_RUN_MARKER_CELL,
  runMarkerMatches,
  serializeReportingRunMarker,
} from "./runMarker";
import {
  REPORTING_SPREADSHEET_MIME_TYPE,
  buildReportingDriveAppProperties,
} from "./driveAppProperties";

type SheetState = {
  sheetId: number;
  title: string;
  hidden: boolean;
  cells: Map<string, LiteralCell>;
};

type SpreadsheetState = {
  id: string;
  title: string;
  trashed: boolean;
  folderId: string;
  ownedByMe: boolean;
  mimeType: string;
  appProperties: Record<string, string>;
  sheets: Map<number, SheetState>;
  nextSheetId: number;
};

export type FakeReportingGoogle = {
  drive: ReportingDriveAdapter;
  sheets: ReportingSheetsAdapter;
  inspect(): {
    spreadsheets: Array<{
      id: string;
      title: string;
      trashed: boolean;
      appProperties: Record<string, string>;
      sheets: Array<{ sheetId: number; title: string; hidden: boolean }>;
    }>;
  };
  forceTransientFailure(count: number): void;
  setOwnedByMe(spreadsheetId: string, ownedByMe: boolean): void;
};

export function createFakeReportingGoogle(): FakeReportingGoogle {
  const spreadsheets = new Map<string, SpreadsheetState>();
  let nextSpreadsheet = 1;
  let transientFailures = 0;

  const maybeFail = () => {
    if (transientFailures > 0) {
      transientFailures -= 1;
      const error = new Error("Simulated Google 503") as Error & {
        status: number;
      };
      error.status = 503;
      throw error;
    }
  };

  const requireSpreadsheet = (id: string) => {
    const spreadsheet = spreadsheets.get(id);
    if (!spreadsheet || spreadsheet.trashed) {
      const error = new Error("Spreadsheet not found") as Error & {
        status: number;
      };
      error.status = 404;
      throw error;
    }
    return spreadsheet;
  };

  const sheetByTitle = (spreadsheet: SpreadsheetState, title: string) => {
    for (const sheet of spreadsheet.sheets.values()) {
      if (sheet.title === title) return sheet;
    }
    return undefined;
  };

  const cellKey = (row: number, col: number) => `${row}:${col}`;

  const toDriveFile = (spreadsheet: SpreadsheetState): ReportingDriveFile => ({
    id: spreadsheet.id,
    name: spreadsheet.title,
    trashed: spreadsheet.trashed,
    mimeType: spreadsheet.mimeType,
    ownedByMe: spreadsheet.ownedByMe,
    appProperties: { ...spreadsheet.appProperties },
    webViewLink: `https://docs.google.com/spreadsheets/d/${spreadsheet.id}`,
  });

  const drive: ReportingDriveAdapter = {
    async createSpreadsheet(input) {
      maybeFail();
      const id = `ss_${nextSpreadsheet++}`;
      const sheetId = 1;
      const sheet: SheetState = {
        sheetId,
        title: "Sheet1",
        hidden: false,
        cells: new Map(),
      };
      spreadsheets.set(id, {
        id,
        title: input.title,
        trashed: false,
        folderId: input.folderId,
        ownedByMe: true,
        mimeType: REPORTING_SPREADSHEET_MIME_TYPE,
        appProperties: buildReportingDriveAppProperties({
          runId: input.runId,
          destinationId: input.destinationId,
          role: input.role,
        }),
        sheets: new Map([[sheetId, sheet]]),
        nextSheetId: 2,
      });
      return {
        spreadsheetId: id,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${id}`,
        title: input.title,
      };
    },
    async trashFile(input) {
      maybeFail();
      const spreadsheet = spreadsheets.get(input.fileId);
      if (!spreadsheet) {
        const error = new Error("File not found") as Error & { status: number };
        error.status = 404;
        throw error;
      }
      assertSafeToTrashReportingArtifact({
        file: toDriveFile(spreadsheet),
        expectedRunId: input.expectedRunId,
        expectedDestinationId: input.expectedDestinationId,
        expectedFileId: input.fileId,
      });
      spreadsheet.trashed = true;
      return { trashed: true as const };
    },
    async getFile(input) {
      maybeFail();
      const spreadsheet = spreadsheets.get(input.fileId);
      if (!spreadsheet) {
        const error = new Error("File not found") as Error & { status: number };
        error.status = 404;
        throw error;
      }
      return toDriveFile(spreadsheet);
    },
  };

  const sheets: ReportingSheetsAdapter = {
    async listSheets(spreadsheetId) {
      maybeFail();
      const spreadsheet = requireSpreadsheet(spreadsheetId);
      return [...spreadsheet.sheets.values()].map((sheet) => ({
        spreadsheetId,
        sheetId: sheet.sheetId,
        title: sheet.title,
        hidden: sheet.hidden,
      }));
    },
    async createHiddenStagingTab(input) {
      maybeFail();
      const spreadsheet = requireSpreadsheet(input.spreadsheetId);
      if (sheetByTitle(spreadsheet, input.title)) {
        throw new BadRequestError("A staging tab title collision was detected.");
      }
      const sheetId = spreadsheet.nextSheetId++;
      const sheet: SheetState = {
        sheetId,
        title: input.title,
        hidden: true,
        cells: new Map(),
      };
      spreadsheet.sheets.set(sheetId, sheet);
      await sheets.writeOwnershipAndRunMarkers({
        spreadsheetId: input.spreadsheetId,
        sheetTitle: input.title,
        destinationId: input.destinationId,
        runId: input.runId,
        strategy: input.strategy,
        role: input.strategy === "snapshot" ? "snapshot" : "staging",
      });
      return {
        spreadsheetId: input.spreadsheetId,
        sheetId,
        title: input.title,
        hidden: true,
      };
    },
    async hideSheet(input) {
      maybeFail();
      const spreadsheet = requireSpreadsheet(input.spreadsheetId);
      const sheet = spreadsheet.sheets.get(input.sheetId);
      if (!sheet) throw new BadRequestError("Sheet missing.");
      sheet.hidden = input.hidden;
    },
    async renameSheet(input) {
      maybeFail();
      const spreadsheet = requireSpreadsheet(input.spreadsheetId);
      const sheet = spreadsheet.sheets.get(input.sheetId);
      if (!sheet) throw new BadRequestError("Sheet missing.");
      sheet.title = input.title;
    },
    async deleteSheet(input) {
      maybeFail();
      const spreadsheet = requireSpreadsheet(input.spreadsheetId);
      if (!spreadsheet.sheets.delete(input.sheetId)) {
        throw new BadRequestError("Sheet missing.");
      }
    },
    async promoteStagingTab(input) {
      maybeFail();
      const spreadsheet = requireSpreadsheet(input.spreadsheetId);
      const oldSheet = spreadsheet.sheets.get(input.oldSheetId);
      const staging = spreadsheet.sheets.get(input.stagingSheetId);
      if (!oldSheet || !staging) {
        throw new BadRequestError("Promotion sheet IDs are missing.");
      }
      oldSheet.title = input.recoveryTitle;
      staging.title = input.publishedTitle;
      staging.hidden = false;
    },
    async writeValuesRaw(input) {
      maybeFail();
      assertBoundedWrite(input.values);
      const spreadsheet = requireSpreadsheet(input.spreadsheetId);
      const sheet = sheetByTitle(spreadsheet, input.sheetTitle);
      if (!sheet) throw new BadRequestError("Sheet title missing.");
      let updatedCells = 0;
      for (let r = 0; r < input.values.length; r += 1) {
        const row = input.values[r]!;
        for (let c = 0; c < row.length; c += 1) {
          sheet.cells.set(
            cellKey(input.startRow + r, input.startCol + c),
            row[c] ?? null,
          );
          updatedCells += 1;
        }
      }
      return {
        updatedRows: input.values.length,
        updatedColumns: input.values[0]?.length ?? 0,
        updatedCells,
        range: `${input.sheetTitle}!R${input.startRow}C${input.startCol}`,
        valueInputOption: REPORTING_VALUE_INPUT_OPTION,
      };
    },
    async readValues(input) {
      maybeFail();
      const spreadsheet = requireSpreadsheet(input.spreadsheetId);
      const sheet = sheetByTitle(spreadsheet, input.sheetTitle);
      if (!sheet) throw new BadRequestError("Sheet title missing.");
      const values: LiteralCell[][] = [];
      for (let r = input.startRow; r <= input.endRow; r += 1) {
        const row: LiteralCell[] = [];
        for (let c = input.startCol; c <= input.endCol; c += 1) {
          row.push(sheet.cells.get(cellKey(r, c)) ?? null);
        }
        values.push(row);
      }
      return values;
    },
    async verifyRange(input) {
      const endRow = input.startRow + input.values.length - 1;
      const endCol =
        input.startCol + Math.max(...input.values.map((row) => row.length)) - 1;
      const actual = await sheets.readValues({
        spreadsheetId: input.spreadsheetId,
        sheetTitle: input.sheetTitle,
        startRow: input.startRow,
        startCol: input.startCol,
        endRow,
        endCol,
      });
      return { matched: rangesEqual(actual, input.values), actual };
    },
    async writeOwnershipAndRunMarkers(input) {
      maybeFail();
      const spreadsheet = requireSpreadsheet(input.spreadsheetId);
      const sheet = sheetByTitle(spreadsheet, input.sheetTitle);
      if (!sheet) throw new BadRequestError("Sheet title missing.");
      void REPORTING_OWNERSHIP_MARKER_CELL;
      void REPORTING_RUN_MARKER_CELL;
      sheet.cells.set(
        cellKey(1, 702),
        serializeReportingOwnershipMarker(input.destinationId),
      );
      sheet.cells.set(
        cellKey(1, 701),
        serializeReportingRunMarker({
          runId: input.runId,
          destinationId: input.destinationId,
          strategy: input.strategy,
          role: input.role,
        }),
      );
    },
    async verifyOwnershipAndRunMarkers(input) {
      maybeFail();
      const spreadsheet = requireSpreadsheet(input.spreadsheetId);
      const sheet = sheetByTitle(spreadsheet, input.sheetTitle);
      if (!sheet) throw new BadRequestError("Sheet title missing.");
      const ownership = sheet.cells.get(cellKey(1, 702));
      const run = sheet.cells.get(cellKey(1, 701));
      if (!ownershipMarkerMatchesDestination(ownership, input.destinationId)) {
        throw new BadRequestError("Reporting ownership marker mismatch.");
      }
      if (
        !runMarkerMatches({
          raw: run,
          runId: input.runId,
          destinationId: input.destinationId,
        })
      ) {
        throw new BadRequestError("Reporting run marker mismatch.");
      }
      return { ownershipMatched: true as const, runMatched: true as const };
    },
    async verifyPublishedManagedTab(input) {
      maybeFail();
      const spreadsheet = requireSpreadsheet(input.spreadsheetId);
      const sheet = spreadsheet.sheets.get(input.immutableSheetId);
      if (!sheet) {
        throw new BadRequestError(
          "The published managed reporting tab is missing by immutable ID.",
        );
      }
      if (sheet.title !== input.publishedTitle) {
        throw new BadRequestError(
          "The published managed reporting tab title no longer matches.",
        );
      }
      const ownership = sheet.cells.get(cellKey(1, 702));
      if (!ownershipMarkerMatchesDestination(ownership, input.destinationId)) {
        throw new BadRequestError(
          "Published managed tab ownership marker mismatch.",
        );
      }
      return {
        ownershipMatched: true as const,
        sheetId: sheet.sheetId,
        title: sheet.title,
      };
    },
    async findSheetByRunMarker(input) {
      maybeFail();
      const spreadsheet = requireSpreadsheet(input.spreadsheetId);
      for (const sheet of spreadsheet.sheets.values()) {
        try {
          await sheets.verifyOwnershipAndRunMarkers({
            spreadsheetId: input.spreadsheetId,
            sheetTitle: sheet.title,
            destinationId: input.destinationId,
            runId: input.runId,
          });
          return {
            spreadsheetId: input.spreadsheetId,
            sheetId: sheet.sheetId,
            title: sheet.title,
            hidden: sheet.hidden,
          };
        } catch {
          // continue
        }
      }
      return null;
    },
    async verifyOwnershipMarkerBySheetId(input) {
      maybeFail();
      const spreadsheet = requireSpreadsheet(input.spreadsheetId);
      const sheet = spreadsheet.sheets.get(input.sheetId);
      if (!sheet) {
        throw new BadRequestError(
          "Sheet missing by immutable ID for ownership verification.",
        );
      }
      const ownership = sheet.cells.get(cellKey(1, 702));
      if (!ownershipMarkerMatchesDestination(ownership, input.destinationId)) {
        throw new BadRequestError("Ownership marker mismatch for sheet ID.");
      }
      return { ownershipMatched: true as const, title: sheet.title };
    },
  };

  return {
    drive,
    sheets,
    inspect() {
      return {
        spreadsheets: [...spreadsheets.values()].map((spreadsheet) => ({
          id: spreadsheet.id,
          title: spreadsheet.title,
          trashed: spreadsheet.trashed,
          appProperties: { ...spreadsheet.appProperties },
          sheets: [...spreadsheet.sheets.values()].map((sheet) => ({
            sheetId: sheet.sheetId,
            title: sheet.title,
            hidden: sheet.hidden,
          })),
        })),
      };
    },
    forceTransientFailure(count) {
      transientFailures = count;
    },
    setOwnedByMe(spreadsheetId, ownedByMe) {
      const spreadsheet = spreadsheets.get(spreadsheetId);
      if (spreadsheet) spreadsheet.ownedByMe = ownedByMe;
    },
  };
}
