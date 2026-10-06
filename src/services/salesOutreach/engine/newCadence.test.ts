import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { addDays } from "./calendar";
import { selectSpacedStarts } from "./credit";
import { isFixedSmsDay } from "./newCadence";
import { evaluate, fixture, minutesAfter, ny, nyMinute, obligationsOn, outbound, period, periods, POLICY, policyWith, scenario, sms, type FixtureFile } from "./testSupport";

/** A New subject received before opening on `received` (full arrival allowance), evaluated later. */
function newSubject(received: string, events: ReturnType<typeof outbound>[] = [], extra: Parameters<typeof scenario>[0] extends infer S ? Partial<S> : never = {}) {
  return scenario({ periods: [period("p1", "new", nyMinute(received, 420), "intake")], events, ...extra });
}
const R = "2026-10-01";
const dayDate = (day: number) => addDays(R, day - 1);

describe("P01 call count (fixture p01-call-count.json)", () => {
  const fx = fixture<FixtureFile<{ id: string; schedule_day: number; verified_calls: number; required_calls: number; remaining_required_calls: number; optional_additional_calls: number; required_sms?: number; verified_sms?: number; remaining_required_sms?: number }>>("p01-call-count.json");
  for (const c of fx.cases) {
    test(c.id, () => {
      const date = dayDate(c.schedule_day);
      const calls = Array.from({ length: c.verified_calls }, (_, i) => outbound(nyMinute(date, 600 + i * 90)));
      const r = evaluate(newSubject(R, calls), nyMinute(date, 1140));
      assert.equal(r.schedule_day, c.schedule_day);
      assert.equal(r.requirements.call.required, c.required_calls);
      assert.equal(r.requirements.call.remaining, c.remaining_required_calls);
      const fulfilledIds = new Set(r.obligations.map((o) => o.fulfilled_by_event_id).filter(Boolean));
      const extra = calls.filter((e) => !fulfilledIds.has(e.event_id)).length;
      assert.equal(extra, c.optional_additional_calls);
      if (extra > 0) assert.ok(extra <= POLICY.new_cadence.call_bands[0]!.optional_extra_calls, "optional third never creates a miss");
      if (c.required_sms !== undefined) {
        assert.equal(r.requirements.sms.required, c.required_sms);
        assert.equal(r.requirements.sms.verified_completed, c.verified_sms);
        assert.equal(r.requirements.sms.remaining, c.remaining_required_sms);
      }
    });
  }
});

describe("P02e cadence spacing (fixture p02e-call-spacing.json)", () => {
  const fx = fixture<{ initial_spacing_minutes: number; cases: Array<{ id: string; call_offsets_minutes: number[]; expected_cadence_credit_indices: number[] }>; config_edit_example: { new_spacing_minutes: number; call_offsets_minutes: number[]; expected_cadence_credit_indices: number[] } }>("p02e-call-spacing.json");
  assert.equal(POLICY.new_cadence.spacing_minutes, fx.initial_spacing_minutes);
  const run = (offsets: number[], spacing: number, expected: number[]) => {
    assert.deepEqual(selectSpacedStarts(offsets.map((m) => m * 60_000), spacing), expected);
    // Engine: Day 4 (two slots + catch-up from earlier misses) — which calls earned cadence credit.
    const date = dayDate(4);
    const calls = offsets.map((m) => outbound(minutesAfter(nyMinute(date, 540), m)));
    const r = evaluate(newSubject(R, calls), nyMinute(date, 1190), policyWith({ new_call_min_spacing_minutes: spacing }));
    const credited = new Set(r.obligations.filter((o) => o.business_date === date).map((o) => o.fulfilled_by_event_id));
    assert.deepEqual(calls.map((e, i) => (credited.has(e.event_id) ? i : -1)).filter((i) => i >= 0), expected);
  };
  for (const c of fx.cases) test(c.id, () => run(c.call_offsets_minutes, fx.initial_spacing_minutes, c.expected_cadence_credit_indices));
  test("config_edit_example (synthetic 90-minute spacing, reloadable policy)", () =>
    run(fx.config_edit_example.call_offsets_minutes, fx.config_edit_example.new_spacing_minutes, fx.config_edit_example.expected_cadence_credit_indices));
});

