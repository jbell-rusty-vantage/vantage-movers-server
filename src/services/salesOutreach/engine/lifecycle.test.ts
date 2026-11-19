import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { addDays } from "./calendar";
import { callbackPlan, evaluate, fixture, ny, nyMinute, obligationsOn, outbound, period, periods, policyWith, scenario, sms, type FixtureFile } from "./testSupport";

describe("P05a return-to-New age (fixture p05a-return-to-new-age.json)", () => {
  const fx = fixture<FixtureFile<{ id: string; received_at: string; quoted_entry_date: string; returned_at: string; expected_schedule_day: number; closed_dates?: string[] }> & { subsequent_full_working_dates: Array<{ date: string; schedule_day: number; required_calls: number; required_sms: number }>; missing_anchor: { guessed: boolean; policy_available: boolean } }>("p05a-return-to-new-age.json");
  const build = (c: { received_at: string; quoted_entry_date: string; returned_at: string }) => {
    const quotedAt = c.quoted_entry_date === new Date(Date.parse(c.received_at)).toISOString().slice(0, 10) && Date.parse(ny(c.quoted_entry_date, "23:50")) < Date.parse(c.returned_at) ? ny(c.quoted_entry_date, "23:50") : ny(c.quoted_entry_date, "10:00");
    return scenario({ periods: periods(["n1", "new", c.received_at, "intake"], ["q1", "quoted", quotedAt, "transition"], ["n2", "new", c.returned_at, "transition"]) });
  };
  for (const c of fx.cases) {
    test(c.id, () => {
      const r = evaluate(build(c), c.returned_at, policyWith({ holidays: c.closed_dates ?? [] }));
      assert.equal(r.schedule_day, c.expected_schedule_day);
      assert.equal(r.workflow, "new");
      assert.equal(r.initial_response?.outcome === "open", false, "no fresh initial-response clock on return");
    });
  }
});

describe("P05b Priority 3 / P05c accepted unmapped code (fixtures p05b, p05c)", () => {
  const cases = [
    { file: "p05b-priority-three.json", workflow: "discretion" as const, priority: "3", state: "no_routine_cadence" },
    { file: "p05c-unmapped-priority.json", workflow: "none" as const, priority: "42", state: "no_policy_configured" },
  ];
  for (const k of cases) {
    const fx = fixture<FixtureFile<Record<string, unknown> & { id: string }>>(k.file);
    for (const c of fx.cases) {
      test(`${k.file.slice(0, 4)} ${c.id}`, () => {
        const prior = String(c.id).startsWith("quoted") ? "quoted" : "new";
        const T = ny("2026-10-04", "14:00");
        if (c.id === "closed_to_three" || c.id === "closed_to_unmapped") {
          const r = evaluate(scenario({ received_at: ny("2026-10-02", "09:00"), periods: periods(["n1", "new", ny("2026-10-02", "09:00"), "intake"], ["c1", "closed", ny("2026-10-03", "10:00"), "transition", "8"], ["x1", k.workflow, T, "transition", k.priority]) }), ny("2026-10-04", "15:00"));
          assert.equal(r.state, "closed", "no implicit reopen");
          return;
        }
        if (c.id === "unvouched_three" || c.id === "unvouched_unmapped") {
          // An unvouched code never reaches the engine as a period: the previous requirements stand.
          const r = evaluate(scenario({ periods: [period("n1", "new", ny("2026-10-02", "09:00"), "intake")] }), ny("2026-10-04", "15:00"));
          assert.equal(r.state, "active");
          assert.ok(r.requirements.call.required > 0);
          return;
        }
        if (c.id === "already_three" || c.id === "initial_unmapped") {
          const r = evaluate(scenario({ received_at: ny("2026-10-02", "09:00"), periods: [period("x1", k.workflow, ny("2026-10-02", "09:00"), "intake", null, k.priority)] }), ny("2026-10-05", "15:00"));
          assert.equal(r.obligations.length, 0);
          assert.equal(r.state, k.state);
          assert.equal(r.flags.review, k.workflow === "none");
          return;
        }
        const list: Parameters<typeof periods> = prior === "new"
          ? [["n1", "new", ny("2026-10-02", "09:00"), "intake"], ["x1", k.workflow, T, "transition", k.priority]]
          : [["n1", "new", ny("2026-10-02", "09:00"), "intake"], ["q1", "quoted", ny("2026-10-03", "09:00"), "transition"], ["x1", k.workflow, T, "transition", k.priority]];
        const events = [outbound(ny("2026-10-02", "09:10"))];
        const r = evaluate(scenario({ periods: periods(...list), events }), ny("2026-10-06", "15:00"));
        assert.equal(r.state, k.state);
        assert.equal(r.priority_raw, k.priority, "raw accepted code is visible");
        assert.equal(r.requirements.call.required, 0);
        assert.equal(r.requirements.sms.required, 0);
        const ended = r.obligations.filter((o) => o.period_id !== "x1");
        assert.ok(ended.some((o) => o.outcome === "superseded"), "outstanding routine requirements superseded");
        assert.ok(!ended.some((o) => o.outcome === "superseded" && o.fulfilled_by_event_id !== null), "no fulfillment created");
        assert.ok(ended.some((o) => o.outcome === "missed"), "historical misses retained");
        assert.equal(r.last_interaction_at, new Date(Date.parse(events[0]!.event_at)).toISOString(), "contact history retained");
        assert.notEqual(r.state, "closed");
        assert.equal(r.flags.review, k.workflow === "none", "Owner review visible for an unmapped code");
      });
    }
  }
});

