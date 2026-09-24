import mongoose, { type ClientSession } from "mongoose";
import { csiFlag } from "../../../config/domain/salesIntelligence";
import { getContactNumberModel } from "../../../models/ContactNumber";
import { reverseDigits, toE164, toNationalTenDigit } from "../../numberActivity/phone";
import { configuredRingCentralAccountId } from "../../numberActivity/accountIdentity";
import { loadDirectoryLookup, type DirectoryLookup } from "../../numberActivity/directory";
import { csiWorkerActor } from "../auth";
import { appendCsiAudit } from "../transactions";
import type { LeadSource } from "./sources";

export type FormLeadNumberSkip = "disabled" | "duplicate" | "bad_lead" | "no_phone" | "company_number";
export type FormLeadNumberResult =
  | { action: "skipped"; reason: FormLeadNumberSkip }
  | { action: "reused" | "created"; number_id: string; e164: string };

/**
 * The E.164 a Form Lead's submitted phone becomes as a Contact Number, or why it
 * does not. Pure. Duplicates and Bad Leads are never a sole-match target, so they
 * never mint a number; the original Lead does that for a duplicate's phone. There
 * is no move-date gate: a Contact Number is a phone endpoint, and Outreach decides work.
 */
export function formLeadNumberE164(lead: Pick<LeadSource, "duplicate" | "bad_lead" | "normalized_phone_number">):
  { e164: string } | { skip: Exclude<FormLeadNumberSkip, "disabled"> } {
  if (lead.duplicate === true) return { skip: "duplicate" };
  if (lead.bad_lead) return { skip: "bad_lead" };
  const e164 = toE164(lead.normalized_phone_number ?? "");
  return e164 ? { e164 } : { skip: "no_phone" };
}

/**
 * Form Lead → Contact Number, in the caller's transaction, before
 * `persistLeadAttachments` looks the phone up. Behind FORM_LEAD_NUMBERS.
 * An existing row with that E.164 (any kind, classification, restriction or
 * purge) is reused untouched. A new row has capture's shape with zero rollups
 * and `created_via: "form_lead"` (G7):
 * the form is not a call, so the first real call starts the counts. A race on
 * one new phone hits the unique E.164 index and the losing job retries.
 */
export async function ensureFormLeadContactNumber(lead: LeadSource, session: ClientSession, requestId: string,
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
    country: "US", kind: "external", classification: "unknown", contact_eligibility: { state: "allowed" },
    provider_names: [], search_terms: [], first_observed_at: observed, last_activity_at: observed,
    // G7: set on create only; a reused row above keeps whatever it has (absent = `call`).
    created_via: "form_lead",
  }], { session });
  const numberId = String(created!._id);
  await appendCsiAudit({ session, now, command_id: new mongoose.Types.ObjectId(), actor: csiWorkerActor(requestId) }, {
    kind: "number", target_id: numberId, subject_key: `number:${numberId}`, revision: 1,
    event_kind: "contact_number_created_from_form_lead", prior: { state: "absent" },
    current: { lead_model: "FormLead", lead_id: String(lead._id), first_observed_at: observed.toISOString() },
  });
  return { action: "created", number_id: numberId, e164: plan.e164 };
}
