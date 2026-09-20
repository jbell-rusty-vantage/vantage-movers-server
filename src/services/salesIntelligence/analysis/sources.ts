import mongoose, { type ClientSession } from "mongoose";
import { getMongoDatabaseName } from "../../../config/domain/runtime";
import { csiDataset } from "../../../config/domain/salesIntelligence";
import { getCallInteractionModel } from "../../../models/CallInteraction";
import { getContactNumberModel } from "../../../models/ContactNumber";
import { getLeadConversationModel } from "../../../models/LeadConversation";
import { getIntelligenceEvidenceSnapshotModel } from "../../../models/IntelligenceEvidenceSnapshot";
import { getIntelligenceFindingModel } from "../../../models/IntelligenceFinding";
import { getNumberLeadAttachmentModel } from "../../../models/NumberLeadAttachment";
import { getOutreachRecordModel } from "../../../models/OutreachRecord";
import { getOutreachFollowupModel } from "../../../models/OutreachFollowup";
import { getSalesIntelligenceContactRestrictionModel } from "../../../models/SalesIntelligenceContactRestriction";
import { getSalesIntelligenceOwnerInstructionModel } from "../../../models/SalesIntelligenceOwnerInstruction";
import { interactionAttribution, interactionRepIdentity } from "../outreach/ensure";
import { subjectKey } from "../outreach/types";
import { jsonValue } from "../outreach/store";
import { loadLead } from "../attachment/sources";
import { historicalCaptureReady, historicalAttachmentsReady } from "../backfill/readiness";
import { CsiError } from "../auth";
import { payloadHash } from "../transactions";
import { decideAnalysisEligibility, loadEligibilityInputs } from "../conversations/eligibility";
import { intelligenceFindingSchema } from "../../../validation/intelligence/intelligenceEnvelope.validation";

