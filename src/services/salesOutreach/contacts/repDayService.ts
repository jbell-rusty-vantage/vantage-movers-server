import mongoose, { type ClientSession } from "mongoose";
import type { SalesOutreachGoalCountScope } from "../../../config/domain/salesOutreach";
import { getSalesOutreachContactEventModel, getSalesOutreachRepDayProjectionModel } from "../../../models/salesOutreach";
import type { ActiveConfiguration } from "../config/load";
import { deskTimingOf } from "../config/timing";
import { loadCallWatermarks, type CallWatermarks } from "../evidence/coverage";
import { newYorkBusinessDay } from "../reads/businessDay";
import { onRoster, rosterInstant, type EffectiveRoster } from "../roster/rule";
import { findDeskRepIdsAt, loadEffectiveRoster } from "../roster/store";
import type { RepDayKey } from "./apply";
import { composeRepDayRow, countScopeForDay, type GoalSnapshot, type RepDayEventFacts, type RepDayRowFields } from "./repDay";

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
  /** olr C1b: the row stores both scopes' counts; a row without them is rewritten even when its fingerprint matches. */
  both_counts: boolean;
  /** olr C8: the row stores the "Other outbound" breakdown; a row without it is rewritten once, likewise. */
  breakdown: boolean;
}>;

export type RepDayRefreshRow = Readonly<{
  agent_id: string;
  coverage_state: string | null;
  frozen: boolean;
  count_scope: SalesOutreachGoalCountScope | null;
  /** olr C1b: whether the row stores both scopes' counts (`actual_confirmed_all` present); false for an older row. */
  both_counts: boolean;
  /** olr C8: whether the row stores the "Other outbound" breakdown (`other_outbound` present); false for an older row. */
  breakdown: boolean;
}>;

export type RepDayStore = {
  events(key: RepDayKey, session: ClientSession): Promise<RepDayEventFacts[]>;
  readRow(key: RepDayKey, session: ClientSession): Promise<StoredRepDay | null>;
  writeRow(fields: RepDayRowFields, previous: StoredRepDay | null, now: Date, session: ClientSession): Promise<number>;
  /** Capture + derivation call watermarks (`loadCallWatermarks`), read inside the recount transaction. */
  watermarks(session: ClientSession): Promise<CallWatermarks>;
  /** Rows of a day (refresh pass): agent id, coverage state, whether the goal is frozen, the stored count scope and whether both scopes' counts and the breakdown are stored. */
  rowsOfDay(day: string): Promise<RepDayRefreshRow[]>;
  /** P08a-1: the desk reps (active Agents with a reviewed `sales_rep` link) at `at`; read inside the recount transaction when a session is given. */
  deskReps(at: Date, session?: ClientSession | null): Promise<readonly string[]>;
};

const oid = (id: string) => new mongoose.Types.ObjectId(id);

