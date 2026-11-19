import { gzipSync, gunzipSync } from "node:zlib";
import { BSON, type ClientSession, type Db, type Document, type ObjectId } from "mongodb";
import { computeChecksum } from "../durableWork/checksum";
import { hashCredentialRedactedPayload } from "../granotLifecycle/receiptEvidence";
import type { SealableAutomationAction } from "../granotHttpCollector/lifecycleStatement";
import { digest } from "./archiveCodec";
import { readArchiveObject, storeArchiveObject } from "./archiveObjects";
import { closedRuns, packClosedRun, unpackClosedRun, type ClosedOperation, type RunArchive } from "./closedAutomationRun";
import { loadClosedOperations } from "./prepareClosedRun";

const day = 86_400_000;
const collection = "granot_automation_runs";
const maxRunBytes = 16 * 1024 * 1024;

function decodeRun(bytes: Buffer, locator: RunArchive, runId: string) {
  if (bytes.length !== locator.bytes || digest(bytes) !== locator.hash) throw new Error("Scheduled run archive checksum mismatch");
  const raw = gunzipSync(bytes, { maxOutputLength: maxRunBytes });
  const row = BSON.deserialize(raw);
  if (String(row._id) !== runId || row.status !== "completed") throw new Error("Scheduled run archive identity mismatch");
  return raw;
}

/** A diagnostic restore reads the exact BSON returned by Mongo, including numeric types. */
export async function readArchivedScheduledRun(db: Db, runId: string, read = readArchiveObject) {
  const index = await closedRuns(db).findOne({ _id: runId });
  const locator = index?.run_archive;
  if (!locator) return null;
  return decodeRun(await read(db.databaseName, locator.hash, locator.generation), locator, runId);
}

async function readRunBytes(db: Db, id: ObjectId, now: Date, session?: ClientSession) {
  const raw = await db.collection(collection).findOne({
    _id: id, operation: "estimates_in_process", workflow: "apply", status: "completed",
    "request_snapshot.scheduled_slot_key": { $type: "string" }, completed_at: { $lte: now },
    archive_summary: { $exists: false }, $or: [{ leased_until: null }, { leased_until: { $lte: now } }, {approval:null,"receipts.0":{$exists:false},"checkpoint.phase":"planned"}],
  }, { raw: true, session, maxTimeMS: 3000 });
  if (!raw) return null;
  if (!Buffer.isBuffer(raw)) throw new Error("Scheduled run archive requires original BSON");
  return raw;
}

/** Check every selected action against its embedded result and every legacy capture against its replay. */
function matchesPlan(run: Document, operations: ClosedOperation[]) {
  const plan = run.plan_snapshot;
  if (plan?.kind !== "estimates_in_process" || plan.schema_version !== 2 || !Array.isArray(plan.actions)
      || !(run.plan_locked_at instanceof Date) || !(run.completed_at instanceof Date)
      || !Array.isArray(run.receipts) || !run.collection_summary || !run.request_snapshot?.scheduled_coverage?.slotKey) return false;
  const checksum = computeChecksum({ checksum_version: 1, artifact_kind: "ingestion_plan", schema_version: 1, payload: plan });
  if (checksum !== run.plan_checksum || (run.approval && run.approval.plan_checksum !== checksum)) return false;
  const actions: SealableAutomationAction[] = plan.actions;
  if (new Set(actions.map(a => a.action_id)).size !== actions.length) return false;
  const approvable = actions.filter(a => "classification" in a ? a.classification === "update" : a.syncable === true);
  const selected = run.approval?.selected_action_ids ?? [];
  if (!Array.isArray(selected) || selected.length !== approvable.length || new Set(selected).size !== selected.length
      || run.receipts.length !== selected.length || operations.length !== run.receipts.filter((row: Document) => row.scheduled_direct !== true).length) return false;
  const selectedIds = new Set(selected);
  const byAction = new Map<string, Document>(run.receipts.map((r: Document) => [r.action_id, r]));
  const byOperation = new Map(operations.map(row => [row.operation, row]));
  return approvable.every(action => {
    const item = action.lifecycle_apply;
    const saved = byAction.get(action.action_id);
    const op = item && byOperation.get(item.operation_id);
    if (saved?.scheduled_direct === true) {
      return !!item && !op && selectedIds.has(action.action_id) && saved.outreach_refresh_completed === true
        && item.operation_id === String(run._id) + ":" + action.action_id
        && item.operation_kind === "lead_snapshot_apply" && typeof saved.lifecycle_receipt_id === "string"
        && ["applied", "already_current", "stale", "unmatched", "policy_blocked", "ambiguous", "invalid", "conflict", "unsupported", "deferred"].includes(saved.outcome)
        && (saved.outcome !== "applied" || (!!saved.decision_id && !!saved.observation_id));
    }
    return !!item && !!saved && !!op && selectedIds.has(action.action_id)
      && item.operation_id === String(run._id) + ":" + action.action_id && op.kind === item.operation_kind
      && (op.result.outcome !== "linked" || (item.expected_target?.model === op.result.target?.model && item.expected_target?.id === op.result.target?.id))
      && op.hash === hashCredentialRedactedPayload(item).payload_sha256
      && saved.outreach_refresh_completed === true && op.receipt === saved.lifecycle_receipt_id
      && op.result.outcome === saved.outcome && op.result.observation_id === saved.observation_id
      && op.result.decision_id === saved.decision_id;
  });
}

