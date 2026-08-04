import { google, type sheets_v4 } from "googleapis";
import { getConnectedGoogleOAuthClient } from "../../googleDriveOAuth/googleDriveOAuth.service";
import { BadRequestError, IntegrationError } from "../../errors";
import {
  REPORTING_OWNERSHIP_MARKER_CELL,
  serializeReportingOwnershipMarker,
  ownershipMarkerMatchesDestination,
} from "../ownershipMarker";
import {
  a1Range,
  type LiteralCell,
  quoteSheetTitle,
} from "./cellSerialization";
import { sanitizeReportingProviderFailure } from "./providerFailures";
import {
  REPORTING_RUN_MARKER_CELL,
  serializeReportingRunMarker,
  runMarkerMatches,
} from "./runMarker";

export const REPORTING_VALUE_INPUT_OPTION = "RAW" as const;
export const REPORTING_WRITE_BATCH_ROWS = 1000;

export type ReportingSheetRef = {
  spreadsheetId: string;
  sheetId: number;
  title: string;
  hidden: boolean;
  rowCount?: number;
  columnCount?: number;
};

export type ReportingValuesWrite = {
  spreadsheetId: string;
  sheetTitle: string;
  startRow: number;
  startCol: number;
  values: LiteralCell[][];
};

export type ReportingValuesRead = {
  spreadsheetId: string;
  sheetTitle: string;
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
};

export type ReportingSheetsAdapter = {
  listSheets(spreadsheetId: string): Promise<ReportingSheetRef[]>;
  createHiddenStagingTab(input: {
    spreadsheetId: string;
    title: string;
    destinationId: string;
    runId: string;
    strategy: "replace_tab" | "snapshot";
  }): Promise<ReportingSheetRef>;
  hideSheet(input: {
    spreadsheetId: string;
    sheetId: number;
    hidden: boolean;
  }): Promise<void>;
  renameSheet(input: {
    spreadsheetId: string;
    sheetId: number;
    title: string;
  }): Promise<void>;
  deleteSheet(input: {
    spreadsheetId: string;
    sheetId: number;
  }): Promise<void>;
  promoteStagingTab(input: {
    spreadsheetId: string;
    oldSheetId: number;
    stagingSheetId: number;
    publishedTitle: string;
    recoveryTitle: string;
  }): Promise<void>;
  writeValuesRaw(input: ReportingValuesWrite): Promise<{
    updatedRows: number;
    updatedColumns: number;
    updatedCells: number;
    range: string;
    valueInputOption: typeof REPORTING_VALUE_INPUT_OPTION;
  }>;
  readValues(input: ReportingValuesRead): Promise<LiteralCell[][]>;
  verifyRange(input: ReportingValuesWrite): Promise<{
    matched: boolean;
    actual: LiteralCell[][];
  }>;
  writeOwnershipAndRunMarkers(input: {
    spreadsheetId: string;
    sheetTitle: string;
    destinationId: string;
    runId: string;
    strategy: "replace_tab" | "snapshot";
    role: "staging" | "snapshot" | "published";
  }): Promise<void>;
  verifyOwnershipAndRunMarkers(input: {
    spreadsheetId: string;
    sheetTitle: string;
    destinationId: string;
    runId: string;
  }): Promise<{ ownershipMatched: true; runMatched: true }>;
  verifyPublishedManagedTab(input: {
    spreadsheetId: string;
    immutableSheetId: number;
    publishedTitle: string;
    destinationId: string;
  }): Promise<{ ownershipMatched: true; sheetId: number; title: string }>;
  findSheetByRunMarker(input: {
    spreadsheetId: string;
    destinationId: string;
    runId: string;
  }): Promise<ReportingSheetRef | null>;
  /** Ownership-only check by immutable sheet ID (title may have changed). */
  verifyOwnershipMarkerBySheetId(input: {
    spreadsheetId: string;
    sheetId: number;
    destinationId: string;
  }): Promise<{ ownershipMatched: true; title: string }>;
};

export async function createReportingSheetsAdapter(): Promise<ReportingSheetsAdapter> {
  const auth = await getConnectedGoogleOAuthClient();
  const sheets = google.sheets({
    version: "v4",
    auth,
  } as unknown as sheets_v4.Options);
  return createReportingSheetsAdapterFromApi(sheets);
}

