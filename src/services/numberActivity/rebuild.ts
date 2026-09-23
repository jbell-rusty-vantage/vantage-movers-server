import { randomBytes } from "node:crypto";
import mongoose, { type ClientSession } from "mongoose";
import { withTransaction } from "../../db";
import { logger } from "../../logger";
import { getCallInteractionModel } from "../../models/CallInteraction";
import { getContactNumberModel } from "../../models/ContactNumber";
import { getNumberLeadAttachmentModel } from "../../models/NumberLeadAttachment";
import { getOutreachRecordModel } from "../../models/OutreachRecord";
import { getLeadConversationModel } from "../../models/LeadConversation";
import { getSalesIntelligenceJobModel } from "../../models/SalesIntelligenceJob";
import { csiIdSchema } from "../../validation/v1/salesIntelligence";
import { CsiError, csiWorkerActor, type CsiActor } from "../salesIntelligence/auth";
import { claimCsiJob, completeCsiJob, enqueueCsiJob, failCsiJob, renewCsiJob, type JobLease } from "../salesIntelligence/jobs";
import { appendCsiAudit, executeCsiCommand } from "../salesIntelligence/transactions";
import { toProjection } from "./persistInteraction";
import { boundSearchTerms } from "./searchTerms";
import type { InteractionProjection } from "./types";

/**
 * CSI-04 durable projection rebuild (03 §0 `rebuild.ts`, 04 `POST /numbers/:id/rebuild`).
 *
 * Recomputes a Contact Number's rollups, provider names, search terms and
 * activity bounds from stored evidence only: canonical `call_interactions`
 * (`merged_into_id: null`), `number_lead_attachments`, `outreach_records` and
 * analysed `lead_conversations` (data spec §8: the rebuild is the source of truth
 * for every rollup, including the ones analysis apply and Outreach ensure keep
 * incrementally).
 * It replays stored rows through the same pure shape CSI-02 persists
 * (`toProjection`) and applies the same counting rules, so a rebuilt number
 * equals what incremental capture would have produced. No new business fact
 * is created: classification, eligibility, `last_meaningful_contact_at`,
 * `running_summary` and Owner-set fields are left exactly as stored.
 *
 * The Owner command only enqueues a durable `rebuild` job through the
 * idempotent command ledger; the worker (`runRebuildJob`) does the recount
 * under revision CAS inside `completeCsiJob`. A second run on an unchanged
 * number changes nothing (no revision bump, no audit row).
 */
export const REBUILD_STAGE = "rebuild" as const;
export const REBUILD_ALL_SUBJECT = "numbers:all";
const MAX_PROVIDER_NAMES = 10;
const REBUILD_ALL_BATCH = 500;

// ---------------------------------------------------------------------------
// Pure recount
// ---------------------------------------------------------------------------

export type RebuildRollups = {
  interactions_total: number;
  inbound_total: number;
  outbound_total: number;
  human_conversations_total: number;
  last_inbound_at: Date | null;
  last_outbound_at: Date | null;
  last_human_conversation_at: Date | null;
  last_meaningful_contact_at: Date | null;
  attached_lead_count: number;
  candidate_lead_count: number;
  open_outreach_count: number;
  /** Σ `recordings.length` over canonical interactions (purged interactions hold none). */
  recordings_total: number;
  /** Lead Conversations with `latest_completed_run_id` set and `content_purged_at` null. */
  conversations_analyzed_total: number;
  /** Newest `started_at` among those conversations. */
  last_analyzed_at: Date | null;
  /** Outreach Records with this Number as primary or as subject, `purged_at` null. */
  outreach_records_total: number;
};

/** The rebuild's reads of analysed conversations on one Number. */
export type AnalyzedConversationEvidence = { total: number; last_started_at: Date | null };

export type RebuiltFields = {
  rollups: RebuildRollups;
  provider_names: string[];
  search_terms: string[];
  first_observed_at: Date;
  last_activity_at: Date;
};

