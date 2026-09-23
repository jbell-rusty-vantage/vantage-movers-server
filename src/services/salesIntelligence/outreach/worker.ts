import { randomUUID } from "node:crypto";
import mongoose, { type ClientSession } from "mongoose";
import { withTransaction } from "../../../db";
import { csiFlag } from "../../../config/domain/salesIntelligence";
import { getEntityChangeModel } from "../../../models/EntityChange";
import { getFormLeadModel } from "../../../models/FormLead";
import { getCallLeadModel } from "../../../models/CallLead";
import { getCallInteractionModel } from "../../../models/CallInteraction";
import { getOutreachRecordModel } from "../../../models/OutreachRecord";
import { getOutreachFollowupModel } from "../../../models/OutreachFollowup";
import { getSalesIntelligenceSyncStateModel } from "../../../models/SalesIntelligenceSyncState";
import { MongoLeaseStore, activeTokenFilter } from "../../durableWork/leases";
import { CsiError } from "../auth";
import { claimCsiJob, completeCsiJob, enqueueCsiJob, failCsiJob, type JobInput } from "../jobs";
import { loadCanonicalInteraction } from "../conversations/workerSupport";
import { leadAttachmentJobInput, loadLead } from "../attachment/sources";
import { ensureInteraction, ensureLead, workerContext } from "./ensure";
import { refreshRecord, jsonValue } from "./store";
import { payloadHash } from "../transactions";
import { ATTENTION_PUBLISH_BUDGET_MS, publishAttentionSnapshot } from "./attention";

/** Calls replayed per coalesced `outreach-number:` job; a continuation job carries the rest. */
export const OUTREACH_NUMBER_REPLAY_PAGE = 25;
/** Rows per source per sweep and expired waits nominated per sweep. */
export const OUTREACH_REPAIR_PAGE = 50;
const OPEN_OUTREACH_STATES = ["unworked", "open", "waiting_on_customer", "identity_review"] as const;

/**
 * Coalesced replay of every canonical call on one Contact Number after an
 * attachment revision (17 §7). `after` is the keyset continuation; the page is
 * small because each `ensureInteraction` is many reads inside one transaction.
 */
export async function replayNumberInteractions(numberId: string, revision: number, session: ClientSession, requestId: string, after?: string) {
  const rows = await getCallInteractionModel().find({ contact_number_id: numberId, merged_into_id: null,
    ...(after ? { _id: { $gt: after } } : {}) }).sort({ _id: 1 }).limit(OUTREACH_NUMBER_REPLAY_PAGE).session(session).lean();
  const context = workerContext(session, requestId);
  for (const row of rows) await ensureInteraction(row, context);
  if (rows.length === OUTREACH_NUMBER_REPLAY_PAGE) {
    const last = String(rows.at(-1)!._id);
    await enqueueCsiJob({ stage: "outreach_ensure", subject_key: `outreach-number:${numberId}`,
      dedupe_key: `csi:outreach:number:${numberId}:${revision}:after:${last}`, input_revision: revision, input_refs: [numberId, last] }, session);
  }
  return rows.length;
}