export function createReportingSheetsAdapterFromApi(
  sheets: sheets_v4.Sheets,
): ReportingSheetsAdapter {
  const adapter: ReportingSheetsAdapter = {
    async listSheets(spreadsheetId) {
      try {
        const response = await sheets.spreadsheets.get({
          spreadsheetId,
          fields:
            "sheets(properties(sheetId,title,hidden,gridProperties(rowCount,columnCount)))",
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
            spreadsheetId,
            sheetId: properties.sheetId,
            title: properties.title,
            hidden: Boolean(properties.hidden),
            rowCount: properties.gridProperties?.rowCount ?? undefined,
            columnCount: properties.gridProperties?.columnCount ?? undefined,
          }));
      } catch (error) {
        throw wrapProvider(error, "list_sheets");
      }
    },

    async createHiddenStagingTab(input) {
      const existing = await adapter.listSheets(input.spreadsheetId);
      if (existing.some((sheet) => sheet.title === input.title)) {
        throw new BadRequestError(
          "A staging tab title collision was detected; choose another run tag.",
        );
      }
      try {
        const addResponse = await sheets.spreadsheets.batchUpdate({
          spreadsheetId: input.spreadsheetId,
          requestBody: {
            requests: [
              {
                addSheet: {
                  properties: {
                    title: input.title,
                    hidden: true,
                  },
                },
              },
            ],
          },
        });
        const properties =
          addResponse.data.replies?.[0]?.addSheet?.properties;
        const sheetId = properties?.sheetId;
        if (sheetId === undefined || sheetId === null) {
          throw new IntegrationError(
            "Google Sheets did not return a staging tab ID.",
          );
        }
        await adapter.writeOwnershipAndRunMarkers({
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
      } catch (error) {
        if (error instanceof BadRequestError || error instanceof IntegrationError) {
          throw error;
        }
        throw wrapProvider(error, "create_staging_tab");
      }
    },

    async hideSheet(input) {
      try {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: input.spreadsheetId,
          requestBody: {
            requests: [
              {
                updateSheetProperties: {
                  properties: {
                    sheetId: input.sheetId,
                    hidden: input.hidden,
                  },
                  fields: "hidden",
                },
              },
            ],
          },
        });
      } catch (error) {
        throw wrapProvider(error, "hide_sheet");
      }
    },

    async renameSheet(input) {
      try {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: input.spreadsheetId,
          requestBody: {
            requests: [
              {
                updateSheetProperties: {
                  properties: {
                    sheetId: input.sheetId,
                    title: input.title,
                  },
                  fields: "title",
                },
              },
            ],
          },
        });
      } catch (error) {
        throw wrapProvider(error, "rename_sheet");
      }
    },

    async deleteSheet(input) {
      try {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: input.spreadsheetId,
          requestBody: {
            requests: [
              {
                deleteSheet: {
                  sheetId: input.sheetId,
                },
              },
            ],
          },
        });
      } catch (error) {
        throw wrapProvider(error, "delete_sheet");
      }
    },

    async promoteStagingTab(input) {
      try {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: input.spreadsheetId,
          requestBody: {
            requests: [
              {
                updateSheetProperties: {
                  properties: {
                    sheetId: input.oldSheetId,
                    title: input.recoveryTitle,
                  },
                  fields: "title",
                },
              },
              {
                updateSheetProperties: {
                  properties: {
                    sheetId: input.stagingSheetId,
                    title: input.publishedTitle,
                    hidden: false,
                  },
                  fields: "title,hidden",
                },
              },
            ],
          },
        });
      } catch (error) {
        throw wrapProvider(error, "promote_staging_tab");
      }
    },

    async writeValuesRaw(input) {
      assertBoundedWrite(input.values);
      const endRow = input.startRow + input.values.length - 1;
      const endCol =
        input.startCol + Math.max(...input.values.map((row) => row.length)) - 1;
      const range = a1Range(
        input.sheetTitle,
        input.startRow,
        input.startCol,
        endRow,
        endCol,
      );
      try {
        const response = await sheets.spreadsheets.values.update({
          spreadsheetId: input.spreadsheetId,
          range,
          valueInputOption: REPORTING_VALUE_INPUT_OPTION,
          requestBody: {
            majorDimension: "ROWS",
            values: input.values,
          },
        });
        return {
          updatedRows: Number(response.data.updatedRows ?? input.values.length),
          updatedColumns: Number(
            response.data.updatedColumns ??
              (input.values[0]?.length ?? 0),
          ),
          updatedCells: Number(
            response.data.updatedCells ??
              input.values.reduce((sum, row) => sum + row.length, 0),
          ),
          range,
          valueInputOption: REPORTING_VALUE_INPUT_OPTION,
        };
      } catch (error) {
        throw wrapProvider(error, "write_values_raw");
      }
    },

    async readValues(input) {
      const range = a1Range(
        input.sheetTitle,
        input.startRow,
        input.startCol,
        input.endRow,
        input.endCol,
      );
      try {
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId: input.spreadsheetId,
          range,
          majorDimension: "ROWS",
          valueRenderOption: "UNFORMATTED_VALUE",
        });
        return normalizeReadValues(
          response.data.values ?? [],
          input.endRow - input.startRow + 1,
          input.endCol - input.startCol + 1,
        );
      } catch (error) {
        throw wrapProvider(error, "read_values");
      }
    },

    async verifyRange(input) {
      const endRow = input.startRow + input.values.length - 1;
      const endCol =
        input.startCol + Math.max(...input.values.map((row) => row.length)) - 1;
      const actual = await adapter.readValues({
        spreadsheetId: input.spreadsheetId,
        sheetTitle: input.sheetTitle,
        startRow: input.startRow,
        startCol: input.startCol,
        endRow,
        endCol,
      });
      return {
        matched: rangesEqual(actual, input.values),
        actual,
      };
    },

    async writeOwnershipAndRunMarkers(input) {
      const ownership = serializeReportingOwnershipMarker(input.destinationId);
      const runMarker = serializeReportingRunMarker({
        runId: input.runId,
        destinationId: input.destinationId,
        strategy: input.strategy,
        role: input.role,
      });
      try {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: input.spreadsheetId,
          requestBody: {
            valueInputOption: REPORTING_VALUE_INPUT_OPTION,
            data: [
              {
                range: `${quoteSheetTitle(input.sheetTitle)}!${REPORTING_OWNERSHIP_MARKER_CELL}`,
                majorDimension: "ROWS",
                values: [[ownership]],
              },
              {
                range: `${quoteSheetTitle(input.sheetTitle)}!${REPORTING_RUN_MARKER_CELL}`,
                majorDimension: "ROWS",
                values: [[runMarker]],
              },
            ],
          },
        });
      } catch (error) {
        throw wrapProvider(error, "write_markers");
      }
    },

    async verifyOwnershipAndRunMarkers(input) {
      try {
        const response = await sheets.spreadsheets.values.batchGet({
          spreadsheetId: input.spreadsheetId,
          ranges: [
            `${quoteSheetTitle(input.sheetTitle)}!${REPORTING_OWNERSHIP_MARKER_CELL}`,
            `${quoteSheetTitle(input.sheetTitle)}!${REPORTING_RUN_MARKER_CELL}`,
          ],
          majorDimension: "ROWS",
          valueRenderOption: "UNFORMATTED_VALUE",
        });
        const ownership = response.data.valueRanges?.[0]?.values?.[0]?.[0];
        const run = response.data.valueRanges?.[1]?.values?.[0]?.[0];
        if (!ownershipMarkerMatchesDestination(ownership, input.destinationId)) {
          throw new BadRequestError(
            "Reporting ownership marker mismatch for destination.",
          );
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
      } catch (error) {
        if (error instanceof BadRequestError) throw error;
        throw wrapProvider(error, "verify_markers");
      }
    },

    async verifyPublishedManagedTab(input) {
      const listed = await adapter.listSheets(input.spreadsheetId);
      const managed = listed.find(
        (sheet) => sheet.sheetId === input.immutableSheetId,
      );
      if (!managed) {
        throw new BadRequestError(
          "The published managed reporting tab is missing by immutable ID.",
        );
      }
      if (managed.title !== input.publishedTitle) {
        throw new BadRequestError(
          "The published managed reporting tab title no longer matches.",
        );
      }
      try {
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId: input.spreadsheetId,
          range: `${quoteSheetTitle(managed.title)}!${REPORTING_OWNERSHIP_MARKER_CELL}`,
          majorDimension: "ROWS",
          valueRenderOption: "UNFORMATTED_VALUE",
        });
        const ownership = response.data.values?.[0]?.[0];
        if (!ownershipMarkerMatchesDestination(ownership, input.destinationId)) {
          throw new BadRequestError(
            "Published managed tab ownership marker mismatch.",
          );
        }
        return {
          ownershipMatched: true as const,
          sheetId: managed.sheetId,
          title: managed.title,
        };
      } catch (error) {
        if (error instanceof BadRequestError) throw error;
        throw wrapProvider(error, "verify_published_managed_tab");
      }
    },

    async findSheetByRunMarker(input) {
      const listed = await adapter.listSheets(input.spreadsheetId);
      for (const sheet of listed) {
        try {
          await adapter.verifyOwnershipAndRunMarkers({
            spreadsheetId: input.spreadsheetId,
            sheetTitle: sheet.title,
            destinationId: input.destinationId,
            runId: input.runId,
          });
          return sheet;
        } catch {
          // continue scanning
        }
      }
      return null;
    },

    async verifyOwnershipMarkerBySheetId(input) {
      const listed = await adapter.listSheets(input.spreadsheetId);
      const sheet = listed.find((candidate) => candidate.sheetId === input.sheetId);
      if (!sheet) {
        throw new BadRequestError(
          "Sheet missing by immutable ID for ownership verification.",
        );
      }
      try {
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId: input.spreadsheetId,
          range: `${quoteSheetTitle(sheet.title)}!${REPORTING_OWNERSHIP_MARKER_CELL}`,
          majorDimension: "ROWS",
          valueRenderOption: "UNFORMATTED_VALUE",
        });
        const ownership = response.data.values?.[0]?.[0];
        if (!ownershipMarkerMatchesDestination(ownership, input.destinationId)) {
          throw new BadRequestError(
            "Ownership marker mismatch for sheet ID.",
          );
        }
        return { ownershipMatched: true as const, title: sheet.title };
      } catch (error) {
        if (error instanceof BadRequestError) throw error;
        throw wrapProvider(error, "verify_ownership_by_sheet_id");
      }
    },
  };
  return adapter;
}

