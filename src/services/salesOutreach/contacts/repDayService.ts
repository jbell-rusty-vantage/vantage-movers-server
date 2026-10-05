import mongoose, { type ClientSession } from "mongoose";
import { OUTREACH_CONTACT_CALLS_SCOPE } from "../../../config/domain/salesOutreachContacts";
import { getSalesIntelligenceSyncStateModel } from "../../../models/SalesIntelligenceSyncState";
import {
  getSalesOutreachContactEventModel,
  getSalesOutreachEnrollmentRunModel,
  getSalesOutreachRepDayProjectionModel,
} from "../../../models/salesOutreach";
import { CALL_LOG_ALL_DIRECTIONS_SCOPE } from "../../numberActivity/reconcileCallLog";
import type { ActiveConfiguration } from "../config/load";
import { newYorkBusinessDay } from "../reads/businessDay";
import type { RepDayKey } from "./apply";
import { composeRepDayRow, countScopeFor, type CoverageWatermarks, type GoalSnapshot, type RepDayEventFacts, type RepDayRowFields } from "./repDay";

/** Events of one rep-day are bounded by a day's dialing; the cap only guards a corrupt day. */
const MAX_REP_DAY_EVENTS = 5000;
const MAX_REFRESH_ROWS = 1000;

export type StoredRepDay = Readonly<{
  goal_snapshot: GoalSnapshot | null;
  input_fingerprint: string;
  publication_revision: number;
  revision: number;
  coverage_state: string | null;
}>;

export type RepDayStore = {
  events(key: RepDayKey, session: ClientSession): Promise<RepDayEventFacts[]>;
  readRow(key: RepDayKey, session: ClientSession): Promise<StoredRepDay | null>;
  writeRow(fields: RepDayRowFields, previous: StoredRepDay | null, now: Date, session: ClientSession): Promise<number>;
  firstActivationAt(session: ClientSession): Promise<Date | null>;
  watermarks(session: ClientSession): Promise<CoverageWatermarks>;
  /** Rows of a day (refresh pass): agent id, coverage state and whether the goal is frozen. */
  rowsOfDay(day: string): Promise<Array<{ agent_id: string; coverage_state: string | null; frozen: boolean }>>;
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
      .findOne({ agent_id: oid(key.agent_id), business_day: key.business_day }, { goal_snapshot: 1, input_fingerprint: 1, publication_revision: 1, revision: 1, coverage: 1 })
      .session(session)
      .lean()) as unknown as { goal_snapshot?: GoalSnapshot | null; input_fingerprint: string; publication_revision: number; revision: number; coverage?: { state?: string } | null } | null;
    if (!row) return null;
    return {
      goal_snapshot: row.goal_snapshot ?? null,
      input_fingerprint: row.input_fingerprint,
      publication_revision: row.publication_revision ?? 0,
      revision: row.revision ?? 1,
      coverage_state: row.coverage?.state ?? null,
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

  async firstActivationAt(session) {
    // A handful of runs exist (one per cohort); the earliest completed apply decides the M2 date.
    const row = (await getSalesOutreachEnrollmentRunModel()
      .findOne({ mode: "apply", status: "completed" }, { activation_at: 1 })
      .sort({ activation_at: 1 })
      .session(session)
      .lean()) as unknown as { activation_at: Date } | null;
    return row?.activation_at ?? null;
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
      .find({ business_day: day }, { agent_id: 1, coverage: 1, "goal_snapshot.configuration_version": 1 })
      .limit(MAX_REFRESH_ROWS)
      .lean()) as unknown as Array<{ agent_id: unknown; coverage?: { state?: string } | null; goal_snapshot?: { configuration_version?: string | null } | null }>;
    return rows.map((row) => ({
      agent_id: String(row.agent_id),
      coverage_state: row.coverage?.state ?? null,
      frozen: Boolean(row.goal_snapshot?.configuration_version),
    }));
  },
};

export type RepDayRecount = Readonly<{
  outcome: "written" | "unchanged" | "no_activity";
  publication_revision: number | null;
  fields: RepDayRowFields;
}>;

/**
 * Recounts one rep-day inside the caller's transaction and writes the row only when its fingerprint
 * changed (publication revision + 1). A rep with no credited, awaiting or other outbound activity and
 * no row gets no row: the read shows zero-call reps from the roster.
 */
export async function recountRepDay(
  key: RepDayKey,
  configuration: ActiveConfiguration,
  now: Date,
  store: RepDayStore,
  session: ClientSession,
): Promise<RepDayRecount> {
  // One session runs one operation at a time: parallel reads at the start of a transaction make the
  // server refuse the second `startTransaction` (ConflictingOperationInProgress, code 117).
  const events = await store.events(key, session);
  const previous = await store.readRow(key, session);
  const firstActivation = await store.firstActivationAt(session);
  const watermarks = await store.watermarks(session);
  const fields = composeRepDayRow({
    agent_id: key.agent_id,
    business_day: key.business_day,
    today: newYorkBusinessDay(now),
    now,
    events,
    scope: countScopeFor(key.business_day, firstActivation),
    goals: configuration.value.goals ?? null,
    configuration_version: configuration.version,
    existing_snapshot: previous?.goal_snapshot ?? null,
    watermarks,
  });
  if (previous?.input_fingerprint === fields.input_fingerprint) return { outcome: "unchanged", publication_revision: previous.publication_revision, fields };
  if (!previous && fields.actual_confirmed + fields.actual_awaiting_confirmation + fields.unattributed === 0)
    return { outcome: "no_activity", publication_revision: null, fields };
  const publication = await store.writeRow(fields, previous, now, session);
  return { outcome: "written", publication_revision: publication, fields };
}
