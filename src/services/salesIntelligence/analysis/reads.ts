import mongoose from "mongoose";
import { z } from "zod";
import { getMongoDatabaseName } from "../../../config/domain/runtime";
import { csiDataset } from "../../../config/domain/salesIntelligence";
import { getContactNumberModel } from "../../../models/ContactNumber";
import { getLeadConversationModel } from "../../../models/LeadConversation";
import { getCallInteractionModel } from "../../../models/CallInteraction";
import { getNumberLeadAttachmentModel } from "../../../models/NumberLeadAttachment";
import { getOutreachRecordModel } from "../../../models/OutreachRecord";
import { getOutreachFollowupModel } from "../../../models/OutreachFollowup";
import { getIntelligenceEvidenceSnapshotModel } from "../../../models/IntelligenceEvidenceSnapshot";
import { getIntelligenceFindingModel } from "../../../models/IntelligenceFinding";
import { getSalesIntelligenceJobModel } from "../../../models/SalesIntelligenceJob";
import { getSalesIntelligenceOwnerInstructionModel } from "../../../models/SalesIntelligenceOwnerInstruction";
import { getSalesIntelligenceContactRestrictionModel } from "../../../models/SalesIntelligenceContactRestriction";
import { normalizePhoneNumberForMatch } from "../../../utils/phone";
import { toObjectId } from "../../../utils/objectId";
import { FORM_LEAD_CONTACT_PHONE_PATHS, fullTextClause } from "../../search/leadBrowseShared";
import { redactTranscript } from "../../conversations/redaction";
import { readCaptureCoverage } from "../../numberActivity/coverage";
import { getNumberTimeline } from "../../numberActivity/timeline";
import { coverageDtoSchema } from "../dto";
import { resolveRepIdentityAt, type TemporalRepLink } from "../repIdentity/resolve";
import { getRepIdentityLinkModel } from "../../../models/RepIdentityLink";
import { stateWithActions } from "../outreach/transitions";
import { subjectKey } from "../outreach/types";
import { CsiError } from "../auth";
import { readPageSchema, type EvidenceRecord, type IntelligenceRead, type ReadPage, type ReadScope } from "./contracts";

const segmentSchema = z.object({ sid: z.number().int().nonnegative(), start_ms: z.number().nullable(), end_ms: z.number().nullable(), timing_source: z.enum(["provider", "unavailable"]), speaker: z.enum(["rep", "customer", "unknown"]), text: z.string() }).strict();
export const readContentSchema = z.object({ page: readPageSchema,
  transcript: z.object({ conversation_id: z.string(), transcript_version: z.string(), source_snapshot_id: z.string(), segments: z.array(segmentSchema).max(100) }).strict().optional(),
  coverage: coverageDtoSchema, allowed_followup_ids: z.array(z.string()).max(100),
  instructions: z.array(z.object({ id: z.string(), revision: z.number().int() }).strict()).max(100), speaker_refs: z.array(z.string()).max(100),
}).strict();
export type ReadContent = z.infer<typeof readContentSchema>;
type StoredRun = { _id: unknown; subject_key: string; contact_number_id?: unknown; conversation_id?: unknown; outreach_record_id?: unknown; job_id?: unknown };
const oid = toObjectId;
const db = () => mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true });
const text = (v: unknown) => {
  if (typeof v !== "string") return null;
  const redacted = redactTranscript(v).text;
  if (redacted.length > 4000) throw new CsiError("EVIDENCE_SCOPE_INVALID");
  return redacted;
};
const iso = (v: unknown) => v instanceof Date ? v.toISOString() : null;
const emptyPage = (): ReadPage => ({ records: [], next_cursor: null, complete: true, missing_ranges: [] });
const fail = (): never => { throw new CsiError("RUN_SCOPE_DENIED"); };

