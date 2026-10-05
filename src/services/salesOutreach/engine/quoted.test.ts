import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { addDays, BusinessCalendar } from "./calendar";
import { validateQuotedSelection } from "./quoted";
import { evaluate, fixture, ny, nyMinute, obligationsOn, outbound, periods, POLICY, policyWith, quotedPlan, scenario, type FixtureFile } from "./testSupport";

const cal = new BusinessCalendar(POLICY.calendar);

describe("P04a Quoted deferral (fixture p04a-quoted-deferral.json)", () => {
  const fx = fixture<{ selected_date: string; activation_at: string; due_at: string; cases: Array<Record<string, unknown> & { id: string }> }>("p04a-quoted-deferral.json");
  const S = fx.selected_date;
  const build = (events: ReturnType<typeof outbound>[] = []) =>
    scenario({
      periods: periods(["n1", "new", ny("2026-10-02", "09:00"), "intake"], ["q1", "quoted", ny("2026-10-05", "15:00"), "transition"]),
      plans: [quotedPlan("plan-1", "q1", S, ny("2026-10-05", "15:30"))],
      events,
    });
  const byId = Object.fromEntries(fx.cases.map((c) => [c.id, c]));

  test("selected date opens 08:00 and is due 20:00", () => {
    const r = evaluate(build(), fx.activation_at);
    const ob = obligationsOn(r, S, "call")[0]!;
    assert.equal(ob.opens_at, new Date(fx.activation_at).toISOString());
    assert.equal(ob.due_at, new Date(fx.due_at).toISOString());
  });
  test("before_selected_date", () => {
    const c = byId.before_selected_date as unknown as { business_date: string; ordinary_required_calls: number; scheduled: boolean; actionable_countdown_active: boolean };
    const r = evaluate(build(), ny(c.business_date, "15:00"));
    assert.equal(r.requirements.call.required, c.ordinary_required_calls);
    assert.equal(r.requirements.call.status === "scheduled", c.scheduled);
    assert.equal(r.requirements.call.due_at !== null, c.actionable_countdown_active);
    assert.equal(r.quoted?.selected_date, S);
  });
  test("selected_date_opening", () => {
    const c = byId.selected_date_opening as unknown as { as_of: string; ordinary_required_calls: number; actionable_countdown_active: boolean; overdue: boolean };
    const r = evaluate(build(), c.as_of);
    assert.equal(r.requirements.call.required, c.ordinary_required_calls);
    assert.equal(r.requirements.call.due_at !== null, c.actionable_countdown_active);
    assert.equal(r.requirements.call.status === "overdue", c.overdue);
  });
  test("call_on_selected_date", () => {
    const c = byId.call_on_selected_date as unknown as { call_started_at: string; verified_completed: number; remaining: number; next_due_at: string };
    const r = evaluate(build([outbound(c.call_started_at)]), "2026-10-08T16:00:00Z");
    assert.equal(r.requirements.call.verified_completed, c.verified_completed);
    assert.equal(r.requirements.call.remaining, c.remaining);
    assert.equal(r.next_action_due_at, new Date(c.next_due_at).toISOString());
  });
  test("early_extra_call", () => {
    const c = byId.early_extra_call as unknown as { call_started_at: string; selected_date_verified_completed: number };
    const r = evaluate(build([outbound(c.call_started_at)]), "2026-10-08T16:00:00Z");
    assert.equal(r.requirements.call.verified_completed, c.selected_date_verified_completed);
    assert.equal(r.quoted?.selected_date, S, "selected date unchanged");
  });
  test("missed_selected_date", () => {
    const c = byId.missed_selected_date as unknown as { next_business_date: string; next_date_ordinary_required_calls: number };
    const r = evaluate(build(), ny(c.next_business_date, "12:00"));
    assert.equal(obligationsOn(r, S, "call")[0]!.outcome, "missed");
    assert.equal(r.requirements.call.required, c.next_date_ordinary_required_calls);
  });
});

