import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { sheets_v4 } from "googleapis";
import { writeBatchedTargets } from "./batchWriter";
import { buildTabRowMap } from "./tabRowMap";
import { QuotaLimiter, type QuotaBucketStore } from "./quotaLimiter";
import type { PlannedWrite } from "./types";

const HEADERS = ["Mongo ID", "Name"] as const;
const originalMaxRowsPerBatch = process.env.SHEET_SYNC_MAX_ROWS_PER_BATCH;
const originalMaxWriteSubrequests = process.env.SHEET_SYNC_MAX_WRITE_SUBREQUESTS_PER_CALL;
const originalMaxPayloadBytes = process.env.SHEET_SYNC_MAX_PAYLOAD_BYTES;

afterEach(() => {
  restoreEnv("SHEET_SYNC_MAX_ROWS_PER_BATCH", originalMaxRowsPerBatch);
  restoreEnv("SHEET_SYNC_MAX_WRITE_SUBREQUESTS_PER_CALL", originalMaxWriteSubrequests);
  restoreEnv("SHEET_SYNC_MAX_PAYLOAD_BYTES", originalMaxPayloadBytes);
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function upsert(mongoId: string, name: string, knownRowNumber?: number): PlannedWrite {
  return {
    jobId: `job-${mongoId}`,
    docKey: `CallLead:${mongoId}`,
    mongoId,
    target: "master_calls",
    spreadsheetId: "sheet-1",
    tabName: "Calls",
    headers: HEADERS,
    row: [mongoId, name],
    knownRowNumber,
    op: "upsert",
  };
}

function deleteWrite(mongoId: string): PlannedWrite {
  return { ...upsert(mongoId, ""), op: "delete", row: [] };
}

const grantAll = { reserve: async () => ({ granted: true, remaining: 100 }) } as unknown as QuotaLimiter;

type FakeSheetsCalls = {
  batchUpdates: any[];
  appends: any[];
  deletes: any[];
};

function fakeSheets(options: {
  rows: string[][];
  appendStartRow?: number;
  sheetId?: number;
  failBatchUpdate?: boolean;
}): { sheets: sheets_v4.Sheets; calls: FakeSheetsCalls } {
  const calls: FakeSheetsCalls = { batchUpdates: [], appends: [], deletes: [] };
  const sheets = {
    spreadsheets: {
      get: async () => ({ data: { sheets: [{ properties: { title: "Calls", sheetId: options.sheetId ?? 7 } }] } }),
      batchUpdate: async (req: any) => {
        calls.deletes.push(req.requestBody.requests);
        return { data: {} };
      },
      values: {
        get: async () => ({ data: { values: options.rows } }),
        batchUpdate: async (req: any) => {
          if (options.failBatchUpdate) {
            throw new Error("boom batchUpdate");
          }
          calls.batchUpdates.push(req.requestBody.data);
          return { data: {} };
        },
        append: async (req: any) => {
          calls.appends.push(req.requestBody.values);
          const start = options.appendStartRow ?? 10;
          const end = start + req.requestBody.values.length - 1;
          return { data: { updates: { updatedRange: `'Calls'!A${start}:B${end}` } } };
        },
      },
    },
  } as unknown as sheets_v4.Sheets;
  return { sheets, calls };
}

test("batches existing-row updates and new-row appends into one call each", async () => {
  const { sheets, calls } = fakeSheets({
    rows: [
      ["Mongo ID", "Name"],
      ["id-existing", "Old"],
    ],
    appendStartRow: 3,
  });

  const outcomes = await writeBatchedTargets({
    sheets,
    quota: grantAll,
    ensureHeaders: false,
    writes: [upsert("id-existing", "New"), upsert("id-new-a", "A"), upsert("id-new-b", "B")],
  });

  assert.equal(calls.batchUpdates.length, 1, "one batchUpdate for all updates");
  assert.equal(calls.batchUpdates[0].length, 1, "one row updated in place");
  assert.equal(calls.batchUpdates[0][0].range, "'Calls'!A2:B2");
  assert.equal(calls.appends.length, 1, "one append for all new rows");
  assert.equal(calls.appends[0].length, 2, "two new rows appended together");

  const byMongo = new Map(outcomes.map((o) => [o.write.mongoId, o]));
  assert.equal(byMongo.get("id-existing")?.action, "update");
  assert.equal(byMongo.get("id-existing")?.rowNumber, 2);
  assert.equal(byMongo.get("id-new-a")?.action, "append");
  assert.equal(byMongo.get("id-new-a")?.rowNumber, 3);
  assert.equal(byMongo.get("id-new-b")?.rowNumber, 4);
  assert.ok(outcomes.every((o) => o.status === "synced"));
});

test("deletes rows in descending order in a single batchUpdate", async () => {
  const { sheets, calls } = fakeSheets({
    rows: [
      ["Mongo ID", "Name"],
      ["id-row2", "x"],
      ["id-row3", "y"],
      ["id-row4", "z"],
      ["id-row5", "w"],
    ],
  });

  const outcomes = await writeBatchedTargets({
    sheets,
    quota: grantAll,
    ensureHeaders: false,
    writes: [deleteWrite("id-row2"), deleteWrite("id-row5")],
  });

  assert.equal(calls.deletes.length, 1, "one batchUpdate for all deletes");
  const startIndexes = calls.deletes[0].map((r: any) => r.deleteDimension.range.startIndex);
  assert.deepEqual(startIndexes, [4, 1], "rows deleted high-to-low");
  assert.ok(outcomes.every((o) => o.status === "synced" && o.action === "delete"));
});

test("missing delete rows are an idempotent success (no API call)", async () => {
  const { sheets, calls } = fakeSheets({ rows: [["Mongo ID", "Name"]] });

  const outcomes = await writeBatchedTargets({
    sheets,
    quota: grantAll,
    ensureHeaders: false,
    writes: [deleteWrite("gone-1")],
  });

  assert.equal(calls.deletes.length, 0);
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].status, "synced");
});

