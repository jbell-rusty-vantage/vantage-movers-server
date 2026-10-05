import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { FINAL_01_CADENCE_VALUE } from "./approvedStartingValues";
import { addDays } from "./calendar";
import {
  classifyCallEvidence,
  classifySmsEvidence,
  goalCreditAgent,
  goalCreditsByAgent,
  repDayGoal,
  summarizeTeamGoals,
  type CallEvidenceFacts,
  type ClassifiedEvidence,
  type SmsEvidenceFacts,
} from "./credit";
import { resolveEnginePolicy } from "./policy";
import { evaluate, fixture, inbound, ny, nyMinute, obligationsOn, outbound, period, restriction, scenario, sms, TZ, type FixtureFile } from "./testSupport";
import type { EngineContactEvent, EvaluateSubjectResult } from "./types";

type Case = Record<string, unknown> & { id: string };
const R = "2026-10-01";
const DAY4 = addDays(R, 3);
let n = 0;

function toEvent(c: ClassifiedEvidence, at: string, channel: "call" | "sms", direction: "outbound" | "inbound", id = `e${++n}`): EngineContactEvent {
  return {
    event_id: `${channel}:${id}`,
    source_kind: channel,
    source_id: id,
    channel,
    direction,
    event_at: at,
    kind: c.kind,
    verification: c.verification,
    exclusion_reason: c.exclusion_reason,
    actor_agent_id: c.actor_agent_id,
    goal_agent_id: c.goal_agent_id,
    outcome: "unknown",
    restricted_at_contact: false,
  };
}

/** New subject on Day 4 (two slots, earlier misses → call and SMS catch-up outstanding). */
function day4(events: EngineContactEvent[], asOfMinute = 700, assignments?: Parameters<typeof scenario>[0]["assignments"]): EvaluateSubjectResult {
  return evaluate(scenario({ periods: [period("n1", "new", nyMinute(R, 420), "intake")], events, assignments }), nyMinute(DAY4, asOfMinute));
}

const OUT: CallEvidenceFacts = { direction: "outbound", duplicate: false, internal: false, actual_attempt: true, terminal: true, in_call_log: true, initiator: { agent_id: "alice", identity: "reviewed" }, handler: null, association: "unique" };
const IN: CallEvidenceFacts = { ...OUT, direction: "inbound", initiator: { agent_id: null, identity: "none" }, handler: { agent_id: "alice", identity: "reviewed" } };

describe("P07a call credit (fixture p07a-call-credit.json)", () => {
  const fx = fixture<FixtureFile<Case>>("p07a-call-credit.json");
  const facts: Record<string, CallEvidenceFacts> = {
    outbound_answered: OUT,
    outbound_no_answer: OUT,
    outbound_busy: OUT,
    outbound_voicemail: OUT,
    verified_failed_connection: OUT,
    too_close_outbound: OUT,
    answered_inbound: IN,
    missed_inbound: { ...IN, handler: null },
    api_error_without_attempt: { ...OUT, actual_attempt: false },
    button_press_only: { ...OUT, actual_attempt: false },
    duplicate_receipt: { ...OUT, duplicate: true },
    internal_call: { ...OUT, internal: true },
    in_progress: { ...OUT, terminal: false },
  };
  for (const c of fx.cases) {
    test(c.id, () => {
      const f = facts[c.id]!;
      const ev = toEvent(classifyCallEvidence(f), nyMinute(DAY4, 600), "call", f.direction);
      const events = c.id === "too_close_outbound" ? [outbound(nyMinute(DAY4, 570)), ev] : [ev];
      const r = day4(events, 610);
      const cadence = r.obligations.some((o) => o.fulfilled_by_event_id === ev.event_id) ? 1 : 0;
      assert.equal(cadence, c.cadence_credit, "cadence credit");
      assert.equal(goalCreditAgent(ev) ? 1 : 0, c.goal_credit, "goal credit");
      if (c.id === "answered_inbound") {
        assert.equal(r.requirements.call.catch_up.outstanding === false, c.clears_call_catchup);
        assert.equal(r.requirements.call.required, c.ordinary_calls_today);
        assert.equal(r.requirements.call.remaining, c.ordinary_calls_remaining);
        assert.equal(r.requirements.sms.catch_up.outstanding === false, c.clears_sms_catchup);
      }
    });
  }
});

