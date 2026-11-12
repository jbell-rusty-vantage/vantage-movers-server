import assert from "node:assert/strict";
import { test } from "node:test";
import type { sheets_v4 } from "googleapis";
import { writeBatchedTargets } from "./batchWriter";
import type { QuotaLimiter } from "./quotaLimiter";
import type { PlannedWrite } from "./types";
import { statefulWorkbook } from "./statefulWorkbook.fixture";
import { resetEnsuredTabsCache } from "../../googleSheets/tabs";
import { assertLeadTabWritesAllowed } from "../writerFence";

const headers = ["Mongo ID", "Name"];
const grant = { reserve: async () => ({ granted: true }) } as unknown as QuotaLimiter;
function recoveryWrite(op: PlannedWrite["op"], mongoId = "A", jobId = "job-A"): PlannedWrite {
  return { jobId, docKey: `CallLead:${mongoId}`, mongoId, target: "master_calls", spreadsheetId: "recovery", tabName: "Calls", headers, row: [mongoId, "current"], op };
}

test("committed append with lost response recovers both subscribers without a second append", async () => {
  const f = statefulWorkbook({ Calls: [headers] });
  const writes = [recoveryWrite("upsert"), recoveryWrite("upsert", "A", "chain-A")];
  f.fault("append", "after");
  const first = await writeBatchedTargets({ sheets: f.sheets, writes, quota: grant, ensureHeaders: false });
  assert.ok(first.every((outcome) => outcome.status !== "synced"));
  assert.equal(f.count("append"), 1);
  const recovered = await writeBatchedTargets({ sheets: f.sheets, writes, quota: grant, ensureHeaders: false });
  assert.ok(recovered.every((outcome) => outcome.status === "synced"));
  assert.deepEqual(recovered.map((outcome) => outcome.write.jobId), ["job-A", "chain-A"]);
  assert.equal(f.count("append"), 1);
  assert.deepEqual(f.rows.get("Calls"), [headers, ["A", "current"]]);
});

test("committed delete with lost response preserves its neighbor and never repeats the old position", async () => {
  const f = statefulWorkbook({ Calls: [headers, ["A", "old"], ["neighbor", "preserve"]] });
  const writes = [recoveryWrite("delete")];
  f.fault("delete", "after");
  const first = await writeBatchedTargets({ sheets: f.sheets, writes, quota: grant, ensureHeaders: false });
  assert.ok(first.every((outcome) => outcome.status !== "synced"));
  assert.equal(f.count("delete"), 1);
  const recovered = await writeBatchedTargets({ sheets: f.sheets, writes, quota: grant, ensureHeaders: false });
  assert.ok(recovered.every((outcome) => outcome.status === "synced"));
  assert.equal(f.count("delete"), 1);
  assert.deepEqual(f.rows.get("Calls"), [headers, ["neighbor", "preserve"]]);
});

for (const op of ["append", "delete"] as const) {
  test(`${op} rejected before committing is issued by the next drain and completes`, async () => {
    const f = statefulWorkbook({ Calls: [headers, ...(op === "delete" ? [["A", "old"], ["neighbor", "preserve"]] : [])] });
    const writes = [recoveryWrite(op === "append" ? "upsert" : "delete")];
    f.fault(op, "before");
    const first = await writeBatchedTargets({ sheets: f.sheets, writes, quota: grant, ensureHeaders: false });
    assert.ok(first.every((outcome) => outcome.status === "deferred"));
    assert.equal(f.count(op), 1);
    const second = await writeBatchedTargets({ sheets: f.sheets, writes, quota: grant, ensureHeaders: false });
    assert.ok(second.every((outcome) => outcome.status === "synced"));
    assert.equal(f.count(op), 2);
    assert.deepEqual(f.rows.get("Calls"), op === "append" ? [headers, ["A", "current"]] : [headers, ["neighbor", "preserve"]]);
  });
}

