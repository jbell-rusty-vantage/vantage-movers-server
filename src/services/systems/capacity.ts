import type {
  CapacityDatabaseReading,
  CapacitySheetReading,
  CapacitySnapshotDocument,
  CapacityWorkbook,
} from "../../models/CapacitySnapshot";
import { liveCapacityReaders, type CapacityReaders, type SyncLine } from "./readers";
import { projectRunway, type Runway, type RunwayPoint } from "./runway";
import { mongoSnapshotStore, type SnapshotStore } from "./snapshot";

/**
 * Systems › Capacity (doc 11b, R4): live readings, the "time until" runways (R3) and the colour with its reason
 * for the database card and the two Master Sheet cards. The database reading is cached for 10 minutes and the
 * Sheets reading for 1 hour; `refresh` skips both caches at most once a minute. The Sheet Sync line is always live.
 */

const DAYS_PER_MONTH = 365.25 / 12;
const MB = 1_000_000;

export const DATABASE_CACHE_MS = 10 * 60 * 1000;
export const SHEETS_CACHE_MS = 60 * 60 * 1000;
export const REFRESH_MIN_INTERVAL_MS = 60 * 1000;

/** Seed growth until 7 snapshots exist (doc 11b "Seed estimate"): ≈ 4 MB/day after the 2026-10-07 trim. */
export const DATABASE_SEED_BYTES_PER_DAY = 4 * MB;
/** Doc 11b / doc 12 seeds per month. Master Booked's cell rate is its row rate × 24 columns (not in 11b). */
export const SHEET_SEEDS: Record<CapacityWorkbook, { rowsPerMonth: number; cellsPerMonth: number }> = {
  master_leads: { rowsPerMonth: 1_300, cellsPerMonth: 45_000 },
  master_booked: { rowsPerMonth: 185, cellsPerMonth: 185 * 24 },
};

export const TAB_ROW_LIMIT = 40_000;
export const TAB_ROW_WARNING = 30_000;
export const GOOGLE_CELL_CAP = 10_000_000;
export const NEW_WORKBOOK_CELLS = 5_000_000;
export const CELL_WARNING = 3_000_000;
const NEW_WORKBOOK_WARNING_DAYS = 182;

export const DATABASE_CAVEAT =
  "Atlas tier and storage auto-scaling are not known yet. If auto-scaling is on, reaching 90% grows the disk and the bill instead of failing.";

export type CapacityColour = "green" | "amber" | "red" | "unknown";
export type CapacityStatus = { colour: CapacityColour; reason: string };

export type DatabaseCard = {
  status: CapacityStatus;
  read_at: string | null;
  error: string | null;
  used_bytes: number | null;
  total_bytes: number | null;
  used_pct: number | null;
  breakdown: {
    business_bytes: number;
    oplog_bytes: number;
    oplog_reclaimable_bytes: number;
    system_bytes: number;
  } | null;
  growth_per_day_bytes: number | null;
  /** Which slope the forecast uses: the disk's, or the data's while freed space is being reused. */
  growth_source: "disk" | "data" | null;
  until_90: Runway | null;
  until_full: Runway | null;
  caveat: string;
};

export type SheetCard = {
  workbook: CapacityWorkbook;
  label: string;
  status: CapacityStatus;
  read_at: string | null;
  error: string | null;
  biggest_tab: {
    name: string;
    filled_rows: number;
    limit: number;
    warning: number;
    pct: number;
    growth_per_month: number;
  } | null;
  cells: { used: number; cap: number; pct: number; growth_per_month: number } | null;
  until_new_workbook: (Runway & { trigger: "rows" | "cells" }) | null;
  until_cell_cap: Runway | null;
  sync: SyncLine | null;
  /** Master Booked only. */
  last_cancellation_at?: string | null;
};

export type SystemsCapacity = {
  database: DatabaseCard;
  sheets: [SheetCard, SheetCard];
  generated_at: string;
  /** False when `refresh` was asked for within a minute of the last one and the caches were used. */
  refreshed: boolean;
};

type Cached<T> = { value: T; at: number } | null;
type Settled<T> = { value: T; at: number } | { error: string; at: number };