export type AttachmentEvidence = {
  state: "candidate" | "ambiguous" | "attached" | "rejected";
  lead_snapshot?: { name?: string | null; job_no?: string | null; receiver_agent_name?: string | null } | null;
};

export type RecountInput = {
  number: {
    first_observed_at: Date;
    last_activity_at: Date;
    rollups: { last_meaningful_contact_at?: Date | null };
  };
  /** Canonical interactions only (`merged_into_id: null`), any order. */
  interactions: readonly InteractionProjection[];
  attachments: readonly AttachmentEvidence[];
  open_outreach_count: number;
  /** Absent in callers that predate S1; the recount then reads zero. */
  analyzed_conversations?: AnalyzedConversationEvidence;
  outreach_records_total?: number;
};

export function recountNumber(input: RecountInput): RebuiltFields {
  const ordered = [...input.interactions].sort((a, b) => a.started_at.getTime() - b.started_at.getTime());
  const rollups: RebuildRollups = {
    interactions_total: ordered.length,
    inbound_total: ordered.filter((i) => i.direction === "Inbound").length,
    outbound_total: ordered.filter((i) => i.direction === "Outbound").length,
    human_conversations_total: ordered.filter((i) => i.contact_type === "human_conversation").length,
    last_inbound_at: latest(ordered.filter((i) => i.direction === "Inbound")),
    last_outbound_at: latest(ordered.filter((i) => i.direction === "Outbound")),
    last_human_conversation_at: latest(ordered.filter((i) => i.contact_type === "human_conversation")),
    // Team C semantics; never derived here.
    last_meaningful_contact_at: input.number.rollups.last_meaningful_contact_at ?? null,
    attached_lead_count: input.attachments.filter((a) => a.state === "attached").length,
    candidate_lead_count: input.attachments.filter((a) => a.state === "candidate" || a.state === "ambiguous").length,
    open_outreach_count: input.open_outreach_count,
    recordings_total: ordered.reduce((sum, i) => sum + i.recordings.length, 0),
    conversations_analyzed_total: input.analyzed_conversations?.total ?? 0,
    last_analyzed_at: input.analyzed_conversations?.last_started_at ?? null,
    outreach_records_total: input.outreach_records_total ?? 0,
  };
  const providerNames: string[] = [];
  for (const interaction of ordered) {
    const name = interaction.parties.find((p) => p.role === "external")?.name_raw ?? null;
    if (name && !providerNames.includes(name)) providerNames.push(name);
  }
  while (providerNames.length > MAX_PROVIDER_NAMES) providerNames.shift();
  const terms = new Set<string>();
  for (const name of providerNames) terms.add(name.toLowerCase());
  for (const attachment of input.attachments) {
    if (attachment.state === "rejected") continue;
    for (const value of [attachment.lead_snapshot?.name, attachment.lead_snapshot?.job_no, attachment.lead_snapshot?.receiver_agent_name]) {
      const term = value?.trim().toLowerCase();
      if (term) terms.add(term);
    }
  }
  const search_terms = boundSearchTerms(terms);
  // Repair, not monotone widen: a stale stored window (tombstone, re-pointed
  // number, or a corrupted row) is replaced by the canonical evidence. Capture
  // only widens; rebuild is the path that puts the bounds back on the evidence.
  const first = ordered[0]?.started_at ?? input.number.first_observed_at;
  const last = ordered.at(-1)?.started_at ?? input.number.last_activity_at;
  return { rollups, provider_names: providerNames, search_terms, first_observed_at: first, last_activity_at: last };
}

function latest(rows: readonly InteractionProjection[]): Date | null {
  let out: Date | null = null;
  for (const row of rows) if (!out || row.started_at > out) out = row.started_at;
  return out;
}

