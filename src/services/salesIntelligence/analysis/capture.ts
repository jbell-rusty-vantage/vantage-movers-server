import { withTransaction } from "../../../db";
import { getIntelligenceRunModel } from "../../../models/IntelligenceRun";
import { getIntelligenceEvidenceSnapshotModel } from "../../../models/IntelligenceEvidenceSnapshot";
import { csiDataset } from "../../../config/domain/salesIntelligence";
import { CsiError } from "../auth";
import { payloadHash } from "../transactions";
import { newObjectIdHex } from "../../../utils/objectId";
import { intelligenceReadSchema, intelligenceToolArguments, type IntelligenceRead } from "./contracts";
import { loadAuthorizedRun, fenceAuthorizedLease, type RunAuthorization } from "./lease";
import { loadReadScope, readIntelligenceEvidence, readContentSchema, type ReadContent } from "./reads";

export const MAX_RUN_SNAPSHOTS = 128;
export const MAX_RUN_EVIDENCE_BYTES = 8_000_000;
export const MAX_RESPONSE_BYTES = 512_000;
type ReadInput = IntelligenceRead | {tool: "get_intelligence_context"; args: Record<string, never>};
export type CapturedEvidence = {snapshot_id: string; content_digest: string; tool: ReadInput["tool"]; as_of: string; data: ReadContent};
function restored(row: {_id: unknown; content_digest: string; retrieved_at: Date; tool_name?: string | null; response: unknown; purged_at?: Date | null}): CapturedEvidence {
  if (row.purged_at) throw new CsiError("ORIGINAL_EVIDENCE_UNAVAILABLE");
  const tool = row.tool_name;
  if (!tool || tool === "submit_intelligence_analysis" || !(tool in intelligenceToolArguments)) throw new CsiError("EVIDENCE_SCOPE_INVALID");
  const data = readContentSchema.parse(row.response);
  if (payloadHash(data) !== row.content_digest) throw new CsiError("ORIGINAL_EVIDENCE_UNAVAILABLE");
  return {snapshot_id: String(row._id), content_digest: row.content_digest, tool: tool as ReadInput["tool"], as_of: row.retrieved_at.toISOString(), data};
}
/** Network/provider reads happen before the transaction. Only captured responses leave this boundary. */
export async function captureIntelligenceRead(auth: RunAuthorization, raw: ReadInput,
  deps: {read?: typeof readIntelligenceEvidence; beforePersist?: () => Promise<void>} = {}): Promise<CapturedEvidence> {
  const input: ReadInput = raw.tool === "get_intelligence_context"
    ? {tool: raw.tool, args: intelligenceToolArguments.get_intelligence_context.parse(raw.args)}
    : intelligenceReadSchema.parse(raw);
  if (!auth.claims.tools.includes(input.tool)) throw new CsiError("RUN_SCOPE_DENIED");
  const run = await loadAuthorizedRun(auth);
  if (run.finalized_at || run.status !== "running") throw new CsiError("SUBMISSION_CONFLICT");
  const tool_call_id = payloadHash(input);
  const existing = await getIntelligenceEvidenceSnapshotModel().findOne({run_id:run._id, tool_call_id, ...csiDataset()}).lean();
  if (existing) return restored(existing);
  let data: ReadContent;
  let retrievedAt = new Date();
  if (run.mode === "original_evidence") {
    const parent = await getIntelligenceRunModel().findOne({_id:run.parent_run_id, subject_key:run.subject_key, ...csiDataset()}).lean();
    const retained = await getIntelligenceEvidenceSnapshotModel().findOne({run_id:run.parent_run_id, tool_call_id, ...csiDataset()}).lean();
    if (!parent?.finalized_at || !retained || !parent.manifest_snapshot_ids.some(id => String(id) === String(retained._id)))
      throw new CsiError("ORIGINAL_EVIDENCE_UNAVAILABLE");
    data = restored(retained).data;
    retrievedAt = retained.retrieved_at;
  } else {
    data = readContentSchema.parse(await (deps.read ?? readIntelligenceEvidence)(await loadReadScope(run), input));
  }
  const bytes = Buffer.byteLength(JSON.stringify(data));
  if (bytes > MAX_RESPONSE_BYTES) throw new CsiError("EVIDENCE_LIMIT_REACHED");
  const id = newObjectIdHex(), digest = payloadHash(data);
  await deps.beforePersist?.();
  return withTransaction(async session => {
    const current = await loadAuthorizedRun(auth, session);
    if (current.status !== "running" || current.finalized_at) throw new CsiError("SUBMISSION_CONFLICT");
    const prior = await getIntelligenceEvidenceSnapshotModel().findOne({run_id:current._id,tool_call_id,...csiDataset()}).session(session).lean();
    if (prior) { await fenceAuthorizedLease(auth, current.job_id, session); return restored(prior); }
    if (current.evidence_count >= MAX_RUN_SNAPSHOTS || current.evidence_bytes + bytes > MAX_RUN_EVIDENCE_BYTES)
      throw new CsiError("EVIDENCE_LIMIT_REACHED");
    const changed = await getIntelligenceRunModel().updateOne({_id:current._id,revision:current.revision,status:"running",finalized_at:null},
      {$inc:{revision:1,evidence_count:1,evidence_bytes:bytes}}, {session});
    if (changed.modifiedCount !== 1) throw new CsiError("REVISION_CONFLICT");
    const [row] = await getIntelligenceEvidenceSnapshotModel().create([{_id:id,run_id:current._id,source_type:"tool_response",
      source_id:current.subject_key,source_revision:String(current.revision),tool_name:input.tool,tool_call_id,
      arguments:input.args,response:data,retrieved_at:retrievedAt,content_digest:digest,subject_key:current.subject_key,...csiDataset(),
      completeness:{complete:data.page.complete,cursor:data.page.next_cursor,missing_ranges:data.page.missing_ranges}}], {session});
    await fenceAuthorizedLease(auth, current.job_id, session);
    if (!row) throw new CsiError("EVIDENCE_SCOPE_INVALID");
    return restored(row);
  });
}