for (const fault of ["missing_confirmation", "malformed_confirmation", "transport"] as const) {
  test(`append ${fault} defers; a failed reconciliation read cannot cause another append`, async () => {
    const f = statefulWorkbook({ Calls: [headers] });
    const writes = [recoveryWrite("upsert")];
    f.fault("append", fault);
    const first = await writeBatchedTargets({ sheets: f.sheets, writes, quota: grant, ensureHeaders: false });
    assert.ok(first.every((outcome) => outcome.status === "deferred"));
    f.fault("read", "before", "before", "before", "before", "before", "before");
    const failedRead = await writeBatchedTargets({ sheets: f.sheets, writes, quota: grant, ensureHeaders: false });
    assert.ok(failedRead.every((outcome) => outcome.status !== "synced"));
    assert.equal(f.count("append"), 1);
    const healthy = await writeBatchedTargets({ sheets: f.sheets, writes, quota: grant, ensureHeaders: false });
    assert.ok(healthy.every((outcome) => outcome.status === "synced"));
    assert.equal(f.count("append"), 1);
    assert.deepEqual(f.rows.get("Calls"), [headers, ["A", "current"]]);
  });
}

test("delete with an uncertain transport result converges from a fresh identity read", async () => {
  const f = statefulWorkbook({ Calls: [headers, ["A", "old"], ["neighbor", "preserve"]] });
  const writes = [recoveryWrite("delete")];
  f.fault("delete", "transport");
  const first = await writeBatchedTargets({ sheets: f.sheets, writes, quota: grant, ensureHeaders: false });
  assert.ok(first.every((outcome) => outcome.status === "deferred"));
  const second = await writeBatchedTargets({ sheets: f.sheets, writes, quota: grant, ensureHeaders: false });
  assert.ok(second.every((outcome) => outcome.status === "synced"));
  assert.equal(f.count("delete"), 1);
  assert.deepEqual(f.rows.get("Calls"), [headers, ["neighbor", "preserve"]]);
});

for (const op of ["upsert", "delete"] as const) {
  test(`${op} cannot infer absence from missing or ambiguous identity headers`, async () => {
    for (const invalidRows of [[], [["Name"]], [["Mongo ID", "Mongo ID"]]]) {
      const f = statefulWorkbook({ Calls: invalidRows });
      const result = await writeBatchedTargets({ sheets: f.sheets, writes: [recoveryWrite(op)], quota: grant, ensureHeaders: false });
      assert.ok(result.every((outcome) => outcome.status !== "synced"));
      assert.equal(f.count("append") + f.count("delete") + f.count("update"), 0);
      assert.deepEqual(f.rows.get("Calls"), invalidRows);
    }
  });
}

test("cold header initialization cannot turn an invalid existing identity header into absence", async () => {
  resetEnsuredTabsCache();
  const f = statefulWorkbook({ Calls: [["ID", "Name"], ["A", "old"]] });
  const result = await writeBatchedTargets({ sheets: f.sheets, writes: [recoveryWrite("upsert")], quota: grant });
  assert.ok(result.every((outcome) => outcome.status !== "synced"));
  assert.equal(f.count("header") + f.count("append"), 0);
  assert.deepEqual(f.rows.get("Calls"), [["ID", "Name"], ["A", "old"]]);
});

test("confirmed newly created tabs can initialize headers; ordinary cold/warm batches keep one identity read", async () => {
  resetEnsuredTabsCache();
  const f = statefulWorkbook({});
  const writes = [recoveryWrite("upsert"), recoveryWrite("upsert", "B")];
  const first = await writeBatchedTargets({ sheets: f.sheets, writes, quota: grant });
  assert.ok(first.every((outcome) => outcome.status === "synced"));
  assert.equal(f.count("provision"), 1);
  assert.equal(f.count("header"), 1);
  assert.equal(f.count("read"), 1);
  assert.equal(f.count("append"), 1);
  const second = await writeBatchedTargets({ sheets: f.sheets, writes, quota: grant });
  assert.ok(second.every((outcome) => outcome.status === "synced"));
  assert.equal(f.count("read"), 2);
  assert.equal(f.count("header"), 1);
  assert.equal(f.count("append"), 1);
  assert.equal(f.count("update"), 1);
  assert.deepEqual(f.rows.get("Calls"), [headers, ["A", "current"], ["B", "current"]]);
});

