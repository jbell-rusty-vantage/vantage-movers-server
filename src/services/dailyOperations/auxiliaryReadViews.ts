import { getDailyLeadSpend } from "../insights";
import { salesOutreachConfigurationLoader } from "../salesOutreach/config/load";
import { readDailyOperationsGoalSummary } from "../salesOutreach/reads/service";
import { getCachedDailyOperationsReadView, type DailyOperationsReadViewStore } from "./readViewCache";

export const DAILY_OPERATIONS_AUXILIARY_INTERVAL_MS = 300_000;
type AuxiliaryDeps = { now?: () => Date; stores?: DailyOperationsReadViewStore };

/** Permission-safe shared goal projection, excluding Owner-only footnotes and operational queue reads. */
export async function getDailyOperationsGoalSummary(deps: AuxiliaryDeps = {}) {
  const cached = await getCachedDailyOperationsReadView({
    scope: "dailyops_goals", intervalMs: DAILY_OPERATIONS_AUXILIARY_INTERVAL_MS,
    now: deps.now, stores: deps.stores,
    build: () => readDailyOperationsGoalSummary({ loader: salesOutreachConfigurationLoader, now: deps.now?.() ?? new Date() }),
  });
  return { ...cached.payload, generated_at: cached.generated_at, freshness: cached.freshness, revision: cached.revision };
}

/** Owner-only route is guarded before touching this separate financial view. */
export async function getDailyOperationsLeadSpend(deps: AuxiliaryDeps = {}) {
  const cached = await getCachedDailyOperationsReadView({
    scope: "dailyops_owner_spend", intervalMs: DAILY_OPERATIONS_AUXILIARY_INTERVAL_MS,
    now: deps.now, stores: deps.stores,
    build: () => getDailyLeadSpend(deps.now?.() ?? new Date()),
  });
  return { ...cached.payload, generated_at: cached.generated_at, freshness: cached.freshness, revision: cached.revision };
}