describe("P02f New daily deadlines (fixture p02f-new-daily-deadlines.json)", () => {
  const fx = fixture<FixtureFile<{ id: string; schedule_day: number; as_of_minute: number; call_start_minutes: number[]; required_calls: number; verified_completed: number; remaining: number; first_deadline_missed?: boolean; current_overdue: boolean; second_requirement_due_minute?: number }>>("p02f-new-daily-deadlines.json");
  for (const c of fx.cases) {
    test(c.id, () => {
      const date = dayDate(c.schedule_day);
      const r = evaluate(newSubject(R, c.call_start_minutes.map((m) => outbound(nyMinute(date, m)))), nyMinute(date, c.as_of_minute));
      const call = r.requirements.call;
      assert.equal(call.required, c.required_calls);
      assert.equal(call.verified_completed, c.verified_completed);
      assert.equal(call.remaining, c.remaining);
      assert.equal(call.status === "overdue", c.current_overdue);
      const slots = obligationsOn(r, date, "call");
      if (c.first_deadline_missed !== undefined) assert.equal(slots[0]!.deadline_missed, c.first_deadline_missed);
      if (c.second_requirement_due_minute !== undefined) assert.equal(slots[1]!.due_at, nyMinute(date, c.second_requirement_due_minute));
    });
  }
});

describe("P02g arrival-date calls (fixture p02g-arrival-day-calls.json)", () => {
  const fx = fixture<FixtureFile<{ id: string; arrival_minute: number; arrival_date_required_calls: number; first_due_day_offset: number; first_due_minute: number; second_due_minute: number | null; past_noon_deadline: boolean; arrival_quota_waived_not_missed?: boolean }> & { next_day_example: { schedule_day: number; required_calls: number; remaining_required_calls: number } }>("p02g-arrival-day-calls.json");
  const SUNDAY = "2026-10-04";
  for (const c of fx.cases) {
    test(c.id, () => {
      const received = nyMinute(SUNDAY, c.arrival_minute);
      const r = evaluate(scenario({ periods: [period("p1", "new", received, "intake")] }), received);
      const slots = obligationsOn(r, SUNDAY, "call");
      assert.equal(slots.length, c.arrival_date_required_calls);
      assert.equal(r.initial_response?.due_at, nyMinute(addDays(SUNDAY, c.first_due_day_offset), c.first_due_minute));
      assert.equal(slots[1]?.due_at ?? null, c.second_due_minute === null ? null : nyMinute(SUNDAY, c.second_due_minute));
      assert.equal(slots.some((o) => o.due_at === nyMinute(SUNDAY, 720)), c.past_noon_deadline);
      if (c.arrival_quota_waived_not_missed) {
        const later = evaluate(scenario({ periods: [period("p1", "new", received, "intake")] }), nyMinute(addDays(SUNDAY, 1), 0));
        assert.equal(later.obligations.filter((o) => o.deadline_missed).length, 0, "waiver is not a miss");
      }
    });
  }
  test("next_day_example: the carried initial-response call satisfies one Day 2 call, no extra third obligation", () => {
    const received = nyMinute(SUNDAY, 1185);
    const monday = addDays(SUNDAY, 1);
    const r = evaluate(scenario({ periods: [period("p1", "new", received, "intake")], events: [outbound(nyMinute(monday, 490))] }), nyMinute(monday, 540));
    assert.equal(r.schedule_day, fx.next_day_example.schedule_day);
    assert.equal(r.initial_response?.outcome, "fulfilled");
    assert.equal(r.requirements.call.required, fx.next_day_example.required_calls);
    assert.equal(r.requirements.call.remaining, fx.next_day_example.remaining_required_calls);
    assert.equal(obligationsOn(r, monday, "call").length, 2);
  });
});

