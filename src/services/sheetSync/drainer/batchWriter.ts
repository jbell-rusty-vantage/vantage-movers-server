import type { sheets_v4 } from "googleapis";
import { getSheetSyncBudgets, getSheetSyncDrainGuardrails } from "../../../config/domain";
import { logger } from "../../../logger";
import {
  escapeSheetTitleForRange,
  extractRowNumberFromRange,
} from "../../../utils/googleSheets/ranges";
import { formatGoogleApiError } from "../../googleSheets/diagnostics";
import { withSheetsRetry } from "../../googleSheets/retry";
import { columnLetter, ensureTabsAndHeaders, getExistingSheetId, resolveCompatibleSheetTitle } from "../../googleSheets/tabs";
import type { QuotaLimiter } from "./quotaLimiter";
import { buildTabRowMap, type TabRowMap } from "./tabRowMap";
import { createDeliverySheetsClient, SheetDeliveryDeferred, type DeliveryRequestChecks } from "./deliveryRequests";
import type { PlannedWrite, PlannedWriteOutcome } from "./types";

type TabGroup = {
  spreadsheetId: string;
  tabName: string;
  headers: readonly string[];
  writes: PlannedWrite[];
  sheetId?: number;
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
 * Quota is reserved per provider request, including safe retry attempts; when a
 * reservation is denied the affected writes are returned as `deferred` so the
 * drainer can re-queue them for a later minute instead of blocking.
 */
export async function writeBatchedTargets(args: {
  sheets: sheets_v4.Sheets;
  writes: PlannedWrite[];
  quota: QuotaLimiter;
  ensureHeaders?: boolean;
  requestChecks?: DeliveryRequestChecks;
}): Promise<PlannedWriteOutcome[]> {
  const { writes, quota, ensureHeaders = true } = args;
  const sheets = createDeliverySheetsClient(args.sheets, quota, args.requestChecks ?? {});
  const outcomes: PlannedWriteOutcome[] = [];
  // Finish destinations first. A failed/deferred destination fences every
  // stale delete for that document; retry recomputes membership from Mongo.
  for (const group of groupByTab(writes.filter((write) => write.op === "upsert"))) {
    outcomes.push(...(await processCoalescedTabGroup(sheets, group, ensureHeaders)));
  }
  const pending = new Set(outcomes.filter((outcome) => outcome.status !== "synced").map((outcome) => outcome.write.docKey));
  const deletes = writes.filter((write) => write.op === "delete");
  outcomes.push(...deletes.filter((write) => pending.has(write.docKey)).map((write) => ({ ...deferred(write, "delete"), error: "destination_upsert_pending" })));
  for (const group of groupByTab(deletes.filter((write) => !pending.has(write.docKey)))) {
    outcomes.push(...(await processCoalescedTabGroup(sheets, group, false)));
  }
  return outcomes;
}

/** A chain job and a source job may both refresh the same Lead in one drain.
 * Coalesce physical writes, retaining an outcome for each durable job. */
async function processCoalescedTabGroup(sheets: sheets_v4.Sheets, group: TabGroup, ensureHeaders: boolean): Promise<PlannedWriteOutcome[]> {
  const byId = new Map<string, PlannedWrite[]>();
  for (const write of group.writes) byId.set(write.mongoId, [...(byId.get(write.mongoId) ?? []), write]);
  const selected: PlannedWrite[] = [];
  const conflicts: PlannedWriteOutcome[] = [];
  for (const writes of byId.values()) {
    if (writes[0].op === "upsert" && new Set(writes.map((write) => JSON.stringify(write.row))).size > 1) {
      conflicts.push(...writes.map((write) => failed(write, "lookup", "conflicting_current_row_payloads")));
    } else selected.push(writes[0]);
  }
  if (!selected.length) return conflicts;
  const results = await processTabGroup(sheets, { ...group, writes: selected }, ensureHeaders);
  return [...conflicts, ...results.flatMap((result) => byId.get(result.write.mongoId)!.map((write) => ({ ...result, write })))];
}

async function processTabGroup(
  sheets: sheets_v4.Sheets,
  group: TabGroup,
  ensureHeaders: boolean,
): Promise<PlannedWriteOutcome[]> {
  const { spreadsheetId, headers } = group;
  try {
    if (group.writes.some((write) => write.op === "upsert")) {
      group = { ...group, tabName: await resolveCompatibleSheetTitle(sheets, spreadsheetId, group.tabName) };
    } else {
      const sheetId = await getExistingSheetId(sheets, spreadsheetId, group.tabName);
      if (sheetId === undefined) return group.writes.map((write) => synced(write, "delete", undefined));
      group = { ...group, sheetId };
    }
  } catch (error) { return failGroup(group, error, "lookup"); }
  const { tabName } = group;

  let preparedMap: TabRowMap | undefined;
  if (ensureHeaders) {
    try {
      await ensureTabsAndHeaders(sheets, spreadsheetId, [{ tabName, headers }], async (title, created) => {
        preparedMap = await buildTabRowMap(sheets, spreadsheetId, title, headers, created);
        if (preparedMap.idColumn !== undefined && preparedMap.idColumn !== headers.indexOf("Mongo ID")) {
          throw new Error("sheet_identity_header_rewrite_unsafe");
        }
      });
    } catch (error) {
      return failGroup(group, error, "ensure_headers");
    }
  }

  // One fresh identity read per tab; recorded row numbers are hints only.
  let rowMap: TabRowMap;
  try {
    rowMap = preparedMap ?? await buildTabRowMap(sheets, spreadsheetId, tabName, headers);
  } catch (error) {
    return failGroup(group, error, "lookup");
  }

  const upserts = group.writes.filter((write) => write.op === "upsert");
  const deletes = group.writes.filter((write) => write.op === "delete");
  if (upserts.length && rowMap.idColumn !== undefined && rowMap.idColumn !== headers.indexOf("Mongo ID")) {
    return failGroup(group, new Error("sheet_identity_projection_layout_unsafe"), "lookup");
  }

  const resolved = upserts.map((write) => ({
    write,
    rowNumber: rowMap.get(write.mongoId),
  }));
  const updates = resolved.filter((entry) => entry.rowNumber !== undefined);
  const appends = resolved.filter((entry) => entry.rowNumber === undefined);

  const outcomes: PlannedWriteOutcome[] = [];
  outcomes.push(...(await applyUpdates(sheets, group, updates)));
  outcomes.push(...(await applyAppends(sheets, group, appends)));
  const repairs = upserts.filter((write) => rowMap.duplicateRows.has(write.mongoId) && outcomes.some((outcome) => outcome.write === write && outcome.status === "synced"));
  if (repairs.length) {
    const extraMap = new Map<string, number>() as TabRowMap;
    extraMap.duplicateRows = new Map();
    for (const write of repairs) {
      const extras = rowMap.duplicateRows.get(write.mongoId)!;
      extraMap.set(write.mongoId, extras[0]);
      extraMap.duplicateRows.set(write.mongoId, extras.slice(1));
    }
    const repairOutcomes = await applyDeletes(sheets, group, repairs, extraMap);
    for (const write of repairs) {
      const failure = repairOutcomes.find((outcome) => outcome.write === write && outcome.status !== "synced");
      if (failure) {
        const index = outcomes.findIndex((outcome) => outcome.write === write);
        outcomes[index] = { ...failure, error: `duplicate_row_repair_pending:${failure.error}` };
      } else logger.info({ msg: "sheet_sync.duplicate_rows_repaired", mongoId: write.mongoId, tabName, removed: rowMap.duplicateRows.get(write.mongoId)?.length });
    }
  }
  outcomes.push(...(await applyDeletes(sheets, group, deletes, rowMap)));
  return outcomes;
}

async function applyUpdates(
  sheets: sheets_v4.Sheets,
  group: TabGroup,
  updates: UpdateEntry[],
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
      outcomes.push(...chunk.map(({ write }) => failed(write, "update", error)));
    }
  }
  return outcomes;
}