test("defers all writes when the read-quota reservation is denied", async () => {
  const { sheets } = fakeSheets({ rows: [["Mongo ID", "Name"]] });
  const denyReads = {
    reserve: async (opClass: string) => ({ granted: opClass !== "read", remaining: 0 }),
  } as unknown as QuotaLimiter;

  const outcomes = await writeBatchedTargets({
    sheets,
    quota: denyReads,
    ensureHeaders: false,
    writes: [upsert("id-1", "A")],
  });

  assert.ok(outcomes.every((o) => o.status === "deferred"));
});

test("partial failure: update call fails but appends still succeed", async () => {
  const { sheets } = fakeSheets({
    rows: [
      ["Mongo ID", "Name"],
      ["id-existing", "Old"],
    ],
    appendStartRow: 3,
    failBatchUpdate: true,
  });

  const outcomes = await writeBatchedTargets({
    sheets,
    quota: grantAll,
    ensureHeaders: false,
    writes: [upsert("id-existing", "New"), upsert("id-new", "A")],
  });

  const byMongo = new Map(outcomes.map((o) => [o.write.mongoId, o]));
  assert.equal(byMongo.get("id-existing")?.status, "failed");
  assert.equal(byMongo.get("id-new")?.status, "synced");
});

test("append batches are split by configured row guardrail", async () => {
  process.env.SHEET_SYNC_MAX_ROWS_PER_BATCH = "2";
  process.env.SHEET_SYNC_MAX_WRITE_SUBREQUESTS_PER_CALL = "100";
  process.env.SHEET_SYNC_MAX_PAYLOAD_BYTES = "1500000";
  const { sheets, calls } = fakeSheets({
    rows: [["Mongo ID", "Name"]],
    appendStartRow: 2,
  });

  const outcomes = await writeBatchedTargets({
    sheets,
    quota: grantAll,
    ensureHeaders: false,
    writes: [upsert("id-new-a", "A"), upsert("id-new-b", "B"), upsert("id-new-c", "C")],
  });

  assert.equal(calls.appends.length, 2, "three appends split into batches of 2 and 1");
  assert.deepEqual(
    calls.appends.map((values) => values.length),
    [2, 1],
  );
  assert.deepEqual(
    outcomes.map((outcome) => outcome.rowNumber),
    [2, 3, 2],
  );
});

test("buildTabRowMap maps Mongo IDs to 1-based row numbers", async () => {
  const sheets = {
    spreadsheets: {
      values: {
        get: async () => ({
          data: {
            values: [
              ["Mongo ID", "Name"],
              ["aaaaaaaaaaaaaaaaaaaaaaaa", "First"],
              ["bbbbbbbbbbbbbbbbbbbbbbbb", "Second"],
            ],
          },
        }),
      },
    },
  } as unknown as sheets_v4.Sheets;

  const map = await buildTabRowMap(sheets, "sheet-1", "Calls", HEADERS);
  assert.equal(map.get("aaaaaaaaaaaaaaaaaaaaaaaa"), 2);
  assert.equal(map.get("bbbbbbbbbbbbbbbbbbbbbbbb"), 3);
});

test("QuotaLimiter grants within budget and denies (with rollback) past it", async () => {
  let stored = 0;
  const store: QuotaBucketStore = {
    findOneAndUpdate: async (_filter, update: any) => {
      stored += update.$inc.count;
      return { count: stored };
    },
    updateOne: async (_filter, update: any) => {
      stored += update.$inc.count;
      return {};
    },
  };
  const limiter = new QuotaLimiter({ store, readBudget: 2, writeBudget: 2 });

  assert.equal((await limiter.reserve("read", 1)).granted, true);
  assert.equal((await limiter.reserve("read", 1)).granted, true);
  const denied = await limiter.reserve("read", 1);
  assert.equal(denied.granted, false);
  // The denied reservation rolled its increment back to the budget ceiling.
  assert.equal(stored, 2);
});