const cache: { database: Cached<CapacityDatabaseReading>; sheets: Cached<CapacitySheetReading[]>; lastRefreshAt: number } = {
  database: null,
  sheets: null,
  lastRefreshAt: 0,
};

export function resetSystemsCapacityCache(): void {
  cache.database = null;
  cache.sheets = null;
  cache.lastRefreshAt = 0;
}

async function cachedRead<T>(
  key: "database" | "sheets",
  ttlMs: number,
  bypass: boolean,
  now: number,
  read: () => Promise<T>,
): Promise<Settled<T>> {
  const hit = cache[key] as Cached<T>;
  if (!bypass && hit && now - hit.at < ttlMs) return hit;
  try {
    const value = await read();
    (cache[key] as Cached<T>) = { value, at: now };
    return { value, at: now };
  } catch (error) {
    // A failed read keeps showing the last good reading when there is one.
    if (hit) return hit;
    return { error: error instanceof Error ? error.message : String(error), at: now };
  }
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });

function points<T>(rows: Array<Omit<CapacitySnapshotDocument, "_id">>, pick: (row: Omit<CapacitySnapshotDocument, "_id">) => T | null | undefined): RunwayPoint[] {
  return rows.flatMap((row) => {
    const value = pick(row);
    return typeof value === "number" ? [{ at: new Date(row.taken_at), value }] : [];
  });
}

/**
 * Projects the disk with the larger of two slopes (doc 11b): `fs_used_bytes`, or `data_bytes` while WiredTiger
 * reuses space freed inside the files and the disk stays flat. The data series is projected against the same
 * remaining room, so both runways answer "time until the disk reaches the limit".
 */
function databaseRunway(
  rows: Array<Omit<CapacitySnapshotDocument, "_id">>,
  reading: CapacityDatabaseReading,
  limit: number,
  now: Date,
): { runway: Runway; source: "disk" | "data" } {
  const options = { seedRatePerDay: DATABASE_SEED_BYTES_PER_DAY, capYears: 5 };
  const disk = projectRunway(points(rows, (row) => row.database?.fs_used_bytes), limit, now, {
    ...options,
    current: reading.fs_used_bytes,
  });
  const offset = reading.fs_used_bytes - reading.data_bytes;
  const data = projectRunway(points(rows, (row) => row.database?.data_bytes), limit - offset, now, {
    ...options,
    current: reading.data_bytes,
  });
  return data.basis === "measured" && data.rate_per_day > disk.rate_per_day
    ? { runway: data, source: "data" }
    : { runway: disk, source: "disk" };
}

export function databaseStatus(usedPct: number, until90: Runway): CapacityStatus {
  const days = until90.days_left;
  if (usedPct > 85) return { colour: "red", reason: `${usedPct}% of the disk is used. Over 85% needs action now.` };
  if (days !== null && days <= 30) return { colour: "red", reason: `The disk reaches 90% within 30 days (${until90.label}).` };
  if (usedPct >= 75) return { colour: "amber", reason: `${usedPct}% of the disk is used. Plan for more room before 85%.` };
  if (days !== null && days <= 90) return { colour: "amber", reason: `The disk reaches 90% within 90 days (${until90.label}).` };
  return { colour: "green", reason: `${usedPct}% of the disk is used, and 90% is more than 90 days away.` };
}

