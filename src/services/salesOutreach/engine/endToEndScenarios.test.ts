/**
 * END-TO-END-RUN.md §3 rows that the pure engine decides, as named tests. Rows owned by other lanes
 * (permissions, UI/SSE, eligibility of duplicates/Form Fill/No-Sync) are listed in evidence/S2.md.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { addDays } from "./calendar";
import { goalCreditAgent, goalCreditsByAgent, repDayGoal, summarizeTeamGoals } from "./credit";
import { callbackPlan, evaluate, inbound, ny, nyMinute, obligationsOn, outbound, period, periods, quotedPlan, restriction, scenario, sms, TZ } from "./testSupport";

const TUE = "2026-10-06";

describe("END-TO-END-RUN §3 — deterministic behavior", () => {
  test("§3 New received 10:00, actual no-answer call 10:10: first response satisfied by 10:30; one ordinary credit; initiator goal credit", () => {
    const call = outbound(ny(TUE, "10:10"), { outcome: "unanswered", agent: "alice" });
    const r = evaluate(scenario({ periods: [period("n1", "new", ny(TUE, "10:00"), "intake")], events: [call] }), ny(TUE, "10:15"));
    assert.equal(r.initial_response?.due_at, ny(TUE, "10:30"));
    assert.equal(r.initial_response?.outcome, "fulfilled");
    assert.equal(obligationsOn(r, TUE, "call").filter((o) => o.fulfilled_by_event_id === call.event_id).length, 1);
    assert.deepEqual(Object.fromEntries(goalCreditsByAgent([call], TUE, TZ)), { alice: 1 });
  });

  test("§3 New Day 1/3/4/5/6 and SMS Day 6/9: age-based quotas/deadlines; fixed SMS dates unaffected by extra/missed sends", () => {
    const R = "2026-10-01";
    const d = (n: number) => addDays(R, n - 1);
    const r = evaluate(scenario({ periods: [period("n1", "new", nyMinute(R, 420), "intake")], events: [sms(ny(d(7), "10:00"))] }), ny(d(9), "09:00"));
    const calls = (n: number) => obligationsOn(r, d(n), "call").map((o) => o.due_at);
    assert.deepEqual(calls(1), [ny(d(1), "08:30"), ny(d(1), "20:00")], "Day 1 arrival: initial response replaces noon");
    for (const n of [3, 4, 5]) assert.deepEqual(calls(n), [ny(d(n), "12:00"), ny(d(n), "20:00")]);
    assert.deepEqual(calls(6), [ny(d(6), "20:00")]);
    const smsDays = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((n) => obligationsOn(r, d(n), "sms").length > 0);
    assert.deepEqual(smsDays, [1, 2, 3, 6, 9]);
  });

  for (const [minute, calls, smsCount] of [[1080, 1, 1], [1170, 1, 1], [1171, 0, 0]] as const) {
    test(`§3 Receipt/return at ${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}: inclusive caps, no manufactured earlier miss`, () => {
      const receipt = evaluate(scenario({ periods: [period("n1", "new", nyMinute(TUE, minute), "intake")] }), nyMinute(TUE, minute));
      assert.equal(obligationsOn(receipt, TUE, "call").length, calls);
      assert.equal(obligationsOn(receipt, TUE, "sms").length, smsCount);
      const R = "2026-10-05";
      const back = nyMinute(TUE, minute);
      const ret = evaluate(scenario({ periods: periods(["n1", "new", nyMinute(R, 420), "intake"], ["q1", "quoted", nyMinute(R, 600), "transition"], ["n2", "new", back, "transition"]) }), back);
      assert.equal(obligationsOn(ret, TUE, "call").filter((o) => o.period_id === "n2").length, calls);
      assert.equal(obligationsOn(ret, TUE, "sms").filter((o) => o.period_id === "n2").length, smsCount);
      assert.equal(ret.obligations.filter((o) => o.period_id === "n2" && o.deadline_missed).length, 0);
    });
  }

  test("§3 Originating answered inbound Call Lead: initial response + at most one arrival call, zero outbound goal", () => {
    const origin = inbound(ny(TUE, "09:58"), { id: "orig" });
    const r = evaluate(scenario({ received_at: ny(TUE, "10:00"), periods: [period("n1", "new", ny(TUE, "10:00"), "intake")], events: [origin], originating_contact_event_id: origin.event_id }), ny(TUE, "10:05"));
    assert.equal(r.initial_response?.outcome, "fulfilled");
    assert.equal(r.obligations.filter((o) => o.kind === "ordinary" && o.fulfilled_by_event_id === origin.event_id).length, 1);
    assert.equal(goalCreditAgent(origin), null);
  });

  test("§3 Helpers/transfers/duplicate receipts: one canonical credit, initiator-only goal, no assignment widening", () => {
    const helper = outbound(ny(TUE, "10:10"), { id: "h1", agent: "bob" });
    const r = evaluate(scenario({ periods: [period("n1", "new", ny(TUE, "10:00"), "intake")], events: [helper, { ...helper }] }), ny(TUE, "10:20"));
    assert.equal(r.obligations.filter((o) => o.fulfilled_by_event_id === helper.event_id).length, 2, "initial response + one ordinary from the same canonical event");
    assert.deepEqual(Object.fromEntries(goalCreditsByAgent([helper, { ...helper }], TUE, TZ)), { bob: 1 });
    assert.equal(r.current_assignee_agent_id, "alice");
  });

  test("§3 SMS sent then confirmed failure: credit revoked with bounded recomputation; no Call/goal change", () => {
    const sent = sms(ny(TUE, "11:00"), { id: "m1" });
    const failed = { ...sent, kind: "sms_failed" as const, verification: "excluded" as const };
    const base = (e: typeof sent) => scenario({ periods: [period("n1", "new", ny(TUE, "10:00"), "intake")], events: [e] });
    assert.equal(evaluate(base(sent), ny(TUE, "12:00")).requirements.sms.remaining, 0);
    const after = evaluate(base(failed), ny(TUE, "12:00"));
    assert.equal(after.requirements.sms.remaining, 1);
    assert.equal(after.requirements.call.required, 2);
    assert.equal(goalCreditAgent(failed), null);
  });

  test("§3 Quoted date/no-date/reentry: working-date selection/default, original-age reentry, no restarted initial clock", () => {
    const list = periods(["n1", "new", ny("2026-10-02", "10:00"), "intake"], ["q1", "quoted", ny(TUE, "14:00"), "transition"], ["n2", "new", ny("2026-10-08", "11:00"), "transition"]);
    const quoted = evaluate(scenario({ periods: list }), ny("2026-10-07", "09:00"));
    assert.equal(quoted.quoted?.first_required_date, "2026-10-07");
    const selected = evaluate(scenario({ periods: list, plans: [quotedPlan("p", "q1", "2026-10-09", ny(TUE, "15:00"))] }), ny("2026-10-07", "09:00"));
    assert.equal(selected.quoted?.first_required_date, "2026-10-09");
    const back = evaluate(scenario({ periods: list }), ny("2026-10-08", "11:05"));
    assert.equal(back.schedule_day, 7);
    assert.equal(back.initial_response?.outcome === "open", false);
  });

  test("§3 Restriction starts/releases: affected-channel waiver, no prohibited-interval debt, earlier misses kept, paused initial minutes, release-date rule", () => {
    const r = evaluate(
      scenario({ periods: [period("n1", "new", ny("2026-10-03", "07:00"), "intake")], restrictions: [restriction("r1", ["call"], ny(TUE, "13:00"), ny("2026-10-08", "14:00"))] }),
      ny("2026-10-09", "09:00"),
    );
    assert.equal(obligationsOn(r, TUE, "call")[0]!.outcome, "missed", "noon miss before the restriction kept");
    assert.equal(obligationsOn(r, TUE, "call")[1]!.outcome, "waived_restriction");
    assert.equal(obligationsOn(r, "2026-10-08", "call")[0]!.outcome, "waived_restriction", "release after opening: that date stays waived");
    assert.equal(obligationsOn(r, "2026-10-09", "call")[0]!.outcome, "open");
    assert.equal(r.obligations.filter((o) => o.business_date >= "2026-10-07" && o.business_date <= "2026-10-08" && o.channel === "call" && o.deadline_missed).length, 0);
  });

  test("§3 Human callback and collision: one plan, 15-minute deadline, no-answer attempt fulfills, restriction → rescheduling needed, nonterminal priority preserves", () => {
    const first = callbackPlan("cb1", "n1", ny("2026-10-08", "15:00"), ny(TUE, "10:00"), ny(TUE, "11:00"), "replaced");
    const second = callbackPlan("cb2", "n1", ny("2026-10-08", "16:00"), ny(TUE, "11:00"), null, null, 2);
    const list = periods(["n1", "new", ny("2026-10-03", "07:00"), "intake"], ["x1", "discretion", ny("2026-10-07", "12:00"), "transition", "3"]);
    const r = evaluate(scenario({ periods: list, plans: [first, second], events: [outbound(ny("2026-10-08", "16:10"), { outcome: "unanswered" })] }), ny("2026-10-08", "16:30"));
    assert.equal(r.obligations.find((o) => o.plan_id === "cb1")!.outcome, "superseded");
    assert.equal(r.callback?.plan_id, "cb2");
    assert.equal(r.callback?.due_at, ny("2026-10-08", "16:15"));
    assert.equal(r.callback?.outcome, "fulfilled");
    const blocked = evaluate(scenario({ periods: list, plans: [first, second], restrictions: [restriction("r", ["call"], ny("2026-10-08", "15:30"), null)] }), ny("2026-10-08", "16:30"));
    assert.equal(blocked.callback?.outcome, "blocked_reschedule");
    assert.equal(blocked.obligations.find((o) => o.plan_id === "cb2")!.deadline_missed, false);
  });

  test("§3 Unassigned/late assignment/reassignment: deadlines/age/credit remain; genuine miss responsibility retained; inherited overdue", () => {
    const assignments = [{ agent_id: null, from: "2000-01-01T00:00:00Z", to: ny(TUE, "11:00") }, { agent_id: "alice", from: ny(TUE, "11:00"), to: ny(TUE, "15:00") }, { agent_id: "bob", from: ny(TUE, "15:00"), to: null }];
    const r = evaluate(scenario({ periods: [period("n1", "new", ny(TUE, "10:00"), "intake")], assignments }), ny(TUE, "20:30"));
    const [slot0, slot1] = obligationsOn(r, TUE, "call");
    assert.equal(slot0!.responsible_agent_id, null);
    assert.equal(slot1!.responsible_agent_id, "bob");
    assert.equal(r.current_assignee_agent_id, "bob");
    assert.equal(r.obligations.find((o) => o.kind === "initial_response")!.inherited, true);
  });

  test("§3 Goals 100/100/100/50/0 with actuals 100/0/120/25/10: team goal 350, actual 255, denominator 4, reps at goal 2", () => {
    const s = summarizeTeamGoals([{ goal: 100, actual: 100 }, { goal: 100, actual: 0 }, { goal: 100, actual: 120 }, { goal: 50, actual: 25 }, { goal: 0, actual: 10 }]);
    assert.deepEqual(s, { team_goal: 350, actual: 255, goal_enabled_reps: 4, reps_at_goal: 2 });
    assert.equal(repDayGoal(10, 0).goal_state, "no_goal_today");
  });

  test("§3 Late/corrected evidence: actual date credit, apparent miss removed, genuine miss kept, corrected initiator moves one credit", () => {
    const list = [period("n1", "new", ny("2026-10-01", "07:00"), "intake")];
    const onTime = outbound("2026-10-02T15:00:00Z");
    const r = evaluate(scenario({ periods: list, events: [onTime] }), "2026-10-03T16:00:00Z");
    assert.equal(obligationsOn(r, "2026-10-02", "call")[0]!.outcome, "fulfilled");
    const lateCall = outbound("2026-10-02T17:00:00Z");
    assert.equal(obligationsOn(evaluate(scenario({ periods: list, events: [lateCall] }), "2026-10-03T16:00:00Z"), "2026-10-02", "call")[0]!.outcome, "fulfilled_late");
    const alice = outbound("2026-10-02T15:00:00Z", { id: "same", agent: "alice" });
    const bob = { ...alice, goal_agent_id: "bob", actor_agent_id: "bob" };
    assert.deepEqual(Object.fromEntries(goalCreditsByAgent([bob], "2026-10-02", TZ)), { bob: 1 });
    assert.deepEqual(Object.fromEntries(goalCreditsByAgent([alice], "2026-10-02", TZ)), { alice: 1 });
  });
});

describe("evaluator determinism and change detection", () => {
  const input = () => scenario({ periods: [period("n1", "new", ny(TUE, "10:00"), "intake")], events: [outbound(ny(TUE, "10:10"), { id: "fixed" })] });
  test("identical semantic input → identical result and fingerprints", () => {
    assert.deepEqual(evaluate(input(), ny(TUE, "10:40")), evaluate(input(), ny(TUE, "10:40")));
  });
  test("input order does not matter", () => {
    const events = [outbound(ny(TUE, "10:10"), { id: "a" }), outbound(ny(TUE, "11:20"), { id: "b" })];
    const one = evaluate(scenario({ periods: [period("n1", "new", ny(TUE, "10:00"), "intake")], events }), ny(TUE, "12:00"));
    const two = evaluate(scenario({ periods: [period("n1", "new", ny(TUE, "10:00"), "intake")], events: [...events].reverse() }), ny(TUE, "12:00"));
    assert.equal(one.fingerprint, two.fingerprint);
  });
});
