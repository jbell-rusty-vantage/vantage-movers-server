import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../../config/domain/runtime";
import { getCallInteractionModel } from "../../../models/CallInteraction";
import { getNumberLeadAttachmentModel } from "../../../models/NumberLeadAttachment";
import { leadPhoneMatchClauses, CALL_LEAD_ATTACHMENT_PHONE_PATHS, FORM_LEAD_ATTACHMENT_PHONE_PATHS } from "../../../models/leadContactPhoneIndexes";
import { toObjectId } from "../../../utils/objectId";
import { normalizePhoneNumberForMatch } from "../../../utils/phone";
import { normalizeComparisonName, normalizeJobNo, normalizeSubmissionLid } from "../../bookings/bookingIdentity";
import { redactTranscript } from "../../conversations/redaction";
import { LEAD_PROJECTION, leadCollection, leadCustomerName, leadSourceLabel, readStoryContactNumber, type LeadRow } from "./sources";
import type { LeadCandidate, LeadCandidateBasis, StorySubject } from "./types";

/**
 * The no-Lead case (context provenance specification §4.7): Leads that could belong to this
 * number, found by the indexed phone paths, caller-ID names, the customer's stated name and any
 * job/reference the customer mentioned. Bounded, read only; nothing here attaches.
 */
export type CandidateDeps = { stated_name?: string | null; reference_mentions?: string[]; window_anchor?: Date };

const PER_BASE = 20;
const NAME_WINDOW_DAYS = 180;
const TOTAL_MAX = 60;
const db = () => mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true });
const text = (value: unknown, max = 120): string | null => {
  if (value === null || value === undefined) return null;
  const s = redactTranscript(String(value)).text.trim();
  return s ? (s.length > max ? `${s.slice(0, max - 1)}…` : s) : null;
};
const pick = (row: LeadRow, path: string): unknown => path.split(".").reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), row);

type Found = { row: LeadRow; basis: Set<LeadCandidateBasis> };

async function findLeads(model: "FormLead" | "CallLead", filter: Record<string, unknown>, limit: number): Promise<LeadRow[]> {
  const rows = await db().collection(leadCollection(model)).find(filter, { projection: LEAD_PROJECTION }).sort({ _id: -1 }).limit(limit).toArray();
  return rows.map(row => ({ ...(row as unknown as LeadRow), model }));
}

export async function findLeadCandidates(subject: StorySubject, deps: CandidateDeps = {}): Promise<LeadCandidate[]> {
  const found = new Map<string, Found>();
  const add = (row: LeadRow, basis: LeadCandidateBasis) => {
    const key = `${row.model}:${row._id}`;
    const entry = found.get(key) ?? { row, basis: new Set<LeadCandidateBasis>() };
    entry.basis.add(basis);
    found.set(key, entry);
  };
  const models = ["FormLead", "CallLead"] as const;

  // 1. Phone paths, exactly the keys the attachment worker joins on.
  const digits = subject.e164 ? normalizePhoneNumberForMatch(subject.e164) : undefined;
  if (digits) {
    for (const model of models) {
      const clauses = leadPhoneMatchClauses(model, [digits]);
      if (!clauses.length) continue;
      const paths = model === "FormLead" ? FORM_LEAD_ATTACHMENT_PHONE_PATHS : CALL_LEAD_ATTACHMENT_PHONE_PATHS;
      for (const row of await findLeads(model, { $or: clauses }, PER_BASE)) {
        const matched = paths.filter(path => pick(row, path) === digits);
        for (const path of matched.length ? matched : ["unknown"]) add(row, `phone:${path}`);
      }
    }
  }

  // 2/3. Names: caller ID on the Contact Number and the name stated on the call, within ±180 days
  // of the newest call. Only Form Leads carry the indexed `normalized_contact_name`.
  const number = subject.contact_number_id ? await readStoryContactNumber(subject.contact_number_id) : null;
  const callerNames = [...new Set((number?.provider_names ?? []).map(n => normalizeComparisonName(n)).filter((n): n is string => Boolean(n)))];
  const statedName = normalizeComparisonName(deps.stated_name ?? null) ?? null;
  if (callerNames.length || statedName) {
    let anchor = deps.window_anchor ?? null;
    if (!anchor && subject.contact_number_id) {
      const [latest] = await getCallInteractionModel().find({ contact_number_id: toObjectId(subject.contact_number_id), merged_into_id: null, purged_at: null, started_at: { $lte: subject.as_of } })
        .select("started_at").sort({ started_at: -1, _id: -1 }).limit(1).lean();
      anchor = latest?.started_at ?? null;
    }
    anchor ??= subject.as_of;
    const window = { $gte: new Date(+anchor - NAME_WINDOW_DAYS * 86_400_000), $lte: new Date(+anchor + NAME_WINDOW_DAYS * 86_400_000) };
    if (callerNames.length) for (const row of await findLeads("FormLead", { normalized_contact_name: { $in: callerNames }, timestamp: window }, 10)) add(row, "name:caller_id");
    if (statedName) for (const row of await findLeads("FormLead", { normalized_contact_name: statedName, timestamp: window }, 10)) add(row, "name:stated_on_call");
  }

  // 4. Stated job or reference: Job Number, submission id (Form) and raw ref_no (Form).
  const mentions = [...new Set((deps.reference_mentions ?? []).map(m => m.trim()).filter(Boolean))].slice(0, 10);
  if (mentions.length) {
    const jobNos = [...new Set(mentions.map(m => normalizeJobNo(m)).filter((j): j is string => Boolean(j)))];
    const lids = [...new Set(mentions.map(m => normalizeSubmissionLid(m)).filter((l): l is string => Boolean(l)))];
    for (const model of models) if (jobNos.length) for (const row of await findLeads(model, { normalized_job_no: { $in: jobNos } }, PER_BASE)) add(row, "reference:stated_on_call");
    if (lids.length) for (const row of await findLeads("FormLead", { normalized_lid: { $in: lids } }, PER_BASE)) add(row, "reference:stated_on_call");
    for (const row of await findLeads("FormLead", { ref_no: { $in: mentions } }, PER_BASE)) add(row, "reference:stated_on_call");
  }
  if (!found.size) return [];

  // Existing edges are reported, never hidden: a candidate/ambiguous edge is what the Owner decides on.
  const edges = subject.contact_number_id
    ? await getNumberLeadAttachmentModel().find({ contact_number_id: toObjectId(subject.contact_number_id) }).select("lead_ref state certainty").limit(101).lean() : [];
  const edgeByLead = new Map(edges.map(e => [`${e.lead_ref.model}:${e.lead_ref.id}`, e]));

  return [...found.entries()].map(([key, { row, basis }]): LeadCandidate => {
    const edge = edgeByLead.get(key) ?? null;
    const received = row.timestamp instanceof Date ? row.timestamp.toISOString() : row.createdAt instanceof Date ? row.createdAt.toISOString() : null;
    return { lead_ref: { model: row.model, id: String(row._id) }, basis: [...basis].sort(), name: text(leadCustomerName(row)), received_at: received,
      source_company_label: text(leadSourceLabel(row), 80), job_no: text(row.job_no, 40), duplicate: Boolean(row.duplicate), booked: Boolean(row.booked), cancelled: Boolean(row.cancelled),
      bad_lead: Boolean(row.bad_lead), attachment_state: edge && edge.state !== "rejected" ? edge.state : null, certainty: edge?.certainty ?? null };
  }).sort((a, b) => (b.received_at ?? "").localeCompare(a.received_at ?? "") || a.lead_ref.id.localeCompare(b.lead_ref.id)).slice(0, TOTAL_MAX);
}
