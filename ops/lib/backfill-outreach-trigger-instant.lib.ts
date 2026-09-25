/**
 * S11-TIME core (UI-1 §7, UX8): move every Lead Outreach record's `trigger_at` onto the real arrival instant.
 * Entry point: `ops/backfill-outreach-trigger-instant.ts`. Replica proof: `scripts/dev_ops/test-si-time-base.replica.test.ts`.
 *
 * Candidates: every `outreach_records` row with `trigger_kind: "lead_arrival"`, `subject.kind: "lead"`, not purged,
 * walked by `_id`. Per record the new trigger is `leadInstant(lead)` (`src/services/salesIntelligence/outreach/leadInstant.ts`):
 * ET wall clock → instant for ingested Leads, unchanged for `granot_lead_created`.
 *
 * A record is rewritten only when its stored `trigger_at` still equals the Lead's `timestamp` (the value `ensureLead`
 * copied) and differs from the instant. A record already on the instant is `unchanged` (so a re-run writes nothing);
 * a record whose trigger matches neither (the Lead's `timestamp` was edited after the record was created) is left
 * alone and counted `skipped_trigger_not_timestamp`.
 *
 * What the apply rewrites, in one transaction per record, with one `revision` bump and one `outreach_trigger_rebased`
 * audit row (through `refreshRecord`, the worker's own save path):
 * - `trigger_at`; `first_action_due_at` (Form Lead, when set: `addStaffedMinutes(trigger, first_action_due_staffed_minutes)`
 *   with the current policy, as `ensureLead` does); `deadline_resolution.anchor` (+ its `policy_version`);
 * - the contact facts when the record carries them (`computeContactFacts`: `prior_contact_at` windows on the trigger,
 *   and the newest attempt / inbound conversation are counted from it);
 * - when a call-derived instant (`first_attributable_outbound_at`, `first_human_conversation_at`, `last_meaningful_contact_at`)
 *   now falls before the trigger: those three from the calls on the primary Number since the trigger (`callFacts`, the
 *   replay recompute of `ensureInteraction`), and the H1a rule: an `open` record with no attempt, no conversation, no
 *   accepted-progress work and no Owner status instruction goes back to `unworked`.
 * It does not move an assignment whose evidence call now precedes the trigger (counted), does not rewrite audit history
 * (`outreach_created.happened_at` keeps the old trigger) and does not touch `Lead.timestamp`.
 *
 * Dry run (default) is READ-ONLY: no session, no transaction, no write. It predicts `prior_contact_at` (one bounded
 * query per Form Lead record with a Number) and the call-fact recompute (only for records with a fact before the new
 * trigger); the rest is arithmetic on the row. Zero Sales Intelligence jobs: each apply transaction aborts if it
 * creates one. After an apply the entry point publishes the Attention snapshot once (unless `--no-publish`).
 */
import mongoose, { type ClientSession } from "mongoose";
import { withTransaction } from "../../src/db";
import { getCallLeadModel } from "../../src/models/CallLead";
import { getFormLeadModel } from "../../src/models/FormLead";
import { getOutreachRecordModel } from "../../src/models/OutreachRecord";
import { getCallInteractionModel } from "../../src/models/CallInteraction";
import { getSalesIntelligenceJobModel } from "../../src/models/SalesIntelligenceJob";
import { getSalesIntelligenceOwnerInstructionModel } from "../../src/models/SalesIntelligenceOwnerInstruction";
import { computeContactFacts, interactionAttribution, mappedSalesReps, priorContactAt, workerContext } from "../../src/services/salesIntelligence/outreach/ensure";
import { leadInstant, leadTimestampConvention } from "../../src/services/salesIntelligence/outreach/leadInstant";
import { addStaffedMinutes } from "../../src/services/salesIntelligence/outreach/staffing";
import { refreshRecord } from "../../src/services/salesIntelligence/outreach/store";
import { callFacts } from "../../src/services/salesIntelligence/outreach/transitions";
import { CONTACT_FACT_FIELDS, subjectKey, type InteractionRow, type RecordRow } from "../../src/services/salesIntelligence/outreach/types";
import { resolvePolicy } from "../../src/services/salesIntelligence/policy";
import type { CsiPolicy } from "../../src/validation/v1/salesIntelligence";
import { jobTableCounts } from "./backfill-receiver-agent.lib";

