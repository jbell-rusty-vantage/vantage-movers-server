/**
 * Granot Form sibling update (Owner 2026-10-28; `job-number-pending-investigation/SPECIFICATION.md` S2).
 *
 * A customer who submits a form and also makes a qualified RingCentral call is one customer with two
 * Leads (two origins, two Sheets tabs, two CPLs). Granot files the job under the Form source, so the
 * Form ladder resolves the Form Lead and the Call Lead would stay "Job number pending" forever. After a
 * Granot observation lands on the Form Lead, this mirrors the Lead-specific Granot fields onto the
 * qualified Call Lead of the same customer:
 * - `job_no` / `normalized_job_no` (only into an empty field: a different job is never overwritten);
 * - `granot_priority`;
 * - the receiver (`receiver_agent` + name snapshot + source), only over an empty or automatic receiver
 *   (`ringcentral_answered`, `ringcentral_rep_call`, `granot_username_match`), never over `manual` or a
 *   source-less receiver;
 * - `granot_form_sibling` (the pair marker the desk and the job counts read).
 *
 * The Call Lead is found by an equivalent job, else by phone (current/ingested/Granot phone of the Form
 * Lead against the Call Lead's current/ingested phone) within the same Lead Source Company and
 * `FORM_SIBLING_WINDOW_DAYS` of each other. Exactly one eligible (non-duplicate, not `created_on_unmatched`)
 * Call Lead, or nothing. It never creates a Lead, never writes the Form Lead, a Record Link, a Decision
 * or `last_accepted_granot_observation` (the Call ladder keeps its own temporal winner). The Calls row
 * is updated in place only when the Call Lead already has one (a sheet job appends a missing row).
 */
import { createHash, randomUUID } from "node:crypto";
import mongoose, { type ClientSession } from "mongoose";
import { getCallLeadModel } from "../../models/CallLead";
import { getFormLeadModel } from "../../models/FormLead";
import { equivalentNormalizedJobFilter, jobNumbersEquivalent } from "../bookings/bookingIdentity";
import { persistEntityChangeMutations } from "../domainCommands/entityChange";
import { executeCanonicalCommandWithPostCommit } from "../domainCommands/idempotency";
import type { CanonicalCommandContext } from "../domainCommands/types";
import { finalizeSheetSync } from "../sheetSync/sheetSyncCoordinator";
import { enqueueSheetSyncJob } from "../sheetSync/sheetSyncOutbox.service";

export const FORM_SIBLING_WINDOW_DAYS = 45;
const DAY_MS = 86_400_000;
/** Automatic receivers a Granot-named rep replaces (`leadDesiredState.ts` E5/E6); `manual` and source-less are protected. */
const REPLACEABLE_RECEIVER_SOURCES = new Set(["ringcentral_answered", "ringcentral_rep_call", "granot_username_match"]);

type Id = mongoose.Types.ObjectId | string;
type PhoneSnapshot = { normalized_phone_number?: string | null } | null | undefined;

export type SiblingFormLead = {
  _id: Id;
  duplicate?: boolean | null;
  bad_lead?: string | null;
  job_no?: string | null;
  normalized_job_no?: string | null;
  granot_priority?: string | null;
  receiver_agent?: Id | null;
  receiver_agent_name_snapshot?: string | null;
  receiver_agent_source?: string | null;
  receiver_agent_source_value?: string | null;
  lead_source_company?: Id | null;
  normalized_phone_number?: string | null;
  ingested_contact_snapshot?: PhoneSnapshot;
  granot_contact_snapshot?: PhoneSnapshot;
  createdAt?: Date | null;
};

export type SiblingCallLead = {
  _id: Id;
  duplicate?: boolean | null;
  created_on_unmatched?: boolean | null;
  no_sync?: boolean | null;
  job_no?: string | null;
  normalized_job_no?: string | null;
  granot_priority?: string | null;
  receiver_agent?: Id | null;
  receiver_agent_source?: string | null;
  lead_source_company?: Id | null;
  createdAt?: Date | null;
  domain_revision?: number | null;
  granot_form_sibling?: { form_lead_id?: Id | null; normalized_job_no?: string | null; basis?: string | null } | null;
  sheet_sync?: Array<{ target?: string | null; status?: string | null; row_number?: number | null }> | null;
};

