import mongoose, { type ClientSession } from "mongoose";
import type { SalesOutreachLeadModel } from "../../../config/domain/salesOutreach";
import { getCallLeadModel } from "../../../models/CallLead";
import { getFormLeadModel } from "../../../models/FormLead";
import { getSalesOutreachEnrollmentRunModel } from "../../../models/salesOutreach";
import type { CsiActor } from "../../salesIntelligence/auth";
import { DESK_LEAD_PROJECTION, toDeskLeadFacts, type DeskLeadFacts, type DeskLeadRef } from "../subjects/leadFacts";

export type EnrollmentRunStatus = "running" | "completed" | "failed" | "paused";

export type EnrollmentSkip = Readonly<{ lead: DeskLeadRef; partition: string; reason: string }>;

/** One `sales_outreach_enrollment_runs` document as the services use it. */
export type EnrollmentRunRow = Readonly<{
  run_key: string;
  mode: "apply" | "verify";
  kind: "pilot" | "intake" | "expansion";
  cohort_id: string;
  manifest_hash: string;
  /** Fixed at the moment of apply; retries never reprice it (P10a). */
  activation_at: Date;
  configuration_version: string;
  algorithm_version: string;
  selected_leads: DeskLeadRef[];
  status: EnrollmentRunStatus;
  /** Index into `selected_leads` of the next Lead to process. */
  next_index: number;
  last_committed_batch: number;
  counts: Record<string, number>;
  /** Skipped Leads (bounded) and the last pause reason. */
  results: { skipped: EnrollmentSkip[]; pause_reason: string | null; verify?: unknown };
  lease_owner: string | null;
  lease_epoch: number;
  leased_until: Date | null;
  started_at: Date;
  finished_at: Date | null;
}>;

export type EnrollmentLease = Readonly<{ run_key: string; owner: string; epoch: number }>;

export type NewEnrollmentRun = Omit<EnrollmentRunRow, "lease_owner" | "lease_epoch" | "leased_until" | "finished_at"> & { actor: CsiActor };

export type LeadScanFilter = Readonly<{
  /** Prefilter: stored `timestamp` on or after this (the precise received-date test is the classifier's). */
  timestamp_from?: Date;
  /** Prefilter alternative: Form Lead `move_date` on or after this. */
  move_date_from?: Date;
  /** Only Leads whose stored `timestamp` is before this (the "older" listing). */
  timestamp_before?: Date;
  /** Only Leads whose `_id` (24-hex ObjectId) is on or after this: bounds the `_id` walk (olr B7 branch `w`). */
  id_from?: string;
  /** Only Leads whose `_id` (24-hex ObjectId) is before this (olr B7 branch `u`, older Leads with upcoming moves). */
  id_before?: string;
}>;

/**
 * Index on a collection the desk reads but does not own (olr B7): the enrollment candidates' upcoming-move
 * branch (`move_date ≥ today`, `_id` below the received-window bound, newest first) reads it instead of
 * walking every older Form Lead. Built by `pnpm outreach:indexes`; creating it writes no Lead.
 */
export const SALES_OUTREACH_FORM_LEAD_READ_INDEXES = [{ name: "sod_form_lead_move_date", key: { move_date: 1, _id: -1 } }] as const;

const minHex = (a: string | undefined, b: string | undefined) => (a === undefined ? b : b === undefined ? a : a < b ? a : b);

/** The `find` of one `scanLeads` page (pure; the replica proof explains exactly this query). */
export function leadScanQuery(
  model: SalesOutreachLeadModel,
  page: Readonly<{ after_id: string | null; limit: number; direction: 1 | -1; filter: LeadScanFilter | null }>,
): { filter: Record<string, unknown>; sort: { _id: 1 | -1 }; limit: number } {
  const f = page.filter;
  const after = page.after_id?.toLowerCase();
  const idRange: Record<string, unknown> = {};
  const lower = page.direction === 1 ? after : undefined;
  const upper = minHex(page.direction === -1 ? after : undefined, f?.id_before?.toLowerCase());
  if (lower) idRange.$gt = oid(lower);
  if (f?.id_from) idRange.$gte = oid(f.id_from);
  if (upper) idRange.$lt = oid(upper);
  const filter: Record<string, unknown> = {};
  if (Object.keys(idRange).length) filter._id = idRange;
  if (f?.timestamp_before) filter.timestamp = { $lt: f.timestamp_before };
  const window = [
    ...(f?.timestamp_from ? [{ timestamp: { $gte: f.timestamp_from } }] : []),
    ...(f?.move_date_from && model === "FormLead" ? [{ move_date: { $gte: f.move_date_from } }] : []),
  ];
  if (window.length) filter.$or = window;
  return { filter, sort: { _id: page.direction }, limit: page.limit };
}