export function sameRebuiltFields(current: RebuiltFields, next: RebuiltFields): boolean {
  const time = (d: Date | null | undefined) => (d ? d.getTime() : null);
  const a = current.rollups;
  const b = next.rollups;
  return (
    a.interactions_total === b.interactions_total &&
    a.inbound_total === b.inbound_total &&
    a.outbound_total === b.outbound_total &&
    a.human_conversations_total === b.human_conversations_total &&
    time(a.last_inbound_at) === time(b.last_inbound_at) &&
    time(a.last_outbound_at) === time(b.last_outbound_at) &&
    time(a.last_human_conversation_at) === time(b.last_human_conversation_at) &&
    time(a.last_meaningful_contact_at) === time(b.last_meaningful_contact_at) &&
    a.attached_lead_count === b.attached_lead_count &&
    a.candidate_lead_count === b.candidate_lead_count &&
    a.open_outreach_count === b.open_outreach_count &&
    // A row stored before S1 lacks these fields (lean reads apply no defaults); that
    // is a difference, so the sweep materialises them once, and a rerun is a no-op.
    a.recordings_total === b.recordings_total &&
    a.conversations_analyzed_total === b.conversations_analyzed_total &&
    (a.last_analyzed_at === undefined ? undefined : time(a.last_analyzed_at)) === time(b.last_analyzed_at) &&
    a.outreach_records_total === b.outreach_records_total &&
    JSON.stringify(current.provider_names) === JSON.stringify(next.provider_names) &&
    JSON.stringify([...current.search_terms].sort()) === JSON.stringify([...next.search_terms].sort()) &&
    time(current.first_observed_at) === time(next.first_observed_at) &&
    time(current.last_activity_at) === time(next.last_activity_at)
  );
}

// ---------------------------------------------------------------------------
// Owner command: enqueue (durable, idempotent through the command ledger)
// ---------------------------------------------------------------------------

export type RebuildEnqueueResult = { job_id: string; dedupe_key: string; number_id: string; replayed: boolean };

export function rebuildDedupeKey(numberId: string, commandId: string): string {
  return `csi:rebuild:number:${numberId}:cmd:${commandId}`;
}

export async function enqueueNumberRebuild(input: {
  actor: CsiActor;
  number_id: string;
  expected_revision: number;
  reason: string;
  idempotency_key: string;
}): Promise<RebuildEnqueueResult> {
  csiIdSchema.parse(input.number_id);
  const { response, replayed } = await executeCsiCommand({
    actor: input.actor,
    command: "rebuild_number",
    idempotency_key: input.idempotency_key,
    payload: { number_id: input.number_id, expected_revision: input.expected_revision, reason: input.reason },
    operation: async (ctx) => {
      const number = await getContactNumberModel().findById(input.number_id).session(ctx.session).lean();
      if (!number) throw new CsiError("INVALID_INPUT");
      if (number.revision !== input.expected_revision) throw new CsiError("REVISION_CONFLICT");
      const dedupe_key = rebuildDedupeKey(input.number_id, String(ctx.command_id));
      const job = await enqueueCsiJob(
        {
          dedupe_key,
          stage: REBUILD_STAGE,
          subject_key: `number:${input.number_id}`,
          input_revision: number.revision,
          input_refs: [input.number_id],
        },
        ctx.session,
        ctx.now,
      );
      await appendCsiAudit(ctx, {
        subject_key: `number:${input.number_id}`,
        event_kind: "number.rebuild_requested",
        prior: { revision: number.revision },
        current: { revision: number.revision, job_id: String(job._id), reason: input.reason },
        target_id: input.number_id,
        revision: number.revision,
        kind: "number",
      });
      return { job_id: String(job._id), dedupe_key, number_id: input.number_id };
    },
  });
  return { ...response, replayed };
}

/**
 * Rebuild every Contact Number: one durable `rebuild` job with subject
 * `numbers:all` whose worker fans out per-number jobs in dedupe-keyed batches.
 * Service entry point only (no Owner route in 04 §1); an operator command
 * may call it with a trusted Owner actor.
 */