export const TRIGGER_INSTANT_VERSION = "outreach-trigger-instant-v1" as const;
export const TRIGGER_REBASED_EVENT = "outreach_trigger_rebased";
/** Calls read per record by the call-fact recompute (earliest first since the trigger). */
export const RECOMPUTE_CALL_SCAN = 200;
const MINUTE = 60_000;
type Model = "FormLead" | "CallLead";
type LeadLean = { _id: mongoose.Types.ObjectId; timestamp?: Date | null; ingestion_origin?: string | null; createdAt?: Date | null;
  ringcentral?: { start_time?: Date | null } | null };
type Tally = Record<string, number>;

export type TriggerInstantReport = {
  version: typeof TRIGGER_INSTANT_VERSION; run_id: string; database: string; mode: "dry_run" | "apply"; as_of: string;
  started_at: string; finished_at: string | null; processed: number; after: string | null;
  /** Outcome per model: `rewrite`, `unchanged`, `skipped_*`. */
  outcomes: Tally;
  /** `${model}:${ingestion_origin}` → records rewritten (or that would be). */
  rewrites_by_origin: Tally;
  /** `${model}:${shift minutes}` → records. */
  shifts: Tally;
  /** Consequences of the rewrite (`first_action_due_changed`, `prior_contact_*`, `call_facts_*`, `band2:*`, …). */
  effects: Tally;
  /** Rule evidence per Lead read: `${model}:${origin}:${createdAt − timestamp bucket}` and the Call Lead RingCentral check. */
  origin_evidence: Tally;
  purged_skipped: number;
  jobs_before: Tally | null; jobs_after: Tally | null;
  written: number; lost_race: number;
};
export function newTriggerInstantReport(database: string, apply: boolean, asOf = new Date()): TriggerInstantReport {
  return { version: TRIGGER_INSTANT_VERSION, run_id: new mongoose.Types.ObjectId().toString(), database, mode: apply ? "apply" : "dry_run", as_of: asOf.toISOString(),
    started_at: asOf.toISOString(), finished_at: null, processed: 0, after: null, outcomes: {}, rewrites_by_origin: {}, shifts: {}, effects: {}, origin_evidence: {},
    purged_skipped: 0, jobs_before: null, jobs_after: null, written: 0, lost_race: 0 };
}
const bump = (t: Tally, key: string, by = 1) => { t[key] = (t[key] ?? 0) + by; };
const leadCollection = (model: Model) => (model === "FormLead" ? getFormLeadModel() : getCallLeadModel()).collection;
const LEAD_PROJECTION = { timestamp: 1, ingestion_origin: 1, createdAt: 1, "ringcentral.start_time": 1 };
const same = (a: Date | null | undefined, b: Date | null | undefined) => (a == null && b == null) || (a != null && b != null && +a === +b);
const before = (value: Date | null | undefined, at: Date) => value != null && +value < +at;

/** `createdAt − timestamp`: exactly equal (the historical-consolidation instant), else rounded to the hour when within 10 minutes of it (ingestion lag), else `other_*`. */
export function originEvidenceBucket(lead: Pick<LeadLean, "timestamp" | "createdAt">): string {
  if (!lead.timestamp || !lead.createdAt) return "no_created_at";
  if (+lead.createdAt === +lead.timestamp) return "created_eq_timestamp";
  const minutes = (+lead.createdAt - +lead.timestamp) / MINUTE;
  const hour = Math.round(minutes / 60) * 60;
  if (Math.abs(minutes - hour) > 10 || Math.abs(hour) > 300) return minutes < 0 ? "other_negative" : "other_later";
  return `created_${hour >= 0 ? "+" : ""}${hour}m`;
}