/** Authority is loaded from the stored run and authoritative joins; arguments never widen it. */
export async function loadReadScope(run: StoredRun): Promise<ReadScope> {
  if (!run.contact_number_id) return fail();
  const number = await getContactNumberModel().findById(run.contact_number_id).lean();
  if (!number) return fail();
  const scope: ReadScope = { run_id: String(run._id), subject_key: run.subject_key, contact_number_id: String(number._id), e164: number.e164,
    conversation_id: run.conversation_id ? String(run.conversation_id) : null, outreach_record_id: run.outreach_record_id ? String(run.outreach_record_id) : null, account_id: null, lead_refs: [] };
  if (scope.conversation_id) {
    const conversation = await getLeadConversationModel().findOne({ _id: scope.conversation_id, contact_number_id: number._id }).lean();
    if (!conversation) return fail();
    scope.account_id = conversation.provider_account_id ?? null;
    const job = run.job_id ? await getSalesIntelligenceJobModel().findById(run.job_id).select("input_refs").lean() : null;
    if (job?.input_refs[1]) {
      const pinned = await getIntelligenceEvidenceSnapshotModel().findOne({ _id: job.input_refs[1], ...csiDataset(), source_type: "transcript", conversation_id: conversation._id }).select("_id").lean();
      if (!pinned) throw new CsiError("EVIDENCE_SCOPE_INVALID");
      scope.transcript_snapshot_id = String(pinned._id);
    }
  }
  if (scope.outreach_record_id) {
    const record = await getOutreachRecordModel().findOne({ _id: scope.outreach_record_id, primary_contact_number_id: number._id }).lean();
    const conversationSubject = scope.conversation_id !== null && run.subject_key === `conversation:${scope.conversation_id}`;
    if (!record || (!conversationSubject && subjectKey(record.subject) !== run.subject_key)) return fail();
    if (record.subject.kind === "lead") scope.lead_refs.push({ model: record.subject.model!, id: String(record.subject.id) });
  } else if (run.subject_key !== `number:${number._id}` && run.subject_key !== `conversation:${scope.conversation_id}`) return fail();
  const edges = await getNumberLeadAttachmentModel().find({ contact_number_id: number._id, state: { $ne: "rejected" } }).sort({ _id: 1 }).limit(101).lean();
  if (edges.length > 100) throw new CsiError("EVIDENCE_SCOPE_INVALID");
  for (const edge of edges) if (!scope.lead_refs.some(r => r.model === edge.lead_ref.model && r.id === String(edge.lead_ref.id))) scope.lead_refs.push({ model: edge.lead_ref.model, id: String(edge.lead_ref.id) });
  // Never infer an account from the customer's number when evidence spans accounts.
  if (!scope.account_id) {
    const accounts = await getCallInteractionModel().aggregate([{ $match: { contact_number_id: number._id, merged_into_id: null } }, { $group: { _id: "$provider_account_id" } }, { $limit: 2 }]);
    if (accounts.length === 1) scope.account_id = String(accounts[0]._id);
  }
  return scope;
}

