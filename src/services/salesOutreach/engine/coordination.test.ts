import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { addDays } from "./calendar";
import { goalCreditAgent, goalCreditsByAgent } from "./credit";
import { callbackPlan, evaluate, fixture, inbound, ny, nyMinute, obligationsOn, outbound, period, periods, restriction, scenario, sms, TZ, type FixtureFile } from "./testSupport";

type Case = Record<string, unknown> & { id: string };
const cases = (name: string) => Object.fromEntries(fixture<FixtureFile<Case>>(name).cases.map((c) => [c.id, c])) as Record<string, Case>;

describe("P06a bounded catch-up (fixture p06a-bounded-catchup.json)", () => {
  const fx = fixture<FixtureFile<Case> & { catchup_per_channel_maximum: number; historical_misses_erased: boolean; oldest_deadline_preserved_until_cleared: boolean }>("p06a-bounded-catchup.json");
  const c = cases("p06a-bounded-catchup.json");
  const R = "2026-10-01";
  const day = (n: number) => addDays(R, n - 1);
  // Activated on Day 2 at 07:00: Day 2 two calls + SMS, Day 3 two calls + SMS, all missed.
  const build = (events: Parameters<typeof scenario>[0]["events"] = []) =>
    scenario({ received_at: nyMinute(R, 600), activation_at: nyMinute(day(2), 420), periods: [period("n1", "new", nyMinute(day(2), 420), "activation")], events });
  test("four_old_two_today", () => {
    const k = c.four_old_two_today as Record<string, number>;
    const before = evaluate(build(), nyMinute(day(4), 540));
    assert.equal(before.requirements.call.catch_up.outstanding ? 1 : 0, k.call_catchup_before);
    assert.equal(before.requirements.call.catch_up.missed_count, k.historical_missed_calls);
    assert.equal(before.requirements.call.catch_up.oldest_missed_due_at, nyMinute(day(2), 1200), "oldest deadline preserved");
    assert.equal(before.requirements.call.required, k.ordinary_calls_today);
    const call = outbound(nyMinute(day(4), 600));
    const after = evaluate(build([call]), nyMinute(day(4), 630));
    assert.equal(after.requirements.call.catch_up.outstanding ? 1 : 0, k.call_catchup_after);
    assert.equal(after.requirements.call.remaining, k.ordinary_calls_remaining);
    assert.equal(after.obligations.filter((o) => o.channel === "call" && o.outcome === "missed").length, k.historical_missed_calls_after);
    assert.equal(goalCreditsByAgent([call], day(4), TZ).get("alice"), 1, "one event, one goal credit");
    assert.equal(k.goal_credit_from_clearing_marker, 0);
  });
  test("call_cannot_clear_sms", () => {
    const k = c.call_cannot_clear_sms as Record<string, number>;
    const r = evaluate(build([outbound(nyMinute(day(4), 600))]), nyMinute(day(4), 630));
    assert.equal(r.requirements.call.catch_up.outstanding ? 1 : 0, k.call_catchup_after);
    assert.equal(r.requirements.sms.catch_up.outstanding ? 1 : 0, k.sms_catchup_after);
  });
  test("scheduled_sms_day", () => {
    const k = c.scheduled_sms_day as Record<string, number | boolean>;
    const r = evaluate(build([sms(nyMinute(day(6), 600))]), nyMinute(day(6), 630));
    assert.equal(r.requirements.sms.catch_up.outstanding ? 1 : 0, k.sms_catchup_after);
    assert.equal(r.requirements.sms.remaining, k.ordinary_sms_remaining);
    assert.equal(r.obligations.filter((o) => o.channel === "sms" && o.business_date > day(6))[0]!.business_date, day(k.next_fixed_sms_day as number));
  });
  test("unscheduled_sms_day", () => {
    const k = c.unscheduled_sms_day as Record<string, number | boolean>;
    const r = evaluate(build([sms(nyMinute(day(7), 600))]), nyMinute(day(7), 630));
    assert.equal(r.requirements.sms.catch_up.outstanding ? 1 : 0, k.sms_catchup_after);
    assert.equal(r.requirements.sms.required, k.ordinary_sms_required);
    assert.equal(r.obligations.filter((o) => o.channel === "sms" && o.business_date > day(7))[0]!.business_date, day(k.next_fixed_sms_day as number));
  });
  test("never more than one actionable catch-up per channel; history never erased", () => {
    const r = evaluate(build(), nyMinute(day(8), 600));
    assert.equal(fx.catchup_per_channel_maximum, 1);
    assert.equal(r.requirements.call.catch_up.outstanding, true);
    assert.ok(r.requirements.call.catch_up.missed_count > 4);
    assert.equal(r.requirements.call.required, 1, "today's quota is not stacked with old misses");
  });
});