export const mongoRepDayStore: RepDayStore = {
  async events(key, session) {
    const rows = await getSalesOutreachContactEventModel()
      .find({ goal_agent_id: oid(key.agent_id), business_date: key.business_day }, { source_id: 1, goal_credit: 1, goal_scope_eligible: 1, association_reason: 1 })
      .limit(MAX_REP_DAY_EVENTS)
      .session(session)
      .lean();
    type EventRow = { source_id: unknown; goal_credit: RepDayEventFacts["goal_credit"]; goal_scope_eligible?: boolean; association_reason?: RepDayEventFacts["association_reason"] };
    return (rows as unknown as EventRow[]).map((row) => ({
      source_id: String(row.source_id),
      goal_credit: row.goal_credit,
      goal_scope_eligible: row.goal_scope_eligible ?? false,
      association_reason: row.association_reason ?? null,
    }));
  },

  async readRow(key, session) {
    const row = (await getSalesOutreachRepDayProjectionModel()
      .findOne({ agent_id: oid(key.agent_id), business_day: key.business_day }, { goal_snapshot: 1, input_fingerprint: 1, publication_revision: 1, revision: 1, coverage: 1, count_scope: 1, actual_confirmed_all: 1, other_outbound: 1 })
      .session(session)
      .lean()) as unknown as {
      goal_snapshot?: GoalSnapshot | null;
      input_fingerprint: string;
      publication_revision: number;
      revision: number;
      coverage?: { state?: string } | null;
      count_scope?: SalesOutreachGoalCountScope | null;
      actual_confirmed_all?: number | null;
      other_outbound?: unknown;
    } | null;
    if (!row) return null;
    return {
      goal_snapshot: row.goal_snapshot ?? null,
      input_fingerprint: row.input_fingerprint,
      publication_revision: row.publication_revision ?? 0,
      revision: row.revision ?? 1,
      coverage_state: row.coverage?.state ?? null,
      count_scope: row.count_scope ?? null,
      both_counts: typeof row.actual_confirmed_all === "number",
      breakdown: row.other_outbound != null,
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
      actual_confirmed_all: fields.actual_confirmed_all,
      actual_confirmed_eligible: fields.actual_confirmed_eligible,
      actual_awaiting_all: fields.actual_awaiting_all,
      actual_awaiting_eligible: fields.actual_awaiting_eligible,
      other_outbound: fields.other_outbound,
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

  watermarks(session) {
    return loadCallWatermarks(session);
  },

  async rowsOfDay(day) {
    const rows = (await getSalesOutreachRepDayProjectionModel()
      .find({ business_day: day }, { agent_id: 1, coverage: 1, count_scope: 1, actual_confirmed_all: 1, other_outbound: 1, "goal_snapshot.configuration_version": 1 })
      .limit(MAX_REFRESH_ROWS)
      .lean()) as unknown as Array<{
      agent_id: unknown;
      coverage?: { state?: string } | null;
      count_scope?: SalesOutreachGoalCountScope | null;
      actual_confirmed_all?: number | null;
      other_outbound?: unknown;
      goal_snapshot?: { configuration_version?: string | null } | null;
    }>;
    return rows.map((row) => ({
      agent_id: String(row.agent_id),
      coverage_state: row.coverage?.state ?? null,
      frozen: Boolean(row.goal_snapshot?.configuration_version),
      count_scope: row.count_scope ?? null,
      both_counts: typeof row.actual_confirmed_all === "number",
      breakdown: row.other_outbound != null,
    }));
  },

  deskReps(at, session) {
    return findDeskRepIdsAt(at, session);
  },
};

/**
 * The effective roster a rep-day of `businessDay` is counted under (P08a-1): the configuration's rule
 * applied at the day's roster instant (today: `now`; a past day: the end of that New York day), read
 * through the store so a recount sees it inside its own transaction.
 */
export function rosterForRepDay(
  configuration: ActiveConfiguration,
  businessDay: string,
  now: Date,
  store: Pick<RepDayStore, "deskReps">,
  session?: ClientSession | null,
): Promise<EffectiveRoster> {
  const today = newYorkBusinessDay(now);
  return loadEffectiveRoster(configuration.value.goals, rosterInstant(businessDay, today, now), (at, s) => store.deskReps(at, s), session);
}

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

/**
 * Whether the zero-activity row of `key` may be materialized at `today` (olr C5): a past day and an Agent
 * on the effective roster of that day (P08a-1: under `desk_reps` only an active, connected rep).
 */
export function materializesZeroRow(key: RepDayKey, roster: EffectiveRoster, today: string): boolean {
  if (key.business_day >= today) return false;
  return onRoster(roster, key.agent_id);
}

/**
 * Recounts one rep-day inside the caller's transaction and writes the row only when its fingerprint
 * changed (publication revision + 1). A rep with no confirmed or awaiting outbound call in either scope
 * (olr C1b: `actual_confirmed_all + actual_awaiting_all === 0`) and no row gets no row: the read shows
 * zero-call reps from the roster. With `materialize` (olr C5, the refresh pass after New York midnight) a roster rep's past day is written anyway: counts 0, the goal
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
  // P08a-1: the roster of the day (desk reps at the day's roster instant under `desk_reps`), read in the
  // same transaction; a frozen snapshot ignores it (`goalSnapshotFor`).
  const roster = await rosterForRepDay(configuration, key.business_day, now, store, session);
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
    // olr C0: settlement allowance and today tolerance from the configuration (code defaults when unset).
    timing: deskTimingOf(configuration.value),
    roster,
  });
  // The fingerprint covers the scope; the stored-scope check also rewrites a row whose scope field
  // disagrees with its fingerprint, so the refresh pass never re-selects it forever; likewise a row that
  // lacks the two-scope counts (olr C1b) or the "Other outbound" breakdown (olr C8) is rewritten once.
  if (previous?.input_fingerprint === fields.input_fingerprint && previous.count_scope === fields.count_scope && previous.both_counts && previous.breakdown)
    return { outcome: "unchanged", publication_revision: previous.publication_revision, fields };
  if (
    !previous &&
    fields.actual_confirmed_all + fields.actual_awaiting_all === 0 &&
    !(options.materialize && materializesZeroRow(key, roster, today))
  )
    return { outcome: "no_activity", publication_revision: null, fields };
  const publication = await store.writeRow(fields, previous, now, session);
  return { outcome: "written", publication_revision: publication, fields };
}
