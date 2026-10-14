import mongoose, { type ClientSession } from "mongoose";
import { getFormLeadModel } from "../../../models/FormLead";
import { getCallLeadModel } from "../../../models/CallLead";
import { BookedLead } from "../../../models/BookedLead";
import { getGranotRecordLinkModel } from "../../../models/GranotRecordLink";
import { getLeadSourceCompanyModel } from "../../../models/LeadSourceCompany";
import { getLeadSourceGranularityModel } from "../../../models/LeadSourceGranularity";
import { getSalesOutreachPoolWorkModel, getSalesOutreachLiveEventModel } from "../../../models/salesOutreach";
import type { ActiveConfiguration } from "../config/load";
import { OutreachError } from "../errors";
import { evaluateDeskEligibility } from "../subjects/eligibility";
import { type DeskLeadRef, type DeskLeadFacts, DESK_LEAD_PROJECTION, toDeskLeadFacts } from "../subjects/leadFacts";
import { mongoDeskSubjectStore, type DeskSubjectRow } from "../subjects/store";
import { loadSubjectPageContext, syncSubject, hasAmbiguousIdentity } from "../subjects/sync";
import { poolEnabled } from "./policy";
import { recomputePoolDuty } from "./duties";
import { newYorkBusinessDay } from "../reads/businessDay";
import { jobNumbersEquivalent, equivalentNormalizedJobFilter, normalizeJobNo } from "../../bookings/bookingIdentity";
import { getGranotObservationModel } from "../../../models/GranotObservation";
import { getGranotObservationReceiptModel } from "../../../models/GranotObservationReceipt";
import { getSynchronizationDecisionModel } from "../../../models/SynchronizationDecision";
import { getGranotCrmSourceModel } from "../../../models/GranotCrmSource";

const oid = (id: string) => new mongoose.Types.ObjectId(id);
export type PoolCandidateAnchor = {
  record_link_id: string; record_link_revision: number; source_company_id: string;
  source_granularity_id: string; observation_id: string; domain_revision: number;
};
export type PoolCandidate = { eligible: boolean; reason: string | null; facts: DeskLeadFacts | null; subject: DeskSubjectRow | null; anchor: PoolCandidateAnchor | null };
type RawPoolBooking = { lead_ref?: unknown; normalized_job_no?: unknown; job_no?: unknown };

/** A partial or contradictory Booking pointer is a hold, never evidence that a Lead is free. */
export function poolBookingBlocks(booking: RawPoolBooking, ref: DeskLeadRef, job: string): boolean {
  return String(booking.lead_ref ?? "").toLowerCase() === ref.id
    || (typeof booking.normalized_job_no === "string" && jobNumbersEquivalent(booking.normalized_job_no, job))
    || (typeof booking.job_no === "string" && jobNumbersEquivalent(normalizeJobNo(booking.job_no), job));
}

