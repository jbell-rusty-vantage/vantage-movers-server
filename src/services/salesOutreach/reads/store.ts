import mongoose from "mongoose";
import { Agent } from "../../../models/Agent";
import { getGranotObservationModel } from "../../../models/GranotObservation";
import { OBSERVATION_KINDS } from "../../../models/granotLifecycleSchemas";
import { getRepIdentityLinkModel } from "../../../models/RepIdentityLink";
import { getSalesIntelligenceSyncStateModel } from "../../../models/SalesIntelligenceSyncState";
import { getSalesOutreachRepDayProjectionModel } from "../../../models/salesOutreach";
import { OUTREACH_CONTACT_CALLS_SCOPE } from "../../../config/domain/salesOutreachContacts";
import { getMongoDatabaseName } from "../../../config/domain/runtime";
import { CALL_LOG_ALL_DIRECTIONS_SCOPE } from "../../numberActivity/reconcileCallLog";
import { getRingCentralCollectionName } from "../../ringcentral/ringcentral-config";
import type { CaptureSyncRow } from "./freshness";
import type { RepDayRow } from "./goals";

/** Sync-state scope prefix of the per-mailbox rep SMS sync (RINGCENTRAL-CAPTURE §4, IMPLEMENTATION-PLAN §4.7). */
export const REP_SMS_SYNC_SCOPE_PREFIX = "rep_sms:" as const;
/** A day's rep-day rows are bounded by the roster (≤ 500 reps); the cap only guards a corrupt day. */
const MAX_REP_DAY_ROWS = 1000;
const MAX_MAILBOXES = 500;

/**
 * The reads behind the desk's M1 endpoints. Every query is bounded and indexed:
 * - rep-day rows: `sod_rep_day_day` `{business_day, agent_id}`;
 * - rep names: `ril_agent_current` `{agent_id, effective_to}`; Agent names by `_id`;
 * - capture: `sales_intelligence_sync_state_scope_unique` (exact scope, and an anchored prefix);
 * - the newest call webhook receipt: `ringcentral_webhook_events` `{provider, receivedAt}` newest first, limit 1;
 * - Granot: `granot_observation_kind_captured` `{kind, captured_at}` (merge-sorted over the kinds).
 * Nothing here writes, initializes or calls a provider.
 */
export type SalesOutreachReadStore = {
  findRepDayRows(businessDay: string, agentIds: readonly string[] | null): Promise<RepDayRow[]>;
  /** Agent id → name for Agents with a reviewed `sales_rep` link effective at `at`. */
  findReviewedRepNames(agentIds: readonly string[], at: Date): Promise<Map<string, string>>;
  /** Agent id → the Agent record's name (no link requirement); absent Agents are missing from the map. */
  findAgentNames(agentIds: readonly string[]): Promise<Map<string, string>>;
  readCallsCapture(): Promise<CaptureSyncRow | null>;
  /** Newest call webhook receipt instant (telephony session present); null when none was ever received. */
  readLastCallWebhookAt(): Promise<Date | null>;
  readSmsMailboxes(): Promise<CaptureSyncRow[]>;
  readLatestGranotObservationAt(): Promise<Date | null>;
  /** S3's contact-event derivation watermark (`outreach_contact_calls`); null before its first sweep. */
  readContactDerivation(): Promise<ContactDerivationMark | null>;
};

export type ContactDerivationMark = Readonly<{
  known_complete_through: Date | null;
  coverage_from: Date | null;
  /** `outreach_contact_calls.observed_complete_through` (A3-cap; absent until the first caught-up sweep writes it). */
  observed_complete_through?: Date | null;
}>;

export type SyncStateLean = {
  scope: string;
  known_complete_through?: Date | null;
  observed_complete_through?: Date | null;
  reconcile_sync_success_at?: Date | null;
  isync_lane?: { last_success_at?: Date | null } | null;
  last_run?: {
    finished_at?: Date | null;
    error_code?: string | null;
    sync_mode?: string | null;
    sync_token_stored?: boolean | null;
    sync_error_code?: string | null;
  } | null;
};

