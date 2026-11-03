import mongoose from "mongoose";
import { SourceRowReceipt } from "../../src/models/SourceRowReceipt";
import { SourceRowState } from "../../src/models/SourceRowState";
import { getFormLeadModel } from "../../src/models/FormLead";
import { getCallLeadModel } from "../../src/models/CallLead";
import { BookedLead } from "../../src/models/BookedLead";
import { CancelledLead } from "../../src/models/CancelledLead";
import type { CanonicalAdoptionStore, CanonicalLeadDoc } from "../../src/services/bestRelocationSheetIngest/canonicalLeadAdoption";
import { FORM_ADOPTION_STORED_CUTOFF } from "../../src/services/bestRelocationSheetIngest/canonicalLeadAdoption";
import type { BestRelocationApplicationPlan } from "../../src/services/bestRelocationSheetIngest/applicationPlan";
import { normalizePhoneNumberForMatch } from "../../src/utils/phone";
import { normalizeJobNo } from "../../src/services/bookings/bookingIdentity";
import type { ParsedCallLead } from "../../src/services/bestRelocationSheetIngest/types";

type Row = Record<string, any>;
type SourceIdentity = { dataset_key: string; stable_source_row_id: string };
const BATCH = 100, CANDIDATE_CAP = 5000;
const chunks = <T>(rows: T[]) => Array.from({ length: Math.ceil(rows.length / BATCH) }, (_, index) => rows.slice(index * BATCH, (index + 1) * BATCH));
export const sourceIdentityKey = (row: SourceIdentity) => `${row.dataset_key}:${row.stable_source_row_id}`;
const targetProjection = "_id name phone_number normalized_phone_number timestamp createdAt ingestion_origin ref_no lid normalized_lid duplicate domain_revision external_sheet_review source source_company lead_ref lead_model job_no normalized_job_no total_binder_amount deposit_amount refund_amount booked_lead cancelled booked ringcentral created_on_unmatched form_fill bad_lead sheet_sync";
const models = () => ({ FormLead: getFormLeadModel(), CallLead: getCallLeadModel(), BookedLead, CancelledLead }) as Record<string, mongoose.Model<any>>;

/** Reads are bounded by frozen source identities, never by the whole collection. */
export async function loadSourceEvidence(connectionId: string | null, identities: SourceIdentity[]) {
  const latest = new Map<string, Row>(), canonical = new Map<string, Row>(), states = new Map<string, Row>();
  if (!connectionId) return { latest, canonical, states };
  for (const dataset of [...new Set(identities.map(row => row.dataset_key))]) {
    const ids = [...new Set(identities.filter(row => row.dataset_key === dataset).map(row => row.stable_source_row_id))];
    for (const batch of chunks(ids)) {
      const match = { connection_id: new mongoose.Types.ObjectId(connectionId), dataset_key: dataset, stable_source_row_id: { $in: batch }, outcome: { $in: ["applied", "already_applied", "adopted"] } };
      const project = { dataset_key: 1, stable_source_row_id: 1, content_hash: 1, resulting_canonical_model: 1, resulting_canonical_ids: 1, last_applied_source_values: 1, observation_type: 1, createdAt: 1 };
      const first = [{ $sort: { createdAt: -1 as const, _id: -1 as const } }, { $group: { _id: "$stable_source_row_id", row: { $first: "$$ROOT" } } }];
      const [result] = await SourceRowReceipt.aggregate([{ $match: match }, { $project: project }, { $facet: { latest: first, canonical: [{ $match: { observation_type: { $ne: "final_review" } } }, ...first] } }]);
      for (const entry of result?.latest ?? []) latest.set(sourceIdentityKey(entry.row), entry.row);
      for (const entry of result?.canonical ?? []) canonical.set(sourceIdentityKey(entry.row), entry.row);
      const current = await SourceRowState.find({ connection_id: connectionId, dataset_key: dataset, stable_source_row_id: { $in: batch }, schema_version: 2 })
        .select("dataset_key stable_source_row_id source_state last_applied_content_hash last_applied_source_values").limit(BATCH + 1).lean();
      if (current.length > BATCH) throw new Error("source_state_identity_bound_exceeded");
      for (const row of current) states.set(sourceIdentityKey(row), row);
    }
  }
  return { latest, canonical, states };
}

const leadDoc = (row: Row): CanonicalLeadDoc => ({ id: String(row._id), name: row.name, phone_number: row.phone_number,
  normalized_phone_number: row.normalized_phone_number, timestamp: row.timestamp, createdAt: row.createdAt, ingestion_origin: row.ingestion_origin,
  ref_no: row.ref_no, lid: row.lid, normalized_lid: row.normalized_lid });

