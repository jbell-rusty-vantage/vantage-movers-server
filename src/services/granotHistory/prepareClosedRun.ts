import { BSON } from "mongodb";
import { evidenceFormat } from "./evidencePage";
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
export async function loadClosedOperations(db: Db, run: string, cutoff: Date, options: {
  session?: ClientSession;
  allowOmittedDecisionEffectRef?: boolean;
  allowScheduledReplay?: boolean;
} = {}) {
  const { session, allowOmittedDecisionEffectRef = false } = options;
  const receipts = await db.collection("granot_webhook_receipts").find({ observation_channel: "granot_http_automation",
    channel_operation_id: { $type: "string", $gte: run + ":", $lt: run + ";" } }, {session,projection:{evidence_archive:1,channel_operation_id:1,channel_operation_kind:1,payload_sha256:1,processing:1}})
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
    const proof = r.evidence_archive;
    if (!d && proof?.format === evidenceFormat && proof.generation && proof.decided_at instanceof Date && proof.decided_at < cutoff &&
        /^[a-f0-9]{64}$/.test(proof.hash) && /^[a-f0-9]{64}$/.test(r.payload_sha256) && r.channel_operation_kind) {
      const saved = currentReceiptReplay(r.processing.replay_result,r.processing.latest_decision_id);
      if (saved && proof.replay_hash === digest(BSON.serialize(saved))) {
        rows.push({operation:r.channel_operation_id,kind:r.channel_operation_kind,hash:r.payload_sha256,receipt:String(r._id),result:saved});
        continue;
      }
    }
    // The scheduled caller also verifies these IDs, the operation hash and the terminal disposition
    // against the independently sealed plan and completed action receipt before publication.
    if (!d && !proof?.replay_hash && options.allowScheduledReplay && /^[a-f0-9]{64}$/.test(r.payload_sha256) && r.channel_operation_kind === "lead_snapshot_apply") {
      const saved=currentReceiptReplay(r.processing.replay_result,r.processing.latest_decision_id);
      const verified = saved && ((["already_current", "stale"].includes(saved.outcome) && Array.isArray(saved.effects) && !saved.effects.length) ||
        await verifyEstablishedLink(db, saved, r._id, session));
      if (verified &&
          /^[a-f0-9]{24}$/.test(saved.observation_id) && saved.target && ["FormLead","CallLead"].includes(saved.target.model) &&
          /^[a-f0-9]{24}$/.test(saved.target.id)) {
        rows.push({operation:r.channel_operation_id,kind:r.channel_operation_kind,hash:r.payload_sha256,receipt:String(r._id),result:saved});
        continue;
      }
    }
    if (!d || receiptsByObservation.get(String(d.observation_id)) !== String(r._id) || !d.outcome || ["pending_match","accepted_for_processing"].includes(d.outcome) || !(d.decided_at instanceof Date) || d.decided_at >= cutoff
      || !/^[a-f0-9]{64}$/i.test(r.payload_sha256) || !r.channel_operation_kind) return { reason: "incomplete_evidence" as const };
    const result = { decision_id:String(d._id), observation_id:String(d.observation_id), outcome:d.outcome,
      effects:d.effects ?? [], ...(d.target ? { target:d.target } : {}) } as ProcessorResult;
    const cached = currentReceiptReplay(r.processing.replay_result, r.processing.latest_decision_id);
    if (cached && (cached.observation_id !== result.observation_id || cached.outcome !== result.outcome ||
        !matchesDecisionEffects(cached.effects, result.effects, allowOmittedDecisionEffectRef) || !isDeepStrictEqual(cached.target, result.target)))
      return { reason: "incomplete_evidence" as const };
    rows.push({ operation:r.channel_operation_id, kind:r.channel_operation_kind, hash:r.payload_sha256,
      receipt:String(r._id), result: cached ?? result });
  }
  return { reason: "ready" as const, rows };
}

async function verifyEstablishedLink(db: Db, replay: ProcessorResult, receipt: import("mongodb").ObjectId, session?: ClientSession) {
  const target = replay.target;
  if (replay.outcome !== "linked" || !target || !["FormLead", "CallLead"].includes(target.model) ||
      ![target.id, replay.observation_id, replay.decision_id].every(id => /^[a-f0-9]{24}$/.test(id))) return false;
  const effect = replay.effects?.[0];
  const linkId = effect?.ref?.id;
  if (!linkId || !/^[a-f0-9]{24}$/.test(linkId) || !isDeepStrictEqual(replay.effects, [
    { kind: "record_link_established", ref: { model: "GranotRecordLink", id: linkId }, changed_paths: [] },
  ])) return false;
  const observation = await db.collection("granot_observations").findOne({
    _id: toObjectId(replay.observation_id), receipt_id: receipt,
  }, { session, projection: { "identity.normalized_job_no": 1 } });
  const job = observation?.identity?.normalized_job_no;
  if (typeof job !== "string" || !job) return false;
  const leadId = toObjectId(target.id);
  const link = await db.collection("granot_record_links").findOne({
    _id: toObjectId(linkId), provider: "granot", normalized_job_no: job,
    established_by_decision_id: toObjectId(replay.decision_id), "lead_ref.model": target.model, "lead_ref.id": leadId,
  }, { session, projection: { _id: 1 } });
  return !!link && !!(await db.collection(target.model === "FormLead" ? "form_leads" : "call_leads")
    .findOne({ _id: leadId }, { session, projection: { _id: 1 } }));
}

function matchesDecisionEffects(cached: ProcessorResult["effects"], decision: ProcessorResult["effects"], allowOmittedRef: boolean) {
  if (isDeepStrictEqual(cached, decision)) return true;
  if (!allowOmittedRef || !Array.isArray(cached) || !Array.isArray(decision) || cached.length !== decision.length) return false;

  // Historical replay emitted null for missing Decision refs. Compare that encoding without changing the cached response.
  const comparable = decision.map((effect, i) => {
    const saved = cached[i];
    return effect && saved?.ref === null && Object.hasOwn(saved, "ref") && !Object.hasOwn(effect, "ref")
      ? { ...effect, ref: null }
      : effect;
  });
  return isDeepStrictEqual(cached, comparable);
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
