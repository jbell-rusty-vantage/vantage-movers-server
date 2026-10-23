import { getDailyOperationsEventModel } from "../../models/DailyOperationsEvent";
import { FLORIDA_TIME_ZONE } from "../../utils/easternTime";
import { easternDayKey } from "./dayDocument";
import { projectDailyOperationsEventItem, type DailyOperationsEventItem, type DailyOperationsEventRow } from "./eventsPage";
import { getDailyOperationsSnapshot, type DailyOperationsSnapshot } from "./snapshot";
import { DAILY_OPERATIONS_POLL_AFTER_MS, getCachedDailyOperationsReadView, type DailyOperationsReadViewStore } from "./readViewCache";

export type DailyOperationsBoardPayload = {
  snapshot: DailyOperationsSnapshot; events: DailyOperationsEventItem[]; milestones: DailyOperationsEventItem[];
  truncation: { events: boolean; milestones: boolean };
};
export type DailyOperationsBoard = DailyOperationsBoardPayload & {
  schema_version: 2; day: string; timezone: typeof FLORIDA_TIME_ZONE;
  revision: number; generated_at: string; freshness: "fresh" | "stale"; poll_after_ms: number;
};
async function eventPage(day: string, milestones: boolean): Promise<DailyOperationsEventItem[]> {
  const limit = milestones ? 51 : 81;
  const rows = await getDailyOperationsEventModel().find({ day, ...(milestones ? {
    kind: { $in: ["outreach.rep_goal_met", "outreach.team_goal_met"] },
  } : {}) }).sort({ occurred_at: -1, _id: -1 }).limit(limit).maxTimeMS(3000).lean().exec();
  return rows.map((row) => projectDailyOperationsEventItem(row as DailyOperationsEventRow));
}
export async function getDailyOperationsBoard(deps: {
  now?: () => Date; stores?: DailyOperationsReadViewStore;
  getSnapshot?: typeof getDailyOperationsSnapshot;
  listEvents?: (day: string, milestones: boolean) => Promise<DailyOperationsEventItem[]>;
} = {}): Promise<DailyOperationsBoard> {
  const now = deps.now ?? (() => new Date());
  const buildInstant = now();
  const day = easternDayKey(buildInstant);
  const view = await getCachedDailyOperationsReadView({
    scope: "dailyops_core", intervalMs: DAILY_OPERATIONS_POLL_AFTER_MS, now, stores: deps.stores, day,
    build: async (): Promise<DailyOperationsBoardPayload> => {
      const [snapshot, events, milestones] = await Promise.all([
        (deps.getSnapshot ?? getDailyOperationsSnapshot)({ now: () => buildInstant }),
        (deps.listEvents ?? eventPage)(day, false),
        (deps.listEvents ?? eventPage)(day, true),
      ]);
      return { snapshot, events: events.slice(0, 80), milestones: milestones.slice(0, 50), truncation: { events: events.length > 80, milestones: milestones.length > 50 } };
    },
  });
  return { ...view.payload, schema_version: 2, day, timezone: FLORIDA_TIME_ZONE, revision: view.revision, generated_at: view.generated_at, freshness: view.freshness, poll_after_ms: DAILY_OPERATIONS_POLL_AFTER_MS };
}
