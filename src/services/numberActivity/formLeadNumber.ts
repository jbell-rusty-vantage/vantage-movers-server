import mongoose, { type ClientSession } from "mongoose";
import { csiFlag } from "../../config/domain/salesIntelligence";
import { CONTACT_NUMBER_SUMMARY_VERSION, getContactNumberModel } from "../../models/ContactNumber";
import { csiWorkerActor } from "../salesIntelligence/auth";
import { appendCsiAudit } from "../salesIntelligence/transactions";
import { configuredRingCentralAccountId } from "./accountIdentity";
import { loadDirectoryLookup, type DirectoryLookup } from "./directory";
import { reverseDigits, toE164, toNationalTenDigit } from "./phone";

export type FormLeadNumberSkip = "disabled" | "duplicate" | "bad_lead" | "no_phone" | "company_number";
export type FormLeadNumberResult =
  | { action: "skipped"; reason: FormLeadNumberSkip }
  | { action: "reused" | "created"; number_id: string; e164: string };
export type FormLeadNumberSource = {
  _id: { toString(): string };
  timestamp?: Date | null;
  duplicate?: boolean | null;
  bad_lead?: string | null;
  normalized_phone_number?: string | null;
};

/**
 * The E.164 a Form Lead's submitted phone becomes as a Contact Number, or why it
 * does not. Pure. Duplicates and Bad Leads are never a lead-link candidate, so they
 * never mint a number; the original Lead does that for a duplicate's phone. There
 * is no move-date gate: a Contact Number is a phone endpoint, and Outreach decides work.
 */
export function formLeadNumberE164(lead: Pick<FormLeadNumberSource, "duplicate" | "bad_lead" | "normalized_phone_number">):
  { e164: string } | { skip: Exclude<FormLeadNumberSkip, "disabled"> } {
  if (lead.duplicate === true) return { skip: "duplicate" };
  if (lead.bad_lead) return { skip: "bad_lead" };
  const e164 = toE164(lead.normalized_phone_number ?? "");
  return e164 ? { e164 } : { skip: "no_phone" };
}

/**
 * Form Lead → Contact Number, in the Lead's `lead_link` job transaction, before the job recomputes
 * the links of the Lead's numbers. Behind FORM_LEAD_NUMBERS. An existing row with that E.164 (purged
 * or not) is reused untouched. A new row has capture's shape with zero calls and
 * `created_via: "form_lead"` (G7): the form is not a call, so the first real call starts the counts.
 * A race on one new phone hits the unique E.164 index and the losing job retries.
 */
export async function ensureFormLeadContactNumber(lead: FormLeadNumberSource, session: ClientSession, requestId: string,
  now = new Date(), options: { force?: boolean; directory?: DirectoryLookup } = {}): Promise<FormLeadNumberResult> {
  if (!options.force && !csiFlag("FORM_LEAD_NUMBERS")) return { action: "skipped", reason: "disabled" };
  const plan = formLeadNumberE164(lead);
  if ("skip" in plan) return { action: "skipped", reason: plan.skip };
  const ContactNumber = getContactNumberModel();
  const existing = await ContactNumber.findOne({ e164: plan.e164 }, { _id: 1 }).session(session).lean();
  if (existing) return { action: "reused", number_id: String(existing._id), e164: plan.e164 };
  // A customer who typed one of our own DIDs must not become an external Contact Number.
  const account = configuredRingCentralAccountId();
  const directory = options.directory ?? (account ? await loadDirectoryLookup(account) : null);
  if (directory?.companyNumberByE164(plan.e164)) return { action: "skipped", reason: "company_number" };
  const observed = lead.timestamp ?? now;
  const [created] = await ContactNumber.create([{
    revision: 1, e164: plan.e164, national_ten: toNationalTenDigit(plan.e164), digits_reversed: reverseDigits(plan.e164),
    country: "US", provider_names: [], search_terms: [], first_observed_at: observed, last_activity_at: observed,
    // G7: set on create only; a reused row above keeps whatever it has (absent = `call`).
    created_via: "form_lead",
    // Born under All Numbers v2: its summary is the zero default and the Lead job computes its link next.
    summary_version: CONTACT_NUMBER_SUMMARY_VERSION,
  }], { session });
  const numberId = String(created!._id);
  await appendCsiAudit({ session, now, command_id: new mongoose.Types.ObjectId(), actor: csiWorkerActor(requestId) }, {
    kind: "number", target_id: numberId, subject_key: `number:${numberId}`, revision: 1,
    event_kind: "contact_number_created_from_form_lead", prior: { state: "absent" },
    current: { lead_model: "FormLead", lead_id: String(lead._id), first_observed_at: observed.toISOString() },
  });
  return { action: "created", number_id: numberId, e164: plan.e164 };
}