export type TriggerPlan =
  | { outcome: "lead_missing" | "no_timestamp" | "unchanged" | "skipped_trigger_not_timestamp"; convention: string | null }
  | { outcome: "rewrite"; convention: string; from: Date; to: Date; shift_minutes: number; first_action_due_at: Date | null | undefined };

/** The pure part: the new trigger and due time for one record (no query). */
export function planTriggerInstant(record: Pick<RecordRow, "trigger_at" | "first_action_due_at" | "subject">, lead: LeadLean | null, policy: Pick<CsiPolicy, "timezone" | "staffed_hours" | "first_action_due_staffed_minutes">): TriggerPlan {
  if (!lead) return { outcome: "lead_missing", convention: null };
  const to = leadInstant(lead);
  const convention = leadTimestampConvention(lead);
  if (!to) return { outcome: "no_timestamp", convention };
  if (same(record.trigger_at, to)) return { outcome: "unchanged", convention };
  if (!same(record.trigger_at, lead.timestamp)) return { outcome: "skipped_trigger_not_timestamp", convention };
  const due = record.subject.model === "FormLead" && record.first_action_due_at ? addStaffedMinutes(to, policy.first_action_due_staffed_minutes, policy) : undefined;
  return { outcome: "rewrite", convention, from: record.trigger_at, to, shift_minutes: Math.round((+to - +record.trigger_at) / MINUTE), first_action_due_at: due };
}

/** Band 2 reason of an unworked Form Lead at `asOf` (`derive()`, flag on): before the first-call deadline it is `new_not_yet_due`. */
const band2Reason = (due: Date | null | undefined, asOf: Date) => (due && +due > +asOf ? "new_not_yet_due" : "no_call_yet");

/** The call-derived instants from the calls on the primary Number since the (new) trigger; `ensureInteraction`'s replay rule. */
export async function recomputeCallFacts(record: RecordRow, session: ClientSession | null) {
  const out = { first_attributable_outbound_at: null as Date | null, first_human_conversation_at: null as Date | null, last_meaningful_contact_at: null as Date | null, truncated: false };
  if (!record.primary_contact_number_id) return out;
  const calls = await getCallInteractionModel().find({ contact_number_id: record.primary_contact_number_id, merged_into_id: null, direction: { $in: ["Inbound", "Outbound"] },
    started_at: { $gte: record.trigger_at } }).sort({ started_at: 1, _id: 1 }).limit(RECOMPUTE_CALL_SCAN + 1).session(session).lean() as unknown as InteractionRow[];
  out.truncated = calls.length > RECOMPUTE_CALL_SCAN;
  const s = session as ClientSession;
  for (const call of calls.slice(0, RECOMPUTE_CALL_SCAN)) {
    const facts = callFacts(record, call, await interactionAttribution(call, s), call.contact_type === "human_conversation" ? await mappedSalesReps(call, s) : []);
    if (facts.outboundAttempt) out.first_attributable_outbound_at ??= call.started_at;
    if (facts.human) { out.first_human_conversation_at ??= call.started_at; out.last_meaningful_contact_at = call.started_at; }
  }
  return out;
}
/** H1a: an `open` record with no attempt, no conversation, no accepted-progress work and no Owner status instruction is `unworked`. */
async function revertsToUnworked(record: RecordRow, facts: { first_attributable_outbound_at: Date | null; first_human_conversation_at: Date | null }, session: ClientSession | null) {
  if (record.state !== "open" || facts.first_attributable_outbound_at || facts.first_human_conversation_at || record.lead_progress?.work_observed) return false;
  return !await getSalesIntelligenceOwnerInstructionModel().exists({ subject_key: subjectKey(record.subject), field: "status", followup_id: null }).session(session);
}
const hasContactFacts = (record: Record<string, unknown>) => CONTACT_FACT_FIELDS.every(field => record[field] !== undefined);
const CALL_FACT_FIELDS = ["first_attributable_outbound_at", "first_human_conversation_at", "last_meaningful_contact_at", "last_attributable_outbound_at", "last_inbound_human_at"] as const;

