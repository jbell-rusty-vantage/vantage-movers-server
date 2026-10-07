import { CapacitySnapshot, type CapacitySnapshotDocument } from "../../models/CapacitySnapshot";
import { floridaCalendarDateInputValue } from "../../utils/easternTime";
import { MAX_SLOPE_POINTS } from "./runway";
import { liveCapacityReaders, type CapacityReaders } from "./readers";

/**
 * The daily capacity snapshot (doc 11b, R2). `/api/cron/capacity-snapshot` runs it at 08:45 UTC (about 04:45
 * New York). One row per New York day: a second run on the same day finds the row and writes nothing, and the
 * unique index on `day` settles a race between two runs.
 */

export type SnapshotStore = {
  exists(day: string): Promise<boolean>;
  insert(row: Omit<CapacitySnapshotDocument, "_id">): Promise<void>;
  recent(limit: number): Promise<Array<Omit<CapacitySnapshotDocument, "_id">>>;
};

export const mongoSnapshotStore: SnapshotStore = {
  async exists(day) {
    return Boolean(await CapacitySnapshot.exists({ day }));
  },
  async insert(row) {
    await CapacitySnapshot.create(row);
  },
  async recent(limit) {
    const rows = await CapacitySnapshot.find({}, { _id: 0 }).sort({ day: -1 }).limit(limit).lean();
    return rows.reverse();
  },
};

export type SnapshotResult =
  | { written: true; day: string; snapshot: Omit<CapacitySnapshotDocument, "_id">; partial?: string[] }
  | { written: false; day: string; reason: "already_exists" };

function isDuplicateKey(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === 11000);
}

export async function takeCapacitySnapshot(
  now: Date = new Date(),
  deps: { store?: SnapshotStore; readers?: Pick<CapacityReaders, "readDatabase" | "readSheets"> } = {},
): Promise<SnapshotResult> {
  const store = deps.store ?? mongoSnapshotStore;
  const readers = deps.readers ?? liveCapacityReaders;
  const day = floridaCalendarDateInputValue(now);
  if (await store.exists(day)) return { written: false, day, reason: "already_exists" };

  // One failed reader still records the other; both failing writes nothing, so the next run can retry.
  const [database, sheets] = await Promise.allSettled([readers.readDatabase(), readers.readSheets()]);
  if (database.status === "rejected" && sheets.status === "rejected") throw database.reason;
  const snapshot = {
    day,
    taken_at: now,
    database: database.status === "fulfilled" ? database.value : null,
    sheets: sheets.status === "fulfilled" ? sheets.value : [],
  };
  try {
    await store.insert(snapshot);
  } catch (error) {
    if (isDuplicateKey(error)) return { written: false, day, reason: "already_exists" };
    throw error;
  }
  const errors = [database, sheets].flatMap((result, index) =>
    result.status === "rejected" ? [`${index === 0 ? "database" : "sheets"}: ${errorMessage(result.reason)}`] : [],
  );
  return { written: true, day, snapshot, ...(errors.length ? { partial: errors } : {}) };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The newest snapshots, oldest first — the points every runway is fitted to. */
export function readRecentSnapshots(store: SnapshotStore = mongoSnapshotStore) {
  return store.recent(MAX_SLOPE_POINTS);
}