/** Batched fresh authorization: a fixed set of reads per <=1,000 work records, never N+1. */
export async function inspectPoolCandidates(refs: readonly DeskLeadRef[], session: ClientSession | null = null): Promise<PoolCandidate[]> {
  if (!refs.length) return [];
  const rawByKey = new Map<string, Record<string, unknown> & { _id: unknown }>();
  for (const kind of ["FormLead", "CallLead"] as const) {
    const ids = refs.filter((r) => r.model === kind).map((r) => oid(r.id));
    if (!ids.length) continue;
    const model = (kind === "FormLead" ? getFormLeadModel() : getCallLeadModel()) as unknown as mongoose.Model<Record<string, unknown>>;
    const rows = await model.find({ _id: { $in: ids } }, { ...DESK_LEAD_PROJECTION, lead_source_company: 1, source_granularity_id: 1 }).session(session).lean();
    for (const row of rows) rawByKey.set(`${kind}:${String(row._id)}`, row as Record<string, unknown> & { _id: unknown });
  }
  const subjects = await mongoDeskSubjectStore.findSubjects(refs, session);
  const subjectByKey = new Map<string, DeskSubjectRow>(subjects.map((s) => [`${s.lead.model}:${s.lead.id}`, s]));
  const factsByKey = new Map<string, DeskLeadFacts>(refs.flatMap((r) => { const raw = rawByKey.get(`${r.model}:${r.id}`); return raw ? [[`${r.model}:${r.id}`, toDeskLeadFacts(r.model, raw)] as const] : []; }));
  const rawRows = [...rawByKey.values()];
  const companyIds = [...new Set(rawRows.flatMap((r) => r.lead_source_company ? [String(r.lead_source_company)] : []))];
  const granularityIds = [...new Set(rawRows.flatMap((r) => r.source_granularity_id ? [String(r.source_granularity_id)] : []))];
  const companies = await getLeadSourceCompanyModel().find({ _id: { $in: companyIds }, active: true }).session(session).lean();
  const granularities = await getLeadSourceGranularityModel().find({ _id: { $in: granularityIds }, active: true }).session(session).lean();
  const jobs = [...new Set([...factsByKey.values()].flatMap((f) => f.normalized_job_no ? [f.normalized_job_no] : []))];
  const jobQueries = jobs.map(equivalentNormalizedJobFilter);
  const links = await getGranotRecordLinkModel().find({ provider: "granot", state: "active", $or: [...refs.map((r) => ({ "lead_ref.model": r.model, "lead_ref.id": oid(r.id) })), ...jobQueries] }).session(session).lean();
  const bookings = await getFormLeadModel().db.collection<RawPoolBooking>(BookedLead.collection.collectionName).find({ $or: [
    ...refs.map((r) => ({ lead_ref: { $in: [oid(r.id), r.id, r.id.toUpperCase()] } })), ...jobQueries,
    // Legacy raw Jobs may lack or contradict the normalized key. Project once per batch and use
    // the canonical NFKC/case/punctuation normalizer below; field-only regexes cannot reproduce it.
    { job_no: { $type: "string" } },
  ] }, { session: session ?? undefined, projection: { lead_model: 1, lead_ref: 1, normalized_job_no: 1, job_no: 1 } }).toArray();
  const identities: { normalized_job_no: string }[] = [];
  if (jobQueries.length) for (const model of [getFormLeadModel(), getCallLeadModel()]) {
    const rows = await (model as unknown as mongoose.Model<Record<string, unknown>>).find({ duplicate: { $ne: true }, $or: jobQueries }, { normalized_job_no: 1 }).session(session).lean();
    for (const row of rows) if (typeof row.normalized_job_no === "string") identities.push({ normalized_job_no: row.normalized_job_no });
  }
  const observationIds = [...factsByKey.values()].flatMap((f) => f.accepted_observation ? [f.accepted_observation.observation_id] : []);
  const observations = await getGranotObservationModel().find({ _id: { $in: observationIds } }).session(session).lean();
  const decisions = await getSynchronizationDecisionModel().find({ observation_id: { $in: observationIds } }).sort({ attempt: -1 }).session(session).lean();
  const receipts = await getGranotObservationReceiptModel().find({ _id: { $in: observations.map((o) => o.receipt_id) } }, { processing: 1 }).session(session).lean();
  const sources = await getGranotCrmSourceModel().find({ _id: { $in: decisions.flatMap((d) => d.source_scope ? [d.source_scope.granot_crm_source_id] : []) } }).session(session).lean();
  return refs.map((ref): PoolCandidate => {
    const key = `${ref.model}:${ref.id}`, raw = rawByKey.get(key), facts = factsByKey.get(key) ?? null, subject = subjectByKey.get(key) ?? null;
    const refuse = (reason: string): PoolCandidate => ({ eligible: false, reason, facts, subject, anchor: null });
    if (!facts) return refuse("lead_missing");
    const eligibility = evaluateDeskEligibility({ kind: "lead", facts });
    if (eligibility.outcome !== "eligible") return refuse(eligibility.reason);
    if (subject?.status === "closed") return refuse("closed_subject_reopening_required");
    if (facts.granot_priority !== "9" || !facts.accepted_observation) return refuse("accepted_pool_priority_required");
    if (!facts.normalized_job_no || !raw?.lead_source_company || !raw.source_granularity_id) return refuse("source_or_identity_missing");
    const companyId = String(raw.lead_source_company), granularityId = String(raw.source_granularity_id);
    const company = companies.find((c) => String(c._id) === companyId), granularity = granularities.find((g) => String(g._id) === granularityId);
    if (!company || !granularity || String(granularity.source_company) !== companyId || granularity.channel !== (ref.model === "FormLead" ? "form" : "call")) return refuse("source_scope_unavailable");
    const observation = observations.find((o) => String(o._id) === facts.accepted_observation!.observation_id);
    const matches = links.filter((l) => (l.lead_ref?.model === ref.model && String(l.lead_ref.id) === ref.id) || jobNumbersEquivalent(l.normalized_job_no, facts.normalized_job_no));
    // Canonical priority-only matching may retain both a digit and prefixed Job Record Link.
    // They are one coherent identity only when every alias still anchors this same Lead/source.
    const link = matches.find((l) => l.normalized_job_no === observation?.identity.normalized_job_no)
      ?? matches.find((l) => l.normalized_job_no === facts.normalized_job_no) ?? matches[0];
    if (!link || matches.some((l) => l.disputed || l.booking_ref || l.lead_ref?.model !== ref.model || String(l.lead_ref.id) !== ref.id
      || !jobNumbersEquivalent(l.normalized_job_no, facts.normalized_job_no) || String(l.source_scope?.lead_source_company) !== companyId
      || String(l.source_scope?.source_granularity_id) !== granularityId)) return refuse("record_link_conflict");
    if (bookings.some((b) => poolBookingBlocks(b, ref, facts.normalized_job_no!))) return refuse("official_booking");
    if (identities.filter((i) => jobNumbersEquivalent(i.normalized_job_no, facts.normalized_job_no)).length !== 1) return refuse("ambiguous_identity");
    if (!observation || !["valid", "valid_with_issues"].includes(observation.normalization_result) || !observation.priority.valid || observation.priority.canonical !== "9"
      || +observation.captured_at !== +facts.accepted_observation.captured_at || !jobNumbersEquivalent(observation.identity.normalized_job_no, facts.normalized_job_no)) return refuse("accepted_observation_conflict");
    const decision = decisions.find((d) => String(d.observation_id) === String(observation._id)), receipt = receipts.find((r) => String(r._id) === String(observation.receipt_id));
    if (!decision || decision.execution_mode !== "live" || !["created", "linked", "applied", "already_current"].includes(decision.outcome)
      || decision.target?.model !== ref.model || String(decision.target?.id) !== ref.id
      || String(decision.source_scope?.lead_source_company) !== companyId || String(decision.source_scope?.source_granularity_id) !== granularityId
      || receipt?.processing.state !== "completed") return refuse("accepted_decision_unavailable");
    const source = sources.find((s) => String(s._id) === String(decision.source_scope?.granot_crm_source_id));
    if (!source?.enabled || !source.lifecycle_enabled || source.lifecycle_disposition !== "source_scoped_lead"
      || source.lifecycle_policy_version !== decision.source_scope?.policy_version || String(source.lead_source_company) !== companyId
      || !source.lifecycle_routes.some((r) => r.lead_model === ref.model && String(r.source_granularity_id) === granularityId)) return refuse("source_policy_unavailable");
    return { eligible: true, reason: null, facts, subject, anchor: { record_link_id: String(link._id), record_link_revision: link.domain_revision,
      source_company_id: companyId, source_granularity_id: granularityId, observation_id: facts.accepted_observation.observation_id, domain_revision: facts.domain_revision } };
  });
}