describe("P06b advisory cooldown (fixture p06b-advisory-cooldown.json)", () => {
  const c = cases("p06b-advisory-cooldown.json");
  const R = "2026-10-01";
  const day4 = addDays(R, 3);
  const base = (events: ReturnType<typeof outbound>[], restrictions: ReturnType<typeof restriction>[] = []) => scenario({ periods: [period("n1", "new", nyMinute(R, 420), "intake")], events, restrictions });
  test("three_unanswered: warning only, no hard pause, routine work stays due", () => {
    const k = c.three_unanswered as Record<string, number | boolean>;
    const prev = addDays(day4, -1);
    const events = [1140, 1150, 1160].map((m) => outbound(nyMinute(prev, m), { outcome: "unanswered" }));
    const r = evaluate(base(events), nyMinute(day4, 540));
    assert.equal(r.cooldown.unsuccessful_attempts.length, k.unsuccessful_attempts_last_24h);
    assert.equal(r.cooldown.warning, k.warning);
    assert.equal(r.flags.advisory_cooldown, true);
    assert.equal(r.requirements.call.status === "blocked", k.hard_pause);
    assert.equal(r.flags.needs_contact, k.routine_work_remains_due);
  });
  test("too_close_retry / spaced_second: goal credit for every attempt, cadence only when spaced, anchor not reset", () => {
    const first = outbound(nyMinute(day4, 610));
    const retry = outbound(nyMinute(day4, 620));
    const second = outbound(nyMinute(day4, 670));
    const r = evaluate(base([first, retry, second]), nyMinute(day4, 700));
    const credited = new Set(r.obligations.map((o) => o.fulfilled_by_event_id));
    assert.equal(goalCreditAgent(retry) ? 1 : 0, (c.too_close_retry as Record<string, number>).goal_credit);
    assert.equal(credited.has(retry.event_id) ? 1 : 0, (c.too_close_retry as Record<string, number>).cadence_credit);
    assert.equal(credited.has(second.event_id) ? 1 : 0, (c.spaced_second as Record<string, number>).cadence_credit, "11:10 is 60 min after the 10:10 anchor (not the 10:20 retry)");
    assert.equal(goalCreditAgent(second) ? 1 : 0, (c.spaced_second as Record<string, number>).goal_credit);
  });
  test("actual_restriction: real restrictions still block", () => {
    const k = c.actual_restriction as Record<string, boolean>;
    const prev = addDays(day4, -1);
    const events = [1140, 1150, 1160].map((m) => outbound(nyMinute(prev, m)));
    const r = evaluate(base(events, [restriction("r1", ["call"], nyMinute(day4, 480), null)]), nyMinute(day4, 540));
    assert.equal(r.cooldown.warning, k.warning);
    assert.equal(r.requirements.call.status === "blocked", k.call_restricted);
    assert.equal(r.requirements.call.status === "due" || r.requirements.call.status === "overdue", k.ready_to_call);
  });
});