/** Read-only effects of one rewrite (the dry run's prediction; the apply tallies the same keys from what it wrote). */
async function predictEffects(record: RecordRow, plan: Extract<TriggerPlan, { outcome: "rewrite" }>, report: TriggerInstantReport, asOf: Date) {
  const e = report.effects, model = record.subject.model as Model;
  if (plan.first_action_due_at !== undefined) bump(e, "first_action_due_changed");
  if (model === "FormLead" && record.state === "unworked") bump(e, `band2:${band2Reason(record.first_action_due_at, asOf)}->${band2Reason(plan.first_action_due_at ?? record.first_action_due_at, asOf)}`);
  const moved = { ...record, trigger_at: plan.to } as RecordRow;
  if (model === "FormLead" && record.primary_contact_number_id) {
    const prior = await priorContactAt(record.primary_contact_number_id, plan.to, null as unknown as ClientSession);
    const had = record.prior_contact_at ?? null;
    bump(e, `prior_contact:${had ? "set" : "none"}->${prior ? "set" : "none"}${had && prior && !same(had, prior) ? ":moved" : ""}${record.prior_contact_at === undefined ? ":not_stored" : ""}`);
  }
  if (CALL_FACT_FIELDS.some(field => before(record[field] as Date | null | undefined, plan.to))) {
    bump(e, "call_facts_before_new_trigger");
    const facts = await recomputeCallFacts(moved, null);
    if (facts.truncated) bump(e, "call_facts_recompute_truncated");
    for (const field of ["first_attributable_outbound_at", "first_human_conversation_at", "last_meaningful_contact_at"] as const)
      if (!same(record[field] as Date | null | undefined, facts[field])) bump(e, `call_facts_changed:${field}`);
    if (await revertsToUnworked(record, facts, null)) bump(e, "state_open->unworked");
  }
  const assigned = record.assignment as { origin?: string | null; assigned_at?: Date | null } | null | undefined;
  if (assigned && ["first_conversation", "first_attempts"].includes(assigned.origin ?? "") && before(assigned.assigned_at, plan.to)) bump(e, `assignment_evidence_before_trigger:${assigned.origin}`);
}

/** Apply one rewrite in `session`: re-read, re-plan, write through `refreshRecord` (one revision bump, one audit row). */
async function applyOne(recordId: mongoose.Types.ObjectId, policy: CsiPolicy, report: TriggerInstantReport, session: ClientSession, now: Date): Promise<boolean> {
  const record = await getOutreachRecordModel().findById(recordId).session(session);
  if (!record || record.get("purged_at")) return false;
  const model = record.subject.model as Model;
  const lead = await leadCollection(model).findOne({ _id: record.subject.id! }, { projection: LEAD_PROJECTION, session }) as LeadLean | null;
  const plan = planTriggerInstant(record as unknown as RecordRow, lead, policy);
  if (plan.outcome !== "rewrite") return false;
  const prior = record.toObject();
  const e = report.effects;
  record.trigger_at = plan.to;
  if (plan.first_action_due_at !== undefined) { record.first_action_due_at = plan.first_action_due_at; bump(e, "first_action_due_changed"); }
  if (record.deadline_resolution) { record.deadline_resolution.anchor = plan.to; record.deadline_resolution.policy_version = policy.version; }
  const row = record as unknown as RecordRow;
  if (CALL_FACT_FIELDS.some(field => before(prior[field] as Date | null | undefined, plan.to))) {
    bump(e, "call_facts_before_new_trigger");
    const facts = await recomputeCallFacts(row, session);
    if (facts.truncated) bump(e, "call_facts_recompute_truncated");
    for (const field of ["first_attributable_outbound_at", "first_human_conversation_at", "last_meaningful_contact_at"] as const) {
      if (!same(prior[field] as Date | null | undefined, facts[field])) bump(e, `call_facts_changed:${field}`);
      record.set(field, facts[field]);
    }
    if (await revertsToUnworked(row, facts, session)) { record.state = "unworked"; bump(e, "state_open->unworked"); }
  }
  if (hasContactFacts(prior as unknown as Record<string, unknown>)) {
    const facts = await computeContactFacts(row, session);
    if (model === "FormLead" && record.primary_contact_number_id) {
      const had = prior.prior_contact_at ?? null, now2 = facts.prior_contact_at;
      bump(e, `prior_contact:${had ? "set" : "none"}->${now2 ? "set" : "none"}${had && now2 && !same(had, now2) ? ":moved" : ""}`);
    }
    record.set(facts);
  } else if (model === "FormLead" && record.primary_contact_number_id) bump(e, "prior_contact:not_stored");
  const assigned = prior.assignment as { origin?: string | null; assigned_at?: Date | null } | null | undefined;
  if (assigned && ["first_conversation", "first_attempts"].includes(assigned.origin ?? "") && before(assigned.assigned_at, plan.to)) bump(e, `assignment_evidence_before_trigger:${assigned.origin}`);
  const context = workerContext(session, `${TRIGGER_INSTANT_VERSION}:${report.run_id}:${recordId}`, now);
  await refreshRecord(record, context, TRIGGER_REBASED_EVENT, prior, { trigger_rebase: { from: plan.from.toISOString(), to: plan.to.toISOString(),
    shift_minutes: plan.shift_minutes, convention: plan.convention, run_id: report.run_id, version: TRIGGER_INSTANT_VERSION } });
  return true;
}