export type SiblingSkipReason =
  | "form_ineligible"
  | "no_call_sibling"
  | "multiple_call_siblings"
  | "sibling_of_other_form"
  | "already_current";

export type SiblingPlan =
  | Readonly<{ kind: "skip"; reason: SiblingSkipReason }>
  | Readonly<{ kind: "update"; call_id: string; basis: "job_no" | "phone_source_company"; set: Record<string, unknown> }>;

export const SIBLING_FORM_PROJECTION = {
  duplicate: 1, bad_lead: 1, job_no: 1, normalized_job_no: 1, granot_priority: 1,
  receiver_agent: 1, receiver_agent_name_snapshot: 1, receiver_agent_source: 1, receiver_agent_source_value: 1,
  lead_source_company: 1, normalized_phone_number: 1,
  "ingested_contact_snapshot.normalized_phone_number": 1, "granot_contact_snapshot.normalized_phone_number": 1, createdAt: 1,
} as const;

export const SIBLING_CALL_PROJECTION = {
  duplicate: 1, created_on_unmatched: 1, no_sync: 1, job_no: 1, normalized_job_no: 1, granot_priority: 1,
  receiver_agent: 1, receiver_agent_source: 1, lead_source_company: 1, createdAt: 1, domain_revision: 1,
  granot_form_sibling: 1, "sheet_sync.target": 1, "sheet_sync.status": 1, "sheet_sync.row_number": 1,
} as const;

/** The Form Lead's phones that may identify its Call sibling (current, ingested, Granot). */
export function formSiblingPhones(form: SiblingFormLead): string[] {
  return [...new Set([form.normalized_phone_number, form.ingested_contact_snapshot?.normalized_phone_number,
    form.granot_contact_snapshot?.normalized_phone_number].filter((phone): phone is string => Boolean(phone)))];
}

const same = (a: unknown, b: unknown) => a !== null && a !== undefined && b !== null && b !== undefined && String(a) === String(b);

/**
 * Which Call Lead mirrors the Form Lead's job and what to write (pure). `jobMatches` are Call Leads whose
 * job is equivalent to the Form's; `phoneMatches` are Call Leads sharing one of its phones.
 */
export function planFormSiblingUpdate(
  form: SiblingFormLead,
  jobMatches: readonly SiblingCallLead[],
  phoneMatches: readonly SiblingCallLead[],
  now: Date,
): SiblingPlan {
  const job = form.normalized_job_no;
  if (form.duplicate === true || form.bad_lead || !job || !form.job_no) return { kind: "skip", reason: "form_ineligible" };
  const eligible = (call: SiblingCallLead) => call.duplicate !== true && call.created_on_unmatched !== true;
  const byJob = jobMatches.filter((call) => eligible(call) && jobNumbersEquivalent(call.normalized_job_no, job));
  let target: SiblingCallLead;
  let basis: "job_no" | "phone_source_company";
  if (byJob.length > 1) return { kind: "skip", reason: "multiple_call_siblings" };
  if (byJob.length === 1) {
    target = byJob[0]!;
    basis = "job_no";
  } else {
    const formAt = form.createdAt ? +form.createdAt : null;
    const byPhone = phoneMatches.filter((call) => eligible(call) && !call.normalized_job_no && same(call.lead_source_company, form.lead_source_company)
      && formAt !== null && call.createdAt instanceof Date && Math.abs(+call.createdAt - formAt) <= FORM_SIBLING_WINDOW_DAYS * DAY_MS);
    if (byPhone.length === 0) return { kind: "skip", reason: "no_call_sibling" };
    if (byPhone.length > 1) return { kind: "skip", reason: "multiple_call_siblings" };
    target = byPhone[0]!;
    basis = "phone_source_company";
  }
  const linked = target.granot_form_sibling;
  if (linked?.form_lead_id && !same(linked.form_lead_id, form._id)) return { kind: "skip", reason: "sibling_of_other_form" };

  const set: Record<string, unknown> = {};
  if (!target.normalized_job_no) {
    set.job_no = form.job_no;
    set.normalized_job_no = job;
  }
  if (form.granot_priority && form.granot_priority !== target.granot_priority) set.granot_priority = form.granot_priority;
  const receiverOpen = !target.receiver_agent || REPLACEABLE_RECEIVER_SOURCES.has(target.receiver_agent_source ?? "");
  if (form.receiver_agent && form.receiver_agent_name_snapshot && receiverOpen && !same(form.receiver_agent, target.receiver_agent)) {
    set.receiver_agent = new mongoose.Types.ObjectId(String(form.receiver_agent));
    set.receiver_agent_name_snapshot = form.receiver_agent_name_snapshot;
    set.receiver_agent_source = form.receiver_agent_source ?? "granot_username_match";
    if (form.receiver_agent_source_value) set.receiver_agent_source_value = form.receiver_agent_source_value;
    set.receiver_agent_set_at = now;
  }
  if (!linked?.form_lead_id || linked.normalized_job_no !== job) {
    set.granot_form_sibling = { form_lead_id: new mongoose.Types.ObjectId(String(form._id)), normalized_job_no: job, basis, linked_at: now };
  }
  if (!Object.keys(set).length) return { kind: "skip", reason: "already_current" };
  return { kind: "update", call_id: String(target._id), basis, set };
}

