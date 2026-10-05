import mongoose from "mongoose";
import { getGranotObservationModel } from "../../../models/GranotObservation";
import { OBSERVATION_KINDS } from "../../../models/granotLifecycleSchemas";
import { getRepIdentityLinkModel } from "../../../models/RepIdentityLink";
import { getSalesIntelligenceSyncStateModel } from "../../../models/SalesIntelligenceSyncState";
import { getSalesOutreachRepDayProjectionModel } from "../../../models/salesOutreach";
import { CALL_LOG_ALL_DIRECTIONS_SCOPE } from "../../numberActivity/reconcileCallLog";
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
 * - rep names: `ril_agent_current` `{agent_id, effective_to}`;
 * - capture: `sales_intelligence_sync_state_scope_unique` (exact scope, and an anchored prefix);
 * - Granot: `granot_observation_kind_captured` `{kind, captured_at}` (merge-sorted over the kinds).
 * Nothing here writes, initializes or calls a provider.
 */
export type SalesOutreachReadStore = {
  findRepDayRows(businessDay: string, agentIds: readonly string[] | null): Promise<RepDayRow[]>;
  /** Agent id → name for Agents with a reviewed `sales_rep` link effective at `at`. */
  findReviewedRepNames(agentIds: readonly string[], at: Date): Promise<Map<string, string>>;
  readCallsCapture(): Promise<CaptureSyncRow | null>;
  readSmsMailboxes(): Promise<CaptureSyncRow[]>;
  readLatestGranotObservationAt(): Promise<Date | null>;
};

type SyncStateLean = {
  scope: string;
  known_complete_through?: Date | null;
  last_run?: { finished_at?: Date | null; error_code?: string | null } | null;
};

const toCaptureRow = (row: SyncStateLean): CaptureSyncRow => ({
  scope: row.scope,
  known_complete_through: row.known_complete_through ?? null,
  last_finished_at: row.last_run?.finished_at ?? null,
  last_error_code: row.last_run?.error_code ?? null,
});

const SYNC_PROJECTION = { scope: 1, known_complete_through: 1, "last_run.finished_at": 1, "last_run.error_code": 1 } as const;
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

  async readCallsCapture() {
    const row = await getSalesIntelligenceSyncStateModel().findOne({ scope: CALL_LOG_ALL_DIRECTIONS_SCOPE }, SYNC_PROJECTION).lean();
    return row ? toCaptureRow(row as unknown as SyncStateLean) : null;
  },

  async readSmsMailboxes() {
    const rows = await getSalesIntelligenceSyncStateModel()
      .find({ scope: { $regex: `^${REP_SMS_SYNC_SCOPE_PREFIX}` } }, SYNC_PROJECTION)
      .limit(MAX_MAILBOXES)
      .lean();
    return (rows as unknown as SyncStateLean[]).map(toCaptureRow);
  },

  async readLatestGranotObservationAt() {
    const row = await getGranotObservationModel()
      .findOne({ kind: { $in: [...OBSERVATION_KINDS] } }, { _id: 0, captured_at: 1 })
      .sort({ captured_at: -1 })
      .lean();
    return row?.captured_at ?? null;
  },
};
