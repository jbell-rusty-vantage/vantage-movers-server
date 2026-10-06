/**
 * Outreach lifecycle repair B1 (RELEASE operator step): repair first policy periods written by the
 * pre-B1 planner, which opened a review subject's late first period at the enrollment boundary as an
 * `intake` start. The engine then owed the arrival day, every day since and the initial response
 * retroactively (`docs/knowledge/services/sales-outreach-desk.md`, "Late first period").
 *
 * - candidates: periods with `start_kind: "intake"` (only a first period can have it) whose row was
 *   created more than `LATE_PERIOD_MIN_GAP_MS` after its subject, i.e. not in the subject's creating
 *   transaction. Expected production count: 0–1;
 * - plan per row (pure, `planLateFirstPeriodRepair`): `started_at' = max(activation_at, fact)` where the
 *   fact is the accepted observation's `captured_at` for `priority_source_ref`, else the period row's
 *   `createdAt` (the desk decision instant); `start_kind' = "activation"`; `time_basis'` = the
 *   observation basis, `desk_decision_at`, or `activation_boundary` when the boundary wins. A row whose
 *   new start would fall after its `ended_at` is skipped and reported, never written;
 * - apply per row in one transaction: CAS `{_id, revision, start_kind: "intake"}` → `$set` the three
 *   fields and `$inc revision`; one `appendCsiAudit` row (`kind: outreach`,
 *   `event_kind: sales_outreach_period_repaired`, prior/current values); one `outreach_evaluate`
 *   nomination `sod:evaluate:<subject>:repair:<period_id>` (input revision 1);
 * - olr BW1, same transaction: the C4 contact re-derive (`repairContactWakeOf`, through the subject
 *   store's `nominateContactSources`) for the subject's credited numbers' calls and SMS in
 *   `[old start, new start)`, job identity `sod:contact_change:<call|sms>:<id>:repair:<period_id>`.
 *   Those contacts were derived inside the old period (its workflow, goal scope); re-derived they fall
 *   before the period (no workflow, no goal scope, still the subject's, so an activation date's
 *   partial quota subtracts them). Contacts at or after the new start keep the same period. Only while
 *   the persisted desk wants contact evidence (`deskWantsContactEvidence`, C4's rule); never earlier
 *   than C4's `SUBJECT_WAKE_LOOKBACK_MS`, at most `SUBJECT_WAKE_SOURCES_PER_KIND` per kind;
 * - idempotent: a repaired row is `activation`, so a re-run selects 0 and writes nothing.
 *
 * Pure parts are unit-tested (`sales-outreach-repair-late-first-periods.test.ts`); the Mongo parts are
 * proven on the replica (`ops/sales-outreach/subjects.replica.ts`, step 5).
 */
import mongoose, { type ClientSession } from "mongoose";
import type { SalesOutreachTimeBasis } from "../../src/config/domain/salesOutreach";
import { withTransaction } from "../../src/db";
import { getGranotObservationModel } from "../../src/models/GranotObservation";
import { getSalesOutreachPolicyPeriodModel, getSalesOutreachSubjectModel } from "../../src/models/salesOutreach";
import type { CsiActor } from "../../src/services/salesIntelligence/auth";
import { enqueueCsiJob } from "../../src/services/salesIntelligence/jobs";
import { appendCsiAudit } from "../../src/services/salesIntelligence/transactions";
import { deskWantsContactEvidence } from "../../src/services/salesOutreach/capture/contactChangeWake";
import { evaluationJob } from "../../src/services/salesOutreach/evaluation/evaluateJob";
import type { DeskLeadRef } from "../../src/services/salesOutreach/subjects/leadFacts";
import { mongoDeskSubjectStore, type ContactWakeRequest } from "../../src/services/salesOutreach/subjects/store";
import { SUBJECT_WAKE_LOOKBACK_MS, SUBJECT_WAKE_SOURCES_PER_KIND } from "../../src/services/salesOutreach/subjects/sync";

export const REPAIR_VERSION = "repair-late-first-periods-v1";
export const REPAIR_EVENT_KIND = "sales_outreach_period_repaired";
/** A period created this long after its subject was not written in the subject's creating transaction. */
export const LATE_PERIOD_MIN_GAP_MS = 60_000;
/** 0–1 rows expected; the cap only stops a runaway selection. */
export const REPAIR_MAX_ROWS = 5_000;
const ALLOW_SCHEMA_DRIFT = "--allow-schema-drift";

/**
 *   --target=<database>      required; must equal the database this process resolves
 *   --apply                  write (default: dry run, read-only)
 *   --allow-schema-drift     passed through to the production-writer guard
 */
