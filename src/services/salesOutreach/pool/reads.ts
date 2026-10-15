import mongoose from "mongoose";
import { getSalesOutreachPoolWorkModel, getSalesOutreachPoolDutyModel, getSalesOutreachContactEventModel } from "../../../models/salesOutreach";
import type { SalesOutreachPoolDto, SalesOutreachQueueDto } from "../../../validation/v1/salesOutreachReads";
import type { ActiveConfiguration } from "../config/load";
import { inspectPoolCandidate, inspectPoolCandidates } from "./admission";
import { poolDutyWindow, poolEnabled, poolValueForDay } from "./policy";
import { newYorkBusinessDay, newYorkDayBounds } from "../reads/businessDay";
import { mongoEvaluationStore } from "../evaluation/store";
import type { OutreachActor } from "../auth";
import { QUEUE_KEY_FAR_FUTURE, QUEUE_KEY_EPOCH, foldName } from "../evaluation/projection";
import type { QueueMatch } from "../reads/queueQuery";
import { leadPhoneE164 } from "../../numberActivity/leadContactNumber";

const oid = (id: string) => new mongoose.Types.ObjectId(id);
export type PoolAccess = NonNullable<Awaited<ReturnType<typeof getPoolAccess>>>;

/** Fresh canonical revalidation precedes all shared filtering, counts, cursors, detail and history. */
export async function getPoolAccess(subjectId: string, configuration: ActiveConfiguration) {
  if (!poolEnabled(configuration.value)) return null;
  const work = await getSalesOutreachPoolWorkModel().findOne({ subject_id: oid(subjectId), active: true }).lean();
  if (!work) return null;
  const candidate = await inspectPoolCandidate({ model: work.lead_model, id: String(work.lead_id) });
  return candidate.eligible ? { work, candidate } : null;
}

export async function authorizedPoolWorks(configuration: ActiveConfiguration): Promise<PoolAccess[]> {
  if (!poolEnabled(configuration.value)) return [];
  const works = await getSalesOutreachPoolWorkModel().find({ active: true }).sort({ subject_id: 1 }).lean();
  const result: PoolAccess[] = [];
  for (let offset = 0; offset < works.length; offset += 1000) {
    const page = works.slice(offset, offset + 1000);
    const candidates = await inspectPoolCandidates(page.map((w) => ({ model: w.lead_model, id: String(w.lead_id) })));
    for (let i = 0; i < page.length; i++) if (candidates[i]?.eligible) result.push({ work: page[i]!, candidate: candidates[i]! });
  }
  return result;
}

/** Never materializes a duty on a GET. A request batches all duties/restrictions before presentation. */
export async function readPoolStates(accesses: readonly PoolAccess[], configuration: ActiveConfiguration, now: Date, coverage: Date | null,
  names: ReadonlyMap<string, string> = new Map()): Promise<Map<string, SalesOutreachPoolDto>> {
  const result = new Map<string, SalesOutreachPoolDto>();
  if (!accesses.length) return result;
  const date = newYorkBusinessDay(now);
  const numberIds = [...new Set(accesses.flatMap((a) => a.candidate.subject?.contact_number_ids ?? []))];
  const [duties, restrictions] = await Promise.all([
    getSalesOutreachPoolDutyModel().find({ subject_id: { $in: accesses.map((a) => a.work.subject_id) }, business_date: date }).lean(),
    mongoEvaluationStore.loadRestrictions(numberIds, null),
  ]);
  const dutyBySubject = new Map(duties.map((duty) => [String(duty.subject_id), duty]));
  for (const access of accesses) {
    const duty = dutyBySubject.get(String(access.work.subject_id));
    const ownRestrictions = restrictions.filter((r) => (access.candidate.subject?.contact_number_ids ?? []).includes(r.contact_number_id));
    const window = poolDutyWindow(access.work.episodes, date, poolValueForDay(configuration.value, date, duty?.calendar_snapshot), ownRestrictions);
    const blocked = ownRestrictions.some((r) => r.state === "active" && r.channels.includes("call") && (!r.until || +r.until > +now));
    const facts = access.candidate.facts!;
    const noContact = !leadPhoneE164(facts.ref.model, { normalized_phone_number: facts.normalized_phone, original_caller_phone: facts.original_caller_phone,
      ingested_phone: facts.ingested_phone, granot_phone: facts.granot_phone }) && !(access.candidate.subject?.contact_number_ids.length);
    const completed = duty?.state === "completed";
    const caller = duty?.completed_by_agent_id ? String(duty.completed_by_agent_id) : null;
    const state: SalesOutreachPoolDto["state"] = completed ? "completed" : blocked || noContact ? "blocked"
      : !window.required ? (window.waived ? "waived" : "scheduled")
      : duty?.pending_evidence || (+now > window.due && (!coverage || +coverage < window.due)) ? "coverage_pending" : +now < window.start ? "scheduled" : "due";
    result.set(String(access.work.subject_id), { business_date: date, state, due_at: window.required || duty ? new Date(window.due).toISOString() : null,
      completed_at: completed && duty?.completed_at ? duty.completed_at.toISOString() : null,
      completed_by_agent_id: completed ? caller : null, completed_by_agent_name: completed && caller ? names.get(caller) ?? null : null,
      completion_event_id: completed && duty?.completion_event_id ? String(duty.completion_event_id) : null });
  }
  return result;
}

