import mongoose, { type ClientSession } from "mongoose";
import type {
  SalesOutreachLeadModel,
  SalesOutreachPeriodStartKind,
  SalesOutreachWorkflow,
} from "../../../config/domain/salesOutreach";
import { getCallLeadModel } from "../../../models/CallLead";
import { getFormLeadModel } from "../../../models/FormLead";
import { getGranotObservationModel } from "../../../models/GranotObservation";
import { getNumberLeadAttachmentModel } from "../../../models/NumberLeadAttachment";
import { getRepIdentityLinkModel } from "../../../models/RepIdentityLink";
import { getSalesOutreachPolicyPeriodModel, getSalesOutreachSubjectModel } from "../../../models/salesOutreach";
import { enqueueCsiJob } from "../../salesIntelligence/jobs";
import { DESK_LEAD_PROJECTION, deskLeadKey, toDeskLeadFacts, type DeskLeadFacts, type DeskLeadRef } from "./leadFacts";
import type { NewPeriod } from "./periodPlanner";
import type { DeskReceivedFacts, DeskSubjectFacts } from "./subjectBuilder";

/** How a subject entered the desk (`sales_outreach_subjects.enrollment`). */
export type DeskEnrollment = Readonly<{
  cohort_id: string;
  kind: "pilot" | "intake" | "expansion";
  enrolled_at: Date;
  /** Fixed boundary: nothing is due before it (P10a cohort activation / intake admission). */
  activation_at: Date;
  manifest_hash: string | null;
}>;

export type DeskSubjectStatus = "active" | "closed" | "review";

export type DeskSubjectRow = DeskSubjectFacts &
  Readonly<{
    id: string;
    lead: DeskLeadRef;
    enrollment: DeskEnrollment;
    status: DeskSubjectStatus;
    review_reasons: string[];
    assignment_revision: number;
    revision: number;
  }>;

export type DeskPeriodRow = Readonly<{
  id: string;
  subject_id: string;
  transition_key: string;
  workflow: SalesOutreachWorkflow;
  start_kind: SalesOutreachPeriodStartKind;
  priority: string | null;
  started_at: Date;
  ended_at: Date | null;
  end_reason: string | null;
}>;

export type NewSubject = Omit<DeskSubjectRow, "id" | "revision">;
export type SubjectUpdate = Partial<Omit<DeskSubjectRow, "id" | "lead" | "enrollment" | "revision">>;
/** Period provenance written with every new period (age anchor through the restored adapter). */
export type PeriodProvenance = Readonly<{
  policy_version: string;
  activation_boundary: Date;
  received: DeskReceivedFacts;
}>;

/**
 * Every read and write the subject services need. All methods run inside the caller's transaction
 * session; reads are bounded by the caller's page (≤ 100 Leads) and use declared indexes.
 * The Mongo implementation is proven on the replica (`ops/sales-outreach/subjects.replica.ts`); unit
 * tests use `MemoryDeskSubjectStore` (`testing.ts`).
 */
export type DeskSubjectStore = {
  loadLeads(refs: readonly DeskLeadRef[], session: ClientSession): Promise<DeskLeadFacts[]>;
  findSubjects(refs: readonly DeskLeadRef[], session: ClientSession): Promise<DeskSubjectRow[]>;
  findPeriods(subjectId: string, session: ClientSession): Promise<DeskPeriodRow[]>;
  /** Agents (of `agentIds`) with a reviewed `sales_rep` identity link effective at `at`. */
  reviewedRepIds(agentIds: readonly string[], at: Date, session: ClientSession): Promise<Set<string>>;
  /** Lead key → Contact Number ids the Lead is `attached` to. */
  attachedNumberIds(refs: readonly DeskLeadRef[], session: ClientSession): Promise<Map<string, string[]>>;
  /** Normalized Job Number → how many non-duplicate Form/Call Leads carry it. */
  jobNumberLeadCounts(jobNumbers: readonly string[], session: ClientSession): Promise<Map<string, number>>;
  /** Lead keys with a blank/malformed Granot priority update newer than their last accepted one (P05e). */
  priorityUncertainLeads(facts: readonly DeskLeadFacts[], session: ClientSession): Promise<Set<string>>;
  insertSubject(subject: NewSubject, session: ClientSession): Promise<string>;
  /** CAS on `revision`; false when another writer moved it first. */
  updateSubject(id: string, expectedRevision: number, update: SubjectUpdate, session: ClientSession): Promise<boolean>;
  /** Ends the active period `id`; false when it is no longer the active one. */
  closePeriod(id: string, endedAt: Date, endReason: string, session: ClientSession): Promise<boolean>;
  insertPeriod(subjectId: string, period: NewPeriod, provenance: PeriodProvenance, session: ClientSession): Promise<string>;
  /** Nominates the subject's `outreach_evaluate` job for this subject revision (consumer: evaluator wiring). */
  requestEvaluation(subjectId: string, subjectRevision: number, session: ClientSession): Promise<void>;
};