export async function reviewScheduledRun(db: Db, id: ObjectId, now: Date) {
  const raw = await readRunBytes(db, id, now);
  if (!raw) return { status: "not_eligible" as const };
  const run = BSON.deserialize(raw);
  const runId = String(id);
  const replay = await loadClosedOperations(db, runId, now, { allowOmittedDecisionEffectRef: true, allowScheduledReplay: true });
  if (replay.reason !== "ready" || !matchesPlan(run, replay.rows)) return { status: "incomplete_evidence" as const };
  return { status: "ready" as const, raw, run, replay, runId };
}

export async function archiveScheduledRun(db: Db, id: ObjectId, now: Date, store = storeArchiveObject) {
  const reviewed = await reviewScheduledRun(db, id, now);
  if (reviewed.status !== "ready") return reviewed.status;
  const { raw, run, runId, replay } = reviewed;
  const replayBytes = packClosedRun(runId, replay.rows);
  const archived = await store(db.databaseName, gzipSync(raw));
  const locator = { hash: archived.hash, generation: archived.generation, bytes: archived.persisted.length };
  if (!decodeRun(archived.persisted, locator, runId).equals(raw)) throw new Error("Scheduled run restore mismatch");
  const operations = await store(db.databaseName, replayBytes);
  const index = { _id: runId, count: replay.rows.length, hash: operations.hash, generation: operations.generation, closed_at: now, run_archive: locator };
  unpackClosedRun(index, operations.persisted);
  const session = db.client.startSession();
  try {
    return await session.withTransaction(async () => {
      const latest = await readRunBytes(db, id, now, session);
      if (!latest?.equals(raw)) return "source_changed";
      const verified = await loadClosedOperations(db, runId, now, { session, allowOmittedDecisionEffectRef: true, allowScheduledReplay: true });
      if (verified.reason !== "ready" || !packClosedRun(runId, verified.rows).equals(replayBytes)) return "source_changed";
      const slot = await db.collection<{ _id: string; purge_at: Date }>("granot_estimates_schedule_slots").findOne(
        { _id: run.request_snapshot.scheduled_coverage.slotKey }, { session, projection: { purge_at: 1 } });
      const retainUntil = new Date(Math.max(+run.createdAt + 9 * day, slot?.purge_at instanceof Date ? +slot.purge_at + day : 0, +now + day));
      // A publish/compact race commits one terminal record and one closed-run index together.
      await closedRuns(db).insertOne(index, { session });
      const unapplied = run.receipts.filter((row: Document) => !["applied", "linked", "already_current"].includes(row.outcome)).length;
      const request=run.request_snapshot;
      await db.collection("granot_completed_estimate_windows").insertOne({
        _id:id,operation:run.operation,status:"completed",createdAt:run.createdAt,purge_at:retainUntil,
        request_snapshot:{scheduled_coverage:request.scheduled_coverage,dateWindow:request.dateWindow,estimatesSelection:request.estimatesSelection,estimatesLane:request.estimatesLane},
        collection_summary:{coverage:{complete:run.collection_summary.coverage?.complete,captured_at:run.collection_summary.coverage?.captured_at},held_rows:run.collection_summary.held_rows},
        archive_summary:{unapplied_actions:unapplied},
      },{session});
      const removed=await db.collection(collection).deleteOne({_id:id,status:"completed"},{session});
      if(removed.deletedCount!==1)throw new Error("Scheduled run closure lost");
      return "archived";
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
  } finally {
    await session.endSession();
  }
}

/** Each two-minute invocation has a separate small run budget, independent of receipt backlog. */
export async function archiveDueScheduledRuns(db: Db, now = new Date(), store = storeArchiveObject) {
  const runs = db.collection(collection);
  const due = await runs.find({ archive_review_at: { $lte: now } }, {
    projection: { _id: 1, status: 1, archive_review_at: 1 }, hint: "granot_scheduled_archive_due", sort: { archive_review_at: 1 }, limit: 16, maxTimeMS: 3000,
  }).toArray();
  const result = { examined: 0, archived: 0, held: 0, failures: 0, oldest_due_at: due[0]?.archive_review_at ?? null };
  async function review({ _id,status }: (typeof due)[number]) {
    result.examined++;
    let next = +now + day;
    let reason: string;
    try {
      const outcome = status === "completed" ? await archiveScheduledRun(db, _id, now, store) : "actionable_run";
      if (outcome === "archived") { result.archived++; return; }
      reason = outcome;
      result.held++;
    } catch {
      result.failures++;
      reason = "archive_verification_or_storage_failed";
      next = +now + 30 * 60000;
    }
    await runs.updateOne({ _id, status, archive_review_at: { $lte: now }, archive_summary: { $exists: false } }, { $set: {
      archive_review_at: new Date(next), archive_review: { status, reason, last_checked_at: now },
    } });
  }
  for (let start=0;start<due.length;start+=4) await Promise.all(due.slice(start,start+4).map(review));
  return result;
}
