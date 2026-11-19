import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type { CapacityDatabaseReading, CapacitySheetReading } from "../../models/CapacitySnapshot";
import { getSystemsCapacity, resetSystemsCapacityCache } from "./capacity";
import type { CapacityReaders, SyncLine } from "./readers";
import type { SnapshotStore } from "./snapshot";

/** The 2026-10-06 gather (doc 11b seeds). */
const DATABASE: CapacityDatabaseReading = {
  fs_used_bytes: 9_018_167_296,
  fs_total_bytes: 13_853_786_112,
  data_bytes: 547_000_000,
  oplog_storage_bytes: 5_985_000_000,
  oplog_max_bytes: 1_038_000_000,
};
const SHEETS: CapacitySheetReading[] = [
  {
    workbook: "master_leads",
    grid_cells: 363_022,
    tabs: [
      { name: "Forms", filled_rows: 6_724, grid_cells: 7_723 * 26 },
      { name: "Calls", filled_rows: 1_466, grid_cells: 2_465 * 24 },
    ],
  },
  {
    workbook: "master_booked",
    grid_cells: 72_312,
    tabs: [
      { name: "Booked Deals", filled_rows: 883, grid_cells: 1_882 * 24 },
      { name: "Cancelled Deals", filled_rows: 45, grid_cells: 1_044 * 26 },
    ],
  },
];
const clean: SyncLine = { last_write_at: "2026-10-07T12:58:00.000Z", pending: 1, failed: 0, stuck: { count: 0, oldest_at: null } };
const stuck: SyncLine = { ...clean, stuck: { count: 3, oldest_at: "2026-07-29T18:45:43.139Z" } };

const now = new Date("2026-10-07T13:00:00.000Z");

function fakeReaders(overrides: Partial<CapacityReaders> = {}) {
  const calls = { database: 0, sheets: 0 };
  const readers: CapacityReaders = {
    readDatabase: async () => {
      calls.database += 1;
      return DATABASE;
    },
    readSheets: async () => {
      calls.sheets += 1;
      return SHEETS;
    },
    readSync: async () => ({ master_leads: stuck, master_booked: clean }),
    readLastCancellationAt: async () => "2026-08-20T04:48:00.000Z",
    ...overrides,
  };
  return { readers, calls };
}

const noSnapshots: SnapshotStore = { exists: async () => false, insert: async () => undefined, recent: async () => [] };

beforeEach(() => resetSystemsCapacityCache());

test("day one: the database is green on the seed estimate and Master Leads is red for the stuck jobs", async () => {
  const { readers } = fakeReaders();
  const result = await getSystemsCapacity({ refresh: false }, { readers, snapshots: noSnapshots, now: () => now });
  const db = result.database;
  assert.equal(db.status.colour, "green");
  assert.equal(db.used_pct, 65.1);
  assert.equal(db.until_90!.basis, "estimate");
  assert.equal(db.until_90!.points, 0);
  assert.equal(db.until_full!.basis, "estimate");
  assert.equal(db.growth_per_day_bytes, 4_000_000);
  assert.match(db.until_90!.label, /^about 2 years/);
  assert.equal(db.breakdown, null);
  assert.equal(db.storage_evidence!.allocated_business_bytes.value, 547_000_000);
  assert.deepEqual(db.storage_evidence!.oplog_reclaimable_bytes, { basis: "unknown", value: null });
  assert.match(db.caveat, /auto-scaling/);

  const [leads, booked] = result.sheets;
  assert.equal(leads.status.colour, "red");
  assert.equal(leads.status.reason, "3 Sheet Sync jobs have been stuck since Jul 29. Their rows may be missing from the sheet.");
  assert.deepEqual(
    { name: leads.biggest_tab!.name, rows: leads.biggest_tab!.filled_rows, limit: leads.biggest_tab!.limit, perMonth: leads.biggest_tab!.growth_per_month },
    { name: "Forms", rows: 6_724, limit: 40_000, perMonth: 1_300 },
  );
  assert.equal(leads.cells!.used, 363_022);
  assert.equal(leads.cells!.cap, 10_000_000);
  assert.equal(leads.cells!.growth_per_month, 45_000);
  assert.equal(leads.until_new_workbook!.trigger, "rows");
  assert.match(leads.until_new_workbook!.label, /^about 2 years 2 months \(≈ Nov 2028\)$/);
  assert.equal(leads.until_cell_cap!.label, "more than 15 years");
  assert.equal(leads.sync!.stuck.count, 3);

  assert.equal(booked.status.colour, "green");
  assert.equal(booked.biggest_tab!.name, "Booked Deals");
  assert.equal(booked.until_new_workbook!.label, "more than 15 years");
  assert.equal(booked.last_cancellation_at, "2026-08-20T04:48:00.000Z");
  assert.equal("last_cancellation_at" in leads, false);
});

test("the database reading is cached for 10 minutes, and refresh skips it at most once a minute", async () => {
  const { readers, calls } = fakeReaders();
  let clock = now.getTime();
  const deps = { readers, snapshots: noSnapshots, now: () => new Date(clock) };
  await getSystemsCapacity({ refresh: false }, deps);
  clock += 5 * 60_000;
  await getSystemsCapacity({ refresh: false }, deps);
  assert.deepEqual(calls, { database: 1, sheets: 1 });
  const first = await getSystemsCapacity({ refresh: true }, deps);
  assert.equal(first.refreshed, true);
  clock += 30_000;
  const throttled = await getSystemsCapacity({ refresh: true }, deps);
  assert.equal(throttled.refreshed, false);
  assert.deepEqual(calls, { database: 2, sheets: 2 });
  clock += 11 * 60_000;
  await getSystemsCapacity({ refresh: false }, deps);
  assert.deepEqual(calls, { database: 3, sheets: 2 }, "sheets keep their 1-hour cache");
});