describe("P07b outbound attribution (fixture p07b-outbound-attribution.json)", () => {
  const fx = fixture<FixtureFile<Case>>("p07b-outbound-attribution.json");
  const assignments = [{ agent_id: "alice", from: "2000-01-01T00:00:00Z", to: null }];
  for (const c of fx.cases) {
    test(c.id, () => {
      const initiator = (c.initiating_rep as string | undefined) ?? "alice";
      let f: CallEvidenceFacts = { ...OUT, initiator: { agent_id: initiator, identity: "reviewed" } };
      if (c.id === "ambiguous_identity") f = { ...OUT, initiator: { agent_id: null, identity: "ambiguous" } };
      if (c.id === "ambiguous_lead") f = { ...OUT, association: "ambiguous" };
      const ev = toEvent(classifyCallEvidence(f), nyMinute(DAY4, 600), "call", "outbound", `x-${c.id}`);
      // Transfers and duplicate legs reach the engine as the same canonical event identity.
      const events = c.id === "duplicate_transfer_legs" ? [ev, { ...ev }] : [ev];
      const r = day4(events, 610, assignments);
      assert.equal(r.obligations.filter((o) => o.fulfilled_by_event_id === ev.event_id).length > 0 ? 1 : 0, c.eligible_cadence_credit);
      assert.deepEqual(Object.fromEntries([...goalCreditsByAgent(events, DAY4, TZ)].filter(([, v]) => v > 0)), Object.fromEntries(Object.entries(c.goal_credits as Record<string, number>).filter(([, v]) => v > 0)));
      if (c.clears_call_catchup !== undefined) assert.equal(r.requirements.call.catch_up.outstanding === false, c.clears_call_catchup);
      if (c.pending_verification) assert.notEqual(ev.verification, "confirmed");
      assert.equal(r.current_assignee_agent_id, "alice", "assignment unchanged");
    });
  }
});

describe("P07c inbound helping (fixture p07c-inbound-helping.json)", () => {
  const fx = fixture<FixtureFile<Case>>("p07c-inbound-helping.json");
  for (const c of fx.cases) {
    test(c.id, () => {
      const handlers = (c.handling_reps as string[] | undefined) ?? ["bob"];
      let f: CallEvidenceFacts = { ...IN, handler: { agent_id: handlers[0]!, identity: "reviewed" } };
      if (c.id === "missed_inbound") f = { ...IN, handler: null };
      if (c.id === "ambiguous_rep") f = { ...IN, handler: { agent_id: null, identity: "ambiguous" } };
      if (c.id === "ambiguous_lead") f = { ...IN, association: "ambiguous" };
      const ev = toEvent(classifyCallEvidence(f), nyMinute(DAY4, 600), "call", "inbound", `i-${c.id}`);
      const events = c.id === "duplicate_inbound_legs" ? [ev, { ...ev }] : [ev];
      const r = day4(events, 610);
      assert.equal(r.obligations.filter((o) => o.fulfilled_by_event_id === ev.event_id).length > 0 ? 1 : 0, c.applicable_cadence_credit);
      assert.equal(goalCreditsByAgent(events, DAY4, TZ).size, 0, "zero outbound-goal credit");
      if (c.call_catchup_cleared !== undefined) assert.equal(r.requirements.call.catch_up.outstanding === false, c.call_catchup_cleared);
      if (c.sms_catchup_cleared !== undefined) assert.equal(r.requirements.sms.catch_up.outstanding === false, c.sms_catchup_cleared);
      if (c.ordinary_calls_remaining !== undefined) {
        assert.equal(r.requirements.call.required, c.ordinary_calls_today);
        assert.equal(r.requirements.call.remaining, c.ordinary_calls_remaining);
      }
    });
  }
});

