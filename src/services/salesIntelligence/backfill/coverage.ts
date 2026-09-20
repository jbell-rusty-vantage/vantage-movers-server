import { csiBackfillDays } from "../../../config/domain/salesIntelligence";
import { getSalesIntelligenceSyncWindowModel } from "../../../models/SalesIntelligenceSyncWindow";
import { getSalesIntelligenceSyncStateModel } from "../../../models/SalesIntelligenceSyncState";
import { CALL_LOG_BACKFILL_STREAM } from "./windows";

export const BACKFILL_UNAVAILABLE_NOTE =
  "Historical backfill is Owner-triggered and range-limited. It is lower priority than current work. Default BACKFILL_DAYS=0 plans nothing.";
const COVERAGE_WINDOW_LIMIT = 500;

/** The watermark is a captured upper bound; explicit gaps prevent a claim of continuous coverage. */
export async function readBackfillCoverage() {
  const days = csiBackfillDays(), Window = getSalesIntelligenceSyncWindowModel();
  const counts = await Window.aggregate<{ _id: string; count: number }>([
    { $match: { stream: CALL_LOG_BACKFILL_STREAM } }, { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);
  const total = counts.reduce((sum, row) => sum + row.count, 0);
  const count = (status: string) => counts.find(row => row._id === status)?.count ?? 0;
  const rows = await Window.find({ stream: CALL_LOG_BACKFILL_STREAM },
    { status: 1, window_from: 1, window_to: 1, last_error_code: 1 }).sort({ window_from: 1 }).limit(COVERAGE_WINDOW_LIMIT).lean();
  const watermark = await getSalesIntelligenceSyncStateModel().findOne({ scope: "backfill:call_log" }).lean();
  const pendingActivation = await Window.countDocuments({ stream: CALL_LOG_BACKFILL_STREAM, status: "complete", activation_status: { $ne: "complete" } });
  const gaps: { from: string; to: string; reason: string }[] = [];
  let previousEnd: Date | null = null;
  for (const row of rows) {
    if (previousEnd && row.window_from > previousEnd) gaps.push({ from: previousEnd.toISOString(), to: row.window_from.toISOString(), reason: "unplanned_range" });
    if (row.status !== "complete") gaps.push({ from: row.window_from.toISOString(), to: row.window_to.toISOString(), reason: row.last_error_code ?? row.status });
    if (!previousEnd || row.window_to > previousEnd) previousEnd = row.window_to;
  }
  let note = total ? "Exact stored window counts. The capture watermark is an upper bound; consult gaps for incomplete ranges." :
    days > 0 ? "No windows are stored yet; coverage is unknown, not zero history." : BACKFILL_UNAVAILABLE_NOTE;
  if (total > COVERAGE_WINDOW_LIMIT) note += " Gaps list covers only the earliest 500 windows; additional ranges may be incomplete.";
  if (pendingActivation) note += ` ${pendingActivation} captured windows await historical Outreach activation.`;
  return { available: days > 0, owner_triggered: true as const, days,
    planned: total ? count("planned") : null, partial: total ? count("partial") + count("running") : null,
    complete: total ? count("complete") : null, failed: total ? count("failed") : null,
    known_complete_through: watermark?.known_complete_through?.toISOString() ?? null, gaps, note };
}