async function applyAppends(
  sheets: sheets_v4.Sheets,
  group: TabGroup,
  appends: AppendEntry[],
): Promise<PlannedWriteOutcome[]> {
  if (appends.length === 0) {
    return [];
  }

  const endColumn = columnLetter(group.headers.length);
  const chunks = chunkByLimits(appends, (entry) => entry.write.row);
  const outcomes: PlannedWriteOutcome[] = [];

  for (const chunk of chunks) {
    try {
      const response = await sheets.spreadsheets.values.append({
        spreadsheetId: group.spreadsheetId,
        range: `${escapeSheetTitleForRange(group.tabName)}!A:${endColumn}`,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: chunk.map(({ write }) => write.row) },
      });
      const firstRow = extractRowNumberFromRange(response.data.updates?.updatedRange);
      if (firstRow === undefined) throw new Error("append_confirmation_missing");
      outcomes.push(
        ...chunk.map(({ write }, index) =>
          synced(write, "append", firstRow + index),
        ),
      );
    } catch (error) {
      outcomes.push(...chunk.map(({ write }) => failed(write, "append", error)));
    }
  }
  return outcomes;
}

async function applyDeletes(
  sheets: sheets_v4.Sheets,
  group: TabGroup,
  deletes: PlannedWrite[],
  rowMap: TabRowMap,
): Promise<PlannedWriteOutcome[]> {
  if (deletes.length === 0) {
    return [];
  }

  const resolved = deletes
    .flatMap((write) => [rowMap.get(write.mongoId), ...(rowMap.duplicateRows?.get(write.mongoId) ?? [])].map((rowNumber) => ({ write, rowNumber })))
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

  let sheetId: number | undefined;
  try {
    sheetId = group.sheetId ?? await resolveSheetId(sheets, group.spreadsheetId, group.tabName);
  } catch (error) {
    return [...alreadyGone, ...resolved.map(({ write }) => failed(write, "delete", error))];
  }
  if (sheetId === undefined) {
    return [
      ...alreadyGone,
      ...resolved.map(({ write }) => failed(write, "delete", "sheet tab not found")),
    ];
  }

  // Descending row order so earlier deletions never shift later indices.
  const uniqueRows = new Map(resolved.map((entry) => [entry.rowNumber, entry]));
  const ordered = [...uniqueRows.values()].sort((a, b) => b.rowNumber - a.rowNumber);
  const chunks = chunkByLimits(ordered, (entry) => deleteRequest(sheetId, entry.rowNumber));
  const outcomes: PlannedWriteOutcome[] = [...alreadyGone];

  for (const chunk of chunks) {
    const requests: sheets_v4.Schema$Request[] = chunk.map(({ rowNumber }) =>
      deleteRequest(sheetId, rowNumber),
    );

    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: group.spreadsheetId,
        requestBody: { requests },
      });
      outcomes.push(...chunk.map(({ write, rowNumber }) => synced(write, "delete", rowNumber)));
    } catch (error) {
      outcomes.push(...chunk.map(({ write }) => failed(write, "delete", error)));
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
  error: unknown,
): PlannedWriteOutcome {
  if (error instanceof SheetDeliveryDeferred) {
    const detail = error.cause instanceof Error ? `:${describeError(error.cause)}` : "";
    return { ...deferred(write, action), error: `${error.message}${detail}` };
  }
  return { write, status: "failed", action, error: typeof error === "string" ? error : describeError(error), readsUsed: 0, writesUsed: 0 };
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

function failGroup(
  group: TabGroup,
  error: unknown,
  action: PlannedWriteOutcome["action"],
): PlannedWriteOutcome[] {
  return group.writes.map((write) => failed(write, action, error));
}