const toCaptureRow = (row: SyncStateLean): CaptureSyncRow => ({
  scope: row.scope,
  known_complete_through: row.known_complete_through ?? null,
  last_finished_at: row.last_run?.finished_at ?? null,
  last_error_code: row.last_run?.error_code ?? null,
});

const latest = (...instants: ReadonlyArray<Date | null | undefined>): Date | null =>
  instants.reduce<Date | null>((max, at) => (at && (!max || at.getTime() > max.getTime()) ? at : max), null);

/**
 * The Call Log row with its confirmation instant (lane A F5, RINGCENTRAL-CAPTURE §8): the later of the ISync
 * lane's sticky success, the reconcile's sticky sync success (A3-cap) and the last run's own sync success.
 * The last run counts only under the rule that stamps `reconcile_sync_success_at` (`reconcileSyncSuccessAt`):
 * sync mode `on`, a stored token and no sync error. A shadow run only counts records, so it never confirms.
 * The fallback is folded into the max on every read. On a row the reconcile has written since A3-cap it is
 * never later than the sticky field, so it only adds an instant for a row last reconciled before that field.
 */
export function toCallsCaptureRow(row: SyncStateLean): CaptureSyncRow {
  const run = row.last_run ?? null;
  const lastRunSyncSuccess =
    run?.sync_mode === "on" && run.sync_token_stored === true && !run.sync_error_code ? (run.finished_at ?? null) : null;
  return {
    ...toCaptureRow(row),
    observed_complete_through: row.observed_complete_through ?? null,
    confirmation_success_at: latest(row.isync_lane?.last_success_at, row.reconcile_sync_success_at, lastRunSyncSuccess),
  };
}

const SYNC_PROJECTION = { scope: 1, known_complete_through: 1, "last_run.finished_at": 1, "last_run.error_code": 1 } as const;
const CALLS_SYNC_PROJECTION = {
  ...SYNC_PROJECTION,
  observed_complete_through: 1,
  reconcile_sync_success_at: 1,
  "isync_lane.last_success_at": 1,
  "last_run.sync_mode": 1,
  "last_run.sync_token_stored": 1,
  "last_run.sync_error_code": 1,
} as const;
const oids = (ids: readonly string[]) => ids.map((id) => new mongoose.Types.ObjectId(id));

