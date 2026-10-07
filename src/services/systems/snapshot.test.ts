import assert from "node:assert/strict";
import { test } from "node:test";
import type { CapacitySnapshotDocument } from "../../models/CapacitySnapshot";
import { takeCapacitySnapshot, type SnapshotStore } from "./snapshot";

type Row = Omit<CapacitySnapshotDocument, "_id">;

/** An in-memory store with the unique-`day` rule of the real index. */
function memoryStore() {
  const rows: Row[] = [];
  const store: SnapshotStore = {
    exists: async (day) => rows.some((row) => row.day === day),
    insert: async (row) => {
      if (rows.some((existing) => existing.day === row.day)) throw Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
      rows.push(row);
    },
    recent: async () => rows,
  };
  return { store, rows };
}

const readers = {
  readDatabase: async () => ({ fs_used_bytes: 1, fs_total_bytes: 2, data_bytes: 1, oplog_storage_bytes: 0, oplog_max_bytes: 0 }),
  readSheets: async () => [{ workbook: "master_leads" as const, grid_cells: 10, tabs: [{ name: "Forms", filled_rows: 5, grid_cells: 10 }] }],
};

test("running twice in one New York day writes one row", async () => {
  const { store, rows } = memoryStore();
  const morning = await takeCapacitySnapshot(new Date("2026-10-07T08:45:00Z"), { store, readers });
  const again = await takeCapacitySnapshot(new Date("2026-10-07T20:00:00Z"), { store, readers });
  assert.equal(morning.written, true);
  assert.equal(morning.day, "2026-10-07");
  assert.deepEqual(again, { written: false, day: "2026-10-07", reason: "already_exists" });
  assert.equal(rows.length, 1);
});

test("the day is the New York date, not the UTC date", async () => {
  const { store, rows } = memoryStore();
  // 02:30 UTC on Oct 8 is 22:30 on Oct 7 in New York.
  const late = await takeCapacitySnapshot(new Date("2026-10-08T02:30:00Z"), { store, readers });
  assert.equal(late.day, "2026-10-07");
  const next = await takeCapacitySnapshot(new Date("2026-10-08T08:45:00Z"), { store, readers });
  assert.equal(next.day, "2026-10-08");
  assert.equal(rows.length, 2);
});

test("a race between two runs is settled by the unique day", async () => {
  const { store, rows } = memoryStore();
  const racing: SnapshotStore = { ...store, exists: async () => false };
  await takeCapacitySnapshot(new Date("2026-10-07T08:45:00Z"), { store: racing, readers });
  const second = await takeCapacitySnapshot(new Date("2026-10-07T08:45:01Z"), { store: racing, readers });
  assert.equal(second.written, false);
  assert.equal(rows.length, 1);
});

test("one failed reader still records the other; both failing writes nothing", async () => {
  const { store, rows } = memoryStore();
  const result = await takeCapacitySnapshot(new Date("2026-10-07T08:45:00Z"), {
    store,
    readers: { ...readers, readSheets: async () => Promise.reject(new Error("Sheets quota")) },
  });
  assert.equal(result.written, true);
  assert.deepEqual(result.written && result.partial, ["sheets: Sheets quota"]);
  assert.deepEqual(rows[0]!.sheets, []);
  assert.equal(rows[0]!.database!.fs_used_bytes, 1);

  const fresh = memoryStore();
  const failing = { readDatabase: async () => Promise.reject(new Error("a")), readSheets: async () => Promise.reject(new Error("b")) };
  await assert.rejects(takeCapacitySnapshot(new Date("2026-10-07T08:45:00Z"), { store: fresh.store, readers: failing }));
  assert.equal(fresh.rows.length, 0);
});
