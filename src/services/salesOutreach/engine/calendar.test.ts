import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { addDays, BusinessCalendar, businessDateOf, localInstant, minuteOfDay, scheduleDay } from "./calendar";
import { evaluate, fixture, period, POLICY, policyWith, scenario, TZ, type FixtureFile } from "./testSupport";

const cal = new BusinessCalendar(POLICY.calendar);
const ms = (iso: string) => Date.parse(iso);

describe("P02a calendar age (fixture p02a-calendar-age.json)", () => {
  const fx = fixture<FixtureFile<{ id: string; received_at: string; as_of: string; received_date: string; business_date: string; schedule_day: number; elapsed_hours?: number }>>("p02a-calendar-age.json");
  for (const c of fx.cases) {
    test(c.id, () => {
      assert.equal(businessDateOf(ms(c.received_at), TZ), c.received_date);
      assert.equal(businessDateOf(ms(c.as_of), TZ), c.business_date);
      assert.equal(scheduleDay(c.received_date, c.business_date), c.schedule_day);
      if (c.elapsed_hours !== undefined) {
        // The local day is 23/25 hours long: next local midnight is not +24h.
        const start = localInstant(c.received_date, 0, TZ);
        const next = localInstant(addDays(c.received_date, 1), 0, TZ);
        assert.equal((next - start) / 3_600_000, c.elapsed_hours);
      }
      // Engine agrees.
      const r = evaluate(scenario({ periods: [period("p1", "new", c.received_at, "intake")] }), c.as_of);
      assert.equal(r.schedule_day, c.schedule_day);
      assert.equal(r.business_date, c.business_date);
    });
  }
});

describe("P02b seven-day working week (fixture p02b-working-week.json)", () => {
  const fx = fixture<FixtureFile<{ id: string; received_date: string; business_date: string; schedule_day: number; working_day: boolean; required_calls: number; required_sms: number }>>("p02b-working-week.json");
  for (const c of fx.cases) {
    test(c.id, () => {
      assert.equal(cal.isWorkingDate(c.business_date), c.working_day);
      assert.equal(scheduleDay(c.received_date, c.business_date), c.schedule_day);
      // Full-day eligible New work on that date: received before opening on the received date.
      const r = evaluate(scenario({ periods: [period("p1", "new", localIso(c.received_date, 420), "intake")] }), localIso(c.business_date, 600));
      assert.equal(r.requirements.call.required, c.required_calls);
      assert.equal(r.requirements.sms.required, c.required_sms);
    });
  }
});

describe("P02c working hours (fixture p02c-working-hours.json)", () => {
  const fx = fixture<{ opening_minute: number; closing_minute: number; cases: Array<{ id: string; instant: string; local_minute: number; inside_window: boolean }>; arrival_examples: Array<{ id: string; received_at: string; next_opening_at?: string; schedule_day_at_next_opening?: number; working_minutes_until_close?: number }> }>("p02c-working-hours.json");
  assert.deepEqual([POLICY.calendar.opening_minute, POLICY.calendar.closing_minute], [fx.opening_minute, fx.closing_minute]);
  for (const c of fx.cases) {
    test(c.id, () => {
      assert.equal(minuteOfDay(ms(c.instant), TZ), c.local_minute);
      assert.equal(cal.isWithinOrdinaryHours(ms(c.instant)), c.inside_window);
    });
  }
  for (const c of fx.arrival_examples) {
    test(`arrival ${c.id}`, () => {
      const received = ms(c.received_at);
      if (c.next_opening_at) {
        const next = cal.nextWorkingDateAfter(cal.dateOf(received))!;
        assert.equal(new Date(cal.opening(next)).toISOString(), new Date(c.next_opening_at).toISOString());
        assert.equal(scheduleDay(cal.dateOf(received), next), c.schedule_day_at_next_opening);
      }
      if (c.working_minutes_until_close !== undefined) {
        assert.equal((cal.closing(cal.dateOf(received)) - received) / 60_000, c.working_minutes_until_close);
      }
    });
  }
});

