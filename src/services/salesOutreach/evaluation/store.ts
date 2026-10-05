import mongoose, { type ClientSession } from "mongoose";
import type { SalesOutreachCadenceExposure } from "../../../config/domain/salesOutreach";
import { getEntityChangeModel } from "../../../models/EntityChange";
import { getRepIdentityLinkModel } from "../../../models/RepIdentityLink";
import { getSalesIntelligenceContactRestrictionModel } from "../../../models/SalesIntelligenceContactRestriction";
import { getSalesIntelligenceSyncStateModel } from "../../../models/SalesIntelligenceSyncState";
import {
  getSalesOutreachContactEventModel,
  getSalesOutreachFollowupScheduleModel,
  getSalesOutreachProjectionModel,
  getSalesOutreachSubjectModel,
} from "../../../models/salesOutreach";
import { CALL_LOG_ALL_DIRECTIONS_SCOPE } from "../../numberActivity/reconcileCallLog";
import { CsiError } from "../../salesIntelligence/auth";
import { enqueueCsiJob, type JobInput } from "../../salesIntelligence/jobs";
import { REP_SMS_SYNC_SCOPE_PREFIX } from "../reads/store";
import type { DeskLeadRef } from "../subjects/leadFacts";
import { mongoDeskSubjectStore, toSubjectRow, type DeskPeriodRow, type DeskSubjectRow, type ReadSession, type SubjectLean } from "../subjects/store";

/** One `sales_outreach_followup_schedules` row (a Quoted date or a timed callback, P04/P06e/P06f). */
export type DeskPlanRow = Readonly<{
  id: string;
  subject_id: string;
  period_id: string | null;
  kind: "quoted_date" | "callback";
  selected_date: string | null;
  appointment_at: Date | null;
  due_at: Date;
  window_minutes: number | null;
  effective_at: Date;
  status: "active" | "fulfilled" | "missed" | "cancelled" | "replaced" | "blocked_reschedule";
  ended_at: Date | null;
  end_reason: string | null;
  revision: number;
}>;

/** One `sales_intelligence_contact_restrictions` row as the desk reads it (P06c). */
export type DeskRestrictionRow = Readonly<{
  id: string;
  contact_number_id: string;
  /** Stored channels (`text` = SMS). */
  channels: Array<"call" | "text">;
  until: Date | null;
  origin: "owner" | "intelligence";
  state: "active" | "expired" | "resolved";
  created_at: Date;
  updated_at: Date | null;
  reason: string | null;
  confirmed_at: Date | null;
  confirmed_by: string | null;
  resolved_at: Date | null;
  resolved_by: string | null;
  resolution_reason: string | null;
  revision: number;
}>;

/** One `entity_changes` row that changed the Lead's `receiver_agent` (P06d history). */
export type AssignmentChangeRow = Readonly<{ applied_at: Date; before: string | null; after: string | null }>;

/** A reviewed `sales_rep` identity link's effective interval for one Agent. */
export type RepLinkPeriod = Readonly<{ agent_id: string; effective_from: Date; effective_to: Date | null }>;

/** A stored `sales_outreach_contact_events` row (S3 writes them). */
export type StoredContactEvent = Readonly<{
  id: string;
  source_kind: "call" | "sms";
  source_id: string;
  channel: "call" | "sms";
  direction: "inbound" | "outbound";
  event_at: Date;
  kind: string;
  verification: string;
  exclusion_reason: string | null;
  actor_agent_id: string | null;
  goal_agent_id: string | null;
  restricted_at_contact: boolean;
  outcome?: string | null;
}>;

/** Capture coverage the engine reads (RINGCENTRAL-CAPTURE §8). */
export type CoverageFacts = Readonly<{
  /** Call Log `known_complete_through` (before the settlement allowance). */
  calls_known_complete_through: Date | null;
  /** Worst reviewed mailbox `known_complete_through`; null when SMS capture is off or any mailbox has none. */
  sms_known_complete_through: Date | null;
}>;

export type ProjectionHead = Readonly<{ revision: number; publication_revision: number; result_fingerprint: string | null; policy_fingerprint: string | null }>;

/** The projection document the evaluator writes (subject id excluded; see `projection.ts`). */
export type ProjectionWrite = Readonly<Record<string, unknown> & { exposure: SalesOutreachCadenceExposure; result_fingerprint: string }>;

/** Bounded evaluation-load caps (one subject's history; the engine recomputes it whole). */
export const EVALUATION_LIMITS = { periods: 1000, plans: 500, restrictions: 200, assignment_changes: 500, contact_events: 5000 } as const;