/** Cursor is bound to subject/tool arguments; changing search or reusing another run fails. */
export function readCursor(encoded: string | undefined, key: string): string | null {
  if (!encoded) return null;
  try { const value = z.object({ key: z.string(), after: z.string().regex(/^[a-f0-9]{24}$/) }).strict().parse(JSON.parse(Buffer.from(encoded, "base64url").toString()));
    if (value.key !== key) throw new Error(); return value.after;
  } catch { throw new CsiError("INVALID_INPUT"); }
}
const cursor = (key: string, after: string) => Buffer.from(JSON.stringify({ key, after })).toString("base64url");
type SearchArgs = { limit: number; cursor?: string; query?: string; id?: string; model?: "FormLead" | "CallLead" };
export function leadRelevance(scope: ReadScope, model: "FormLead" | "CallLead") {
  const phone = normalizePhoneNumberForMatch(scope.e164);
  const clauses: Record<string, unknown>[] = [{ _id: { $in: scope.lead_refs.filter(r => r.model === model).map(r => oid(r.id)) } }];
  if (phone) clauses.push(...FORM_LEAD_CONTACT_PHONE_PATHS.map(path => ({ [path]: path.includes("normalized_") ? phone : new RegExp(`^${phone.length === 10 ? "(?:\\+?1\\D*)?" : "\\+?"}\\D*${phone.split("").join("\\D*")}\\D*$`) })));
  return { $or: clauses };
}
const projection = { name: 1, customer_name: 1, phone_number: 1, job_no: 1, normalized_job_no: 1, source_company: 1, source: 1, booked: 1, cancelled: 1, duplicate: 1, bad_lead: 1, no_sync: 1, domain_revision: 1, updatedAt: 1, book_date: 1, lead_ref: 1, lead_model: 1, receiver_agent: 1 };
export function projectLead(row: Record<string, unknown>, model: "FormLead" | "CallLead"): EvidenceRecord {
  return { record_type: "lead", record_id: String(row._id), revision: row.domain_revision == null ? iso(row.updatedAt) : String(row.domain_revision), fields: { model, name: text(row.name), phone: text(row.phone_number), job_no: text(row.job_no), source: text(row.source_company), booked: Boolean(row.booked), cancelled: Boolean(row.cancelled), duplicate: Boolean(row.duplicate), bad_lead: Boolean(row.bad_lead), no_sync: Boolean(row.no_sync), agent_id: row.receiver_agent ? String(row.receiver_agent) : null } };
}
/** Official any-known-contact paths, scoped projection: broad CRUD uses global models and is deliberately not imported. */
export async function readLeads(scope: ReadScope, args: SearchArgs): Promise<ReadPage> {
  const key = `${scope.run_id}:leads:${args.model ?? "all"}:${args.query ?? ""}`;
  let after: string | null = null, afterModel: "FormLead" | "CallLead" | null = null;
  if (args.model) after = readCursor(args.cursor, key);
  else if (args.cursor) {
    try {
      const decoded = z.object({ key: z.literal(key), after: z.string().regex(/^[a-f0-9]{24}$/), model: z.enum(["CallLead", "FormLead"]) }).strict().parse(JSON.parse(Buffer.from(args.cursor, "base64url").toString()));
      after = decoded.after; afterModel = decoded.model;
    } catch { throw new CsiError("INVALID_INPUT"); }
  }
  const models = args.model ? [args.model] : ["FormLead", "CallLead"] as const;
  const batches = await Promise.all(models.map(async model => {
    // ObjectIds are unique only within a collection: the merged order is (_id, model).
    const continuation = after ? [{ _id: { [afterModel && model > afterModel ? "$gte" : "$gt"]: oid(after) } }] : [];
    const filter = { $and: [leadRelevance(scope, model), ...(args.id ? [{ _id: oid(args.id) }] : []), ...continuation, ...(args.query ? [fullTextClause(["name", "job_no", "phone_number"], args.query)] : [])] };
    const rows = await db().collection(model === "FormLead" ? "form_leads" : "call_leads").find(filter, { projection }).sort({ _id: 1 }).limit(args.limit + 1).toArray();
    return rows.map(row => projectLead(row, model));
  }));
  const all = batches.flat().sort((a, b) => a.record_id.localeCompare(b.record_id) || a.fields.model!.localeCompare(b.fields.model!));
  if (args.id && !all.length) return fail();
  const last = all[args.limit - 1];
  return { records: all.slice(0, args.limit), next_cursor: all.length > args.limit ? args.model ? cursor(key, last.record_id)
    : Buffer.from(JSON.stringify({ key, after: last.record_id, model: last.fields.model })).toString("base64url") : null, complete: all.length <= args.limit, missing_ranges: [] };
}
export async function readBookings(scope: ReadScope, args: SearchArgs): Promise<ReadPage> {
  // The bounded related-lead set is required before broadening to matching Job Numbers.
  const leads = await readLeads(scope, { limit: 100 });
  if (!leads.complete) throw new CsiError("EVIDENCE_SCOPE_INVALID");
  const clauses = leads.records.flatMap(row => [{ lead_ref: oid(row.record_id), lead_model: row.fields.model }, ...(row.fields.job_no ? [{ job_no: row.fields.job_no }] : [])]);
  if (!clauses.length) { if (args.id) return fail(); return emptyPage(); }
  const key = `${scope.run_id}:bookings:${args.query ?? ""}`, after = readCursor(args.cursor, key);
  const rows = await db().collection("booked_leads").find({ $and: [{ $or: clauses }, ...(args.id ? [{ _id: oid(args.id) }] : []), ...(after ? [{ _id: { $gt: oid(after) } }] : []), ...(args.query ? [fullTextClause(["customer_name", "job_no"], args.query)] : [])] }, { projection }).sort({ _id: 1 }).limit(args.limit + 1).toArray();
  if (args.id && !rows.length) return fail();
  return { records: rows.slice(0, args.limit).map(r => ({ record_type: "booking", record_id: String(r._id), revision: r.domain_revision == null ? iso(r.updatedAt) : String(r.domain_revision), fields: { name: text(r.customer_name), job_no: text(r.job_no), cancelled: Boolean(r.cancelled), lead_id: r.lead_ref ? String(r.lead_ref) : null, model: r.lead_model, occurred_at: iso(r.book_date), source: text(r.source) } })), next_cursor: rows.length > args.limit ? cursor(key, String(rows[args.limit - 1]._id)) : null, complete: rows.length <= args.limit, missing_ranges: [] };
}

