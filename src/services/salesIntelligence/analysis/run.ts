import { randomBytes } from "node:crypto";
import { z } from "zod";
import { withTransaction } from "../../../db";
import { getContactNumberModel } from "../../../models/ContactNumber";
import { getIntelligenceRunModel } from "../../../models/IntelligenceRun";
import { getIntelligenceSubmissionModel } from "../../../models/IntelligenceSubmission";
import { getIntelligenceEvidenceSnapshotModel } from "../../../models/IntelligenceEvidenceSnapshot";
import { getSalesIntelligenceJobModel } from "../../../models/SalesIntelligenceJob";
import { csiDataset, csiFlag } from "../../../config/domain/salesIntelligence";
import { CSI_ENVELOPE_SCHEMA_VERSION } from "../../../validation/intelligence/intelligenceEnvelope.validation";
import { csiIdSchema } from "../../../validation/v1/salesIntelligence";
import { CsiError, issueCsiRunToken } from "../auth";
import type { JobLease } from "../jobs";
import { payloadHash } from "../transactions";
import { CSI_PROMPT_TEMPLATE, CSI_PROMPT_VERSION, CSI_PROMPT_VERSIONS } from "./contracts";
import { intelligenceSchemaDigest, knownSchemaDigest } from "./schemaArtifact";
import { modelToolsForRun, permittedToolsForRun, type AnalysisMode, type ToolGrantReason } from "./tools";
import { readCaptureCoverage } from "../../numberActivity/coverage";
import { loadReadScope } from "./reads";
import { authorizedCorrections, retainedOriginal } from "./ownerReanalysis";
import { jsonValue } from "../outreach/store";

export { intelligenceSchemaDigest } from "./schemaArtifact";
const preparationSchema = z.object({
  run_id: csiIdSchema.optional(),
  contact_number_id: csiIdSchema, conversation_id: csiIdSchema.nullable().default(null),
  outreach_record_id: csiIdSchema.nullable().default(null),
  mode: z.enum(["initial", "current_context", "number_refresh", "backfill", "original_evidence"]).default("initial"),
  parent_run_id: csiIdSchema.nullable().default(null), owner_correction_ids: z.array(csiIdSchema).max(100).default([]),
  input_fingerprint: z.string().min(1).max(200), model_version: z.string().min(1).max(200),
}).strict();
export type PrepareIntelligenceRun = z.input<typeof preparationSchema>;
/**
 * The pinned prompt is the template alone, identical for every run of this
 * version. Per-run material (the trusted subject binding, Owner correction
 * context) moved into the evidence message so runs of the same version share a
 * byte-identical prefix the provider can cache (22 §4.3). v1 runs keep their
 * own rendered text, which has that material appended.
 */
export function renderIntelligencePrompt() {
  return CSI_PROMPT_TEMPLATE;
}
/**
 * The per-run text the evidence message opens with. Empty for a v1-pinned run,
 * whose binding is already inside its pinned prompt: repeating it would state
 * the subject twice and, for an `original_evidence` replay, would not be what
 * the parent was asked.
 */
export function intelligenceEvidencePreamble(run: { prompt_version: string; subject_key: string; owner_correction_context?: unknown }) {
  if (run.prompt_version !== "sales_intelligence_analyze_v2") return "";
  const corrections = Array.isArray(run.owner_correction_context) ? run.owner_correction_context : [];
  return `Trusted subject binding (data): ${JSON.stringify({ subject_key: run.subject_key })}` +
    (corrections.length ? `\nExplicit Owner correction context (data, separate from original evidence): ${JSON.stringify(corrections)}` : "");
}
/**
 * Discovery tools are never granted to an ordinary run. An Owner-requested
 * current-context reanalysis is an explicit ask for a wider look; otherwise the
 * grant needs both `PROVIDER_READS` and a real capture gap. Either way the
 * reason is stored on the run, so the decision is auditable rather than
 * reconstructed later (22 §4.1).
 */
