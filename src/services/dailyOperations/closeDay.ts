import { getDailyOperationsDayModel } from "../../models/DailyOperationsDay";
import { easternDayKey } from "./dayDocument";

export type CloseDailyOperationsDayResult = {
  today: string;
  closed_days: string[];
  already_closed: boolean;
};

export type CloseDailyOperationsDayDeps = {
  now?: () => Date;
  closeOpenDaysBefore?: (
    today: string,
    closedAt: Date,
  ) => Promise<string[]>;
};

/**
 * Closes every open Daily Operations day whose `day` is before today NY.
 * Idempotent when yesterday (and any older open day) is already closed.
 */
export async function closeDailyOperationsDay(
  deps: CloseDailyOperationsDayDeps = {},
): Promise<CloseDailyOperationsDayResult> {
  const now = deps.now?.() ?? new Date();
  const today = easternDayKey(now);
  const closeOpenDaysBefore =
    deps.closeOpenDaysBefore ?? defaultCloseOpenDaysBefore;
  const closedDays = await closeOpenDaysBefore(today, now);
  return {
    today,
    closed_days: closedDays,
    already_closed: closedDays.length === 0,
  };
}

async function defaultCloseOpenDaysBefore(
  today: string,
  closedAt: Date,
): Promise<string[]> {
  const Day = getDailyOperationsDayModel();
  const open = await Day.find({ day: { $lt: today }, status: "open" })
    .select("day")
    .lean()
    .exec();
  if (open.length === 0) return [];
  const days = open.map((row) => row.day);
  await Day.updateMany(
    { day: { $in: days }, status: "open" },
    { $set: { status: "closed", closed_at: closedAt } },
  );
  return days;
}
