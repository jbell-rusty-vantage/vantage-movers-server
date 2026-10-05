import type { ClientSession } from "mongoose";
import { SALES_OUTREACH_COMMAND_KINDS, SALES_OUTREACH_CONTRACT_VERSION } from "../../../config/domain/salesOutreach";
import type { SalesOutreachPlanCommandResponse } from "../../../validation/v1/salesOutreachCommands";
import { CsiError } from "../../salesIntelligence/auth";
import { appendCsiAudit, executeCsiCommand, type CsiTransactionContext } from "../../salesIntelligence/transactions";
import type { OutreachActor } from "../auth";
import { validateQuotedSelection, type BusinessCalendar } from "../engine";
import { OutreachError } from "../errors";
import { evaluationJob } from "../evaluation/evaluateJob";
import { toEngineRestriction } from "../evaluation/inputs";
import type { DeskPlanRow } from "../evaluation/store";
import type { DeskSubjectRow } from "../subjects/store";
import {
  activePlanOf,
  authorizedSubject,
  commandLoader,
  commandStore,
  newYorkLocal,
  planRevisionOf,
  requireCommandConfiguration,
  requireCommandPolicy,
  subjectAuditKey,
  wakeCommandJobs,
  type DeskCommandDeps,
} from "./common";
import type { DeskCommandStore, NewPlan } from "./store";

/**
 * Human planning commands (SRV-7, P04b–P04d, P06e/P06f). One active human plan per subject; a
 * Quoted date and a timed callback share one plan revision, so concurrent commands conflict (409),
 * and replacing a different kind of plan needs explicit intent. Each command, its plan rows, its audit
 * event and its evaluation nomination commit in one transaction through the CSI command ledger
 * (Idempotency-Key replay returns the original result). A command never supplies contact credit and
 * never erases history: an ended plan is kept as `replaced`/`cancelled`, and the engine keeps every
 * earlier miss.
 */

/** Explicit appointments farther out than the engine's evaluated horizon are refused. */
const MAX_APPOINTMENT_DAYS = 365;
/** Clock-skew allowance for an appointment "now". */
const APPOINTMENT_PAST_TOLERANCE_MS = 60_000;

type PlanResult = Omit<SalesOutreachPlanCommandResponse, "replayed">;

function planDto(row: Pick<DeskPlanRow, "id" | "kind" | "period_id" | "selected_date" | "appointment_at" | "due_at" | "window_minutes" | "effective_at" | "revision">, calendar: BusinessCalendar) {
  return {
    plan_id: row.id,
    kind: row.kind,
    period_id: row.period_id,
    selected_date: row.selected_date,
    appointment_at: row.appointment_at?.toISOString() ?? null,
    appointment_local: row.appointment_at ? newYorkLocal(calendar, row.appointment_at) : null,
    due_at: row.due_at.toISOString(),
    window_minutes: row.window_minutes,
    effective_at: row.effective_at.toISOString(),
    status: "active" as const,
    revision: row.revision,
  };
}

const planAudit = (plan: DeskPlanRow | null): Record<string, string | number | null> =>
  plan
    ? {
        plan_id: plan.id,
        kind: plan.kind,
        period_id: plan.period_id,
        selected_date: plan.selected_date,
        appointment_at: plan.appointment_at?.toISOString() ?? null,
        effective_at: plan.effective_at.toISOString(),
        revision: plan.revision,
      }
    : {};

type PlanChange = Readonly<{
  subject: DeskSubjectRow;
  expected_revision: number;
  active: DeskPlanRow | null;
  end: "replaced" | "cancelled" | null;
  insert: Omit<NewPlan, "revision" | "actor" | "effective_at" | "subject_id"> | null;
  event_kind: string;
  actor_role: OutreachActor["role"];
}>;

/** Writes one plan change (end the active plan and/or insert the new one), its audit and its evaluation job. */
async function applyPlanChange(
  change: PlanChange,
  context: CsiTransactionContext,
  store: DeskCommandStore,
  audit: typeof appendCsiAudit,
  calendar: BusinessCalendar,
  wake: string[],
): Promise<PlanResult> {
  const next = change.expected_revision + 1;
  const { session, now } = context;
  if (change.active && change.end) {
    if (!(await store.endPlan(change.active.id, change.active.revision, { status: change.end, ended_at: now, revision: next }, session)))
      throw new CsiError("REVISION_CONFLICT");
  }
  let inserted: DeskPlanRow | null = null;
  if (change.insert) {
    const row = { ...change.insert, subject_id: change.subject.id, actor: context.actor, effective_at: now, revision: next };
    const id = await store.insertPlan(row, session);
    inserted = { ...row, id, status: "active", ended_at: null, end_reason: null };
  }
  await audit(context, {
    subject_key: subjectAuditKey(change.subject.id),
    event_kind: change.event_kind,
    prior: planAudit(change.active),
    current: {
      ...planAudit(inserted),
      prior_selected_date: change.active?.selected_date ?? null,
      prior_appointment_at: change.active?.appointment_at?.toISOString() ?? null,
      ended_plan_id: change.end ? (change.active?.id ?? null) : null,
      ended_status: change.end,
      actor_role: change.actor_role,
      plan_revision: next,
    },
    target_id: inserted?.id ?? change.active?.id ?? change.subject.id,
    revision: next,
    kind: "followup",
  });
  const job = await store.enqueue(evaluationJob(change.subject.id, `plan:r${next}`, next), session, now);
  if (job.created) wake.push(job.job_id);
  return {
    contract_version: SALES_OUTREACH_CONTRACT_VERSION,
    subject_id: change.subject.id,
    plan_revision: next,
    plan: inserted ? planDto(inserted, calendar) : null,
    ended_plan: change.end && change.active ? { plan_id: change.active.id, kind: change.active.kind, status: change.end } : null,
    changed: true,
  };
}