export type TriggerInstantSeams = { now?: () => Date; log?: (event: string, fields?: Record<string, unknown>) => unknown; save?: (report: TriggerInstantReport) => Promise<unknown> };

/** The walk. Dry run reads only; apply writes one transaction per rewritten record (idempotent: a re-run finds them `unchanged`). */
export async function runTriggerInstantBackfill(options: { apply: boolean; limit?: number | null; page?: number }, report: TriggerInstantReport, seams: TriggerInstantSeams = {}) {
  const now = seams.now ?? (() => new Date());
  const asOf = new Date(report.as_of);
  const page = options.page ?? 200, limit = options.limit ?? null;
  const policy = await resolvePolicy();
  const Records = getOutreachRecordModel();
  const base = { trigger_kind: "lead_arrival" as const, "subject.kind": "lead" as const };
  report.jobs_before ??= await jobTableCounts();
  report.purged_skipped = await Records.countDocuments({ ...base, purged_at: { $ne: null } });
  await seams.log?.("started", { mode: report.mode, as_of: report.as_of, after: report.after });
  while (limit === null || report.processed < limit) {
    const size = limit === null ? page : Math.max(1, Math.min(page, limit - report.processed));
    const records = await Records.find({ ...base, purged_at: null, ...(report.after ? { _id: { $gt: new mongoose.Types.ObjectId(report.after) } } : {}) })
      .sort({ _id: 1 }).limit(size).lean() as unknown as RecordRow[];
    if (!records.length) break;
    const leads = new Map<string, LeadLean>();
    for (const model of ["FormLead", "CallLead"] as const) {
      const ids = records.filter(r => r.subject.model === model).map(r => r.subject.id!);
      if (!ids.length) continue;
      for (const lead of await leadCollection(model).find({ _id: { $in: ids } }, { projection: LEAD_PROJECTION }).toArray() as unknown as LeadLean[]) leads.set(`${model}:${lead._id}`, lead);
    }
    for (const record of records) {
      const model = record.subject.model as Model;
      const lead = leads.get(`${model}:${record.subject.id}`) ?? null;
      const origin = lead ? lead.ingestion_origin ?? "none" : "lead_missing";
      if (lead) {
        bump(report.origin_evidence, `${model}:${origin}:${originEvidenceBucket(lead)}`);
        bump(report.origin_evidence, `${model}:${origin}:convention_${leadTimestampConvention(lead)}`);
        if (model === "CallLead" && lead.ringcentral?.start_time) {
          const instant = leadInstant(lead);
          bump(report.origin_evidence, `${model}:${origin}:ringcentral_start_${instant && Math.abs(+instant - +lead.ringcentral.start_time) <= 2_000 ? "matches_instant" : "differs"}`);
        }
      }
      const plan = planTriggerInstant(record, lead, policy);
      bump(report.outcomes, `${model}:${plan.outcome}`);
      if (plan.outcome === "rewrite") {
        bump(report.rewrites_by_origin, `${model}:${origin}`);
        bump(report.shifts, `${model}:${plan.shift_minutes}`);
        if (options.apply) {
          const written = await withTransaction(async session => {
            const recent = { _id: { $gt: mongoose.Types.ObjectId.createFromTime(Math.floor((Date.now() - 3_600_000) / 1000)) } };
            const jobsBefore = await getSalesIntelligenceJobModel().countDocuments(recent).session(session);
            const done = await applyOne(record._id, policy, report, session, now());
            if (await getSalesIntelligenceJobModel().countDocuments(recent).session(session) !== jobsBefore) throw new Error(`a Sales Intelligence job was created while rebasing ${record._id}; transaction aborted`);
            return done;
          });
          if (written) report.written++; else report.lost_race++;
          await seams.log?.("rewritten", { record_id: String(record._id), model, from: plan.from.toISOString(), to: plan.to.toISOString(), shift_minutes: plan.shift_minutes, written });
        } else await predictEffects(record, plan, report, asOf);
      }
      report.after = String(record._id);
      report.processed++;
    }
    await seams.save?.(report);
  }
  report.jobs_after = await jobTableCounts();
  report.finished_at = now().toISOString();
  await seams.save?.(report);
  await seams.log?.("finished", { mode: report.mode, processed: report.processed, outcomes: report.outcomes, written: report.written });
  return report;
}