export async function runOutreachEnsureJob(jobId?: string) {
  if (!csiFlag("OUTREACH_ENSURE")) return { status: "disabled" };
  const job = await claimCsiJob(`outreach:${randomUUID()}`, jobId, 300_000, "outreach_ensure");
  if (!job) return { status: "not_claimable" };
  const lease = { job_id: String(job._id), owner: job.lease_owner!, epoch: job.lease_epoch };
  try {
    await completeCsiJob(lease, async session => {
      if (!csiFlag("OUTREACH_ENSURE")) throw new CsiError("FEATURE_DISABLED");
      const context = workerContext(session, lease.job_id), first = String(job.input_refs[0] ?? "");
      if (!first) throw new CsiError("INVALID_INPUT");
      if (job.subject_key.startsWith("outreach-lead:")) {
        const model = job.subject_key.split(":")[1];
        if (model !== "FormLead" && model !== "CallLead") throw new CsiError("INVALID_INPUT");
        // H1: the raising EntityChange id rides in input_refs[1] so basis and source_change_id are exact.
        const changeId = job.input_refs[1] ? String(job.input_refs[1]) : null;
        await ensureLead({ model, id: first }, context, undefined, { changeId });
      } else if (job.subject_key.startsWith("outreach-clock:")) {
        const record = await getOutreachRecordModel().findById(first).session(session);
        if (record) {
          if (record.subject.kind === "lead") await ensureLead({ model: record.subject.model!, id: String(record.subject.id) }, context);
          const current = await getOutreachRecordModel().findById(first).session(session);
          if (current) await refreshRecord(current, context, "clock_boundary", current.toObject());
        }
      } else if (job.subject_key.startsWith("outreach-number:")) {
        const after = job.input_refs[1] ? String(job.input_refs[1]) : undefined;
        return { replayed: await replayNumberInteractions(first, job.input_revision, session, lease.job_id, after) };
      } else {
        const call = await loadCanonicalInteraction(first, session);
        await ensureInteraction(call, context);
      }
      return undefined;
    }, { resultFrom: value => value });
    return { status: "completed" };
  } catch (error) {
    if (error instanceof CsiError && error.code === "LEASE_LOST") return { status: "lease_lost" };
    await failCsiJob(lease, "transient"); return { status: "retry" };
  }
}
/**
 * One invocation, one clock. `deadline` is an absolute epoch millisecond so a
 * caller that already spent part of the invocation passes what is left rather
 * than starting a fresh 40-second budget of its own (14 §5).
 */
export const OUTREACH_ENSURE_BUDGET_MS = 40_000;
export async function drainOutreachEnsureJobs(max = 50, options: { deadline?: number } = {}) {
  const outcomes: string[] = [], deadline = options.deadline ?? Date.now() + OUTREACH_ENSURE_BUDGET_MS;
  for (let i = 0; i < max && Date.now() < deadline; i++) {
    const result = await runOutreachEnsureJob(); outcomes.push(result.status);
    if (["not_claimable", "disabled", "lease_lost"].includes(result.status)) break;
  }
  return { outcomes, deadline_reached: Date.now() >= deadline };
}

type RepairSource = "FormLead" | "CallLead" | "CallInteraction" | "OutreachRecord";
type RepairRow = { _id: unknown; projection_revision?: number; contact_number_id?: unknown; revision?: number;
  booked?: unknown; cancelled?: unknown; duplicate?: boolean; bad_lead?: unknown; no_sync?: boolean;
  granot_priority?: unknown; quoted?: unknown };

/** H2: the commit-lag re-scan window. `applied_at` is taken before the transaction runs, so a change can commit after the cursor has passed it. */
export const OUTREACH_CHANGE_RESCAN_MS = 120_000;
/** Lead paths whose change must also re-evaluate the complete normalized-phone match set (H2, §5.2). */
const ATTACHMENT_TRIGGER_PATHS = new Set(["phone_number", "normalized_phone_number", "ingested_contact_snapshot", "granot_contact_snapshot", "ringcentral",
  "current_contact_provenance", "duplicate", "bad_lead", "no_sync", "booked", "cancelled", "timestamp"]);
export function changeTriggersAttachment(change: { revision_before: number; changed_paths: readonly string[] }): boolean {
  return change.revision_before === 0 || change.changed_paths.some(path => ATTACHMENT_TRIGGER_PATHS.has(path) || ATTACHMENT_TRIGGER_PATHS.has(path.split(".")[0]!));
}
export function outreachChangeNomination(change: { _id: unknown; entity: { model: string; id: string }; revision_after: number }): JobInput {
  return { stage: "outreach_ensure", subject_key: `outreach-lead:${change.entity.model}:${change.entity.id}`,
    // `v2`: the job now carries the change id, so its payload differs from rows the pre-LP scan
    // inserted; a versioned key keeps those rows from turning the re-scan into an IDEMPOTENCY_CONFLICT.
    dedupe_key: `csi:outreach:entity-change:v2:${change._id}`, input_revision: Math.max(1, change.revision_after), input_refs: [change.entity.id, String(change._id)] };
}