describe("P05d known priority map — engine effect of closure codes (fixture p05d)", () => {
  const fx = fixture<{ priority_five: { routine_cadence_stopped: boolean; official_booking_created: boolean }; transition: { historical_misses_preserved: boolean; cancellation_is_fulfillment: boolean; implicit_reopen: boolean } }>("p05d-priority-map-manager-read.json");
  for (const code of ["5", "7", "8"]) {
    test(`accepted Priority ${code} stops and cancels routine work without fulfillment`, () => {
      const r = evaluate(scenario({ periods: periods(["n1", "new", ny("2026-10-02", "09:00"), "intake"], ["c1", "closed", ny("2026-10-04", "14:00"), "transition", code]) }), ny("2026-10-05", "10:00"));
      assert.equal(r.state, "closed");
      assert.equal(r.requirements.call.status, "not_required");
      const n1 = r.obligations.filter((o) => o.period_id === "n1");
      assert.ok(n1.some((o) => o.outcome === "cancelled"));
      assert.equal(n1.some((o) => o.outcome === "missed"), fx.transition.historical_misses_preserved);
      assert.equal(n1.some((o) => o.outcome === "cancelled" && o.fulfilled_by_event_id !== null), fx.transition.cancellation_is_fulfillment);
      assert.equal(fx.priority_five.routine_cadence_stopped, true);
    });
  }
  test("official Booking (subject closed) has the same stop effect", () => {
    const r = evaluate(scenario({ status: "closed", closed_at: ny("2026-10-04", "14:00"), periods: [period("n1", "new", ny("2026-10-02", "09:00"), "intake")] }), ny("2026-10-05", "10:00"));
    assert.equal(r.state, "closed");
    assert.equal(r.obligations.filter((o) => o.business_date === "2026-10-05").length, 0);
  });
});

describe("P05e intake default and uncertain priority — engine parts (fixture p05e)", () => {
  const fx = fixture<FixtureFile<Record<string, unknown> & { id: string }>>("p05e-intake-priority-uncertainty.json");
  for (const c of fx.cases) {
    test(c.id, () => {
      const received = ny("2026-10-04", "10:00");
      if (c.policy_origin === "intake_default") {
        const r = evaluate(scenario({ periods: [period("n1", "new", received, "intake", null, null)] }), ny("2026-10-04", "10:05"));
        assert.equal(r.workflow, c.cadence);
        assert.equal(r.priority_raw, null, "no fabricated Granot Priority 0");
        assert.equal(r.state, "active");
        return;
      }
      if (c.id === "granot_missing") {
        const r = evaluate(scenario({ status: "review", received_at: received, activation_at: received, periods: [] }), ny("2026-10-04", "10:05"));
        assert.equal(r.state, "review");
        assert.equal(r.obligations.length, 0, "no guessed cadence");
        return;
      }
      if (c.id === "blank_refresh" || c.id === "malformed_refresh") {
        const workflow = c.last_verified as "new" | "quoted";
        const list: Parameters<typeof periods> = workflow === "new" ? [["n1", "new", received, "intake"]] : [["n1", "new", received, "intake"], ["q1", "quoted", ny("2026-10-04", "12:00"), "transition"]];
        const plain = evaluate(scenario({ periods: periods(...list) }), ny("2026-10-06", "10:00"));
        const uncertain = evaluate(scenario({ periods: periods(...list), priority_uncertain: true }), ny("2026-10-06", "10:00"));
        assert.equal(uncertain.workflow, c.cadence);
        assert.deepEqual(uncertain.obligations, plain.obligations, "timeline not reset");
        assert.equal(uncertain.flags.priority_uncertain, c.uncertainty_visible);
        return;
      }
      const workflow = c.id === "accepted_three" ? "discretion" : "none";
      const r = evaluate(scenario({ periods: [period("x1", workflow, received, "intake", null, workflow === "none" ? "42" : "3")] }), ny("2026-10-04", "10:05"));
      assert.equal(r.state, c.label === "No routine cadence" ? "no_routine_cadence" : "no_policy_configured");
      assert.equal(r.obligations.length, 0);
    });
  }
});

