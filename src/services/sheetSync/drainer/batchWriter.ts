import type { sheets_v4 } from "googleapis";
import { getSheetSyncBudgets, getSheetSyncDrainGuardrails } from "../../../config/domain";
import { logger } from "../../../logger";
import {
  escapeSheetTitleForRange,
  extractRowNumberFromRange,
} from "../../../utils/googleSheets/ranges";
import { formatGoogleApiError } from "../../googleSheets/diagnostics";
import { withSheetsRetry } from "../../googleSheets/retry";
import { columnLetter, ensureTabsAndHeaders } from "../../googleSheets/tabs";
import type { QuotaLimiter } from "./quotaLimiter";
import { buildTabRowMap } from "./tabRowMap";
import type { PlannedWrite, PlannedWriteOutcome } from "./types";

type TabGroup = {
  spreadsheetId: string;
  tabName: string;
  headers: readonly string[];
  writes: PlannedWrite[];
};

type UpdateEntry = { write: PlannedWrite; rowNumber?: number };
type AppendEntry = { write: PlannedWrite };
type DeleteEntry = { write: PlannedWrite; rowNumber: number };

function groupByTab(writes: PlannedWrite[]): TabGroup[] {
  const groups = new Map<string, TabGroup>();
  for (const write of writes) {
    const key = `${write.spreadsheetId}:${write.tabName}`;
    const group = groups.get(key);
    if (group) {
      group.writes.push(write);
    } else {
      groups.set(key, {
        spreadsheetId: write.spreadsheetId,
        tabName: write.tabName,
        headers: write.headers,
        writes: [write],
      });
    }
  }
  return [...groups.values()];
}

/**
 * Executes planned writes grouped per tab with minimal Google API calls:
 *   - one `values.get` to map existing rows (read),
 *   - chunked `values.batchUpdate` calls for in-place updates (write),
 *   - chunked `values.append` calls for new rows (write),
 *   - chunked `spreadsheets.batchUpdate` calls deleting rows in descending order (write).
 *
 * Quota is reserved per logical call via the injected limiter; when a
 * reservation is denied the affected writes are returned as `deferred` so the
 * drainer can re-queue them for a later minute instead of blocking.
 */
export async function writeBatchedTargets(args: {
  sheets: sheets_v4.Sheets;
  writes: PlannedWrite[];
  quota: QuotaLimiter;
  ensureHeaders?: boolean;
}): Promise<PlannedWriteOutcome[]> {
  const { sheets, writes, quota, ensureHeaders = true } = args;
  const outcomes: PlannedWriteOutcome[] = [];
  for (const group of groupByTab(writes)) {
    outcomes.push(...(await processTabGroup(sheets, group, quota, ensureHeaders)));
  }
  return outcomes;
}

async function processTabGroup(
  sheets: sheets_v4.Sheets,
  group: TabGroup,
  quota: QuotaLimiter,
  ensureHeaders: boolean,
): Promise<PlannedWriteOutcome[]> {
  const { spreadsheetId, tabName, headers } = group;

  if (ensureHeaders) {
    try {
      await ensureTabsAndHeaders(sheets, spreadsheetId, [{ tabName, headers }]);
    } catch (error) {
      return failGroup(group, error, "ensure_headers");
    }
  }

  // Reserve + perform the single tab read used to resolve row numbers.
  const readReservation = await quota.reserve("read", 1);
  if (!readReservation.granted) {
    return deferGroup(group, "lookup");
  }

  let rowMap: Map<string, number>;
  try {
    rowMap = await buildTabRowMap(sheets, spreadsheetId, tabName, headers);
  } catch (error) {
    return failGroup(group, error, "lookup");
  }

  const upserts = group.writes.filter((write) => write.op === "upsert");
  const deletes = group.writes.filter((write) => write.op === "delete");

  const resolved = upserts.map((write) => ({
    write,
    rowNumber: rowMap.get(write.mongoId) ?? validatedKnownRow(write, rowMap),
  }));
  const updates = resolved.filter((entry) => entry.rowNumber !== undefined);
  const appends = resolved.filter((entry) => entry.rowNumber === undefined);

  const outcomes: PlannedWriteOutcome[] = [];
  outcomes.push(...(await applyUpdates(sheets, group, updates, quota)));
  outcomes.push(...(await applyAppends(sheets, group, appends, quota)));
  outcomes.push(...(await applyDeletes(sheets, group, deletes, rowMap, quota)));
  return outcomes;
}