/** Cancellation linkage/snapshots remain evidence even when the original Booking was deleted. */
export async function readCancellations(scope: ReadScope, args: SearchArgs): Promise<ReadPage> {
  const [leads, bookings] = await Promise.all([readLeads(scope, { limit: 100 }), readBookings(scope, { limit: 100 })]);
  if (!leads.complete || !bookings.complete) throw new CsiError("EVIDENCE_SCOPE_INVALID");
  const clauses: Record<string, unknown>[] = [
    { booked_lead: { $in: bookings.records.map(r => oid(r.record_id)) } },
    ...leads.records.flatMap(r => [
      { lead_ref: oid(r.record_id), lead_model: r.fields.model },
      { "lead_ref_snapshot.id": oid(r.record_id), "lead_ref_snapshot.model": r.fields.model },
    ]),
  ];
  const key = `${scope.run_id}:cancellations:${args.query ?? ""}`, after = readCursor(args.cursor, key);
  const rows = await db().collection("cancelled_leads").find({ $and: [{ $or: clauses },
    ...(args.id ? [{ _id: oid(args.id) }] : []), ...(after ? [{ _id: { $gt: oid(after) } }] : []),
    ...(args.query ? [fullTextClause(["customer_name", "job_no", "job_no_snapshot", "reason"], args.query)] : []),
  ] }, { projection: { customer_name: 1, job_no: 1, job_no_snapshot: 1, booked_lead: 1, lead_ref: 1, lead_model: 1, lead_ref_snapshot: 1,
    reason: 1, notes: 1, cancel_date: 1, refund_amount: 1, source: 1, domain_revision: 1, updatedAt: 1 } }).sort({ _id: 1 }).limit(args.limit + 1).toArray();
  if (args.id && !rows.length) return fail();
  return { records: rows.slice(0, args.limit).map(r => ({ record_type: "cancellation", record_id: String(r._id),
    revision: r.domain_revision == null ? iso(r.updatedAt) : String(r.domain_revision), fields: {
      name: text(r.customer_name), job_no: text(r.job_no_snapshot ?? r.job_no), booking_id: String(r.booked_lead),
      lead_id: r.lead_ref_snapshot?.id ? String(r.lead_ref_snapshot.id) : r.lead_ref ? String(r.lead_ref) : null,
      model: r.lead_ref_snapshot?.model ?? r.lead_model, occurred_at: iso(r.cancel_date), amount: typeof r.refund_amount === "number" ? r.refund_amount : null,
      description: text(r.reason), details: text(r.notes), source: text(r.source), cancelled: true,
    } })), complete: rows.length <= args.limit, next_cursor: rows.length > args.limit ? cursor(key, String(rows[args.limit - 1]._id)) : null, missing_ranges: [] };
}

