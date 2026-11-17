import assert from "node:assert/strict";
import { test } from "node:test";
import type { CapacityDatabaseReading, CapacitySnapshotDocument } from "../../models/CapacitySnapshot";
import { forecastDatabase } from "./databaseForecast";
import { buildDatabaseCard, DATABASE_CACHE_MS } from "./capacity";

const DAY = 86_400_000;
const now = new Date("2026-11-17T12:00:00Z");
const reading: CapacityDatabaseReading = { fs_used_bytes: 500, fs_total_bytes: 10_000, data_bytes: 100, oplog_storage_bytes: 300, oplog_max_bytes: 200 };
function rows(values: number[]): Array<Omit<CapacitySnapshotDocument, "_id">> {
  return values.map((value, index) => ({ day: String(index), taken_at: new Date(now.getTime() - (values.length - 1 - index) * DAY),
    database: { ...reading, fs_used_bytes: value }, sheets: [] }));
}
const forecast = (history: ReturnType<typeof rows>, live = { ...reading, fs_used_bytes: history.at(-1)?.database?.fs_used_bytes ?? 500 }) =>
  forecastDatabase(history, live, live.fs_total_bytes, now, 4);

test("short history stays estimated and missing history is explicit", () => {
  assert.equal(forecast(rows([100, 200, 300])).long.runway.basis, "estimate");
  assert.equal(forecast(rows([100, 200, 300])).history_status, "insufficient");
  assert.equal(forecast([]).history_status, "missing");
});

test("recent growth acceleration is not diluted by the long window", () => {
  const history = rows([...Array.from({ length: 23 }, (_, i) => 100 + i), ...Array.from({ length: 7 }, (_, i) => 123 + i * 30)]);
  const result = forecast(history);
  assert.equal(result.selected_window, "recent");
  assert.equal(result.recent.runway.rate_per_day, 30);
  assert.ok(result.long.runway.rate_per_day < 30);
});

test("deceleration retains the more conservative long measured trend", () => {
  const result = forecast(rows([...Array.from({ length: 23 }, (_, i) => 100 + i * 30), ...Array.from({ length: 7 }, (_, i) => 790 + i)]));
  assert.equal(result.selected_window, "long");
  assert.ok(result.long.runway.rate_per_day > result.recent.runway.rate_per_day);
});

test("compaction-shaped drop restarts measurements instead of forecasting negative growth", () => {
  const result = forecast(rows([500, 510, 520, 530, 540, 550, 560, 200, 210]));
  assert.equal(result.segment_reason, "allocation_decrease");
  assert.equal(result.long.runway.points, 2);
  assert.equal(result.long.runway.basis, "estimate");
  const liveDrop = forecast(rows([500, 510, 520, 530, 540, 550, 560]), { ...reading, fs_used_bytes: 200 });
  assert.equal(liveDrop.long.runway.points, 0);
});

test("disk resize segments both saved history and a new live change", () => {
  const history = rows([100, 110, 120, 130, 140, 150, 160, 170]);
  history[7]!.database!.fs_total_bytes = 20_000;
  assert.equal(forecast(history, { ...reading, fs_used_bytes: 170, fs_total_bytes: 20_000 }).long.runway.points, 1);
  const result = forecast(rows([100, 110, 120, 130, 140, 150, 160]), { ...reading, fs_total_bytes: 20_000 });
  assert.equal(result.segment_reason, "resize");
  assert.equal(result.long.runway.points, 0);
});

test("stale, missing, invalid and repeated metrics cannot become measured history", () => {
  const history = rows([100, 110, 120, 130, 140, 150, 160]);
  const stale = history.map((row) => ({ ...row, taken_at: new Date(row.taken_at.getTime() - 3 * DAY) }));
  assert.equal(forecast(stale).history_status, "stale");
  assert.equal(forecast(stale).long.runway.basis, "estimate");
  assert.equal(forecast(history.map((row) => ({ ...row, database: null }))).history_status, "missing");
  assert.equal(forecast(history.map((row) => ({ ...row, database: { ...reading, data_bytes: NaN } }))).history_status, "missing");
  const duplicate = history.map((row) => ({ ...row, taken_at: now }));
  assert.equal(forecast(duplicate).long.runway.basis, "estimate");
});

test("flat files still expose allocated business growth during internal reuse", () => {
  const history = rows([500, 500, 500, 500, 500, 500, 500]);
  history.forEach((row, index) => { row.database!.data_bytes = 100 + index * 10; });
  const result = forecast(history, { ...reading, data_bytes: 160 });
  assert.equal(result.recent.source, "data");
  assert.equal(result.recent.runway.rate_per_day, 10);
});

test("divergent member readings never imply known cluster worst-member capacity", () => {
  const first = forecast([], reading);
  const second = forecast([], { ...reading, fs_used_bytes: 9_000 });
  assert.equal(first.scope, "connected_member");
  assert.equal(first.worst_member, null);
  assert.equal(second.worst_member, null);
  assert.notEqual(first.long.runway.days_left, second.long.runway.days_left);
});

test("cached stale and invalid database cards cannot show a healthy forecast", () => {
  const stale = buildDatabaseCard({ value: reading, at: now.getTime() - DATABASE_CACHE_MS - 1 }, [], now);
  assert.equal(stale.status.colour, "unknown");
  assert.equal(stale.until_full, null);
  const invalid = buildDatabaseCard({ value: { ...reading, fs_total_bytes: 0 }, at: now.getTime() }, [], now);
  assert.equal(invalid.status.colour, "unknown");
});

test("oplog logical cap and allocated bytes do not establish reclaimable space", () => {
  const card = buildDatabaseCard({ value: reading, at: now.getTime() }, [], now);
  assert.equal(card.breakdown, null, "legacy Admin cannot render an invented reclaimable number");
  assert.deepEqual(card.storage_evidence?.oplog_reclaimable_bytes, { basis: "unknown", value: null });
  assert.deepEqual(card.storage_evidence?.oplog_allocated_bytes, { basis: "measured", value: 300 });
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