/**
 * Every read/write of the `outreach_evaluate` stage and its sweeps. Reads run in the job's transaction
 * session (or none for the sweep's read-only pages) and are bounded and indexed:
 * - subject `_id`; periods `sod_period_subject_started`; plans `sod_followup_subject_effective`;
 * - restrictions `csi_restriction_number` (`contact_number_id` prefix);
 * - assignment history `entity_change_entity_applied`; links `ril_agent_current` (agent prefix);
 * - contact events `sod_contact_subject_event`; capture rows `sales_intelligence_sync_state` scope;
 * - projections `sod_projection_subject_unique`, `sod_projection_next_evaluation`.
 */
export type EvaluationStore = {
  loadSubject(subjectId: string, session: ReadSession): Promise<DeskSubjectRow | null>;
  loadPeriods(subjectId: string, session: ReadSession): Promise<DeskPeriodRow[]>;
  loadPlans(subjectId: string, session: ReadSession): Promise<DeskPlanRow[]>;
  loadRestrictions(contactNumberIds: readonly string[], session: ReadSession): Promise<DeskRestrictionRow[]>;
  loadAssignmentChanges(lead: DeskLeadRef, session: ReadSession): Promise<AssignmentChangeRow[]>;
  loadRepLinks(agentIds: readonly string[], session: ReadSession): Promise<RepLinkPeriod[]>;
  loadContactEvents(subjectId: string, session: ReadSession): Promise<StoredContactEvent[]>;
  loadCoverage(smsCaptureEnabled: boolean, session: ReadSession): Promise<CoverageFacts>;
  readProjection(subjectId: string, session: ReadSession): Promise<ProjectionHead | null>;
  insertProjection(subjectId: string, doc: ProjectionWrite, session: ClientSession): Promise<void>;
  /** CAS on the projection `revision`; false when another writer moved it first. */
  updateProjection(subjectId: string, expectedRevision: number, doc: ProjectionWrite, session: ClientSession): Promise<boolean>;
  /** Projections due at `now`, oldest first, strictly after `after` on `(next_evaluation_at, subject_id)`. */
  dueProjections(now: Date, after: { at: Date; subject_id: string } | null, limit: number): Promise<Array<{ subject_id: string; next_evaluation_at: Date }>>;
  readReconcileCursor(session: ClientSession): Promise<string | null>;
  writeReconcileCursor(subjectId: string | null, session: ClientSession): Promise<void>;
  /** Subject ids after `afterId` by `_id` (every status: a closed subject still has a projection). */
  subjectIdsAfter(afterId: string | null, limit: number, session: ClientSession): Promise<string[]>;
  /** Subject id → stored `policy_fingerprint` (absent = no projection yet). */
  projectionPolicies(subjectIds: readonly string[], session: ClientSession): Promise<Map<string, string | null>>;
  enqueue(job: JobInput, session: ClientSession): Promise<"enqueued" | "conflict">;
};

export const OUTREACH_EVALUATION_RECONCILE_SCOPE = "outreach_evaluation_reconcile";
const oid = (id: string) => new mongoose.Types.ObjectId(id);
const idOrNull = (value: unknown) => (value === null || value === undefined ? null : String(value));
const actorId = (value: unknown) => (value && typeof value === "object" && "id" in value ? String((value as { id: unknown }).id) : null);

export function toPlanRow(row: Record<string, unknown>): DeskPlanRow {
  return {
    id: String(row._id),
    subject_id: String(row.subject_id),
    period_id: idOrNull(row.period_id),
    kind: row.kind as DeskPlanRow["kind"],
    selected_date: (row.selected_date as string | null) ?? null,
    appointment_at: (row.appointment_at as Date | null) ?? null,
    due_at: row.due_at as Date,
    window_minutes: (row.window_minutes as number | null) ?? null,
    effective_at: row.effective_at as Date,
    status: row.status as DeskPlanRow["status"],
    ended_at: (row.ended_at as Date | null) ?? null,
    end_reason: (row.end_reason as string | null) ?? null,
    revision: Number(row.revision ?? 1),
  };
}

export function toRestrictionRow(row: Record<string, unknown>): DeskRestrictionRow {
  return {
    id: String(row._id),
    contact_number_id: String(row.contact_number_id),
    channels: [...((row.channels as Array<"call" | "text">) ?? [])],
    until: (row.until as Date | null) ?? null,
    origin: row.origin as DeskRestrictionRow["origin"],
    state: row.state as DeskRestrictionRow["state"],
    created_at: (row.createdAt as Date | undefined) ?? (row._id as mongoose.Types.ObjectId).getTimestamp(),
    updated_at: (row.updatedAt as Date | null) ?? null,
    reason: (row.reason as string | null) ?? null,
    confirmed_at: (row.confirmed_at as Date | null) ?? null,
    confirmed_by: actorId(row.confirmation_actor),
    resolved_at: (row.resolved_at as Date | null) ?? null,
    resolved_by: actorId(row.resolution_actor),
    resolution_reason: (row.resolution_reason as string | null) ?? null,
    revision: Number(row.revision ?? 1),
  };
}