/** Canonical identity/source/closure inspection, shared by report, explicit pilot and accepted-fact refresh. */
export async function inspectPoolCandidate(ref: DeskLeadRef, session: ClientSession | null = null): Promise<PoolCandidate> {
  return (await inspectPoolCandidates([ref], session))[0]!;
}

export type ActivatePoolCandidateInput = {
  ref: DeskLeadRef; expected_domain_revision: number; expected_observation_id: string;
  expected_record_link_id: string; expected_source_company_id: string; expected_source_granularity_id: string;
  expected_record_link_revision?: number; approval_ref: string;
};

export async function poolInvalidation(session: ClientSession, now: Date) {
  // Transactional outbox hint: consumers observe it only after the duty/membership commit.
  await getSalesOutreachLiveEventModel().create([{ topic: "outreach_pool", subject_ids: [], agent_ids: [], business_day: newYorkBusinessDay(now), revision: null, cause: "evaluation" }], { session });
}

/** Configuration disable is a prospective exit even when no Lead changes or collector runs occur. */
export async function closePoolSharing(now: Date, session: ClientSession) {
  const Model = getSalesOutreachPoolWorkModel();
  const active = await Model.find({ active: true }).session(session).lean();
  for (const work of active) {
    const episodes = work.episodes.map((e) => ({ started_at: e.started_at, ended_at: e.ended_at ?? now, observation_id: e.observation_id }));
    const result = await Model.updateOne({ _id: work._id, revision: work.revision }, { $set: { active: false, episodes, exit_reason: "pool_disabled" }, $inc: { revision: 1 } }, { session });
    if (result.matchedCount !== 1) throw new OutreachError("REVISION_CONFLICT");
  }
  if (active.length) await poolInvalidation(session, now);
  return active.length;
}

/** Explicit selected-ID activation. Caller pins configuration revision and owns the transaction. */
export async function activatePoolCandidate(input: ActivatePoolCandidateInput, configuration: ActiveConfiguration, now: Date, session: ClientSession) {
  if (!poolEnabled(configuration.value)) throw new OutreachError("INVALID_INPUT", [{ path: "pool", code: "pool_disabled" }]);
  const candidate = await inspectPoolCandidate(input.ref, session);
  const a = candidate.anchor;
  if (!candidate.eligible || !candidate.facts || !a) throw new OutreachError("INVALID_INPUT", [{ path: "lead", code: candidate.reason ?? "ineligible" }]);
  if (a.domain_revision !== input.expected_domain_revision || a.observation_id !== input.expected_observation_id
    || a.record_link_id !== input.expected_record_link_id || a.source_company_id !== input.expected_source_company_id
    || a.source_granularity_id !== input.expected_source_granularity_id
    || (input.expected_record_link_revision !== undefined && a.record_link_revision !== input.expected_record_link_revision)) throw new OutreachError("REVISION_CONFLICT");
  return writePoolCandidate(candidate, configuration, now, session, input.approval_ref);
}

