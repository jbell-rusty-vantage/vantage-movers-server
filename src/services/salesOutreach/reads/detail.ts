import mongoose from "mongoose";
import type { SalesOutreachDetailDto } from "../../../validation/v1/salesOutreachReads";
import type { OutreachActor } from "../auth";
import { planRevisionOf } from "../commands/common";
import { OutreachError } from "../errors";
import type { DeskPlanRow, DeskRestrictionRow, StoredContactEvent } from "../evaluation/store";
import type { DeskPeriodRow, DeskSubjectRow } from "../subjects/store";
import { newYorkBusinessDay } from "./businessDay";
import { commonRead, readFreshness, requireDeskConfiguration, type DeskReadDeps } from "./common";
import { mongoDeskQueueStore } from "./deskStore";
import {
  channelDto,
  moveDateReviewOf,
  PENDING_CHANNEL,
  presentRequirements,
  type StoredProjectionDetail,
  type StoredStatusFlags,
} from "./present";
import { deskCadenceOf } from "./queue";
import { mongoSalesOutreachReadStore } from "./store";

/**
 * `GET /outreach/:id` (SRV-8; CONTRACTS "GET /outreach/:id"): one subject's independent Call/SMS
 * requirements, source provenance, policy explanation, plan revision, `assignment_revision` and
 * authorized read-only history.
 *
 * Authorization happens before anything is serialized: Owner and Manager read any subject; a Rep only
 * a subject whose Lead's authoritative `receiver_agent` is its own Agent, re-read for this request (a
 * reassignment revokes immediately). An absent, malformed or foreign id is the same 404 (no existence
 * leak). History is this subject's own evidence (unique opportunity) as metadata, never a shared-number
 * conversation dump. Requirements pass through the exposure rule; only the Owner sees shadow labels.
 */

const CONTACT_EVENTS_SHOWN = 100;
const PLAN_HISTORY_SHOWN = 50;
const ASSIGNMENT_CHANGES_SHOWN = 50;

const iso = (value: Date | null | undefined) => (value ? value.toISOString() : null);
const isoString = (value: unknown) => (typeof value === "string" ? value : value instanceof Date ? value.toISOString() : null);
const record = (value: unknown) => (value && typeof value === "object" ? (value as Record<string, unknown>) : null);

function planDto(plan: DeskPlanRow): SalesOutreachDetailDto["plan"]["history"][number] {
  return {
    plan_id: plan.id,
    kind: plan.kind,
    status: plan.status,
    selected_date: plan.selected_date,
    appointment_at: iso(plan.appointment_at),
    due_at: plan.due_at.toISOString(),
    window_minutes: plan.window_minutes,
    effective_at: plan.effective_at.toISOString(),
    ended_at: iso(plan.ended_at),
    end_reason: plan.end_reason,
    revision: plan.revision,
  };
}

/** The current (open) period, else the latest one. */
function currentPeriod(periods: readonly DeskPeriodRow[]): DeskPeriodRow | null {
  const open = periods.filter((p) => p.ended_at === null);
  const pool = open.length ? open : periods;
  return [...pool].sort((a, b) => +b.started_at - +a.started_at)[0] ?? null;
}

/** Restrictions on the subject's numbers that block at `now` (P06c), oldest first. */
function blockingRestrictions(rows: readonly DeskRestrictionRow[], now: Date): SalesOutreachDetailDto["restrictions"] {
  return rows
    .filter((r) => r.state === "active" && (r.until === null || +r.until > +now))
    .slice(0, 20)
    .map((r) => ({
      channels: [...new Set(r.channels.map((c) => (c === "text" ? ("sms" as const) : ("call" as const))))],
      until: iso(r.until),
      reason: r.reason,
      origin: r.origin,
      confirmed: r.confirmed_at !== null || r.origin === "owner",
    }));
}

type CadenceView = Readonly<{
  state: SalesOutreachDetailDto["policy"]["projection_state"];
  exposure: SalesOutreachDetailDto["policy"]["exposure"];
}>;

