import mongoose, { type ClientSession } from "mongoose";
import { getSalesOutreachContactEventModel, getSalesOutreachPoolDutyModel, getSalesOutreachPoolWorkModel } from "../../../models/salesOutreach";
import type { ActiveConfiguration } from "../config/load";
import { OutreachError } from "../errors";
import { newYorkDayBounds, newYorkBusinessDay } from "../reads/businessDay";
import { poolDay, poolDutyWindow, poolEnabled, poolValueForDay, poolWinner, type PoolEvent } from "./policy";
import { poolInvalidation } from "./admission";
import { findDeskRepsAt } from "../roster/store";
import { mongoEvaluationStore } from "../evaluation/store";
import { Agent } from "../../../models/Agent";
import { mongoDeskSubjectStore } from "../subjects/store";
import { evaluateDeskEligibility } from "../subjects/eligibility";

const oid = (id: string) => new mongoose.Types.ObjectId(id);

/**
 * Runs in the source-event transaction. The shared work write serializes distinct concurrent calls;
 * the unique Lead/date/kind index serializes first materialization. Driver transaction retries then
 * see all committed events. Recount selects earliest event time + canonical event id, not arrival order.
 */
export async function recomputePoolDuty(subjectId: string, date: string, configuration: ActiveConfiguration, now: Date, session: ClientSession) {
  const Work = getSalesOutreachPoolWorkModel();
  const work = await Work.findOne({ subject_id: oid(subjectId) }).session(session).lean();
  if (!work) return null;
  const subject = await mongoEvaluationStore.loadSubject(subjectId, session);
  const restrictions = await mongoEvaluationStore.loadRestrictions(subject?.contact_number_ids ?? [], session);
  const Duties = getSalesOutreachPoolDutyModel();
  const key = { lead_model: work.lead_model, lead_id: work.lead_id, business_date: date, kind: "pool_call" as const };
  const previous = await Duties.findOne(key).session(session).lean();
  if (!poolEnabled(configuration.value) && !previous) return null;
  if (!previous && date !== newYorkBusinessDay(now)) return null;
  const value = poolValueForDay(configuration.value, date, previous?.calendar_snapshot);
  const window = poolDutyWindow(work.episodes, date, value, restrictions);
  const [lead] = await mongoDeskSubjectStore.loadLeads([{ model: work.lead_model, id: String(work.lead_id) }], session);
  const eligible = lead ? evaluateDeskEligibility({ kind: "lead", facts: lead }).outcome === "eligible" : false;
  const closedPeriods = subject?.status === "closed" ? await mongoEvaluationStore.loadPeriods(subjectId, session) : [];
  const closure = closedPeriods.find((p) => p.workflow === "closed")?.started_at ?? (!eligible ? lead?.last_changed_at ?? now : null);
  if (closure && +closure <= window.start && !previous) return null;
  if (!window.required && !window.waived && !previous) return null;
  const lock = await Work.updateOne({ _id: work._id, revision: work.revision }, { $inc: { revision: 1 } }, { session });
  if (lock.matchedCount !== 1) throw new OutreachError("REVISION_CONFLICT");
  const bounds = newYorkDayBounds(date);
  const rows = await getSalesOutreachContactEventModel().find({ subject_id: oid(subjectId), channel: "call", event_at: { $gte: bounds.start, $lt: bounds.end } }).session(session).lean();
  const events: PoolEvent[] = [];
  let pending_evidence = false;
  for (const e of rows) {
    if (!e.actor_agent_id || e.verification !== "confirmed") continue;
    if (closure && +e.event_at >= +closure) continue;
    const firstEntry = work.episodes[0]?.started_at;
    const withinEpisode = work.episodes.some((episode) => +episode.started_at <= +e.event_at && (!episode.ended_at || +episode.ended_at > +e.event_at))
      || Boolean(firstEntry && +e.event_at < +firstEntry && newYorkBusinessDay(firstEntry) === date);
    if (!withinEpisode) continue;
    const caller = String(e.actor_agent_id), snapshot = e.pool_caller_eligibility;
    const snapshotCurrent = snapshot && String(snapshot.agent_id) === caller && +snapshot.event_at === +e.event_at;
    const agent = snapshotCurrent ? null : await Agent.findById(caller, { updatedAt: 1 }).session(session).lean();
    const uncertain = snapshotCurrent ? snapshot.reason === "membership_changed_after_contact" : Boolean(agent?.updatedAt && +agent.updatedAt > +e.event_at);
    const eligible = snapshotCurrent ? snapshot.eligible : !uncertain && (await findDeskRepsAt(e.event_at, session, [caller])).length === 1;
    if (uncertain) pending_evidence = true;
    if (!snapshotCurrent) await getSalesOutreachContactEventModel().updateOne({ _id: e._id, revision: e.revision },
      { $set: { pool_caller_eligibility: { agent_id: e.actor_agent_id, event_at: e.event_at, eligible, checked_at: now, reason: uncertain ? "membership_changed_after_contact" : eligible ? null : "caller_not_desk_eligible" } } }, { session });
    if (!eligible) continue;
    events.push({ id: String(e._id), event_at: e.event_at, channel: e.channel, kind: e.kind,
      verification: e.verification, actor_agent_id: caller, restricted_at_contact: e.restricted_at_contact, association: e.association, association_reason: e.association_reason });
  }
  const winner = poolWinner(events.filter((event) => window.restriction_start === null || +event.event_at < window.restriction_start), date, value);
  const fields = { state: winner ? "completed" as const : window.waived ? "waived" as const : "open" as const, completion_event_id: winner ? oid(winner.id) : null,
    completed_at: winner?.event_at ?? null, completed_by_agent_id: winner?.actor_agent_id ? oid(winner.actor_agent_id) : null, pending_evidence: !winner && pending_evidence };
  if (!previous) {
    const day = poolDay(date, value);
    await Duties.create([{ ...key, subject_id: oid(subjectId), due_at: new Date(window.due), policy_version: work.policy_version,
      calendar_snapshot: { open_minute: day.open, close_minute: day.close, closed_date: day.closed }, ...fields, revision: 1 }], { session });
    await poolInvalidation(session, now);
  } else if (String(previous.completion_event_id ?? "") !== String(fields.completion_event_id ?? "") || previous.state !== fields.state
    || String(previous.completed_by_agent_id ?? "") !== String(fields.completed_by_agent_id ?? "")
    || +(previous.completed_at ?? 0) !== +(fields.completed_at ?? 0) || +previous.due_at !== window.due || previous.pending_evidence !== fields.pending_evidence) {
    const result = await Duties.updateOne({ _id: previous._id, revision: previous.revision }, { $set: { ...fields, due_at: new Date(window.due) }, $inc: { revision: 1 },
      $push: { corrections: { changed_at: now, event_id: previous.completion_event_id, caller_id: previous.completed_by_agent_id, event_at: previous.completed_at } } }, { session });
    if (result.matchedCount !== 1) throw new OutreachError("REVISION_CONFLICT");
    await poolInvalidation(session, now);
  }
  return { work, window, winner, pending_evidence: fields.pending_evidence };
}
