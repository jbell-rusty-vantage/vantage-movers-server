import assert from "node:assert/strict";
import { test } from "node:test";
import type { CapacityDatabaseReading, CapacitySnapshotDocument } from "../../models/CapacitySnapshot";
import { forecastDatabase } from "./databaseForecast";

const DAY = 86_400_000;
const now = new Date("2026-11-17T12:00:00Z");
const reading: CapacityDatabaseReading = { fs_used_bytes: 500, fs_total_bytes: 10_000, data_bytes: 100, oplog_storage_bytes: 300, oplog_max_bytes: 200 };
function rows(values: number[]): Array<Omit<CapacitySnapshotDocument, "_id">> {
  return values.map((value, index) => ({ day: String(index), taken_at: new Date(now.getTime() - (values.length - 1 - index) * DAY),
    database: { ...reading, fs_used_bytes: value }, sheets: [] }));
}
const forecast = (history: ReturnType<typeof rows>, live = { ...reading, fs_used_bytes: history.at(-1)?.database?.fs_used_bytes ?? 500 }) =>
  forecastDatabase(history, live, live.fs_total_bytes, now, 4);

test("recent growth acceleration is not diluted by the long window", () => {
  const history = rows([...Array.from({ length: 23 }, (_, i) => 100 + i), ...Array.from({ length: 7 }, (_, i) => 123 + i * 30)]);
  const result = forecast(history);
  assert.equal(result.selected_window, "recent");
  assert.equal(result.recent.runway.rate_per_day, 30);
  assert.ok(result.long.runway.rate_per_day < 30);
});

test("compaction-shaped drop restarts measurements instead of forecasting negative growth", () => {
  const result = forecast(rows([500, 510, 520, 530, 540, 550, 560, 200, 210]));
  assert.equal(result.segment_reason, "allocation_decrease");
  assert.equal(result.long.runway.points, 2);
  assert.equal(result.long.runway.basis, "estimate");
  const liveDrop = forecast(rows([500, 510, 520, 530, 540, 550, 560]), { ...reading, fs_used_bytes: 200 });
  assert.equal(liveDrop.long.runway.points, 0);
});

test("divergent member readings never imply known cluster worst-member capacity", () => {
  const first = forecast([], reading);
  const second = forecast([], { ...reading, fs_used_bytes: 9_000 });
  assert.equal(first.scope, "connected_member");
  assert.equal(first.worst_member, null);
  assert.equal(second.worst_member, null);
  assert.notEqual(first.long.runway.days_left, second.long.runway.days_left);
});

test("a small live allocation dip cannot replace measured rapid growth with an optimistic seed", () => {
  const history = rows([100, 350, 600, 850, 1100, 1350, 1600]);
  const result = forecast(history, { ...reading, fs_used_bytes: 1599 });
  assert.equal(result.segment_reason, "allocation_decrease");
  assert.equal(result.long.runway.basis, "estimate", "old slope is not measured post-change");
  assert.equal(result.long.runway.rate_per_day, 250);
  assert.equal(result.estimate_rate_source, "prior_segment");
  const repeated = forecast(rows([100, 350, 600, 850, 1100, 1350, 1600, 1599, 1700, 1699]));
  assert.equal(repeated.long.runway.rate_per_day, 250);
});
