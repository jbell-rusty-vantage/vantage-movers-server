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

/**
 * AC1 (Attention and Case File spec §3.1, F2): the Outreach part of the Number fingerprint.
 *
 * The fingerprint answers "has anything happened that a model should read?". New evidence and
 * human intent count; the system's own deterministic writes do not. Every rule below is an
 * ALLOW-list, so an origin, closure or completion basis added later (`first_attempts`,
 * `crm_receiver`, `ringcentral_answered`, `granot_booked`, ...) stays out until it is named here.
 *
 * - Record `state` is out: `unworked↔open↔waiting` follow from calls and progress already counted.
 * - `closed_reason` only for an Owner or official closure (`crm_disposition` is out).
 * - Assignment only when its origin is `owner`, normalised to `{ owner: responsible_agent_id }`.
 * - Follow-ups only for origins owner / rep_promise / customer_request / customer_wait
 *   (`system_default` is always out: missed episodes, progress defaults, retries). For those only
 *   `{id, kind, description, due, origin, responsible (Owner-assigned only), status}` is hashed, and
 *   `status` only when an Owner, customer or rep confirmation completed it or the Owner cancelled it.
 *   A completion caused by a call (`call_attempt`, `vantage_evidence`) or a closure never registers.
 *
 * Pure and deterministic: the result is JSON data that `intelligenceSources` hashes.
 */
export const FINGERPRINT_CLOSURE_ORIGINS: readonly string[] = ["owner", "official"];
export const FINGERPRINT_ASSIGNMENT_ORIGINS: readonly string[] = ["owner"];
export const FINGERPRINT_ACTION_ORIGINS: readonly string[] = ["owner", "rep_promise", "customer_request", "customer_wait"];
export const FINGERPRINT_COMPLETION_BASES: readonly string[] = ["owner", "customer_confirmation", "rep_confirmation"];

type IdLike = { toString(): string } | string;
export type FingerprintOutreachRecord = {
  _id: IdLike; subject: unknown; state?: string | null;
  closed_reason?: string | null; closure_origin?: string | null;
  responsible_agent_id?: IdLike | null; assignment?: { origin?: string | null } | null;
};
export type FingerprintOutreachAction = {
  _id: IdLike; outreach_record_id?: IdLike | null; kind?: string | null; description?: string | null; status?: string | null;
  due_at?: Date | null; origin?: string | null; responsible_agent_id?: IdLike | null; assignment?: { origin?: string | null } | null;
  completion_basis?: string | null; cancel_reason?: string | null; owner_instruction_ids?: readonly unknown[] | null;
};

/**
 * An Owner `cancel_followup` records an Owner instruction on the action. A closure cancel
 * (`closeRecord`) writes the closure reason as `cancel_reason`, so it is told apart even when
 * the Owner edited the action earlier.
 */
function ownerCancelled(action: FingerprintOutreachAction, record: FingerprintOutreachRecord | undefined) {
  if (action.status !== "cancelled" || !action.owner_instruction_ids?.length) return false;
  return !(record?.state === "closed" && record.closed_reason != null && action.cancel_reason === record.closed_reason);
}

const allowed = (list: readonly string[], value: string | null | undefined) => value != null && list.includes(value);

export function fingerprintOutreachInputs(outreach: readonly FingerprintOutreachRecord[], actions: readonly FingerprintOutreachAction[]) {
  const records = new Map(outreach.map(r => [String(r._id), r]));
  return {
    outreach: outreach.map(r => ({ id: String(r._id), subject: r.subject,
      closure: allowed(FINGERPRINT_CLOSURE_ORIGINS, r.closure_origin) ? { reason: r.closed_reason ?? null, origin: r.closure_origin } : null,
      assignment: allowed(FINGERPRINT_ASSIGNMENT_ORIGINS, r.assignment?.origin) ? { owner: r.responsible_agent_id ? String(r.responsible_agent_id) : null } : null })),
    actions: actions.filter(a => allowed(FINGERPRINT_ACTION_ORIGINS, a.origin)).map(a => {
      const record = a.outreach_record_id ? records.get(String(a.outreach_record_id)) : undefined;
      const statusCounts = (a.status === "completed" && allowed(FINGERPRINT_COMPLETION_BASES, a.completion_basis)) || ownerCancelled(a, record);
      return { id: String(a._id), kind: a.kind ?? null, description: a.description ?? null, due: a.due_at ?? null, origin: a.origin,
        responsible: allowed(FINGERPRINT_ASSIGNMENT_ORIGINS, a.assignment?.origin) ? (a.responsible_agent_id ? String(a.responsible_agent_id) : null) : null,
        status: statusCounts ? a.status : null };
    }),
  };
}


/** V-AC N3: at most 200 fingerprinted actions (unchanged number), and at most `ACTION_READ_LIMIT` read in total. */
export const FINGERPRINT_ACTION_LIMIT = 200;
export const ACTION_READ_LIMIT = 1_000;
export function actionsOverBound(actions: readonly Pick<FingerprintOutreachAction, "origin">[]) {
  return actions.length > ACTION_READ_LIMIT || actions.filter(a => allowed(FINGERPRINT_ACTION_ORIGINS, a.origin)).length > FINGERPRINT_ACTION_LIMIT;
}

