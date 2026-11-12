import type { Db } from "mongodb";

export type ShadowDay = {
  _id: string;
  qualified?: number;
  read_comparisons?: number;
  mismatches?: number;
  failures?: number;
  ttl_stamped?: number;
  mode?: string;
};
const DAY = 86400000;

/** Seven complete UTC days after arming. Missing evidence or any failed batch keeps shadow active. */
export function qualifiedShadowWeek(
  now: Date,
  armedAt: Date,
  days: readonly ShadowDay[],
) {
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  if (+armedAt > today - 7 * DAY) return false;
  for (let i = 1; i <= 7; i++) {
    const date = new Date(today - i * DAY).toISOString().slice(0, 10);
    const d = days.find((x) => x._id === date);
    if (
      !d ||
      d.mode !== "shadow" ||
      !(Number(d.qualified) >= 100) ||
      !(Number(d.read_comparisons) >= 3) ||
      d.ttl_stamped !== 0 ||
      Number(d.failures ?? 0) !== 0 ||
      Number(d.mismatches ?? 0) !== 0
    )
      return false;
  }
  return true;
}
export async function canPromoteFuture(db: Db, now: Date, armedAt: Date) {
  const days = await db
    .collection<ShadowDay>("granot_retention_days")
    .find({ _id: { $lt: now.toISOString().slice(0, 10) } })
    .sort({ _id: -1 })
    .limit(7)
    .toArray();
  return qualifiedShadowWeek(now, armedAt, days);
}