export const mongoSalesOutreachReadStore: SalesOutreachReadStore = {
  async findRepDayRows(businessDay, agentIds) {
    const filter: Record<string, unknown> = { business_day: businessDay };
    if (agentIds) filter.agent_id = { $in: oids(agentIds) };
    const rows = await getSalesOutreachRepDayProjectionModel()
      .find(filter, {
        agent_id: 1,
        business_day: 1,
        count_scope: 1,
        goal_snapshot: 1,
        actual_confirmed: 1,
        actual_awaiting_confirmation: 1,
        unattributed: 1,
        actual_confirmed_all: 1,
        actual_confirmed_eligible: 1,
        actual_awaiting_all: 1,
        actual_awaiting_eligible: 1,
        other_outbound: 1,
        coverage: 1,
        computed_as_of: 1,
        publication_revision: 1,
      })
      .limit(MAX_REP_DAY_ROWS)
      .lean();
    return rows.map((row) => ({
      agent_id: String(row.agent_id),
      business_day: row.business_day,
      count_scope: row.count_scope,
      goal_snapshot: row.goal_snapshot
        ? {
            roster_version: row.goal_snapshot.roster_version ?? null,
            configuration_version: row.goal_snapshot.configuration_version ?? null,
            goal: row.goal_snapshot.goal ?? null,
            scheduled: row.goal_snapshot.scheduled ?? false,
            override: row.goal_snapshot.override ?? null,
          }
        : null,
      actual_confirmed: row.actual_confirmed ?? 0,
      actual_awaiting_confirmation: row.actual_awaiting_confirmation ?? 0,
      unattributed: row.unattributed ?? 0,
      // olr C1b: a row written before both counts were stored reads null here, never 0.
      actual_confirmed_all: row.actual_confirmed_all ?? null,
      actual_confirmed_eligible: row.actual_confirmed_eligible ?? null,
      actual_awaiting_all: row.actual_awaiting_all ?? null,
      actual_awaiting_eligible: row.actual_awaiting_eligible ?? null,
      // olr C8: a row written before the breakdown was stored reads null.
      other_outbound: row.other_outbound ?? null,
      coverage: row.coverage ?? null,
      computed_as_of: row.computed_as_of ?? null,
      publication_revision: row.publication_revision ?? 0,
    })) as RepDayRow[];
  },

  async findReviewedRepNames(agentIds, at) {
    if (!agentIds.length) return new Map();
    const rows = await getRepIdentityLinkModel()
      .find(
        {
          agent_id: { $in: oids(agentIds) },
          status: "reviewed",
          role_kind: "sales_rep",
          effective_from: { $lte: at },
          $or: [{ effective_to: null }, { effective_to: { $gt: at } }],
        },
        { agent_id: 1, agent_name_snapshot: 1 },
      )
      .lean();
    return new Map(rows.map((row) => [String(row.agent_id), row.agent_name_snapshot]));
  },

  async findAgentNames(agentIds) {
    const ids = agentIds.filter((id) => mongoose.isValidObjectId(id));
    if (!ids.length) return new Map();
    const rows = await Agent.find({ _id: { $in: oids(ids) } }, { name: 1 }).lean();
    return new Map(rows.map((row) => [String(row._id), row.name]));
  },

  async readCallsCapture() {
    const row = await getSalesIntelligenceSyncStateModel().findOne({ scope: CALL_LOG_ALL_DIRECTIONS_SCOPE }, CALLS_SYNC_PROJECTION).lean();
    return row ? toCallsCaptureRow(row as unknown as SyncStateLean) : null;
  },

  async readLastCallWebhookAt() {
    // Raw collection read (no model, no index creation): the partial `{provider, receivedAt, _id}` scan index
    // (telephony receipts only) or `{provider, receivedAt: -1}` serve it newest-first with a limit of 1.
    const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db;
    if (!db) throw new Error("MongoDB connection is not ready");
    const row = await db
      .collection<{ receivedAt?: Date }>(getRingCentralCollectionName("webhookEvents"))
      .findOne(
        { provider: "ringcentral", telephonySessionId: { $type: "string" } },
        { sort: { receivedAt: -1 }, projection: { _id: 0, receivedAt: 1 } },
      );
    return row?.receivedAt instanceof Date ? row.receivedAt : null;
  },

  async readSmsMailboxes() {
    const rows = await getSalesIntelligenceSyncStateModel()
      .find({ scope: { $regex: `^${REP_SMS_SYNC_SCOPE_PREFIX}` } }, SYNC_PROJECTION)
      .limit(MAX_MAILBOXES)
      .lean();
    return (rows as unknown as SyncStateLean[]).map(toCaptureRow);
  },

  async readContactDerivation() {
    const row = (await getSalesIntelligenceSyncStateModel()
      .findOne({ scope: OUTREACH_CONTACT_CALLS_SCOPE }, { known_complete_through: 1, observed_complete_through: 1, "cursor.outreach_coverage_from": 1 })
      .lean()) as {
      known_complete_through?: Date | null;
      observed_complete_through?: Date | null;
      cursor?: { outreach_coverage_from?: Date | null };
    } | null;
    if (!row) return null;
    return {
      known_complete_through: row.known_complete_through ?? null,
      observed_complete_through: row.observed_complete_through ?? null,
      coverage_from: row.cursor?.outreach_coverage_from ?? null,
    };
  },

  async readLatestGranotObservationAt() {
    const row = await getGranotObservationModel()
      .findOne({ kind: { $in: [...OBSERVATION_KINDS] } }, { _id: 0, captured_at: 1 })
      .sort({ captured_at: -1 })
      .lean();
    return row?.captured_at ?? null;
  },
};
