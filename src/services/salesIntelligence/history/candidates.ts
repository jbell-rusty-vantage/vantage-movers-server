import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../../config/domain/runtime";
import { getCallInteractionModel } from "../../../models/CallInteraction";
import { getContactNumberModel } from "../../../models/ContactNumber";
import { leadPhoneMatchClauses, CALL_LEAD_ATTACHMENT_PHONE_PATHS, FORM_LEAD_ATTACHMENT_PHONE_PATHS } from "../../../models/leadContactPhoneIndexes";
import { toObjectId } from "../../../utils/objectId";
import { normalizePhoneNumberForMatch } from "../../../utils/phone";
import { normalizeComparisonName, normalizeJobNo, normalizeSubmissionLid } from "../../bookings/bookingIdentity";
import { redactSensitiveText } from "./redaction";

/**
 * Which Leads could a phone number belong to (MCP `find_lead_candidates`): Leads found by the
 * indexed phone paths, the Number's caller-ID names, a name the customer stated and any job or
 * reference they mentioned. Bounded and read only; nothing here attaches.
 */
export type HistoryLeadRef = { model: "FormLead" | "CallLead"; id: string };
/** A resolved Contact Number. Nothing after `as_of` is used. */
export type HistorySubject = { contact_number_id: string | null; e164: string | null; as_of: Date };
export type LeadCandidateBasis =
  | `phone:${string}`
  | "name:caller_id"
  | "name:stated_on_call"
  | "reference:stated_on_call";
export type LeadCandidate = {
  lead_ref: HistoryLeadRef;
  basis: LeadCandidateBasis[];
  name: string | null;
  received_at: string | null;
  source_company_label: string | null;
  job_no: string | null;
  duplicate: boolean;
  booked: boolean;
  cancelled: boolean;
  bad_lead: boolean;
  /**
   * The Lead's place in the number's All Numbers link: `lead` (the number's Lead), `other_lead` (another
   * matching Lead), `excluded` (the Owner unlinked it), or null.
   */
  link: "lead" | "other_lead" | "excluded" | null;
};
export type CandidateOptions = { stated_name?: string | null; reference_mentions?: string[]; window_anchor?: Date };

type LeadRow = {
  _id: mongoose.Types.ObjectId; model: "FormLead" | "CallLead";
  name?: string | null; timestamp?: Date | null; createdAt?: Date | null;
  source_company?: string | null; source_company_label_snapshot?: string | null; job_no?: string | null;
  duplicate?: boolean | null; bad_lead?: string | boolean | null;
  booked?: mongoose.Types.ObjectId | null; cancelled?: mongoose.Types.ObjectId | null;
  granot_contact_snapshot?: { name?: string | null } | null; normalized_phone_number?: string | null;
};
const LEAD_PROJECTION = {
  name: 1, timestamp: 1, createdAt: 1, source_company: 1, source_company_label_snapshot: 1, job_no: 1,
  duplicate: 1, bad_lead: 1, booked: 1, cancelled: 1, "granot_contact_snapshot.name": 1, normalized_phone_number: 1,
} as const;

const PER_BASE = 20;
const NAME_WINDOW_DAYS = 180;
const TOTAL_MAX = 60;
const db = () => mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true });
const leadCollection = (model: "FormLead" | "CallLead") => (model === "FormLead" ? "form_leads" : "call_leads");
const leadSourceLabel = (row: LeadRow) => row.source_company_label_snapshot ?? row.source_company ?? null;
const leadCustomerName = (row: LeadRow) => row.name?.trim() || row.granot_contact_snapshot?.name?.trim() || null;
const text = (value: unknown, max = 120): string | null => {
  if (value === null || value === undefined) return null;
  const s = redactSensitiveText(String(value)).text.trim();
  return s ? (s.length > max ? `${s.slice(0, max - 1)}…` : s) : null;
};
const pick = (row: LeadRow, path: string): unknown => path.split(".").reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), row);

const toE164 = (phone: string): string | null => {
  const digits = normalizePhoneNumberForMatch(phone);
  if (!digits) return null;
  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
};

/** The Contact Number fields the candidate search needs; null when purged or missing. */
async function readContactNumber(id: string): Promise<{ e164: string; provider_names: string[] } | null> {
  if (!mongoose.isValidObjectId(id)) return null;
  const row = await getContactNumberModel().findOne({ _id: toObjectId(id), purged_at: null }).select("e164 provider_names").lean();
  return row ? { e164: row.e164, provider_names: [...(row.provider_names ?? [])] } : null;
}

