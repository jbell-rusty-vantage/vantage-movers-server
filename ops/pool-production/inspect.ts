import mongoose, { type ClientSession } from "mongoose";
import { jobNumbersEquivalent, normalizeJobNo } from "../../src/services/bookings/bookingIdentity";
import { createConfigurationLoader } from "../../src/services/salesOutreach/config/load";
import { findDeskRepIdsAt } from "../../src/services/salesOutreach/roster/store";
import { resolveSourcePolicy, type SourcePolicyStore } from "../../src/services/granotLifecycle/sourcePolicy";
import { inspectPoolCandidates } from "../../src/services/salesOutreach/pool/admission";
import { buildManifest, contentHash, keyOf, selectionSchema, type CandidatePin, type LeadRef } from "./manifest";

const oid = (id: string) => new mongoose.Types.ObjectId(id);
const str = (v: unknown): string | null => v == null ? null : String(v);
const iso = (v: unknown): string | null => v instanceof Date && Number.isFinite(+v) ? v.toISOString() : null;

/** Raw Booking reads intentionally avoid legacy Boolean casts/population and cancellation filters. */
export async function inspectPilot(refs: readonly LeadRef[], database: string, now = new Date(), session: ClientSession | null = null) {
  selectionSchema.parse(refs);
  const db = mongoose.connection.useDb(database, { useCache: true }).db!;
  const options = { session: session ?? undefined };
  const config = await createConfigurationLoader().requireActive(session ?? undefined);
  const deskReps = new Set(await findDeskRepIdsAt(now, session));
  const canonical = await inspectPoolCandidates(refs, session);
  const sourceStore: SourcePolicyStore = {
    async findByNormalizedLabel(label) {
      const rows = await db.collection("granot_crm_sources").find({ normalized_granot_label: label }, options).toArray();
      return rows.map(r => ({ id: String(r._id), enabled: r.enabled !== false, lifecycle_enabled: r.lifecycle_enabled === true,
        lifecycle_disposition: r.lifecycle_disposition ?? "deferred", lead_created_policy: r.lead_created_policy ?? "observation_only",
        lead_source_company: str(r.lead_source_company) ?? undefined, lifecycle_policy_version: r.lifecycle_policy_version ?? "",
        lifecycle_routes: (r.lifecycle_routes ?? []).map((route: any) => ({ ...route, source_granularity_id: String(route.source_granularity_id) })) }));
    },
    async findCompany(id) { const row = await db.collection("lead_source_companies").findOne({ _id: oid(id) }, options); return row ? { id, active: row.active === true } : null; },
    async findGranularity(id) { const row = await db.collection("lead_source_granularities").findOne({ _id: oid(id) }, options); return row ? { id, source_company_id: String(row.source_company), active: row.active === true, channel: row.channel, local: row.local } : null; },
  };
  const candidates: CandidatePin[] = [];
  for (const ref of refs) {
    const lead = await db.collection(ref.model === "FormLead" ? "form_leads" : "call_leads").findOne({ _id: oid(ref.id) }, options);
    if (!lead) throw new Error(`Selected Lead is missing (${keyOf(ref)})`);
    const job = normalizeJobNo(lead.job_no);
    const observationId = str(lead.last_accepted_granot_observation?.observation_id);
    const observation = observationId ? await db.collection("granot_observations").findOne({ _id: oid(observationId) }, options) : null;
    const receipt = observation ? await db.collection("granot_webhook_receipts").findOne({ _id: observation.receipt_id }, options) : null;
    const decision = observation ? await db.collection("synchronization_decisions").find({ observation_id: observation._id }, options).sort({ attempt: -1 }).limit(1).next() : null;
    const links = job ? await db.collection("granot_record_links").find({ normalized_job_no: job, state: "active" }, options).toArray() : [];
    const acceptedCandidate = canonical.find(c => c.facts?.ref.model === ref.model && c.facts.ref.id === ref.id);
    const link = acceptedCandidate?.anchor ? await db.collection("granot_record_links").findOne({ _id: oid(acceptedCandidate.anchor.record_link_id) }, options) : links.length === 1 ? links[0]! : null;
    const subjects = await db.collection("sales_outreach_subjects").find({ lead_model: ref.model, lead_id: oid(ref.id) }, options).toArray();
    const subject = subjects.length === 1 ? subjects[0]! : null;
    const jobQuery = { $or: [{ normalized_job_no: job }, { job_no: job }] };
    const sameJob = job ? await db.collection("form_leads").countDocuments(jobQuery, options) + await db.collection("call_leads").countDocuments(jobQuery, options) : 0;
    const booking = await db.collection("booked_leads").findOne({ $or: [
      { lead_ref: { $in: [oid(ref.id), ref.id, ref.id.toUpperCase()] } },
      ...(job ? [{ normalized_job_no: job }, { job_no: job }] : []),
    ] }, options);
    const source = observation?.source_label_raw ? await resolveSourcePolicy({ source_label: observation.source_label_raw,
      origin_state: observation.move?.origin?.state, destination_state: observation.move?.destination?.state }, sourceStore) : null;
    const scope = source?.ok ? source.snapshot : null;
    const newerInvalid = job && observation ? await db.collection("granot_observations").findOne({ "identity.normalized_job_no": job,
      "priority.valid": false, "priority.raw": { $exists: true, $ne: null }, captured_at: { $gt: observation.captured_at } }, options) : null;
    const lineage = (lead.sheet_sync ?? []).filter((row: any) => row.target === (ref.model === "FormLead" ? "master_forms" : "master_calls"));
    const checks: Record<string, boolean> = {
      canonical_membership_eligible: acceptedCandidate?.eligible === true,
      stored_pool: String(lead.granot_priority) === "9",
      assigned_desk_rep: !!lead.receiver_agent && deskReps.has(String(lead.receiver_agent)),
      no_official_closure: !lead.booked && !lead.cancelled && !booking && !link?.booking_ref,
      ordinary_existing_lead: lead.duplicate !== true && !lead.bad_lead && lead.created_on_unmatched !== true,
      unique_job: !!job && job === normalizeJobNo(lead.normalized_job_no) && sameJob === 1,
      unique_undisputed_link: links.length === 1 && !!link && !link.disputed && link.lead_ref?.model === ref.model && String(link.lead_ref?.id) === ref.id,
      accepted_pool_evidence: !!observation && observation.priority?.valid === true && observation.priority?.canonical === "9" && jobNumbersEquivalent(observation.identity?.normalized_job_no, job) && iso(observation.captured_at) === iso(lead.last_accepted_granot_observation?.captured_at),
      committed_matching_decision: !!decision && ["applied", "already_current", "linked"].includes(decision.outcome) && decision.target?.model === ref.model && decision.target?.id === ref.id && receipt?.processing?.state === "completed",
      live_source_scope: !!scope && scope.lifecycle_disposition === "source_scoped_lead" && scope.source_company_active === true && scope.source_granularity_active === true && scope.selected_lead_model === ref.model && scope.lead_source_company_id === str(lead.lead_source_company) && scope.source_granularity_id === str(lead.source_granularity_id) && str(link?.source_scope?.lead_source_company) === str(lead.lead_source_company) && str(link?.source_scope?.source_granularity_id) === str(lead.source_granularity_id),
      subject_not_closed_or_review: subjects.length <= 1 && (!subject || subject.status === "active" && !(subject.review_reasons ?? []).length && subject.priority?.uncertain !== true),
      priority_not_uncertain: !newerInvalid,
      existing_master_lineage: lineage.some((row: any) => row.status === "synced" && !!row.last_synced_at),
    };
    candidates.push({ lead: ref, lead_revision: lead.domain_revision ?? 0, receiver_agent_id: str(lead.receiver_agent), job_hash: contentHash(job),
      source_company_id: str(lead.lead_source_company), source_granularity_id: str(lead.source_granularity_id), source_policy_hash: contentHash(source),
      accepted_observation_id: observationId, accepted_at: iso(lead.last_accepted_granot_observation?.captured_at), decision_id: str(decision?._id),
      link_id: str(link?._id), link_revision: link?.domain_revision ?? null, subject_id: str(subject?._id), subject_revision: subject?.revision ?? null,
      sheet_lineage_hash: contentHash(lead.sheet_sync ?? []), checks, holds: Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name) });
  }
  return buildManifest({ database, captured_at: now.toISOString(), configuration_revision: config.revision, configuration_hash: config.content_hash, candidates });
}
