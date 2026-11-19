/**
 * olr A1 — the pending trap (engine v2). A passed deadline is a verdict only once coverage reaches it;
 * until then its obligation is `pending` and the channel reads `due` (not yet verified, SPEC §10.3,
 * D-A1b) while the channel has coverage. `coverage_wait` names the deadline the evaluate sweep pulls on.
 * `pending` narrows to evidence uncertainty (unconfirmed evidence, or a channel with no coverage).
 *
 * Scenario: FINAL-01, Tuesday 2026-10-06 (EDT). A New intake received the prior Saturday is on Day 4
 * (two calls due 12:00 and 20:00, no SMS); activation at Tuesday 00:00 keeps earlier days out of it.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { evaluate, ny, obligationsOn, outbound, period, scenario } from "./testSupport";

const TUE = "2026-10-06";
const WED = "2026-10-07";

function day4(opts: { events?: ReturnType<typeof outbound>[]; call_complete_through?: string | null; sms_complete_through?: string | null } = {}) {
  return scenario({
    received_at: ny("2026-10-03", "10:00"),
    activation_at: ny(TUE, "00:00"),
    periods: [period("n1", "new", ny("2026-10-03", "10:00"), "intake")],
    ...opts,
  });
}

/** Day 2 on Tuesday (received Monday 10:00), activation Tuesday 00:00. Day 2 is a fixed SMS day. */
function day2(opts: { events?: ReturnType<typeof outbound>[]; call_complete_through?: string | null; sms_complete_through?: string | null } = {}) {
  return scenario({
    received_at: ny("2026-10-05", "10:00"),
    activation_at: ny(TUE, "00:00"),
    periods: [period("n1", "new", ny("2026-10-05", "10:00"), "intake")],
    ...opts,
  });
}

const callAt = (r: ReturnType<typeof evaluate>, hhmm: string) => obligationsOn(r, TUE, "call").find((o) => o.due_at === ny(TUE, hhmm))!;
const historyOf = (r: ReturnType<typeof evaluate>, date: string) => r.window_history.find((e) => e.business_date === date)!;

describe("olr A1 — coverage-gated verdicts (engine v2)", () => {

  test("mirror: a call confirmed late (19:55, seen after coverage catches up) → fulfilled, no miss", () => {
    const noonCall = outbound(ny(TUE, "11:00"));
    const first = evaluate(day4({ events: [noonCall], call_complete_through: ny(TUE, "19:43") }), ny(TUE, "20:00"));
    assert.equal(callAt(first, "20:00").outcome, "pending");
    assert.equal(first.requirements.call.status, "due");
    assert.equal(first.coverage_wait.call, ny(TUE, "20:00"));

    const late = outbound(ny(TUE, "19:55"));
    const second = evaluate(day4({ events: [noonCall, late], call_complete_through: ny(TUE, "20:01") }), ny(TUE, "20:20"));
    const evening = callAt(second, "20:00");
    assert.equal(evening.outcome, "fulfilled", "in time, not fulfilled_late");
    assert.equal(evening.fulfilled_by_event_id, late.event_id);
    assert.equal(evening.deadline_missed, false);
    assert.equal(second.requirements.call.catch_up.outstanding, false);
    assert.equal(second.requirements.call.status, "completed");
    assert.equal(second.requirements.call.completion_kind, "fulfilled_in_window");
    assert.equal(historyOf(second, TUE).call.missed, 0);
    assert.equal(second.coverage_wait.call, null);
  });

  test("awaiting-confirmation evidence keeps pending (evidence uncertainty) and still waits on coverage", () => {
    const awaiting = outbound(ny(TUE, "11:55"), { verification: "awaiting_confirmation" });
    const r = evaluate(day4({ events: [awaiting], call_complete_through: ny(TUE, "11:48") }), ny(TUE, "12:05"));
    assert.equal(callAt(r, "12:00").outcome, "pending");
    assert.equal(r.requirements.call.status, "pending");
    assert.equal(r.requirements.call.completion_kind, "evidence_pending");
    assert.equal(r.flags.pending, true);
    assert.equal(r.flags.needs_contact, false);
    assert.equal(r.coverage_wait.call, ny(TUE, "12:00"));

    // Coverage passes the deadline while the call is still unconfirmed: still pending, no longer waiting on coverage.
    const covered = evaluate(day4({ events: [awaiting], call_complete_through: ny(TUE, "12:10") }), ny(TUE, "12:20"));
    assert.equal(covered.requirements.call.status, "pending");
    assert.equal(covered.coverage_wait.call, null);
  });

  test("no SMS coverage keeps SMS pending (not due), and its wait is recorded for when capture connects", () => {
    const r = evaluate(day2({ sms_complete_through: null }), ny(TUE, "20:05"));
    assert.equal(obligationsOn(r, TUE, "sms")[0]!.outcome, "pending");
    assert.equal(r.requirements.sms.status, "pending");
    assert.equal(r.requirements.sms.verified_completed, null, "a pending count is null, never a false zero");
    assert.equal(r.coverage_wait.sms, ny(TUE, "20:00"));
  });

  test("a catch-up with an evidence-pending member stays pending", () => {
    const awaiting = outbound(ny(TUE, "19:50"), { verification: "awaiting_confirmation" });
    const r = evaluate(day4({ events: [outbound(ny(TUE, "11:00")), awaiting], call_complete_through: ny(TUE, "19:40") }), ny(WED, "00:05"));
    assert.equal(r.requirements.call.catch_up.state, "pending");
    assert.equal(r.requirements.call.status, "pending");
    assert.equal(r.flags.pending, true);
  });

  test("an initial response past its deadline with coverage behind reads due (not pending)", () => {
    const r = evaluate(
      scenario({ periods: [period("n1", "new", ny(TUE, "10:00"), "intake")], call_complete_through: ny(TUE, "10:20") }),
      ny(TUE, "10:45"),
    );
    assert.equal(r.initial_response?.outcome, "pending");
    assert.equal(r.requirements.call.status, "due");
    assert.equal(r.requirements.call.due_at, ny(TUE, "10:30"));
    assert.equal(r.flags.pending, false);
    assert.equal(r.coverage_wait.call, ny(TUE, "10:30"));
  });
});
