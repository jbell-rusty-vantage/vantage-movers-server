import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import type { SalesOutreachConfigurationInput } from "../../../validation/v1/salesOutreach";
import { summarizeTeamGoals } from "../engine/credit";
import { activeInspection, fixedConfigurationLoader } from "../reads/testing";
import type { ActiveConfiguration } from "../config/load";
import { applyContactSources, contactEvaluationJob } from "./apply";
import { contactEventId } from "./derive";
import { parseContactSubjectKey, parseRepDaySubjectKey, runOutreachContactChangeJob, runOutreachRepDayJob, type ContactJobDeps } from "./jobs";
import { composeRepDayRow, countScopeFor, repDayCoverage } from "./repDay";
import { recountRepDay } from "./repDayService";
import { refreshOpenRepDays, sweepContactSources, type SweepLease } from "./sweep";
import {
  ContextBuilder,
  MemoryContactEventStore,
  SESSION,
  inboundCall,
  leg,
  memoryTransaction,
  newId,
  outboundCall,
  subjectFacts,
} from "./testing";
import { MemoryRepDayStore, MemorySweepStore } from "./testingPipeline";

/**
 * SRV-6 pipeline: contact-event apply (idempotency, dirty marks, job identities), the rep-day recount
 * (count scopes, goal snapshot, coverage, P08a), the queued consumers, the minute sweep and the refresh
 * pass. END-TO-END-RUN §3 rows this lane owns are named tests here and in `derive.test.ts`.
 */

const ALICE = newId();
const BOB = newId();
const CAROL = newId();
const NUMBER = newId();
const NOW = new Date("2026-10-05T19:00:00.000Z"); // 15:00 New York
const TODAY = "2026-10-05";

const desk = (extra: Partial<SalesOutreachConfigurationInput> = {}): SalesOutreachConfigurationInput => ({
  controls: { desk_enabled: true, goal_metrics_enabled: true },
  transition: { backfill_lookback_days: 2 },
  goals: {
    roster_version: "roster-1",
    default_scheduled_goal: 100,
    zero_goal_rule: "no_goal_today_excluded_from_denominator",
    rep_work_schedules: [ALICE, BOB, CAROL].map((agent_id) => ({ agent_id, working_days: [1, 2, 3, 4, 5, 6, 7] })),
    effective_day_overrides: [],
  },
  ...extra,
});
const active = (input = desk(), version = "v-test", revision = 3) => activeInspection(input, version, revision) as ActiveConfiguration;

function world() {
  const ctx = new ContextBuilder().link(ALICE, "101").link(BOB, "102");
  const { subject } = ctx.lead(NUMBER, subjectFacts({ workflow: "new" }));
  const events = new MemoryContactEventStore(ctx.build());
  const repDays = new MemoryRepDayStore(events);
  repDays.marks = { capture_known_complete_through: new Date("2026-10-06T05:00:00Z"), derived_through: new Date("2026-10-06T05:00:00Z"), coverage_from: new Date("2026-10-01T04:00:00Z") };
  return { ctx, subject: subject!, events, repDays };
}

const call = (store: MemoryContactEventStore, row: ReturnType<typeof outboundCall>) => {
  store.calls.set(row.id, row);
  return { source_kind: "call" as const, source_id: row.id };
};

async function recount(w: ReturnType<typeof world>, agent: string, day = TODAY, configuration = active(), now = NOW) {
  return recountRepDay({ agent_id: agent, business_day: day }, configuration, now, w.repDays, SESSION);
}