function explanationOf(input: {
  subject: DeskSubjectRow;
  projection: StoredProjectionDetail | null;
  view: CadenceView;
  flags: StoredStatusFlags;
  restrictions: SalesOutreachDetailDto["restrictions"];
}): SalesOutreachDetailDto["policy"]["explanation"] {
  const out: SalesOutreachDetailDto["policy"]["explanation"] = [];
  const detail = input.projection?.detail ?? null;
  out.push({ code: "projection_state", value: input.view.state });
  if (input.view.exposure === "shadow") out.push({ code: "cadence_shadow", value: null });
  if (input.projection?.workflow) out.push({ code: "workflow", value: input.projection.workflow });
  if (typeof detail?.state === "string" && detail.state !== "active") out.push({ code: "engine_state", value: detail.state });
  if (typeof detail?.schedule_day === "number") out.push({ code: "schedule_day", value: detail.schedule_day });
  out.push({ code: "priority_basis", value: input.subject.priority.basis });
  if (input.subject.priority.uncertain) out.push({ code: "priority_uncertain", value: null });
  if (input.subject.status === "review") for (const reason of input.subject.review_reasons.slice(0, 5)) out.push({ code: "review", value: reason });
  if (record(detail?.quoted)) out.push({ code: "quoted_date", value: (record(detail?.quoted)?.selected_date as string | null) ?? null });
  if (record(detail?.callback)) out.push({ code: "callback", value: (record(detail?.callback)?.outcome as string | null) ?? null });
  for (const r of input.restrictions) for (const channel of r.channels) out.push({ code: `restriction_${channel}`, value: r.until });
  if (input.flags.move_date_passed) out.push({ code: "move_date_passed", value: input.subject.display.move_date });
  if (input.flags.move_date_unknown) out.push({ code: "move_date_unknown", value: null });
  if (input.flags.job_pending) out.push({ code: "job_number_pending", value: null });
  if (input.flags.advisory_cooldown) out.push({ code: "advisory_cooldown", value: null });
  if (record(detail?.flags)?.inherited_overdue === true && input.view.exposure === "enforcement") out.push({ code: "inherited_overdue", value: null });
  return out.slice(0, 30);
}

function windowHistoryDto(projection: StoredProjectionDetail | null, hideMissed: boolean) {
  const entries = (projection?.window_history ?? []).slice(-30).map((raw) => {
    const e = raw as Record<string, unknown>;
    const channel = (c: unknown) => {
      const v = (c ?? {}) as Record<string, number>;
      return {
        required: v.required ?? 0,
        completed: v.completed ?? 0,
        missed: hideMissed ? null : (v.missed ?? 0),
        waived: v.waived ?? 0,
        superseded: v.superseded ?? 0,
        open: v.open ?? 0,
      };
    };
    return {
      business_date: String(e.business_date),
      schedule_day: typeof e.schedule_day === "number" ? e.schedule_day : null,
      workflow: (e.workflow as SalesOutreachDetailDto["history"]["window_history"][number]["workflow"]) ?? null,
      closed_date: e.closed_date === true,
      call: channel(e.call),
      sms: channel(e.sms),
    };
  });
  const s = projection?.window_history_summary ?? null;
  const summary = s
    ? {
        dates: Number(s.dates ?? 0),
        call_missed: hideMissed ? null : Number(s.call_missed ?? 0),
        sms_missed: hideMissed ? null : Number(s.sms_missed ?? 0),
      }
    : null;
  return { entries, summary };
}

function contactEventDto(event: StoredContactEvent, names: ReadonlyMap<string, string>) {
  return {
    event_id: event.id,
    channel: event.channel,
    direction: event.direction,
    kind: event.kind,
    event_at: event.event_at.toISOString(),
    business_date: newYorkBusinessDay(event.event_at),
    verification: event.verification,
    exclusion_reason: event.exclusion_reason,
    actor_agent_id: event.actor_agent_id,
    actor_agent_name: event.actor_agent_id ? (names.get(event.actor_agent_id) ?? null) : null,
    outbound_goal_credit: event.goal_agent_id !== null && event.verification === "confirmed" && !event.restricted_at_contact,
    restricted_at_contact: event.restricted_at_contact,
  };
}

