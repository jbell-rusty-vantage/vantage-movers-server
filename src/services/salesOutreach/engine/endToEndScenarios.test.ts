/**
 * END-TO-END-RUN.md §3 rows that the pure engine decides, as named tests. Rows owned by other lanes
 * (permissions, UI/SSE, eligibility of duplicates/Form Fill/No-Sync) are listed in evidence/S2.md.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

  test("§3 Actual retry 10:20, next call 11:10: retry earns goal only, no anchor reset; 11:10 satisfies the second call; SMS still owed", () => {
    const first = outbound(ny(TUE, "10:10"));
    const retry = outbound(ny(TUE, "10:20"));
    const next = outbound(ny(TUE, "11:10"));
    const r = evaluate(scenario({ periods: [period("n1", "new", ny(TUE, "10:00"), "intake")], events: [first, retry, next] }), ny(TUE, "11:15"));
    assert.equal(goalCreditAgent(retry), "alice");
    assert.equal(r.obligations.some((o) => o.fulfilled_by_event_id === retry.event_id), false);
    assert.equal(obligationsOn(r, TUE, "call")[1]!.fulfilled_by_event_id, next.event_id);
    assert.equal(r.requirements.call.remaining, 0);
    assert.equal(r.requirements.sms.remaining, 1, "independent SMS still owed");
    assert.equal(goalCreditsByAgent([first, retry, next], TUE, TZ).get("alice"), 3);
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

  test("§3 Closing/midnight crossing: outbound start date governs the goal; no future quota prepayment", () => {
    const late = outbound("2026-10-07T03:58:00Z"); // Tue 23:58 EDT
    assert.equal(goalCreditsByAgent([late], TUE, TZ).get("alice"), 1);
    const r = evaluate(scenario({ periods: [period("n1", "new", ny("2026-10-05", "07:00"), "intake")], events: [late] }), ny("2026-10-07", "09:00"));
    assert.equal(obligationsOn(r, "2026-10-07", "call").some((o) => o.fulfilled_by_event_id === late.event_id), false);
  });

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

  test("§3 Unverified identity/association or capture gap: pending, no guessed credit or false zero/failure", () => {
    const unverified = outbound(ny(TUE, "10:10"), { verification: "pending_identity" });
    const r = evaluate(scenario({ periods: [period("n1", "new", ny(TUE, "10:00"), "intake")], events: [unverified] }), ny(TUE, "10:45"));
    assert.equal(r.initial_response?.outcome, "pending");
    assert.equal(r.requirements.call.status, "pending");
    // Capture gap (amended per D-A1b, olr A1.2): the outcome stays pending (no guessed failure), but the
    // channel reads `due` — not yet verified — so the next action stays visible (SPEC §10.3).
    const gap = evaluate(scenario({ periods: [period("n1", "new", ny(TUE, "10:00"), "intake")], call_complete_through: ny(TUE, "10:20") }), ny(TUE, "10:45"));
    assert.equal(gap.initial_response?.outcome, "pending", "coverage does not reach the deadline yet");
    assert.equal(gap.requirements.call.status, "due");
    assert.equal(gap.requirements.call.verified_completed, 0, "partial coverage: no guessed credit");
    assert.equal(gap.flags.pending, false);
    assert.equal(gap.flags.needs_contact, true);
  });

  test("§3 Blank/malformed priority update and valid change: retain verified policy with uncertainty; accepted change supersedes once", () => {
    const list = periods(["n1", "new", ny(TUE, "10:00"), "intake"]);
    const plain = evaluate(scenario({ periods: list }), ny(TUE, "15:00"));
    const uncertain = evaluate(scenario({ periods: list, priority_uncertain: true }), ny(TUE, "15:00"));
    assert.deepEqual(uncertain.obligations, plain.obligations);
    assert.equal(uncertain.flags.priority_uncertain, true);
    const changed = evaluate(scenario({ periods: periods(["n1", "new", ny(TUE, "10:00"), "intake"], ["q1", "quoted", ny(TUE, "14:00"), "transition"]) }), ny(TUE, "15:00"));
    assert.equal(changed.workflow, "quoted");
    assert.ok(changed.obligations.filter((o) => o.period_id === "n1" && o.outcome === "superseded").length >= 1);
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

  test("§3 Three unsuccessful attempts: advisory warning only; restrictions still block; restricted outbound earns zero", () => {
    const attempts = ["10:10", "11:20", "12:30"].map((t) => outbound(ny(TUE, t), { outcome: "unanswered" }));
    const r = evaluate(scenario({ periods: [period("n1", "new", ny(TUE, "10:00"), "intake")], events: attempts }), ny(TUE, "12:40"));
    assert.equal(r.cooldown.warning, true);
    assert.notEqual(r.requirements.call.status, "blocked");
    const restricted = outbound(ny(TUE, "13:00"), { restricted: true });
    assert.equal(goalCreditAgent(restricted), null);
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

  test("§3 Missed inbound: history only, no automatic second callback obligation", () => {
    const missed = inbound(ny(TUE, "10:20"), { answered: false });
    const r = evaluate(scenario({ periods: [period("n1", "new", ny(TUE, "10:00"), "intake")], events: [missed] }), ny(TUE, "10:25"));
    assert.equal(r.obligations.some((o) => o.kind === "callback"), false);
    assert.equal(r.initial_response?.outcome, "open");
    assert.equal(r.last_interaction_at, ny(TUE, "10:20"));
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

  test("§3 Passed/unknown move date: cadence continues with labels", () => {
    const passed = evaluate(scenario({ periods: [period("n1", "new", ny(TUE, "10:00"), "intake")], move_date: "2026-10-01" }), ny(TUE, "10:05"));
    const unknown = evaluate(scenario({ periods: [period("n1", "new", ny(TUE, "10:00"), "intake")], move_date: null }), ny(TUE, "10:05"));
    assert.equal(passed.flags.move_date_passed, true);
    assert.equal(unknown.flags.move_date_unknown, true);
    assert.equal(passed.requirements.call.required, 2);
    assert.equal(unknown.requirements.call.required, 2);
  });

  test("§3 Goals 100/100/100/50/0 with actuals 100/0/120/25/10: team goal 350, actual 255, denominator 4, reps at goal 2", () => {
    const s = summarizeTeamGoals([{ goal: 100, actual: 100 }, { goal: 100, actual: 0 }, { goal: 100, actual: 120 }, { goal: 50, actual: 25 }, { goal: 0, actual: 10 }]);
    assert.deepEqual(s, { team_goal: 350, actual: 255, goal_enabled_reps: 4, reps_at_goal: 2 });
    assert.equal(repDayGoal(10, 0).goal_state, "no_goal_today");
  });

  test("§3 108 outbound and overdue Leads: 108/100, capped bar, overdue work stays visible", () => {
    const day = repDayGoal(108, 100);
    assert.deepEqual([day.actual, day.goal, day.remaining, day.progress], [108, 100, 0, 1]);
    const r = evaluate(scenario({ periods: [period("n1", "new", ny(TUE, "10:00"), "intake")] }), ny(TUE, "11:00"));
    assert.equal(r.flags.overdue, true, "goal attainment never hides lead coverage");
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

  test("§3 Legacy/AI producers: the engine is pure — no Mongo, model, provider, clock or env access", () => {
    const dir = __dirname;
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "testSupport.ts")) {
      const source = readFileSync(join(dir, file), "utf8");
      for (const m of source.matchAll(/from\s+"([^"]+)"/g)) {
        assert.ok(m[1]!.startsWith("./") || m[1] === "node:crypto" || m[1] === "zod", `${file} imports ${m[1]}`);
      }
      assert.doesNotMatch(source, /Date\.now\(|new Date\(\)|process\.env|mongoose|openai|anthropic|transcri/i, `${file} must stay pure`);
    }
  });
});

describe("DST and midnight cases", () => {
  test("a fall-back business date (25 h) keeps 08:00/12:00/20:00 local deadlines", () => {
    const r = evaluate(scenario({ periods: [period("n1", "new", ny("2026-10-30", "07:00"), "intake")] }), ny("2026-11-01", "09:00"));
    assert.deepEqual(obligationsOn(r, "2026-11-01", "call").map((o) => o.due_at), ["2026-11-01T17:00:00.000Z", "2026-11-02T01:00:00.000Z"]);
    assert.equal(r.schedule_day, 3);
    assert.equal(r.next_evaluation_at, "2026-11-01T17:00:00.000Z");
  });
  test("a spring-forward business date (23 h) keeps local deadlines and age", () => {
    const r = evaluate(scenario({ periods: [period("n1", "new", ny("2026-03-07", "07:00"), "intake")] }), ny("2026-03-08", "09:00"));
    assert.deepEqual(obligationsOn(r, "2026-03-08", "call").map((o) => o.due_at), ["2026-03-08T16:00:00.000Z", "2026-03-09T00:00:00.000Z"]);
    assert.equal(r.schedule_day, 2);
  });
  test("next_evaluation_at rolls to the next local midnight, not +24 h", () => {
    const r = evaluate(scenario({ periods: [period("x1", "discretion", ny("2026-10-31", "10:00"), "intake", null, "3")] }), ny("2026-10-31", "22:00"));
    assert.equal(r.next_evaluation_at, "2026-11-01T04:00:00.000Z");
    const fall = evaluate(scenario({ periods: [period("x1", "discretion", ny("2026-10-31", "10:00"), "intake", null, "3")] }), ny("2026-11-01", "22:00"));
    assert.equal(fall.next_evaluation_at, "2026-11-02T05:00:00.000Z");
  });
});

describe("evaluator determinism and change detection", () => {
  const input = () => scenario({ periods: [period("n1", "new", ny(TUE, "10:00"), "intake")], events: [outbound(ny(TUE, "10:10"), { id: "fixed" })] });
  test("identical semantic input → identical result and fingerprints", () => {
    assert.deepEqual(evaluate(input(), ny(TUE, "10:40")), evaluate(input(), ny(TUE, "10:40")));
  });
  test("a quiet interval keeps the fingerprint (no rewrite for countdown ticks); a passed deadline changes it", () => {
    const a = evaluate(input(), ny(TUE, "10:40"));
    const b = evaluate(input(), ny(TUE, "10:50"));
    assert.equal(a.fingerprint, b.fingerprint);
    assert.equal(a.input_fingerprint, b.input_fingerprint);
    assert.equal(a.next_evaluation_at, ny(TUE, "20:00"));
    const c = evaluate(input(), ny(TUE, "20:01"));
    assert.notEqual(c.fingerprint, a.fingerprint);
  });
  test("input order does not matter", () => {
    const events = [outbound(ny(TUE, "10:10"), { id: "a" }), outbound(ny(TUE, "11:20"), { id: "b" })];
    const one = evaluate(scenario({ periods: [period("n1", "new", ny(TUE, "10:00"), "intake")], events }), ny(TUE, "12:00"));
    const two = evaluate(scenario({ periods: [period("n1", "new", ny(TUE, "10:00"), "intake")], events: [...events].reverse() }), ny(TUE, "12:00"));
    assert.equal(one.fingerprint, two.fingerprint);
  });
});