const SMS_OUT: SmsEvidenceFacts = { direction: "outbound", status: "sent", origin: "rep_deliberate", sender: { agent_id: "alice", identity: "reviewed" }, association: "unique" };
/** Day 2 SMS requirement (fixed day, due 20:00). */
function smsDay2(events: EngineContactEvent[], asOfMinute = 900) {
  const d2 = addDays(R, 1);
  return { r: evaluate(scenario({ periods: [period("n1", "new", nyMinute(R, 420), "intake")], events: [sms(nyMinute(R, 600)), ...events] }), nyMinute(d2, asOfMinute)), d2 };
}

describe("P07d SMS status and corrections (fixture p07d-sms-status-corrections.json)", () => {
  const fx = fixture<FixtureFile<Case>>("p07d-sms-status-corrections.json");
  const statusFor: Record<string, SmsEvidenceFacts["status"]> = { sent_delivery_unknown: "sent", delivered: "delivered", sent_then_delivered: "delivered", queued: "queued", pending: "pending", send_failure: "send_failed", api_accepted_only: "api_accepted", sent_later_failed: "delivery_failed" };
  for (const c of fx.cases) {
    test(c.id, () => {
      const d2 = addDays(R, 1);
      if (c.id === "failed_with_successful_replacement") {
        const failed = toEvent(classifySmsEvidence({ ...SMS_OUT, status: "delivery_failed" }), nyMinute(d2, 600), "sms", "outbound");
        const replacement = toEvent(classifySmsEvidence(SMS_OUT), nyMinute(d2, 660), "sms", "outbound");
        const { r } = smsDay2([failed, replacement]);
        assert.equal(obligationsOn(r, d2, "sms")[0]!.fulfilled_by_event_id, replacement.event_id);
        assert.equal(r.requirements.sms.remaining, c.requirement_remaining);
        return;
      }
      const ev = toEvent(classifySmsEvidence({ ...SMS_OUT, status: statusFor[c.id]! }), nyMinute(d2, 600), "sms", "outbound");
      const { r } = smsDay2([ev]);
      const credit = obligationsOn(r, d2, "sms")[0]!.fulfilled_by_event_id === ev.event_id ? 1 : 0;
      assert.equal(credit, c.expected_credit);
      if (c.id === "sent_later_failed") {
        const before = smsDay2([{ ...ev, kind: "sms_sent", verification: "confirmed" }]).r;
        assert.equal(obligationsOn(before, d2, "sms")[0]!.fulfilled_by_event_id === ev.event_id ? 1 : 0, c.previous_credit);
        assert.equal(r.requirements.sms.remaining, c.requirement_remaining);
        const nextDay = smsDay2([ev], 1440 + 600).r;
        assert.equal(nextDay.requirements.sms.catch_up.outstanding, c.recompute_sms_catchup, "bounded SMS catch-up recomputed");
      }
      assert.equal(goalCreditAgent(ev), null, "outbound goal unchanged");
      assert.equal(r.requirements.call.required, 2, "calls unchanged");
    });
  }
});

