import mongoose, { type ClientSession } from "mongoose";
import { getCallLeadModel } from "../../../models/CallLead";
import { getContactNumberModel } from "../../../models/ContactNumber";
import { getFormLeadModel } from "../../../models/FormLead";
import { getRepIdentityLinkModel } from "../../../models/RepIdentityLink";
import { getSalesIntelligenceContactRestrictionModel } from "../../../models/SalesIntelligenceContactRestriction";
import { getSalesOutreachFollowupScheduleModel, getSalesOutreachSubjectModel } from "../../../models/salesOutreach";
import { LeadChangeRecorder } from "../../domainCommands/leadChangeEmission";
import type { CanonicalCommandContext } from "../../domainCommands/types";
import { CsiError, type CsiActor } from "../../salesIntelligence/auth";
import { duplicateKey } from "../../salesIntelligence/transactions";
import { enqueueCsiJob, type JobInput } from "../../salesIntelligence/jobs";
import { mongoEvaluationStore, toRestrictionRow, type DeskPlanRow, type DeskRestrictionRow, type EvaluationStore } from "../evaluation/store";
import type { DeskLeadRef } from "../subjects/leadFacts";

/** The Lead's authoritative assignment (IMPL-01: `receiver_agent`), read at the command boundary. */
export type LeadAssignment = Readonly<{
  receiver_agent_id: string | null;
  receiver_agent_source: string | null;
  domain_revision: number;
}>;

export type NewPlan = Readonly<{
  subject_id: string;
  period_id: string | null;
  kind: DeskPlanRow["kind"];
  selected_date: string | null;
  appointment_at: Date | null;
  due_at: Date;
  window_minutes: number | null;
  actor: CsiActor;
  effective_at: Date;
  revision: number;
}>;

export type NewRestriction = Readonly<{
  contact_number_id: string;
  channels: Array<"call" | "text">;
  until: Date | null;
  reason: string;
  actor: CsiActor;
}>;

export type RestrictionListFilter = Readonly<{ state: DeskRestrictionRow["state"] | "all"; after_id: string | null; limit: number }>;

/**
 * Every read and write the desk commands need, inside the command transaction. Reads reuse the
 * evaluation store; writes are CAS-fenced or protected by a unique index:
 * - plans: unique active plan per subject (`sod_followup_active_unique`) + CAS on the active row's revision;
 * - Lead assignment: `LeadChangeRecorder` (EntityChange + `domain_revision` CAS) in the same session;
 * - restrictions: CAS on `revision`.
 * The Mongo implementation is proven on the replica (`ops/sales-outreach/commands.replica.ts`); unit
 * tests use `MemoryDeskCommandStore` (`testing.ts`).
 */
export type DeskCommandStore = Pick<EvaluationStore, "loadSubject" | "loadPeriods" | "loadPlans" | "loadRestrictions"> & {
  loadLeadAssignment(lead: DeskLeadRef, session: ClientSession): Promise<LeadAssignment | null>;
  /** Reviewed `sales_rep` link name for the Agent effective at `at`; null when the Agent has none. */
  reviewedRepName(agentId: string, at: Date, session: ClientSession): Promise<string | null>;
  /** Inserts the new active plan; a concurrent active plan fails with `REVISION_CONFLICT`. */
  insertPlan(plan: NewPlan, session: ClientSession): Promise<string>;
  /** Ends the active plan `planId` at `expectedRevision`; false when it is no longer that active row. */
  endPlan(planId: string, expectedRevision: number, end: { status: "replaced" | "cancelled"; ended_at: Date; revision: number }, session: ClientSession): Promise<boolean>;
  /** Writes `receiver_agent` (source `manual`) and its EntityChange in the session; returns the Lead's new revision. */
  writeLeadAssignment(
    input: { lead: DeskLeadRef; agent_id: string | null; agent_name: string | null; source_value: string; at: Date; context: CanonicalCommandContext },
    session: ClientSession,
  ): Promise<number>;
  /** The subject's assignment after a desk assignment write; CAS on the subject `revision`. */
  updateSubjectAssignment(
    subjectId: string,
    expectedRevision: number,
    set: { assigned_agent_id: string | null; assignment_revision: number; lead_revision_seen: number },
    session: ClientSession,
  ): Promise<boolean>;
  contactNumberExists(id: string, session: ClientSession): Promise<boolean>;
  getRestriction(id: string, session: ClientSession | null): Promise<DeskRestrictionRow | null>;
  listRestrictions(filter: RestrictionListFilter): Promise<DeskRestrictionRow[]>;
  insertRestriction(row: NewRestriction, session: ClientSession): Promise<string>;
  /** CAS on the restriction `revision`; false when another writer moved it first. */
  updateRestriction(id: string, expectedRevision: number, set: Record<string, unknown>, session: ClientSession): Promise<boolean>;
  /** Subjects attached to a Contact Number (≤ 100; `sod_subject_contact_numbers`). */
  subjectIdsForNumber(contactNumberId: string, session: ClientSession): Promise<string[]>;
  /** Enqueues an evaluation job; returns its id and whether this call created it (for the after-commit wake). */
  enqueue(job: JobInput, session: ClientSession, now: Date): Promise<{ job_id: string; created: boolean }>;
};