export const mongoEvaluationStore: EvaluationStore = {
  async loadSubject(subjectId, session) {
    if (!mongoose.isValidObjectId(subjectId)) return null;
    const row = await getSalesOutreachSubjectModel().findById(oid(subjectId)).session(session).lean();
    return row ? toSubjectRow(row as unknown as SubjectLean) : null;
  },

  loadPeriods: (subjectId, session) => mongoDeskSubjectStore.findPeriods(subjectId, session),

  async loadPlans(subjectId, session) {
    const rows = await getSalesOutreachFollowupScheduleModel()
      .find({ subject_id: oid(subjectId) })
      .sort({ effective_at: 1, _id: 1 })
      .limit(EVALUATION_LIMITS.plans)
      .session(session)
      .lean();
    return (rows as unknown as Array<Record<string, unknown>>).map(toPlanRow);
  },

  async loadRestrictions(contactNumberIds, session) {
    const ids = [...new Set(contactNumberIds)].filter((id) => mongoose.isValidObjectId(id));
    if (!ids.length) return [];
    const rows = await getSalesIntelligenceContactRestrictionModel()
      .find({ contact_number_id: { $in: ids.map(oid) } })
      .sort({ _id: 1 })
      .limit(EVALUATION_LIMITS.restrictions)
      .session(session)
      .lean();
    return (rows as unknown as Array<Record<string, unknown>>).map(toRestrictionRow);
  },

  async loadAssignmentChanges(lead, session) {
    const rows = await getEntityChangeModel()
      .find(
        { "entity.model": lead.model, "entity.id": lead.id, changed_paths: "receiver_agent" },
        { applied_at: 1, fields: 1 },
      )
      .sort({ applied_at: 1, _id: 1 })
      .limit(EVALUATION_LIMITS.assignment_changes)
      .session(session)
      .lean();
    return rows.map((row) => {
      const field = row.fields.find((f) => f.path === "receiver_agent");
      return { applied_at: row.applied_at, before: idOrNull(field?.before), after: idOrNull(field?.after) };
    });
  },

  async loadRepLinks(agentIds, session) {
    const ids = [...new Set(agentIds)].filter((id) => mongoose.isValidObjectId(id));
    if (!ids.length) return [];
    const rows = await getRepIdentityLinkModel()
      .find({ agent_id: { $in: ids.map(oid) }, status: "reviewed", role_kind: "sales_rep" }, { agent_id: 1, effective_from: 1, effective_to: 1 })
      .limit(1000)
      .session(session)
      .lean();
    return rows.map((row) => ({ agent_id: String(row.agent_id), effective_from: row.effective_from, effective_to: row.effective_to ?? null }));
  },

  async loadContactEvents(subjectId, session) {
    const rows = await getSalesOutreachContactEventModel()
      .find({ subject_id: oid(subjectId) })
      .sort({ event_at: 1, _id: 1 })
      .limit(EVALUATION_LIMITS.contact_events)
      .session(session)
      .lean();
    return (rows as unknown as Array<Record<string, unknown>>).map((row) => ({
      id: String(row._id),
      source_kind: row.source_kind as StoredContactEvent["source_kind"],
      source_id: String(row.source_id),
      channel: row.channel as StoredContactEvent["channel"],
      direction: row.direction as StoredContactEvent["direction"],
      event_at: row.event_at as Date,
      kind: String(row.kind),
      verification: String(row.verification),
      exclusion_reason: (row.exclusion_reason as string | null) ?? null,
      actor_agent_id: idOrNull(row.actor_agent_id),
      goal_agent_id: idOrNull(row.goal_agent_id),
      restricted_at_contact: row.restricted_at_contact === true,
      outcome: (row.outcome as string | null | undefined) ?? null,
    }));
  },

  async loadCoverage(smsCaptureEnabled, session) {
    const SyncState = getSalesIntelligenceSyncStateModel();
    const calls = await SyncState.findOne({ scope: CALL_LOG_ALL_DIRECTIONS_SCOPE }, { known_complete_through: 1 }).session(session).lean();
    let sms: Date | null = null;
    if (smsCaptureEnabled) {
      const mailboxes = await SyncState.find({ scope: { $regex: `^${REP_SMS_SYNC_SCOPE_PREFIX}` } }, { known_complete_through: 1 })
        .limit(500)
        .session(session)
        .lean();
      const points = mailboxes.map((row) => (row.known_complete_through as Date | null | undefined) ?? null);
      sms = points.length && points.every((p) => p !== null) ? new Date(Math.min(...points.map((p) => +p!))) : null;
    }
    return { calls_known_complete_through: (calls?.known_complete_through as Date | null | undefined) ?? null, sms_known_complete_through: sms };
  },

  async readProjection(subjectId, session) {
    const row = await getSalesOutreachProjectionModel()
      .findOne({ subject_id: oid(subjectId) }, { revision: 1, publication_revision: 1, result_fingerprint: 1, policy_fingerprint: 1 })
      .session(session)
      .lean();
    if (!row) return null;
    return {
      revision: Number(row.revision ?? 1),
      publication_revision: Number(row.publication_revision ?? 0),
      result_fingerprint: (row as { result_fingerprint?: string }).result_fingerprint ?? null,
      policy_fingerprint: (row as { policy_fingerprint?: string }).policy_fingerprint ?? null,
    };
  },

  async insertProjection(subjectId, doc, session) {
    try {
      await getSalesOutreachProjectionModel().create([{ ...toStoredProjection(doc), subject_id: oid(subjectId), revision: 1 }], { session });
    } catch (error) {
      if ((error as { code?: unknown })?.code === 11000) throw new CsiError("REVISION_CONFLICT");
      throw error;
    }
  },

  async updateProjection(subjectId, expectedRevision, doc, session) {
    const result = await getSalesOutreachProjectionModel().updateOne(
      { subject_id: oid(subjectId), revision: expectedRevision },
      { $set: { ...toStoredProjection(doc), revision: expectedRevision + 1 } },
      { session, runValidators: true },
    );
    return result.modifiedCount === 1;
  },

  async dueProjections(now, after, limit) {
    const filter: Record<string, unknown> = { next_evaluation_at: { $ne: null, $lte: now } };
    if (after)
      filter.$or = [
        { next_evaluation_at: { $gt: after.at, $lte: now } },
        { next_evaluation_at: after.at, subject_id: { $gt: oid(after.subject_id) } },
      ];
    const rows = await getSalesOutreachProjectionModel()
      .find(filter, { subject_id: 1, next_evaluation_at: 1 })
      .sort({ next_evaluation_at: 1, subject_id: 1 })
      .limit(limit)
      .lean();
    return rows.map((row) => ({ subject_id: String(row.subject_id), next_evaluation_at: row.next_evaluation_at as Date }));
  },

  async readReconcileCursor(session) {
    const row = await getSalesIntelligenceSyncStateModel().findOne({ scope: OUTREACH_EVALUATION_RECONCILE_SCOPE }).session(session).lean();
    const id = (row?.cursor as { outreach_subject_id?: unknown } | undefined)?.outreach_subject_id;
    return id ? String(id) : null;
  },

  async writeReconcileCursor(subjectId, session) {
    await getSalesIntelligenceSyncStateModel().updateOne(
      { scope: OUTREACH_EVALUATION_RECONCILE_SCOPE },
      { $set: { "cursor.outreach_subject_id": subjectId ? oid(subjectId) : null } },
      { session, upsert: true },
    );
  },

  async subjectIdsAfter(afterId, limit, session) {
    const rows = await getSalesOutreachSubjectModel()
      .find(afterId ? { _id: { $gt: oid(afterId) } } : {}, { _id: 1 })
      .sort({ _id: 1 })
      .limit(limit)
      .session(session)
      .lean();
    return rows.map((row) => String(row._id));
  },

  async projectionPolicies(subjectIds, session) {
    const out = new Map<string, string | null>();
    if (!subjectIds.length) return out;
    const rows = await getSalesOutreachProjectionModel()
      .find({ subject_id: { $in: subjectIds.map(oid) } }, { subject_id: 1, policy_fingerprint: 1 })
      .session(session)
      .lean();
    for (const row of rows) out.set(String(row.subject_id), (row as { policy_fingerprint?: string }).policy_fingerprint ?? null);
    return out;
  },

  async enqueue(job, session) {
    try {
      await enqueueCsiJob(job, session);
      return "enqueued";
    } catch (error) {
      if (error instanceof CsiError && error.code === "IDEMPOTENCY_CONFLICT") return "conflict";
      throw error;
    }
  },
};

/** Projection fields as stored (ObjectId references). */
function toStoredProjection(doc: ProjectionWrite): Record<string, unknown> {
  const stored: Record<string, unknown> = { ...doc };
  for (const key of ["assigned_agent_id", "period_id"] as const)
    if (key in doc) stored[key] = doc[key] && mongoose.isValidObjectId(doc[key]) ? oid(String(doc[key])) : null;
  return stored;
}
