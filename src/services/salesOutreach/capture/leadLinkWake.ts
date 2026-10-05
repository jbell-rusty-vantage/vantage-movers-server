import mongoose, { type ClientSession } from "mongoose";
import { getCallInteractionModel } from "../../../models/CallInteraction";
import { getContactNumberModel } from "../../../models/ContactNumber";
import { getSalesOutreachSubjectModel } from "../../../models/salesOutreach";
import { getRingCentralRepSmsEvidenceModel } from "../../../models/salesOutreach/repSmsEvidence";
import { enqueueCsiJob } from "../../salesIntelligence/jobs";
import { deskWantsContactEvidence, enqueueOutreachContactChangeJobs, type ContactChangeSource } from "./contactChangeWake";

/**
 * Desk wake for an All Numbers lead-link change (all-numbers CONTRACT §3 "Outreach Desk", §4.3).
 *
 * The desk reads the link in two places: a call or SMS credits the number's current `lead`
 * (`contacts/mongoStore.ts`), and a subject's `contact_number_ids` are the numbers whose `lead` or
 * `other_leads` hold its Lead (`subjects/store.ts`). When a recompute changes a link, in the same
 * transaction:
 * - every desk subject whose Lead entered or left the number gets an `outreach_lead_change` job, so
 *   its `contact_number_ids` (restrictions, SMS association) are refreshed;
 * - when the number's `lead` changed, the number's newest calls and SMS get an
 *   `outreach_contact_change` job each, so their credit moves to the new Lead.
 * Keys carry the number and its new revision, so a replayed recompute enqueues nothing new. Nothing
 * is enqueued unless the persisted desk configuration wants contact evidence (fail closed).
 */
export type LeadLinkChangeLike = {
  number_id: string;
  changed: boolean;
  revision: number;
  before: { lead: { model: string; id: string } | null; leads: Array<{ model: string; id: string }> };
  after: { lead: { model: string; id: string } | null; leads: Array<{ model: string; id: string }> };
};

/** Bound on the calls and SMS one link change re-derives (newest first). */
export const LEAD_LINK_WAKE_SOURCES = 200;
const keyOf = (lead: { model: string; id: string } | null) => (lead ? `${lead.model}:${lead.id}` : "");

/** The Leads whose membership in the number's link changed (entered or left). */
export function movedLeads(change: Pick<LeadLinkChangeLike, "before" | "after">): Array<{ model: string; id: string }> {
  const before = new Set(change.before.leads.map(keyOf));
  const after = new Set(change.after.leads.map(keyOf));
  const out = new Map<string, { model: string; id: string }>();
  for (const lead of [...change.before.leads, ...change.after.leads]) if (before.has(keyOf(lead)) !== after.has(keyOf(lead))) out.set(keyOf(lead), lead);
  return [...out.values()];
}

export async function enqueueDeskWakeForLeadLink(
  change: LeadLinkChangeLike,
  session: ClientSession,
  now: Date,
  deps: { wanted?: (session?: ClientSession) => Promise<boolean> } = {},
): Promise<string[]> {
  if (!change.changed) return [];
  if (!(await (deps.wanted ?? deskWantsContactEvidence)(session))) return [];
  const jobIds: string[] = [];
  const moved = movedLeads(change).filter((lead): lead is { model: "FormLead" | "CallLead"; id: string } => lead.model === "FormLead" || lead.model === "CallLead");
  if (moved.length) {
    const subjects = (await getSalesOutreachSubjectModel()
      .find({ $or: moved.map((lead) => ({ lead_model: lead.model, lead_id: new mongoose.Types.ObjectId(lead.id) })) }, { lead_model: 1, lead_id: 1 })
      .session(session)
      .lean()) as unknown as Array<{ lead_model: string; lead_id: unknown }>;
    for (const subject of subjects) {
      const id = String(subject.lead_id);
      const row = await enqueueCsiJob({
        stage: "outreach_lead_change",
        subject_key: `outreach-lead:${subject.lead_model}:${id}`,
        dedupe_key: `sod:lead-change:${subject.lead_model}:${id}:link:${change.number_id}:r${change.revision}`,
        input_revision: change.revision,
        input_refs: [id],
      }, session, now);
      jobIds.push(String(row._id));
    }
  }
  if (keyOf(change.before.lead) !== keyOf(change.after.lead)) {
    const numberId = new mongoose.Types.ObjectId(change.number_id);
    const source_revision = `link${change.revision}`;
    const calls = await getCallInteractionModel()
      .find({ contact_number_id: numberId, merged_into_id: null }, { _id: 1 })
      .sort({ started_at: -1, _id: -1 })
      .limit(LEAD_LINK_WAKE_SOURCES)
      .session(session)
      .lean();
    const number = await getContactNumberModel().findById(numberId, { e164: 1 }).session(session).lean();
    const sms = number?.e164
      ? await getRingCentralRepSmsEvidenceModel()
        .find({ counterpart_numbers: number.e164 }, { _id: 1 })
        .sort({ provider_created_at: -1 })
        .limit(LEAD_LINK_WAKE_SOURCES)
        .session(session)
        .lean()
      : [];
    const sources: ContactChangeSource[] = [
      ...calls.map((row) => ({ source_kind: "call" as const, source_id: String(row._id), source_revision })),
      ...sms.map((row) => ({ source_kind: "sms" as const, source_id: String(row._id), source_revision })),
    ];
    const created = await enqueueOutreachContactChangeJobs(sources, session, now, { wanted: async () => true });
    jobIds.push(...created.map((job) => job.job_id));
  }
  return jobIds;
}