describe("P07e SMS sender/origin (fixture p07e-sms-sender-origin.json)", () => {
  const fx = fixture<FixtureFile<Case> & { all_outbound_goal_credits: number }>("p07e-sms-sender-origin.json");
  const factsFor: Record<string, SmsEvidenceFacts> = {
    typed_assigned_rep: SMS_OUT,
    typed_helping_rep: { ...SMS_OUT, sender: { agent_id: "bob", identity: "reviewed" } },
    manually_sent_template: { ...SMS_OUT, status: "delivered" },
    automatic_confirmation: { ...SMS_OUT, origin: "automatic_confirmation" },
    unattended_automation: { ...SMS_OUT, origin: "automation" },
    inbound_reply: { ...SMS_OUT, direction: "inbound" },
    ambiguous_shared_sender: { ...SMS_OUT, sender: { agent_id: null, identity: "ambiguous" } },
  };
  for (const c of fx.cases) {
    test(c.id, () => {
      const classified = classifySmsEvidence(factsFor[c.id]!);
      const d2 = addDays(R, 1);
      const ev = toEvent(classified, nyMinute(d2, 600), "sms", factsFor[c.id]!.direction);
      const { r } = smsDay2([ev]);
      assert.equal(obligationsOn(r, d2, "sms")[0]!.fulfilled_by_event_id === ev.event_id ? 1 : 0, c.expected_sms_credit);
      if (c.pending_verification) assert.equal(classified.verification, "pending_identity");
      if (c.clears_sms_catchup) {
        const day3 = addDays(R, 2);
        const late = toEvent(classified, nyMinute(day3, 600), "sms", "outbound");
        const r3 = evaluate(scenario({ periods: [period("n1", "new", nyMinute(R, 420), "intake")], events: [late] }), nyMinute(day3, 700));
        assert.equal(r3.requirements.sms.catch_up.outstanding, false);
      }
      assert.equal(classified.goal_agent_id === null ? 0 : 1, fx.all_outbound_goal_credits);
    });
  }
});

describe("P07f late evidence (fixture p07f-late-evidence.json)", () => {
  const c = Object.fromEntries(fixture<FixtureFile<Case>>("p07f-late-evidence.json").cases.map((x) => [x.id, x])) as Record<string, Record<string, unknown>>;
  const D2 = "2026-10-02";
  const build = (events: EngineContactEvent[]) => scenario({ periods: [period("n1", "new", nyMinute(R, 420), "intake")], events });
  test("on_time_contact_captured_next_day", () => {
    const k = c.on_time_contact_captured_next_day!;
    const ev = outbound(k.contact_at as string);
    const without = evaluate(build([]), k.captured_at as string);
    const withEvent = evaluate(build([ev]), k.captured_at as string);
    assert.equal(obligationsOn(without, D2, "call")[0]!.outcome, "missed", "apparent miss before the evidence arrived");
    const slot = obligationsOn(withEvent, D2, "call")[0]!;
    assert.equal(slot.outcome, "fulfilled");
    assert.equal(slot.business_date, k.credited_date);
    assert.equal(goalCreditsByAgent([ev], "2026-10-03", TZ).size, k.capture_date_goal_credit);
    assert.equal(k.apparent_miss_removed, true);
  });
  test("genuinely_late_contact", () => {
    const k = c.genuinely_late_contact!;
    const r = evaluate(build([outbound(k.contact_at as string)]), k.captured_at as string);
    const slot = obligationsOn(r, D2, "call")[0]!;
    assert.equal(slot.due_at, new Date(k.deadline_at as string).toISOString());
    assert.equal(slot.outcome, "fulfilled_late");
    assert.equal(slot.deadline_missed, k.genuine_deadline_miss_retained);
  });
  test("corrected_initiator", () => {
    const k = c.corrected_initiator!;
    const before = outbound(ny(D2, "11:00"), { id: "same", agent: "alice" });
    const after = outbound(ny(D2, "11:00"), { id: "same", agent: "bob" });
    const b = Object.fromEntries(goalCreditsByAgent([before], D2, TZ));
    const a = Object.fromEntries(goalCreditsByAgent([after], D2, TZ));
    assert.deepEqual({ alice: b.alice ?? 0, bob: b.bob ?? 0 }, k.before);
    assert.deepEqual({ alice: a.alice ?? 0, bob: a.bob ?? 0 }, k.after);
    assert.equal((a.alice ?? 0) + (a.bob ?? 0), k.total_goal_credit);
  });
  test("ambiguous_timestamp", () => {
    const k = c.ambiguous_timestamp!;
    const r = evaluate(build([outbound(ny(D2, "11:00"), { verification: "awaiting_confirmation" })]), ny(D2, "12:30"));
    assert.equal(obligationsOn(r, D2, "call")[0]!.outcome === "pending", k.credit_pending);
    assert.equal(k.guessed, false);
  });
});