describe("P02h SMS deadline and arrival allowance (fixture p02h-sms-deadline-allowance.json)", () => {
  const fx = fixture<FixtureFile<{ id: string; arrival_minute: number; arrival_date_required_sms: number; due_minute: number | null; waived_not_missed: boolean }> & Record<string, Record<string, number | boolean>>>("p02h-sms-deadline-allowance.json");
  const SUNDAY = "2026-10-04";
  for (const c of fx.cases) {
    test(c.id, () => {
      const received = nyMinute(SUNDAY, c.arrival_minute);
      const r = evaluate(scenario({ periods: [period("p1", "new", received, "intake")] }), received);
      const smsObs = obligationsOn(r, SUNDAY, "sms");
      assert.equal(smsObs.length, c.arrival_date_required_sms);
      assert.equal(smsObs[0]?.due_at ?? null, c.due_minute === null ? null : nyMinute(SUNDAY, c.due_minute));
      if (c.waived_not_missed) {
        const monday = addDays(SUNDAY, 1);
        const next = evaluate(scenario({ periods: [period("p1", "new", received, "intake")] }), nyMinute(monday, 600));
        assert.equal(obligationsOn(next, monday, "sms").length, 1, "next date ordinary one only, no extra SMS debt");
        assert.equal(next.requirements.sms.catch_up.outstanding, false);
      }
    });
  }
  test("next_day_example: Day 2 one SMS due 20:00, no extra debt", () => {
    const ex = fx.next_day_example as { schedule_day: number; required_sms: number; due_minute: number };
    const date = dayDate(ex.schedule_day);
    const r = evaluate(newSubject(R, [sms(nyMinute(R, 600))]), nyMinute(date, 600));
    const smsObs = obligationsOn(r, date, "sms");
    assert.equal(smsObs.length, ex.required_sms);
    assert.equal(smsObs[0]!.due_at, nyMinute(date, ex.due_minute));
    assert.equal(r.requirements.sms.catch_up.outstanding, false);
  });
  test("independence_example: calls cannot satisfy SMS", () => {
    const ex = fx.independence_example as { calls_remaining: number; verified_sms: number; sms_remaining: number };
    const date = dayDate(2);
    const r = evaluate(newSubject(R, [outbound(nyMinute(date, 600)), outbound(nyMinute(date, 700))]), nyMinute(date, 900));
    assert.equal(r.requirements.call.remaining, ex.calls_remaining);
    assert.equal(r.requirements.sms.verified_completed, ex.verified_sms);
    assert.equal(r.requirements.sms.remaining, ex.sms_remaining);
  });
  test("fixed_sequence_example: Day 6 SMS due 20:00; an extra Day 7 send does not shift Day 9", () => {
    const ex = fx.fixed_sequence_example as { schedule_day: number; required_sms: number; due_minute: number };
    const r = evaluate(newSubject(R, [sms(nyMinute(dayDate(7), 600))]), nyMinute(dayDate(9), 600));
    assert.equal(obligationsOn(r, dayDate(ex.schedule_day), "sms").length, ex.required_sms);
    assert.equal(obligationsOn(r, dayDate(ex.schedule_day), "sms")[0]!.due_at, nyMinute(dayDate(ex.schedule_day), ex.due_minute));
    assert.equal(obligationsOn(r, dayDate(9), "sms").length, 1);
    assert.equal(obligationsOn(r, dayDate(7), "sms").length, 0);
  });
});

describe("P03 fixed SMS sequence (fixture p03-fixed-sms.json)", () => {
  const fx = fixture<{ required_days_through_13: number[]; required_dates: string[]; cases: Array<{ id: string; extra_send_day?: number; missed_day?: number; next_required_day: number; send_schedule_day?: number; capture_schedule_day?: number; evaluation_schedule_day?: number }> }>("p03-fixed-sms.json");
  const received = "2026-10-02";
  const at = (day: number, minute = 600) => nyMinute(addDays(received, day - 1), minute);
  const base = (events: ReturnType<typeof sms>[]) => scenario({ periods: [period("p1", "new", nyMinute(received, 420), "intake")], events });
  test("required days/dates through Day 13", () => {
    const days = Array.from({ length: 13 }, (_, i) => i + 1).filter((d) => isFixedSmsDay(d, POLICY));
    assert.deepEqual(days, fx.required_days_through_13);
    const r = evaluate(base([]), at(13, 1300));
    const dates = [...new Set(r.obligations.filter((o) => o.channel === "sms").map((o) => o.business_date))].filter((d) => d <= "2026-10-14");
    assert.deepEqual(dates, fx.required_dates);
  });
  for (const c of fx.cases) {
    test(c.id, () => {
      if (c.extra_send_day !== undefined || c.missed_day !== undefined) {
        const events = c.extra_send_day ? [sms(at(c.extra_send_day))] : [1, 2].map((d) => sms(at(d)));
        const fromDay = (c.extra_send_day ?? c.missed_day)!;
        const r = evaluate(base(events), at(fromDay, 1300));
        const next = r.obligations.filter((o) => o.channel === "sms" && o.business_date > addDays(received, fromDay - 1)).map((o) => o.business_date)[0];
        assert.equal(next, addDays(received, c.next_required_day - 1));
        if (c.missed_day) assert.equal(obligationsOn(r, addDays(received, c.missed_day - 1), "sms")[0]!.outcome, "missed");
      } else {
        // Late capture: the send's own event time (Day 3) is evaluated, not the capture date (Day 4).
        const r = evaluate(base([sms(at(c.send_schedule_day!))]), at(c.capture_schedule_day!, 900));
        assert.equal(obligationsOn(r, addDays(received, c.evaluation_schedule_day! - 1), "sms")[0]!.outcome, "fulfilled");
      }
    });
  }
});