describe("P04b Quoted permissions — engine parts (fixture p04b-quoted-permissions.json)", () => {
  const fx = fixture<{ reassignment_preserves_schedule: boolean; cases: Array<Record<string, unknown> & { id: string }> }>("p04b-quoted-permissions.json");
  const c = fx.cases.find((x) => x.id === "post_miss_reschedule") as unknown as { old_miss_retained: boolean; contact_credit_created: boolean };
  const base = (plans: ReturnType<typeof quotedPlan>[], assignments?: Parameters<typeof scenario>[0]["assignments"]) =>
    scenario({ periods: periods(["n1", "new", ny("2026-10-02", "09:00"), "intake"], ["q1", "quoted", ny("2026-10-05", "15:00"), "transition"]), plans, assignments });
  test("post_miss_reschedule keeps the old miss and creates no contact credit", () => {
    const plans = [quotedPlan("a", "q1", "2026-10-08", ny("2026-10-05", "15:30"), ny("2026-10-09", "10:00")), quotedPlan("b", "q1", "2026-10-11", ny("2026-10-09", "10:00"), null, 2)];
    const r = evaluate(base(plans), ny("2026-10-11", "09:00"));
    assert.equal(obligationsOn(r, "2026-10-08", "call")[0]!.outcome === "missed", c.old_miss_retained);
    assert.equal(obligationsOn(r, "2026-10-09", "call")[0]!.outcome, "superseded", "open requirement deferred, not missed");
    assert.equal(obligationsOn(r, "2026-10-10", "call").length, 0);
    assert.equal(obligationsOn(r, "2026-10-11", "call").length, 1);
    assert.equal(r.obligations.some((o) => o.fulfilled_by_event_id !== null), c.contact_credit_created);
  });
  test("reassignment_preserves_schedule", () => {
    const plans = [quotedPlan("a", "q1", "2026-10-08", ny("2026-10-05", "15:30"))];
    const one = evaluate(base(plans), ny("2026-10-09", "09:00"));
    const two = evaluate(base(plans, [{ agent_id: "alice", from: "2000-01-01T00:00:00Z", to: ny("2026-10-07", "10:00") }, { agent_id: "bob", from: ny("2026-10-07", "10:00"), to: null }]), ny("2026-10-09", "09:00"));
    assert.equal(fx.reassignment_preserves_schedule, true);
    assert.deepEqual(two.obligations.map((o) => [o.obligation_id, o.outcome, o.due_at]), one.obligations.map((o) => [o.obligation_id, o.outcome, o.due_at]));
    assert.equal(obligationsOn(two, "2026-10-08", "call")[0]!.responsible_agent_id, "bob");
  });
});