/** Bounded source fingerprint deliberately excludes clocks, generic updatedAt and derived analysis. */
export async function intelligenceSources(numberId: string, session: ClientSession) {
  const number = await getContactNumberModel().findById(numberId).session(session).lean().orFail();
  if (number.content_purge_pending || number.purged_at) throw new CsiError("ORIGINAL_EVIDENCE_UNAVAILABLE");
  const calls = await getCallInteractionModel().find({ contact_number_id: numberId, merged_into_id: null }).sort({ started_at: 1, _id: 1 }).limit(201).session(session).lean();
  const conversations = await getLeadConversationModel().find({ contact_number_id: numberId, latest_transcript_version: { $ne: null } }).sort({ _id: 1 }).limit(101).session(session).lean();
  const edges = await getNumberLeadAttachmentModel().find({ contact_number_id: numberId }).sort({ _id: 1 }).limit(101).session(session).lean();
  const outreach = await getOutreachRecordModel().find({ primary_contact_number_id: numberId }).sort({ _id: 1 }).limit(101).session(session).lean();
  const actions = await getOutreachFollowupModel().find({ outreach_record_id: { $in: outreach.map(r => r._id) } }).sort({ _id: 1 }).limit(201).session(session).lean();
  const restrictions = await getSalesIntelligenceContactRestrictionModel().find({ contact_number_id: numberId }).sort({ _id: 1 }).limit(101).session(session).lean();
  const instructions = await getSalesIntelligenceOwnerInstructionModel().find({ subject_key: { $in: [`number:${numberId}`, ...conversations.map(c => `conversation:${c._id}`), ...outreach.map(r => subjectKey(r.subject))] } }).sort({ _id: 1 }).limit(201).session(session).lean();
  if (calls.length > 200 || conversations.length > 100 || edges.length > 100 || outreach.length > 100 || actions.length > 200 || restrictions.length > 100 || instructions.length > 200) throw new CsiError("EVIDENCE_LIMIT_REACHED");
  const identities = [];
  for (const call of calls) identities.push({ id: String(call._id), identity: (await interactionRepIdentity(call, session)).fingerprint });
  const official = [];
  for (const edge of edges) {
    const row = await loadLead({ model: edge.lead_ref.model, id: String(edge.lead_ref.id) }, session);
    official.push({ id: String(edge.lead_ref.id), model: edge.lead_ref.model, booked: row?.booked ?? null, cancelled: row?.cancelled ?? null,
      duplicate: row?.duplicate ?? null, bad: row?.bad_lead ?? null, no_sync: row?.no_sync ?? null, job: row?.job_no ?? null });
  }
  const database = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true });
  const bookings = await database.collection("booked_leads").find({ $or: [
    { lead_ref: { $in: edges.map(e => e.lead_ref.id) } }, { job_no: { $in: official.flatMap(o => o.job ? [o.job] : []) } },
  ] }, { session, projection: { book_date: 1, job_no: 1, lead_ref: 1, lead_model: 1, deposit_amount: 1, total_binder_amount: 1, cancelled: 1 } }).sort({ _id: 1 }).limit(101).toArray();
  const cancellations = await database.collection("cancelled_leads").find({ lead_ref: { $in: edges.map(e => e.lead_ref.id) } },
    { session, projection: { lead_ref: 1, lead_model: 1, reason: 1, timestamp: 1 } }).sort({ _id: 1 }).limit(101).toArray();
  if (bookings.length > 100 || cancellations.length > 100) throw new CsiError("EVIDENCE_LIMIT_REACHED");
  const findings = await getIntelligenceFindingModel().find({
    run_id: { $in: conversations.flatMap(c => c.latest_completed_run_id ? [c.latest_completed_run_id] : []) },
  })
    .limit(101).session(session).lean();
  if (findings.length > 100) throw new CsiError("EVIDENCE_LIMIT_REACHED");
  const assertions = findings.map(f => {
    const purged = (f as { purged_at?: Date | null }).purged_at;
    if (purged || (f.assertion && typeof f.assertion === "object" && (f.assertion as { purged?: boolean }).purged)) {
      return payloadHash(jsonValue({ purged: true }));
    }
    const { key: _key, evidence, ...claim } = intelligenceFindingSchema.parse(f.assertion);
    return payloadHash(jsonValue({ conversation_id: f.conversation_id, claim, review_state: f.review_state,
      evidence: evidence.map(({ snapshot_id: _snapshot, ...source }) => source) }));
  }).sort();
  const fingerprint = payloadHash(jsonValue({ number: { kind: number.kind, classification: number.classification, eligibility: number.contact_eligibility },
    calls: calls.map(c => ({ id: String(c._id), revision: c.projection_revision })),
    transcripts: conversations.map(c => ({ id: String(c._id), version: c.latest_transcript_version, media: c.media_digest_sha256 })), identities, official, bookings, cancellations, assertions,
    edges: edges.map(e => ({ id: String(e._id), revision: e.revision })),
    outreach: outreach.map(r => ({ id: String(r._id), subject: r.subject, state: r.state === "waiting_on_customer" ? "open" : r.state,
      closed_reason: r.closed_reason, owner: r.responsible_agent_id, assignment: r.assignment })),
    actions: actions.map(a => ({ id: String(a._id), kind: a.kind, description: a.description, status: a.status, due: a.due_at,
      owner: a.responsible_agent_id, promised: a.promised_by_agent_id, source: a.source_interaction_id, origin: a.origin })),
    restrictions: restrictions.map(r => ({ id: String(r._id), channels: r.channels, until: r.until, state: r.state === "expired" ? "active" : r.state })),
    instructions: instructions.map(i => ({ id: String(i.instruction_id), revision: i.revision, state: i.state })),
  }));
  return { fingerprint, number, calls, conversations, outreach };
}