describe("P06c restriction waiver and resume (fixture p06c-restriction-waiver-resume.json)", () => {
  const c = cases("p06c-restriction-waiver-resume.json");
  const R = "2026-10-01"; // Day 7 = Wed 2026-10-07, Day 9 = Fri 2026-10-09 (fixed SMS day)
  const WED = "2026-10-07", THU = "2026-10-08", FRI = "2026-10-09", SAT = "2026-10-10";
  const base = (release: string | null, events: ReturnType<typeof outbound>[] = [], channels: Array<"call" | "sms"> = ["call"]) =>
    scenario({ periods: [period("n1", "new", nyMinute(R, 420), "intake")], restrictions: [restriction("r1", channels, ny(WED, "14:00"), release)], events });
  test("release_at_opening", () => {
    const k = c.release_at_opening as Record<string, unknown>;
    const r = evaluate(base(ny(FRI, "08:00")), ny(FRI, "09:00"));
    assert.equal(obligationsOn(r, WED, "call")[0]!.outcome, "waived_restriction", "unfinished requirement waived when the restriction took effect");
    assert.equal(obligationsOn(r, THU, "call")[0]!.outcome, "waived_restriction");
    assert.equal(obligationsOn(r, FRI, "call")[0]!.outcome, "open", "routine resumes Friday");
    assert.equal(r.obligations.filter((o) => o.business_date >= WED && o.deadline_missed).length, k.new_blocked_interval_misses);
    assert.equal(obligationsOn(r, FRI, "sms")[0]!.outcome !== "waived_restriction", !(k.sms_affected as boolean));
    assert.equal(r.schedule_day, 9, "original age retained");
    assert.equal(obligationsOn(r, FRI, "sms").length, 1, "fixed SMS sequence not shifted");
  });
  test("release_after_opening", () => {
    const k = c.release_after_opening as Record<string, unknown>;
    const permitted = outbound(ny(FRI, "15:00"));
    const r = evaluate(base(ny(FRI, "14:00"), [permitted]), ny(SAT, "09:00"));
    assert.equal(obligationsOn(r, FRI, "call")[0]!.outcome, "waived_restriction");
    assert.equal(obligationsOn(r, SAT, "call")[0]!.outcome, "open", `routine resumes ${String(k.routine_resumes)}`);
    assert.ok(r.obligations.some((o) => o.fulfilled_by_event_id === permitted.event_id) || r.requirements.call.catch_up.outstanding === false, "permitted contact right after release earns credit");
  });
  test("old_misses", () => {
    const k = c.old_misses as Record<string, unknown>;
    const before = evaluate(base(null), ny(WED, "13:00"));
    const during = evaluate(base(null), ny(FRI, "12:00"));
    const priorMisses = (r: typeof before) => r.obligations.filter((o) => o.business_date < WED && o.outcome === "missed").length;
    assert.equal(priorMisses(during), priorMisses(before), "prior genuine misses kept");
    assert.equal(during.requirements.call.catch_up.state, k.catchup_while_restricted);
    assert.equal(during.obligations.filter((o) => o.business_date >= WED && o.channel === "call" && o.deadline_missed).length, k.new_blocked_interval_catchup);
    assert.equal(during.requirements.call.status, "blocked");
    assert.equal(during.requirements.call.blocked_until, null);
  });
  test("initial_response pauses during the restriction and resumes on release", () => {
    const k = c.initial_response as Record<string, number | boolean>;
    const SUN = "2026-10-04";
    const r = evaluate(
      scenario({ periods: [period("n1", "new", nyMinute(SUN, 1170), "intake")], restrictions: [restriction("r1", ["call"], nyMinute(SUN, 1185), ny("2026-10-05", "10:00"))] }),
      nyMinute(SUN, 1190),
    );
    assert.equal(k.remaining_working_minutes_at_block, 15);
    assert.equal(r.initial_response?.due_at, ny("2026-10-05", `10:${String(k.remaining_working_minutes_at_release).padStart(2, "0")}`));
  });
});

