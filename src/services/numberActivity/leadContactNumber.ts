import mongoose, { type ClientSession } from "mongoose";
import { csiFlag } from "../../config/domain/salesIntelligence";
import { CONTACT_NUMBER_SUMMARY_VERSION, getContactNumberModel, type ContactNumberCreatedVia } from "../../models/ContactNumber";
import { csiWorkerActor, type CsiActor } from "../salesIntelligence/auth";
import { appendCsiAudit } from "../salesIntelligence/transactions";
import { configuredRingCentralAccountId } from "./accountIdentity";
import { loadDirectoryLookup, type DirectoryLookup } from "./directory";
import type { LeadModel, LeadRow } from "./leadLink";
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

/**
 * A Lead's phone paths (olr CW1): the four the All Numbers link reads (`leadLink.ts` `leadPhoneE164s`),
 * flattened. Ten-digit match forms as stored; any of them may be absent.
 */
export type LeadPhones = {
  /** The Lead's live phone (`normalized_phone_number`). */
  normalized_phone_number?: string | null;
  /** Call Leads only: the caller of the call that created the Lead (`ringcentral.original_caller`). */
  original_caller_phone?: string | null;
  /** The phone the Lead arrived with (`ingested_contact_snapshot.normalized_phone_number`). */
  ingested_phone?: string | null;
  /** The phone Granot last reported (`granot_contact_snapshot.normalized_phone_number`). */
  granot_phone?: string | null;
};

export type LeadNumberSource = LeadPhones & {
  _id: { toString(): string };
  timestamp?: Date | null;
  duplicate?: boolean | null;
  bad_lead?: string | null;
};

/** Audit event of a minted number (both models; `current.lead_model` names the Lead's model). */
export const LEAD_NUMBER_AUDIT_EVENT = "contact_number_created_from_lead";

/** The `created_via` a minted row carries. Served `source` stays `call` for a Call Lead (`resolveCreatedVia`). */
export function createdViaForLead(model: LeadModel): ContactNumberCreatedVia {
  return model === "FormLead" ? "form_lead" : "call_lead";
}

/** A stored Lead row's phone paths (a Lead read with `LEAD_LINK_PROJECTION`, or any projection of the same paths). */
export function leadPhonesOf(row: Pick<LeadRow, "normalized_phone_number" | "ingested_contact_snapshot" | "granot_contact_snapshot" | "ringcentral">): LeadPhones {
  return {
    normalized_phone_number: row.normalized_phone_number ?? null,
    original_caller_phone: row.ringcentral?.original_caller?.normalized_phone_number ?? null,
    ingested_phone: row.ingested_contact_snapshot?.normalized_phone_number ?? null,
    granot_phone: row.granot_contact_snapshot?.normalized_phone_number ?? null,
  };
}

/**
 * The E.164s a Lead's phones form, in mint order, deduplicated (olr CW1: the one phone rule shared by the
 * Lead's number mint, the `mint-lead-numbers` backfill, the `subjects-without-numbers` diagnostic and the
 * desk's C2c `no_contact_number` check). Pure. Order: the live phone; a Call Lead's original caller (a Form
 * Lead has no creating call); the intake snapshot; the Granot snapshot. As a set this is the link's own
 * `leadPhoneE164s`, so a phone the link would match is always a phone the mint can number.
 */
export function leadPhoneE164Candidates(model: LeadModel, phones: LeadPhones): string[] {
  const values = [phones.normalized_phone_number, model === "CallLead" ? phones.original_caller_phone : null, phones.ingested_phone, phones.granot_phone];
  return [...new Set(values.map((value) => toE164(value?.trim() ?? "")).filter((value): value is string => Boolean(value)))];
}

/** The first of `leadPhoneE164Candidates` (the phone a Lead's number is preferably minted from), or null when none forms an E.164. */
export function leadPhoneE164(model: LeadModel, phones: LeadPhones): string | null {
  return leadPhoneE164Candidates(model, phones)[0] ?? null;
}

/**
 * The mint's candidate E.164s, or why the Lead mints nothing. Pure. Duplicates and Bad Leads are never a
 * lead-link candidate, so they never mint a number; the original Lead does that for a duplicate's phone.
 * There is no move-date gate: a Contact Number is a phone endpoint, and Outreach decides work.
 */