export type RepairCliArgs = Readonly<{ target: string; apply: boolean }>;

export function parseRepairArgs(argv: readonly string[]): RepairCliArgs {
  let target: string | null = null;
  let apply = false;
  for (const arg of argv) {
    if (arg === "--apply") apply = true;
    else if (arg.startsWith("--target=")) target = arg.slice("--target=".length).trim();
    else if (arg === ALLOW_SCHEMA_DRIFT) continue;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!target) throw new Error("--target=<database name> is required (for example --target=vantagemovers)");
  if (!/^[A-Za-z0-9_]+$/.test(target)) throw new Error("--target must be a plain database name");
  return { target, apply };
}

/** One stored first period and the facts its repair needs. */
export type RepairCandidate = Readonly<{
  period_id: string;
  subject_id: string;
  /** The subject's Lead (whose credited numbers the BW1 contact re-derive reads). */
  lead: DeskLeadRef;
  period_revision: number;
  started_at: Date;
  ended_at: Date | null;
  time_basis: string;
  period_created_at: Date;
  subject_created_at: Date;
  /** The subject's `enrollment.activation_at` (nothing is due before it). */
  activation_at: Date;
  priority_source_ref: string | null;
  /** `captured_at` of the accepted observation `priority_source_ref` names, when it exists. */
  observation_captured_at: Date | null;
}>;

export type PeriodStartFields = Readonly<{ started_at: Date; start_kind: "intake" | "activation"; time_basis: string }>;

export type RepairPlan =
  | Readonly<{
      action: "repair";
      period_id: string;
      subject_id: string;
      lead: DeskLeadRef;
      expected_revision: number;
      prior: PeriodStartFields;
      next: Readonly<{ started_at: Date; start_kind: "activation"; time_basis: SalesOutreachTimeBasis }>;
    }>
  | Readonly<{ action: "skip"; period_id: string; subject_id: string; reason: "written_with_subject" | "starts_after_end" }>;

/** Is the period a late first period (not written in the subject's creating transaction)? */
export const isLateFirstPeriod = (row: Pick<RepairCandidate, "period_created_at" | "subject_created_at">) =>
  +row.period_created_at - +row.subject_created_at > LATE_PERIOD_MIN_GAP_MS;

/** The B1 start of a late first period, from what the stored rows still tell (pure). */
export function planLateFirstPeriodRepair(row: RepairCandidate): RepairPlan {
  const ids = { period_id: row.period_id, subject_id: row.subject_id };
  if (!isLateFirstPeriod(row)) return { action: "skip", ...ids, reason: "written_with_subject" };
  const fact = row.observation_captured_at ?? row.period_created_at;
  const boundaryWins = +fact <= +row.activation_at;
  const startedAt = boundaryWins ? row.activation_at : fact;
  if (row.ended_at && +startedAt > +row.ended_at) return { action: "skip", ...ids, reason: "starts_after_end" };
  const timeBasis: SalesOutreachTimeBasis = boundaryWins
    ? "activation_boundary"
    : row.observation_captured_at
      ? "accepted_observation_captured_at"
      : "desk_decision_at";
  return {
    action: "repair",
    ...ids,
    lead: row.lead,
    expected_revision: row.period_revision,
    prior: { started_at: row.started_at, start_kind: "intake", time_basis: row.time_basis },
    next: { started_at: startedAt, start_kind: "activation", time_basis: timeBasis },
  };
}

/** The BW1 re-derive identity suffix (`sod:contact_change:<kind>:<id>:repair:<period_id>`). */
export const repairContactRevision = (periodId: string) => `repair:${periodId}`;

/**
 * olr BW1: the C4 contact re-derive one repaired row needs (pure; null = nothing to re-derive). The
 * window is `[old start, new start)` floored at C4's lookback before `now`; contacts at or after the
 * new start were derived inside the same period and workflow, so they do not change.
 */
export function repairContactWakeOf(plan: Extract<RepairPlan, { action: "repair" }>, now: Date): ContactWakeRequest | null {
  const since = new Date(Math.max(+plan.prior.started_at, +now - SUBJECT_WAKE_LOOKBACK_MS));
  const until = plan.next.started_at;
  if (+since >= +until || +since >= +now) return null;
  return { lead: plan.lead, since, until, source_revision: repairContactRevision(plan.period_id), limit_per_kind: SUBJECT_WAKE_SOURCES_PER_KIND, now };
}