export function buildDatabaseCard(
  settled: Settled<CapacityDatabaseReading>,
  rows: Array<Omit<CapacitySnapshotDocument, "_id">>,
  now: Date,
): DatabaseCard {
  const empty = {
    used_bytes: null,
    total_bytes: null,
    used_pct: null,
    breakdown: null,
    growth_per_day_bytes: null,
    growth_source: null,
    until_90: null,
    until_full: null,
    caveat: DATABASE_CAVEAT,
  } as const;
  if ("error" in settled) {
    return {
      ...empty,
      status: { colour: "unknown", reason: "The database could not be measured just now. Try Refresh in a minute." },
      read_at: null,
      error: settled.error,
    };
  }
  const reading = settled.value;
  const used = reading.fs_used_bytes;
  const total = reading.fs_total_bytes;
  const until90 = databaseRunway(rows, reading, total * 0.9, now);
  const untilFull = databaseRunway(rows, reading, total, now);
  const usedPct = pct(used, total);
  return {
    status: databaseStatus(usedPct, until90.runway),
    read_at: new Date(settled.at).toISOString(),
    error: null,
    used_bytes: used,
    total_bytes: total,
    used_pct: usedPct,
    breakdown: {
      business_bytes: reading.data_bytes,
      oplog_bytes: reading.oplog_storage_bytes,
      oplog_reclaimable_bytes: Math.max(0, reading.oplog_storage_bytes - reading.oplog_max_bytes),
      system_bytes: Math.max(0, used - reading.data_bytes - reading.oplog_storage_bytes),
    },
    growth_per_day_bytes: untilFull.runway.rate_per_day,
    growth_source: untilFull.source,
    until_90: until90.runway,
    until_full: untilFull.runway,
    caveat: DATABASE_CAVEAT,
  };
}

export function sheetStatus(input: {
  filledRows: number;
  cells: number;
  untilNewWorkbook: Runway;
  sync: SyncLine | null;
}): CapacityStatus {
  const { filledRows, cells, untilNewWorkbook, sync } = input;
  const stuck = sync?.stuck.count ?? 0;
  if (stuck > 0) {
    const since = sync?.stuck.oldest_at ? ` since ${shortDate(sync.stuck.oldest_at)}` : "";
    return {
      colour: "red",
      reason: `${stuck} Sheet Sync ${stuck === 1 ? "job has" : "jobs have"} been stuck${since}. Their rows may be missing from the sheet.`,
    };
  }
  if ((sync?.failed ?? 0) > 0) {
    return { colour: "red", reason: `${sync!.failed} Sheet Sync ${sync!.failed === 1 ? "job" : "jobs"} failed. Their rows may be missing from the sheet.` };
  }
  if (filledRows >= TAB_ROW_LIMIT) return { colour: "red", reason: "The biggest tab has reached 40,000 rows. Start a new workbook." };
  if (cells >= NEW_WORKBOOK_CELLS) return { colour: "red", reason: "The workbook has reached 5 million cells. Start a new workbook." };
  if (filledRows >= TAB_ROW_WARNING) return { colour: "amber", reason: "The biggest tab is past 30,000 rows. Reads slow down as it grows." };
  if (cells >= CELL_WARNING) return { colour: "amber", reason: "The workbook is past 3 million cells." };
  const days = untilNewWorkbook.days_left;
  if (days !== null && days <= NEW_WORKBOOK_WARNING_DAYS) {
    return { colour: "amber", reason: `A new workbook is needed within 6 months (${untilNewWorkbook.label}).` };
  }
  return { colour: "green", reason: "Well under 30,000 rows and 3 million cells, and the sync queue is clean." };
}

const WORKBOOK_LABELS: Record<CapacityWorkbook, string> = { master_leads: "Master Leads", master_booked: "Master Booked" };