describe("P05f partial-day reentry (fixture p05f-partial-day-reentry.json)", () => {
  const fx = fixture<FixtureFile<{ id: string; age_day: number; return_minute: number; prior_active_policy_call_credit?: number; prior_sms_credit?: number; call_remaining?: number; sms_required?: number; sms_remaining?: number; due_minute?: number }>>("p05f-partial-day-reentry.json");
  const R = "2026-10-01";
  for (const c of fx.cases) {
    test(c.id, () => {
      const date = addDays(R, c.age_day - 1);
      const T = nyMinute(date, c.return_minute);
      const events = [
        ...Array.from({ length: c.prior_active_policy_call_credit ?? 0 }, (_, i) => outbound(nyMinute(date, 600 + i * 70))),
        ...Array.from({ length: c.prior_sms_credit ?? 0 }, () => sms(nyMinute(date, 610))),
      ];
      const r = evaluate(scenario({ periods: periods(["n1", "new", nyMinute(R, 420), "intake"], ["q1", "quoted", nyMinute(R, 720), "transition"], ["n2", "new", T, "transition"]), events }), T);
      const calls = obligationsOn(r, date, "call").filter((o) => o.period_id === "n2");
      const smsObs = obligationsOn(r, date, "sms").filter((o) => o.period_id === "n2");
      if (c.call_remaining !== undefined) assert.equal(calls.filter((o) => o.outcome !== "fulfilled").length, c.call_remaining);
      if (c.sms_required !== undefined) assert.equal(smsObs.length, c.sms_required);
      if (c.sms_remaining !== undefined) assert.equal(smsObs.filter((o) => o.outcome !== "fulfilled").length, c.sms_remaining);
      if (c.due_minute !== undefined) for (const o of calls) assert.equal(o.due_at, nyMinute(date, c.due_minute));
      assert.ok(!calls.some((o) => o.due_at === nyMinute(date, 720)), "no fabricated noon deadline");
      assert.equal(r.initial_response?.outcome === "open", false, "initial clock not restarted");
      assert.equal(r.requirements.call.catch_up.outstanding, false, "superseded catch-up not revived");
      assert.equal(r.obligations.filter((o) => o.fulfilled_by_event_id !== null && events.every((e) => e.event_id !== o.fulfilled_by_event_id)).length, 0, "no duplicate credit");
    });
  }
});

describe("P05g move-date review (fixture p05g-move-date-review.json)", () => {
  const fx = fixture<FixtureFile<Record<string, unknown> & { id: string }>>("p05g-move-date-review.json");
  const asOf = ny("2026-10-06", "10:00");
  const base = (moveDate: string | null, workflow: "new" | "quoted" = "new") =>
    scenario({ move_date: moveDate, periods: workflow === "new" ? [period("n1", "new", ny("2026-10-04", "09:00"), "intake")] : periods(["n1", "new", ny("2026-10-04", "09:00"), "intake"], ["q1", "quoted", ny("2026-10-04", "12:00"), "transition"]) });
  for (const c of fx.cases) {
    test(c.id, () => {
      if (c.id === "passed_new" || c.id === "passed_quoted") {
        const workflow = c.id === "passed_new" ? "new" : "quoted";
        const r = evaluate(base("2026-10-05", workflow), asOf);
        const control = evaluate(base("2026-12-01", workflow), asOf);
        assert.equal(r.flags.move_date_passed, true);
        assert.equal(r.workflow, c.cadence);
        assert.equal(r.state, "active", "not auto-closed");
        assert.deepEqual(r.obligations, control.obligations, "cadence unchanged");
      } else if (c.id === "unknown") {
        const r = evaluate(base(null), asOf);
        assert.equal(r.flags.move_date_unknown, true);
        assert.ok(r.requirements.call.required > 0, "cadence continues");
      } else {
        const a = evaluate(base("2026-10-20"), asOf);
        const b = evaluate(base("2026-11-02"), asOf);
        assert.equal(a.schedule_day, b.schedule_day, "no age reset");
        assert.deepEqual(a.obligations, b.obligations, "history not erased");
      }
    });
  }
});