describe("P02d first-call deadline: 30 working minutes with overnight carry and DST (fixture p02d)", () => {
  const fx = fixture<FixtureFile<{ id: string; received_at: string; first_call_due_at: string }>>("p02d-first-call-deadline.json");
  for (const c of fx.cases) {
    test(c.id, () => {
      const due = cal.addWorkingMinutes(ms(c.received_at), 30);
      assert.equal(new Date(due!).toISOString(), new Date(c.first_call_due_at).toISOString());
      const r = evaluate(scenario({ periods: [period("p1", "new", c.received_at, "intake")] }), c.received_at);
      assert.equal(r.initial_response?.due_at, new Date(c.first_call_due_at).toISOString());
    });
  }
});

describe("P02i Owner closures (fixture p02i-closures.json, calendar parts)", () => {
  const fx = fixture<FixtureFile<Record<string, unknown> & { id: string }>>("p02i-closures.json");
  const byId = Object.fromEntries(fx.cases.map((c) => [c.id, c]));

  test("first_call_skips_monday", () => {
    const c = byId.first_call_skips_monday as { received_at: string; closed_dates: string[]; first_call_due_at: string; schedule_day_at_due: number };
    const policy = policyWith({ holidays: c.closed_dates });
    const r = evaluate(scenario({ periods: [period("p1", "new", c.received_at, "intake")] }), c.received_at, policy);
    assert.equal(r.initial_response?.due_at, new Date(c.first_call_due_at).toISOString());
    assert.equal(scheduleDay(businessDateOf(ms(c.received_at), TZ), businessDateOf(ms(c.first_call_due_at), TZ)), c.schedule_day_at_due);
  });

  test("arrival_on_closed_sunday", () => {
    const c = byId.arrival_on_closed_sunday as { received_at: string; closed_dates: string[]; routine_calls_required_on_receipt_date: number; routine_sms_required_on_receipt_date: number; first_call_due_at: string; schedule_day_at_due: number };
    const policy = policyWith({ holidays: c.closed_dates });
    const r = evaluate(scenario({ periods: [period("p1", "new", c.received_at, "intake")] }), c.received_at, policy);
    assert.equal(r.requirements.call.required, c.routine_calls_required_on_receipt_date);
    assert.equal(r.requirements.sms.required, c.routine_sms_required_on_receipt_date);
    assert.equal(r.initial_response?.due_at, new Date(c.first_call_due_at).toISOString());
    assert.equal(scheduleDay(businessDateOf(ms(c.received_at), TZ), businessDateOf(ms(c.first_call_due_at), TZ)), c.schedule_day_at_due);
  });

  test("unlisted_public_holiday stays a working date (no automatic holidays)", () => {
    assert.equal(cal.isWorkingDate("2026-11-26"), true);
    assert.equal(cal.isWorkingDate("2026-12-25"), true);
    assert.deepEqual(POLICY.calendar.closed_dates, []);
  });
});

describe("calendar DST mechanics", () => {
  test("opening/closing resolve per date offset (EDT vs EST)", () => {
    assert.equal(new Date(cal.opening("2026-10-31")).toISOString(), "2026-10-31T12:00:00.000Z");
    assert.equal(new Date(cal.opening("2026-11-01")).toISOString(), "2026-11-01T13:00:00.000Z");
    assert.equal(new Date(cal.closing("2026-03-08")).toISOString(), "2026-03-09T00:00:00.000Z");
    assert.equal(new Date(cal.opening("2026-03-07")).toISOString(), "2026-03-07T13:00:00.000Z");
  });
  test("nonexistent spring-forward local time moves forward; ambiguous fall-back time takes the first occurrence", () => {
    assert.equal(new Date(localInstant("2026-03-08", 150, TZ)).toISOString(), "2026-03-08T07:30:00.000Z");
    assert.equal(new Date(localInstant("2026-11-01", 90, TZ)).toISOString(), "2026-11-01T05:30:00.000Z");
  });
  test("next date is calendar arithmetic across month/year ends", () => {
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
    assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  });
  test("an open-ended block makes the working-minute deadline unknown", () => {
    assert.equal(cal.addWorkingMinutes(ms("2026-10-04T14:00:00Z"), 30, [[ms("2026-10-04T14:10:00Z"), Number.POSITIVE_INFINITY]]), null);
  });
});

function localIso(date: string, minute: number): string {
  return new Date(localInstant(date, minute, TZ)).toISOString();
}