function unchanged(subject: DeskSubjectRow, revision: number, active: DeskPlanRow | null, calendar: BusinessCalendar): PlanResult {
  return {
    contract_version: SALES_OUTREACH_CONTRACT_VERSION,
    subject_id: subject.id,
    plan_revision: revision,
    plan: active ? planDto(active, calendar) : null,
    ended_plan: null,
    changed: false,
  };
}

/** Subject facts every plan command needs, read in the command transaction and authorized. */
async function planContext(actor: OutreachActor, subjectId: string, expectedRevision: number, deps: DeskCommandDeps, session: ClientSession) {
  const store = commandStore(deps);
  const configuration = await requireCommandConfiguration(commandLoader(deps), session, { desk: true });
  const { policy, calendar } = requireCommandPolicy(configuration);
  const { subject } = await authorizedSubject(actor, subjectId, store, session);
  if (subject.status !== "active") throw new OutreachError("INVALID_INPUT", [{ path: "subject", code: "subject_not_open" }]);
  const [periods, plans] = await Promise.all([store.loadPeriods(subject.id, session), store.loadPlans(subject.id, session)]);
  const period = periods.find((p) => p.ended_at === null) ?? null;
  if (!period || period.workflow === "closed") throw new OutreachError("INVALID_INPUT", [{ path: "subject", code: "subject_not_open" }]);
  const revision = planRevisionOf(plans);
  if (revision !== expectedRevision) throw new CsiError("REVISION_CONFLICT");
  return { store, policy, calendar, subject, period, active: activePlanOf(plans), revision };
}

export type QuotedFollowupInput = Readonly<{
  actor: OutreachActor;
  subject_id: string;
  idempotency_key: string;
  expected_revision: number;
  period_id: string;
  selected_date: string;
  replace_active_plan: boolean;
}>;

/**
 * `PATCH /outreach/:id/quoted-followup` — Owner, Manager or the current assigned Rep (P04b, P09b).
 * Only in an active Quoted period; the date follows P04c (today through the cutoff, future working
 * dates; past and closed dates refused, never shifted). Rescheduling after a miss needs no separate
 * approval and keeps the miss (P04b `post_miss_reschedule`).
 */
export async function setQuotedFollowup(input: QuotedFollowupInput, deps: DeskCommandDeps = {}): Promise<SalesOutreachPlanCommandResponse> {
  const wake: string[] = [];
  const { response, replayed } = await (deps.run ?? executeCsiCommand)<PlanResult>({
    actor: input.actor.actor,
    command: SALES_OUTREACH_COMMAND_KINDS.quoted_followup,
    idempotency_key: input.idempotency_key,
    payload: {
      subject_id: input.subject_id,
      expected_revision: input.expected_revision,
      period_id: input.period_id,
      selected_date: input.selected_date,
      replace_active_plan: input.replace_active_plan,
    },
    operation: async (context) => {
      wake.length = 0;
      const c = await planContext(input.actor, input.subject_id, input.expected_revision, deps, context.session);
      if (c.period.workflow !== "quoted") throw new OutreachError("INVALID_INPUT", [{ path: "subject", code: "not_quoted" }]);
      if (c.period.id !== input.period_id) throw new OutreachError("REVISION_CONFLICT", [{ path: "period_id", code: "period_changed" }]);
      if (c.active?.kind === "callback" && !input.replace_active_plan)
        throw new OutreachError("INVALID_INPUT", [{ path: "replace_active_plan", code: "replacement_intent_required" }]);
      const selection = validateQuotedSelection(c.calendar, c.policy, +context.now, input.selected_date);
      if (!selection.allowed) throw new OutreachError("INVALID_INPUT", [{ path: "selected_date", code: selection.reason }]);
      if (c.active?.kind === "quoted_date" && c.active.selected_date === input.selected_date && c.active.period_id === c.period.id)
        return unchanged(c.subject, c.revision, c.active, c.calendar);
      return applyPlanChange(
        {
          subject: c.subject,
          expected_revision: c.revision,
          active: c.active,
          end: c.active ? "replaced" : null,
          insert: {
            period_id: c.period.id,
            kind: "quoted_date",
            selected_date: input.selected_date,
            appointment_at: null,
            due_at: new Date(selection.due_at_ms),
            window_minutes: null,
          },
          event_kind: "sales_outreach_quoted_followup_set",
          actor_role: input.actor.role,
        },
        context,
        c.store,
        deps.audit ?? appendCsiAudit,
        c.calendar,
        wake,
      );
    },
  });
  if (!replayed) await wakeCommandJobs(wake, deps.publish);
  return { ...response, replayed };
}