const oid = (id: string) => new mongoose.Types.ObjectId(id);
const leadModel = (model: SalesOutreachLeadModel) => (model === "FormLead" ? getFormLeadModel() : getCallLeadModel());
const MAX_OBSERVATIONS = 500;

type SubjectLean = Record<string, unknown> & {
  _id: unknown;
  lead_model: SalesOutreachLeadModel;
  lead_id: unknown;
  enrollment: Record<string, unknown>;
  display: Record<string, unknown>;
  priority: Record<string, unknown>;
};

function toSubjectRow(row: SubjectLean): DeskSubjectRow {
  const enrollment = row.enrollment as { cohort_id: string; kind: DeskEnrollment["kind"]; enrolled_at: Date; activation_at: Date; manifest_hash: string | null };
  const priority = row.priority as { raw: string | null; accepted_at: Date | null; observation_id: unknown; basis: DeskSubjectRow["priority"]["basis"]; uncertain?: boolean };
  return {
    id: String(row._id),
    lead: { model: row.lead_model, id: String(row.lead_id) },
    enrollment: { ...enrollment, manifest_hash: enrollment.manifest_hash ?? null },
    status: row.status as DeskSubjectStatus,
    review_reasons: [...((row.review_reasons as string[]) ?? [])],
    received_at: (row.received_at as Date | null) ?? null,
    received_date: (row.received_date as string | null) ?? null,
    received_quality: row.received_quality as DeskSubjectRow["received_quality"],
    adapter_version: row.adapter_version as DeskSubjectRow["adapter_version"],
    display: row.display as unknown as DeskSubjectRow["display"],
    priority: {
      raw: priority.raw ?? null,
      accepted_at: priority.accepted_at ?? null,
      observation_id: priority.observation_id ? String(priority.observation_id) : null,
      basis: priority.basis,
      uncertain: priority.uncertain === true,
    },
    assigned_agent_id: row.assigned_agent_id ? String(row.assigned_agent_id) : null,
    assignment_revision: Number(row.assignment_revision ?? 0),
    lead_revision_seen: Number(row.lead_revision_seen ?? 0),
    contact_number_ids: ((row.contact_number_ids as unknown[]) ?? []).map(String),
    revision: Number(row.revision ?? 1),
  };
}

/** Subject fields as stored (ObjectId references; priority observation id). */
function toStored(update: SubjectUpdate): Record<string, unknown> {
  const stored: Record<string, unknown> = { ...update };
  if ("assigned_agent_id" in update) stored.assigned_agent_id = update.assigned_agent_id ? oid(update.assigned_agent_id) : null;
  if (update.contact_number_ids) stored.contact_number_ids = update.contact_number_ids.map(oid);
  if (update.priority)
    stored.priority = { ...update.priority, observation_id: update.priority.observation_id ? oid(update.priority.observation_id) : null };
  return stored;
}

