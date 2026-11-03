import assert from "node:assert/strict";
import { test } from "node:test";
import type { sheets_v4 } from "googleapis";
import { writeBatchedTargets } from "./batchWriter";
import type { QuotaLimiter } from "./quotaLimiter";
import type { PlannedWrite } from "./types";

const headers = ["Mongo ID", "Name"];
const grant = { reserve: async () => ({ granted: true }) } as unknown as QuotaLimiter;
function fixture() {
  const names = ["Calls", "Duplicate Calls", "Bad Call Leads"];
  const rows = new Map(names.map((title) => [title, [headers, ...((title === "Calls") ? [["call-1", "old"]] : [])]]));
  let failUpdate = false, failDelete = false, appends = 0;
  const titleFrom = (range: string) => /^'([^']+)'!/.exec(range)![1];
  const sheets = { spreadsheets: {
    get: async () => ({ data: { sheets: names.map((title, sheetId) => ({ properties: { title, sheetId } })) } }),
    values: {
      get: async ({ range }: { range: string }) => ({ data: { values: rows.get(titleFrom(range)) } }),
      batchUpdate: async ({ requestBody }: any) => {
        if (failUpdate) throw new Error("injected_destination_failure");
        for (const data of requestBody.data) rows.get(titleFrom(data.range))![Number(/!A(\d+)/.exec(data.range)![1]) - 1] = data.values[0];
        return { data: {} };
      },
      append: async ({ range, requestBody }: any) => {
        if (failUpdate) throw new Error("injected_destination_failure");
        appends++;
        const tab = rows.get(titleFrom(range))!;
        const start = tab.length + 1;
        tab.push(...requestBody.values);
        return { data: { updates: { updatedRange: `'${titleFrom(range)}'!A${start}:B${tab.length}` } } };
      },
    },
    batchUpdate: async ({ requestBody }: any) => {
      if (failDelete) throw new Error("injected_stale_delete_failure");
      for (const request of requestBody.requests) {
        const range = request.deleteDimension.range;
        rows.get(names[range.sheetId])!.splice(range.startIndex, range.endIndex - range.startIndex);
      }
      return { data: {} };
    },
  } } as unknown as sheets_v4.Sheets;
  const writes: PlannedWrite[] = names.map((tabName, index) => ({ jobId: "job-1", docKey: "CallLead:call-1", mongoId: "call-1", target: ["master_calls", "master_duplicate_calls", "master_bad_calls"][index], spreadsheetId: "fixture", tabName, headers, row: ["call-1", "current"], knownRowNumber: 99, op: index === 2 ? "upsert" : "delete" }));
  return { sheets, rows, writes, setFailure: (update: boolean, remove: boolean) => { failUpdate = update; failDelete = remove; }, appends: () => appends };
}

test("failed destination fences stale deletes; retry repairs membership by ID", async () => {
  const f = fixture();
  f.setFailure(true, false);
  const failed = await writeBatchedTargets({ sheets: f.sheets, writes: f.writes, quota: grant, ensureHeaders: false });
  assert.ok(failed.some((outcome) => outcome.status === "failed"));
  assert.equal(f.rows.get("Calls")!.length, 2);
  assert.equal(failed.find((outcome) => outcome.write.target === "master_calls")?.error, "destination_upsert_pending");
  f.setFailure(false, false);
  const repaired = await writeBatchedTargets({ sheets: f.sheets, writes: f.writes, quota: grant, ensureHeaders: false });
  assert.ok(repaired.every((outcome) => outcome.status === "synced"));
  assert.deepEqual(f.rows.get("Bad Call Leads"), [headers, ["call-1", "current"]]);
  assert.equal(f.rows.get("Calls")!.length, 1);
});

test("destination-written stale-delete interruption retries without a second append", async () => {
  const f = fixture();
  f.setFailure(false, true);
  const first = await writeBatchedTargets({ sheets: f.sheets, writes: f.writes, quota: grant, ensureHeaders: false });
  assert.ok(first.some((outcome) => outcome.status === "failed"));
  assert.equal(f.rows.get("Calls")!.length, 2);
  assert.equal(f.rows.get("Bad Call Leads")!.length, 2);
  f.setFailure(false, false);
  const second = await writeBatchedTargets({ sheets: f.sheets, writes: f.writes, quota: grant, ensureHeaders: false });
  assert.ok(second.every((outcome) => outcome.status === "synced"));
  assert.equal(f.appends(), 1);
  assert.equal(f.rows.get("Calls")!.length, 1);
  assert.equal(f.rows.get("Bad Call Leads")!.length, 2);
});

test("existing physical duplicate IDs are repaired in the destination and all stale rows removed", async () => {
  const f = fixture();
  f.rows.get("Calls")!.push(["call-1", "another stale copy"]);
  f.rows.get("Bad Call Leads")!.push(["other-id", "preserve"], ["call-1", "copy 1"], ["call-1", "copy 2"]);
  const result = await writeBatchedTargets({ sheets: f.sheets, writes: f.writes, quota: grant, ensureHeaders: false });
  assert.ok(result.every((outcome) => outcome.status === "synced"));
  assert.equal(f.appends(), 0);
  assert.deepEqual(f.rows.get("Calls"), [headers]);
  assert.deepEqual(f.rows.get("Bad Call Leads"), [headers, ["other-id", "preserve"], ["call-1", "current"]]);
});

test("read quota deferral preserves stale membership until destination is confirmed", async () => {
  const f = fixture();
  const quota = { reserve: async () => ({ granted: false }) } as unknown as QuotaLimiter;
  const result = await writeBatchedTargets({ sheets: f.sheets, writes: f.writes, quota, ensureHeaders: false });
  assert.ok(result.every((outcome) => outcome.status === "deferred"));
  assert.equal(f.rows.get("Calls")!.length, 2);
  assert.equal(f.appends(), 0);
});

test("overlapping chain and source jobs append one physical row and retain both job outcomes", async () => {
  const f = fixture();
  const destination = f.writes.find((write) => write.op === "upsert")!;
  const overlapping = { ...destination, jobId: "chain-job" };
  const result = await writeBatchedTargets({ sheets: f.sheets, writes: [...f.writes, overlapping], quota: grant, ensureHeaders: false });
  assert.ok(result.every((outcome) => outcome.status === "synced"));
  assert.equal(f.appends(), 1);
  assert.equal(result.filter((outcome) => outcome.write.op === "upsert").length, 2);
  assert.equal(f.rows.get("Bad Call Leads")!.length, 2);
});

test("conflicting current payloads fail closed and preserve prior membership", async () => {
  const f = fixture();
  const destination = f.writes.find((write) => write.op === "upsert")!;
  const overlapping = { ...destination, jobId: "chain-job", row: ["call-1", "concurrent different value"] };
  const result = await writeBatchedTargets({ sheets: f.sheets, writes: [...f.writes, overlapping], quota: grant, ensureHeaders: false });
  assert.equal(result.filter((outcome) => outcome.status === "failed").length, 2);
  assert.equal(f.appends(), 0);
  assert.equal(f.rows.get("Calls")!.length, 2);
});