describe("P06d continuous assignment timeline (fixture p06d-assignment-responsibility.json)", () => {
  const c = cases("p06d-assignment-responsibility.json");
  const TUE = "2026-10-06";
  const assignments = [{ agent_id: null, from: "2000-01-01T00:00:00Z", to: ny(TUE, "11:00") }, { agent_id: "alice", from: ny(TUE, "11:00"), to: null }];
  const base = (events: ReturnType<typeof outbound>[] = [], list = assignments) => scenario({ periods: [period("n1", "new", ny(TUE, "10:00"), "intake")], assignments: list, events });
  test("first_assignment_after_deadline", () => {
    const k = c.first_assignment_after_deadline as Record<string, unknown>;
    const r = evaluate(base(), ny(TUE, "11:05"));
    assert.equal(r.initial_response?.due_at, ny(TUE, k.deadline_after as string), "assignment does not restart the clock");
    const ir = r.obligations.find((o) => o.kind === "initial_response")!;
    assert.equal(ir.responsible_agent_id, null, "historical miss stays with Unassigned");
    assert.equal(r.current_assignee_agent_id, k.current_rep);
    assert.equal(ir.inherited, true, "Inherited overdue");
    assert.equal(r.flags.inherited_overdue, true);
    assert.equal(k.fresh_response_clock, false);
  });
  test("inherited_catchup_contact", () => {
    const k = c.inherited_catchup_contact as Record<string, unknown>;
    const r = evaluate(base([outbound(ny(TUE, k.contact_local as string))]), ny(TUE, "11:15"));
    assert.equal(obligationsOn(r, TUE, "call").filter((o) => o.fulfilled_by_event_id).length, k.ordinary_call_credit);
    assert.equal(r.requirements.call.status === "overdue" ? 1 : 0, k.call_catchup_after);
    assert.equal(r.initial_response?.outcome === "fulfilled_late", k.genuine_1030_miss_retained);
  });
  test("reassignment", () => {
    const k = c.reassignment as Record<string, unknown>;
    const WED = addDays(TUE, 1);
    const call = outbound(ny(TUE, "11:10"), { agent: "alice" });
    const moved = [...assignments.slice(0, 1), { agent_id: "alice", from: ny(TUE, "11:00"), to: ny(WED, "13:00") }, { agent_id: "bob", from: ny(WED, "13:00"), to: null }];
    const r = evaluate(base([call], moved), ny(addDays(WED, 1), "09:00"));
    const stay = evaluate(base([call]), ny(addDays(WED, 1), "09:00"));
    const wed = obligationsOn(r, WED, "call");
    assert.equal(wed[0]!.responsible_agent_id, k.prior_miss_responsibility);
    assert.equal(wed[1]!.responsible_agent_id, k.next_miss_responsibility);
    const strip = (x: typeof r) => x.obligations.map((o) => [o.obligation_id, o.opens_at, o.due_at, o.outcome, o.fulfilled_by_event_id]);
    assert.deepEqual(strip(r), strip(stay), "age, deadlines, completed contacts, spacing and catch-up unchanged");
    assert.equal(r.schedule_day, stay.schedule_day);
    assert.equal(goalCreditAgent(call), "alice", "prior goal credit not moved");
  });
});