describe("apply: one event per source, idempotent, dirty marks", () => {
  test("derives once, a replay writes nothing, and nominates S1-shaped outreach_evaluate + one rep-day job", async () => {
    const w = world();
    const source = call(w.events, outboundCall("101", NUMBER, "2026-10-05T14:10:00Z"));
    const first = await applyContactSources([source], { now: NOW, queueRepDays: true }, w.events, SESSION);
    assert.deepEqual([first.derived, first.changed, first.evaluations], [1, 1, 1]);
    assert.equal(w.events.events.size, 1);
    assert.ok(w.events.events.has(contactEventId("call", source.source_id)));
    const [evaluate] = w.events.jobsOf("outreach_evaluate");
    assert.equal(evaluate!.subject_key, `outreach-subject:${w.subject.id}`);
    assert.deepEqual(evaluate!.input_refs, [w.subject.id]);
    assert.equal(evaluate!.input_revision, w.subject.revision);
    const [repDay] = w.events.jobsOf("outreach_rep_day");
    assert.equal(repDay!.subject_key, `outreach-rep-day:${ALICE}:${TODAY}`);
    assert.equal(first.created_job_ids.length, 2);

    const replay = await applyContactSources([source], { now: NOW, queueRepDays: true }, w.events, SESSION);
    assert.deepEqual([replay.changed, replay.evaluations, replay.created_job_ids.length], [0, 0, 0]);
    assert.equal(w.events.writes, 1);
  });

  test("sweep mode returns the dirty rep-days instead of queueing them; missing sources are counted", async () => {
    const w = world();
    const a = call(w.events, outboundCall("101", NUMBER, "2026-10-05T14:10:00Z"));
    const result = await applyContactSources([a, { source_kind: "call", source_id: newId() }], { now: NOW, queueRepDays: false }, w.events, SESSION);
    assert.equal(result.missing, 1);
    assert.deepEqual(result.rep_days, [{ agent_id: ALICE, business_day: TODAY }]);
    assert.equal(w.events.jobsOf("outreach_rep_day").length, 0);
  });

  test("an association that moves away re-evaluates the subject it left", async () => {
    const w = world();
    const row = outboundCall("101", NUMBER, "2026-10-05T14:10:00Z");
    const source = call(w.events, row);
    await applyContactSources([source], { now: NOW, queueRepDays: true }, w.events, SESSION);
    // The attachment was rejected later: the number has no Lead, the subject still exists.
    const later = new ContextBuilder().link(ALICE, "101");
    later.subjects.set("FormLead:000000000000000000000001", w.subject);
    w.events.context = later.build();
    const moved = await applyContactSources([source], { now: NOW, queueRepDays: true }, w.events, SESSION);
    assert.equal(moved.changed, 1);
    assert.equal(w.events.events.get(contactEventId("call", row.id))!.subject_id, null);
    assert.equal(w.events.jobsOf("outreach_evaluate").length, 2, "the subject it left is evaluated again");
  });

  test("evaluation job identity changes with the event version, so a flip back is re-evaluated", () => {
    const a = contactEvaluationJob("s1", 4, ["call:c1:v1"]);
    const b = contactEvaluationJob("s1", 4, ["call:c1:v3"]);
    assert.notEqual(a.dedupe_key, b.dedupe_key);
    assert.equal(a.stage, "outreach_evaluate");
  });
});

