import assert from "node:assert/strict";
import test from "node:test";
import type { sheets_v4 } from "googleapis";
import {
  columnIndexFromLetters,
  parseA1Cell,
} from "./cellSerialization";
import {
  REPORTING_OWNERSHIP_MARKER_CELL,
} from "../ownershipMarker";
import { REPORTING_RUN_MARKER_CELL } from "./runMarker";
import {
  createReportingSheetsAdapterFromApi,
  reportingStagingTabCellReserve,
} from "./reportingSheetsAdapter";

const DEFAULT_ROW_COUNT = 1000;
const DEFAULT_COLUMN_COUNT = 26;

test("columnIndexFromLetters matches Google A1 columns including ZZ", () => {
  assert.equal(columnIndexFromLetters("A"), 1);
  assert.equal(columnIndexFromLetters("Z"), 26);
  assert.equal(columnIndexFromLetters("AA"), 27);
  assert.equal(columnIndexFromLetters("ZY"), 701);
  assert.equal(columnIndexFromLetters("ZZ"), 702);
  assert.deepEqual(parseA1Cell(REPORTING_RUN_MARKER_CELL), {
    column: 701,
    row: 1,
  });
  assert.deepEqual(parseA1Cell(REPORTING_OWNERSHIP_MARKER_CELL), {
    column: 702,
    row: 1,
  });
  assert.equal(reportingStagingTabCellReserve(), 1000 * 702);
});

test("createHiddenStagingTab stamps markers on a default 26-column Google sheet", async () => {
  const api = createDefaultGridSheetsApi();
  const adapter = createReportingSheetsAdapterFromApi(api.sheets);

  const staging = await adapter.createHiddenStagingTab({
    spreadsheetId: "ss_1",
    title: "report_812a0b68",
    destinationId: "64b000000000000000000001",
    runId: "6aa989dace538ef2812a0b68",
    strategy: "snapshot",
  });

  const listed = await adapter.listSheets("ss_1");
  const created = listed.find((sheet) => sheet.sheetId === staging.sheetId);
  assert.ok(created);
  assert.ok((created.columnCount ?? 0) >= 702);
  await adapter.verifyOwnershipAndRunMarkers({
    spreadsheetId: "ss_1",
    sheetTitle: staging.title,
    destinationId: "64b000000000000000000001",
    runId: "6aa989dace538ef2812a0b68",
  });
});

test("writeOwnershipAndRunMarkers expands an existing 26-column sheet", async () => {
  const api = createDefaultGridSheetsApi();
  const adapter = createReportingSheetsAdapterFromApi(api.sheets);

  await adapter.writeOwnershipAndRunMarkers({
    spreadsheetId: "ss_1",
    sheetTitle: "Sheet1",
    destinationId: "64b000000000000000000004",
    runId: "64b000000000000000000005",
    strategy: "snapshot",
    role: "snapshot",
  });

  const listed = await adapter.listSheets("ss_1");
  const sheet1 = listed.find((sheet) => sheet.title === "Sheet1");
  assert.ok((sheet1?.columnCount ?? 0) >= 702);
  await adapter.verifyOwnershipAndRunMarkers({
    spreadsheetId: "ss_1",
    sheetTitle: "Sheet1",
    destinationId: "64b000000000000000000004",
    runId: "64b000000000000000000005",
  });
});

test("writeValuesRaw expands a default grid before writing past the last row", async () => {
  const api = createDefaultGridSheetsApi();
  const adapter = createReportingSheetsAdapterFromApi(api.sheets);
  const staging = await adapter.createHiddenStagingTab({
    spreadsheetId: "ss_1",
    title: "report_rows",
    destinationId: "64b000000000000000000002",
    runId: "64b000000000000000000003",
    strategy: "snapshot",
  });

  await adapter.writeValuesRaw({
    spreadsheetId: "ss_1",
    sheetTitle: staging.title,
    startRow: 1001,
    startCol: 1,
    values: [["past-default-grid"]],
  });

  const listed = await adapter.listSheets("ss_1");
  const sheet = listed.find((item) => item.sheetId === staging.sheetId);
  assert.ok((sheet?.rowCount ?? 0) >= 1001);
});