/** Loads the Form Lead and its candidate Call siblings (indexed: Call `normalized_job_no`, `normalized_phone_number`). */
export async function loadFormSiblingCandidates(formLeadId: string, session?: ClientSession) {
  const form = await getFormLeadModel().findById(formLeadId, SIBLING_FORM_PROJECTION).session(session ?? null).lean<SiblingFormLead>();
  if (!form?.normalized_job_no) return { form, jobMatches: [], phoneMatches: [] };
  const phones = formSiblingPhones(form);
  const calls = getCallLeadModel();
  // Sequential: inside the command these reads share one transaction session.
  const jobMatches = await calls.find(equivalentNormalizedJobFilter(form.normalized_job_no), SIBLING_CALL_PROJECTION)
    .limit(10).session(session ?? null).lean<SiblingCallLead[]>();
  const phoneMatches = phones.length && form.lead_source_company
    ? await calls.find({ lead_source_company: form.lead_source_company, $or: [
      { normalized_phone_number: { $in: phones } }, { "ingested_contact_snapshot.normalized_phone_number": { $in: phones } },
    ] }, SIBLING_CALL_PROJECTION).limit(10).session(session ?? null).lean<SiblingCallLead[]>()
    : [];
  return { form, jobMatches, phoneMatches };
}

/**
 * True when the Call Lead's Calls row is known to exist (a synced Master Calls entry with a row number).
 * A sheet job for a Call Lead without one would append the row, so only this case is updated in place.
 */
export function hasSyncedCallsRow(call: SiblingCallLead): boolean {
  return call.no_sync !== true && (call.sheet_sync ?? []).some((entry) => entry.target === "master_calls" && entry.status === "synced" && typeof entry.row_number === "number");
}

export type SiblingResult = Readonly<{ outcome: "updated" | SiblingSkipReason; call_id: string | null; basis: string | null; paths: string[]; sheet: boolean }>;

/**
 * Applies the Form sibling update for one Form Lead in its own audited transaction (re-planned inside it;
 * the Call Lead write is a compare-and-swap on `domain_revision`). Idempotent per Form Lead, Call Lead and
 * written values. `run_id` names the caller (`granot-processor`, a backfill run). Returns what it did.
 */