describe("rep-day recount", () => {
  test("END-TO-END-RUN §3: New received 10:00, actual no-answer call 10:10 — initiating-rep goal credit", async () => {
    const w = world();
    const source = call(w.events, outboundCall("101", NUMBER, "2026-10-05T14:10:00Z", { provider_connected: false, provider_result: "No Answer", legs: [leg("101", "2026-10-05T14:10:00Z", { result: "No Answer" })] }));
    await applyContactSources([source], { now: NOW, queueRepDays: true }, w.events, SESSION);
    const result = await recount(w, ALICE);
    assert.equal(result.outcome, "written");
    const row = w.repDays.row(ALICE, TODAY)!;
    assert.deepEqual([row.count_scope, row.actual_confirmed, row.unattributed], ["all_outbound", 1, 0]);
    assert.equal(w.repDays.row(BOB, TODAY), null);
  });

  test("END-TO-END-RUN §3: actual retry 10:20 and next call 11:10 — every actual attempt earns goal credit", async () => {
    const w = world();
    const sources = ["14:10", "14:20", "15:10"].map((t) => call(w.events, outboundCall("101", NUMBER, `2026-10-05T${t}:00Z`)));
    await applyContactSources(sources, { now: NOW, queueRepDays: false }, w.events, SESSION);
    await recount(w, ALICE);
    assert.equal(w.repDays.row(ALICE, TODAY)!.actual_confirmed, 3);
  });

  test("M1 all_outbound counts calls without an eligible subject; unattributed is that subset", async () => {
    const w = world();
    const sources = [
      call(w.events, outboundCall("101", NUMBER, "2026-10-05T14:10:00Z")),
      call(w.events, outboundCall("101", newId(), "2026-10-05T14:30:00Z")), // number only
      call(w.events, outboundCall("101", null, "2026-10-05T14:40:00Z", { direction: "Internal" })), // internal: nothing
    ];
    await applyContactSources(sources, { now: NOW, queueRepDays: false }, w.events, SESSION);
    await recount(w, ALICE);
    const row = w.repDays.row(ALICE, TODAY)!;
    assert.deepEqual([row.actual_confirmed, row.unattributed], [2, 1]);
  });

  test("M2 eligible_new_quoted from the day after the first completed enrollment apply; earlier days stay all_outbound", async () => {
    assert.equal(countScopeFor(TODAY, null), "all_outbound");
    assert.equal(countScopeFor(TODAY, new Date("2026-10-05T13:00:00Z")), "all_outbound", "the activation date keeps the M1 scope");
    assert.equal(countScopeFor(TODAY, new Date("2026-10-04T13:00:00Z")), "eligible_new_quoted");
    const w = world();
    w.repDays.firstActivation = new Date("2026-10-04T13:00:00Z");
    const sources = [call(w.events, outboundCall("101", NUMBER, "2026-10-05T14:10:00Z")), call(w.events, outboundCall("101", newId(), "2026-10-05T14:30:00Z"))];
    await applyContactSources(sources, { now: NOW, queueRepDays: false }, w.events, SESSION);
    await recount(w, ALICE);
    const row = w.repDays.row(ALICE, TODAY)!;
    assert.deepEqual([row.count_scope, row.actual_confirmed, row.unattributed], ["eligible_new_quoted", 1, 1]);
  });

  test("END-TO-END-RUN §3: Helpers/transfers/duplicate receipts — one canonical credit, initiator only", async () => {
    const w = world();
    const transfer = outboundCall("101", NUMBER, "2026-10-05T14:10:00Z", { legs: [leg("101", "2026-10-05T14:10:00Z"), leg("102", "2026-10-05T14:12:00Z", { leg_type: "Transfer" })] });
    const duplicateReceipt = outboundCall("101", NUMBER, "2026-10-05T14:10:00Z", { merged_into_id: transfer.id });
    const helper = outboundCall("102", NUMBER, "2026-10-05T16:00:00Z");
    await applyContactSources([call(w.events, transfer), call(w.events, duplicateReceipt), call(w.events, helper)], { now: NOW, queueRepDays: false }, w.events, SESSION);
    await recount(w, ALICE);
    await recount(w, BOB);
    assert.equal(w.repDays.row(ALICE, TODAY)!.actual_confirmed, 1, "transfer + duplicate receipt = one credit to Alice");
    assert.equal(w.repDays.row(BOB, TODAY)!.actual_confirmed, 1, "the helper's own call credits the helper");
  });

  test("END-TO-END-RUN §3: Closing/midnight crossing — the goal date is the outbound start's New York date", async () => {
    const w = world();
    w.repDays.marks = { ...w.repDays.marks, coverage_from: new Date("2026-10-04T04:00:00Z") };
    await applyContactSources([call(w.events, outboundCall("101", NUMBER, "2026-10-03T03:58:00Z"))], { now: NOW, queueRepDays: false }, w.events, SESSION);
    await recount(w, ALICE, "2026-10-02");
    assert.deepEqual([w.repDays.row(ALICE, "2026-10-02")!.actual_confirmed, w.repDays.row(ALICE, "2026-10-02")!.coverage.state], [1, "unknown"], "a day before the derived evidence starts is never complete");
    w.repDays.marks = { ...w.repDays.marks, coverage_from: new Date("2026-09-01T04:00:00Z") };
    await recount(w, ALICE, "2026-10-02");
    assert.deepEqual([w.repDays.row(ALICE, "2026-10-02")!.actual_confirmed, w.repDays.row(ALICE, "2026-10-02")!.coverage.state], [1, "complete"]);
    assert.equal(w.repDays.row(ALICE, "2026-10-03"), null);
  });

  test("END-TO-END-RUN §3: Unverified identity/association or capture gap — no guessed credit, no false zero", async () => {
    const w = world();
    await applyContactSources([call(w.events, outboundCall("199", NUMBER, "2026-10-05T14:10:00Z"))], { now: NOW, queueRepDays: false }, w.events, SESSION);
    assert.equal([...w.events.events.values()][0]!.goal_agent_id, null, "unreviewed initiator credits nobody");
    // A partial capture day: the row says partial, so the read keeps a zero pending.
    w.repDays.marks = { capture_known_complete_through: new Date("2026-10-05T17:00:00Z"), derived_through: new Date("2026-10-05T18:59:00Z"), coverage_from: null };
    await applyContactSources([call(w.events, outboundCall("101", NUMBER, "2026-10-05T14:10:00Z"))], { now: NOW, queueRepDays: false }, w.events, SESSION);
    await recount(w, ALICE);
    assert.equal(w.repDays.row(ALICE, TODAY)!.coverage.state, "partial");
    // Derivation lagging behind capture also keeps the day open.
    const lag = repDayCoverage(TODAY, TODAY, NOW, { capture_known_complete_through: NOW, derived_through: new Date("2026-10-05T18:00:00Z"), coverage_from: null });
    assert.equal(lag.state, "partial");
    assert.equal(repDayCoverage(TODAY, TODAY, NOW, { capture_known_complete_through: NOW, derived_through: null, coverage_from: null }).state, "unknown");
    // The settlement allowance: capture exactly at the requirement is not yet complete.
    const required = new Date(NOW.getTime() - 10 * 60_000);
    assert.equal(repDayCoverage(TODAY, TODAY, NOW, { capture_known_complete_through: required, derived_through: NOW, coverage_from: null }).state, "partial");
    assert.equal(repDayCoverage(TODAY, TODAY, NOW, { capture_known_complete_through: new Date(required.getTime() + 2 * 60_000), derived_through: NOW, coverage_from: null }).state, "complete");
  });

  test("provisional → confirmed and revocation recount the same row (monotonic publication revision)", async () => {
    const w = world();
    const row = outboundCall("101", NUMBER, "2026-10-05T14:10:00Z", { call_log_state: null, legs: [] });
    const source = call(w.events, row);
    await applyContactSources([source], { now: NOW, queueRepDays: false }, w.events, SESSION);
    await recount(w, ALICE);
    assert.deepEqual([w.repDays.row(ALICE, TODAY)!.actual_confirmed, w.repDays.row(ALICE, TODAY)!.actual_awaiting_confirmation], [0, 1]);
    w.events.calls.set(row.id, { ...row, call_log_state: "settled", legs: [leg("101", "2026-10-05T14:10:00Z")], projection_revision: 6 });
    await applyContactSources([source], { now: NOW, queueRepDays: false }, w.events, SESSION);
    await recount(w, ALICE);
    assert.deepEqual([w.repDays.row(ALICE, TODAY)!.actual_confirmed, w.repDays.row(ALICE, TODAY)!.actual_awaiting_confirmation, w.repDays.row(ALICE, TODAY)!.publication_revision], [1, 0, 2]);
    assert.equal((await recount(w, ALICE)).outcome, "unchanged", "identical input writes nothing");
    // The call is later merged into another canonical row: its credit is revoked and the row drops to zero.
    w.events.calls.set(row.id, { ...w.events.calls.get(row.id)!, merged_into_id: newId(), projection_revision: 7 });
    await applyContactSources([source], { now: NOW, queueRepDays: false }, w.events, SESSION);
    await recount(w, ALICE);
    assert.deepEqual([w.repDays.row(ALICE, TODAY)!.actual_confirmed, w.repDays.row(ALICE, TODAY)!.publication_revision], [0, 3]);
  });

  test("END-TO-END-RUN §3: Late/corrected evidence — the corrected initiator moves the one credit (P07f)", async () => {
    const w = world();
    const fx = JSON.parse(readFileSync(path.join(process.cwd(), "docs/sales-outreach-desk/contracts/fixtures/p07f-late-evidence.json"), "utf8")) as {
      cases: Array<{ id: string; before?: Record<string, number>; after?: Record<string, number>; total_goal_credit?: number; contact_at?: string; credited_date?: string }>;
    };
    const corrected = fx.cases.find((c) => c.id === "corrected_initiator")!;
    const row = outboundCall("101", NUMBER, "2026-10-05T14:10:00Z");
    const source = call(w.events, row);
    await applyContactSources([source], { now: NOW, queueRepDays: true }, w.events, SESSION);
    await recount(w, ALICE);
    assert.deepEqual({ alice: w.repDays.row(ALICE, TODAY)!.actual_confirmed, bob: w.repDays.row(BOB, TODAY)?.actual_confirmed ?? 0 }, corrected.before);
    w.events.calls.set(row.id, { ...row, legs: [leg("102", "2026-10-05T14:10:00Z")], parties: [], projection_revision: 9 });
    const moved = await applyContactSources([source], { now: NOW, queueRepDays: true }, w.events, SESSION);
    assert.deepEqual(moved.rep_days.map((k) => k.agent_id).sort(), [ALICE, BOB].sort(), "both rep-days are dirtied");
    await recount(w, ALICE);
    await recount(w, BOB);
    const after = { alice: w.repDays.row(ALICE, TODAY)!.actual_confirmed, bob: w.repDays.row(BOB, TODAY)!.actual_confirmed };
    assert.deepEqual(after, corrected.after);
    assert.equal(after.alice + after.bob, corrected.total_goal_credit);
    // on_time_contact_captured_next_day: credited on the contact date, not the capture date.
    const late = fx.cases.find((c) => c.id === "on_time_contact_captured_next_day")!;
    const w2 = world();
    w2.repDays.marks = { ...w2.repDays.marks, coverage_from: new Date("2026-09-01T04:00:00Z") };
    await applyContactSources([call(w2.events, outboundCall("101", NUMBER, late.contact_at!))], { now: new Date("2026-10-03T16:00:00Z"), queueRepDays: false }, w2.events, SESSION);
    await recount(w2, ALICE, late.credited_date!, active(), new Date("2026-10-03T16:00:00Z"));
    assert.equal(w2.repDays.row(ALICE, late.credited_date!)!.actual_confirmed, 1);
    assert.equal(w2.repDays.row(ALICE, "2026-10-03"), null, "no capture-date credit");
  });

  test("END-TO-END-RUN §3: restricted outbound earns zero goal credit (three-attempt row)", async () => {
    const w = world();
    w.ctx.restrict(NUMBER, ["call"], "2026-10-01T00:00:00Z");
    w.events.context = w.ctx.build();
    await applyContactSources([call(w.events, outboundCall("101", NUMBER, "2026-10-05T14:10:00Z"))], { now: NOW, queueRepDays: false }, w.events, SESSION);
    const [event] = [...w.events.events.values()];
    assert.equal(event!.restricted_at_contact, true);
    assert.equal((await recount(w, ALICE)).outcome, "no_activity", "no goal-credited activity: no row");
  });

  test("END-TO-END-RUN §3: Missed inbound — history only, no rep-day", async () => {
    const w = world();
    const result = await applyContactSources([call(w.events, inboundCall(null, NUMBER, "2026-10-05T14:10:00Z"))], { now: NOW, queueRepDays: true }, w.events, SESSION);
    assert.equal(result.rep_days.length, 0);
    assert.equal([...w.events.events.values()][0]!.kind, "inbound_missed");
  });

  test("goal snapshot: today unfrozen (read resolves from configuration); the first recount after the day freezes it once", async () => {
    const w = world();
    await applyContactSources([call(w.events, outboundCall("101", NUMBER, "2026-10-05T14:10:00Z"))], { now: NOW, queueRepDays: false }, w.events, SESSION);
    await recount(w, ALICE);
    assert.equal(w.repDays.row(ALICE, TODAY)!.goal_snapshot.configuration_version, null);
    assert.equal(w.repDays.row(ALICE, TODAY)!.goal_snapshot.goal, 100);
    const tomorrow = new Date("2026-10-06T14:00:00Z");
    await recount(w, ALICE, TODAY, active(desk(), "v-test", 3), tomorrow);
    assert.equal(w.repDays.row(ALICE, TODAY)!.goal_snapshot.configuration_version, "v-test");
    // A later configuration change does not rewrite the frozen day.
    const changed = desk({ goals: { ...desk().goals!, default_scheduled_goal: 80 } });
    await recount(w, ALICE, TODAY, active(changed, "v-next", 4), new Date("2026-10-06T15:00:00Z"));
    assert.deepEqual([w.repDays.row(ALICE, TODAY)!.goal_snapshot.configuration_version, w.repDays.row(ALICE, TODAY)!.goal_snapshot.goal], ["v-test", 100]);
  });

  test("END-TO-END-RUN §3: 108 outbound — actual above goal stays visible, capped progress, zero remaining", () => {
    const events = Array.from({ length: 108 }, (_, i) => ({ source_id: `c${i}`, goal_credit: "confirmed" as const, goal_scope_eligible: true }));
    const row = composeRepDayRow({
      agent_id: ALICE, business_day: TODAY, today: TODAY, now: NOW, events, scope: "all_outbound",
      goals: active().value.goals, configuration_version: "v-test", existing_snapshot: null,
      watermarks: { capture_known_complete_through: NOW, derived_through: NOW, coverage_from: null },
    });
    assert.deepEqual([row.actual_confirmed, row.remaining, row.progress, row.goal_state], [108, 0, 1, "goal"]);
  });

  test("p08a / END-TO-END-RUN §3: Goals 100/100/100/50/0 with actuals 100/0/120/25/10", () => {
    const fx = JSON.parse(readFileSync(path.join(process.cwd(), "docs/sales-outreach-desk/contracts/fixtures/p08a-roster-goals.json"), "utf8")) as {
      default_scheduled_day_goal: number;
      rows: Array<{ rep: string; goal: number; actual: number; override?: "absence" | "partial_day" }>;
      expected_team_goal: number;
      expected_actual: number;
      expected_goal_enabled_reps: number;
      expected_reps_at_goal: number;
    };
    const agents = new Map(fx.rows.map((r) => [r.rep, newId()]));
    const goals = desk({
      goals: {
        roster_version: "roster-p08a",
        default_scheduled_goal: fx.default_scheduled_day_goal,
        zero_goal_rule: "no_goal_today_excluded_from_denominator",
        rep_work_schedules: fx.rows.map((r) => ({ agent_id: agents.get(r.rep)!, working_days: [1, 2, 3, 4, 5, 6, 7] })),
        effective_day_overrides: fx.rows.filter((r) => r.override).map((r) => ({ agent_id: agents.get(r.rep)!, business_date: TODAY, goal: r.goal, reason: r.override! })),
      },
    });
    const configuration = active(goals);
    const rows = fx.rows.map((r) =>
      composeRepDayRow({
        agent_id: agents.get(r.rep)!, business_day: TODAY, today: TODAY, now: NOW,
        events: Array.from({ length: r.actual }, (_, i) => ({ source_id: `${r.rep}${i}`, goal_credit: "confirmed" as const, goal_scope_eligible: true })),
        scope: "all_outbound", goals: configuration.value.goals, configuration_version: configuration.version, existing_snapshot: null,
        watermarks: { capture_known_complete_through: NOW, derived_through: NOW, coverage_from: null },
      }),
    );
    rows.forEach((row, i) => assert.equal(row.goal_snapshot.goal, fx.rows[i]!.goal, `goal of ${fx.rows[i]!.rep}`));
    const e = rows[4]!;
    assert.deepEqual([e.goal_state, e.actual_confirmed, e.goal_snapshot.override?.reason], ["no_goal_today", 10, "absence"]);
    const team = summarizeTeamGoals(rows.map((row) => ({ goal: row.goal_snapshot.goal!, actual: row.actual_confirmed })));
    assert.deepEqual(team, { team_goal: fx.expected_team_goal, actual: fx.expected_actual, goal_enabled_reps: fx.expected_goal_enabled_reps, reps_at_goal: fx.expected_reps_at_goal });
  });

  test("not on the roster: the row keeps actuals with no goal", async () => {
    const w = world();
    const outsider = newId();
    w.ctx.link(outsider, "105");
    w.events.context = w.ctx.build();
    await applyContactSources([call(w.events, outboundCall("105", NUMBER, "2026-10-05T14:10:00Z"))], { now: NOW, queueRepDays: false }, w.events, SESSION);
    await recount(w, outsider);
    assert.deepEqual([w.repDays.row(outsider, TODAY)!.goal_state, w.repDays.row(outsider, TODAY)!.actual_confirmed], ["not_on_roster", 1]);
  });
});

