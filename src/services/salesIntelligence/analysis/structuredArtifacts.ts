import { withTransaction } from "../../../db";
import { csiDataset } from "../../../config/domain/salesIntelligence";
import { getContactNumberModel } from "../../../models/ContactNumber";
import { getIntelligenceEvidenceSnapshotModel } from "../../../models/IntelligenceEvidenceSnapshot";
import { getIntelligenceRunModel } from "../../../models/IntelligenceRun";
import { CsiError } from "../auth";
import { payloadHash } from "../transactions";
import { newObjectIdHex } from "../../../utils/objectId";
import { MAX_RESPONSE_BYTES, MAX_RUN_EVIDENCE_BYTES, MAX_RUN_SNAPSHOTS } from "./capture";
import { fenceAuthorizedLease, loadAuthorizedRun, type RunAuthorization } from "./lease";
import { readContentSchema, type ReadContent } from "./reads";
import type { CapturedPromptPage } from "./prompt";

type Snapshot = { _id: unknown; response: unknown; content_digest: string; purged_at?: Date | null; purge_started_at?: Date | null };
export function restoreAnalysisArtifact(row: Snapshot): CapturedPromptPage {
  if (row.purged_at || row.purge_started_at) throw new CsiError("ORIGINAL_EVIDENCE_UNAVAILABLE");
  const data = readContentSchema.parse(row.response);
  if (payloadHash(data) !== row.content_digest) throw new CsiError("ORIGINAL_EVIDENCE_UNAVAILABLE");
  return { snapshot_id: String(row._id), data };
}

/** Canonical summaries carry no run authority. Each consumer captures its own fenced copy. */
export async function findSummaryArtifact(key: string) {
  const row = await getIntelligenceEvidenceSnapshotModel().findOne({ artifact_key: key, ...csiDataset() }).lean();
  return row ? restoreAnalysisArtifact(row) : null;
}

export async function findRunArtifact(auth: RunAuthorization, key: string) {
  const run = await loadAuthorizedRun(auth);
  const row = await getIntelligenceEvidenceSnapshotModel().findOne({ run_id: run._id, tool_call_id: key, ...csiDataset() }).lean();
  return row ? restoreAnalysisArtifact(row) : null;
}

/**
 * Persist keyed artifacts under the same retention and lease fences as tool capture. `case_file` is the
 * Case File page (Attention and Case File spec §4.11): a `ReadContent` like the others, so retention,
 * the digest check and the original-evidence replay treat it exactly as they treat `story`.
 */