describe("P02i closures — closed Day 6 waives the fixed SMS without moving the sequence", () => {
  const fx = fixture<FixtureFile<{ id: string; received_date?: string; closed_date?: string; schedule_day?: number; next_fixed_sms_date?: string; next_fixed_sms_day?: number }>>("p02i-closures.json");
  const c = fx.cases.find((x) => x.id === "closed_day_six_sms")!;
  test("closed_day_six_sms", () => {
    const policy = policyWith({ holidays: [c.closed_date!] });
    const r = evaluate(scenario({ periods: [period("p1", "new", nyMinute(c.received_date!, 420), "intake")] }), nyMinute(c.next_fixed_sms_date!, 600), policy);
    assert.equal(obligationsOn(r, c.closed_date!, "call").length, 0);
    assert.equal(obligationsOn(r, c.closed_date!, "sms").length, 0);
    const entry = r.window_history.find((e) => e.business_date === c.closed_date)!;
    assert.equal(entry.closed_date, true);
    assert.equal(entry.schedule_day, c.schedule_day, "age keeps advancing on a closed date");
    assert.equal(entry.call.missed + entry.sms.missed, 0, "waived, not missed");
    const nextSms = r.obligations.filter((o) => o.channel === "sms" && o.business_date > c.closed_date!)[0]!;
    assert.equal(nextSms.business_date, c.next_fixed_sms_date);
    assert.equal(r.schedule_day, c.next_fixed_sms_day);
    assert.ok(r.obligations.some((o) => o.business_date < c.closed_date! && o.outcome === "missed"), "historical misses are not erased");
  });
});

describe("olr A6 (D-A6) — the spacing anchor is seeded from pre-start same-date calls", () => {
  // Tuesday 2026-10-06 is Day 4 for a Lead received Saturday 10:00 (two calls; one left after a prior call).
  const TUE = "2026-10-06";
  const RECEIVED = ny("2026-10-03", "10:00");
  const startCalls = (r: ReturnType<typeof evaluate>, periodId: string) => obligationsOn(r, TUE, "call").filter((o) => o.period_id === periodId);
  const activated = (events: ReturnType<typeof outbound>[]) =>
    scenario({ received_at: RECEIVED, activation_at: ny(TUE, "10:00"), periods: [period("a1", "new", ny(TUE, "10:00"), "activation")], events });

  test("activation partial start: a call within 60 min of a counted prior same-date call is not credited; one at ≥ 60 min is", () => {
    const prior = outbound(ny(TUE, "09:30"));
    const close = outbound(ny(TUE, "10:05"));
    const r = evaluate(activated([prior, close]), ny(TUE, "10:20"));
    const obs = startCalls(r, "a1");
    assert.equal(obs.length, 1, "quota 2 minus the counted prior call");
    assert.equal(obs[0]!.fulfilled_by_event_id, null, "35 min after the prior call: not spaced");
    assert.equal(r.requirements.call.remaining, 1);

    const spaced = outbound(ny(TUE, "10:30"));
    const later = evaluate(activated([prior, close, spaced]), ny(TUE, "10:45"));
    assert.equal(startCalls(later, "a1")[0]!.fulfilled_by_event_id, spaced.event_id, "60 min after the prior call: credited");
  });

  test("transition partial start: same", () => {
    // Quoted from Tuesday 08:00 (its first required date is Wednesday), back to New at 10:00.
    const list = periods(["n1", "new", RECEIVED, "intake"], ["q1", "quoted", ny(TUE, "08:00"), "transition"], ["n2", "new", ny(TUE, "10:00"), "transition"]);
    const prior = outbound(ny(TUE, "09:30"));
    const close = outbound(ny(TUE, "10:05"));
    const r = evaluate(scenario({ periods: list, events: [prior, close] }), ny(TUE, "10:20"));
    const obs = startCalls(r, "n2");
    assert.equal(obs.length, 1);
    assert.equal(obs[0]!.fulfilled_by_event_id, null);
    const spaced = outbound(ny(TUE, "10:30"));
    const later = evaluate(scenario({ periods: list, events: [prior, close, spaced] }), ny(TUE, "10:45"));
    assert.equal(startCalls(later, "n2")[0]!.fulfilled_by_event_id, spaced.event_id);
  });

  test("intake (no prior) unchanged: the first call after receipt credits the initial response and an arrival call", () => {
    const first = outbound(ny(TUE, "10:05"));
    const r = evaluate(scenario({ periods: [period("i1", "new", ny(TUE, "10:00"), "intake")], events: [first] }), ny(TUE, "10:20"));
    assert.equal(r.initial_response?.outcome, "fulfilled");
    assert.equal(startCalls(r, "i1").filter((o) => o.fulfilled_by_event_id === first.event_id).length, 1);
  });
});