/**
 * Durable job for one repair-sweep row, or null when the row needs none.
 *
 * Every key is semantic, never a sweep cycle: a Lead by its official flags, a
 * call by its projection revision, an Outreach Record by its own revision. An
 * idle corpus therefore hits the dedupe fence on every later sweep instead of
 * inserting a completed no-op job per row per cycle, which was the dominant
 * `sales_intelligence_jobs` growth (17 §6).
 */
export function outreachRepairNomination(source: RepairSource, row: RepairRow): JobInput | null {
  const id = String(row._id);
  if (source === "CallInteraction") {
    // A call with no Contact Number has no Outreach subject (`ensureInteraction` returns at once);
    // nominating it produced a `number:<interaction id>` subject whose key collided with the
    // `number:null` rows an earlier build stored, which pinned the production sweep (LP-03 hotfix).
    if (!row.contact_number_id) return null;
    const revision = row.projection_revision ?? 1;
    return { stage: "outreach_ensure", subject_key: `number:${row.contact_number_id ?? id}`,
      dedupe_key: `csi:outreach:repair:CallInteraction:${id}:${revision}`, input_revision: revision, input_refs: [id] };
  }
  if (source === "OutreachRecord") {
    const revision = row.revision ?? 1;
    return { stage: "outreach_ensure", subject_key: `outreach-clock:${id}`,
      dedupe_key: `csi:outreach:repair:OutreachRecord:${id}:r${revision}`, input_revision: revision, input_refs: [id] };
  }
  // H3: with LEAD_PROGRESS on, a Priority/Quoted change also re-nominates the Lead, so the sweep
  // recovers any missed accepted change within one lap. Off keeps the old key so no mass
  // re-nomination happens before the dry run.
  const fingerprint = payloadHash(jsonValue({ id, official: { booked: row.booked ?? null, cancelled: row.cancelled ?? null,
    duplicate: row.duplicate ?? false, bad_lead: row.bad_lead ?? null, no_sync: row.no_sync ?? false },
    ...(csiFlag("LEAD_PROGRESS") ? { progress: { granot_priority: row.granot_priority ?? null, quoted: row.quoted ?? null } } : {}) }));
  return { stage: "outreach_ensure", subject_key: `outreach-lead:${source}:${id}`,
    dedupe_key: `csi:outreach:repair:${source}:${id}:${fingerprint}`, input_revision: parseInt(payloadHash(fingerprint).slice(0, 12), 16) + 1, input_refs: [id] };
}

/**
 * Clock job for a wait whose promised date has passed. The boundary itself is
 * the key, so the same expiry is never queued twice, and a wait that is
 * re-dated (Owner correction, snooze) gets its own new boundary.
 */
export function waitExpiryNomination(wait: { _id: unknown; outreach_record_id: unknown; due_at?: Date | null }): JobInput | null {
  if (!wait.due_at) return null;
  return { stage: "outreach_ensure", subject_key: `outreach-clock:${wait.outreach_record_id}`,
    dedupe_key: `csi:outreach:clock:${wait.outreach_record_id}:wait:${wait._id}:${+wait.due_at}`, input_revision: +wait.due_at, input_refs: [String(wait.outreach_record_id)] };
}

/**
 * Durable applied_at scan, due-boundary nominations, and paged semantic repair
 * sweeps. No updatedAt-based official event cursor.
 *
 * Three causes of work stay separate (17 §6): a material source change arrives
 * through EntityChange; a time boundary (an expired wait) is nominated by an
 * indexed due query; the repair sweep catches missed events and legacy rows by
 * semantic fingerprint. Every other clock — first-action deadline, follow-up
 * due, snooze and restriction expiry, going cold — is derived at read time by
 * `derive()` and republished by the Attention cron, so it needs no job.
 *
 * Publishing the Attention snapshot is deliberately NOT part of this run: it
 * does not need the ensure lease, and sharing one meant a drain backlog
 * starved the desk and a publish could start with almost none of the
 * invocation left and be killed mid-walk, which writes nothing and is
 * indistinguishable from `snapshot_budget` (14 §5). See `runAttentionPublishOnce`.
 */
