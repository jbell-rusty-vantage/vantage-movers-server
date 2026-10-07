import mongoose from "mongoose";
import {
  getMasterBookedSheetContainerId,
  getMasterLeadsSheetContainerId,
  SHEET_SYNC_RESOURCES,
  type SheetSyncResource,
} from "../../config/domain";
import type {
  CapacityDatabaseReading,
  CapacitySheetReading,
  CapacityTabReading,
  CapacityWorkbook,
} from "../../models/CapacitySnapshot";
import { CancelledLead } from "../../models/CancelledLead";
import { SheetSyncJob } from "../../models/SheetSyncJob";
import { SheetSyncRun } from "../../models/SheetSyncRun";
import { getSheetsClient } from "../googleSheets/auth";

/**
 * The live readings behind the Systems capacity cards (doc 11b, R2/R4). Each reader is one external read;
 * `capacity.ts` and `snapshot.ts` take them as injected dependencies so tests never touch Mongo stats or Sheets.
 */

/** A job `processing` for longer than this is stuck (doc 11b, red rule). */
export const STUCK_AFTER_MS = 15 * 60 * 1000;

/** Which Sheet Sync resources write which Master workbook. */
export const WORKBOOK_SYNC_RESOURCES: Record<CapacityWorkbook, readonly SheetSyncResource[]> = {
  master_leads: ["source_lead", "delete_source_lead"],
  master_booked: SHEET_SYNC_RESOURCES.filter((resource) => resource !== "source_lead" && resource !== "delete_source_lead"),
};

export type SyncLine = {
  last_write_at: string | null;
  pending: number;
  failed: number;
  stuck: { count: number; oldest_at: string | null };
};

export type CapacityReaders = {
  readDatabase(): Promise<CapacityDatabaseReading>;
  readSheets(): Promise<CapacitySheetReading[]>;
  readSync(now: Date): Promise<Record<CapacityWorkbook, SyncLine>>;
  readLastCancellationAt(): Promise<string | null>;
};

type DbStats = { storageSize?: number; indexSize?: number; fsUsedSize?: number; fsTotalSize?: number };

/** `db.stats` on every database plus `collStats` on `local.oplog.rs`. The app's database user can read both. */
export async function readDatabaseLive(): Promise<CapacityDatabaseReading> {
  const client = mongoose.connection.getClient();
  const { databases } = await client.db("admin").admin().listDatabases({ nameOnly: true });
  let fsUsed = 0;
  let fsTotal = 0;
  let dataBytes = 0;
  for (const { name } of databases) {
    let stats: DbStats;
    try {
      stats = (await client.db(name).stats()) as DbStats;
    } catch {
      continue;
    }
    if (!fsTotal && stats.fsTotalSize) {
      fsUsed = stats.fsUsedSize ?? 0;
      fsTotal = stats.fsTotalSize;
    }
    if (name !== "local") dataBytes += (stats.storageSize ?? 0) + (stats.indexSize ?? 0);
  }
  if (!fsTotal) throw new Error("The database did not report its disk size.");
  const oplog = (await client.db("local").command({ collStats: "oplog.rs" })) as { storageSize?: number; maxSize?: number };
  return {
    fs_used_bytes: fsUsed,
    fs_total_bytes: fsTotal,
    data_bytes: dataBytes,
    oplog_storage_bytes: oplog.storageSize ?? 0,
    oplog_max_bytes: oplog.maxSize ?? 0,
  };
}

function lastFilledRow(column: unknown[][] | null | undefined): number {
  const rows = column ?? [];
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (String(rows[i]?.[0] ?? "").trim()) return i + 1;
  }
  return 0;
}

const quoteTab = (title: string) => `'${title.replace(/'/g, "''")}'!A:A`;

/**
 * Grid size of every tab (`spreadsheets.get`) and the last non-empty cell in column A — only on the two Master
 * workbooks, where the server writes the Mongo id into column A. Column A is not a valid signal elsewhere.
 */
