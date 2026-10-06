import mongoose, { type ClientSession } from "mongoose";
import { csiFlag } from "../../config/domain/salesIntelligence";
import { CONTACT_NUMBER_SUMMARY_VERSION, getContactNumberModel, type ContactNumberCreatedVia } from "../../models/ContactNumber";
import { csiWorkerActor, type CsiActor } from "../salesIntelligence/auth";
import { appendCsiAudit } from "../salesIntelligence/transactions";
import { configuredRingCentralAccountId } from "./accountIdentity";
import { loadDirectoryLookup, type DirectoryLookup } from "./directory";
import type { LeadModel } from "./leadLink";
import { reverseDigits, toE164, toNationalTenDigit } from "./phone";

/**
 * Lead → Contact Number (outreach lifecycle repair C2b; generalizes the Form Lead minting of G7).
 *
 * A Contact Number used to exist only when capture saw a settled call or a Form Lead minted it. A Call
 * Lead whose phone had not called or been called since capture began (2026-09-20) therefore had no
 * number, no lead link, no desk `contact_number_ids`, and its SMS could never associate. Every Lead's
 * own `lead_link` job now mints its number; `ops/numbers-v2/mint-lead-numbers.ts` backfills the Leads
 * that already exist. The All Numbers link rules (CONTRACT §3) are unchanged: the minted row is an
 * ordinary number whose link the job recomputes next from the number's side.
 */
export type LeadNumberSkip = "disabled" | "duplicate" | "bad_lead" | "no_phone" | "company_number";
export type LeadNumberResult =
  | { action: "skipped"; reason: LeadNumberSkip }
  | { action: "reused" | "created"; number_id: string; e164: string };
export type LeadNumberSource = {
  _id: { toString(): string };
  timestamp?: Date | null;
  duplicate?: boolean | null;
  bad_lead?: string | null;
  /** The Lead's live phone (ten-digit match form). */
  normalized_phone_number?: string | null;
  /** Call Leads only: the caller of the call that created the Lead, used when the live phone is absent. */
  original_caller_phone?: string | null;
};

/** Audit event of a minted number (both models; `current.lead_model` names the Lead's model). */
export const LEAD_NUMBER_AUDIT_EVENT = "contact_number_created_from_lead";

/** The `created_via` a minted row carries. Served `source` stays `call` for a Call Lead (`resolveCreatedVia`). */
export function createdViaForLead(model: LeadModel): ContactNumberCreatedVia {
  return model === "FormLead" ? "form_lead" : "call_lead";
}

/**
 * The E.164 a Lead's phone becomes as a Contact Number, or why it does not. Pure. Duplicates and Bad
 * Leads are never a lead-link candidate, so they never mint a number; the original Lead does that for a
 * duplicate's phone. A Form Lead uses its live phone; a Call Lead its live phone, else the caller of its
 * creating call. There is no move-date gate: a Contact Number is a phone endpoint, and Outreach decides work.
 */
export function leadNumberE164(model: LeadModel, lead: Omit<LeadNumberSource, "_id" | "timestamp">):
  { e164: string } | { skip: Exclude<LeadNumberSkip, "disabled" | "company_number"> } {
  if (lead.duplicate === true) return { skip: "duplicate" };
  if (lead.bad_lead) return { skip: "bad_lead" };
  const live = lead.normalized_phone_number?.trim() || null;
  const phone = live ?? (model === "CallLead" ? lead.original_caller_phone?.trim() || null : null);
  const e164 = toE164(phone ?? "");
  return e164 ? { e164 } : { skip: "no_phone" };
}

/** Minting is behind `FORM_LEAD_NUMBERS` for Form Leads only; Call Leads always mint (C2b: data completeness). */
export function leadNumberMintingEnabled(model: LeadModel, force = false): boolean {
  return force || model === "CallLead" || csiFlag("FORM_LEAD_NUMBERS");
}