export function leadNumberE164s(model: LeadModel, lead: Omit<LeadNumberSource, "_id" | "timestamp">):
  { e164s: string[] } | { skip: Exclude<LeadNumberSkip, "disabled" | "company_number"> } {
  if (lead.duplicate === true) return { skip: "duplicate" };
  if (lead.bad_lead) return { skip: "bad_lead" };
  const e164s = leadPhoneE164Candidates(model, lead);
  return e164s.length ? { e164s } : { skip: "no_phone" };
}

export type LeadNumberTarget = { action: "reuse" | "create"; e164: string } | { action: "company_number" };

/**
 * Which candidate gets the Lead's Contact Number (olr CW1). Pure; the mint, the backfill and the diagnostic
 * all decide with it. Candidates are walked in mint order: the first that already has a row (purged or
 * not) is reused untouched; one of our own DIDs is passed over; the first other one is created. So the
 * live phone is numbered whenever it is usable, and a snapshot phone only when nothing before it is.
 * Every candidate a DID with no row: `company_number`.
 */
export function leadNumberTarget(candidates: readonly string[], hasRow: (e164: string) => boolean,
  isCompanyNumber: (e164: string) => boolean): LeadNumberTarget {
  for (const e164 of candidates) {
    if (hasRow(e164)) return { action: "reuse", e164 };
    if (!isCompanyNumber(e164)) return { action: "create", e164 };
  }
  return { action: "company_number" };
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
 * the links of the Lead's numbers; or the backfill script). The Lead's phones are walked in mint order
 * (`leadNumberTarget`): an existing row with the E.164 (purged or not) is reused untouched, a customer
 * phone that is one of our own DIDs is passed over, the first other phone is created. A new row has
 * capture's shape with zero calls, `created_via` `form_lead` / `call_lead` (set on create only) and the
 * v2 summary stamp; the first real call starts the counts. A race on one new phone hits the unique
 * E.164 index and the losing job retries.
 */
export async function ensureLeadContactNumber(model: LeadModel, lead: LeadNumberSource, session: ClientSession | null, requestId: string,
  now = new Date(), options: LeadNumberOptions = {}): Promise<LeadNumberResult> {
  if (!leadNumberMintingEnabled(model, options.force)) return { action: "skipped", reason: "disabled" };
  const plan = leadNumberE164s(model, lead);
  if ("skip" in plan) return { action: "skipped", reason: plan.skip };
  if (!options.store && !session) throw new Error("ensureLeadContactNumber needs a session");
  const store = options.store ?? mongoLeadNumberStore(session!, requestId, now, options);
  // olr CW1: `leadNumberTarget` over the candidates' rows, read in mint order up to the first numbered one
  // (usually one phone, one indexed read). The directory is loaded only when the first candidate has no row.
  const rows = new Map<string, string>();
  for (const e164 of plan.e164s) {
    const existing = await store.findByE164(e164);
    if (existing) {
      rows.set(e164, String(existing._id));
      break;
    }
  }
  const directory = rows.has(plan.e164s[0]!) ? null : await store.directory();
  const target = leadNumberTarget(plan.e164s, (e164) => rows.has(e164), (e164) => Boolean(directory?.companyNumberByE164(e164)));
  if (target.action === "reuse") return { action: "reused", number_id: rows.get(target.e164)!, e164: target.e164 };
  // A customer who typed (or called from) one of our own DIDs must not become an external Contact Number.
  if (target.action === "company_number") return { action: "skipped", reason: "company_number" };
  const observed = lead.timestamp ?? now;
  const created = await store.create({
    revision: 1, e164: target.e164, national_ten: toNationalTenDigit(target.e164), digits_reversed: reverseDigits(target.e164),
    country: "US", provider_names: [], search_terms: [], first_observed_at: observed, last_activity_at: observed,
    // G7: set on create only; a reused row above keeps whatever it has (absent = `call`).
    created_via: createdViaForLead(model),
    // Born under All Numbers v2: its summary is the zero default and the Lead job computes its link next.
    summary_version: CONTACT_NUMBER_SUMMARY_VERSION,
  });
  const numberId = String(created._id);
  await store.audit({ number_id: numberId, current: { lead_model: model, lead_id: String(lead._id), first_observed_at: observed.toISOString() } });
  return { action: "created", number_id: numberId, e164: target.e164 };
}