async function readWorkbook(workbook: CapacityWorkbook, spreadsheetId: string): Promise<CapacitySheetReading> {
  const sheets = getSheetsClient();
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties(title,gridProperties(rowCount,columnCount))",
  });
  const tabs = (meta.data.sheets ?? []).map((sheet) => {
    const grid = sheet.properties?.gridProperties;
    return { name: sheet.properties?.title ?? "", grid_cells: (grid?.rowCount ?? 0) * (grid?.columnCount ?? 0) };
  });
  const columns = tabs.length
    ? await sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges: tabs.map((tab) => quoteTab(tab.name)),
        majorDimension: "ROWS",
      })
    : null;
  const ranges = columns?.data.valueRanges ?? [];
  const readings: CapacityTabReading[] = tabs.map((tab, index) => ({
    name: tab.name,
    grid_cells: tab.grid_cells,
    filled_rows: lastFilledRow(ranges[index]?.values as unknown[][] | undefined),
  }));
  return { workbook, grid_cells: readings.reduce((sum, tab) => sum + tab.grid_cells, 0), tabs: readings };
}

export async function readSheetsLive(): Promise<CapacitySheetReading[]> {
  return Promise.all([
    readWorkbook("master_leads", getMasterLeadsSheetContainerId()),
    readWorkbook("master_booked", getMasterBookedSheetContainerId()),
  ]);
}

/** Pending, failed and stuck counts per workbook from `sheet_sync_jobs`; last write from `sheet_sync_runs`. */
export async function readSyncLive(now: Date): Promise<Record<CapacityWorkbook, SyncLine>> {
  const stuckBefore = new Date(now.getTime() - STUCK_AFTER_MS);
  const [groups, lastRun] = await Promise.all([
    SheetSyncJob.aggregate<{ _id: { resource: string; status: string; stuck: boolean }; n: number; oldest: Date }>([
      { $match: { status: { $in: ["pending", "retrying", "processing", "failed"] } } },
      {
        $group: {
          _id: {
            resource: "$resource",
            status: "$status",
            stuck: { $and: [{ $eq: ["$status", "processing"] }, { $lt: ["$updatedAt", stuckBefore] }] },
          },
          n: { $sum: 1 },
          oldest: { $min: "$updatedAt" },
        },
      },
    ]),
    SheetSyncRun.findOne(
      { status: { $in: ["completed", "partial_failure"] }, synced_job_count: { $gt: 0 } },
      { finished_at: 1, started_at: 1 },
    )
      .sort({ started_at: -1 })
      .lean(),
  ]);
  const lastWrite = lastRun ? (lastRun.finished_at ?? lastRun.started_at) : null;
  const line = (workbook: CapacityWorkbook): SyncLine => {
    const mine = groups.filter((group) => WORKBOOK_SYNC_RESOURCES[workbook].includes(group._id.resource as SheetSyncResource));
    const count = (match: (group: (typeof mine)[number]) => boolean) =>
      mine.filter(match).reduce((sum, group) => sum + group.n, 0);
    const stuck = mine.filter((group) => group._id.stuck);
    const oldest = stuck.reduce<Date | null>((min, group) => (!min || group.oldest < min ? group.oldest : min), null);
    return {
      last_write_at: lastWrite ? new Date(lastWrite).toISOString() : null,
      pending: count((group) => group._id.status === "pending" || group._id.status === "retrying"),
      failed: count((group) => group._id.status === "failed"),
      stuck: { count: stuck.reduce((sum, group) => sum + group.n, 0), oldest_at: oldest ? oldest.toISOString() : null },
    };
  };
  return { master_leads: line("master_leads"), master_booked: line("master_booked") };
}

/** Newest cancellation record; its row lands on Master Booked › Cancelled Deals. */
export async function readLastCancellationAtLive(): Promise<string | null> {
  const newest = await CancelledLead.findOne({}, { createdAt: 1 }).sort({ createdAt: -1 }).lean<{ createdAt?: Date }>();
  return newest?.createdAt ? new Date(newest.createdAt).toISOString() : null;
}

export const liveCapacityReaders: CapacityReaders = {
  readDatabase: readDatabaseLive,
  readSheets: readSheetsLive,
  readSync: readSyncLive,
  readLastCancellationAt: readLastCancellationAtLive,
};