export type RepairSummary = Readonly<{
  version: typeof REPAIR_VERSION;
  /** Periods with `start_kind: "intake"` read (first periods of intake subjects). */
  intake_periods: number;
  /** Late first periods to repair now; 0 after a successful apply. */
  repairable: number;
  skipped: Record<string, number>;
  /** Ids and instants only (no customer content). */
  plans: Array<Readonly<{ period_id: string; subject_id: string; action: string; reason?: string; from?: string; to?: string; time_basis?: string }>>;
}>;

export function summarizeRepair(intakePeriods: number, plans: readonly RepairPlan[]): RepairSummary {
  const skipped: Record<string, number> = {};
  for (const plan of plans) if (plan.action === "skip" && plan.reason !== "written_with_subject") skipped[plan.reason] = (skipped[plan.reason] ?? 0) + 1;
  return {
    version: REPAIR_VERSION,
    intake_periods: intakePeriods,
    repairable: plans.filter((plan) => plan.action === "repair").length,
    skipped,
    plans: plans
      .filter((plan) => plan.action === "repair" || plan.reason !== "written_with_subject")
      .map((plan) =>
        plan.action === "repair"
          ? { period_id: plan.period_id, subject_id: plan.subject_id, action: "repair", from: plan.prior.started_at.toISOString(), to: plan.next.started_at.toISOString(), time_basis: plan.next.time_basis }
          : { period_id: plan.period_id, subject_id: plan.subject_id, action: "skip", reason: plan.reason },
      ),
  };
}

// --- Mongo ----------------------------------------------------------------------------------------

type PeriodDoc = {
  _id: mongoose.Types.ObjectId;
  subject_id: mongoose.Types.ObjectId;
  revision: number;
  started_at: Date;
  ended_at?: Date | null;
  time_basis: string;
  priority_source_ref?: string | null;
  createdAt: Date;
};
type SubjectDoc = {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  enrollment: { activation_at: Date };
  lead_model: DeskLeadRef["model"];
  lead_id: mongoose.Types.ObjectId;
};

/** Reads every `intake` period with its subject and observation facts (session optional: dry run reads unbound). */
export async function loadRepairCandidates(session: ClientSession | null = null): Promise<{ intake_periods: number; candidates: RepairCandidate[] }> {
  // No index on start_kind: a one-off scan of the period collection (thousands of rows), dry run included.
  const periods = (await getSalesOutreachPolicyPeriodModel()
    .find({ start_kind: "intake" }, { subject_id: 1, revision: 1, started_at: 1, ended_at: 1, time_basis: 1, priority_source_ref: 1, createdAt: 1 })
    .sort({ _id: 1 })
    .limit(REPAIR_MAX_ROWS + 1)
    .session(session)
    .lean()) as unknown as PeriodDoc[];
  if (periods.length > REPAIR_MAX_ROWS) throw new Error(`more than ${REPAIR_MAX_ROWS} intake periods; refusing to plan an unbounded repair`);
  const subjects = periods.length
    ? ((await getSalesOutreachSubjectModel()
        .find({ _id: { $in: [...new Set(periods.map((p) => String(p.subject_id)))].map((id) => new mongoose.Types.ObjectId(id)) } }, { createdAt: 1, "enrollment.activation_at": 1, lead_model: 1, lead_id: 1 })
        .session(session)
        .lean()) as unknown as SubjectDoc[])
    : [];
  const subjectById = new Map(subjects.map((s) => [String(s._id), s]));
  const late = periods.filter((p) => {
    const subject = subjectById.get(String(p.subject_id));
    return subject && isLateFirstPeriod({ period_created_at: p.createdAt, subject_created_at: subject.createdAt });
  });
  const refs = [...new Set(late.flatMap((p) => (p.priority_source_ref && mongoose.isValidObjectId(p.priority_source_ref) ? [p.priority_source_ref] : [])))];
  const observations = refs.length
    ? ((await getGranotObservationModel()
        .find({ _id: { $in: refs.map((id) => new mongoose.Types.ObjectId(id)) } }, { captured_at: 1 })
        .session(session)
        .lean()) as unknown as Array<{ _id: unknown; captured_at: Date }>)
    : [];
  const capturedAt = new Map(observations.map((o) => [String(o._id), o.captured_at]));
  return {
    intake_periods: periods.length,
    candidates: late.map((p) => {
      const subject = subjectById.get(String(p.subject_id))!;
      return {
        period_id: String(p._id),
        subject_id: String(p.subject_id),
        lead: { model: subject.lead_model, id: String(subject.lead_id) },
        period_revision: p.revision,
        started_at: p.started_at,
        ended_at: p.ended_at ?? null,
        time_basis: p.time_basis,
        period_created_at: p.createdAt,
        subject_created_at: subject.createdAt,
        activation_at: subject.enrollment.activation_at,
        priority_source_ref: p.priority_source_ref ?? null,
        observation_captured_at: p.priority_source_ref ? (capturedAt.get(p.priority_source_ref) ?? null) : null,
      };
    }),
  };
}