const table = (title: string, header: string, tally: Tally) => {
  const rows = Object.entries(tally).sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }));
  return [`## ${title}`, "", `| ${header} | Records |`, "|---|---|", ...(rows.length ? rows.map(([k, v]) => `| \`${k}\` | ${v} |`) : ["| (none) | 0 |"]), ""];
};
/** The report body: counts and distributions only, no identifiers. */
export function triggerInstantReport(report: TriggerInstantReport, env: string, extra: string[] = []): string {
  const shiftTotals: Tally = {};
  for (const [key, n] of Object.entries(report.shifts)) bump(shiftTotals, key.split(":")[1]!, n);
  return [
    `# S11-TIME: Outreach trigger instant backfill (${env}, ${report.mode})`, "",
    `- Script \`ops/backfill-outreach-trigger-instant.ts\` (${TRIGGER_INSTANT_VERSION}); database \`${report.database}\`; as_of ${report.as_of}; ${report.started_at} → ${report.finished_at ?? "(not finished)"}`,
    `- Candidates: \`outreach_records\` with \`trigger_kind: lead_arrival\`, \`subject.kind: lead\`, not purged. Processed ${report.processed}; purged (not walked) ${report.purged_skipped}.`,
    report.mode === "apply" ? `- Written ${report.written}; lost a race (re-run picks it up) ${report.lost_race}.` : "- Dry run: read-only (no session, no transaction, no write).",
    `- Sales Intelligence jobs (all stages) before → after: ${report.jobs_before?.total ?? "?"} → ${report.jobs_after?.total ?? "?"}.`,
    ...extra, "",
    ...table("Outcome by Lead model", "Model:outcome", report.outcomes),
    ...table("Rewrites by Lead model and ingestion origin", "Model:origin", report.rewrites_by_origin),
    ...table("Shift distribution (minutes, all models)", "Shift", shiftTotals),
    ...table("Shift distribution by model (minutes)", "Model:shift", report.shifts),
    ...table("Effects of the rewrite", "Effect", report.effects),
    ...table("Rule evidence: createdAt − timestamp per origin (every Lead read), and Call Lead RingCentral start vs the instant", "Model:origin:bucket", report.origin_evidence),
  ].join("\n");
}
