import type { CapacityDatabaseReading, CapacitySnapshotDocument } from "../../models/CapacitySnapshot";
import { leastSquaresSlopePerDay, projectRunway, type Runway } from "./runway";

const DAY_MS = 86_400_000;
export const FORECAST_MAX_AGE_MS = 2 * DAY_MS;
type Snapshot = Omit<CapacitySnapshotDocument, "_id">;
type Source = "disk" | "data";
export type DatabaseForecast = {
  recent: { runway: Runway; source: Source };
  long: { runway: Runway; source: Source };
  selected_window: "recent" | "long";
  segment_started_at: string | null;
  segment_reason: "resize" | "allocation_decrease" | "measurement_gap" | null;
  history_status: "measured" | "insufficient" | "stale" | "missing";
  /** db.stats does not establish worst-member capacity. Never treat this as a cluster forecast. */
  estimate_rate_source: "prior_segment" | "historical_seed";
  scope: "connected_member";
  worst_member: null;
};

export function validDatabaseReading(reading: CapacityDatabaseReading): boolean {
  return [reading.fs_used_bytes, reading.data_bytes, reading.oplog_storage_bytes, reading.oplog_max_bytes]
    .every((value) => Number.isFinite(value) && value >= 0)
    && Number.isFinite(reading.fs_total_bytes) && reading.fs_total_bytes > 0;
}

/** Drops are boundaries, not negative growth evidence; a drop alone does not prove compaction. */
export function forecastDatabase(
  rows: Snapshot[], reading: CapacityDatabaseReading, limit: number, now: Date, seedRatePerDay: number,
): DatabaseForecast {
  const ordered = rows.filter((row) => row.database && validDatabaseReading(row.database)
    && Number.isFinite(new Date(row.taken_at).getTime()) && new Date(row.taken_at) <= now)
    .sort((a, b) => new Date(a.taken_at).getTime() - new Date(b.taken_at).getTime());
  let priorRate = seedRatePerDay;
  const retainPriorRate = (samples: Snapshot[]) => {
    for (const size of [7, 30]) {
      const window = samples.slice(-size);
      if (window.length < 7) continue;
      for (const metric of ["fs_used_bytes", "data_bytes"] as const) {
        priorRate = Math.max(priorRate, leastSquaresSlopePerDay(window.map((row) => ({ at: new Date(row.taken_at), value: row.database![metric] }))));
      }
    }
  };
  let segment: Snapshot[] = [];
  let reason: DatabaseForecast["segment_reason"] = null;
  let startedAt: string | null = null;
  const boundary = (before: CapacityDatabaseReading, after: CapacityDatabaseReading) =>
    before.fs_total_bytes !== after.fs_total_bytes ? "resize" as const
      : after.fs_used_bytes < before.fs_used_bytes || after.data_bytes < before.data_bytes
        ? "allocation_decrease" as const : null;
  for (const row of ordered) {
    const previous = segment.at(-1);
    const changed = previous && (boundary(previous.database!, row.database!)
      ?? (new Date(row.taken_at).getTime() - new Date(previous.taken_at).getTime() > FORECAST_MAX_AGE_MS ? "measurement_gap" : null));
    if (changed) { retainPriorRate(segment); segment = []; reason = changed; }
    if (!segment.length) startedAt = new Date(row.taken_at).toISOString();
    segment.push(row);
  }
  const last = segment.at(-1);
  const stale = !!last && now.getTime() - new Date(last.taken_at).getTime() > FORECAST_MAX_AGE_MS;
  const liveBoundary = last && boundary(last.database!, reading);
  if (liveBoundary || stale) {
    retainPriorRate(segment);
    segment = [];
    reason = liveBoundary ?? "measurement_gap";
    startedAt = now.toISOString();
  }
  // Deduplicate timestamps so repeated measurements cannot manufacture seven daily observations.
  segment = segment.filter((row, index, all) => index === all.findIndex((other) =>
    new Date(other.taken_at).toISOString().slice(0, 10) === new Date(row.taken_at).toISOString().slice(0, 10)));
  const project = (window: Snapshot[]) => {
    const options = { seedRatePerDay: priorRate, capYears: 5, current: reading.fs_used_bytes };
    const disk = projectRunway(window.map((row) => ({ at: new Date(row.taken_at), value: row.database!.fs_used_bytes })), limit, now, options);
    // Use allocated business growth against the same headroom while files reuse internal free pages.
    const data = projectRunway(window.map((row) => ({ at: new Date(row.taken_at), value: row.database!.data_bytes })),
      limit - reading.fs_used_bytes + reading.data_bytes, now, { ...options, current: reading.data_bytes });
    return data.basis === "measured" && data.rate_per_day > disk.rate_per_day
      ? { runway: data, source: "data" as const } : { runway: disk, source: "disk" as const };
  };
  const recent = project(segment.filter((row) => now.getTime() - new Date(row.taken_at).getTime() <= 7 * DAY_MS).slice(-7));
  const long = project(segment.filter((row) => now.getTime() - new Date(row.taken_at).getTime() <= 30 * DAY_MS).slice(-30));
  const selected_window = recent.runway.basis === "measured"
    && (long.runway.basis !== "measured" || recent.runway.rate_per_day >= long.runway.rate_per_day) ? "recent" : "long";
  return { recent, long, selected_window, segment_started_at: startedAt, segment_reason: reason,
    history_status: stale ? "stale" : !ordered.length ? "missing" : long.runway.basis === "measured" ? "measured" : "insufficient",
    estimate_rate_source: priorRate > seedRatePerDay ? "prior_segment" : "historical_seed",
    scope: "connected_member", worst_member: null };
}