async function writePoolCandidate(candidate: PoolCandidate, configuration: ActiveConfiguration, now: Date, session: ClientSession, approvalRef: string) {
  const facts = candidate.facts!;
  const context = await loadSubjectPageContext(mongoDeskSubjectStore, [facts], now, session);
  if (hasAmbiguousIdentity(facts, context) || context.uncertain_leads.size) throw new OutreachError("REVISION_CONFLICT");
  const synced = await syncSubject({ facts, subject: candidate.subject, configuration, context,
    enrollment: { cohort_id: `pool:${approvalRef}`, kind: "expansion", enrolled_at: now, activation_at: now, manifest_hash: null } }, mongoDeskSubjectStore, session);
  if (synced.status === "closed") throw new OutreachError("REVISION_CONFLICT");
  const Model = getSalesOutreachPoolWorkModel();
  const previous = await Model.findOne({ lead_model: facts.ref.model, lead_id: oid(facts.ref.id) }).session(session).lean();
  const observation = oid(facts.accepted_observation!.observation_id);
  if (!previous) {
    await Model.create([{ lead_model: facts.ref.model, lead_id: oid(facts.ref.id), subject_id: oid(synced.subject_id), active: true,
      episodes: [{ started_at: now, ended_at: null, observation_id: observation }], policy_version: configuration.value.pool!.policy_version,
      approval_ref: approvalRef, accepted_observation_id: observation, lead_revision_seen: facts.domain_revision, exit_reason: null, revision: 1 }], { session });
    await poolInvalidation(session, now);
  } else {
    const episodes = previous.episodes.map((e) => ({ started_at: e.started_at, ended_at: e.ended_at, observation_id: e.observation_id }));
    if (!previous.active) episodes.push({ started_at: now, ended_at: null, observation_id: observation });
    const changed = !previous.active || previous.lead_revision_seen !== facts.domain_revision || String(previous.accepted_observation_id) !== String(observation);
    if (changed) {
      const updated = await Model.updateOne({ _id: previous._id, revision: previous.revision }, { $set: { active: true, episodes, accepted_observation_id: observation,
        lead_revision_seen: facts.domain_revision, exit_reason: null }, $inc: { revision: 1 } }, { session });
      if (updated.matchedCount !== 1) throw new OutreachError("REVISION_CONFLICT");
      await poolInvalidation(session, now);
    }
  }
  await recomputePoolDuty(synced.subject_id, newYorkBusinessDay(now), configuration, now, session);
  await mongoDeskSubjectStore.requestEvaluation(synced.subject_id, synced.subject_revision, session);
  return { subject_id: synced.subject_id, lead: facts.ref, outcome: previous?.active ? "refreshed" : "activated" };
}

/** Current canonical state wins, including no-op accepted9 refresh. A cohort-only gate never admits other Leads. */
export async function refreshPoolLead(ref: DeskLeadRef, configuration: ActiveConfiguration, now: Date, session: ClientSession) {
  const Model = getSalesOutreachPoolWorkModel();
  const previous = await Model.findOne({ lead_model: ref.model, lead_id: oid(ref.id) }).session(session).lean();
  if (!poolEnabled(configuration.value) && !previous?.active) return null;
  const candidate = await inspectPoolCandidate(ref, session);
  if (poolEnabled(configuration.value) && candidate.eligible && (previous || configuration.value.pool?.admission_enabled))
    return writePoolCandidate(candidate, configuration, now, session, configuration.value.pool!.approval_ref);
  if (!previous?.active) return null;
  const episodes = previous.episodes.map((e) => ({ started_at: e.started_at, ended_at: e.ended_at ?? now, observation_id: e.observation_id }));
  const changed = await Model.updateOne({ _id: previous._id, revision: previous.revision }, { $set: { active: false, episodes, exit_reason: poolEnabled(configuration.value) ? candidate.reason : "pool_disabled" }, $inc: { revision: 1 } }, { session });
  if (changed.matchedCount !== 1) throw new OutreachError("REVISION_CONFLICT");
  await poolInvalidation(session, now);
  return { subject_id: String(previous.subject_id), lead: ref, outcome: "exited" };
}