export function buildSheetCard(
  workbook: CapacityWorkbook,
  settled: Settled<CapacitySheetReading[]>,
  rows: Array<Omit<CapacitySnapshotDocument, "_id">>,
  sync: SyncLine | null,
  now: Date,
  lastCancellationAt?: string | null,
): SheetCard {
  const base = {
    workbook,
    label: WORKBOOK_LABELS[workbook],
    sync,
    ...(workbook === "master_booked" ? { last_cancellation_at: lastCancellationAt ?? null } : {}),
  };
  const reading = "error" in settled ? undefined : settled.value.find((sheet) => sheet.workbook === workbook);
  if (!reading || "error" in settled) {
    return {
      ...base,
      status: { colour: "unknown", reason: "The sheet could not be read just now. Try Refresh in a minute." },
      read_at: null,
      error: "error" in settled ? settled.error : "The sheet was not in the reading.",
      biggest_tab: null,
      cells: null,
      until_new_workbook: null,
      until_cell_cap: null,
    };
  }
  const seeds = SHEET_SEEDS[workbook];
  const biggest = [...reading.tabs].sort((a, b) => b.filled_rows - a.filled_rows)[0] ?? { name: "", filled_rows: 0, grid_cells: 0 };
  const mine = (row: Omit<CapacitySnapshotDocument, "_id">) => row.sheets.find((sheet) => sheet.workbook === workbook);
  const rowPoints = points(rows, (row) => mine(row)?.tabs.find((tab) => tab.name === biggest.name)?.filled_rows);
  const cellPoints = points(rows, (row) => mine(row)?.grid_cells);
  const options = { capYears: 15 };
  const rowsRunway = projectRunway(rowPoints, TAB_ROW_LIMIT, now, {
    ...options,
    seedRatePerDay: seeds.rowsPerMonth / DAYS_PER_MONTH,
    current: biggest.filled_rows,
  });
  const cellsToNewWorkbook = projectRunway(cellPoints, NEW_WORKBOOK_CELLS, now, {
    ...options,
    seedRatePerDay: seeds.cellsPerMonth / DAYS_PER_MONTH,
    current: reading.grid_cells,
  });
  const untilCap = projectRunway(cellPoints, GOOGLE_CELL_CAP, now, {
    ...options,
    seedRatePerDay: seeds.cellsPerMonth / DAYS_PER_MONTH,
    current: reading.grid_cells,
  });
  // The earlier of "biggest tab reaches 40,000 rows" and "workbook reaches 5,000,000 cells".
  const sooner = (cellsToNewWorkbook.days_left ?? Infinity) < (rowsRunway.days_left ?? Infinity);
  const untilNewWorkbook = sooner ? { ...cellsToNewWorkbook, trigger: "cells" as const } : { ...rowsRunway, trigger: "rows" as const };
  return {
    ...base,
    status: sheetStatus({ filledRows: biggest.filled_rows, cells: reading.grid_cells, untilNewWorkbook, sync }),
    read_at: new Date(settled.at).toISOString(),
    error: null,
    biggest_tab: {
      name: biggest.name,
      filled_rows: biggest.filled_rows,
      limit: TAB_ROW_LIMIT,
      warning: TAB_ROW_WARNING,
      pct: pct(biggest.filled_rows, TAB_ROW_LIMIT),
      growth_per_month: Math.round(rowsRunway.rate_per_day * DAYS_PER_MONTH),
    },
    cells: {
      used: reading.grid_cells,
      cap: GOOGLE_CELL_CAP,
      pct: pct(reading.grid_cells, GOOGLE_CELL_CAP),
      growth_per_month: Math.round(untilCap.rate_per_day * DAYS_PER_MONTH),
    },
    until_new_workbook: untilNewWorkbook,
    until_cell_cap: untilCap,
  };
}

export type SystemsCapacityDeps = {
  readers?: CapacityReaders;
  snapshots?: SnapshotStore;
  now?: () => Date;
};

export async function getSystemsCapacity(
  query: { refresh: boolean },
  deps: SystemsCapacityDeps = {},
): Promise<SystemsCapacity> {
  const readers = deps.readers ?? liveCapacityReaders;
  const now = (deps.now ?? (() => new Date()))();
  const nowMs = now.getTime();
  const refreshed = query.refresh && nowMs - cache.lastRefreshAt >= REFRESH_MIN_INTERVAL_MS;
  if (refreshed) cache.lastRefreshAt = nowMs;

  const [database, sheets, rows, sync, lastCancellationAt] = await Promise.all([
    cachedRead("database", DATABASE_CACHE_MS, refreshed, nowMs, () => readers.readDatabase()),
    cachedRead("sheets", SHEETS_CACHE_MS, refreshed, nowMs, () => readers.readSheets()),
    (deps.snapshots ?? mongoSnapshotStore).recent(30),
    readers.readSync(now).catch(() => null),
    readers.readLastCancellationAt().catch(() => null),
  ]);

  return {
    database: buildDatabaseCard(database, rows, now),
    sheets: [
      buildSheetCard("master_leads", sheets, rows, sync?.master_leads ?? null, now),
      buildSheetCard("master_booked", sheets, rows, sync?.master_booked ?? null, now, lastCancellationAt),
    ],
    generated_at: now.toISOString(),
    refreshed,
  };
}