describe("P06e explicit callbacks (fixture p06e-explicit-callback.json)", () => {
  const c = cases("p06e-explicit-callback.json");
  const R = "2026-10-03"; // Tue 10-06 = Day 4, Thu 10-08 = Day 6 (fixed SMS), Fri 10-09 = Day 7
  const TUE = "2026-10-06", WED = "2026-10-07", THU = "2026-10-08", FRI = "2026-10-09";
  const appointment = ny(THU, "15:00");
  const base = (events: Parameters<typeof scenario>[0]["events"] = [], at = appointment, extra: Partial<Parameters<typeof scenario>[0]> = {}) =>
    scenario({ periods: [period("n1", "new", nyMinute(R, 420), "intake")], plans: [callbackPlan("cb1", "n1", at, ny(TUE, "10:00"))], events, ...extra });
  test("future_callback", () => {
    const k = c.future_callback as Record<string, unknown>;
    const r = evaluate(base(), ny(THU, "09:00"));
    assert.ok(obligationsOn(r, TUE, "call").every((o) => o.outcome === "suspended_callback"), "unfinished Tuesday calls suspended");
    assert.ok(obligationsOn(r, WED, "call").every((o) => o.outcome === "suspended_callback"));
    assert.equal(obligationsOn(r, THU, "call").filter((o) => o.outcome !== "suspended_callback").length, k.ordinary_calls_on_callback_date);
    assert.equal(r.requirements.call.status, "scheduled");
    assert.equal(r.requirements.call.catch_up.state, "suspended", "catch-up prompts suspended");
    assert.equal(obligationsOn(r, THU, "sms")[0]!.outcome === "open", !(k.sms_suspended as boolean));
    assert.ok(r.obligations.some((o) => o.business_date < TUE && o.outcome === "missed"), "prior misses kept");
    assert.equal(obligationsOn(r, FRI, "call")[0]!.outcome, "scheduled", "ordinary cadence resumes next working date");
  });
  test("no_answer_in_window", () => {
    const k = c.no_answer_in_window as Record<string, unknown>;
    const attempt = outbound(ny(THU, "15:05"), { outcome: "unanswered" });
    const r = evaluate(base([attempt]), ny(THU, "15:30"));
    assert.equal(r.callback?.outcome === "fulfilled", k.callback_fulfilled);
    assert.equal(goalCreditAgent(attempt) ? 1 : 0, k.goal_credit);
  });
  test("answered_inbound_in_window", () => {
    const k = c.answered_inbound_in_window as Record<string, unknown>;
    const call = inbound(ny(THU, "15:05"));
    const r = evaluate(base([call]), ny(THU, "15:30"));
    assert.equal(r.callback?.outcome === "fulfilled", k.callback_fulfilled);
    assert.equal(goalCreditAgent(call) ? 1 : 0, k.goal_credit);
  });
  test("early_call", () => {
    const k = c.early_call as Record<string, unknown>;
    const r = evaluate(base([outbound(ny(THU, "14:50"))]), ny(THU, "15:20"));
    assert.equal(r.callback?.outcome === "fulfilled", k.callback_fulfilled);
    assert.equal(r.callback?.outcome, "overdue");
  });
  test("late_call", () => {
    const k = c.late_call as Record<string, unknown>;
    const r = evaluate(base([outbound(ny(THU, "15:30"))]), ny(THU, "16:00"));
    assert.equal(r.callback?.outcome === "fulfilled_late", k.outstanding_callback_cleared);
    assert.equal(r.obligations.find((o) => o.kind === "callback")!.deadline_missed, k.genuine_callback_miss_retained);
  });
  test("after_hours_appointment", () => {
    const k = c.after_hours_appointment as Record<string, unknown>;
    const at = ny(THU, "21:00");
    const r = evaluate(base([outbound(ny(THU, "21:05"))], at), ny(THU, "21:30"));
    assert.equal(r.callback?.outcome === "fulfilled", k.callback_permitted);
    const restricted = evaluate(base([], at, { restrictions: [restriction("r1", ["call"], ny(THU, "20:30"), ny(FRI, "08:00"))] }), ny(THU, "21:30"));
    assert.equal(restricted.callback?.outcome === "blocked_reschedule", k.actual_restrictions_override);
  });
  test("reassignment carries the pending callback", () => {
    const r = evaluate(base([], appointment, { assignments: [{ agent_id: "alice", from: "2000-01-01T00:00:00Z", to: ny(WED, "10:00") }, { agent_id: "bob", from: ny(WED, "10:00"), to: null }] }), ny(THU, "15:20"));
    assert.equal(r.callback?.outcome, "overdue");
    assert.equal(r.obligations.find((o) => o.kind === "callback")!.responsible_agent_id, "bob");
    assert.equal((c.reassignment as Record<string, unknown>).pending_callback_carried, true);
  });
});

