import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { getFormLeadModel } from "../../../models/FormLead";
import type { SheetSyncEntry } from "../../../models/schemaHelpers";
import { logger } from "../../../logger";
import type { PlannedDoc } from "./jobPlanner";
import { persistDocSheetSync } from "./runSheetSyncDrain";
import type { PlannedWriteOutcome } from "./types";

const Forms = getFormLeadModel();
const entry = (target: string): SheetSyncEntry => ({
  target, spreadsheet_id: "synthetic", tab_name: target, status: "synced",
  row_number: 2, updated_since_last_sync: false, last_synced_at: new Date(0),
});
function planned(id: mongoose.Types.ObjectId, existing: SheetSyncEntry[] = []): PlannedDoc {
  return { docKey: `FormLead:${id}`, doc: new Forms({ _id: id, sheet_sync: existing }), writes: [] };
}
function outcome(plan: PlannedDoc, jobId: string, target = "master_forms", status: PlannedWriteOutcome["status"] = "synced", op: "upsert" | "delete" = "upsert"): PlannedWriteOutcome {
  return {
    write: { jobId, docKey: plan.docKey, mongoId: plan.docKey.split(":")[1]!, target,
      spreadsheetId: "synthetic", tabName: target, headers: ["Mongo ID"], row: [], op },
    status, action: op === "delete" ? "delete" : "update", rowNumber: 3, readsUsed: 1, writesUsed: 1,
    ...(status !== "synced" ? { error: `synthetic ${status}` } : {}),
  };
}

test("overlapping plans persist once using the last surviving snapshot and final-write order", async (t) => {
  const id = new mongoose.Types.ObjectId();
  const first = planned(id, [entry("old_snapshot_only"), entry("stale_target")]);
  const other = planned(new mongoose.Types.ObjectId());
  const last = planned(id, [entry("new_snapshot_only"), entry("stale_target")]);
  const writes: { id: string; entries: SheetSyncEntry[] }[] = [];
  t.mock.method(Forms, "updateOne", async (filter: { _id: mongoose.Types.ObjectId }, update: { $set: { sheet_sync: SheetSyncEntry[] } }) => {
    writes.push({ id: filter._id.toString(), entries: update.$set.sheet_sync });
    return { matchedCount: 1 };
  });
  let ownershipChecks = 0;
  const outcomes = [outcome(first, "source"), outcome(other, "other"), outcome(last, "booking"),
    outcome(last, "cancellation", "stale_target", "synced", "delete")];
  const before = Date.now();
  const returned = await persistDocSheetSync([first, other, last, { docKey: last.docKey, writes: [] }], outcomes, async () => { ownershipChecks++; });
  assert.strictEqual(returned, outcomes, "logical subscribers/outcome identity remain untouched");
  assert.equal(writes.length, 2, "one update per surviving physical document");
  assert.equal(ownershipChecks, 2, "each actual write still checks drain ownership");
  assert.deepEqual(writes.map((write) => write.id), [other.doc!._id.toString(), id.toString()]);
  assert.deepEqual(writes[1]!.entries.map((value) => value.target), ["new_snapshot_only", "master_forms"]);
  assert.equal(writes[1]!.entries[0]!.last_synced_at!.getTime(), 0, "untouched target keeps its timestamp");
  const synced = writes[1]!.entries[1]!;
  assert.equal(synced.row_number, 3);
  assert.equal(synced.updated_since_last_sync, false);
  assert.equal(synced.last_error, undefined);
  assert.ok(synced.last_synced_at!.getTime() >= before);
  assert.ok(synced.last_synced_at! >= writes[0]!.entries[0]!.last_synced_at!);
});

for (const failure of ["throw", "empty_message", "missing_document"] as const) {
  test(`one metadata ${failure} fails every confirmed subscriber while preserving failed/deferred outcomes`, async (t) => {
    const plan = planned(new mongoose.Types.ObjectId());
    let calls = 0;
    t.mock.method(logger, "warn", () => {});
    t.mock.method(Forms, "updateOne", async () => {
      calls++;
      if (failure === "throw") throw new Error("synthetic persistence failure");
      if (failure === "empty_message") throw new Error();
      return { matchedCount: 0 };
    });
    const outcomes = [outcome(plan, "source"), outcome(plan, "booking"),
      outcome(plan, "cancel", "stale", "synced", "delete"),
      outcome(plan, "already_failed", "failed", "failed"), outcome(plan, "uncertain", "pending", "deferred")];
    const returned = await persistDocSheetSync([plan, plan, plan], outcomes, async () => {});
    assert.equal(calls, 1);
    assert.deepEqual(returned.map((value) => value.status), ["failed", "failed", "failed", "failed", "deferred"]);
    assert.ok(returned.slice(0, 3).every((value) => value.error?.startsWith("sheet_sync metadata persist failed:")));
    assert.strictEqual(returned[3], outcomes[3]);
    assert.strictEqual(returned[4], outcomes[4]);
    assert.deepEqual(returned.map((value) => value.write.jobId), outcomes.map((value) => value.write.jobId));
  });
}

test("all target outcomes merge in original order and uncertainty clears row hints", async (t) => {
  const plan = planned(new mongoose.Types.ObjectId(), [entry("stale"), entry("keep")]);
  let persisted: SheetSyncEntry[] = [];
  t.mock.method(Forms, "updateOne", async (_filter: object, update: { $set: { sheet_sync: SheetSyncEntry[] } }) => {
    persisted = update.$set.sheet_sync;
    return { matchedCount: 1 };
  });
  const outcomes = [outcome(plan, "first"), outcome(plan, "last", "master_forms", "deferred"),
    outcome(plan, "bad", "master_bad_forms", "failed"), outcome(plan, "delete", "stale", "synced", "delete")];
  await persistDocSheetSync([plan, plan], outcomes, async () => {});
  assert.deepEqual(persisted.map((value) => value.target), ["keep", "master_forms", "master_bad_forms"]);
  assert.equal(persisted[1]!.status, "pending");
  assert.equal(persisted[1]!.row_number, undefined);
  assert.equal(persisted[1]!.last_error, "synthetic deferred");
  assert.equal(persisted[1]!.updated_since_last_sync, true);
  assert.equal(persisted[2]!.status, "failed");
});

test("tombstones, no outcomes and unconfirmed deletes need no metadata write", async (t) => {
  const plan = planned(new mongoose.Types.ObjectId());
  const writes = t.mock.method(Forms, "updateOne", () => { throw new Error("unexpected metadata write"); });
  await persistDocSheetSync([{ docKey: plan.docKey, writes: [] }], [outcome(plan, "tombstone", "master_forms", "synced", "delete")], async () => {});
  await persistDocSheetSync([plan], [], async () => {});
  await persistDocSheetSync([plan, plan], [outcome(plan, "uncertain-delete", "master_forms", "deferred", "delete")], async () => {});
  assert.equal(writes.mock.callCount(), 0);
});

test("lease loss prevents metadata writes and propagates to drain recovery", async (t) => {
  const plan = planned(new mongoose.Types.ObjectId());
  const writes = t.mock.method(Forms, "updateOne", () => { throw new Error("unexpected metadata write"); });
  await assert.rejects(persistDocSheetSync([plan, plan], [outcome(plan, "source")], async () => { throw new Error("lost lease"); }), /lost lease/);
  assert.equal(writes.mock.callCount(), 0);
});
