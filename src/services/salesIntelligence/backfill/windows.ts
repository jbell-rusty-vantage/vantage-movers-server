import { csiBackfillDays } from "../../../config/domain/salesIntelligence";

export const CALL_LOG_BACKFILL_STREAM = "call_log";
export const MS_PER_DAY = 86_400_000;

export type PlannedWindow = { stream: string; window_from: Date; window_to: Date };

/** Split [from, to) into consecutive 24-hour windows, oldest first, capped by BACKFILL_DAYS from `to`. */
export function planDailyWindows(from: Date, to: Date, days = csiBackfillDays()): PlannedWindow[] {
  if (!(from < to) || days <= 0) return [];
  const capStart = new Date(to.getTime() - days * MS_PER_DAY);
  const start = from > capStart ? from : capStart;
  const windows: PlannedWindow[] = [];
  for (let cursor = start.getTime(); cursor < to.getTime(); cursor += MS_PER_DAY) {
    const window_from = new Date(cursor);
    const window_to = new Date(Math.min(cursor + MS_PER_DAY, to.getTime()));
    if (window_from < window_to) windows.push({ stream: CALL_LOG_BACKFILL_STREAM, window_from, window_to });
  }
  return windows;
}