async function context(scope: ReadScope, result: ReadContent) {
  const number = await getContactNumberModel().findById(scope.contact_number_id).lean();
  if (!number) return fail();
  result.page.records.push({ record_type: "contact_number", record_id: String(number._id), revision: String(number.revision), fields: { phone: number.e164, status: number.contact_eligibility.state, certainty: number.classification } });
  const outreach = scope.outreach_record_id ? await getOutreachRecordModel().findOne({ _id: scope.outreach_record_id, primary_contact_number_id: scope.contact_number_id }).lean() : null;
  if (scope.outreach_record_id && !outreach) return fail();
  const records = outreach ? [outreach] : !scope.conversation_id ? await getOutreachRecordModel().find({ primary_contact_number_id: scope.contact_number_id }).sort({ _id: 1 }).limit(101).lean() : [];
  if (records.length > 100) throw new CsiError("EVIDENCE_LIMIT_REACHED");
  const conversations = !scope.conversation_id ? await getLeadConversationModel().find({ contact_number_id: scope.contact_number_id }).sort({ _id: 1 }).limit(101).lean() : [];
  if (conversations.length > 100) throw new CsiError("EVIDENCE_LIMIT_REACHED");
  const keys = [...new Set([scope.subject_key, `number:${scope.contact_number_id}`, ...records.map(r => subjectKey(r.subject)), ...conversations.map(c => `conversation:${c._id}`)])];
  const [instructions, restrictions, edges] = await Promise.all([
    getSalesIntelligenceOwnerInstructionModel().find({ subject_key: { $in: keys } }).sort({ _id: 1 }).limit(101).lean(),
    getSalesIntelligenceContactRestrictionModel().find({ contact_number_id: scope.contact_number_id }).sort({ _id: 1 }).limit(51).lean(),
    getNumberLeadAttachmentModel().find({ contact_number_id: scope.contact_number_id }).sort({ _id: 1 }).limit(101).lean(),
  ]);
  // Context has no pagination: refuse oversized context instead of omitting Owner precedence.
  if (instructions.length > 100 || restrictions.length > 50 || edges.length > 100) throw new CsiError("EVIDENCE_SCOPE_INVALID");
  for (const r of instructions) {
    result.instructions.push({ id: String(r.instruction_id), revision: r.revision });
    result.page.records.push({ record_type: "owner_instruction", record_id: String(r.instruction_id), revision: String(r.revision), fields: { instruction_field: r.field, details: text(JSON.stringify(r.current)), status: r.state } });
  }
  for (const r of restrictions) result.page.records.push({ record_type: "owner_instruction", record_id: String(r._id), revision: String(r.revision), fields: { instruction_field: "restriction", details: r.channels.join(","), status: r.state, due_at: iso(r.until), origin: r.origin } });
  for (const e of edges) result.page.records.push({ record_type: "lead", record_id: String(e.lead_ref.id), revision: String(e.revision), fields: { model: e.lead_ref.model, certainty: e.certainty, status: e.state, details: `Attachment ${e._id}` } });
  for (const record of records) {
    const actions = await getOutreachFollowupModel().find({ outreach_record_id: record._id }).sort({ _id: 1 }).limit(101).lean();
    if (!record || actions.length > 100) throw new CsiError("EVIDENCE_SCOPE_INVALID");
    result.page.records.push({ record_type: "outreach", record_id: String(record._id), revision: String(record.revision), fields: { status: stateWithActions(record, actions, new Date()), agent_id: record.responsible_agent_id ? String(record.responsible_agent_id) : null, origin: record.assignment?.origin ?? null, description: text(record.closed_reason) } });
    for (const a of actions) {
      result.allowed_followup_ids.push(String(a._id));
      result.page.records.push({ record_type: "followup", record_id: String(a._id), revision: String(a.revision), fields: { status: a.status, description: text(a.description), due_at: iso(a.due_at), origin: a.origin, agent_id: a.responsible_agent_id ? String(a.responsible_agent_id) : null, details: JSON.stringify({ kind: a.kind, source_interaction_id: a.source_interaction_id, commitment_key: a.commitment_key, promised_by_agent_id: a.promised_by_agent_id }) } });
    }
  }
  if (!scope.conversation_id) {
    const findings = await getIntelligenceFindingModel().find({ run_id: { $in: conversations.flatMap(c => c.latest_completed_run_id ? [c.latest_completed_run_id] : []) } }).sort({ _id: 1 }).limit(101).lean();
    if (findings.length > 100) throw new CsiError("EVIDENCE_LIMIT_REACHED");
    for (const f of findings) result.page.records.push({ record_type: "job_timeline", record_id: String(f._id), revision: String(f.revision),
      fields: { description: text(f.assertion.claim), status: f.review_state, details: text(JSON.stringify({ kind: f.kind, value: f.assertion.value, evidence: f.assertion.evidence, run_id: f.run_id })) } });
  }
  if (result.page.records.length > 200) throw new CsiError("EVIDENCE_SCOPE_INVALID");
}