/** Bounded source fingerprint deliberately excludes clocks, generic updatedAt and derived analysis. */
export async function intelligenceSources(numberId: string, session: ClientSession) {
  const number = await getContactNumberModel().findById(numberId).session(session).lean().orFail();
  if (number.content_purge_pending || number.purged_at) throw new CsiError("ORIGINAL_EVIDENCE_UNAVAILABLE");
  const calls = await getCallInteractionModel().find({ contact_number_id: numberId, merged_into_id: null }).sort({ started_at: 1, _id: 1 }).limit(201).session(session).lean();
  const conversations = await getLeadConversationModel().find({ contact_number_id: numberId, latest_transcript_version: { $ne: null } }).sort({ _id: 1 }).limit(101).session(session).lean();
  const edges = await getNumberLeadAttachmentModel().find({ contact_number_id: numberId }).sort({ _id: 1 }).limit(101).session(session).lean();
  const outreach = await getOutreachRecordModel().find({ primary_contact_number_id: numberId }).sort({ _id: 1 }).limit(101).session(session).lean();
  // V-AC N3: the 200 bound counts only the actions that enter the fingerprint (allow-listed origins), so
  // system_default missed episodes, retries and defaults cannot push a Number into the paused overflow
  // intent. The read itself stays bounded (`ACTION_READ_LIMIT`); every action is read, so the S10 quiet-state
  // verifier (`scripts/dev_ops/lib/legacy-outreach-fingerprint.ts`) can still recompute the 01bcf18 rule.
  const actions = await getOutreachFollowupModel().find({ outreach_record_id: { $in: outreach.map(r => r._id) } }).sort({ _id: 1 }).limit(ACTION_READ_LIMIT + 1).session(session).lean();
  const restrictions = await getSalesIntelligenceContactRestrictionModel().find({ contact_number_id: numberId }).sort({ _id: 1 }).limit(101).session(session).lean();
  const instructions = await getSalesIntelligenceOwnerInstructionModel().find({ subject_key: { $in: [`number:${numberId}`, ...conversations.map(c => `conversation:${c._id}`), ...outreach.map(r => subjectKey(r.subject))] } }).sort({ _id: 1 }).limit(201).session(session).lean();
  if (calls.length > 200 || conversations.length > 100 || edges.length > 100 || outreach.length > 100 || actionsOverBound(actions) || restrictions.length > 100 || instructions.length > 200) throw new CsiError("EVIDENCE_LIMIT_REACHED");
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
  // Findings only feed the fingerprint hash: their bound follows the 100-conversation bound rather than a flat 100,
  // which made a 19-conversation Number unanalysable at number level.
  const findings = await getIntelligenceFindingModel().find({
    run_id: { $in: conversations.flatMap(c => c.latest_completed_run_id ? [c.latest_completed_run_id] : []) },
  })
    .limit(1001).session(session).lean();
  if (findings.length > 1000) throw new CsiError("EVIDENCE_LIMIT_REACHED");
  const assertions = findings.map(f => {
    const purged = (f as { purged_at?: Date | null }).purged_at;
    if (purged || (f.assertion && typeof f.assertion === "object" && (f.assertion as { purged?: boolean }).purged)) {
      return payloadHash(jsonValue({ purged: true }));
    }
    const { key: _key, evidence, ...claim } = intelligenceFindingSchema.parse(f.assertion);
    return payloadHash(jsonValue({ conversation_id: f.conversation_id, claim, review_state: f.review_state,
      evidence: evidence.map(({ snapshot_id: _snapshot, ...source }) => source) }));
  }).sort();
  const fingerprint_base = { number: { kind: number.kind, classification: number.classification, eligibility: number.contact_eligibility },
    calls: calls.map(c => ({ id: String(c._id), revision: c.projection_revision })),
    transcripts: conversations.map(c => ({ id: String(c._id), version: c.latest_transcript_version, media: c.media_digest_sha256 })), identities, official, bookings, cancellations, assertions,
    edges: edges.map(e => ({ id: String(e._id), revision: e.revision })),
    restrictions: restrictions.map(r => ({ id: String(r._id), channels: r.channels, until: r.until, state: r.state === "expired" ? "active" : r.state })),
    instructions: instructions.map(i => ({ id: String(i.instruction_id), revision: i.revision, state: i.state })),
  };
  // `payloadHash` hashes canonical JSON, so key order is irrelevant; only the Outreach part is filtered (AC1 §3.1).
  const fingerprint = payloadHash(jsonValue({ ...fingerprint_base, ...fingerprintOutreachInputs(outreach, actions) }));
  // `actions` and `fingerprint_base` are returned for `scripts/dev_ops/refingerprint-numbers.ts` only.
  return { fingerprint, number, calls, conversations, outreach, actions, fingerprint_base };
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