export async function discoveryToolGrant(mode: AnalysisMode): Promise<ToolGrantReason | null> {
  if (mode === "current_context") return "owner_reanalysis";
  if (mode === "original_evidence" || !csiFlag("PROVIDER_READS")) return null;
  const coverage = await readCaptureCoverage().catch(() => null);
  return coverage?.gaps.length ? "coverage_gap" : null;
}
/** CSI-13 trusted orchestration seam. Caller must already own an analysis/number-refresh lease. No HTTP/tool registration. */
export async function prepareIntelligenceRun(lease: JobLease, raw: PrepareIntelligenceRun, deps: { beforePersist?: () => Promise<void> } = {}) {
  if (!csiFlag("ENABLED")) throw new CsiError("FEATURE_DISABLED");
  const input = preparationSchema.parse(raw);
  // Decided before the transaction opens: it reads the shared capture coverage,
  // which has nothing to do with this run's writes and should not sit inside
  // their transaction.
  const discovery = await discoveryToolGrant(input.mode as AnalysisMode);
  const run = await withTransaction(async session => {
    const job = await getSalesIntelligenceJobModel().findOne({ _id: lease.job_id, ...csiDataset(), status: "leased",
      stage: { $in: ["analysis", "number_refresh"] }, lease_owner: lease.owner, lease_epoch: lease.epoch,
      leased_until: { $gt: new Date() } }).session(session).lean();
    if (!job) throw new CsiError("LEASE_LOST");
    const number = await getContactNumberModel().findById(input.contact_number_id).session(session).lean();
    if (!number || number.purged_at || number.content_purge_pending) throw new CsiError("ORIGINAL_EVIDENCE_UNAVAILABLE");
    const fenceRetention = async () => {
      const updated = await getContactNumberModel().updateOne({ _id: number._id, purged_at: null,
        content_purge_pending: { $ne: true }, retention_epoch: number.retention_epoch ?? null }, { $inc: { evidence_fence: 1 } }, { session });
      if (updated.modifiedCount !== 1) throw new CsiError("ORIGINAL_EVIDENCE_UNAVAILABLE");
    };
    const existing = await getIntelligenceRunModel().findOne({ job_id: job._id, ...csiDataset() }).session(session);
    if (existing) {
      if (existing.purged_at || existing.purge_started_at) throw new CsiError("ORIGINAL_EVIDENCE_UNAVAILABLE");
      if (existing.input_fingerprint !== input.input_fingerprint || existing.subject_key !== job.subject_key ||
        existing.mode !== input.mode || String(existing.contact_number_id) !== input.contact_number_id ||
        (existing.conversation_id ? String(existing.conversation_id) : null) !== input.conversation_id ||
        (existing.outreach_record_id ? String(existing.outreach_record_id) : null) !== input.outreach_record_id ||
        (existing.parent_run_id ? String(existing.parent_run_id) : null) !== input.parent_run_id || existing.model_version !== input.model_version ||
        payloadHash(existing.owner_correction_ids.map(String)) !== payloadHash(input.owner_correction_ids))
        throw new CsiError("IDEMPOTENCY_CONFLICT");
      await fenceRetention();
      return existing;
    }
    let prompt = renderIntelligencePrompt();
    let promptVersion: string = CSI_PROMPT_VERSION;
    let schemaDigest = intelligenceSchemaDigest();
    let originalTools: string[] = [];
    if (input.mode === "original_evidence") {
      if (!input.parent_run_id) throw new CsiError("ORIGINAL_EVIDENCE_UNAVAILABLE");
      await retainedOriginal(input.parent_run_id, session);
      const parent = input.parent_run_id ? await getIntelligenceRunModel().findOne({ _id: input.parent_run_id,
        subject_key: job.subject_key, ...csiDataset(), finalized_at: { $ne: null } }).session(session).lean() : null;
      // A replay is pinned to the parent's prompt and schema rendering, not to
      // the current ones: the point is to ask exactly what the parent was
      // asked. A version or digest this deployment can no longer reproduce
      // still fails loudly here rather than being quietly re-pinned.
      if (parent?.purged_at || parent?.purge_started_at || !parent?.rendered_prompt || !parent.manifest_digest ||
        !parent.schema_digest || !knownSchemaDigest(parent.schema_digest) ||
        !(CSI_PROMPT_VERSIONS as readonly string[]).includes(parent.prompt_version ?? ""))
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
      promptVersion = parent.prompt_version!;
      schemaDigest = parent.schema_digest;
      originalTools = snapshots.flatMap(snapshot => snapshot.tool_name ? [snapshot.tool_name] : []);
    } else if (input.parent_run_id) throw new CsiError("INVALID_INPUT");
    const corrections = await authorizedCorrections({ ...input, subject_key: job.subject_key }, input.owner_correction_ids, session);
    const correctionContext = corrections.map(row => ({ id: String(row._id), instruction_id: String(row.instruction_id), revision: row.revision,
      field: row.field, prior: row.prior, current: row.current, happened_at: row.happened_at.toISOString() }));
    // v1 kept the Owner correction context inside the pinned prompt; v2 carries
    // it in the evidence message, where it does not disturb the shared prefix.
    if (correctionContext.length && promptVersion === "sales_intelligence_analyze_v1")
      prompt += `\n\nExplicit Owner correction context (data, separate from original evidence): ${JSON.stringify(correctionContext)}`;
    if (input.mode !== "original_evidence") await loadReadScope({_id:job._id, ...input, job_id:job._id, subject_key:job.subject_key});
    await deps.beforePersist?.();
    await fenceRetention();
    const grant = { mode: input.mode as AnalysisMode, original_tools: originalTools, discovery_reason: discovery };
    const { run_id: requestedId, ...fields } = input;
    const [created] = await getIntelligenceRunModel().create([{ ...fields, ...(requestedId ? { _id: requestedId } : {}), owner_correction_context: jsonValue(correctionContext), ...csiDataset(), job_id: job._id,
      subject_key: job.subject_key, prompt_version: promptVersion, schema_version: CSI_ENVELOPE_SCHEMA_VERSION,
      schema_digest: schemaDigest, rendered_prompt: prompt,
      permitted_tools: permittedToolsForRun(grant), tool_grant_reason: grant.discovery_reason,
      token_nonce: randomBytes(24).toString("hex"), status: "running", started_at: new Date() }], {session});
    if (!created) throw new CsiError("RUN_SCOPE_DENIED");
    const fenced = await getSalesIntelligenceJobModel().updateOne({ _id: job._id, status: "leased", lease_owner: lease.owner,
      lease_epoch: lease.epoch, leased_until: {$gt: new Date()} }, {$inc:{evidence_fence:1}}, {session});
    if (fenced.modifiedCount !== 1) throw new CsiError("LEASE_LOST");
    return created;
  });
  const permitted = run.permitted_tools.map(String);
  return { run_id: String(run._id), token: await issueCsiRunToken(String(run._id), lease),
    permitted_tools: permitted,
    // Authority is the stored list; the model is shown the subset that is still
    // useful once the worker has captured the evidence.
    model_tools: modelToolsForRun({ mode: run.mode as AnalysisMode, original_tools: permitted,
      discovery_reason: (run.tool_grant_reason as ToolGrantReason | null) ?? null }).filter(name => permitted.includes(name)),
    prompt_context: { rendered_prompt: run.rendered_prompt, prompt_version: run.prompt_version,
      schema_version: run.schema_version, schema_digest: run.schema_digest, mode: run.mode,
      evidence_preamble: intelligenceEvidencePreamble(run) } };
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