export async function runOutreachEnsureOnce(options: { deadline?: number } = {}) {
  if (!csiFlag("OUTREACH_ENSURE")) return { skipped: true, reason: "disabled", scanned: 0 };
  const deadline = options.deadline ?? Date.now() + OUTREACH_ENSURE_BUDGET_MS;
  const State = getSalesIntelligenceSyncStateModel(), store = new MongoLeaseStore(State);
  const token = await store.acquire({ scope: "outreach_ensure", owner: randomUUID(), now: new Date(), ttl_ms: 300_000 });
  if (!token) return { skipped: true, reason: "lease_held", scanned: 0 };
  try {
    const scanned = await withTransaction(async session => {
      let count = 0;
      const now = new Date();
      const state = await State.findOne({ scope: "outreach_entity_changes" }).session(session).lean();
      const at = state?.cursor?.entity_change_applied_at ?? new Date(0), id = state?.cursor?.entity_change_id ?? new mongoose.Types.ObjectId("000000000000000000000000");
      const Change = getEntityChangeModel();
      // H2.1 commit-lag gap: a change whose transaction committed after the cursor passed its
      // `applied_at` would otherwise be skipped for good. Re-scan the trailing window on every
      // pass (per-change dedupe makes a re-enqueue a no-op) and advance the strict cursor only
      // from the page beyond it, so a busy window can never starve the cursor.
      const overlap = at.getTime() > 0 ? await Change.find({ "entity.model": { $in: ["FormLead", "CallLead"] },
        applied_at: { $gt: new Date(+at - OUTREACH_CHANGE_RESCAN_MS), $lte: at }, _id: { $ne: id } }).sort({ applied_at: 1, _id: 1 }).limit(500).session(session).lean() : [];
      const changes = await Change.find({ "entity.model": { $in: ["FormLead", "CallLead"] }, $or: [{ applied_at: { $gt: at } }, { applied_at: at, _id: { $gt: id } }] }).sort({ applied_at: 1, _id: 1 }).limit(100).session(session).lean();
      const attachmentOn = csiFlag("ATTACHMENT_REFRESH");
      const conflicts: string[] = [];
      for (const change of [...overlap, ...changes]) {
        try { await enqueueCsiJob(outreachChangeNomination(change), session); }
        catch (error) {
          // A row whose stored payload disagrees with today's shape must never pin the cursor; the
          // repair sweep still recovers that Lead. Anything else aborts the pass as before.
          if (!(error instanceof CsiError && error.code === "IDEMPOTENCY_CONFLICT")) throw error;
          conflicts.push(`csi:outreach:entity-change:v2:${change._id}`);
        }
        // H2.2: a create or a contact/eligibility change re-evaluates the complete match set now,
        // instead of waiting for the 5-minute updatedAt watermark (kept as the backstop).
        if (attachmentOn && (change.entity.model === "FormLead" || change.entity.model === "CallLead") && changeTriggersAttachment(change)) {
          const lead = await loadLead({ model: change.entity.model, id: change.entity.id }, session);
          // One job identity (fingerprint + sole-match policy version) shared with the watermark backstop.
          if (lead) await enqueueCsiJob(leadAttachmentJobInput(change.entity.model, change.entity.id, lead), session);
        }
        count++;
      }
      const last = changes.at(-1);
      if (last) await State.updateOne({ scope: "outreach_entity_changes" }, { $set: { "cursor.entity_change_applied_at": last.applied_at, "cursor.entity_change_id": last._id } }, { session, upsert: true });
      // Time boundary: waits whose promised date has passed and is not yet stamped.
      const expired = await getOutreachFollowupModel().find({ status: "open", kind: "wait", due_at: { $lte: now }, wait_expired_at: null })
        .sort({ due_at: 1, _id: 1 }).limit(OUTREACH_REPAIR_PAGE).session(session).lean();
      // A stored row whose payload disagrees with today's shape must never pin the scan: skip it,
      // log it, and let the cursor advance (the same tolerance the change scan has).
      const enqueueTolerant = async (nomination: JobInput) => {
        try { await enqueueCsiJob(nomination, session); count++; }
        catch (error) { if (!(error instanceof CsiError && error.code === "IDEMPOTENCY_CONFLICT")) throw error; conflicts.push(nomination.dedupe_key); }
      };
      for (const wait of expired) {
        const nomination = waitExpiryNomination(wait);
        if (nomination) await enqueueTolerant(nomination);
      }
      // Rolling _id sweeps recover old records and commits behind a time watermark, without expiring misses.
      for (const source of ["FormLead", "CallLead", "CallInteraction", "OutreachRecord"] as const) {
        const scope = `outreach_repair:${source}`;
        const prior = await State.findOne({ scope }).session(session).lean();
        const after = prior?.cursor?.attachment_source_id;
        const filter = after ? { _id: { $gt: after } } : {};
        const rows: RepairRow[] = source === "FormLead" ? await getFormLeadModel().find(filter).sort({ _id: 1 }).limit(OUTREACH_REPAIR_PAGE).session(session).lean() :
          source === "CallLead" ? await getCallLeadModel().find(filter).sort({ _id: 1 }).limit(OUTREACH_REPAIR_PAGE).session(session).lean() :
          source === "CallInteraction" ? await getCallInteractionModel().find({ ...filter, merged_into_id: null }).sort({ _id: 1 }).limit(OUTREACH_REPAIR_PAGE).session(session).lean() :
          // Closed records need no clock: official closure cannot move them and only an Owner command reopens them.
          await getOutreachRecordModel().find({ ...filter, state: { $in: [...OPEN_OUTREACH_STATES] } }).sort({ _id: 1 }).limit(OUTREACH_REPAIR_PAGE).session(session).lean();
        for (const row of rows) {
          const nomination = outreachRepairNomination(source, row);
          if (nomination) await enqueueTolerant(nomination);
        }
        await State.updateOne({ scope }, { $set: { "cursor.attachment_source_id": rows.length === OUTREACH_REPAIR_PAGE ? rows.at(-1)!._id : null,
          "cursor.provider_modified_watermark": rows.length === OUTREACH_REPAIR_PAGE ? prior?.cursor?.provider_modified_watermark ?? now : now } }, { session, upsert: true });
      }
      const fence = await State.updateOne(activeTokenFilter(token, new Date()), { $set: { "cursor.last_sync_to": new Date() } }, { session });
      if (fence.modifiedCount !== 1) throw new CsiError("LEASE_LOST");
      if (conflicts.length) console.warn(JSON.stringify({ msg: "outreach.job_conflict_skipped", dedupe_keys: conflicts }));
      return count;
    });
    return { skipped: false, scanned, ...(await drainOutreachEnsureJobs(100, { deadline })) };
  } finally { await store.release({ token, now: new Date() }); }
}