/** A phone (any format) or a Contact Number id to its unpurged Contact Number; null when nothing matches. */
export async function resolveHistorySubject(input: { phone?: string; contact_number_id?: string; as_of?: Date }): Promise<HistorySubject | null> {
  const as_of = input.as_of ?? new Date();
  if (input.contact_number_id) {
    const number = await readContactNumber(input.contact_number_id);
    return number ? { contact_number_id: input.contact_number_id, e164: number.e164, as_of } : null;
  }
  if (input.phone) {
    const e164 = toE164(input.phone);
    const row = e164 ? await getContactNumberModel().findOne({ e164, purged_at: null }).select("e164").lean() : null;
    return row ? { contact_number_id: String(row._id), e164: row.e164, as_of } : null;
  }
  return null;
}

type Found = { row: LeadRow; basis: Set<LeadCandidateBasis> };

async function findLeads(model: "FormLead" | "CallLead", filter: Record<string, unknown>, limit: number): Promise<LeadRow[]> {
  const rows = await db().collection(leadCollection(model)).find(filter, { projection: LEAD_PROJECTION }).sort({ _id: -1 }).limit(limit).toArray();
  return rows.map(row => ({ ...(row as unknown as LeadRow), model }));
}

export async function findLeadCandidates(subject: HistorySubject, options: CandidateOptions = {}): Promise<LeadCandidate[]> {
  const found = new Map<string, Found>();
  const add = (row: LeadRow, basis: LeadCandidateBasis) => {
    const key = `${row.model}:${row._id}`;
    const entry = found.get(key) ?? { row, basis: new Set<LeadCandidateBasis>() };
    entry.basis.add(basis);
    found.set(key, entry);
  };
  const models = ["FormLead", "CallLead"] as const;

  // 1. Phone paths, exactly the keys the All Numbers lead link joins on.
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
  const number = subject.contact_number_id ? await readContactNumber(subject.contact_number_id) : null;
  const callerNames = [...new Set((number?.provider_names ?? []).map(n => normalizeComparisonName(n)).filter((n): n is string => Boolean(n)))];
  const statedName = normalizeComparisonName(options.stated_name ?? null) ?? null;
  if (callerNames.length || statedName) {
    let anchor = options.window_anchor ?? null;
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
  const mentions = [...new Set((options.reference_mentions ?? []).map(m => m.trim()).filter(Boolean))].slice(0, 10);
  if (mentions.length) {
    const jobNos = [...new Set(mentions.map(m => normalizeJobNo(m)).filter((j): j is string => Boolean(j)))];
    const lids = [...new Set(mentions.map(m => normalizeSubmissionLid(m)).filter((l): l is string => Boolean(l)))];
    for (const model of models) if (jobNos.length) for (const row of await findLeads(model, { normalized_job_no: { $in: jobNos } }, PER_BASE)) add(row, "reference:stated_on_call");
    if (lids.length) for (const row of await findLeads("FormLead", { normalized_lid: { $in: lids } }, PER_BASE)) add(row, "reference:stated_on_call");
    for (const row of await findLeads("FormLead", { ref_no: { $in: mentions } }, PER_BASE)) add(row, "reference:stated_on_call");
  }
  if (!found.size) return [];

  // The number's link is reported, never hidden: which candidate is its Lead, which are other matches, which the Owner unlinked.
  const linked = subject.contact_number_id
    ? (await getContactNumberModel().findById(toObjectId(subject.contact_number_id), { lead: 1, other_leads: 1, lead_link: 1 }).lean()) as unknown as {
      lead?: { model: string; id: unknown } | null; other_leads?: Array<{ model: string; id: unknown }>; lead_link?: { excluded?: Array<{ model: string; id: unknown }> } | null } | null
    : null;
  const linkByLead = new Map<string, LeadCandidate["link"]>();
  for (const lead of linked?.lead_link?.excluded ?? []) linkByLead.set(`${lead.model}:${String(lead.id)}`, "excluded");
  for (const lead of linked?.other_leads ?? []) linkByLead.set(`${lead.model}:${String(lead.id)}`, "other_lead");
  if (linked?.lead) linkByLead.set(`${linked.lead.model}:${String(linked.lead.id)}`, "lead");

  return [...found.entries()].map(([key, { row, basis }]): LeadCandidate => {
    const received = row.timestamp instanceof Date ? row.timestamp.toISOString() : row.createdAt instanceof Date ? row.createdAt.toISOString() : null;
    return { lead_ref: { model: row.model, id: String(row._id) }, basis: [...basis].sort(), name: text(leadCustomerName(row)), received_at: received,
      source_company_label: text(leadSourceLabel(row), 80), job_no: text(row.job_no, 40), duplicate: Boolean(row.duplicate), booked: Boolean(row.booked), cancelled: Boolean(row.cancelled),
      bad_lead: Boolean(row.bad_lead), link: linkByLead.get(key) ?? null };
  }).sort((a, b) => (b.received_at ?? "").localeCompare(a.received_at ?? "") || a.lead_ref.id.localeCompare(b.lead_ref.id)).slice(0, TOTAL_MAX);
}
