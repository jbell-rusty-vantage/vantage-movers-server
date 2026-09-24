import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyAgainstStored, dayWindows, recordRecordingIds } from "./call-log-repair";
import { inboundConnectedCallLog } from "../../../src/services/numberActivity/fixtures";

test("classification mirrors diff-call-log-vs-interactions: MISSING, STALE reasons, unchanged", () => {
  const record = inboundConnectedCallLog("s-1");
  assert.deepEqual(recordRecordingIds(record), ["rec-s-1-1", "rec-s-1-1"]);
  assert.deepEqual(classifyAgainstStored(record, null), { kind: "MISSING", reasons: ["not_stored"] });
  const final = { _id: "x", provider_result: "Call connected", duration_seconds: 95, provider_last_modified_at: new Date(record.lastModifiedTime),
    recordings: [{ provider_recording_id: "rec-s-1-1" }] };
  assert.deepEqual(classifyAgainstStored(record, final), { kind: "unchanged", reasons: [] });
  const snapshot = { _id: "x", provider_result: "Stopped", duration_seconds: 0, provider_last_modified_at: new Date(Date.parse(record.lastModifiedTime) - 60_000), recordings: [] };
  assert.deepEqual(classifyAgainstStored(record, snapshot), { kind: "STALE",
    reasons: ["provider_newer_than_stored", "result_differs", "duration_differs", "recording_missing_in_store"] });
});

test("24 h windows from --from; the last one ends at --to", () => {
  const windows = dayWindows(new Date("2026-09-20T00:00:00Z"), new Date("2026-09-22T06:00:00Z"));
  assert.deepEqual(windows.map(w => [w.day, w.from.toISOString(), w.to.toISOString()]), [
    ["2026-09-20", "2026-09-20T00:00:00.000Z", "2026-09-21T00:00:00.000Z"],
    ["2026-09-21", "2026-09-21T00:00:00.000Z", "2026-09-22T00:00:00.000Z"],
    ["2026-09-22", "2026-09-22T00:00:00.000Z", "2026-09-22T06:00:00.000Z"],
  ]);
  assert.throws(() => dayWindows(new Date("2026-09-22T00:00:00Z"), new Date("2026-09-21T00:00:00Z")));
});