export async function readOutreachDetail(actor: OutreachActor, subjectId: string, deps: DeskReadDeps): Promise<SalesOutreachDetailDto> {
  const store = deps.queueStore ?? mongoDeskQueueStore;
  const readStore = deps.store ?? mongoSalesOutreachReadStore;
  if (!/^[a-f\d]{24}$/.test(subjectId) || !mongoose.isValidObjectId(subjectId)) throw new OutreachError("NOT_FOUND");
  const configuration = await requireDeskConfiguration(deps.loader);
  const subject = await store.loadSubject(subjectId, null);
  if (!subject) throw new OutreachError("NOT_FOUND");
  const receiver = await store.leadAssignee(subject.lead);
  if (actor.role === "rep" && (!actor.agent_id || receiver !== actor.agent_id)) throw new OutreachError("NOT_FOUND");

  const [projection, periods, plans, restrictionsRaw, changes, events, freshnessRead] = await Promise.all([
    store.loadProjectionDetail(subject.id),
    store.loadPeriods(subject.id, null),
    store.loadPlans(subject.id, null),
    store.loadRestrictions(subject.contact_number_ids, null),
    store.loadAssignmentChanges(subject.lead, null),
    store.loadContactEvents(subject.id, null),
    readFreshness(readStore, configuration, deps.now),
  ]);

  const cadence = deskCadenceOf(configuration);
  const view: CadenceView =
    "unavailable" in cadence
      ? { state: cadence.unavailable, exposure: null }
      : !projection
        ? { state: "pending", exposure: cadence.exposure }
        : { state: projection.policy_fingerprint === cadence.snapshot ? "current" : "stale_policy", exposure: cadence.exposure };
  const shown = view.state === "current" || view.state === "stale_policy" ? projection : null;
  const today = newYorkBusinessDay(deps.now);
  const moveReview = moveDateReviewOf(subject.display.move_date, today);
  const presented = shown && view.exposure ? presentRequirements(shown, deps.now, today, view.exposure) : null;
  const flags: StoredStatusFlags = presented?.status_flags ?? {
    needs_contact: false,
    overdue: false,
    blocked: false,
    pending: true,
    move_date_passed: moveReview === "passed",
    move_date_unknown: moveReview === "unknown",
    job_pending: !subject.display.job_no,
    advisory_cooldown: false,
  };
  const ownerShadow = actor.role === "owner" && shown?.exposure === "shadow";
  const hideMissed = shown?.exposure === "shadow" && actor.role !== "owner";
  const history = windowHistoryDto(shown, hideMissed);
  const restrictions = blockingRestrictions(restrictionsRaw, deps.now);

  const sortedEvents = [...events].sort((a, b) => +b.event_at - +a.event_at);
  const sortedChanges = [...changes].sort((a, b) => +b.applied_at - +a.applied_at).slice(0, ASSIGNMENT_CHANGES_SHOWN);
  const agentIds = new Set<string>();
  if (subject.assigned_agent_id) agentIds.add(subject.assigned_agent_id);
  if (receiver) agentIds.add(receiver);
  for (const e of sortedEvents.slice(0, CONTACT_EVENTS_SHOWN)) if (e.actor_agent_id) agentIds.add(e.actor_agent_id);
  const names = await readStore.findReviewedRepNames([...agentIds], deps.now);

  const activePlan = plans.find((p) => p.status === "active") ?? null;
  const planHistory = plans
    .filter((p) => p.status !== "active")
    .sort((a, b) => +(b.ended_at ?? b.effective_at) - +(a.ended_at ?? a.effective_at))
    .slice(0, PLAN_HISTORY_SHOWN);
  const period = currentPeriod(periods);
  const detail = shown?.detail ?? null;
  const catchUp = record(detail?.catch_up);
  const blockedUntil = record(detail?.blocked_until);
  const cooldown = record(detail?.cooldown);
  const quoted = record(detail?.quoted);
  const callback = record(detail?.callback);
  const initial = record(detail?.initial_response);
  const catchUpDto = (c: unknown) => {
    const v = record(c) ?? {};
    return { outstanding: v.outstanding === true, missed_count: Number(v.missed_count ?? 0), state: typeof v.state === "string" ? v.state : null };
  };

  return {
    ...commonRead(actor, deps.now, actor.role === "rep" ? actor.agent_id : null, configuration, shown?.publication_revision ?? null, freshnessRead.freshness),
    subject: {
      subject_id: subject.id,
      lead_model: subject.lead.model,
      status: subject.status,
      review_reasons: subject.review_reasons.slice(0, 50),
      received_at: iso(subject.received_at),
      received_date: subject.received_date,
      received_quality: subject.received_quality,
      enrollment: {
        cohort_id: subject.enrollment.cohort_id,
        kind: subject.enrollment.kind,
        enrolled_at: subject.enrollment.enrolled_at.toISOString(),
        activation_at: subject.enrollment.activation_at.toISOString(),
      },
      job_no: subject.display.job_no,
      job_pending: !subject.display.job_no,
      phone: subject.display.phone,
      name: subject.display.name,
      move_date: subject.display.move_date,
      move_date_review: moveReview,
    },
    priority: {
      raw: subject.priority.raw,
      basis: subject.priority.basis,
      accepted_at: iso(subject.priority.accepted_at),
      uncertain: subject.priority.uncertain,
    },
    assignment: {
      assigned_agent_id: subject.assigned_agent_id,
      assigned_agent_name: subject.assigned_agent_id ? (names.get(subject.assigned_agent_id) ?? null) : null,
      unassigned: subject.assigned_agent_id === null,
      assignment_revision: subject.assignment_revision,
      lead_receiver_agent_id: receiver ?? null,
      // The desk copy holds the receiver only when it has a reviewed sales_rep link (else Unassigned).
      in_sync: receiver !== undefined && subject.assigned_agent_id === (receiver && names.has(receiver) ? receiver : null),
    },
    plan: {
      plan_revision: planRevisionOf(plans),
      active: activePlan ? planDto(activePlan) : null,
      history: planHistory.map(planDto),
    },
    policy: {
      projection_state: view.state,
      exposure: view.exposure,
      enforcement_labels: presented?.enforcement_labels ?? false,
      workflow: (shown?.workflow as SalesOutreachDetailDto["policy"]["workflow"]) ?? period?.workflow ?? null,
      engine_state: typeof detail?.state === "string" ? detail.state : null,
      policy_version: typeof detail?.policy_version === "string" ? detail.policy_version : null,
      configuration_version: shown?.configuration_version ?? null,
      schedule_day: typeof detail?.schedule_day === "number" ? detail.schedule_day : null,
      period: period
        ? { period_id: period.id, workflow: period.workflow, start_kind: period.start_kind, priority: period.priority, started_at: period.started_at.toISOString() }
        : null,
      quoted: quoted
        ? {
            selected_date: (quoted.selected_date as string | null) ?? null,
            first_required_date: (quoted.first_required_date as string | null) ?? null,
            basis: String(quoted.basis ?? "unknown"),
            plan_id: (quoted.plan_id as string | null) ?? null,
          }
        : null,
      callback:
        callback && isoString(callback.appointment_at) && isoString(callback.due_at)
          ? {
              plan_id: String(callback.plan_id),
              appointment_at: isoString(callback.appointment_at)!,
              due_at: isoString(callback.due_at)!,
              outcome: String(callback.outcome),
              fulfilled_by_event_id: (callback.fulfilled_by_event_id as string | null) ?? null,
            }
          : null,
      initial_response: initial
        ? { due_at: isoString(initial.due_at), outcome: String(initial.outcome), fulfilled_at: isoString(initial.fulfilled_at) }
        : null,
      advisory_cooldown: {
        warning: cooldown?.warning === true,
        unsuccessful_attempts: Array.isArray(cooldown?.unsuccessful_attempts) ? cooldown.unsuccessful_attempts.length : 0,
      },
      catch_up: catchUp ? { call: catchUpDto(catchUp.call), sms: catchUpDto(catchUp.sms) } : null,
      blocked_until: { call: isoString(blockedUntil?.call), sms: isoString(blockedUntil?.sms) },
      explanation: explanationOf({ subject, projection: shown, view, flags, restrictions }),
    },
    requirements: {
      call: channelDto(presented?.call ?? PENDING_CHANNEL),
      sms: channelDto(presented?.sms ?? PENDING_CHANNEL),
    },
    status_flags: flags,
    oldest_actionable_due_at: iso(presented?.oldest_actionable_due_at ?? null),
    next_action_due_at: iso(shown?.next_action_due_at ?? null),
    last_interaction_at: iso(shown?.last_interaction_at ?? null),
    shadow_labels: ownerShadow && presented ? presented.unmasked : null,
    history: {
      window_history: history.entries,
      window_summary: history.summary,
      missed_labels_hidden: hideMissed,
      contact_events: sortedEvents.slice(0, CONTACT_EVENTS_SHOWN).map((e) => contactEventDto(e, names)),
      contact_events_truncated: sortedEvents.length > CONTACT_EVENTS_SHOWN,
      assignment_changes: sortedChanges.map((c) => ({ applied_at: c.applied_at.toISOString(), from_agent_id: c.before, to_agent_id: c.after })),
    },
    restrictions,
    computed_as_of: iso(shown?.computed_as_of ?? null),
    publication_revision: shown?.publication_revision ?? null,
  };
}