export async function readPoolState(access: PoolAccess, configuration: ActiveConfiguration, now: Date, coverage: Date | null,
  names: ReadonlyMap<string, string> = new Map()): Promise<SalesOutreachPoolDto> {
  return (await readPoolStates([access], configuration, now, coverage, names)).get(String(access.work.subject_id))!;
}

/** Queue rows use fresh shared states, including completion before evaluator delivery and NY rollover. */
export function poolQueueOverrides(works: readonly PoolAccess[], states: ReadonlyMap<string, SalesOutreachPoolDto>, now: Date): NonNullable<QueueMatch["pool_overrides"]> {
  return works.map((access) => {
    const id = String(access.work.subject_id), state = states.get(id)!, facts = access.candidate.facts!, subject = access.candidate.subject;
    const completed = state.state === "completed", required = !["scheduled", "waived"].includes(state.state);
    const due = state.due_at ? new Date(state.due_at) : null, actionable = state.state === "due" || state.state === "coverage_pending";
    const blocked = state.state === "blocked", pending = state.state === "coverage_pending";
    const call = { required: required ? 1 : 0, verified_completed: completed ? 1 : 0, remaining: required && !completed ? 1 : 0,
      due_at: due, oldest_actionable_due_at: null, status: completed ? "completed" : blocked ? "blocked" : state.state === "scheduled" ? "scheduled" : state.state === "waived" ? "not_required" : "due",
      completion_kind: completed ? "fulfilled_in_window" : null, coverage: null, blocked_reason: blocked ? "contact_restriction" : null };
    return { subject_id: id, fields: { assigned_agent_id: facts.receiver_agent_id ? oid(facts.receiver_agent_id) : null,
      subject_status: "active", priority_raw: "9", workflow: "none", call,
      sms: { required: 0, verified_completed: 0, remaining: 0, due_at: null, oldest_actionable_due_at: null, status: "not_required", completion_kind: null, coverage: null, blocked_reason: null },
      status_flags: { needs_contact: actionable, overdue: false, blocked, pending, move_date_passed: Boolean(facts.move_date && facts.move_date < newYorkBusinessDay(now)),
        move_date_unknown: !facts.move_date, job_pending: !facts.job_no, advisory_cooldown: false },
      display: { job_no: facts.job_no, normalized_job_no: facts.normalized_job_no, phone: facts.phone, normalized_phone: facts.normalized_phone, name: facts.name, name_folded: foldName(facts.name), move_date: facts.move_date },
      queue_keys: { urgency_due: actionable && due ? due : QUEUE_KEY_FAR_FUTURE, urgency_next: actionable && due ? due : QUEUE_KEY_FAR_FUTURE,
        call_due: actionable && due ? due : QUEUE_KEY_FAR_FUTURE, sms_due: QUEUE_KEY_FAR_FUTURE,
        received_asc: subject?.received_at ?? QUEUE_KEY_FAR_FUTURE, received_desc: subject?.received_at ?? QUEUE_KEY_EPOCH,
        last_interaction: state.completed_at ? new Date(state.completed_at) : QUEUE_KEY_EPOCH },
      oldest_actionable_due_at: null, next_action_due_at: actionable ? due : null,
    } };
  });
}

export async function readPoolSummary(works: readonly PoolAccess[], configuration: ActiveConfiguration, now: Date, coverage: Date | null,
  actor: OutreachActor, agentFilter: string | null, states?: ReadonlyMap<string, SalesOutreachPoolDto>): Promise<NonNullable<SalesOutreachQueueDto["pool_summary"]>> {
  const agent = actor.role === "rep" ? actor.agent_id : agentFilter;
  const currentStates = states ?? await readPoolStates(works, configuration, now, coverage);
  let team_due = 0, team_completed = 0, assigned_due = 0, assigned_completed = 0;
  for (const work of works) {
    const state = currentStates.get(String(work.work.subject_id))!;
    const completed = state.state === "completed";
    const due = state.state === "due" || state.state === "coverage_pending" || state.state === "blocked";
    team_due += Number(due); team_completed += Number(completed);
    if (agent && work.candidate.facts?.receiver_agent_id === agent) { assigned_due += Number(due); assigned_completed += Number(completed); }
  }
  const date = newYorkBusinessDay(now), bounds = newYorkDayBounds(date);
  // Separate actual-caller breakdown. The canonical event/goal row remains the sole goal authority.
  const history = configuration.value.pool?.enabled ? await getSalesOutreachPoolWorkModel().find({}).lean() : [];
  const intervals = history.flatMap((w) => w.episodes.filter((e) => +e.started_at < +bounds.end && (!e.ended_at || +e.ended_at > +bounds.start)).map((e) => ({
    subject_id: w.subject_id, event_at: { $gte: new Date(Math.max(+e.started_at, +bounds.start)), $lt: new Date(Math.min(+(e.ended_at ?? bounds.end), +bounds.end)) },
  })));
  const actual_outbound = intervals.length ? await getSalesOutreachContactEventModel().countDocuments({ $or: intervals,
    channel: "call", kind: "outbound_attempt", verification: "confirmed", restricted_at_contact: false,
    "pool_caller_eligibility.eligible": true,
    goal_agent_id: agent ? oid(agent) : { $ne: null } }) : 0;
  return { team_due, team_completed, assigned_due, assigned_completed, actual_outbound };
}