describe("P04c allowed dates (fixture p04c-quoted-allowed-dates.json)", () => {
  const fx = fixture<FixtureFile<Record<string, unknown> & { id: string }>>("p04c-quoted-allowed-dates.json");
  const TODAY = "2026-10-06";
  const byId = Object.fromEntries(fx.cases.map((c) => [c.id, c])) as Record<string, Record<string, unknown>>;
  const enteredToday = (enteredMinute: number, plans: ReturnType<typeof quotedPlan>[], events: ReturnType<typeof outbound>[] = []) =>
    scenario({ periods: periods(["n1", "new", ny("2026-10-02", "09:00"), "intake"], ["q1", "quoted", nyMinute(TODAY, enteredMinute), "transition"]), plans, events });

  for (const id of ["today_1400", "today_before_open", "today_1930"]) {
    test(id, () => {
      const c = byId[id] as { command_minute: number; allowed: boolean; activation_minute: number; due_minute: number; retrospective_miss_created: boolean };
      const command = Date.parse(nyMinute(TODAY, c.command_minute));
      const v = validateQuotedSelection(cal, POLICY, command, TODAY);
      assert.equal(v.allowed, c.allowed);
      if (v.allowed) {
        assert.equal(new Date(v.activation_at_ms).toISOString(), nyMinute(TODAY, c.activation_minute));
        assert.equal(new Date(v.due_at_ms).toISOString(), nyMinute(TODAY, c.due_minute));
      }
      const r = evaluate(enteredToday(Math.min(c.command_minute, 450) - 5, [quotedPlan("p", "q1", TODAY, nyMinute(TODAY, c.command_minute))]), nyMinute(TODAY, 1199));
      const ob = obligationsOn(r, TODAY, "call", ["quoted"])[0]!;
      assert.equal(ob.opens_at, nyMinute(TODAY, c.activation_minute));
      assert.equal(ob.due_at, nyMinute(TODAY, c.due_minute));
      assert.equal(r.obligations.some((o) => o.kind === "quoted" && o.business_date === TODAY && o.deadline_missed), c.retrospective_miss_created);
    });
  }
  test("today_1931", () => {
    const v = validateQuotedSelection(cal, POLICY, Date.parse(nyMinute(TODAY, 1171)), TODAY);
    assert.deepEqual(v, { allowed: false, reason: "after_same_day_cutoff" });
  });
  test("future_working_date", () => {
    const c = byId.future_working_date as { activation_minute: number; due_minute: number };
    const v = validateQuotedSelection(cal, POLICY, Date.parse(nyMinute(TODAY, 600)), "2026-10-09");
    assert.ok(v.allowed);
    if (v.allowed) {
      assert.equal(new Date(v.activation_at_ms).toISOString(), nyMinute("2026-10-09", c.activation_minute));
      assert.equal(new Date(v.due_at_ms).toISOString(), nyMinute("2026-10-09", c.due_minute));
    }
  });
  test("future_closed_date (rejected, never silently shifted)", () => {
    const closed = policyWith({ holidays: ["2026-10-09"] });
    assert.deepEqual(validateQuotedSelection(new BusinessCalendar(closed.calendar), closed, Date.parse(nyMinute(TODAY, 600)), "2026-10-09"), { allowed: false, reason: "closed_date" });
  });
  test("past_date", () => {
    assert.deepEqual(validateQuotedSelection(cal, POLICY, Date.parse(nyMinute(TODAY, 600)), "2026-10-05"), { allowed: false, reason: "past_date" });
  });
  test("selected_date_later_closed", () => {
    const c = byId.selected_date_later_closed as { selected_date_preserved: boolean; quota_waived: boolean; miss_created_from_closure: boolean; next_working_date_ordinary_calls: number };
    const plans = [quotedPlan("p", "q1", "2026-10-09", nyMinute(TODAY, 600))];
    const later = policyWith({ holidays: ["2026-10-09"] });
    const r = evaluate(enteredToday(540, plans), ny("2026-10-10", "09:00"), later);
    assert.equal(r.quoted?.selected_date === "2026-10-09", c.selected_date_preserved);
    assert.equal(obligationsOn(r, "2026-10-09", "call").length === 0, c.quota_waived);
    assert.equal(r.obligations.some((o) => o.kind === "quoted" && o.deadline_missed), c.miss_created_from_closure);
    assert.equal(obligationsOn(r, "2026-10-10", "call").length, c.next_working_date_ordinary_calls);
  });
  test("early_call_then_select_today", () => {
    const c = byId.early_call_then_select_today as { retroactive_credit_created: boolean };
    const r = evaluate(enteredToday(540, [quotedPlan("p", "q1", TODAY, nyMinute(TODAY, 840))], [outbound(nyMinute(TODAY, 600))]), nyMinute(TODAY, 900));
    const ob = obligationsOn(r, TODAY, "call", ["quoted"])[0]!;
    assert.equal(ob.opens_at, nyMinute(TODAY, 840));
    assert.equal(ob.fulfilled_by_event_id !== null, c.retroactive_credit_created);
  });
});