/** CSI-12 input refs are immutable; eligibility and version are rechecked without calling STT. */
export async function conversationAnalysisInput(conversationId: string, snapshotId: string, session: ClientSession) {
  const conversation = await getLeadConversationModel().findById(conversationId).session(session).orFail();
  const snapshot = await getIntelligenceEvidenceSnapshotModel().findOne({ _id: snapshotId, conversation_id: conversation._id,
    source_type: "transcript", ...csiDataset() }).session(session).orFail();
  if (await getContactNumberModel().exists({ _id: conversation.contact_number_id, content_purge_pending: true }).session(session)) return { status: "stale" as const };
  if (snapshot.purged_at || snapshot.purge_started_at || conversation.content_purged_at) return { status: "stale" as const };
  if (conversation.latest_transcript_version !== snapshot.transcript_version || conversation.media_digest_sha256 !== snapshot.source_revision || !snapshot.completeness.complete) return { status: "stale" as const };
  const call = await getCallInteractionModel().findOne({ _id: conversation.call_interaction_id, contact_number_id: conversation.contact_number_id, merged_into_id: null }).session(session).orFail();
  if (call.purged_at) return { status: "stale" as const };
  if (call.sources.includes("backfill") && (!await historicalCaptureReady(call.started_at, session) ||
    !await historicalAttachmentsReady(String(call.contact_number_id), session))) return { status: "undetermined" as const };
  const eligibility = decideAnalysisEligibility(await loadEligibilityInputs(call, session));
  if (eligibility.status !== "eligible") return { status: eligibility.status };
  const attribution = await interactionAttribution(call, session);
  const record = attribution.lead_ref && attribution.lead_effects_allowed && attribution.certainty !== "likely"
    ? await getOutreachRecordModel().findOne({ "subject.kind": "lead", "subject.model": attribution.lead_ref.model,
      "subject.id": attribution.lead_ref.id, primary_contact_number_id: call.contact_number_id }).session(session).lean()
    : await getOutreachRecordModel().findOne({ "subject.kind": "number_review", "subject.contact_number_id": call.contact_number_id }).session(session).lean();
  return { status: "eligible" as const, conversation, snapshot, call, outreach_record_id: record ? String(record._id) : null };
}

/** Number synthesis may use only currently eligible pinned transcripts; no STT or cache-only text. */
export async function numberAnalysisInput(numberId: string, session: ClientSession) {
  const sources = await intelligenceSources(numberId, session);
  if (sources.number.kind !== "external" || ["company", "non_customer"].includes(sources.number.classification)) return { status: "excluded" as const };
  const conversation_ids: string[] = [], versions: string[] = [];
  for (const conversation of sources.conversations) {
    const snapshot = await getIntelligenceEvidenceSnapshotModel().findOne({ ...csiDataset(), source_type: "transcript",
      conversation_id: conversation._id, transcript_version: conversation.latest_transcript_version }).session(session).lean();
    if (!snapshot) return { status: "undetermined" as const };
    const eligible = await conversationAnalysisInput(String(conversation._id), String(snapshot._id), session);
    if (eligible.status === "undetermined" || eligible.status === "stale") return { status: "undetermined" as const };
    if (eligible.status === "eligible") { conversation_ids.push(String(conversation._id)); versions.push(String(snapshot._id)); }
  }
  // Record-only context is not sufficient for a number synthesis. Returning a
  // terminal status here prevents reserving budget or invoking the provider.
  if (!conversation_ids.length) return { status: "no_transcript_evidence" as const };
  return { status: "eligible" as const, sources, conversation_ids, versions };
}

/** Exact source membership prevents a number summary from mixing a retained old transcript with current evidence. */
export function sameTranscriptSourceSet(capturedSourceIds: readonly string[], currentSourceIds: readonly string[]) {
  return capturedSourceIds.length === currentSourceIds.length &&
    new Set(capturedSourceIds).size === capturedSourceIds.length &&
    capturedSourceIds.every(id => currentSourceIds.includes(id));
}

/** Recheck the captured transcript set immediately before applying/publishing a completed run. */
export async function capturedTranscriptSourcesCurrent(input: {
  contact_number_id: string;
  conversation_id: string | null;
  transcript_source_ids: readonly string[];
}, session: ClientSession) {
  if (input.conversation_id) {
    if (input.transcript_source_ids.length !== 1) return false;
    const current = await conversationAnalysisInput(input.conversation_id, input.transcript_source_ids[0], session);
    return current.status === "eligible";
  }
  const current = await numberAnalysisInput(input.contact_number_id, session);
  return current.status === "eligible" && sameTranscriptSourceSet(input.transcript_source_ids, current.versions);
}