describe("P07g event time and windows (fixture p07g-event-time-windows.json)", () => {
  const c = Object.fromEntries(fixture<FixtureFile<Case>>("p07g-event-time-windows.json").cases.map((x) => [x.id, x])) as Record<string, Record<string, unknown>>;
  const build = (events: EngineContactEvent[], extra: Partial<Parameters<typeof scenario>[0]> = {}) => scenario({ periods: [period("n1", "new", nyMinute(R, 420), "intake")], events, ...extra });
  test("closing_cross: a 19:59 start credits that date", () => {
    const ev = outbound(ny(DAY4, "19:59"));
    const r = evaluate(build([outbound(ny(DAY4, "18:00")), ev]), ny(DAY4, "20:30"));
    assert.equal(r.obligations.some((o) => o.business_date === DAY4 && o.fulfilled_by_event_id === ev.event_id) ? 1 : 0, c.closing_cross!.routine_credit);
  });
  test("midnight_cross: goal on the start date, no next-date quota prepayment", () => {
    const k = c.midnight_cross!;
    const ev = outbound(new Date(k.start_at as string).toISOString());
    assert.equal(goalCreditsByAgent([ev], k.goal_date as string, TZ).get("alice"), k.goal_credit);
    const r = evaluate(scenario({ periods: [period("n1", "new", ny("2026-09-30", "07:00"), "intake")], events: [ev] }), ny("2026-10-03", "09:00"));
    assert.equal(obligationsOn(r, "2026-10-03", "call").filter((o) => o.fulfilled_by_event_id === ev.event_id).length, k.next_date_routine_credit);
  });
  test("sms_later_delivery: confirmed sent time governs", () => {
    const d2 = addDays(R, 1);
    const r = evaluate(build([sms(nyMinute(R, 600)), sms(ny(d2, "19:59"))]), ny(d2, "20:10"));
    assert.equal(obligationsOn(r, d2, "sms")[0]!.outcome, "fulfilled");
    assert.equal(c.sms_later_delivery!.credit_time, "19:59");
  });
  test("too_close_inbound: no cadence credit, anchor not reset", () => {
    const first = outbound(ny(DAY4, "10:00"));
    const tooClose = inbound(ny(DAY4, "10:20"));
    const spaced = outbound(ny(DAY4, "11:00"));
    const r = evaluate(build([first, tooClose, spaced]), ny(DAY4, "11:30"));
    assert.equal(r.obligations.some((o) => o.fulfilled_by_event_id === tooClose.event_id) ? 1 : 0, c.too_close_inbound!.cadence_credit);
    assert.ok(r.obligations.some((o) => o.fulfilled_by_event_id === spaced.event_id), "anchor stayed at 10:00");
  });
  test("originating_answered_inbound: initial response + at most one arrival call, zero goal", () => {
    const k = c.originating_answered_inbound!;
    const received = ny("2026-10-04", "10:00");
    const origin = inbound(minutesBefore(received, 2), { id: "origin" });
    const r = evaluate(scenario({ periods: [period("n1", "new", received, "intake")], events: [origin], originating_contact_event_id: origin.event_id }), ny("2026-10-04", "10:30"));
    assert.equal(r.initial_response?.outcome === "fulfilled", k.initial_response_satisfied);
    assert.equal(obligationsOn(r, "2026-10-04", "call").filter((o) => o.fulfilled_by_event_id === origin.event_id).length, k.maximum_arrival_call_credit);
    assert.equal(goalCreditAgent(origin) ? 1 : 0, k.goal_credit);
  });
  test("after_hours_catchup: clears existing catch-up, not tomorrow's quota", () => {
    const ev = outbound(ny(DAY4, "21:00"));
    const r = evaluate(build([ev]), ny(addDays(DAY4, 1), "09:00"));
    const before = evaluate(build([ev]), ny(DAY4, "20:59"));
    assert.equal(before.requirements.call.catch_up.outstanding, true);
    assert.equal(r.requirements.call.catch_up.outstanding === false, c.after_hours_catchup!.existing_channel_catchup_cleared, "the 21:00 contact cleared the catch-up (incl. Day 4 misses)");
    assert.equal(obligationsOn(r, addDays(DAY4, 1), "call").filter((o) => o.fulfilled_by_event_id === ev.event_id).length, c.after_hours_catchup!.next_date_routine_credit);
  });
  test("restricted_outbound: history retained, zero goal and cadence credit", () => {
    const k = c.restricted_outbound!;
    const ev = outbound(ny(DAY4, "10:00"), { restricted: true });
    const r = evaluate(build([ev], { restrictions: [restriction("r1", ["call"], ny(DAY4, "09:00"), ny(DAY4, "11:00"))] }), ny(DAY4, "12:00"));
    assert.equal(r.last_interaction_at === new Date(Date.parse(ev.event_at)).toISOString(), k.history_retained);
    assert.equal(goalCreditAgent(ev) ? 1 : 0, k.goal_credit);
    assert.equal(r.obligations.some((o) => o.fulfilled_by_event_id === ev.event_id) ? 1 : 0, k.cadence_credit);
  });
});