export const mongoDeskSubjectStore: DeskSubjectStore = {
  async loadLeads(refs, session) {
    const facts: DeskLeadFacts[] = [];
    for (const model of ["FormLead", "CallLead"] as const) {
      const ids = refs.filter((ref) => ref.model === model).map((ref) => oid(ref.id));
      if (!ids.length) continue;
      const rows = await (leadModel(model) as mongoose.Model<unknown>)
        .find({ _id: { $in: ids } }, DESK_LEAD_PROJECTION)
        .session(session)
        .lean();
      for (const row of rows as Array<Record<string, unknown> & { _id: unknown }>) facts.push(toDeskLeadFacts(model, row));
    }
    return facts;
  },

  async findSubjects(refs, session) {
    if (!refs.length) return [];
    const rows = await getSalesOutreachSubjectModel()
      .find({ $or: refs.map((ref) => ({ lead_model: ref.model, lead_id: oid(ref.id) })) })
      .session(session)
      .lean();
    return (rows as unknown as SubjectLean[]).map(toSubjectRow);
  },

  async findPeriods(subjectId, session) {
    const rows = await getSalesOutreachPolicyPeriodModel()
      .find({ subject_id: oid(subjectId) })
      .sort({ started_at: 1, _id: 1 })
      .limit(1000)
      .session(session)
      .lean();
    return rows.map((row) => ({
      id: String(row._id),
      subject_id: String(row.subject_id),
      transition_key: row.transition_key,
      workflow: row.workflow as SalesOutreachWorkflow,
      start_kind: row.start_kind as SalesOutreachPeriodStartKind,
      priority: row.priority ?? null,
      started_at: row.started_at,
      ended_at: row.ended_at ?? null,
      end_reason: row.end_reason ?? null,
    }));
  },

  async reviewedRepIds(agentIds, at, session) {
    const unique = [...new Set(agentIds)].filter((id) => mongoose.isValidObjectId(id));
    if (!unique.length) return new Set();
    const rows = await getRepIdentityLinkModel()
      .find(
        {
          agent_id: { $in: unique.map(oid) },
          status: "reviewed",
          role_kind: "sales_rep",
          effective_from: { $lte: at },
          $or: [{ effective_to: null }, { effective_to: { $gt: at } }],
        },
        { agent_id: 1 },
      )
      .session(session)
      .lean();
    return new Set(rows.map((row) => String(row.agent_id)));
  },

  async attachedNumberIds(refs, session) {
    const byLead = new Map<string, string[]>();
    if (!refs.length) return byLead;
    const rows = await getNumberLeadAttachmentModel()
      .find(
        { $or: refs.map((ref) => ({ "lead_ref.model": ref.model, "lead_ref.id": oid(ref.id), state: "attached" })) },
        { contact_number_id: 1, lead_ref: 1 },
      )
      .session(session)
      .lean();
    for (const row of rows as Array<{ contact_number_id: unknown; lead_ref: { model: SalesOutreachLeadModel; id: unknown } }>) {
      const key = deskLeadKey({ model: row.lead_ref.model, id: String(row.lead_ref.id) });
      byLead.set(key, [...(byLead.get(key) ?? []), String(row.contact_number_id)]);
    }
    return byLead;
  },

  async jobNumberLeadCounts(jobNumbers, session) {
    const counts = new Map<string, number>();
    const unique = [...new Set(jobNumbers)];
    if (!unique.length) return counts;
    for (const model of ["FormLead", "CallLead"] as const) {
      const rows = await (leadModel(model) as mongoose.Model<unknown>)
        .find({ normalized_job_no: { $in: unique }, duplicate: { $ne: true } }, { normalized_job_no: 1 })
        .session(session)
        .lean();
      for (const row of rows as Array<{ normalized_job_no?: string }>)
        if (row.normalized_job_no) counts.set(row.normalized_job_no, (counts.get(row.normalized_job_no) ?? 0) + 1);
    }
    return counts;
  },

  async priorityUncertainLeads(facts, session) {
    const uncertain = new Set<string>();
    const withJob = facts.filter((f) => f.normalized_job_no);
    if (!withJob.length) return uncertain;
    const rows = await getGranotObservationModel()
      .find(
        {
          "identity.normalized_job_no": { $in: [...new Set(withJob.map((f) => f.normalized_job_no!))] },
          "priority.valid": false,
          "priority.raw": { $exists: true, $ne: null },
        },
        { "identity.normalized_job_no": 1, captured_at: 1 },
      )
      .sort({ captured_at: -1 })
      .limit(MAX_OBSERVATIONS)
      .session(session)
      .lean();
    const newest = new Map<string, Date>();
    for (const row of rows as Array<{ identity?: { normalized_job_no?: string }; captured_at: Date }>) {
      const job = row.identity?.normalized_job_no;
      if (job && !newest.has(job)) newest.set(job, row.captured_at);
    }
    for (const lead of withJob) {
      const seen = newest.get(lead.normalized_job_no!);
      if (seen && (!lead.accepted_observation || +seen > +lead.accepted_observation.captured_at)) uncertain.add(deskLeadKey(lead.ref));
    }
    return uncertain;
  },

  async insertSubject(subject, session) {
    const { lead, enrollment, ...fields } = subject;
    const [created] = await getSalesOutreachSubjectModel().create(
      [{ ...toStored(fields), lead_model: lead.model, lead_id: oid(lead.id), enrollment, revision: 1 }],
      { session },
    );
    return String(created!._id);
  },

  async updateSubject(id, expectedRevision, update, session) {
    const result = await getSalesOutreachSubjectModel().updateOne(
      { _id: oid(id), revision: expectedRevision },
      { $set: { ...toStored(update), revision: expectedRevision + 1 } },
      { session, runValidators: true },
    );
    return result.modifiedCount === 1;
  },

  async closePeriod(id, endedAt, endReason, session) {
    const result = await getSalesOutreachPolicyPeriodModel().updateOne(
      { _id: oid(id), ended_at: null },
      { $set: { ended_at: endedAt, end_reason: endReason }, $inc: { revision: 1 } },
      { session, runValidators: true },
    );
    return result.modifiedCount === 1;
  },

  async insertPeriod(subjectId, period, provenance, session) {
    const [created] = await getSalesOutreachPolicyPeriodModel().create(
      [
        {
          subject_id: oid(subjectId),
          ...period,
          policy_version: provenance.policy_version,
          activation_boundary: provenance.activation_boundary,
          ended_at: null,
          end_reason: null,
          age_anchor: provenance.received.received_date,
          anchor_quality: provenance.received.received_quality,
          adapter_version: provenance.received.adapter_version,
          revision: 1,
        },
      ],
      { session },
    );
    return String(created!._id);
  },

  async requestEvaluation(subjectId, subjectRevision, session) {
    await enqueueCsiJob(evaluationJobInput(subjectId, subjectRevision), session);
  },
};

/** The `outreach_evaluate` job identity for one subject revision (idempotent per revision). */
export function evaluationJobInput(subjectId: string, subjectRevision: number) {
  return {
    stage: "outreach_evaluate" as const,
    subject_key: `outreach-subject:${subjectId}`,
    dedupe_key: `sod:evaluate:${subjectId}:r${subjectRevision}`,
    input_revision: subjectRevision,
    input_refs: [subjectId],
  };
}
