import mongoose from "mongoose";
import { getOutreachRecordModel } from "../../models/OutreachRecord";
import { getOutreachFollowupModel } from "../../models/OutreachFollowup";
import { getLeadConversationModel } from "../../models/LeadConversation";
import { getIntelligenceRunModel } from "../../models/IntelligenceRun";
import { getMoveAssessmentArtifactModel } from "../../models/MoveAssessmentArtifact";
import { csiDataset } from "../../config/domain/salesIntelligence";

/**
 * S8-REP (assignment addendum §4.2, E11): is one record, Number or conversation inside a rep's scope?
 *
 * **Record.** An Outreach record is in scope when the rep is its responsible rep, or when any of its
 * follow-ups (any status) names the rep as responsible or as the one who promised it. That is the same
 * union as the snapshot's `filter_keys.agents` (V10) and Closed history's agent filter, read from the
 * source rows so it also holds between publishes and for records older than the closed partition.
 *
 * **Number.** A Number is in scope when one of its Outreach records is (`primary_contact_number_id`, the
 * `outreach_number` index; a `number_review` record carries its Number there too). A rep therefore sees
 * every conversation of a Number they work, including calls another rep took on it; the Number itself
 * (its list row, detail and Number timeline) stays Owner-only.
 *
 * **Conversation.** In scope when its Number is.
 *
 * **Run** (S12-REPREADS, UX15). An analysis run is in scope when its Number is (`contact_number_id`, one more
 * `_id` read). A run without a Number is out of scope.
 *
 * **Move assessment artifact** (S12-REPREADS). In scope when its `outreach_record_id` is (one more `_id` read).
 * A shadow artifact, or one without a record, is out of scope.
 *
 * Every check is at most three indexed reads (`_id`; `outreach_number`; `followup_outreach_due` prefix
 * `outreach_record_id`), bounded by `REP_SCOPE_MAX_RECORDS_PER_NUMBER`. A malformed id, a missing row or a
 * row outside the scope all answer `false`; the route turns that into the same 404 as a missing record.
 */
export const REP_SCOPE_MAX_RECORDS_PER_NUMBER = 200;
const OBJECT_ID = /^[a-f\d]{24}$/i;
const oid = (id: string) => new mongoose.Types.ObjectId(id);

export type RepScopeDeps = {
  /** Test seam: counts reads. */
  onRead?: (collection: string) => void;
};

async function followupNamesRep(recordIds: readonly mongoose.Types.ObjectId[], agent: mongoose.Types.ObjectId, deps: RepScopeDeps) {
  if (!recordIds.length) return false;
  deps.onRead?.("outreach_followups");
  return Boolean(await getOutreachFollowupModel().exists({ outreach_record_id: { $in: [...recordIds] },
    $or: [{ responsible_agent_id: agent }, { promised_by_agent_id: agent }] }));
}

export async function outreachRecordInRepScope(recordId: string, agentId: string, deps: RepScopeDeps = {}): Promise<boolean> {
  if (!OBJECT_ID.test(recordId) || !OBJECT_ID.test(agentId)) return false;
  deps.onRead?.("outreach_records");
  const record = await getOutreachRecordModel().findOne({ _id: oid(recordId) }).select({ responsible_agent_id: 1 }).lean();
  if (!record) return false;
  if (record.responsible_agent_id != null && String(record.responsible_agent_id) === agentId.toLowerCase()) return true;
  return followupNamesRep([record._id as mongoose.Types.ObjectId], oid(agentId), deps);
}

export async function numberInRepScope(numberId: string, agentId: string, deps: RepScopeDeps = {}): Promise<boolean> {
  if (!OBJECT_ID.test(numberId) || !OBJECT_ID.test(agentId)) return false;
  deps.onRead?.("outreach_records");
  const records = await getOutreachRecordModel().find({ primary_contact_number_id: oid(numberId) }).select({ responsible_agent_id: 1 })
    .limit(REP_SCOPE_MAX_RECORDS_PER_NUMBER).lean();
  if (!records.length) return false;
  if (records.some(record => record.responsible_agent_id != null && String(record.responsible_agent_id) === agentId.toLowerCase())) return true;
  return followupNamesRep(records.map(record => record._id as mongoose.Types.ObjectId), oid(agentId), deps);
}

export async function conversationInRepScope(conversationId: string, agentId: string, deps: RepScopeDeps = {}): Promise<boolean> {
  if (!OBJECT_ID.test(conversationId) || !OBJECT_ID.test(agentId)) return false;
  deps.onRead?.("lead_conversations");
  const conversation = await getLeadConversationModel().findOne({ _id: oid(conversationId) }).select({ contact_number_id: 1 }).lean() as { contact_number_id?: unknown } | null;
  if (!conversation?.contact_number_id) return false;
  return numberInRepScope(String(conversation.contact_number_id), agentId, deps);
}

export async function runInRepScope(runId: string, agentId: string, deps: RepScopeDeps = {}): Promise<boolean> {
  if (!OBJECT_ID.test(runId) || !OBJECT_ID.test(agentId)) return false;
  deps.onRead?.("intelligence_runs");
  const run = await getIntelligenceRunModel().findOne({ _id: oid(runId), ...csiDataset() }).select({ contact_number_id: 1 }).lean() as { contact_number_id?: unknown } | null;
  if (!run?.contact_number_id) return false;
  return numberInRepScope(String(run.contact_number_id), agentId, deps);
}

export async function artifactInRepScope(artifactId: string, agentId: string, deps: RepScopeDeps = {}): Promise<boolean> {
  if (!OBJECT_ID.test(artifactId) || !OBJECT_ID.test(agentId)) return false;
  deps.onRead?.("move_assessment_artifacts");
  const artifact = await getMoveAssessmentArtifactModel().findOne({ _id: oid(artifactId), ...csiDataset() }).select({ outreach_record_id: 1, shadow: 1 }).lean() as
    { outreach_record_id?: unknown; shadow?: boolean } | null;
  if (!artifact?.outreach_record_id || artifact.shadow) return false;
  return outreachRecordInRepScope(String(artifact.outreach_record_id), agentId, deps);
}

export type RepScopeChecks = {
  record: typeof outreachRecordInRepScope;
  number: typeof numberInRepScope;
  conversation: typeof conversationInRepScope;
  /** S12-REPREADS: `GET /analysis-runs/:id/presentation`. */
  run: typeof runInRepScope;
  /** S12-REPREADS: `GET /assessments/:artifactId/evidence`. */
  artifact: typeof artifactInRepScope;
};
export const repScopeChecks: RepScopeChecks = { record: outreachRecordInRepScope, number: numberInRepScope, conversation: conversationInRepScope,
  run: runInRepScope, artifact: artifactInRepScope };
