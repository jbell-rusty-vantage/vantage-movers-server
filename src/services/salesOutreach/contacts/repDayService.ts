import mongoose, { type ClientSession } from "mongoose";
import { OUTREACH_CONTACT_CALLS_SCOPE } from "../../../config/domain/salesOutreachContacts";
import { getSalesIntelligenceSyncStateModel } from "../../../models/SalesIntelligenceSyncState";
import type { SalesOutreachGoalCountScope } from "../../../config/domain/salesOutreach";
import { getSalesOutreachContactEventModel, getSalesOutreachRepDayProjectionModel } from "../../../models/salesOutreach";
import { CALL_LOG_ALL_DIRECTIONS_SCOPE } from "../../numberActivity/reconcileCallLog";
import type { ActiveConfiguration } from "../config/load";
import { newYorkBusinessDay } from "../reads/businessDay";
import type { RepDayKey } from "./apply";
import { composeRepDayRow, countScopeForDay, type CoverageWatermarks, type GoalSnapshot, type RepDayEventFacts, type RepDayRowFields } from "./repDay";

/** Events of one rep-day are bounded by a day's dialing; the cap only guards a corrupt day. */
const MAX_REP_DAY_EVENTS = 5000;
const MAX_REFRESH_ROWS = 1000;

export type StoredRepDay = Readonly<{
  goal_snapshot: GoalSnapshot | null;
  input_fingerprint: string;
  publication_revision: number;
  revision: number;
  coverage_state: string | null;
  /** The scope the row was counted under (olr C1a: a differing configured scope rewrites the row). */
  count_scope: SalesOutreachGoalCountScope | null;
}>;

export type RepDayRefreshRow = Readonly<{
  agent_id: string;
  coverage_state: string | null;
  frozen: boolean;
  count_scope: SalesOutreachGoalCountScope | null;
}>;

export type RepDayStore = {
  events(key: RepDayKey, session: ClientSession): Promise<RepDayEventFacts[]>;
  readRow(key: RepDayKey, session: ClientSession): Promise<StoredRepDay | null>;
  writeRow(fields: RepDayRowFields, previous: StoredRepDay | null, now: Date, session: ClientSession): Promise<number>;
  watermarks(session: ClientSession): Promise<CoverageWatermarks>;
  /** Rows of a day (refresh pass): agent id, coverage state, whether the goal is frozen and the stored count scope. */
  rowsOfDay(day: string): Promise<RepDayRefreshRow[]>;
};

const oid = (id: string) => new mongoose.Types.ObjectId(id);

export const mongoRepDayStore: RepDayStore = {
  async events(key, session) {
    const rows = await getSalesOutreachContactEventModel()
      .find({ goal_agent_id: oid(key.agent_id), business_date: key.business_day }, { source_id: 1, goal_credit: 1, goal_scope_eligible: 1 })
      .limit(MAX_REP_DAY_EVENTS)
      .session(session)
      .lean();
    return (rows as unknown as Array<{ source_id: unknown; goal_credit: RepDayEventFacts["goal_credit"]; goal_scope_eligible?: boolean }>).map((row) => ({
      source_id: String(row.source_id),
      goal_credit: row.goal_credit,
      goal_scope_eligible: row.goal_scope_eligible ?? false,
    }));
  },

  async readRow(key, session) {
    const row = (await getSalesOutreachRepDayProjectionModel()
      .findOne({ agent_id: oid(key.agent_id), business_day: key.business_day }, { goal_snapshot: 1, input_fingerprint: 1, publication_revision: 1, revision: 1, coverage: 1, count_scope: 1 })
      .session(session)
      .lean()) as unknown as {
      goal_snapshot?: GoalSnapshot | null;
      input_fingerprint: string;
      publication_revision: number;
      revision: number;
      coverage?: { state?: string } | null;
      count_scope?: SalesOutreachGoalCountScope | null;
    } | null;
    if (!row) return null;
    return {
      goal_snapshot: row.goal_snapshot ?? null,
      input_fingerprint: row.input_fingerprint,
      publication_revision: row.publication_revision ?? 0,
      revision: row.revision ?? 1,
      coverage_state: row.coverage?.state ?? null,
      count_scope: row.count_scope ?? null,
    };
  },

  async writeRow(fields, previous, now, session) {
    const publication = (previous?.publication_revision ?? 0) + 1;
    const set = {
      count_scope: fields.count_scope,
      goal_snapshot: fields.goal_snapshot,
      actual_confirmed: fields.actual_confirmed,
      actual_awaiting_confirmation: fields.actual_awaiting_confirmation,
      unattributed: fields.unattributed,
      remaining: fields.remaining,
      progress: fields.progress,
      goal_state: fields.goal_state,
      coverage: fields.coverage,
      input_fingerprint: fields.input_fingerprint,
      computed_as_of: now,
      publication_revision: publication,
    };
    const Model = getSalesOutreachRepDayProjectionModel();
    if (previous) {
      const result = await Model.updateOne(
        { agent_id: oid(fields.agent_id), business_day: fields.business_day, revision: previous.revision },
        { $set: set, $inc: { revision: 1 } },
        { session, runValidators: true },
      );
      if (result.matchedCount !== 1) throw Object.assign(new Error("rep-day revision moved"), { name: "RepDayConflict" });
    } else {
      await (Model as unknown as mongoose.Model<Record<string, unknown>>).create([{ agent_id: oid(fields.agent_id), business_day: fields.business_day, ...set, revision: 1 }], { session });
    }
    return publication;
  },

  async watermarks(session) {
    const rows = (await getSalesIntelligenceSyncStateModel()
      .find({ scope: { $in: [CALL_LOG_ALL_DIRECTIONS_SCOPE, OUTREACH_CONTACT_CALLS_SCOPE] } }, { scope: 1, known_complete_through: 1, "cursor.outreach_coverage_from": 1 })
      .session(session)
      .lean()) as unknown as Array<{ scope: string; known_complete_through?: Date | null; cursor?: { outreach_coverage_from?: Date | null } }>;
    const capture = rows.find((row) => row.scope === CALL_LOG_ALL_DIRECTIONS_SCOPE);
    const derived = rows.find((row) => row.scope === OUTREACH_CONTACT_CALLS_SCOPE);
    return {
      capture_known_complete_through: capture?.known_complete_through ?? null,
      derived_through: derived?.known_complete_through ?? null,
      coverage_from: derived?.cursor?.outreach_coverage_from ?? null,
    };
  },

  async rowsOfDay(day) {
    const rows = (await getSalesOutreachRepDayProjectionModel()
      .find({ business_day: day }, { agent_id: 1, coverage: 1, count_scope: 1, "goal_snapshot.configuration_version": 1 })
      .limit(MAX_REFRESH_ROWS)
      .lean()) as unknown as Array<{
      agent_id: unknown;
      coverage?: { state?: string } | null;
      count_scope?: SalesOutreachGoalCountScope | null;
      goal_snapshot?: { configuration_version?: string | null } | null;
    }>;
    return rows.map((row) => ({
      agent_id: String(row.agent_id),
      coverage_state: row.coverage?.state ?? null,
      frozen: Boolean(row.goal_snapshot?.configuration_version),
      count_scope: row.count_scope ?? null,
    }));
  },
};