export async function persistAnalysisArtifact(auth: RunAuthorization, input: {
  kind: "summary" | "context" | "story" | "prior" | "case_file"; key: string; data: ReadContent; canonical?: boolean; retrieved_at?: Date;
}): Promise<CapturedPromptPage> {
  const data = readContentSchema.parse(input.data);
  const digest = payloadHash(data), bytes = Buffer.byteLength(JSON.stringify(data));
  if (bytes > MAX_RESPONSE_BYTES) throw new CsiError("EVIDENCE_LIMIT_REACHED");
  return withTransaction(async session => {
    const run = await loadAuthorizedRun(auth, session);
    if (run.finalized_at || run.status !== "running") throw new CsiError("SUBMISSION_CONFLICT");
    const number = await getContactNumberModel().findById(run.contact_number_id).session(session).lean();
    if (!number || number.purged_at || number.content_purge_pending) throw new CsiError("ORIGINAL_EVIDENCE_UNAVAILABLE");
    if (data.transcript && !await getIntelligenceEvidenceSnapshotModel().exists({ _id: data.transcript.source_snapshot_id,
      conversation_id: data.transcript.conversation_id, transcript_version: data.transcript.transcript_version,
      source_type: "transcript", purged_at: null, purge_started_at: null, ...csiDataset() }).session(session))
      throw new CsiError("ORIGINAL_EVIDENCE_UNAVAILABLE");
    const query = input.canonical ? { artifact_key: input.key, ...csiDataset() }
      : { run_id: run._id, tool_call_id: input.key, ...csiDataset() };
    const prior = await getIntelligenceEvidenceSnapshotModel().findOne(query).session(session).lean();
    if (prior) { await fenceAuthorizedLease(auth, run.job_id, session); return restoreAnalysisArtifact(prior); }
    const fence = await getContactNumberModel().updateOne({ _id: number._id, retention_epoch: number.retention_epoch ?? null,
      purged_at: null, content_purge_pending: { $ne: true } }, { $inc: { evidence_fence: 1 } }, { session });
    if (fence.modifiedCount !== 1) throw new CsiError("ORIGINAL_EVIDENCE_UNAVAILABLE");
    if (!input.canonical) {
      if (run.evidence_count >= MAX_RUN_SNAPSHOTS || run.evidence_bytes + bytes > MAX_RUN_EVIDENCE_BYTES) throw new CsiError("EVIDENCE_LIMIT_REACHED");
      const changed = await getIntelligenceRunModel().updateOne({ _id: run._id, revision: run.revision, finalized_at: null },
        { $inc: { revision: 1, evidence_count: 1, evidence_bytes: bytes } }, { session });
      if (changed.modifiedCount !== 1) throw new CsiError("REVISION_CONFLICT");
    }
    const [row] = await getIntelligenceEvidenceSnapshotModel().create([{
      _id: newObjectIdHex(), ...query, run_id: input.canonical ? null : run._id,
      conversation_id: data.transcript?.conversation_id ?? null,
      // transcript_version is reserved by the pre-existing source-transcript unique index.
      // `case_file` needs the one-value enum addition in `models/salesIntelligence/intelligence.ts` (coordinator diff, AC2-FINDINGS evidence).
      transcript_version: null, source_type: input.kind as "summary" | "context" | "story" | "prior", source_id: input.key,
      source_revision: data.transcript?.transcript_version ?? digest,
      subject_key: input.canonical && data.transcript ? `conversation:${data.transcript.conversation_id}` : run.subject_key,
      arguments: {}, response: data, content_digest: digest,
      retrieved_at: input.retrieved_at ?? new Date(), completeness: {
        complete: data.page.complete, cursor: data.page.next_cursor, missing_ranges: data.page.missing_ranges,
      },
    }], { session });
    await fenceAuthorizedLease(auth, run.job_id, session);
    if (!row) throw new CsiError("EVIDENCE_SCOPE_INVALID");
    return restoreAnalysisArtifact(row);
  });
}

/** One compact page, retaining attachment certainty alongside the official Lead fields. */
export function assembleContextPage(pages: ReadContent[]): ReadContent {
  if (!pages.length) throw new CsiError("EVIDENCE_SCOPE_INVALID");
  const records = new Map<string, ReadContent["page"]["records"][number]>();
  const instructions = new Map<string, { id: string; revision: number }>();
  for (const page of pages) {
    if (page.page.missing_ranges.length) throw new CsiError("EVIDENCE_LIMIT_REACHED");
    for (const record of page.page.records) {
      const key = `${record.record_type}:${record.record_id}`;
      const prior = records.get(key);
      records.set(key, { ...record, fields: { ...prior?.fields, ...record.fields } });
    }
    for (const instruction of page.instructions) {
      if ((instructions.get(instruction.id)?.revision ?? -1) < instruction.revision) instructions.set(instruction.id, instruction);
    }
  }
  const result = { page: { records: [...records.values()], next_cursor: null, complete: true, missing_ranges: [] },
    coverage: pages[0].coverage, instructions: [...instructions.values()],
    allowed_followup_ids: [...new Set(pages.flatMap(p => p.allowed_followup_ids))],
    speaker_refs: [...new Set(pages.flatMap(p => p.speaker_refs))] };
  const parsed = readContentSchema.safeParse(result);
  if (!parsed.success) throw new CsiError("EVIDENCE_LIMIT_REACHED");
  return parsed.data;
}