export type CallbackInput = Readonly<
  {
    actor: OutreachActor;
    subject_id: string;
    idempotency_key: string;
    expected_revision: number;
  } & (
    | { operation: "set"; appointment_at: string; replace_active_plan: boolean }
    | { operation: "reschedule"; appointment_at: string }
    | { operation: "cancel" }
  )
>;

/**
 * `PATCH /outreach/:id/callback` — Owner, Manager or the current assigned Rep (P06e, P09b).
 * `set` creates the one active plan (replacing another active plan needs `replace_active_plan`);
 * `reschedule` replaces the active callback; `cancel` ends it. The appointment is a real UTC instant
 * (shown in New York time), not in the past, within a year, on an open eligible Lead, and not inside
 * an active Call restriction (P06f: a restriction always takes precedence).
 */
export async function commandCallback(input: CallbackInput, deps: DeskCommandDeps = {}): Promise<SalesOutreachPlanCommandResponse> {
  const wake: string[] = [];
  const appointment = input.operation === "cancel" ? null : new Date(input.appointment_at);
  const { response, replayed } = await (deps.run ?? executeCsiCommand)<PlanResult>({
    actor: input.actor.actor,
    command: SALES_OUTREACH_COMMAND_KINDS.callback,
    idempotency_key: input.idempotency_key,
    payload: {
      subject_id: input.subject_id,
      operation: input.operation,
      expected_revision: input.expected_revision,
      appointment_at: appointment?.toISOString() ?? null,
      replace_active_plan: input.operation === "set" ? input.replace_active_plan : false,
    },
    operation: async (context) => {
      wake.length = 0;
      const c = await planContext(input.actor, input.subject_id, input.expected_revision, deps, context.session);
      const activeCallback = c.active?.kind === "callback" ? c.active : null;
      if (input.operation !== "set" && !activeCallback)
        throw new OutreachError("INVALID_INPUT", [{ path: "operation", code: "no_active_callback" }]);
      if (input.operation === "set" && c.active && !input.replace_active_plan)
        throw new OutreachError("INVALID_INPUT", [{ path: "replace_active_plan", code: "replacement_intent_required" }]);
      const audit = deps.audit ?? appendCsiAudit;
      if (input.operation === "cancel")
        return applyPlanChange(
          { subject: c.subject, expected_revision: c.revision, active: activeCallback, end: "cancelled", insert: null, event_kind: "sales_outreach_callback_cancelled", actor_role: input.actor.role },
          context,
          c.store,
          audit,
          c.calendar,
          wake,
        );
      const at = appointment!;
      if (+at < +context.now - APPOINTMENT_PAST_TOLERANCE_MS) throw new OutreachError("INVALID_INPUT", [{ path: "appointment_at", code: "appointment_in_past" }]);
      if (+at > +context.now + MAX_APPOINTMENT_DAYS * 86_400_000) throw new OutreachError("INVALID_INPUT", [{ path: "appointment_at", code: "appointment_too_far" }]);
      const restrictions = await c.store.loadRestrictions(c.subject.contact_number_ids, context.session);
      const blocked = restrictions.map(toEngineRestriction).some(
        (r) => r.channels.includes("call") && +new Date(r.effective_at) <= +at && (r.released_at === null || +at < +new Date(r.released_at)),
      );
      if (blocked) throw new OutreachError("INVALID_INPUT", [{ path: "appointment_at", code: "restricted_at_appointment" }]);
      if (activeCallback && +activeCallback.appointment_at! === +at) return unchanged(c.subject, c.revision, activeCallback, c.calendar);
      const window = c.policy.callback.window_minutes;
      return applyPlanChange(
        {
          subject: c.subject,
          expected_revision: c.revision,
          active: c.active,
          end: c.active ? "replaced" : null,
          insert: { period_id: c.period.id, kind: "callback", selected_date: null, appointment_at: at, due_at: new Date(+at + window * 60_000), window_minutes: window },
          event_kind: input.operation === "set" ? "sales_outreach_callback_set" : "sales_outreach_callback_rescheduled",
          actor_role: input.actor.role,
        },
        context,
        c.store,
        audit,
        c.calendar,
        wake,
      );
    },
  });
  if (!replayed) await wakeCommandJobs(wake, deps.publish);
  return { ...response, replayed };
}