describe("queued consumers", () => {
  const leased = (subject_key: string) => ({ _id: newId(), subject_key, lease_owner: "w", lease_epoch: 1 });
  const harness = (w: ReturnType<typeof world>, inspection = activeInspection(desk())) => {
    const calls: string[] = [];
    const deps: ContactJobDeps = {
      loader: fixedConfigurationLoader(inspection),
      store: w.events,
      repDayStore: w.repDays,
      now: () => NOW,
      complete: (async (_lease: unknown, mutation: (s: unknown) => Promise<unknown>) => mutation(SESSION)) as never,
      fail: (async (_lease: unknown, reason: string) => {
        calls.push(`fail:${reason}`);
      }) as never,
      publish: async (ids) => {
        calls.push(`publish:${ids.length}`);
      },
    };
    return { deps, calls };
  };

  test("subject keys parse strictly", () => {
    const id = newId();
    assert.deepEqual(parseContactSubjectKey(`call:${id}`), { source_kind: "call", source_id: id });
    assert.equal(parseContactSubjectKey(`lead:${id}`), null);
    assert.deepEqual(parseRepDaySubjectKey(`outreach-rep-day:${id}:${TODAY}`), { agent_id: id, business_day: TODAY });
    assert.equal(parseRepDaySubjectKey(`outreach-rep-day:${id}:yesterday`), null);
  });

  test("fail closed: no active configuration, or desk and goal metrics off, claims nothing", async () => {
    const w = world();
    let claimed = 0;
    const claim = (async () => {
      claimed++;
      return null;
    }) as never;
    assert.equal((await runOutreachContactChangeJob(undefined, { ...harness(w, { state: "uninitialized" }).deps, claim })).status, "configuration_unavailable");
    const off = activeInspection(desk({ controls: { desk_enabled: false, goal_metrics_enabled: false } }));
    assert.equal((await runOutreachContactChangeJob(undefined, { ...harness(w, off).deps, claim })).status, "not_wanted");
    assert.equal((await runOutreachRepDayJob(undefined, { ...harness(w, off).deps, claim })).status, "not_wanted");
    assert.equal(claimed, 0);
  });

  test("contact change job: derives, enqueues and publishes after commit; rep-day job recounts", async () => {
    const w = world();
    const source = call(w.events, outboundCall("101", NUMBER, "2026-10-05T14:10:00Z"));
    const { deps, calls } = harness(w);
    const done = await runOutreachContactChangeJob(undefined, { ...deps, claim: (async () => leased(`call:${source.source_id}`)) as never });
    assert.equal(done.status, "completed");
    assert.deepEqual(calls, ["publish:2"]);
    const repDay = await runOutreachRepDayJob(undefined, { ...deps, claim: (async () => leased(`outreach-rep-day:${ALICE}:${TODAY}`)) as never });
    assert.equal(repDay.status, "completed");
    assert.equal(w.repDays.row(ALICE, TODAY)!.actual_confirmed, 1);
  });

  test("a malformed subject key fails as schema_invalid; a moved configuration pointer retries", async () => {
    const w = world();
    const { deps, calls } = harness(w);
    assert.equal((await runOutreachContactChangeJob(undefined, { ...deps, claim: (async () => leased("call:nope")) as never })).status, "retry");
    let reads = 0;
    const moving = {
      inspect: async () => activeInspection(desk(), "v1", 1),
      load: async () => activeInspection(desk(), "v1", 1) as ActiveConfiguration,
      requireActive: async () => {
        reads++;
        return activeInspection(desk(), "v2", 2) as ActiveConfiguration;
      },
    };
    const source = call(w.events, outboundCall("101", NUMBER, "2026-10-05T14:10:00Z"));
    assert.equal((await runOutreachContactChangeJob(undefined, { ...deps, loader: moving, claim: (async () => leased(`call:${source.source_id}`)) as never })).status, "retry");
    assert.equal(reads, 1);
    assert.deepEqual(calls, ["fail:schema_invalid", "fail:transient"]);
    assert.equal(w.events.events.size, 0, "nothing written under a moved pointer");
  });
});

