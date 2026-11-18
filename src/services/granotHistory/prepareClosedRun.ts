import type { ClientSession, Db } from "mongodb";
import { toObjectId } from "../../utils/objectId";
import { closedRuns, packClosedRun, unpackClosedRun, type ClosedOperation } from "./closedAutomationRun";
import { readArchiveObject, storeArchiveObject } from "./archiveObjects";
import { digest } from "./archiveCodec";
import type { ProcessorResult } from "../granotLifecycle/drainer";
import { currentReceiptReplay } from "../granotLifecycle/receiptReplay";
import { isDeepStrictEqual } from "node:util";

/** Close expired automation runs only. Extension operation IDs have a different contract. */
export async function prepareClosedRun(db: Db, run: string, cutoff: Date) {
  if (!/^[a-f0-9]{24}$/i.test(run)) throw new Error("Invalid Granot run ID");
  if (!Number.isFinite(+cutoff) || +cutoff > Date.now() - 7 * 86400000) throw new Error("Granot closure requires seven days");
  if (await db.collection("granot_automation_runs").findOne({ _id: toObjectId(run) }, { projection: { _id: 1 } })) return { reason: "run_still_present" as const };
  const prepared = await loadClosedOperations(db, run, cutoff);
  if (prepared.reason !== "ready") return prepared;
  if (!prepared.rows.length) return { reason: "run_size" as const };
  return { reason: "ready" as const, bytes: packClosedRun(run, prepared.rows), count: prepared.rows.length };
}

/** Enumerate the actual operation namespace as well as the run's sealed plan, so orphan captures cannot vanish. */
export async function loadClosedOperations(db: Db, run: string, cutoff: Date, session?: ClientSession) {
  const receipts = await db.collection("granot_webhook_receipts").find({ observation_channel: "granot_http_automation",
    channel_operation_id: { $type: "string", $gte: run + ":", $lt: run + ";" } }, {session,projection:{channel_operation_id:1,channel_operation_kind:1,payload_sha256:1,processing:1}})
    .hint("granot_observation_receipt_channel_operation_id_unique").limit(5001).maxTimeMS(3000).toArray();
  if (receipts.length > 5000) return { reason: "run_size" as const };
  if (!receipts.length) return { reason: "ready" as const, rows: [] as ClosedOperation[] };
  if (receipts.some(r => r.processing?.state !== "completed" || !(r.processing.completed_at instanceof Date)
    || r.processing.completed_at >= cutoff || !r.processing.latest_decision_id)) return { reason: "unfinished_or_recent" as const };
  const ds = await db.collection("synchronization_decisions").find({ _id: { $in: receipts.map(r => r.processing.latest_decision_id) } },
    { session, projection: { observation_id:1,outcome:1,effects:1,target:1,decided_at:1 } }).maxTimeMS(3000).toArray();
  const byId = new Map(ds.map(d=>[String(d._id),d]));
  const observations = await db.collection("granot_observations").find({ _id: { $in: ds.map(d => d.observation_id) } },
    { session, projection: { receipt_id: 1 } }).maxTimeMS(3000).toArray();
  const receiptsByObservation = new Map(observations.map(o => [String(o._id), String(o.receipt_id)]));
  const rows: ClosedOperation[] = [];
  for (const r of receipts) {
    const d = byId.get(String(r.processing.latest_decision_id));
    if (!d || receiptsByObservation.get(String(d.observation_id)) !== String(r._id) || !d.outcome || ["pending_match","accepted_for_processing"].includes(d.outcome) || !(d.decided_at instanceof Date) || d.decided_at >= cutoff
      || !/^[a-f0-9]{64}$/i.test(r.payload_sha256) || !r.channel_operation_kind) return { reason: "incomplete_evidence" as const };
    const result = { decision_id:String(d._id), observation_id:String(d.observation_id), outcome:d.outcome,
      effects:d.effects ?? [], ...(d.target ? { target:d.target } : {}) } as ProcessorResult;
    const cached = currentReceiptReplay(r.processing.replay_result, r.processing.latest_decision_id);
    if (cached && (cached.observation_id !== result.observation_id || cached.outcome !== result.outcome ||
        !isDeepStrictEqual(cached.effects, result.effects) || !isDeepStrictEqual(cached.target, result.target)))
      return { reason: "incomplete_evidence" as const };
    rows.push({ operation:r.channel_operation_id, kind:r.channel_operation_kind, hash:r.payload_sha256,
      receipt:String(r._id), result: cached ?? result });
  }
  return { reason: "ready" as const, rows };
}

export async function publishClosedRun(db: Db, run: string, cutoff: Date) {
  const current = await closedRuns(db).findOne({ _id: run });
  if (current) {
    unpackClosedRun(current, await readArchiveObject(db.databaseName, current.hash, current.generation));
    return "previously_closed";
  }
  const result = await prepareClosedRun(db, run, cutoff);
  if (result.reason !== "ready") return result.reason;
  const { hash, persisted, generation } = await storeArchiveObject(db.databaseName, result.bytes);
  const entry = { _id:run, hash, generation, count:result.count, closed_at:new Date() };
  unpackClosedRun(entry, persisted);
  const checked = await prepareClosedRun(db,run,cutoff);
  if (checked.reason !== "ready" || digest(checked.bytes) !== hash) return "source_changed";
  await closedRuns(db).updateOne({ _id:run, hash },{ $setOnInsert:entry },{upsert:true,writeConcern:{w:"majority"}});
  return "closed";
}
