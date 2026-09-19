import { withTransaction } from "../../../db";
import { getIntelligenceRunModel } from "../../../models/IntelligenceRun";
import { getIntelligenceEvidenceSnapshotModel } from "../../../models/IntelligenceEvidenceSnapshot";
import { getIntelligenceSubmissionModel } from "../../../models/IntelligenceSubmission";
import { getSalesIntelligenceJobModel } from "../../../models/SalesIntelligenceJob";
import { csiDataset } from "../../../config/domain/salesIntelligence";
import { CsiError } from "../auth";
import { appendCsiAudit, payloadHash } from "../transactions";
import { enqueueCsiJob } from "../jobs";
import { validateEnvelopeEvidence, type EvidenceManifestEntry } from "../evidence";
import { intelligenceToolArguments } from "./contracts";
import { readContentSchema } from "./reads";
import { loadAuthorizedRun, fenceAuthorizedLease, type RunAuthorization } from "./lease";
import { newObjectIdHex, toObjectId } from "../../../utils/objectId";

export type SubmissionReceipt = {run_id:string;submission_id:string;application_job_id:string;status:"submitted"};
const receipt = (s:{_id:unknown;run_id:unknown;application_job_id:unknown}):SubmissionReceipt => ({run_id:String(s.run_id),submission_id:String(s._id),application_job_id:String(s.application_job_id),status:"submitted"});
export async function readIntelligenceSubmission(auth: RunAuthorization) {
  if (!auth.claims.tools.includes("submit_intelligence_analysis")) throw new CsiError("RUN_SCOPE_DENIED");
  const run = await loadAuthorizedRun(auth);
  const submission = await getIntelligenceSubmissionModel().findOne({run_id:run._id}).lean();
  return {run_id:String(run._id), status:run.status, submission:submission ? receipt(submission) : null,
    prompt_context:{rendered_prompt:run.rendered_prompt,prompt_version:run.prompt_version,schema_version:run.schema_version,schema_digest:run.schema_digest,mode:run.mode}};
}
/** Immutable intake + manifest + audit + durable application intent. No effects, model or messages. */
export async function submitIntelligenceAnalysis(auth:RunAuthorization, raw:unknown,
  deps:{beforeCommit?:()=>Promise<void>;afterCommit?:()=>Promise<void>} = {}):Promise<SubmissionReceipt> {
  const input = intelligenceToolArguments.submit_intelligence_analysis.parse(raw);
  if (!auth.claims.tools.includes("submit_intelligence_analysis")) throw new CsiError("RUN_SCOPE_DENIED");
  const hash = payloadHash(input.envelope);
  const result = await withTransaction(async session => {
    const run = await loadAuthorizedRun(auth,session);
    const existing = await getIntelligenceSubmissionModel().findOne({run_id:run._id}).session(session).lean();
    if (existing) {
      if (existing.payload_hash !== hash || existing.idempotency_key !== input.idempotency_key) throw new CsiError("SUBMISSION_CONFLICT");
      await fenceAuthorizedLease(auth,run.job_id,session);
      return receipt(existing);
    }
    if (run.finalized_at || run.status !== "running") throw new CsiError("SUBMISSION_CONFLICT");
    const snapshots = await getIntelligenceEvidenceSnapshotModel().find({run_id:run._id,...csiDataset()}).sort({_id:1}).session(session).lean();
    if (!snapshots.length || snapshots.length !== run.evidence_count) throw new CsiError("EVIDENCE_SCOPE_INVALID");
    const manifest:EvidenceManifestEntry[] = [], followups:string[] = [], instructions:Array<{id:string;revision:number}> = [], speakers:string[] = [];
    for (const snapshot of snapshots) {
      const content = readContentSchema.parse(snapshot.response);
      if (snapshot.subject_key !== run.subject_key || payloadHash(content) !== snapshot.content_digest) throw new CsiError("EVIDENCE_SCOPE_INVALID");
      for (const record of content.page.records) manifest.push({snapshot_id:String(snapshot._id),subject_key:run.subject_key,source:"vantage_record",
        conversation_id:null,transcript_version:null,record_type:record.record_type,record_id:record.record_id,field_paths:Object.keys(record.fields)});
      if (content.transcript) {
        const transcript = content.transcript;
        const retained = await getIntelligenceEvidenceSnapshotModel().findOne({_id:transcript.source_snapshot_id,source_type:"transcript",
          conversation_id:transcript.conversation_id,transcript_version:transcript.transcript_version,...csiDataset()}).session(session).lean();
        if (!retained) throw new CsiError("ORIGINAL_EVIDENCE_UNAVAILABLE");
        manifest.push({snapshot_id:String(snapshot._id),subject_key:run.subject_key,source:"transcript",conversation_id:transcript.conversation_id,
          transcript_version:transcript.transcript_version,record_type:null,record_id:null,field_paths:[]});
      }
      followups.push(...content.allowed_followup_ids); instructions.push(...content.instructions); speakers.push(...content.speaker_refs);
    }
    validateEnvelopeEvidence(input.envelope,{subject_key:run.subject_key,snapshots:manifest,allowed_followup_ids:followups,instructions,speaker_refs:speakers});
    const manifest_digest = payloadHash(snapshots.map(s=>({id:String(s._id),digest:s.content_digest})));
    const submissionId = newObjectIdHex();
    const job = await enqueueCsiJob({dedupe_key:`csi:application:run:${run._id}`,stage:"application",subject_key:run.subject_key,
      input_revision:run.revision,input_refs:[String(run._id),submissionId]},session);
    // CSI-13 is absent. Preserve intent without leasing it or spending retry attempts.
    await getSalesIntelligenceJobModel().updateOne({_id:job._id,status:"pending"},{$set:{status:"paused",reason:"consumer_unavailable"}},{session});
    const now = new Date();
    const [submission] = await getIntelligenceSubmissionModel().create([{_id:submissionId,run_id:run._id,idempotency_key:input.idempotency_key,
      payload_hash:hash,envelope:input.envelope,received_at:now,application_job_id:job._id,manifest_digest}],{session});
    const updated = await getIntelligenceRunModel().updateOne({_id:run._id,revision:run.revision,status:"running",finalized_at:null},
      {$set:{status:"submitted",submitted_at:now,finalized_at:now,manifest_digest,manifest_snapshot_ids:snapshots.map(s=>s._id),output:input.envelope},$inc:{revision:1}},{session,runValidators:true});
    if (updated.modifiedCount !== 1) throw new CsiError("REVISION_CONFLICT");
    await appendCsiAudit({session,command_id:toObjectId(submissionId),now,actor:auth.actor}, {subject_key:run.subject_key,event_kind:"intelligence.submitted",
      prior:{status:"running"},current:{status:"submitted",submission_id:submissionId,application_job_id:String(job._id),manifest_digest},target_id:String(run._id),revision:run.revision+1,kind:"analysis"});
    await deps.beforeCommit?.();
    await fenceAuthorizedLease(auth,run.job_id,session);
    if (!submission) throw new CsiError("SUBMISSION_CONFLICT");
    return receipt(submission);
  });
  await deps.afterCommit?.();
  return result;
}