export async function mirrorFormLeadToCallSibling(formLeadId: string, input: Readonly<{ run_id: string; observation_id?: string | null }>): Promise<SiblingResult> {
  const preview = await loadFormSiblingCandidates(formLeadId);
  if (!preview.form) return { outcome: "form_ineligible", call_id: null, basis: null, paths: [], sheet: false };
  const planned = planFormSiblingUpdate(preview.form, preview.jobMatches, preview.phoneMatches, new Date(0));
  if (planned.kind === "skip") return { outcome: planned.reason, call_id: null, basis: null, paths: [], sheet: false };

  const valueKey = JSON.stringify(Object.entries(planned.set).filter(([path]) => path !== "receiver_agent_set_at" && path !== "granot_form_sibling").sort());
  // The Call Lead's revision is part of the identity: the same values written again after another writer
  // changed the Call Lead are a new command, never a replay of the first one.
  const callRevision = Number([...preview.jobMatches, ...preview.phoneMatches].find((lead) => String(lead._id) === planned.call_id)?.domain_revision ?? 0);
  const key = `granot-form-sibling:${formLeadId}:${planned.call_id}:r${callRevision}:${createHash("sha256").update(valueKey).digest("hex").slice(0, 32)}`;
  const actor = { actor_type: "system" as const, actor_id: "granot-form-sibling", actor_label: "Granot Form sibling update",
    actor_role: "system" as const, origin: "granot_lifecycle" as const, request_id: randomUUID() };
  const context: CanonicalCommandContext = { command_id: randomUUID(), idempotency_key: key,
    payload_checksum: createHash("sha256").update(`${key}:${valueKey}`).digest("hex"), actor, initiator: actor,
    provenance: { origin: "granot_lifecycle", run_id: input.run_id, source_receipt_id: null, source_connection_key: null,
      ...(input.observation_id ? { observation_id: input.observation_id } : {}) } };
  type Sheet = { resource: "source_lead"; operation: "call_lead.update"; leadModel: "CallLead"; leadId: string };
  let result: SiblingResult = { outcome: "already_current", call_id: planned.call_id, basis: planned.basis, paths: [], sheet: false };
  await executeCanonicalCommandWithPostCommit<Sheet | null>({ command_name: "mirrorFormLeadToCallSibling", context,
    operation: async ({ session, now, command_execution_id }) => {
      const current = await loadFormSiblingCandidates(formLeadId, session);
      const plan = current.form ? planFormSiblingUpdate(current.form, current.jobMatches, current.phoneMatches, now) : { kind: "skip" as const, reason: "form_ineligible" as const };
      if (plan.kind === "skip" || plan.call_id !== planned.call_id) {
        result = { outcome: plan.kind === "skip" ? plan.reason : "already_current", call_id: null, basis: null, paths: [], sheet: false };
        return { entity_refs: [], pending: null };
      }
      const call = [...current.jobMatches, ...current.phoneMatches].find((lead) => String(lead._id) === plan.call_id)!;
      const revision = Number(call.domain_revision ?? 0);
      // Only the mirrored fields: saving a hydrated legacy Lead could rerun unrelated normalization hooks.
      const updated = await getCallLeadModel().updateOne({ _id: call._id, domain_revision: revision }, { $set: plan.set }, { session, runValidators: true });
      if (updated.matchedCount !== 1) throw new Error("Call Lead changed during the Form sibling update");
      const paths = Object.keys(plan.set).sort();
      await persistEntityChangeMutations({ session, now, command_name: "mirrorFormLeadToCallSibling", command_execution_id, context,
        mutations: [{ entity: { model: "CallLead", id: plan.call_id }, change_id: new mongoose.Types.ObjectId(), revision_before: revision,
          fields: paths.map((path) => ({ path, ...(readPath(call, path) !== undefined ? { before: readPath(call, path) } : {}), after: plan.set[path] })) }] });
      // Update the Calls row in place only: a sheet job for a Call Lead without a Calls row would append one.
      const sheet: Sheet | null = hasSyncedCallsRow(call) && (plan.set.job_no !== undefined || plan.set.receiver_agent_name_snapshot !== undefined)
        ? { resource: "source_lead", operation: "call_lead.update", leadModel: "CallLead", leadId: plan.call_id }
        : null;
      if (sheet) await enqueueSheetSyncJob(sheet, { session, createdBy: "api" });
      result = { outcome: "updated", call_id: plan.call_id, basis: plan.basis, paths, sheet: Boolean(sheet) };
      return { entity_refs: [{ model: "CallLead", id: plan.call_id }], pending: sheet };
    },
    finalize: async (sheet) => { if (sheet) await finalizeSheetSync(sheet); },
  });
  return result;
}

function readPath(row: Record<string, unknown> | SiblingCallLead, path: string): unknown {
  const value = (row as Record<string, unknown>)[path];
  return value === null ? undefined : value;
}