describe("P04d no-date default (fixture p04d-quoted-no-date.json)", () => {
  const fx = fixture<FixtureFile<{ id: string; entry_at: string; closed_dates: string[]; entry_date_required_quoted_calls: number; first_required_date: string; entry_date_call_at?: string; future_requirement_fulfilled?: boolean }> & { ordinary_continuation_calls_per_working_date: number; repeated_priority: { schedule_restarted: boolean; first_required_date_preserved: boolean }; explicit_date: { default_overrides_selected_date: boolean } }>("p04d-quoted-no-date.json");
  const build = (entry: string, events: ReturnType<typeof outbound>[] = [], plans: ReturnType<typeof quotedPlan>[] = []) =>
    scenario({ periods: periods(["n1", "new", ny("2026-10-01", "09:00"), "intake"], ["q1", "quoted", entry, "transition"]), events, plans });
  for (const c of fx.cases) {
    test(c.id, () => {
      const policy = policyWith({ holidays: c.closed_dates });
      const localCal = new BusinessCalendar(policy.calendar);
      const entryDate = localCal.dateOf(Date.parse(c.entry_at));
      const events = c.entry_date_call_at ? [outbound(c.entry_date_call_at)] : [];
      const r = evaluate(build(c.entry_at, events), nyMinute(c.first_required_date, 1100), policy);
      assert.equal(obligationsOn(r, entryDate, "call", ["quoted"]).length, c.entry_date_required_quoted_calls);
      assert.equal(r.quoted?.first_required_date, c.first_required_date);
      assert.equal(r.quoted?.basis, "next_working_date_default");
      const first = obligationsOn(r, c.first_required_date, "call", ["quoted"]);
      assert.equal(first.length, fx.ordinary_continuation_calls_per_working_date);
      assert.equal(first[0]!.opens_at, nyMinute(c.first_required_date, 480));
      if (c.future_requirement_fulfilled !== undefined) assert.equal(first[0]!.outcome === "fulfilled", c.future_requirement_fulfilled);
      const after = obligationsOn(evaluate(build(c.entry_at, events), nyMinute(addDays(c.first_required_date, 1), 600), policy), addDays(c.first_required_date, 1), "call", ["quoted"]);
      assert.equal(after.length, fx.ordinary_continuation_calls_per_working_date, "then one call each working date");
    });
  }
  test("repeated_priority: no new period → schedule preserved", () => {
    const r1 = evaluate(build(ny("2026-10-02", "14:00")), ny("2026-10-03", "10:00"));
    const r2 = evaluate(build(ny("2026-10-02", "14:00")), ny("2026-10-03", "10:00"));
    assert.equal(r1.quoted?.first_required_date, "2026-10-03");
    assert.equal(r1.fingerprint, r2.fingerprint);
    assert.equal(fx.repeated_priority.schedule_restarted, false);
  });
  test("explicit_date: a human-selected date is not overridden by the default", () => {
    const r = evaluate(build(ny("2026-10-02", "14:00"), [], [quotedPlan("p", "q1", "2026-10-06", ny("2026-10-02", "14:00"))]), ny("2026-10-03", "10:00"));
    assert.equal(r.quoted?.first_required_date, "2026-10-06");
    assert.equal(obligationsOn(r, "2026-10-03", "call", ["quoted"]).length, 0);
    assert.equal(fx.explicit_date.default_overrides_selected_date, false);
  });
});

describe("P10a prospective cutover — Quoted (fixture p10a-prospective-cutover.json)", () => {
  const fx = fixture<FixtureFile<Record<string, unknown> & { id: string }>>("p10a-prospective-cutover.json");
  const byId = Object.fromEntries(fx.cases.map((c) => [c.id, c])) as Record<string, Record<string, unknown>>;
  const D = "2026-10-06";
  const activated = (minute: number, plans: ReturnType<typeof quotedPlan>[] = []) => {
    const at = nyMinute(D, minute);
    return scenario({ received_at: ny("2026-09-20", "10:00"), activation_at: at, periods: periods(["q1", "quoted", at, "activation"]), plans });
  };
  for (const id of ["quoted_active_1930", "quoted_active_1931"]) {
    test(id, () => {
      const c = byId[id] as { activation_minute: number; remaining_calls: number };
      const r = evaluate(activated(c.activation_minute, [quotedPlan("legacy", "q1", "2026-10-02", ny("2026-10-01", "10:00"))]), nyMinute(D, c.activation_minute));
      assert.equal(r.requirements.call.remaining, c.remaining_calls);
      if (c.remaining_calls > 0) assert.equal(obligationsOn(r, D, "call")[0]!.due_at, nyMinute(D, 1200));
    });
  }
  test("quoted_no_verified_schedule", () => {
    const r = evaluate(activated(600), nyMinute(D, 600));
    assert.equal(byId.quoted_no_verified_schedule!.first_date, "next_working_date");
    assert.equal(r.quoted?.first_required_date, addDays(D, 1));
    assert.equal(r.requirements.call.required, 0);
  });
  test("quoted_future_human_date", () => {
    const r = evaluate(activated(600, [quotedPlan("legacy", "q1", "2026-10-09", ny("2026-10-01", "10:00"))]), nyMinute(D, 600));
    assert.equal(byId.quoted_future_human_date!.selected_date_preserved, true);
    assert.equal(r.quoted?.selected_date, "2026-10-09");
    assert.equal(r.quoted?.basis, "human_selected");
    assert.equal(obligationsOn(r, "2026-10-07", "call").length + obligationsOn(r, "2026-10-08", "call").length, 0);
  });
});