describe("P06f deterministic precedence (fixture p06f-precedence-collisions.json)", () => {
  const fx = fixture<FixtureFile<Case> & { precedence: string[]; maximum_active_human_plans_per_lead: number }>("p06f-precedence-collisions.json");
  const c = cases("p06f-precedence-collisions.json");
  const R = "2026-10-03";
  const TUE = "2026-10-06", THU = "2026-10-08", FRI = "2026-10-09";
  const plan = callbackPlan("cb1", "n1", ny(THU, "15:00"), ny(TUE, "10:00"));
  test("precedence order", async () => {
    const { PRECEDENCE } = await import("./precedence");
    assert.deepEqual([...PRECEDENCE], fx.precedence);
  });
  test("closure", () => {
    const k = c.closure as Record<string, boolean>;
    const r = evaluate(scenario({ received_at: nyMinute(R, 420), periods: periods(["n1", "new", nyMinute(R, 420), "intake"], ["c1", "closed", ny(TUE, "12:00"), "transition", "5"], ["x1", "new", ny(WED_(), "12:00"), "transition"]), plans: [plan] }), ny(THU, "16:00"));
    assert.equal(r.callback?.outcome === "cancelled", k.pending_callback_cancelled);
    assert.equal(r.obligations.some((o) => o.period_id === "n1" && o.outcome === "cancelled"), k.routine_cancelled);
    assert.equal(r.state === "closed", !k.auto_reopened, "a later nonterminal priority does not reopen");
  });
  test("restricted_callback", () => {
    const k = c.restricted_callback as Record<string, unknown>;
    const r = evaluate(scenario({ periods: [period("n1", "new", nyMinute(R, 420), "intake")], plans: [plan], restrictions: [restriction("r1", ["call"], ny(THU, "14:00"), ny(FRI, "08:00"))] }), ny(THU, "16:00"));
    assert.equal(r.callback?.outcome, "blocked_reschedule");
    assert.equal(r.flags.callback_blocked_reschedule, true, String(k.label));
    assert.equal(r.obligations.find((o) => o.kind === "callback")!.deadline_missed, k.restriction_caused_callback_miss);
    assert.equal(r.obligations.some((o) => o.business_date < TUE && o.outcome === "missed"), k.prior_genuine_misses_retained);
  });
  for (const [id, workflow] of [["nonterminal_priority_three", "discretion"], ["accepted_unmapped", "none"]] as const) {
    test(id, () => {
      const k = c[id] as Record<string, boolean>;
      const r = evaluate(scenario({ received_at: nyMinute(R, 420), periods: periods(["n1", "new", nyMinute(R, 420), "intake"], ["x1", workflow, ny("2026-10-07", "12:00"), "transition", workflow === "none" ? "42" : "3"]), plans: [plan] }), ny(THU, "09:00"));
      const routineThursday = obligationsOn(r, THU, "call").filter((o) => o.outcome !== "superseded" && o.outcome !== "suspended_callback");
      assert.equal(routineThursday.length > 0, k.routine_required);
      assert.equal(r.requirements.call.required, 1, "only the callback is required");
      assert.equal(r.callback?.outcome === "scheduled", k.pending_human_callback_preserved);
    });
  }
  test("genuine_missed_callback", () => {
    const k = c.genuine_missed_callback as Record<string, unknown>;
    const missed = evaluate(scenario({ periods: [period("n1", "new", nyMinute(R, 420), "intake")], plans: [plan] }), ny(FRI, "10:00"));
    assert.equal(missed.callback?.outcome === "overdue", k.callback_overdue);
    assert.ok(obligationsOn(missed, FRI, "call").length > 0, `ordinary resumes ${String(k.ordinary_resumes)}`);
    const call = outbound(ny(FRI, "11:00"));
    const r = evaluate(scenario({ periods: [period("n1", "new", nyMinute(R, 420), "intake")], plans: [plan], events: [call] }), ny(FRI, "11:30"));
    assert.equal(r.callback?.outcome === "fulfilled_late", k.single_later_qualifying_call_clears_callback);
    assert.equal(r.obligations.filter((o) => (o.kind === "ordinary" || o.kind === "quoted") && o.fulfilled_by_event_id === call.event_id).length, k.ordinary_credit_maximum);
    assert.equal(goalCreditAgent(call) ? 1 : 0, k.goal_credit_maximum);
  });
  test("missed_inbound", () => {
    const k = c.missed_inbound as Record<string, boolean>;
    const missedCall = inbound(ny(TUE, "11:00"), { answered: false });
    const r = evaluate(scenario({ periods: [period("n1", "new", nyMinute(R, 420), "intake")], events: [missedCall] }), ny(TUE, "12:00"));
    assert.equal(r.last_interaction_at === new Date(Date.parse(missedCall.event_at)).toISOString(), k.history_retained);
    assert.equal(r.obligations.some((o) => o.kind === "callback"), k.automatic_callback_created);
    assert.equal(r.obligations.some((o) => o.fulfilled_by_event_id === missedCall.event_id), false);
  });
  function WED_() {
    return "2026-10-07";
  }
});