export async function readIntelligenceEvidence(scope: ReadScope, input: { tool: "get_intelligence_context"; args: Record<string, never> } | IntelligenceRead): Promise<ReadContent> {
  const result: ReadContent = { page: emptyPage(), coverage: await readCaptureCoverage(), allowed_followup_ids: [], instructions: [], speaker_refs: [] };
  switch (input.tool) {
    case "get_intelligence_context": await context(scope, result); break;
    case "search_leads": result.page = await readLeads(scope, input.args); break;
    case "get_lead": result.page = await readLeads(scope, { ...input.args, limit: 1 }); break;
    case "search_bookings": result.page = await readBookings(scope, input.args); break;
    case "get_booking": result.page = await readBookings(scope, { ...input.args, limit: 1 }); break;
    case "list_number_activity": {
      const key = `${scope.run_id}:activity`;
      let timelineCursor: string | undefined;
      if (input.args.cursor) {
        try { timelineCursor = z.object({ key: z.literal(key), cursor: z.string().min(1).max(400) }).strict().parse(JSON.parse(Buffer.from(input.args.cursor, "base64url").toString())).cursor; }
        catch { throw new CsiError("INVALID_INPUT"); }
      }
      // Official timeline has bounded pages but unbounded attachment joins and a 2000-call
      // recording scan. Preflight those joins so it cannot silently omit older evidence.
      const [edges, outreach, recordings] = await Promise.all([
        getNumberLeadAttachmentModel().countDocuments({ contact_number_id: scope.contact_number_id }),
        getOutreachRecordModel().countDocuments({ primary_contact_number_id: scope.contact_number_id }),
        getCallInteractionModel().countDocuments({ contact_number_id: scope.contact_number_id, merged_into_id: null, "recordings.0": { $exists: true } }),
      ]);
      if (edges > 100 || outreach > 100 || recordings > 2000) throw new CsiError("EVIDENCE_SCOPE_INVALID");
      const page = await getNumberTimeline(scope.contact_number_id, { ...input.args, cursor: timelineCursor });
      if (!page) return fail();
      result.coverage = page.coverage;
      result.page = { records: page.data.items.map(r => ({ record_type: r.kind === "interaction" ? "interaction" : r.kind === "owner_note" ? "owner_note" : "job_timeline", record_id: r.id,
        revision: typeof r.detail.projection_revision === "number" ? String(r.detail.projection_revision) : null,
        fields: { occurred_at: r.happened_at, description: text(r.description), status: r.kind, details: text(JSON.stringify(r.detail)) } })),
        complete: !page.data.cursor, next_cursor: page.data.cursor ? Buffer.from(JSON.stringify({ key, cursor: page.data.cursor })).toString("base64url") : null, missing_ranges: [] }; break;
    }
    case "get_rep_identity": {
      const call = await getCallInteractionModel().findOne({ _id: input.args.interaction_id, contact_number_id: scope.contact_number_id, merged_into_id: null }).lean();
      if (!call) return fail();
      const ids = [...new Set(call.parties.filter(p => p.role === "user").flatMap(p => p.extension_id ? [p.extension_id] : []))];
      if (ids.length > 50) throw new CsiError("EVIDENCE_SCOPE_INVALID");
      const links = await getRepIdentityLinkModel().find({ rc_account_id: call.provider_account_id, rc_extension_id: { $in: ids }, effective_from: { $lte: call.started_at }, $or: [{ effective_to: null }, { effective_to: { $gt: call.started_at } }] }).limit(101).lean();
      if (links.length > 100) throw new CsiError("EVIDENCE_SCOPE_INVALID");
      for (const extension of ids) {
        const resolved = resolveRepIdentityAt(links as TemporalRepLink[], call.provider_account_id, extension, call.started_at);
        result.page.records.push({ record_type: "rep_identity", record_id: resolved.link_id ?? `${call._id}:${extension}`, revision: resolved.fingerprint, fields: { account_id: call.provider_account_id, extension_id: extension, agent_id: resolved.agent_id, status: resolved.status, occurred_at: iso(call.started_at) } });
        if (resolved.agent_id) result.speaker_refs.push(`agent:${resolved.agent_id}`);
      }
      if (!ids.length) result.page.records.push({ record_type: "rep_identity", record_id: String(call._id), revision: String(call.projection_revision), fields: { status: "unknown", agent_id: null } });
      break;
    }
    case "get_call_transcript": {
      const c = await getLeadConversationModel().findOne({ _id: input.args.conversation_id, contact_number_id: scope.contact_number_id }).select("latest_transcript_version").lean();
      if (!c || (scope.conversation_id && scope.conversation_id !== String(c._id))) return fail();
      const version = input.args.transcript_version ?? c.latest_transcript_version;
      const snapshot = (version || scope.transcript_snapshot_id) ? await getIntelligenceEvidenceSnapshotModel().findOne({ ...csiDataset(), source_type: "transcript", conversation_id: c._id,
        ...(scope.transcript_snapshot_id ? { _id: scope.transcript_snapshot_id } : { transcript_version: version }) }).select("transcript_version completeness").lean() : null;
      if (!snapshot) { result.page.complete = false; result.page.missing_ranges = ["transcript_unavailable"]; break; }
      if (input.args.transcript_version && input.args.transcript_version !== snapshot.transcript_version) return fail();
      const key = `${scope.run_id}:transcript:${snapshot._id}`;
      let offset = 0;
      if (input.args.cursor) { try { const c = z.object({ key: z.string(), offset: z.number().int().nonnegative() }).strict().parse(JSON.parse(Buffer.from(input.args.cursor, "base64url").toString())); if (c.key !== key) throw new Error(); offset = c.offset; } catch { throw new CsiError("INVALID_INPUT"); } }
      const [part] = await getIntelligenceEvidenceSnapshotModel().aggregate([{ $match: { _id: snapshot._id } }, { $project: { total: { $size: "$segments" }, segments: { $slice: ["$segments", offset, input.args.limit] } } }]);
      if (!part || offset > part.total) throw new CsiError("INVALID_INPUT");
      const segments = z.array(segmentSchema).max(100).parse(part.segments);
      const next = offset + segments.length;
      result.transcript = { conversation_id: String(c._id), transcript_version: snapshot.transcript_version!, source_snapshot_id: String(snapshot._id), segments };
      result.page.complete = snapshot.completeness.complete && offset === 0 && next === part.total;
      result.page.next_cursor = next < part.total ? Buffer.from(JSON.stringify({ key, offset: next })).toString("base64url") : null;
      result.page.missing_ranges = [...snapshot.completeness.missing_ranges, ...(offset ? [`segments_before:${offset}`] : []), ...(next < part.total ? [`segments_after:${next}`] : [])];
      break;
    }
    default: result.page = await (await import("./operational.js")).readOperationalRecords(scope, input);
  }
  return readContentSchema.parse(result);
}