export function cachedCanonicalAdoptionStore(input: { forms: Row[]; bookings: Row[]; cancellations: Row[] }): CanonicalAdoptionStore {
  return {
    findFormLeadsByIdentity: async identities => input.forms.filter(row => identities.some(id => row.ref_no === id || row.lid === id || row.normalized_lid === id.toLowerCase())).map(leadDoc),
    findFormLeadsByPhoneNameDate: async ({ phone }) => input.forms.filter(row => row.duplicate !== true && row.timestamp instanceof Date && +row.timestamp >= +FORM_ADOPTION_STORED_CUTOFF &&
      (normalizePhoneNumberForMatch(row.normalized_phone_number) ?? normalizePhoneNumberForMatch(row.phone_number)) === phone).map(leadDoc),
    findCallLeadsByPhoneTimestamp: async () => { throw new Error("final_source_plan_cannot_adopt_or_create_calls_through_legacy_path"); },
    findBookingsByJob: async job => input.bookings.filter(row => row.normalized_job_no === job).map(row => ({ id: String(row._id), normalized_job_no: row.normalized_job_no })),
    findCancellationsByBooking: async id => input.cancellations.filter(row => String(row.booked_lead) === id).map(row => ({ id: String(row._id), booked_lead: String(row.booked_lead) })),
  };
}

export async function preloadCanonicalAdoption(plan: BestRelocationApplicationPlan, receiptBookingIds: string[]) {
  const forms = new Map<string, Row>(), bookings = new Map<string, Row>(), cancellations = new Map<string, Row>();
  async function collect(Model: mongoose.Model<any>, filter: Row, destination: Map<string, Row>) {
    const rows = await Model.find(filter).select(targetProjection).limit(CANDIDATE_CAP + 1).lean();
    if (rows.length > CANDIDATE_CAP) throw new Error("source_plan_candidate_bound_exceeded");
    for (const row of rows) destination.set(String(row._id), row);
  }
  const payloads = plan.actions.filter(action => action.command === "create_form_lead").map(action => action.command_payload ?? {});
  const identities = [...new Set(payloads.flatMap(row => [row.ref_no, row.lid]).filter(value => typeof value === "string" && value.trim()).map(String))];
  for (const batch of chunks(identities)) await collect(getFormLeadModel(), { source_company: "best_relocation_leads", $or: [
    { ref_no: { $in: batch } }, { lid: { $in: batch } }, { normalized_lid: { $in: batch.map(id => id.toLowerCase()) } },
  ] }, forms);
  const phones = [...new Set(payloads.map(row => normalizePhoneNumberForMatch(row.phone_number as string)).filter((value): value is string => !!value))];
  for (const batch of chunks(phones)) await collect(getFormLeadModel(), { source_company: "best_relocation_leads", duplicate: { $ne: true }, timestamp: { $gte: FORM_ADOPTION_STORED_CUTOFF },
    $or: [{ normalized_phone_number: { $in: batch } }, { phone_number: { $in: batch } }] }, forms);
  const jobs = [...new Set(plan.actions.filter(action => ["create_booked_from_source", "create_leadless_booking"].includes(action.command))
    .map(action => normalizeJobNo(String(action.command_payload?.job_no ?? action.command_payload?.call_job_no ?? ""))).filter((value): value is string => !!value))];
  for (const batch of chunks(jobs)) await collect(BookedLead, { normalized_job_no: { $in: batch } }, bookings);
  const bookingIds = [...new Set([...bookings.keys(), ...receiptBookingIds])].filter(mongoose.isValidObjectId);
  for (const batch of chunks(bookingIds)) await collect(CancelledLead, { booked_lead: { $in: batch } }, cancellations);
  return cachedCanonicalAdoptionStore({ forms: [...forms.values()], bookings: [...bookings.values()], cancellations: [...cancellations.values()] });
}

export async function loadSourcePlanTargets(refs: Array<{ model: string; id: string }>) {
  const found = new Map<string, Row>(), Models = models();
  for (const model of [...new Set(refs.map(ref => ref.model))]) {
    if (!Models[model]) continue;
    for (const ids of chunks([...new Set(refs.filter(ref => ref.model === model).map(ref => ref.id))].filter(mongoose.isValidObjectId))) {
      const rows = await Models[model]!.find({ _id: { $in: ids } }).select(targetProjection).limit(BATCH + 1).lean();
      if (rows.length > BATCH) throw new Error("source_plan_target_bound_exceeded");
      for (const row of rows) found.set(`${model}:${row._id}`, row);
    }
  }
  return found;
}

export async function loadSourceCallCandidates(calls: ParsedCallLead[], companyId: string, granularities: string[]) {
  const candidates = new Map<string, Row>();
  const phones = [...new Set(calls.map(row => row.normalized_phone).filter((phone): phone is string => !!phone))];
  const times = calls.map(row => Date.parse(row.timestamp ?? "")).filter(Number.isFinite);
  if (!times.length) return [];
  const from = new Date(Math.min(...times) - 1000), through = new Date(Math.max(...times) + 1000);
  for (const granularity of granularities) for (const batch of chunks(phones)) {
    const rows = await getCallLeadModel().find({ lead_source_company: companyId, source_granularity_id: granularity,
      normalized_phone_number: { $in: batch }, "ringcentral.start_time": { $gte: from, $lte: through } })
      .hint({ source_granularity_id: 1, normalized_phone_number: 1, createdAt: -1 })
      .select(targetProjection).limit(CANDIDATE_CAP + 1).lean();
    if (rows.length > CANDIDATE_CAP) throw new Error("source_call_candidate_bound_exceeded");
    for (const row of rows) candidates.set(String(row._id), row);
  }
  return [...candidates.values()];
}