describe("minute sweep and refresh", () => {
  const lease = (held = false): SweepLease & { released: number } => {
    const l = { released: 0, acquire: async () => !held, release: async () => void l.released++ };
    return l;
  };

  test("bootstrap from the persisted lookback, pages to the end, stores the watermark and recounts dirty rep-days", async () => {
    const w = world();
    const sweep = new MemorySweepStore();
    sweep.capture = new Date("2026-10-05T18:40:00Z");
    const rows = Array.from({ length: 450 }, (_, i) => outboundCall("101", NUMBER, new Date(Date.parse("2026-10-05T13:00:00Z") + i * 60_000).toISOString()));
    rows.forEach((row, i) => {
      w.events.calls.set(row.id, row);
      sweep.sources.set("call", [...(sweep.sources.get("call") ?? []), { id: row.id, updated_at: new Date(Date.parse("2026-10-05T13:00:00Z") + i * 1000) }]);
    });
    const old = outboundCall("101", NUMBER, "2026-09-20T14:00:00Z");
    w.events.calls.set(old.id, old);
    sweep.sources.get("call")!.push({ id: old.id, updated_at: new Date("2026-09-20T15:00:00Z") });
    const l = lease();
    const result = await sweepContactSources("call", NOW, {
      loader: fixedConfigurationLoader(activeInspection(desk())), store: sweep, events: w.events, repDays: w.repDays, lease: l, transaction: memoryTransaction,
    });
    assert.equal(result.skipped, false);
    assert.equal(result.pages, 3);
    assert.equal(result.caught_up, true);
    assert.equal(result.derived, 450, "rows before the bootstrap start are outside the derived evidence");
    const state = sweep.state.get("call")!;
    assert.equal(state.coverage_from!.toISOString(), "2026-10-03T04:00:00.000Z", "New York midnight of today − 2 days");
    assert.equal(state.known_complete_through!.toISOString(), "2026-10-05T18:40:00.000Z");
    assert.equal(result.rep_days_recounted, 1);
    assert.equal(l.released, 1);
    // Nothing new: the next pass re-scans only the overlap and changes nothing.
    const again = await sweepContactSources("call", NOW, { loader: fixedConfigurationLoader(activeInspection(desk())), store: sweep, events: w.events, repDays: w.repDays, lease: lease(), transaction: memoryTransaction });
    assert.deepEqual([again.changed, again.pages], [0, 1]);
  });

  test("a row committed behind the cursor (commit lag) is picked up by the overlap re-scan", async () => {
    const w = world();
    const sweep = new MemorySweepStore();
    const first = outboundCall("101", NUMBER, "2026-10-05T14:00:00Z");
    w.events.calls.set(first.id, first);
    sweep.sources.set("call", [{ id: first.id, updated_at: new Date("2026-10-05T18:59:00Z") }]);
    const deps = { loader: fixedConfigurationLoader(activeInspection(desk())), store: sweep, events: w.events, repDays: w.repDays, transaction: memoryTransaction };
    await sweepContactSources("call", NOW, { ...deps, lease: lease() });
    const late = outboundCall("101", NUMBER, "2026-10-05T14:30:00Z");
    w.events.calls.set(late.id, late);
    sweep.sources.get("call")!.push({ id: late.id, updated_at: new Date("2026-10-05T18:58:30Z") });
    const result = await sweepContactSources("call", NOW, { ...deps, lease: lease() });
    assert.equal(result.changed, 1);
    assert.equal(w.repDays.row(ALICE, TODAY)!.actual_confirmed, 2);
  });

  test("skips: configuration not active, desk and goal metrics off, lease held — the cursor does not move", async () => {
    const w = world();
    const sweep = new MemorySweepStore();
    const base = { store: sweep, events: w.events, repDays: w.repDays, transaction: memoryTransaction };
    assert.equal((await sweepContactSources("call", NOW, { ...base, loader: fixedConfigurationLoader({ state: "uninitialized" }), lease: lease() })).reason, "configuration_uninitialized");
    assert.equal((await sweepContactSources("call", NOW, { ...base, loader: fixedConfigurationLoader(activeInspection(desk({ controls: { desk_enabled: false, goal_metrics_enabled: false } }))), lease: lease() })).reason, "desk_and_goal_metrics_disabled");
    assert.equal((await sweepContactSources("call", NOW, { ...base, loader: fixedConfigurationLoader(activeInspection(desk())), lease: lease(true) })).reason, "lease_held");
    assert.equal(sweep.state.size, 0);
  });

  test("SMS sweep derives evidence rows and never touches rep-days", async () => {
    const w = world();
    const sweep = new MemorySweepStore();
    const smsNumber = newId();
    w.ctx.number("+15550100299", smsNumber).lead(smsNumber);
    w.events.context = w.ctx.build();
    const id = newId();
    w.events.sms.set(id, {
      id, canonical_logical_id: `x:${id}`, direction: "outbound", status: "sent", send_at: new Date("2026-10-05T14:00:00Z"), provider_created_at: new Date("2026-10-05T14:00:00Z"),
      counterpart_numbers: ["+15550100299"], is_group: false, reviewed_agent_id: ALICE, identity_state: "reviewed", source_revision: 1, duplicate_copy: false,
    });
    sweep.sources.set("sms", [{ id, updated_at: new Date("2026-10-05T14:00:05Z") }]);
    const result = await sweepContactSources("sms", NOW, { loader: fixedConfigurationLoader(activeInspection(desk())), store: sweep, events: w.events, repDays: w.repDays, lease: lease(), transaction: memoryTransaction });
    assert.deepEqual([result.derived, result.changed, result.rep_days_recounted], [1, 1, 0]);
    assert.equal(sweep.state.get("sms")!.known_complete_through, null, "no rep-day watermark from SMS");
    assert.equal(w.events.jobsOf("outreach_evaluate").length, 1);
  });

  test("refresh: recounts today's incomplete rows and freezes yesterday's goal once", async () => {
    const w = world();
    await applyContactSources([call(w.events, outboundCall("101", NUMBER, "2026-10-04T14:10:00Z"))], { now: NOW, queueRepDays: false }, w.events, SESSION);
    await recount(w, ALICE, "2026-10-04", active(), new Date("2026-10-04T20:00:00Z"));
    assert.equal(w.repDays.row(ALICE, "2026-10-04")!.goal_snapshot.configuration_version, null);
    const deps = { loader: fixedConfigurationLoader(activeInspection(desk())), repDays: w.repDays, transaction: memoryTransaction };
    const first = await refreshOpenRepDays(NOW, deps);
    assert.equal(first.recounted, 1);
    assert.equal(w.repDays.row(ALICE, "2026-10-04")!.goal_snapshot.configuration_version, "v-test");
    const second = await refreshOpenRepDays(NOW, deps);
    assert.equal(second.recounted, 0, "frozen and complete: nothing to do");
  });
});