test("shifted legacy Mongo ID lookup deletes the intended row and preserves unrelated rows", async () => {
  const f = statefulWorkbook({ Calls: [["Name", "Old field", "Mongo ID"], ["old", "legacy", "A"], ["neighbor", "legacy", "N"]] });
  const result = await writeBatchedTargets({ sheets: f.sheets, writes: [recoveryWrite("delete")], quota: grant, ensureHeaders: false });
  assert.ok(result.every((outcome) => outcome.status === "synced"));
  assert.deepEqual(f.rows.get("Calls"), [["Name", "Old field", "Mongo ID"], ["neighbor", "legacy", "N"]]);
});

test("warm header cache cannot authorize an upsert into a shifted identity layout", async () => {
  resetEnsuredTabsCache();
  const f = statefulWorkbook({ Calls: [headers, ["A", "old"]] });
  const writes = [recoveryWrite("upsert")];
  assert.ok((await writeBatchedTargets({ sheets: f.sheets, writes, quota: grant })).every((outcome) => outcome.status === "synced"));
  const legacy = [["Name", "Mongo ID"], ["legacy value", "A"]];
  f.rows.set("Calls", structuredClone(legacy));
  const result = await writeBatchedTargets({ sheets: f.sheets, writes, quota: grant });
  assert.ok(result.every((outcome) => outcome.status !== "synced"));
  assert.equal(f.count("update"), 1, "only the original correctly aligned update was sent");
  assert.equal(f.count("append"), 0);
  assert.deepEqual(f.rows.get("Calls"), legacy);
});

test("malformed topology response cannot prove that a delete tab is absent", async () => {
  const f = statefulWorkbook({ Calls: [headers, ["A", "old"]] });
  Object.defineProperty(f.sheets.spreadsheets, "get", { value: async () => ({ data: {} }) });
  const result = await writeBatchedTargets({ sheets: f.sheets, writes: [recoveryWrite("delete")], quota: grant, ensureHeaders: false });
  assert.ok(result.every((outcome) => outcome.status !== "synced"));
  assert.equal(f.count("delete"), 0);
  assert.deepEqual(f.rows.get("Calls"), [headers, ["A", "old"]]);
});

function singleRowChunks(t: { after: (fn: () => void) => void }) {
  const previous = process.env.SHEET_SYNC_MAX_ROWS_PER_BATCH;
  process.env.SHEET_SYNC_MAX_ROWS_PER_BATCH = "1";
  t.after(() => { if (previous === undefined) delete process.env.SHEET_SYNC_MAX_ROWS_PER_BATCH; else process.env.SHEET_SYNC_MAX_ROWS_PER_BATCH = previous; });
}

for (const op of ["append", "delete"] as const) {
  test(`${op} uncertainty stops later chunks while retaining confirmed earlier outcomes`, async (t) => {
    singleRowChunks(t);
    const f = statefulWorkbook({ Calls: [headers, ...(op === "delete" ? [["A", "old"], ["neighbor", "preserve"], ["B", "old"], ["C", "old"]] : [])] });
    const writes = ["A", "B", "C"].map((id) => recoveryWrite(op === "append" ? "upsert" : "delete", id));
    f.fault(op, "none", "after");
    const first = await writeBatchedTargets({ sheets: f.sheets, writes, quota: grant, ensureHeaders: false });
    assert.equal(f.count(op), 2);
    assert.equal(first.filter((outcome) => outcome.status === "synced").length, 1);
    assert.equal(first.filter((outcome) => outcome.status === "deferred").length, 2);
    const second = await writeBatchedTargets({ sheets: f.sheets, writes, quota: grant, ensureHeaders: false });
    assert.ok(second.every((outcome) => outcome.status === "synced"));
    assert.equal(f.count(op), 3);
    assert.deepEqual(f.rows.get("Calls"), op === "append" ? [headers, ["A", "current"], ["B", "current"], ["C", "current"]] : [headers, ["neighbor", "preserve"]]);
    assert.ok(f.requests.filter((request) => request.operation === op).every((request) => request.options?.retry === false));
  });
}