describe("P10a prospective cutover — New and boundary (fixture p10a-prospective-cutover.json)", () => {
  const fx = fixture<FixtureFile<Record<string, unknown> & { id: string }> & { new_pre_activation_misses: number; new_pre_activation_catchup: number; old_lead_initial_clock_restarted: boolean; missing_age_review: boolean; retry_reprices_boundary: boolean; past_due_legacy_callback: string; pending_verified_human_callbacks_preserved: boolean }>("p10a-prospective-cutover.json");
  const R = "2026-09-29";
  const D = addDays(R, 7); // Day 8
  const activated = (minute: number, extra: Partial<Parameters<typeof scenario>[0]> = {}) => {
    const at = nyMinute(D, minute);
    return scenario({ received_at: nyMinute(R, 600), activation_at: at, periods: [period("n1", "new", at, "activation")], ...extra });
  };
  test("no pre-activation misses or catch-up debt", () => {
    const r = evaluate(activated(480), nyMinute(addDays(D, 1), 600));
    const before = r.obligations.filter((o) => Date.parse(o.due_at ?? o.opens_at) < Date.parse(nyMinute(D, 480)));
    assert.equal(before.length, fx.new_pre_activation_misses);
    assert.equal(r.window_history.filter((e) => e.business_date < D).reduce((n, e) => n + e.call.missed + e.sms.missed, 0), fx.new_pre_activation_catchup);
  });
});

describe("olr A4 — closed and dateless review subjects are quiet (no midnight re-evaluation)", () => {
  // Received Friday 2026-10-02, New; closed by an accepted Priority 8 on Sunday 2026-10-04 14:00.
  const closedByCode = () =>
    scenario({
      move_date: null,
      periods: periods(["n1", "new", ny("2026-10-02", "09:00"), "intake"], ["c1", "closed", ny("2026-10-04", "14:00"), "transition", "8"]),
      events: [outbound(ny("2026-10-02", "09:10"), { outcome: "answered" }), sms(ny("2026-10-02", "09:20"))],
    });
  // Official Booking: the subject itself is closed at 2026-10-04 14:00.
  const closedByBooking = () =>
    scenario({ move_date: null, status: "closed", closed_at: ny("2026-10-04", "14:00"), periods: [period("n1", "new", ny("2026-10-02", "09:00"), "intake")] });
  const datelessReview = (plans: Parameters<typeof scenario>[0]["plans"] = []) =>
    scenario({ received_at: null, status: "review", move_date: null, activation_at: ny("2026-10-05", "08:00"), periods: [], plans });

  test("a closed subject has next_evaluation_at null and the same fingerprint on D+1 and D+30", () => {
    for (const input of [closedByCode(), closedByBooking()]) {
      const atClosure = evaluate(input, ny("2026-10-04", "14:05"));
      const d1 = evaluate(input, ny("2026-10-05", "00:00"));
      const d30 = evaluate(input, ny("2026-11-03", "10:00"));
      for (const r of [atClosure, d1, d30]) {
        assert.equal(r.state, "closed");
        assert.equal(r.next_evaluation_at, null, "no midnight wake for a closed subject");
        assert.equal(r.schedule_day, null);
        assert.deepEqual([r.requirements.call.status, r.requirements.call.required], ["not_required", 0]);
        assert.deepEqual([r.requirements.sms.status, r.requirements.sms.required], ["not_required", 0]);
      }
      assert.notEqual(d1.business_date, d30.business_date);
      assert.equal(d1.fingerprint, d30.fingerprint, "D+1 and D+30 write the same projection");
      assert.equal(atClosure.fingerprint, d1.fingerprint, "nothing changes after the closure instant either");
    }
  });

  test("a review subject with a pending callback keeps its next evaluation", () => {
    const plans = [callbackPlan("cb1", "n0", ny("2026-10-06", "15:00"), ny("2026-10-05", "10:00"))];
    const r = evaluate(datelessReview(plans), ny("2026-10-05", "12:00"));
    assert.equal(r.state, "review");
    assert.notEqual(r.next_evaluation_at, null);
    assert.ok(Date.parse(r.next_evaluation_at!) <= Date.parse(ny("2026-10-06", "15:00")));
  });
});