export type RepDayRecount = Readonly<{
  outcome: "written" | "unchanged" | "no_activity";
  publication_revision: number | null;
  fields: RepDayRowFields;
}>;

export type RepDayRecountOptions = Readonly<{
  /**
   * olr C5: write the row even with zero activity, so a past day's goal snapshot freezes for a roster
   * rep who made no call. Honoured only for a day before today (New York) and a rep on the roster of
   * the configuration the recount runs under; otherwise the no-row rule applies.
   */
  materialize?: boolean;
}>;

/** Whether the zero-activity row of `key` may be materialized under `configuration` at `today` (olr C5). */
export function materializesZeroRow(key: RepDayKey, configuration: ActiveConfiguration, today: string): boolean {
  if (key.business_day >= today) return false;
  return (configuration.value.goals?.rep_work_schedules ?? []).some((row) => row.agent_id === key.agent_id);
}

/**
 * Recounts one rep-day inside the caller's transaction and writes the row only when its fingerprint
 * changed (publication revision + 1). A rep with no credited, awaiting or other outbound activity and
 * no row gets no row: the read shows zero-call reps from the roster. With `materialize` (olr C5, the
 * refresh pass after New York midnight) a roster rep's past day is written anyway: counts 0, the goal
 * snapshot frozen, coverage computed — the read still shows the 0 as pending until coverage is complete.
 */
export async function recountRepDay(
  key: RepDayKey,
  configuration: ActiveConfiguration,
  now: Date,
  store: RepDayStore,
  session: ClientSession,
  options: RepDayRecountOptions = {},
): Promise<RepDayRecount> {
  // One session runs one operation at a time: parallel reads at the start of a transaction make the
  // server refuse the second `startTransaction` (ConflictingOperationInProgress, code 117).
  const today = newYorkBusinessDay(now);
  const events = await store.events(key, session);
  const previous = await store.readRow(key, session);
  const watermarks = await store.watermarks(session);
  const fields = composeRepDayRow({
    agent_id: key.agent_id,
    business_day: key.business_day,
    today,
    now,
    events,
    // olr C1a: the day's scope is configuration (`goals.count_scope_schedule`, absent = all_outbound).
    scope: countScopeForDay(key.business_day, configuration.value.goals?.count_scope_schedule),
    goals: configuration.value.goals ?? null,
    configuration_version: configuration.version,
    existing_snapshot: previous?.goal_snapshot ?? null,
    watermarks,
  });
  // The fingerprint covers the scope; the stored-scope check also rewrites a row whose scope field
  // disagrees with its fingerprint, so the refresh pass never re-selects it forever.
  if (previous?.input_fingerprint === fields.input_fingerprint && previous.count_scope === fields.count_scope)
    return { outcome: "unchanged", publication_revision: previous.publication_revision, fields };
  if (
    !previous &&
    fields.actual_confirmed + fields.actual_awaiting_confirmation + fields.unattributed === 0 &&
    !(options.materialize && materializesZeroRow(key, configuration, today))
  )
    return { outcome: "no_activity", publication_revision: null, fields };
  const publication = await store.writeRow(fields, previous, now, session);
  return { outcome: "written", publication_revision: publication, fields };
}