/** The two reads and two writes the mint needs; the default is Mongo in the caller's session (tests pass a memory store). */
export type LeadNumberStore = {
  findByE164(e164: string): Promise<{ _id: unknown } | null>;
  create(row: Record<string, unknown>): Promise<{ _id: unknown }>;
  audit(input: { number_id: string; current: Record<string, string> }): Promise<void>;
  directory(): Promise<DirectoryLookup | null>;
};

export type LeadNumberOptions = {
  /** Mint a Form Lead even when `FORM_LEAD_NUMBERS` is off (the backfill scripts). */
  force?: boolean;
  /** A preloaded directory (a script loads it once); default: the configured account's newest snapshot. */
  directory?: DirectoryLookup | null;
  /** Audit actor; default the `lead_link` job's worker actor for `requestId`. */
  actor?: CsiActor;
  store?: LeadNumberStore;
};

function mongoLeadNumberStore(session: ClientSession, requestId: string, now: Date, options: LeadNumberOptions): LeadNumberStore {
  const ContactNumber = getContactNumberModel();
  return {
    findByE164: async (e164) => ContactNumber.findOne({ e164 }, { _id: 1 }).session(session).lean(),
    create: async (row) => (await ContactNumber.create([row], { session }))[0]!,
    audit: async ({ number_id, current }) => {
      await appendCsiAudit({ session, now, command_id: new mongoose.Types.ObjectId(), actor: options.actor ?? csiWorkerActor(requestId) }, {
        kind: "number", target_id: number_id, subject_key: `number:${number_id}`, revision: 1,
        event_kind: LEAD_NUMBER_AUDIT_EVENT, prior: { state: "absent" }, current,
      });
    },
    directory: async () => {
      if (options.directory !== undefined) return options.directory;
      const account = configuredRingCentralAccountId();
      return account ? loadDirectoryLookup(account) : null;
    },
  };
}

/**
 * Lead → Contact Number, in the caller's transaction (the Lead's `lead_link` job, before it recomputes
 * the links of the Lead's numbers; or the backfill script). An existing row with that E.164 (purged or
 * not) is reused untouched. A customer phone that is one of our own DIDs is skipped. A new row has
 * capture's shape with zero calls, `created_via` `form_lead` / `call_lead` (set on create only) and the
 * v2 summary stamp; the first real call starts the counts. A race on one new phone hits the unique
 * E.164 index and the losing job retries.
 */
export async function ensureLeadContactNumber(model: LeadModel, lead: LeadNumberSource, session: ClientSession | null, requestId: string,
  now = new Date(), options: LeadNumberOptions = {}): Promise<LeadNumberResult> {
  if (!leadNumberMintingEnabled(model, options.force)) return { action: "skipped", reason: "disabled" };
  const plan = leadNumberE164(model, lead);
  if ("skip" in plan) return { action: "skipped", reason: plan.skip };
  if (!options.store && !session) throw new Error("ensureLeadContactNumber needs a session");
  const store = options.store ?? mongoLeadNumberStore(session!, requestId, now, options);
  const existing = await store.findByE164(plan.e164);
  if (existing) return { action: "reused", number_id: String(existing._id), e164: plan.e164 };
  // A customer who typed (or called from) one of our own DIDs must not become an external Contact Number.
  if ((await store.directory())?.companyNumberByE164(plan.e164)) return { action: "skipped", reason: "company_number" };
  const observed = lead.timestamp ?? now;
  const created = await store.create({
    revision: 1, e164: plan.e164, national_ten: toNationalTenDigit(plan.e164), digits_reversed: reverseDigits(plan.e164),
    country: "US", provider_names: [], search_terms: [], first_observed_at: observed, last_activity_at: observed,
    // G7: set on create only; a reused row above keeps whatever it has (absent = `call`).
    created_via: createdViaForLead(model),
    // Born under All Numbers v2: its summary is the zero default and the Lead job computes its link next.
    summary_version: CONTACT_NUMBER_SUMMARY_VERSION,
  });
  const numberId = String(created._id);
  await store.audit({ number_id: numberId, current: { lead_model: model, lead_id: String(lead._id), first_observed_at: observed.toISOString() } });
  return { action: "created", number_id: numberId, e164: plan.e164 };
}