const oid = (id: string) => new mongoose.Types.ObjectId(id);
const leadModel = (model: DeskLeadRef["model"]) => (model === "FormLead" ? getFormLeadModel() : getCallLeadModel());
const MAX_SUBJECTS_PER_NUMBER = 100;

export const mongoDeskCommandStore: DeskCommandStore = {
  loadSubject: mongoEvaluationStore.loadSubject,
  loadPeriods: mongoEvaluationStore.loadPeriods,
  loadPlans: mongoEvaluationStore.loadPlans,
  loadRestrictions: mongoEvaluationStore.loadRestrictions,

  async loadLeadAssignment(lead, session) {
    const row = await leadModel(lead.model).collection.findOne(
      { _id: oid(lead.id) },
      { projection: { receiver_agent: 1, receiver_agent_source: 1, domain_revision: 1 }, session },
    );
    if (!row) return null;
    return {
      receiver_agent_id: row.receiver_agent ? String(row.receiver_agent) : null,
      receiver_agent_source: (row.receiver_agent_source as string | undefined) ?? null,
      domain_revision: Number(row.domain_revision ?? 0),
    };
  },

  async reviewedRepName(agentId, at, session) {
    if (!mongoose.isValidObjectId(agentId)) return null;
    const row = await getRepIdentityLinkModel()
      .findOne(
        {
          agent_id: oid(agentId),
          status: "reviewed",
          role_kind: "sales_rep",
          effective_from: { $lte: at },
          $or: [{ effective_to: null }, { effective_to: { $gt: at } }],
        },
        { agent_name_snapshot: 1 },
      )
      .session(session)
      .lean();
    return row ? row.agent_name_snapshot : null;
  },

  async insertPlan(plan, session) {
    try {
      const [created] = await getSalesOutreachFollowupScheduleModel().create(
        [
          {
            subject_id: oid(plan.subject_id),
            period_id: plan.period_id ? oid(plan.period_id) : null,
            kind: plan.kind,
            selected_date: plan.selected_date,
            appointment_at: plan.appointment_at,
            due_at: plan.due_at,
            window_minutes: plan.window_minutes,
            actor: plan.actor,
            effective_at: plan.effective_at,
            status: "active",
            ended_at: null,
            end_reason: null,
            revision: plan.revision,
          },
        ],
        { session },
      );
      return String(created!._id);
    } catch (error) {
      if (duplicateKey(error)) throw new CsiError("REVISION_CONFLICT");
      throw error;
    }
  },

  async endPlan(planId, expectedRevision, end, session) {
    const result = await getSalesOutreachFollowupScheduleModel().updateOne(
      { _id: oid(planId), status: "active", revision: expectedRevision },
      { $set: { status: end.status, ended_at: end.ended_at, end_reason: end.status, revision: end.revision } },
      { session, runValidators: true },
    );
    return result.modifiedCount === 1;
  },

  async writeLeadAssignment(input, session) {
    const recorder = new LeadChangeRecorder({ command_name: "sales_outreach_assignment", context: input.context, session, now: input.at });
    await recorder.track(input.lead.model, input.lead.id);
    const update = input.agent_id
      ? {
          $set: {
            receiver_agent: oid(input.agent_id),
            receiver_agent_name_snapshot: input.agent_name,
            receiver_agent_source: "manual",
            receiver_agent_source_value: input.source_value,
            receiver_agent_set_at: input.at,
            updatedAt: input.at,
          },
        }
      : {
          $set: { receiver_agent_source: "manual", receiver_agent_source_value: input.source_value, receiver_agent_set_at: input.at, updatedAt: input.at },
          $unset: { receiver_agent: "", receiver_agent_name_snapshot: "" },
        };
    const written = await leadModel(input.lead.model).collection.updateOne({ _id: oid(input.lead.id) }, update, { session });
    if (written.matchedCount !== 1) throw new CsiError("REVISION_CONFLICT");
    try {
      const [stamp] = await recorder.flush();
      if (!stamp) throw new CsiError("REVISION_CONFLICT");
      return stamp.revision_after;
    } catch (error) {
      if (error instanceof Error && error.message === "DOMAIN_REVISION_CONFLICT") throw new CsiError("REVISION_CONFLICT");
      throw error;
    }
  },

  async updateSubjectAssignment(subjectId, expectedRevision, set, session) {
    const result = await getSalesOutreachSubjectModel().updateOne(
      { _id: oid(subjectId), revision: expectedRevision },
      {
        $set: {
          assigned_agent_id: set.assigned_agent_id ? oid(set.assigned_agent_id) : null,
          assignment_revision: set.assignment_revision,
          lead_revision_seen: set.lead_revision_seen,
          revision: expectedRevision + 1,
        },
      },
      { session, runValidators: true },
    );
    return result.modifiedCount === 1;
  },

  async contactNumberExists(id, session) {
    if (!mongoose.isValidObjectId(id)) return false;
    return (await getContactNumberModel().exists({ _id: oid(id) }).session(session)) !== null;
  },

  async getRestriction(id, session) {
    if (!mongoose.isValidObjectId(id)) return null;
    const row = await getSalesIntelligenceContactRestrictionModel().findById(oid(id)).session(session).lean();
    return row ? toRestrictionRow(row as unknown as Record<string, unknown>) : null;
  },

  async listRestrictions(filter) {
    const query: Record<string, unknown> = {};
    if (filter.state !== "all") query.state = filter.state;
    if (filter.after_id) query._id = { $lt: oid(filter.after_id) };
    const rows = await getSalesIntelligenceContactRestrictionModel().find(query).sort({ _id: -1 }).limit(filter.limit).lean();
    return (rows as unknown as Array<Record<string, unknown>>).map(toRestrictionRow);
  },

  async insertRestriction(row, session) {
    const [created] = await getSalesIntelligenceContactRestrictionModel().create(
      [
        {
          contact_number_id: oid(row.contact_number_id),
          channels: row.channels,
          until: row.until,
          origin: "owner",
          actor: row.actor,
          reason: row.reason,
          state: "active",
          revision: 1,
        },
      ],
      { session },
    );
    return String(created!._id);
  },

  async updateRestriction(id, expectedRevision, set, session) {
    const result = await getSalesIntelligenceContactRestrictionModel().updateOne(
      { _id: oid(id), revision: expectedRevision },
      { $set: { ...set, revision: expectedRevision + 1 } },
      { session, runValidators: true },
    );
    return result.modifiedCount === 1;
  },

  async subjectIdsForNumber(contactNumberId, session) {
    const rows = await getSalesOutreachSubjectModel()
      .find({ contact_number_ids: oid(contactNumberId) }, { _id: 1 })
      .sort({ _id: 1 })
      .limit(MAX_SUBJECTS_PER_NUMBER)
      .session(session)
      .lean();
    return rows.map((row) => String(row._id));
  },

  async enqueue(job, session, now) {
    const row = await enqueueCsiJob(job, session, now);
    // `enqueueCsiJob` is insert-only and stamps `createdAt: now` on insert: a row created by this
    // call carries exactly this instant; an existing duplicate keeps its own.
    return { job_id: String(row._id), created: (row as { createdAt?: Date }).createdAt?.getTime() === now.getTime() };
  },
};

