import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import type { SalesOutreachConfigurationInput } from "../../../validation/v1/salesOutreach";
import { summarizeTeamGoals } from "../engine/credit";
import { resolveRepDayGoal } from "../reads/goals";
import { activeInspection, fixedConfigurationLoader } from "../reads/testing";
import type { ActiveConfiguration } from "../config/load";
import { deskTimingOf } from "../config/timing";
import { applyContactSources } from "./apply";
import { contactEventId } from "./derive";
import { runOutreachContactChangeJob, runOutreachRepDayJob, type ContactJobDeps } from "./jobs";
import { composeRepDayRow } from "./repDay";
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
import { MemoryRepDayStore, MemorySweepStore, callMarks } from "./testingPipeline";

/** Code-default desk timing (settlement 2 min, today tolerance 25 min). */
const TIMING = deskTimingOf(null);

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
  repDays.marks = callMarks(new Date("2026-10-06T05:00:00Z"), new Date("2026-10-06T05:00:00Z"), new Date("2026-10-01T04:00:00Z"));
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
});

test("an answered inbound by a reviewed rep fills; a missed inbound, an outbound attempt, an unreviewed caller or no subject does not", async () => {
  const answered = world();
  const result = await applyContactSources([call(answered.events, inboundCall("101", NUMBER, "2026-10-05T14:10:00Z"))], { now: NOW, queueRepDays: false }, answered.events, SESSION);
  assert.equal(result.receivers_filled, 1);
  assert.equal(answered.events.receivers.get(answered.subject.id), ALICE);

  for (const row of [
    inboundCall(null, NUMBER, "2026-10-05T14:10:00Z"),
    outboundCall("101", NUMBER, "2026-10-05T14:10:00Z"), // an ordinary outbound attempt
    outboundCall("199", NUMBER, "2026-10-05T14:10:00Z"), // no reviewed link for this extension
    outboundCall("101", newId(), "2026-10-05T14:10:00Z"), // a number with no Lead
  ]) {
    const w = world();
    const none = await applyContactSources([call(w.events, row)], { now: NOW, queueRepDays: false }, w.events, SESSION);
    assert.equal(none.receivers_filled, 0);
    assert.equal(w.events.fills.length, 0);
  }
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

  test("END-TO-END-RUN §3: Helpers/transfers/duplicate receipts — one canonical credit, initiator only", async () => {
    const w = world();
    const transfer = outboundCall("101", NUMBER, "2026-10-05T14:10:00Z", { legs: [leg("101", "2026-10-05T14:10:00Z"), leg("102", "2026-10-05T14:12:00Z", { leg_type: "Transfer" })] });
    const duplicateReceipt = outboundCall("101", NUMBER, "2026-10-05T14:10:00Z", { merged_into_id: transfer.id });
    const helper = outboundCall("102", NUMBER, "2026-10-05T16:00:00Z");
    const sources = [call(w.events, transfer), call(w.events, duplicateReceipt), call(w.events, helper)];
    const apply = () => applyContactSources(sources, { now: NOW, queueRepDays: false }, w.events, SESSION);
    await apply();
    assert.equal(w.events.events.get(contactEventId("call", transfer.id))!.goal_agent_id, ALICE);
    assert.equal(w.events.events.get(contactEventId("call", helper.id))!.goal_agent_id, BOB);
    await recount(w, ALICE);
    await recount(w, BOB);
    assert.equal(w.repDays.row(ALICE, TODAY)!.actual_confirmed, 1, "transfer + duplicate receipt = one credit to Alice");
    assert.equal(w.repDays.row(BOB, TODAY)!.actual_confirmed, 1, "the helper's own call credits the helper");

    const eventWrites = w.events.writes;
    const rows = [...w.repDays.rows.entries()];
    assert.equal((await apply()).changed, 0);
    assert.equal(w.events.writes, eventWrites);
    assert.equal((await recount(w, ALICE)).outcome, "unchanged");
    assert.equal((await recount(w, BOB)).outcome, "unchanged");
    assert.deepEqual([...w.repDays.rows.entries()], rows);
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

  test("p08a / END-TO-END-RUN §3: Goals 100/100/100/50/0 with actuals 100/0/120/25/10", () => {
    const fx = JSON.parse(readFileSync(path.join(process.cwd(), "src/services/salesOutreach/testSupport/contracts/fixtures/p08a-roster-goals.json"), "utf8")) as {
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
        watermarks: callMarks(NOW, NOW), timing: TIMING,
      }),
    );
    rows.forEach((row, i) => assert.equal(row.goal_snapshot.goal, fx.rows[i]!.goal, `goal of ${fx.rows[i]!.rep}`));
    const e = rows[4]!;
    assert.deepEqual([e.goal_state, e.actual_confirmed, e.goal_snapshot.override?.reason], ["no_goal_today", 10, "absence"]);
    const team = summarizeTeamGoals(rows.map((row) => ({ goal: row.goal_snapshot.goal!, actual: row.actual_confirmed })));
    assert.deepEqual(team, { team_goal: fx.expected_team_goal, actual: fx.expected_actual, goal_enabled_reps: fx.expected_goal_enabled_reps, reps_at_goal: fx.expected_reps_at_goal });
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

  test("contact change job: derives, enqueues and publishes after commit; rep-day job recounts", async () => {
    const w = world();
    const source = call(w.events, outboundCall("101", NUMBER, "2026-10-05T14:10:00Z"));
    const { deps, calls } = harness(w);
    const done = await runOutreachContactChangeJob(undefined, { ...deps, claim: (async () => leased(`call:${source.source_id}`)) as never });
    assert.equal(done.status, "completed");
    assert.deepEqual(calls, ["publish:2"]);
    const goals: unknown[] = [];
    const repDay = await runOutreachRepDayJob(undefined, {
      ...deps,
      claim: (async () => leased(`outreach-rep-day:${ALICE}:${TODAY}`)) as never,
      publishGoal: async (changes) => void goals.push(...changes),
    });
    assert.equal(repDay.status, "completed");
    assert.equal(w.repDays.row(ALICE, TODAY)!.actual_confirmed, 1);
    assert.deepEqual(goals, [{ agent_id: ALICE, business_day: TODAY, publication_revision: 1, goal_crossed: false }], "outreach_goal hint after commit (S1 4b seam)");
  });
});

describe("minute sweep and refresh", () => {
  const lease = (held = false): SweepLease & { released: number } => {
    const l = { released: 0, acquire: async () => !held, release: async () => void l.released++ };
    return l;
  };

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

  test("olr C1a refresh: a row whose count_scope field disagrees with its fingerprint is rewritten once, then left alone", async () => {
    const w = world();
    await applyContactSources([call(w.events, outboundCall("101", NUMBER, "2026-10-05T14:10:00Z"))], { now: NOW, queueRepDays: false }, w.events, SESSION);
    await recount(w, ALICE);
    const key = `${ALICE}|${TODAY}`;
    const written = w.repDays.rows.get(key)!;
    // Only the scope field differs (the fingerprint still matches all_outbound): no "unchanged" short-circuit.
    w.repDays.rows.set(key, { ...written, count_scope: "eligible_new_quoted" });
    const deps = { loader: fixedConfigurationLoader(activeInspection(desk())), repDays: w.repDays, transaction: memoryTransaction };
    assert.equal((await refreshOpenRepDays(NOW, deps)).recounted, 4, "the stale row + the C5 zero rows of yesterday's three roster reps");
    assert.deepEqual([w.repDays.row(ALICE, TODAY)!.count_scope, w.repDays.row(ALICE, TODAY)!.publication_revision], ["all_outbound", written.publication_revision + 1]);
    assert.equal((await refreshOpenRepDays(NOW, deps)).recounted, 0);
  });

  test("olr C5: a later goal edit does not change yesterday's resolved goal (projection_snapshot)", async () => {
    const w = world();
    const afterMidnight = new Date("2026-10-05T04:30:00Z");
    await refreshOpenRepDays(afterMidnight, { loader: fixedConfigurationLoader(activeInspection(desk())), repDays: w.repDays, transaction: memoryTransaction });
    const frozen = w.repDays.row(BOB, "2026-10-04")!;
    // The Owner lowers the default goal and drops Bob from the roster the next morning.
    const edited = desk({
      goals: {
        ...desk().goals!,
        roster_version: "roster-2",
        default_scheduled_goal: 80,
        rep_work_schedules: [ALICE, CAROL].map((agent_id) => ({ agent_id, working_days: [1, 2, 3, 4, 5, 6, 7] })),
      },
    });
    const later = active(edited, "v-next", 4);
    await refreshOpenRepDays(NOW, { loader: fixedConfigurationLoader(later), repDays: w.repDays, transaction: memoryTransaction });
    assert.equal(w.repDays.row(BOB, "2026-10-04")!.publication_revision, frozen.publication_revision, "the frozen row is not rewritten");
    const resolved = resolveRepDayGoal({ goals: later.value.goals, configuration_version: "v-next", agent_id: BOB, business_day: "2026-10-04", today: TODAY, row: w.repDays.row(BOB, "2026-10-04") });
    assert.deepEqual(
      [resolved.goal, resolved.goal_state, resolved.provenance.source, resolved.provenance.configuration_version],
      [100, "goal", "projection_snapshot", "v-test"],
    );
    // Without the materialized row the same day would have resolved from the edited configuration.
    const live = resolveRepDayGoal({ goals: later.value.goals, configuration_version: "v-next", agent_id: BOB, business_day: "2026-10-04", today: TODAY, row: null });
    assert.deepEqual([live.goal_state, live.provenance.source], ["not_on_roster", "configuration"]);
  });
});

describe("olr C1b: both scopes stored on the rep-day row", () => {
  const eligibleFrom = (day: string) => active(desk({ goals: { ...desk().goals!, count_scope_schedule: [{ from_day: day, scope: "eligible_new_quoted" }] } }));

  test("the recount stores both scopes' counts; the headline is the row's scope", async () => {
    const w = world();
    const sources = [
      call(w.events, outboundCall("101", NUMBER, "2026-10-05T14:10:00Z")), // eligible, confirmed
      call(w.events, outboundCall("101", newId(), "2026-10-05T14:30:00Z")), // no subject, confirmed
      call(w.events, outboundCall("101", newId(), "2026-10-05T14:40:00Z", { call_log_state: null, legs: [] })), // no subject, awaiting
    ];
    await applyContactSources(sources, { now: NOW, queueRepDays: false }, w.events, SESSION);
    await recount(w, ALICE, TODAY, eligibleFrom(TODAY));
    const row = w.repDays.row(ALICE, TODAY)!;
    assert.deepEqual(
      [row.count_scope, row.actual_confirmed, row.actual_awaiting_confirmation, row.unattributed],
      ["eligible_new_quoted", 1, 0, 1],
    );
    assert.deepEqual([row.actual_confirmed_all, row.actual_confirmed_eligible, row.actual_awaiting_all, row.actual_awaiting_eligible], [2, 1, 1, 0]);
  });
});

describe("olr C8: the rep-day row stores the Other outbound breakdown", () => {
  test("apply + recount: each confirmed call without an eligible subject lands in its reason's bucket; the sum is unattributed", async () => {
    const w = world();
    const notEnrolled = newId();
    w.ctx.lead(notEnrolled, null);
    const sources = [
      call(w.events, outboundCall("101", NUMBER, "2026-10-05T14:10:00Z")), // eligible: counted
      call(w.events, outboundCall("101", notEnrolled, "2026-10-05T14:20:00Z")), // lead_not_enrolled
      call(w.events, outboundCall("101", newId(), "2026-10-05T14:30:00Z")), // no_lead
      call(w.events, outboundCall("101", newId(), "2026-10-05T14:40:00Z", { call_log_state: null, legs: [] })), // awaiting: not Other outbound
    ];
    await applyContactSources(sources, { now: NOW, queueRepDays: false }, w.events, SESSION);
    await recount(w, ALICE);
    const row = w.repDays.row(ALICE, TODAY)!;
    assert.deepEqual([row.actual_confirmed, row.unattributed], [3, 2]);
    assert.deepEqual(row.other_outbound, { no_lead: 1, lead_not_enrolled: 1, lead_closed: 0, before_activation: 0, ambiguous: 0, not_new_quoted: 0, unknown: 0 });
    // The Lead is enrolled later and its call re-derived: the bucket moves, the row is rewritten once.
    w.ctx.subjects.set([...w.ctx.attached.get(notEnrolled)!][0]!, subjectFacts({ workflow: "discretion" }));
    await applyContactSources([sources[1]!], { now: NOW, queueRepDays: false }, w.events, SESSION);
    const moved = await recount(w, ALICE);
    assert.equal(moved.outcome, "written");
    assert.deepEqual([moved.fields.other_outbound.lead_not_enrolled, moved.fields.other_outbound.not_new_quoted], [0, 1]);
    assert.equal((await recount(w, ALICE)).outcome, "unchanged", "a replay writes nothing");
  });
});

describe("olr C2d: the consumer and the sweep derive under evidence.call_association_rule", () => {
  const leased = (subject_key: string) => ({ _id: newId(), subject_key, lease_owner: "w", lease_epoch: 1 });
  /** The number's `lead` is not enrolled; one active desk subject sits in its `other_leads`. */
  const shadowWorld = () => {
    const ctx = new ContextBuilder().link(ALICE, "101");
    ctx.lead(NUMBER, null);
    const shadow = ctx.other(NUMBER, subjectFacts({ workflow: "new" })).subject!;
    const events = new MemoryContactEventStore(ctx.build());
    return { events, shadow, repDays: new MemoryRepDayStore(events) };
  };
  const ruleOn = () => desk({ evidence: { call_association_rule: "single_active_subject_on_link" } });
  const deps = (w: ReturnType<typeof shadowWorld>, input: SalesOutreachConfigurationInput): ContactJobDeps => ({
    loader: fixedConfigurationLoader(activeInspection(input)),
    store: w.events,
    repDayStore: w.repDays,
    now: () => NOW,
    complete: (async (_lease: unknown, mutation: (s: unknown) => Promise<unknown>) => mutation(SESSION)) as never,
    fail: (async () => undefined) as never,
    publish: async () => undefined,
  });

  test("contact change job: rule on credits the shadow subject and asks the store for other_leads; rule absent does neither", async () => {
    for (const [input, expected] of [[ruleOn(), "shadow"], [desk(), null]] as const) {
      const w = shadowWorld();
      const source = call(w.events, outboundCall("101", NUMBER, "2026-10-05T14:10:00Z"));
      const done = await runOutreachContactChangeJob(undefined, { ...deps(w, input), claim: (async () => leased(`call:${source.source_id}`)) as never });
      assert.equal(done.status, "completed");
      const event = w.events.events.get(contactEventId("call", source.source_id))!;
      assert.deepEqual([event.subject_id, event.association], expected ? [w.shadow.id, "unique"] : [null, "none"]);
      assert.equal(w.events.requests.at(-1)!.other_leads, expected ? true : undefined);
    }
  });
});