export function assertBoundedWrite(values: LiteralCell[][]): void {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError("Reporting write batches must be non-empty.");
  }
  if (values.length > REPORTING_WRITE_BATCH_ROWS) {
    throw new TypeError(
      `Reporting write batches must not exceed ${REPORTING_WRITE_BATCH_ROWS} rows.`,
    );
  }
  const width = values[0]?.length ?? 0;
  if (width < 1) {
    throw new TypeError("Reporting write batches must include at least one column.");
  }
  for (const row of values) {
    if (!Array.isArray(row) || row.length !== width) {
      throw new TypeError("Reporting write rows must share a fixed width.");
    }
    for (const cell of row) {
      if (
        cell !== null &&
        typeof cell !== "string" &&
        typeof cell !== "number" &&
        typeof cell !== "boolean"
      ) {
        throw new TypeError("Reporting cells must be literal RAW-safe values.");
      }
      if (typeof cell === "string" && cell.startsWith("=")) {
        // RAW still stores the text, but delivery forbids formula-shaped owner intent.
        throw new TypeError(
          "Reporting cells must not contain formula-shaped strings.",
        );
      }
    }
  }
}

export function rangesEqual(
  left: LiteralCell[][],
  right: LiteralCell[][],
): boolean {
  if (left.length !== right.length) return false;
  for (let row = 0; row < left.length; row += 1) {
    const leftRow = left[row] ?? [];
    const rightRow = right[row] ?? [];
    if (leftRow.length !== rightRow.length) return false;
    for (let col = 0; col < leftRow.length; col += 1) {
      if (normalizeCell(leftRow[col]) !== normalizeCell(rightRow[col])) {
        return false;
      }
    }
  }
  return true;
}

function normalizeReadValues(
  values: unknown[][],
  rows: number,
  cols: number,
): LiteralCell[][] {
  const normalized: LiteralCell[][] = [];
  for (let row = 0; row < rows; row += 1) {
    const source = values[row] ?? [];
    const next: LiteralCell[] = [];
    for (let col = 0; col < cols; col += 1) {
      next.push(normalizeCell(source[col]));
    }
    normalized.push(next);
  }
  return normalized;
}

function normalizeCell(value: unknown): LiteralCell {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return String(value);
}

function wrapProvider(error: unknown, operation: string): Error {
  const sanitized = sanitizeReportingProviderFailure(error);
  return new IntegrationError(
    `Reporting Sheets ${operation} failed: ${sanitized.summary}`,
    {
      cause: error instanceof Error ? error : undefined,
      statusCode:
        sanitized.provider_status ??
        (sanitized.retryable ? 503 : 502),
      metadata: {
        failure_class: sanitized.failure_class,
        remediation: sanitized.remediation,
        ...(sanitized.provider_status !== undefined
          ? { provider_status: sanitized.provider_status }
          : {}),
      },
    },
  );
}