function validatedKnownRow(
  write: PlannedWrite,
  rowMap: Map<string, number>,
): number | undefined {
  // Only trust the recorded row number if the tab map agrees it is still that
  // document's row; otherwise treat as new so we never overwrite a shifted row.
  if (write.knownRowNumber === undefined) {
    return undefined;
  }
  for (const [mongoId, rowNumber] of rowMap) {
    if (rowNumber === write.knownRowNumber) {
      return mongoId === write.mongoId ? write.knownRowNumber : undefined;
    }
  }
  return undefined;
}

async function applyUpdates(
  sheets: sheets_v4.Sheets,
  group: TabGroup,
  updates: UpdateEntry[],
  quota: QuotaLimiter,
): Promise<PlannedWriteOutcome[]> {
  if (updates.length === 0) {
    return [];
  }

  const endColumn = columnLetter(group.headers.length);
  const chunks = chunkByLimits(updates, (entry) => ({
    range: `${escapeSheetTitleForRange(group.tabName)}!A${entry.rowNumber}:${endColumn}${entry.rowNumber}`,
    values: [entry.write.row],
  }));
  const outcomes: PlannedWriteOutcome[] = [];

  for (const chunk of chunks) {
    const reservation = await quota.reserve("write", 1);
    if (!reservation.granted) {
      outcomes.push(...chunk.map(({ write }) => deferred(write, "update")));
      continue;
    }

    const data: sheets_v4.Schema$ValueRange[] = chunk.map((entry) => ({
      range: `${escapeSheetTitleForRange(group.tabName)}!A${entry.rowNumber}:${endColumn}${entry.rowNumber}`,
      values: [entry.write.row],
    }));

    try {
      await withSheetsRetry("values.batchUpdate.rows", () =>
        sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: group.spreadsheetId,
          requestBody: { valueInputOption: "USER_ENTERED", data },
        }),
      );
      outcomes.push(...chunk.map(({ write, rowNumber }) => synced(write, "update", rowNumber)));
    } catch (error) {
      const message = describeError(error);
      outcomes.push(...chunk.map(({ write }) => failed(write, "update", message)));
    }
  }
  return outcomes;
}

async function applyAppends(
  sheets: sheets_v4.Sheets,
  group: TabGroup,
  appends: AppendEntry[],
  quota: QuotaLimiter,
): Promise<PlannedWriteOutcome[]> {
  if (appends.length === 0) {
    return [];
  }

  const endColumn = columnLetter(group.headers.length);
  const chunks = chunkByLimits(appends, (entry) => entry.write.row);
  const outcomes: PlannedWriteOutcome[] = [];

  for (const chunk of chunks) {
    const reservation = await quota.reserve("write", 1);
    if (!reservation.granted) {
      outcomes.push(...chunk.map(({ write }) => deferred(write, "append")));
      continue;
    }

    try {
      const response = await withSheetsRetry("values.append.rows", () =>
        sheets.spreadsheets.values.append({
          spreadsheetId: group.spreadsheetId,
          range: `${escapeSheetTitleForRange(group.tabName)}!A:${endColumn}`,
          valueInputOption: "USER_ENTERED",
          insertDataOption: "INSERT_ROWS",
          requestBody: { values: chunk.map(({ write }) => write.row) },
        }),
      );
      const firstRow = extractRowNumberFromRange(response.data.updates?.updatedRange);
      outcomes.push(
        ...chunk.map(({ write }, index) =>
          synced(write, "append", firstRow === undefined ? undefined : firstRow + index),
        ),
      );
    } catch (error) {
      const message = describeError(error);
      outcomes.push(...chunk.map(({ write }) => failed(write, "append", message)));
    }
  }
  return outcomes;
}

async function applyDeletes(
  sheets: sheets_v4.Sheets,
  group: TabGroup,
  deletes: PlannedWrite[],
  rowMap: Map<string, number>,
  quota: QuotaLimiter,
): Promise<PlannedWriteOutcome[]> {
  if (deletes.length === 0) {
    return [];
  }

  const resolved = deletes
    .map((write) => ({ write, rowNumber: rowMap.get(write.mongoId) }))
    .filter((entry): entry is { write: PlannedWrite; rowNumber: number } =>
      entry.rowNumber !== undefined,
    );
  // Rows already gone are a successful no-op (idempotent delete).
  const alreadyGone = deletes
    .filter((write) => rowMap.get(write.mongoId) === undefined)
    .map((write) => synced(write, "delete", undefined));

  if (resolved.length === 0) {
    return alreadyGone;
  }

  const sheetId = await resolveSheetId(sheets, group.spreadsheetId, group.tabName);
  if (sheetId === undefined) {
    return [
      ...alreadyGone,
      ...resolved.map(({ write }) => failed(write, "delete", "sheet tab not found")),
    ];
  }

  // Descending row order so earlier deletions never shift later indices.
  const ordered = [...resolved].sort((a, b) => b.rowNumber - a.rowNumber);
  const chunks = chunkByLimits(ordered, (entry) => deleteRequest(sheetId, entry.rowNumber));
  const outcomes: PlannedWriteOutcome[] = [...alreadyGone];

  for (const chunk of chunks) {
    const reservation = await quota.reserve("write", 1);
    if (!reservation.granted) {
      outcomes.push(...chunk.map(({ write }) => deferred(write, "delete")));
      continue;
    }

    const requests: sheets_v4.Schema$Request[] = chunk.map(({ rowNumber }) =>
      deleteRequest(sheetId, rowNumber),
    );

    try {
      await withSheetsRetry("batchUpdate.deleteRows", () =>
        sheets.spreadsheets.batchUpdate({
          spreadsheetId: group.spreadsheetId,
          requestBody: { requests },
        }),
      );
      outcomes.push(...chunk.map(({ write, rowNumber }) => synced(write, "delete", rowNumber)));
    } catch (error) {
      const message = describeError(error);
      outcomes.push(...chunk.map(({ write }) => failed(write, "delete", message)));
    }
  }
  return outcomes;
}

