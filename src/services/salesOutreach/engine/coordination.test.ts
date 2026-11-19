import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { addDays } from "./calendar";
import { goalCreditAgent } from "./credit";
import { PRECEDENCE } from "./precedence";
import { callbackPlan, evaluate, fixture, inbound, ny, nyMinute, obligationsOn, outbound, period, periods, restriction, scenario, type FixtureFile } from "./testSupport";

type Case = Record<string, unknown> & { id: string };
const cases = (name: string) => Object.fromEntries(fixture<FixtureFile<Case>>(name).cases.map((c) => [c.id, c])) as Record<string, Case>;

describe("P06b advisory cooldown (fixture p06b-advisory-cooldown.json)", () => {
  const c = cases("p06b-advisory-cooldown.json");
  const R = "2026-10-01";
  const day4 = addDays(R, 3);
  const base = (events: ReturnType<typeof outbound>[], restrictions: ReturnType<typeof restriction>[] = []) => scenario({ periods: [period("n1", "new", nyMinute(R, 420), "intake")], events, restrictions });
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
});

describe("P06c restriction waiver and resume (fixture p06c-restriction-waiver-resume.json)", () => {
  const c = cases("p06c-restriction-waiver-resume.json");
  const R = "2026-10-01"; // Day 7 = Wed 2026-10-07, Day 9 = Fri 2026-10-09 (fixed SMS day)
  const WED = "2026-10-07", FRI = "2026-10-09", SAT = "2026-10-10";
  const base = (release: string | null, events: ReturnType<typeof outbound>[] = [], channels: Array<"call" | "sms"> = ["call"]) =>
    scenario({ periods: [period("n1", "new", nyMinute(R, 420), "intake")], restrictions: [restriction("r1", channels, ny(WED, "14:00"), release)], events });
  test("release_after_opening", () => {
    const k = c.release_after_opening as Record<string, unknown>;
    const permitted = outbound(ny(FRI, "15:00"));
    const r = evaluate(base(ny(FRI, "14:00"), [permitted]), ny(SAT, "09:00"));
    assert.equal(obligationsOn(r, FRI, "call")[0]!.outcome, "waived_restriction");
    assert.equal(obligationsOn(r, SAT, "call")[0]!.outcome, "open", `routine resumes ${String(k.routine_resumes)}`);
    assert.ok(r.obligations.some((o) => o.fulfilled_by_event_id === permitted.event_id) || r.requirements.call.catch_up.outstanding === false, "permitted contact right after release earns credit");
  });
});

describe("P06d continuous assignment timeline (fixture p06d-assignment-responsibility.json)", () => {
  const c = cases("p06d-assignment-responsibility.json");
  const TUE = "2026-10-06";
  const assignments: Array<{ agent_id: string | null; from: string; to: string | null }> = [{ agent_id: null, from: "2000-01-01T00:00:00Z", to: ny(TUE, "11:00") }, { agent_id: "alice", from: ny(TUE, "11:00"), to: null }];
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
});

describe("P06e explicit callbacks (fixture p06e-explicit-callback.json)", () => {
  const c = cases("p06e-explicit-callback.json");
  const R = "2026-10-03"; // Tue 10-06 = Day 4, Thu 10-08 = Day 6 (fixed SMS), Fri 10-09 = Day 7
  const TUE = "2026-10-06", THU = "2026-10-08";
  const appointment = ny(THU, "15:00");
  const base = (events: Parameters<typeof scenario>[0]["events"] = [], at = appointment, extra: Partial<Parameters<typeof scenario>[0]> = {}) =>
    scenario({ periods: [period("n1", "new", nyMinute(R, 420), "intake")], plans: [callbackPlan("cb1", "n1", at, ny(TUE, "10:00"))], events, ...extra });
  test("answered_inbound_in_window", () => {
    const k = c.answered_inbound_in_window as Record<string, unknown>;
    const call = inbound(ny(THU, "15:05"));
    const r = evaluate(base([call]), ny(THU, "15:30"));
    assert.equal(r.callback?.outcome === "fulfilled", k.callback_fulfilled);
    assert.equal(goalCreditAgent(call) ? 1 : 0, k.goal_credit);
  });
});

describe("P06f deterministic precedence (fixture p06f-precedence-collisions.json)", () => {
  const fx = fixture<FixtureFile<Case> & { precedence: string[]; maximum_active_human_plans_per_lead: number }>("p06f-precedence-collisions.json");
  const c = cases("p06f-precedence-collisions.json");
  const R = "2026-10-03";
  const TUE = "2026-10-06", THU = "2026-10-08", FRI = "2026-10-09";
  const plan = callbackPlan("cb1", "n1", ny(THU, "15:00"), ny(TUE, "10:00"));
  test("precedence order", () => {
    assert.deepEqual([...PRECEDENCE], fx.precedence);
  });
  test("closure", () => {
    const k = c.closure as Record<string, boolean>;
    const r = evaluate(scenario({ received_at: nyMinute(R, 420), periods: periods(["n1", "new", nyMinute(R, 420), "intake"], ["c1", "closed", ny(TUE, "12:00"), "transition", "5"], ["x1", "new", ny(WED_(), "12:00"), "transition"]), plans: [plan] }), ny(THU, "16:00"));
    assert.equal(r.callback?.outcome === "cancelled", k.pending_callback_cancelled);
    assert.equal(r.obligations.some((o) => o.period_id === "n1" && o.outcome === "cancelled"), k.routine_cancelled);
    assert.equal(r.state === "closed", !k.auto_reopened, "a later nonterminal priority does not reopen");
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
  function WED_() {
    return "2026-10-07";
  }
});