export const ATTENTION_PUBLISH_SCOPE = "attention_publish";

/**
 * Attention publish, on its own lease and its own cron entry (14 §5). It
 * competes with nothing, receives the whole invocation budget, and a drain
 * backlog can no longer keep the desk at `pending_projection`.
 */
export async function runAttentionPublishOnce(options: { deadline?: number } = {}) {
  if (!csiFlag("OUTREACH_ENSURE")) return { skipped: true, reason: "disabled" as const };
  const deadline = options.deadline ?? Date.now() + ATTENTION_PUBLISH_BUDGET_MS;
  const State = getSalesIntelligenceSyncStateModel(), store = new MongoLeaseStore(State);
  const token = await store.acquire({ scope: ATTENTION_PUBLISH_SCOPE, owner: randomUUID(), now: new Date(), ttl_ms: 300_000 });
  if (!token) return { skipped: true, reason: "lease_held" as const };
  try {
    const remaining = deadline - Date.now();
    // A walk that cannot finish writes nothing, which is worse than saying so.
    if (remaining < 5_000) return { skipped: true, reason: "insufficient_budget" as const };
    return { skipped: false, attention: await publishAttentionSnapshot({ deadlineMs: remaining }) };
  } finally { await store.release({ token, now: new Date() }); }
}