export async function enqueueRebuildAll(input: { actor: CsiActor; reason: string; idempotency_key: string }) {
  const { response, replayed } = await executeCsiCommand({
    actor: input.actor,
    command: "rebuild_all_numbers",
    idempotency_key: input.idempotency_key,
    payload: { reason: input.reason },
    operation: async (ctx) => {
      const dedupe_key = `csi:rebuild:all:cmd:${String(ctx.command_id)}`;
      const job = await enqueueCsiJob(
        { dedupe_key, stage: REBUILD_STAGE, subject_key: REBUILD_ALL_SUBJECT, input_revision: 1, input_refs: [] },
        ctx.session,
        ctx.now,
      );
      return { job_id: String(job._id), dedupe_key };
    },
  });
  return { ...response, replayed };
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

export type RebuildJobResult =
  | {
      kind: "number";
      number_id: string;
      changed: boolean;
      revision_before: number;
      revision_after: number;
      interactions_total: number;
      rollups_before: JsonRollups;
      rollups_after: JsonRollups;
    }
  | { kind: "all"; numbers: number; jobs_created: number; jobs_existing: number };

export type RebuildOutcome =
  | { status: "not_claimable"; job_id: string | null }
  | { status: "completed"; job_id: string; result: RebuildJobResult }
  | {
      status: "failed";
      job_id: string;
      reason: "transient" | "schema_invalid";
      error_code: "number_missing" | "number_ref_missing" | "revision_conflict" | "idempotency_conflict" | "worker_error";
    }
  | { status: "lease_lost"; job_id: string };

export type RebuildWorkerDeps = {
  now?: () => Date;
  owner?: string;
  ttlMs?: number;
  claim?: typeof claimCsiJob;
  complete?: typeof completeCsiJob;
  fail?: typeof failCsiJob;
  renew?: typeof renewCsiJob;
};

export function defaultRebuildOwner(): string {
  return `csi-rebuild:${randomBytes(8).toString("hex")}`;
}

/** Loads the stored evidence for one number. Read-only. */
export async function loadRebuildEvidence(numberId: string, session?: ClientSession) {
  const oid = new mongoose.Types.ObjectId(numberId);
  const numberQuery = getContactNumberModel().findById(oid);
  const interactionsQuery = getCallInteractionModel().find({ contact_number_id: oid, merged_into_id: null });
  const attachmentsQuery = getNumberLeadAttachmentModel().find({ contact_number_id: oid }, { state: 1, lead_snapshot: 1 });
  const outreachQuery = getOutreachRecordModel().countDocuments({
    state: { $ne: "closed" },
    $or: [{ "subject.contact_number_id": oid }, { primary_contact_number_id: oid }],
  });
  // One record counts once even when the Number is both its primary and its subject.
  const outreachTotalQuery = getOutreachRecordModel().countDocuments({
    purged_at: null,
    $or: [{ "subject.contact_number_id": oid }, { primary_contact_number_id: oid }],
  });
  // `lead_conversation_number_started` {contact_number_id, started_at:-1, _id:-1}: the newest
  // analysed row gives `last_analyzed_at`, the count gives the total.
  const analyzedFilter = { contact_number_id: oid, latest_completed_run_id: { $ne: null }, content_purged_at: null };
  const analyzedCountQuery = getLeadConversationModel().countDocuments(analyzedFilter);
  const analyzedLatestQuery = getLeadConversationModel().findOne(analyzedFilter, { started_at: 1 }).sort({ started_at: -1, _id: -1 });
  if (session) {
    numberQuery.session(session);
    interactionsQuery.session(session);
    attachmentsQuery.session(session);
    outreachQuery.session(session);
    outreachTotalQuery.session(session);
    analyzedCountQuery.session(session);
    analyzedLatestQuery.session(session);
  }
  const [number, interactions, attachments, openOutreach, outreachTotal, analyzedTotal, analyzedLatest] = await Promise.all([
    numberQuery.lean(),
    interactionsQuery.lean(),
    attachmentsQuery.lean(),
    outreachQuery,
    outreachTotalQuery,
    analyzedCountQuery,
    analyzedLatestQuery.lean(),
  ]);
  return {
    number,
    interactions: interactions.map((row) => toProjection(row as unknown as Record<string, unknown>)),
    attachments: attachments.map((a) => ({ state: a.state, lead_snapshot: a.lead_snapshot ?? null })) as AttachmentEvidence[],
    open_outreach_count: openOutreach,
    outreach_records_total: outreachTotal,
    analyzed_conversations: { total: analyzedTotal, last_started_at: analyzedLatest?.started_at ?? null } as AnalyzedConversationEvidence,
  };
}

export async function runRebuildJob(jobId: string | undefined, deps: RebuildWorkerDeps = {}): Promise<RebuildOutcome> {
  const owner = deps.owner ?? defaultRebuildOwner();
  const claim = deps.claim ?? claimCsiJob;
  const complete = deps.complete ?? completeCsiJob;
  const fail = deps.fail ?? failCsiJob;
  const now = deps.now ?? (() => new Date());
  if (jobId !== undefined && !mongoose.Types.ObjectId.isValid(jobId)) return { status: "not_claimable", job_id: jobId };
  const row = await claim(owner, jobId, deps.ttlMs ?? 300_000, REBUILD_STAGE);
  if (!row) return { status: "not_claimable", job_id: jobId ?? null };
  const lease: JobLease = { job_id: String(row._id), owner, epoch: row.lease_epoch };

  try {
    if (row.subject_key === REBUILD_ALL_SUBJECT) {
      const result = await fanOutRebuildAll(lease, now, deps.renew ?? renewCsiJob, deps.ttlMs ?? 300_000);
      await complete(lease, async () => undefined, { result });
      return { status: "completed", job_id: lease.job_id, result };
    }
    const numberId = row.input_refs?.[0] ? String(row.input_refs[0]) : null;
    if (!numberId) {
      await fail(lease, "schema_invalid", 0, { result: { error_code: "number_ref_missing" } });
      return { status: "failed", job_id: lease.job_id, reason: "schema_invalid", error_code: "number_ref_missing" };
    }
    const result = await complete(
      lease,
      async (session) => {
        const evidence = await loadRebuildEvidence(numberId, session);
        if (!evidence.number) throw new NumberMissingError();
        const current: RebuiltFields = {
          rollups: evidence.number.rollups as RebuildRollups,
          provider_names: [...evidence.number.provider_names],
          search_terms: [...evidence.number.search_terms],
          first_observed_at: evidence.number.first_observed_at,
          last_activity_at: evidence.number.last_activity_at,
        };
        const next = recountNumber({
          number: evidence.number,
          interactions: evidence.interactions,
          attachments: evidence.attachments,
          open_outreach_count: evidence.open_outreach_count,
          analyzed_conversations: evidence.analyzed_conversations,
          outreach_records_total: evidence.outreach_records_total,
        });
        const summary: RebuildJobResult = {
          kind: "number",
          number_id: numberId,
          changed: !sameRebuiltFields(current, next),
          revision_before: evidence.number.revision,
          revision_after: evidence.number.revision,
          interactions_total: next.rollups.interactions_total,
          rollups_before: jsonRollups(current.rollups),
          rollups_after: jsonRollups(next.rollups),
        };
        if (!summary.changed) return summary;
        const written = await getContactNumberModel().updateOne(
          { _id: evidence.number._id, revision: evidence.number.revision },
          {
            $set: {
              rollups: next.rollups,
              provider_names: next.provider_names,
              search_terms: next.search_terms,
              first_observed_at: next.first_observed_at,
              last_activity_at: next.last_activity_at,
            },
            $inc: { revision: 1 },
          },
          { session, runValidators: true },
        );
        if (written.modifiedCount !== 1) throw new CsiError("REVISION_CONFLICT");
        summary.revision_after = evidence.number.revision + 1;
        await appendCsiAudit(
          { session, command_id: new mongoose.Types.ObjectId(), now: now(), actor: csiWorkerActor(lease.job_id) },
          {
            subject_key: `number:${numberId}`,
            event_kind: "number.rebuilt",
            prior: {
              revision: evidence.number.revision,
              rollups: summary.rollups_before,
              provider_names: current.provider_names,
              search_terms: current.search_terms,
              first_observed_at: current.first_observed_at.toISOString(),
              last_activity_at: current.last_activity_at.toISOString(),
            },
            current: {
              revision: summary.revision_after,
              rollups: summary.rollups_after,
              provider_names: next.provider_names,
              search_terms: next.search_terms,
              first_observed_at: next.first_observed_at.toISOString(),
              last_activity_at: next.last_activity_at.toISOString(),
              job_id: lease.job_id,
            },
            target_id: numberId,
            revision: summary.revision_after,
            kind: "number",
          },
        );
        return summary;
      },
      // The summary is persisted on the job row inside the same completion transaction.
      { resultFrom: (summary) => summary },
    );
    return { status: "completed", job_id: lease.job_id, result };
  } catch (error) {
    if (error instanceof CsiError && error.code === "LEASE_LOST") {
      return { status: "lease_lost", job_id: lease.job_id };
    }
    if (error instanceof NumberMissingError) {
      await safeFail(fail, lease, "schema_invalid", { error_code: "number_missing" });
      return { status: "failed", job_id: lease.job_id, reason: "schema_invalid", error_code: "number_missing" };
    }
    if (error instanceof CsiError && error.code === "REVISION_CONFLICT") {
      await safeFail(fail, lease, "transient", { error_code: "revision_conflict" });
      return { status: "failed", job_id: lease.job_id, reason: "transient", error_code: "revision_conflict" };
    }
    if (error instanceof CsiError && error.code === "IDEMPOTENCY_CONFLICT") {
      await safeFail(fail, lease, "transient", { error_code: "idempotency_conflict" });
      return { status: "failed", job_id: lease.job_id, reason: "transient", error_code: "idempotency_conflict" };
    }
    logger.error({ msg: "sales_intelligence.rebuild.worker_failed", jobId: lease.job_id, errorName: error instanceof Error ? error.name : "Error" });
    await safeFail(fail, lease, "transient", { error_code: "worker_error" });
    return { status: "failed", job_id: lease.job_id, reason: "transient", error_code: "worker_error" };
  }
}

class NumberMissingError extends Error {
  constructor() {
    super("Contact Number no longer exists");
    this.name = "NumberMissingError";
  }
}

async function safeFail(fail: typeof failCsiJob, lease: JobLease, reason: "transient" | "schema_invalid", result: unknown) {
  try {
    await fail(lease, reason, 0, { result });
  } catch (error) {
    if (!(error instanceof CsiError && error.code === "LEASE_LOST")) throw error;
  }
}

/**
 * Fans out per-number rebuild jobs in dedupe-keyed batches.
 * `input_revision` is fixed at 1 so a retry after capture has bumped a
 * number does not `IDEMPOTENCY_CONFLICT`; the per-number worker reads the
 * live revision. Re-running the same `all` job creates nothing new.
 */
async function fanOutRebuildAll(
  lease: JobLease,
  now: () => Date,
  renew: typeof renewCsiJob,
  ttlMs: number,
): Promise<RebuildJobResult> {
  const ContactNumber = getContactNumberModel();
  const Jobs = getSalesIntelligenceJobModel();
  let created = 0;
  let existing = 0;
  let numbers = 0;
  let after: mongoose.Types.ObjectId | null = null;
  for (;;) {
    await renew(lease, ttlMs);
    const batch: Array<{ _id: mongoose.Types.ObjectId }> = await ContactNumber.find(
      after ? { _id: { $gt: after } } : {},
      { _id: 1 },
    )
      .sort({ _id: 1 })
      .limit(REBUILD_ALL_BATCH)
      .lean();
    if (!batch.length) break;
    numbers += batch.length;
    let batchCreated = 0;
    let batchExisting = 0;
    await withTransaction(async (session) => {
      batchCreated = 0;
      batchExisting = 0;
      for (const number of batch) {
        const dedupe_key = `csi:rebuild:number:${String(number._id)}:all:${lease.job_id}`;
        const prior = await Jobs.findOne({ dedupe_key }, { _id: 1 }).session(session).lean();
        try {
          await enqueueCsiJob(
            {
              dedupe_key,
              stage: REBUILD_STAGE,
              subject_key: `number:${String(number._id)}`,
              input_revision: 1,
              input_refs: [String(number._id)],
            },
            session,
            now(),
          );
          if (prior) batchExisting += 1;
          else batchCreated += 1;
        } catch (error) {
          if (error instanceof CsiError && error.code === "IDEMPOTENCY_CONFLICT") {
            batchExisting += 1;
            continue;
          }
          throw error;
        }
      }
    });
    created += batchCreated;
    existing += batchExisting;
    after = batch.at(-1)!._id;
    if (batch.length < REBUILD_ALL_BATCH) break;
  }
  return { kind: "all", numbers, jobs_created: created, jobs_existing: existing };
}

export type RebuildDrainSummary = { claimed: number; completed: number; failed: number; lease_lost: number; deadline_reached: boolean };

export async function drainRebuildJobs(
  max: number,
  deps: RebuildWorkerDeps = {},
  options: { deadlineMs?: number; now?: () => number } = {},
): Promise<RebuildDrainSummary> {
  const summary: RebuildDrainSummary = { claimed: 0, completed: 0, failed: 0, lease_lost: 0, deadline_reached: false };
  const clock = options.now ?? (() => Date.now());
  const deadline = options.deadlineMs === undefined ? Number.POSITIVE_INFINITY : clock() + options.deadlineMs;
  for (let i = 0; i < max; i += 1) {
    if (clock() >= deadline) {
      summary.deadline_reached = true;
      break;
    }
    const outcome = await runRebuildJob(undefined, deps);
    if (outcome.status === "not_claimable") break;
    summary.claimed += 1;
    if (outcome.status === "completed") summary.completed += 1;
    else if (outcome.status === "failed") summary.failed += 1;
    else summary.lease_lost += 1;
  }
  return summary;
}

type JsonRollups = Record<string, string | number | null>;

function jsonRollups(rollups: RebuildRollups): JsonRollups {
  const out: JsonRollups = {};
  for (const [k, v] of Object.entries(rollups)) {
    out[k] = v instanceof Date ? v.toISOString() : typeof v === "number" ? v : null;
  }
  return out;
}

// ---------------------------------------------------------------------------
// LP-06 bounded First observed repair (§14.2 step 3)
// ---------------------------------------------------------------------------

export type FirstObservedRepairOptions = {
  /** Numbers scanned in this call, in `_id` order. */
  limit: number;
  /** Resume after this Contact Number id (exclusive). */
  after?: string | null;
  /** Dry run unless true. */
  apply: boolean;
  now?: () => Date;
};

export type FirstObservedRepairSummary = {
  apply: boolean;
  scanned: number;
  changed: number;
  unchanged: number;
  /** Numbers with no canonical interaction keep their stored value; counted in `unchanged` too. */
  no_evidence: number;
  errors: number;
  /** Pass as `after` to resume; null when the scan reached the end. */
  next_after: string | null;
  changes: Array<{ id: string; before: string; after: string; direction: "lowered" | "raised" }>;
  error_ids: string[];
};

/** Earliest `started_at` over canonical interactions (`merged_into_id: null`), or null. */
export async function earliestCanonicalStart(numberId: mongoose.Types.ObjectId): Promise<Date | null> {
  const row = await getCallInteractionModel()
    .findOne({ contact_number_id: numberId, merged_into_id: null }, { started_at: 1 })
    .sort({ started_at: 1, _id: 1 })
    .lean();
  return row?.started_at ? new Date(row.started_at) : null;
}

/**
 * Sets `first_observed_at` to the earliest canonical interaction, lowering or
 * raising it, for one bounded, resumable page of Contact Numbers. Touches no
 * other field: `last_activity_at`, rollups and search terms stay as stored
 * (the full rebuild owns those). Each change is a revision-CAS write with a
 * `number.first_observed_repaired` audit row in one transaction; a concurrent
 * capture makes that number an error for this pass, and a rerun picks it up.
 */
export async function repairFirstObservedAt(options: FirstObservedRepairOptions): Promise<FirstObservedRepairSummary> {
  const limit = Math.max(1, Math.min(5_000, Math.trunc(options.limit)));
  if (options.after != null) csiIdSchema.parse(options.after);
  const now = options.now ?? (() => new Date());
  const runId = String(new mongoose.Types.ObjectId());
  const numbers = (await getContactNumberModel()
    .find(options.after ? { _id: { $gt: new mongoose.Types.ObjectId(options.after) } } : {}, {
      _id: 1,
      revision: 1,
      first_observed_at: 1,
    })
    .sort({ _id: 1 })
    .limit(limit)
    .lean()) as Array<{ _id: mongoose.Types.ObjectId; revision: number; first_observed_at: Date }>;
  const summary: FirstObservedRepairSummary = {
    apply: options.apply,
    scanned: 0,
    changed: 0,
    unchanged: 0,
    no_evidence: 0,
    errors: 0,
    next_after: numbers.length === limit ? String(numbers.at(-1)!._id) : null,
    changes: [],
    error_ids: [],
  };
  for (const number of numbers) {
    summary.scanned += 1;
    const id = String(number._id);
    try {
      const earliest = await earliestCanonicalStart(number._id);
      const before = number.first_observed_at ? new Date(number.first_observed_at) : null;
      if (!earliest) {
        summary.no_evidence += 1;
        summary.unchanged += 1;
        continue;
      }
      if (before && before.getTime() === earliest.getTime()) {
        summary.unchanged += 1;
        continue;
      }
      const change = {
        id,
        before: before ? before.toISOString() : "null",
        after: earliest.toISOString(),
        direction: before && earliest > before ? ("raised" as const) : ("lowered" as const),
      };
      if (options.apply) {
        await withTransaction(async (session) => {
          const written = await getContactNumberModel().updateOne(
            { _id: number._id, revision: number.revision },
            { $set: { first_observed_at: earliest }, $inc: { revision: 1 } },
            { session, runValidators: true },
          );
          if (written.modifiedCount !== 1) throw new CsiError("REVISION_CONFLICT");
          await appendCsiAudit(
            { session, command_id: new mongoose.Types.ObjectId(), now: now(), actor: csiWorkerActor(runId) },
            {
              subject_key: `number:${id}`,
              event_kind: "number.first_observed_repaired",
              prior: { revision: number.revision, first_observed_at: change.before },
              current: { revision: number.revision + 1, first_observed_at: change.after, repair_run_id: runId },
              target_id: id,
              revision: number.revision + 1,
              kind: "number",
            },
          );
        });
      }
      summary.changed += 1;
      summary.changes.push(change);
    } catch (error) {
      summary.errors += 1;
      summary.error_ids.push(id);
      logger.error({
        msg: "sales_intelligence.first_observed_repair.failed",
        numberId: id,
        errorName: error instanceof Error ? error.name : "Error",
        code: error instanceof CsiError ? error.code : undefined,
      });
    }
  }
  return summary;
}