test("lost duplicate-cleanup response stops remaining deletions and preserves unrelated rows", async (t) => {
  singleRowChunks(t);
  const f = statefulWorkbook({ Calls: [headers, ["A", "old"], ["neighbor", "preserve"], ["A", "copy1"], ["A", "copy2"]] });
  const writes = [recoveryWrite("upsert")];
  f.fault("delete", "after");
  const first = await writeBatchedTargets({ sheets: f.sheets, writes, quota: grant, ensureHeaders: false });
  assert.ok(first.every((outcome) => outcome.status === "deferred"));
  assert.equal(f.count("delete"), 1);
  const second = await writeBatchedTargets({ sheets: f.sheets, writes, quota: grant, ensureHeaders: false });
  assert.ok(second.every((outcome) => outcome.status === "synced"));
  assert.equal(f.count("delete"), 2);
  assert.deepEqual(f.rows.get("Calls"), [headers, ["A", "current"], ["neighbor", "preserve"]]);
});

for (const stop of ["lease", "fence", "deadline", "quota"] as const) {
  test(`${stop} changing between chunks prevents new requests and later recovery converges`, async (t) => {
    singleRowChunks(t);
    const f = statefulWorkbook({ Calls: [headers] });
    const writes = [recoveryWrite("upsert"), recoveryWrite("upsert", "B")];
    let blocked = false;
    f.afterRequest((operation) => { if (operation === "append") blocked = true; });
    const quota = { reserve: async (operation: string) => ({ granted: !(stop === "quota" && blocked && operation === "write") }) } as unknown as QuotaLimiter;
    const first = await writeBatchedTargets({ sheets: f.sheets, writes, quota, ensureHeaders: false, requestChecks: {
      deadline: 10, now: () => stop === "deadline" && blocked ? 10 : 0,
      assertCanRequest: async () => {
        if (stop === "lease" && blocked) throw new Error("lease lost");
        if (stop === "fence") await assertLeadTabWritesAllowed({ lookup: async () => blocked ? { leased_until: new Date(Date.now() + 60_000) } : null });
      },
    } });
    assert.equal(f.count("append"), 1);
    assert.deepEqual(first.map((outcome) => outcome.status), ["synced", "deferred"]);
    const second = await writeBatchedTargets({ sheets: f.sheets, writes, quota: grant, ensureHeaders: false });
    assert.ok(second.every((outcome) => outcome.status === "synced"));
    assert.equal(f.count("append"), 2);
    assert.deepEqual(f.rows.get("Calls"), [headers, ["A", "current"], ["B", "current"]]);
  });
}

test("lease loss while reserving quota prevents the provider request", async () => {
  const f = statefulWorkbook({ Calls: [headers] });
  let owned = true;
  const quota = { reserve: async () => { owned = false; return { granted: true }; } } as unknown as QuotaLimiter;
  const result = await writeBatchedTargets({ sheets: f.sheets, writes: [recoveryWrite("upsert")], quota, ensureHeaders: false, requestChecks: {
    assertCanRequest: async () => { if (!owned) throw new Error("lease lost"); },
  } });
  assert.ok(result.every((outcome) => outcome.status === "deferred"));
  assert.equal(f.requests.length, 0);
});
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
  assert.ok(failed.some((outcome) => outcome.status !== "synced"));
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
  assert.ok(first.some((outcome) => outcome.status !== "synced"));
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