/** Dry run: the plan for every late first period. Reads only. */
export async function reportRepair(): Promise<{ summary: RepairSummary; plans: RepairPlan[] }> {
  const { intake_periods, candidates } = await loadRepairCandidates();
  const plans = candidates.map(planLateFirstPeriodRepair);
  return { summary: summarizeRepair(intake_periods, plans), plans };
}

export type RepairApplyResult = Readonly<{
  run_id: string;
  repaired: string[];
  conflicts: string[];
  skipped: Record<string, number>;
  /** BW1: `outreach_contact_change` jobs the repairs nominated (new or deduplicated). */
  contact_wakes: number;
}>;

export type RepairApplyDeps = Readonly<{
  transaction?: <T>(fn: (session: ClientSession) => Promise<T>) => Promise<T>;
  now?: () => Date;
  /** BW1: does the persisted desk want contact evidence (default: C4's `deskWantsContactEvidence`). */
  wanted?: (session: ClientSession) => Promise<boolean>;
  /** BW1: the C4 nomination (default: the Mongo subject store's `nominateContactSources`). */
  nominate?: (request: ContactWakeRequest, session: ClientSession) => Promise<number>;
}>;

/** BW1: nominate one repaired row's contact re-derive in the repair transaction; returns the jobs enqueued. */
export async function nominateRepairContactWake(
  plan: Extract<RepairPlan, { action: "repair" }>,
  now: Date,
  session: ClientSession,
  deps: Pick<RepairApplyDeps, "wanted" | "nominate"> = {},
): Promise<number> {
  const wake = repairContactWakeOf(plan, now);
  if (!wake) return 0;
  if (!(await (deps.wanted ?? deskWantsContactEvidence)(session))) return 0;
  return (deps.nominate ?? mongoDeskSubjectStore.nominateContactSources)(wake, session);
}

/**
 * Repairs each planned row in its own transaction (CAS on the revision and the `intake` start kind, so a
 * row a concurrent writer changed is reported as a conflict and left alone). Callers must have passed the
 * target check and the production-writer guard.
 */
export async function applyRepair(input: { actor: CsiActor; run_id: string }, deps: RepairApplyDeps = {}): Promise<RepairApplyResult> {
  const transaction = deps.transaction ?? withTransaction;
  const now = deps.now ?? (() => new Date());
  const { plans, summary } = await reportRepair();
  const repaired: string[] = [];
  const conflicts: string[] = [];
  let contactWakes = 0;
  for (const plan of plans) {
    if (plan.action !== "repair") continue;
    const wakes = await transaction(async (session): Promise<number | null> => {
      const at = now();
      const result = await getSalesOutreachPolicyPeriodModel().updateOne(
        { _id: new mongoose.Types.ObjectId(plan.period_id), revision: plan.expected_revision, start_kind: "intake" },
        { $set: { started_at: plan.next.started_at, start_kind: plan.next.start_kind, time_basis: plan.next.time_basis }, $inc: { revision: 1 } },
        { session, runValidators: true },
      );
      if (result.modifiedCount !== 1) return null;
      await appendCsiAudit(
        { session, command_id: new mongoose.Types.ObjectId(), now: at, actor: input.actor },
        {
          subject_key: `outreach-subject:${plan.subject_id}`,
          event_kind: REPAIR_EVENT_KIND,
          kind: "outreach",
          target_id: plan.period_id,
          revision: plan.expected_revision + 1,
          prior: { started_at: plan.prior.started_at.toISOString(), start_kind: plan.prior.start_kind, time_basis: plan.prior.time_basis, run_id: input.run_id },
          current: { started_at: plan.next.started_at.toISOString(), start_kind: plan.next.start_kind, time_basis: plan.next.time_basis, run_id: input.run_id },
        },
      );
      await enqueueCsiJob(evaluationJob(plan.subject_id, `repair:${plan.period_id}`, 1), session);
      // The period update ran in this session, so each re-derive reads the repaired start.
      return nominateRepairContactWake(plan, at, session, deps);
    });
    if (wakes === null) conflicts.push(plan.period_id);
    else {
      repaired.push(plan.period_id);
      contactWakes += wakes;
    }
  }
  return { run_id: input.run_id, repaired, conflicts, skipped: summary.skipped, contact_wakes: contactWakes };
}