/** Skipped Leads kept on the run row (the counts stay complete). */
export const MAX_RECORDED_SKIPS = 2_000;

export type EnrollmentStore = {
  /** Lead facts of one model after `afterId` by `_id` (asc or desc), optionally prefiltered and `_id`-bounded. Read-only. */
  scanLeads(
    model: SalesOutreachLeadModel,
    page: Readonly<{ after_id: string | null; limit: number; direction: 1 | -1; filter: LeadScanFilter | null }>,
  ): Promise<DeskLeadFacts[]>;
  findRun(runKey: string, session?: ClientSession | null): Promise<EnrollmentRunRow | null>;
  insertRun(run: NewEnrollmentRun, session: ClientSession): Promise<void>;
  /** Takes the run's single-writer lease when it is free or expired; null when held, finished or absent. */
  acquireRunLease(runKey: string, owner: string, now: Date, ttlMs: number): Promise<EnrollmentRunRow | null>;
  /** Commits one batch's checkpoint under the lease fence; false when the lease was lost. */
  checkpointRun(
    lease: EnrollmentLease,
    batch: Readonly<{ advance: number; counts: Record<string, number>; skipped: readonly EnrollmentSkip[]; now: Date; ttl_ms: number }>,
    session: ClientSession,
  ): Promise<boolean>;
  /** Ends the lease with a status (`running` keeps the run resumable). */
  releaseRun(lease: EnrollmentLease, status: EnrollmentRunStatus, now: Date, pauseReason?: string | null): Promise<void>;
  /** Upserts the verify document of an apply run (re-runnable; writes nothing else). */
  saveVerifyRun(apply: EnrollmentRunRow, results: Readonly<{ counts: Record<string, number>; verify: unknown }>, actor: CsiActor, now: Date): Promise<void>;
};

const oid = (id: string) => new mongoose.Types.ObjectId(id);

type RunLean = Record<string, unknown> & {
  selected_leads?: Array<{ model: SalesOutreachLeadModel; id: unknown }>;
  cursor?: { next_index?: number } | null;
  results?: { skipped?: Array<{ lead: { model: SalesOutreachLeadModel; id: string }; partition: string; reason: string }>; pause_reason?: string | null; verify?: unknown };
};

function toRun(row: RunLean): EnrollmentRunRow {
  return {
    run_key: String(row.run_key),
    mode: row.mode as EnrollmentRunRow["mode"],
    kind: row.kind as EnrollmentRunRow["kind"],
    cohort_id: String(row.cohort_id),
    manifest_hash: String(row.manifest_hash),
    activation_at: row.activation_at as Date,
    configuration_version: String(row.configuration_version),
    algorithm_version: String(row.algorithm_version),
    selected_leads: (row.selected_leads ?? []).map((ref) => ({ model: ref.model, id: String(ref.id) })),
    status: row.status as EnrollmentRunStatus,
    next_index: Number(row.cursor?.next_index ?? 0),
    last_committed_batch: Number(row.last_committed_batch ?? 0),
    counts: { ...((row.counts as Record<string, number>) ?? {}) },
    results: { skipped: [...(row.results?.skipped ?? [])], pause_reason: row.results?.pause_reason ?? null, verify: row.results?.verify },
    lease_owner: (row.lease_owner as string | null) ?? null,
    lease_epoch: Number(row.lease_epoch ?? 0),
    leased_until: (row.leased_until as Date | null) ?? null,
    started_at: row.started_at as Date,
    finished_at: (row.finished_at as Date | null) ?? null,
  };
}

const leadModel = (model: SalesOutreachLeadModel) =>
  (model === "FormLead" ? getFormLeadModel() : getCallLeadModel()) as unknown as mongoose.Model<Record<string, unknown>>;