function createDefaultGridSheetsApi() {
  type SheetState = {
    sheetId: number;
    title: string;
    hidden: boolean;
    rowCount: number;
    columnCount: number;
    cells: Map<string, string>;
  };

  const sheetsById = new Map<number, SheetState>();
  let nextSheetId = 1;
  sheetsById.set(1, {
    sheetId: 1,
    title: "Sheet1",
    hidden: false,
    rowCount: DEFAULT_ROW_COUNT,
    columnCount: DEFAULT_COLUMN_COUNT,
    cells: new Map(),
  });

  const requireSheetByTitle = (title: string) => {
    for (const sheet of sheetsById.values()) {
      if (sheet.title === title) return sheet;
    }
    const error = Object.assign(new Error("Sheet not found"), { status: 404 });
    throw error;
  };

  const parseRange = (range: string) => {
    const splitAt = range.lastIndexOf("!");
    const titlePart = range.slice(0, splitAt);
    const cell = range.slice(splitAt + 1);
    const title = titlePart.replace(/^'/, "").replace(/'$/, "").replace(/''/g, "'");
    const endCell = cell.includes(":") ? cell.split(":")[1] ?? cell : cell;
    const startCell = cell.includes(":") ? cell.split(":")[0] ?? cell : cell;
    return {
      title,
      start: parseA1Cell(startCell),
      end: parseA1Cell(endCell),
    };
  };

  const assertWritable = (sheet: SheetState, column: number, row: number) => {
    if (column > sheet.columnCount || row > sheet.rowCount) {
      throw Object.assign(
        new Error(
          `Requested writing within range exceeds grid limits. Max rows: ${sheet.rowCount}, max columns: ${sheet.columnCount}`,
        ),
        { status: 400, code: 400 },
      );
    }
  };

  const applyRequests = (requests: sheets_v4.Schema$Request[] | undefined) => {
    const replies: sheets_v4.Schema$Response[] = [];
    for (const request of requests ?? []) {
      if (request.addSheet) {
        const properties = request.addSheet.properties ?? {};
        const sheetId = nextSheetId++;
        const sheet: SheetState = {
          sheetId,
          title: properties.title ?? `Sheet${sheetId}`,
          hidden: Boolean(properties.hidden),
          rowCount: properties.gridProperties?.rowCount ?? DEFAULT_ROW_COUNT,
          columnCount:
            properties.gridProperties?.columnCount ?? DEFAULT_COLUMN_COUNT,
          cells: new Map(),
        };
        sheetsById.set(sheetId, sheet);
        replies.push({
          addSheet: {
            properties: {
              sheetId,
              title: sheet.title,
              hidden: sheet.hidden,
              gridProperties: {
                rowCount: sheet.rowCount,
                columnCount: sheet.columnCount,
              },
            },
          },
        });
        continue;
      }
      if (request.appendDimension) {
        const sheet = sheetsById.get(request.appendDimension.sheetId ?? -1);
        if (!sheet) {
          throw Object.assign(new Error("Sheet not found"), { status: 404 });
        }
        const length = request.appendDimension.length ?? 0;
        if (request.appendDimension.dimension === "COLUMNS") {
          sheet.columnCount += length;
        }
        if (request.appendDimension.dimension === "ROWS") {
          sheet.rowCount += length;
        }
        replies.push({});
        continue;
      }
      if (request.updateSheetProperties) {
        const properties = request.updateSheetProperties.properties ?? {};
        const sheet = sheetsById.get(properties.sheetId ?? -1);
        if (!sheet) {
          throw Object.assign(new Error("Sheet not found"), { status: 404 });
        }
        if (typeof properties.title === "string") sheet.title = properties.title;
        if (typeof properties.hidden === "boolean") sheet.hidden = properties.hidden;
        if (properties.gridProperties?.columnCount) {
          sheet.columnCount = properties.gridProperties.columnCount;
        }
        if (properties.gridProperties?.rowCount) {
          sheet.rowCount = properties.gridProperties.rowCount;
        }
        replies.push({});
      }
    }
    return replies;
  };

  const sheets = {
    spreadsheets: {
      get: async () => ({
        data: {
          sheets: [...sheetsById.values()].map((sheet) => ({
            properties: {
              sheetId: sheet.sheetId,
              title: sheet.title,
              hidden: sheet.hidden,
              gridProperties: {
                rowCount: sheet.rowCount,
                columnCount: sheet.columnCount,
              },
            },
          })),
        },
      }),
      batchUpdate: async (
        request: sheets_v4.Params$Resource$Spreadsheets$Batchupdate,
      ) => ({
        data: { replies: applyRequests(request.requestBody?.requests) },
      }),
      values: {
        batchUpdate: async (
          request: sheets_v4.Params$Resource$Spreadsheets$Values$Batchupdate,
        ) => {
          for (const entry of request.requestBody?.data ?? []) {
            const parsed = parseRange(entry.range ?? "");
            const sheet = requireSheetByTitle(parsed.title);
            assertWritable(sheet, parsed.end.column, parsed.end.row);
            const value = entry.values?.[0]?.[0];
            sheet.cells.set(
              `${parsed.start.row}:${parsed.start.column}`,
              String(value ?? ""),
            );
          }
          return { data: {} };
        },
        batchGet: async (
          request: sheets_v4.Params$Resource$Spreadsheets$Values$Batchget,
        ) => ({
          data: {
            valueRanges: (request.ranges ?? []).map((range) => {
              const parsed = parseRange(range);
              const sheet = requireSheetByTitle(parsed.title);
              const value = sheet.cells.get(
                `${parsed.start.row}:${parsed.start.column}`,
              );
              return { values: value === undefined ? [] : [[value]] };
            }),
          },
        }),
        update: async (
          request: sheets_v4.Params$Resource$Spreadsheets$Values$Update,
        ) => {
          const parsed = parseRange(request.range ?? "");
          const sheet = requireSheetByTitle(parsed.title);
          assertWritable(sheet, parsed.end.column, parsed.end.row);
          const values = request.requestBody?.values ?? [];
          for (let row = 0; row < values.length; row += 1) {
            const cells = values[row] ?? [];
            for (let col = 0; col < cells.length; col += 1) {
              sheet.cells.set(
                `${parsed.start.row + row}:${parsed.start.column + col}`,
                String(cells[col] ?? ""),
              );
            }
          }
          return {
            data: {
              updatedRows: values.length,
              updatedColumns: values[0]?.length ?? 0,
              updatedCells: values.reduce((sum, row) => sum + row.length, 0),
            },
          };
        },
        get: async (
          request: sheets_v4.Params$Resource$Spreadsheets$Values$Get,
        ) => {
          const parsed = parseRange(request.range ?? "");
          const sheet = requireSheetByTitle(parsed.title);
          const rows: string[][] = [];
          for (let row = parsed.start.row; row <= parsed.end.row; row += 1) {
            const next: string[] = [];
            for (
              let col = parsed.start.column;
              col <= parsed.end.column;
              col += 1
            ) {
              next.push(sheet.cells.get(`${row}:${col}`) ?? "");
            }
            rows.push(next);
          }
          return { data: { values: rows } };
        },
      },
    },
  } as unknown as sheets_v4.Sheets;

  return { sheets };
}