function deleteRequest(sheetId: number, rowNumber: number): sheets_v4.Schema$Request {
  return {
    deleteDimension: {
      range: {
        sheetId,
        dimension: "ROWS",
        startIndex: rowNumber - 1,
        endIndex: rowNumber,
      },
    },
  };
}

function chunkByLimits<T>(items: T[], payloadForItem: (item: T) => unknown): T[][] {
  const guardrails = getSheetSyncDrainGuardrails();
  const budgets = getSheetSyncBudgets();
  const maxRows = Math.max(1, guardrails.maxRowsPerBatch);
  const maxSubrequests = Math.max(1, guardrails.maxWriteSubrequestsPerCall);
  const maxPayloadBytes = Math.max(1, budgets.maxPayloadBytes);
  const maxItems = Math.min(maxRows, maxSubrequests);
  const chunks: T[][] = [];
  let chunk: T[] = [];
  let chunkBytes = 2;

  for (const item of items) {
    const itemBytes = Buffer.byteLength(JSON.stringify(payloadForItem(item)), "utf8");
    const wouldExceedCount = chunk.length >= maxItems;
    const wouldExceedPayload = chunk.length > 0 && chunkBytes + itemBytes > maxPayloadBytes;
    if (wouldExceedCount || wouldExceedPayload) {
      chunks.push(chunk);
      chunk = [];
      chunkBytes = 2;
    }
    chunk.push(item);
    chunkBytes += itemBytes + 1;
  }

  if (chunk.length > 0) {
    chunks.push(chunk);
  }
  return chunks;
}

async function resolveSheetId(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
): Promise<number | undefined> {
  const response = await withSheetsRetry("spreadsheets.get.sheetId", () =>
    sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets.properties(sheetId,title)",
    }),
  );
  return (
    response.data.sheets?.find(
      (sheet: sheets_v4.Schema$Sheet) => sheet.properties?.title === tabName,
    )?.properties?.sheetId ?? undefined
  );
}

function describeError(error: unknown): string {
  const details = formatGoogleApiError(error);
  return details.hint ? `${details.message} — ${details.hint}` : details.message;
}

function synced(
  write: PlannedWrite,
  action: PlannedWriteOutcome["action"],
  rowNumber: number | undefined,
): PlannedWriteOutcome {
  return { write, status: "synced", action, rowNumber, readsUsed: 0, writesUsed: 0 };
}

function failed(
  write: PlannedWrite,
  action: PlannedWriteOutcome["action"],
  error: string,
): PlannedWriteOutcome {
  return { write, status: "failed", action, error, readsUsed: 0, writesUsed: 0 };
}

function deferred(
  write: PlannedWrite,
  action: PlannedWriteOutcome["action"],
): PlannedWriteOutcome {
  return {
    write,
    status: "deferred",
    action,
    error: "quota_budget_exhausted",
    readsUsed: 0,
    writesUsed: 0,
  };
}

function deferGroup(group: TabGroup, action: PlannedWriteOutcome["action"]): PlannedWriteOutcome[] {
  logger.info({
    msg: "sheet_sync.drain.quota_deferral",
    spreadsheetId: group.spreadsheetId,
    tabName: group.tabName,
    writes: group.writes.length,
  });
  return group.writes.map((write) => deferred(write, action));
}

function failGroup(
  group: TabGroup,
  error: unknown,
  action: PlannedWriteOutcome["action"],
): PlannedWriteOutcome[] {
  const message = describeError(error);
  return group.writes.map((write) => failed(write, action, message));
}