export const mongoEnrollmentStore: EnrollmentStore = {
  async scanLeads(model, page) {
    const { filter, sort, limit } = leadScanQuery(model, page);
    const rows = await leadModel(model).find(filter, DESK_LEAD_PROJECTION).sort(sort).limit(limit).lean();
    return (rows as Array<Record<string, unknown> & { _id: unknown }>).map((row) => toDeskLeadFacts(model, row));
  },

  async findRun(runKey, session) {
    const row = await getSalesOutreachEnrollmentRunModel().findOne({ run_key: runKey }).session(session ?? null).lean();
    return row ? toRun(row as unknown as RunLean) : null;
  },

  async insertRun(run, session) {
    await getSalesOutreachEnrollmentRunModel().create(
      [
        {
          run_key: run.run_key,
          mode: run.mode,
          kind: run.kind,
          cohort_id: run.cohort_id,
          partition: "all",
          manifest_hash: run.manifest_hash,
          activation_at: run.activation_at,
          configuration_version: run.configuration_version,
          algorithm_version: run.algorithm_version,
          selected_leads: run.selected_leads.map((ref) => ({ model: ref.model, id: oid(ref.id) })),
          status: run.status,
          cursor: { next_index: run.next_index },
          last_committed_batch: run.last_committed_batch,
          counts: run.counts,
          results: run.results,
          started_at: run.started_at,
          actor: { kind: run.actor.kind, id: run.actor.id, request_id: run.actor.request_id, run_id: run.actor.run_id },
        },
      ],
      { session },
    );
  },

  async acquireRunLease(runKey, owner, now, ttlMs) {
    const row = await getSalesOutreachEnrollmentRunModel().findOneAndUpdate(
      {
        run_key: runKey,
        mode: "apply",
        status: { $in: ["running", "paused"] },
        $or: [{ leased_until: null }, { leased_until: { $lte: now } }],
      },
      { $set: { lease_owner: owner, leased_until: new Date(+now + ttlMs), status: "running" }, $inc: { lease_epoch: 1, revision: 1 } },
      { returnDocument: "after" },
    );
    return row ? toRun(row.toObject() as unknown as RunLean) : null;
  },

  async checkpointRun(lease, batch, session) {
    const counts = Object.fromEntries(Object.entries(batch.counts).map(([key, value]) => [`counts.${key}`, value]));
    const result = await getSalesOutreachEnrollmentRunModel().updateOne(
      { run_key: lease.run_key, lease_owner: lease.owner, lease_epoch: lease.epoch, leased_until: { $gt: batch.now } },
      {
        $inc: { "cursor.next_index": batch.advance, last_committed_batch: 1, revision: 1, ...counts },
        $set: { leased_until: new Date(+batch.now + batch.ttl_ms) },
        ...(batch.skipped.length ? { $push: { "results.skipped": { $each: [...batch.skipped], $slice: MAX_RECORDED_SKIPS } } } : {}),
      },
      { session },
    );
    return result.modifiedCount === 1;
  },

  async releaseRun(lease, status, now, pauseReason = null) {
    await getSalesOutreachEnrollmentRunModel().updateOne(
      { run_key: lease.run_key, lease_owner: lease.owner, lease_epoch: lease.epoch },
      {
        $set: {
          status,
          lease_owner: null,
          leased_until: null,
          "results.pause_reason": pauseReason,
          ...(status === "completed" ? { finished_at: now } : {}),
        },
        $inc: { revision: 1 },
      },
    );
  },

  async saveVerifyRun(apply, results, actor, now) {
    await getSalesOutreachEnrollmentRunModel().updateOne(
      { run_key: `verify:${apply.run_key}` },
      {
        $set: { counts: results.counts, results: { verify: results.verify, skipped: [], pause_reason: null }, finished_at: now, status: "completed" },
        $setOnInsert: {
          mode: "verify",
          kind: apply.kind,
          cohort_id: apply.cohort_id,
          partition: "all",
          manifest_hash: apply.manifest_hash,
          activation_at: apply.activation_at,
          configuration_version: apply.configuration_version,
          algorithm_version: apply.algorithm_version,
          selected_leads: [],
          started_at: now,
          actor: { kind: actor.kind, id: actor.id, request_id: actor.request_id, run_id: actor.run_id },
        },
        $inc: { revision: 1 },
      },
      { upsert: true, runValidators: true },
    );
  },
};
