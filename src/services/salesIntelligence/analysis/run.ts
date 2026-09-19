import { randomBytes } from "node:crypto";
import { z } from "zod";
import { withTransaction } from "../../../db";
import { getIntelligenceRunModel } from "../../../models/IntelligenceRun";
import { getIntelligenceSubmissionModel } from "../../../models/IntelligenceSubmission";
import { getIntelligenceEvidenceSnapshotModel } from "../../../models/IntelligenceEvidenceSnapshot";
import { getSalesIntelligenceJobModel } from "../../../models/SalesIntelligenceJob";
import { CSI_TOOLS, csiDataset, csiFlag } from "../../../config/domain/salesIntelligence";
import { intelligenceEnvelopeSchema } from "../../../validation/intelligence/intelligenceEnvelope.validation";
import { csiIdSchema } from "../../../validation/v1/salesIntelligence";
import { CsiError, issueCsiRunToken } from "../auth";
import type { JobLease } from "../jobs";
import { payloadHash } from "../transactions";
import { CSI_PROMPT_TEMPLATE, CSI_PROMPT_VERSION } from "./contracts";
import { loadReadScope } from "./reads";
import { authorizedCorrections, retainedOriginal } from "./ownerReanalysis";
import { jsonValue } from "../outreach/store";

export const intelligenceSchemaDigest = () => payloadHash(z.toJSONSchema(intelligenceEnvelopeSchema));
const preparationSchema = z.object({
  run_id: csiIdSchema.optional(),
  contact_number_id: csiIdSchema, conversation_id: csiIdSchema.nullable().default(null),
  outreach_record_id: csiIdSchema.nullable().default(null),
  mode: z.enum(["initial", "current_context", "number_refresh", "backfill", "original_evidence"]).default("initial"),
  parent_run_id: csiIdSchema.nullable().default(null), owner_correction_ids: z.array(csiIdSchema).max(100).default([]),
  input_fingerprint: z.string().min(1).max(200), model_version: z.string().min(1).max(200),
}).strict();
export type PrepareIntelligenceRun = z.input<typeof preparationSchema>;
export function renderIntelligencePrompt(subject: string) {
  return `${CSI_PROMPT_TEMPLATE}\n\nTrusted subject binding (data): ${JSON.stringify({subject_key: subject})}`;
}
/** CSI-13 trusted orchestration seam. Caller must already own an analysis/number-refresh lease. No HTTP/tool registration. */
export async function prepareIntelligenceRun(lease: JobLease, raw: PrepareIntelligenceRun) {
  if (!csiFlag("ENABLED")) throw new CsiError("FEATURE_DISABLED");
  const input = preparationSchema.parse(raw);
  const run = await withTransaction(async session => {
    const job = await getSalesIntelligenceJobModel().findOne({ _id: lease.job_id, ...csiDataset(), status: "leased",
      stage: { $in: ["analysis", "number_refresh"] }, lease_owner: lease.owner, lease_epoch: lease.epoch,
      leased_until: { $gt: new Date() } }).session(session).lean();
    if (!job) throw new CsiError("LEASE_LOST");
    const existing = await getIntelligenceRunModel().findOne({ job_id: job._id, ...csiDataset() }).session(session);
    if (existing) {
      if (existing.input_fingerprint !== input.input_fingerprint || existing.subject_key !== job.subject_key ||
        existing.mode !== input.mode || String(existing.contact_number_id) !== input.contact_number_id ||
        (existing.conversation_id ? String(existing.conversation_id) : null) !== input.conversation_id ||
        (existing.outreach_record_id ? String(existing.outreach_record_id) : null) !== input.outreach_record_id ||
        (existing.parent_run_id ? String(existing.parent_run_id) : null) !== input.parent_run_id || existing.model_version !== input.model_version ||
        payloadHash(existing.owner_correction_ids.map(String)) !== payloadHash(input.owner_correction_ids))
        throw new CsiError("IDEMPOTENCY_CONFLICT");
      return existing;
    }
    let prompt = renderIntelligencePrompt(job.subject_key);
    if (input.mode === "original_evidence") {
      if (!input.parent_run_id) throw new CsiError("ORIGINAL_EVIDENCE_UNAVAILABLE");
      await retainedOriginal(input.parent_run_id, session);
      const parent = input.parent_run_id ? await getIntelligenceRunModel().findOne({ _id: input.parent_run_id,
        subject_key: job.subject_key, ...csiDataset(), finalized_at: { $ne: null } }).session(session).lean() : null;
      if (!parent?.rendered_prompt || !parent.manifest_digest || parent.schema_digest !== intelligenceSchemaDigest() || parent.prompt_version !== CSI_PROMPT_VERSION)
        throw new CsiError("ORIGINAL_EVIDENCE_UNAVAILABLE");
      if (String(parent.contact_number_id) !== input.contact_number_id ||
        (parent.conversation_id ? String(parent.conversation_id) : null) !== input.conversation_id ||
        (parent.outreach_record_id ? String(parent.outreach_record_id) : null) !== input.outreach_record_id)
        throw new CsiError("RUN_SCOPE_DENIED");
      const snapshots = await getIntelligenceEvidenceSnapshotModel().find({ run_id: parent._id, ...csiDataset() }).sort({ _id: 1 }).session(session).lean();
      if (!snapshots.length || snapshots.length !== parent.manifest_snapshot_ids.length ||
        payloadHash(snapshots.map(s => ({id: String(s._id), digest: s.content_digest}))) !== parent.manifest_digest)
        throw new CsiError("ORIGINAL_EVIDENCE_UNAVAILABLE");
      prompt = parent.rendered_prompt;
    } else if (input.parent_run_id) throw new CsiError("INVALID_INPUT");
    const corrections = await authorizedCorrections({ ...input, subject_key: job.subject_key }, input.owner_correction_ids, session);
    const correctionContext = corrections.map(row => ({ id: String(row._id), instruction_id: String(row.instruction_id), revision: row.revision,
      field: row.field, prior: row.prior, current: row.current, happened_at: row.happened_at.toISOString() }));
    if (correctionContext.length) prompt += `\n\nExplicit Owner correction context (data, separate from original evidence): ${JSON.stringify(correctionContext)}`;
    if (input.mode !== "original_evidence") await loadReadScope({_id:job._id, ...input, job_id:job._id, subject_key:job.subject_key});
    const { run_id: requestedId, ...fields } = input;
    const [created] = await getIntelligenceRunModel().create([{ ...fields, ...(requestedId ? { _id: requestedId } : {}), owner_correction_context: jsonValue(correctionContext), ...csiDataset(), job_id: job._id,
      subject_key: job.subject_key, prompt_version: CSI_PROMPT_VERSION, schema_version: "csi-envelope-v1",
      schema_digest: intelligenceSchemaDigest(), rendered_prompt: prompt, permitted_tools: [...CSI_TOOLS],
      token_nonce: randomBytes(24).toString("hex"), status: "running", started_at: new Date() }], {session});
    if (!created) throw new CsiError("RUN_SCOPE_DENIED");
    const fenced = await getSalesIntelligenceJobModel().updateOne({ _id: job._id, status: "leased", lease_owner: lease.owner,
      lease_epoch: lease.epoch, leased_until: {$gt: new Date()} }, {$inc:{evidence_fence:1}}, {session});
    if (fenced.modifiedCount !== 1) throw new CsiError("LEASE_LOST");
    return created;
  });
  return { run_id: String(run._id), token: await issueCsiRunToken(String(run._id), lease),
    prompt_context: { rendered_prompt: run.rendered_prompt, prompt_version: run.prompt_version,
      schema_version: run.schema_version, schema_digest: run.schema_digest, mode: run.mode } };
}

/** Receipt recovery remains a trusted worker operation when the model token/lease expires. */
export async function recoverIntelligenceSubmission(runId: string, lease: JobLease) {
  const run = await getIntelligenceRunModel().findOne({ _id: csiIdSchema.parse(runId), job_id: lease.job_id, ...csiDataset() }).lean();
  const job = await getSalesIntelligenceJobModel().findOne({ _id: lease.job_id, ...csiDataset(), status: "leased",
    lease_owner: lease.owner, lease_epoch: lease.epoch, leased_until: {$gt: new Date()} }).lean();
  if (!run || !job || job.subject_key !== run.subject_key) throw new CsiError("LEASE_LOST");
  const submission = await getIntelligenceSubmissionModel().findOne({run_id: run._id}).lean();
  return submission ? {run_id: String(run._id), submission_id: String(submission._id), application_job_id: String(submission.application_job_id), status: "submitted" as const} : null;
}