describe("P08a roster goals (fixture p08a-roster-goals.json) and synthetic goal/coverage cases", () => {
  const fx = fixture<{ rows: Array<{ rep: string; goal: number; actual: number; label?: string; goal_achieved?: boolean }>; expected_team_goal: number; expected_actual: number; expected_goal_enabled_reps: number; expected_reps_at_goal: number; automatic_partial_day_proration: boolean }>("p08a-roster-goals.json");
  test("team goal sums individual goals; zero-goal rows keep actuals, leave the denominator", () => {
    const s = summarizeTeamGoals(fx.rows);
    assert.deepEqual(s, { team_goal: fx.expected_team_goal, actual: fx.expected_actual, goal_enabled_reps: fx.expected_goal_enabled_reps, reps_at_goal: fx.expected_reps_at_goal });
    for (const row of fx.rows.filter((r) => r.label)) {
      const day = repDayGoal(row.actual, row.goal);
      assert.equal(day.goal_state, "no_goal_today");
      assert.equal(day.goal_reached, row.goal_achieved);
      assert.equal(day.actual, row.actual);
    }
    assert.equal(fx.automatic_partial_day_proration, false);
  });
  const synthetic = Object.fromEntries(fixture<FixtureFile<Case>>("synthetic.json").cases.map((x) => [x.id, x])) as Record<string, Record<string, unknown>>;
  test("synthetic above_goal: 108/100 capped progress, zero remaining", () => {
    const k = synthetic.above_goal!;
    const day = repDayGoal(k.actual as number, k.goal as number);
    assert.equal(day.remaining, k.remaining);
    assert.equal(day.progress, k.progress);
    assert.equal(day.actual, 108);
  });
  test("synthetic sms_unknown: no SMS coverage → pending, verified count null (never a false zero)", () => {
    const k = synthetic.sms_unknown!;
    const d2 = addDays(R, 1);
    const r = evaluate(scenario({ periods: [period("n1", "new", nyMinute(R, 420), "intake")], events: [outbound(ny(d2, "10:00")), outbound(ny(d2, "11:30"))], sms_complete_through: null }), ny(d2, "20:30"));
    assert.equal(r.requirements.call.status === "completed" || r.requirements.call.status === "overdue", true);
    assert.equal(r.requirements.sms.status, k.sms_status);
    assert.equal(r.requirements.sms.verified_completed, k.sms_verified_completed);
  });
  test("synthetic unapproved_policy: missing approval fails closed", () => {
    assert.equal(resolveEnginePolicy({ ...FINAL_01_CADENCE_VALUE, approval_ref: synthetic.unapproved_policy!.approval_ref }).ok, false);
  });
});

function minutesBefore(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) - minutes * 60_000).toISOString();
}
