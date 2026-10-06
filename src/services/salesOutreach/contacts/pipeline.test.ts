import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import type { SalesOutreachConfigurationInput } from "../../../validation/v1/salesOutreach";
import { summarizeTeamGoals } from "../engine/credit";
import { resolveRepDayGoal } from "../reads/goals";
import { activeInspection, fixedConfigurationLoader } from "../reads/testing";
import type { ActiveConfiguration } from "../config/load";
import { applyContactSources, contactEvaluationJob, repDayJob, repDayKeyOf } from "./apply";
import { contactEventId } from "./derive";
import { parseContactSubjectKey, parseRepDaySubjectKey, runOutreachContactChangeJob, runOutreachRepDayJob, type ContactJobDeps } from "./jobs";
import { composeRepDayRow, countScopeForDay, repDayCoverage } from "./repDay";
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

describe("call-inferred receiver fill", () => {
  test("the most recent reviewed-rep call on a subject names its receiver; a replay or a filled receiver writes nothing more", async () => {
    const w = world();
    const sources = [
      call(w.events, outboundCall("101", NUMBER, "2026-10-05T14:10:00Z")),
      call(w.events, outboundCall("102", NUMBER, "2026-10-05T15:10:00Z")),
    ];
    const first = await applyContactSources(sources, { now: NOW, queueRepDays: false }, w.events, SESSION);
    assert.equal(first.receivers_filled, 1);
    assert.equal(w.events.receivers.get(w.subject.id), BOB, "the later caller wins");
    assert.deepEqual(w.events.fills.map((f) => f.source_id), [sources[1]!.source_id]);

    const replay = await applyContactSources(sources, { now: NOW, queueRepDays: false }, w.events, SESSION);
    assert.equal(replay.receivers_filled, 0, "the receiver is no longer empty");
    assert.equal(w.events.receivers.get(w.subject.id), BOB);
  });

  test("an answered inbound by a reviewed rep fills; a missed inbound, an unreviewed caller or no subject does not", async () => {
    const answered = world();
    const result = await applyContactSources([call(answered.events, inboundCall("101", NUMBER, "2026-10-05T14:10:00Z"))], { now: NOW, queueRepDays: false }, answered.events, SESSION);
    assert.equal(result.receivers_filled, 1);
    assert.equal(answered.events.receivers.get(answered.subject.id), ALICE);

    for (const row of [
      inboundCall(null, NUMBER, "2026-10-05T14:10:00Z"),
      outboundCall("199", NUMBER, "2026-10-05T14:10:00Z"), // no reviewed link for this extension
      outboundCall("101", newId(), "2026-10-05T14:10:00Z"), // a number with no Lead
    ]) {
      const w = world();
      const none = await applyContactSources([call(w.events, row)], { now: NOW, queueRepDays: false }, w.events, SESSION);
      assert.equal(none.receivers_filled, 0);
      assert.equal(w.events.fills.length, 0);
    }
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

  test("olr C1a countScopeForDay: absent/empty schedule, before the first entry, on the boundary, after a flip back", () => {
    assert.equal(countScopeForDay(TODAY, undefined), "all_outbound", "absent = all_outbound (D1 A)");
    assert.equal(countScopeForDay(TODAY, null), "all_outbound");
    assert.equal(countScopeForDay(TODAY, []), "all_outbound");
    const schedule = [
      { from_day: "2026-10-07", scope: "eligible_new_quoted" as const },
      { from_day: "2026-10-20", scope: "all_outbound" as const },
    ];
    assert.equal(countScopeForDay("2026-10-06", schedule), "all_outbound", "before the first entry");
    assert.equal(countScopeForDay("2026-10-07", schedule), "eligible_new_quoted", "on the boundary");
    assert.equal(countScopeForDay("2026-10-19", schedule), "eligible_new_quoted");
    assert.equal(countScopeForDay("2026-10-20", schedule), "all_outbound", "a flip back");
    assert.equal(countScopeForDay("2026-11-01", schedule), "all_outbound");
  });

  test("olr C1a: the scope comes from the configuration, not the enrollment run — absent schedule counts all_outbound", async () => {
    const w = world();
    // Days after an enrollment apply used to narrow to eligible-only; with no schedule they stay all_outbound.
    const sources = [call(w.events, outboundCall("101", NUMBER, "2026-10-05T14:10:00Z")), call(w.events, outboundCall("101", newId(), "2026-10-05T14:30:00Z"))];
    await applyContactSources(sources, { now: NOW, queueRepDays: false }, w.events, SESSION);
    await recount(w, ALICE);
    const row = w.repDays.row(ALICE, TODAY)!;
    assert.deepEqual([row.count_scope, row.actual_confirmed, row.unattributed], ["all_outbound", 2, 1]);
  });

  test("olr C1a: a configured flip on day D gives D−1 all_outbound and D eligible_new_quoted", async () => {
    const w = world();
    const flipped = active(desk({ goals: { ...desk().goals!, count_scope_schedule: [{ from_day: TODAY, scope: "eligible_new_quoted" }] } }));
    w.repDays.marks = { ...w.repDays.marks, coverage_from: new Date("2026-09-01T04:00:00Z") };
    const sources = [
      call(w.events, outboundCall("101", NUMBER, "2026-10-04T14:10:00Z")),
      call(w.events, outboundCall("101", newId(), "2026-10-04T14:30:00Z")),
      call(w.events, outboundCall("101", NUMBER, "2026-10-05T14:10:00Z")),
      call(w.events, outboundCall("101", newId(), "2026-10-05T14:30:00Z")),
    ];
    await applyContactSources(sources, { now: NOW, queueRepDays: false }, w.events, SESSION);
    await recount(w, ALICE, "2026-10-04", flipped);
    await recount(w, ALICE, TODAY, flipped);
    const before = w.repDays.row(ALICE, "2026-10-04")!;
    const on = w.repDays.row(ALICE, TODAY)!;
    assert.deepEqual([before.count_scope, before.actual_confirmed, before.unattributed], ["all_outbound", 2, 1]);
    assert.deepEqual([on.count_scope, on.actual_confirmed, on.unattributed], ["eligible_new_quoted", 1, 1]);
  });

  test("olr C1a: a frozen row keeps its goal snapshot through a scope recount", async () => {
    const w = world();
    await applyContactSources([call(w.events, outboundCall("101", NUMBER, "2026-10-04T14:10:00Z")), call(w.events, outboundCall("101", newId(), "2026-10-04T14:30:00Z"))], { now: NOW, queueRepDays: false }, w.events, SESSION);
    // Frozen after its day under the old scope (as the pre-C1a build wrote it), with goal 100.
    const old = active(desk({ goals: { ...desk().goals!, count_scope_schedule: [{ from_day: "2026-10-01", scope: "eligible_new_quoted" }] } }), "v-old", 3);
    await recount(w, ALICE, "2026-10-04", old);
    const frozen = w.repDays.row(ALICE, "2026-10-04")!;
    assert.deepEqual([frozen.count_scope, frozen.actual_confirmed, frozen.goal_snapshot.configuration_version, frozen.goal_snapshot.goal], ["eligible_new_quoted", 1, "v-old", 100]);
    // The configuration now says all_outbound for that day (and a different goal): the scope moves, the snapshot does not.
    const now = active(desk({ goals: { ...desk().goals!, default_scheduled_goal: 80 } }), "v-new", 4);
    const result = await recount(w, ALICE, "2026-10-04", now);
    assert.equal(result.outcome, "written");
    const after = w.repDays.row(ALICE, "2026-10-04")!;
    assert.deepEqual([after.count_scope, after.actual_confirmed, after.unattributed], ["all_outbound", 2, 1]);
    assert.deepEqual(after.goal_snapshot, frozen.goal_snapshot, "frozen snapshot unchanged");
    assert.equal(after.publication_revision, frozen.publication_revision + 1);
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
    const goals: unknown[] = [];
    const repDay = await runOutreachRepDayJob(undefined, {
      ...deps,
      claim: (async () => leased(`outreach-rep-day:${ALICE}:${TODAY}`)) as never,
      publishGoal: async (changes) => void goals.push(...changes),
    });
    assert.equal(repDay.status, "completed");
    assert.equal(w.repDays.row(ALICE, TODAY)!.actual_confirmed, 1);
    assert.deepEqual(goals, [{ agent_id: ALICE, business_day: TODAY, publication_revision: 1 }], "outreach_goal hint after commit (S1 4b seam)");
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

  test("A3: the calls sweep writes observed_complete_through when caught up (only once it caught up, only when capture has one)", async () => {
    const w = world();
    const sweep = new MemorySweepStore();
    const deps = () => ({ loader: fixedConfigurationLoader(activeInspection(desk())), store: sweep, events: w.events, repDays: w.repDays, lease: lease(), transaction: memoryTransaction });
    // Before the first A3 reconcile run capture has no observed watermark: nothing is invented.
    sweep.capture = new Date("2026-10-05T18:10:00Z");
    const call = outboundCall("101", NUMBER, "2026-10-05T14:00:00Z");
    w.events.calls.set(call.id, call);
    sweep.sources.set("call", [{ id: call.id, updated_at: new Date("2026-10-05T14:00:05Z") }]);
    await sweepContactSources("call", NOW, deps());
    assert.equal(sweep.state.get("call")!.known_complete_through!.toISOString(), "2026-10-05T18:10:00.000Z");
    assert.equal(sweep.state.get("call")!.observed_complete_through, null);
    // Capture now carries both: a provisional row holds `known` 50 min back, `observed` trails by the lag only.
    sweep.capture = new Date("2026-10-05T18:10:00Z");
    sweep.captureObserved = new Date("2026-10-05T18:44:00Z");
    const result = await sweepContactSources("call", NOW, deps());
    assert.equal(result.caught_up, true);
    const state = sweep.state.get("call")!;
    assert.equal(state.known_complete_through!.toISOString(), "2026-10-05T18:10:00.000Z", "the derivation watermark keeps the capped value");
    assert.equal(state.observed_complete_through!.toISOString(), "2026-10-05T18:44:00.000Z", "and stores the uncapped one beside it");
    // A pass that does not catch up (budget spent on a full page) stores neither.
    const behind = new MemorySweepStore();
    behind.capture = new Date("2026-10-05T18:50:00Z");
    behind.captureObserved = new Date("2026-10-05T18:52:00Z");
    behind.sources.set("call", Array.from({ length: 250 }, (_, i) => ({ id: `f${String(i).padStart(23, "0")}`, updated_at: new Date(Date.parse("2026-10-05T13:00:00Z") + i * 1000) })));
    let ticks = 0;
    await sweepContactSources("call", NOW, { ...deps(), store: behind, clock: () => (ticks++ < 2 ? 0 : 1_000_000), budgetMs: 10 });
    assert.equal(behind.state.get("call")!.known_complete_through, null);
    assert.equal(behind.state.get("call")!.observed_complete_through, null);
    // SMS never carries a call watermark.
    const sms = new MemorySweepStore();
    sms.captureObserved = new Date("2026-10-05T18:44:00Z");
    sms.sources.set("sms", []);
    await sweepContactSources("sms", NOW, { ...deps(), store: sms });
    assert.equal(sms.state.get("sms")!.observed_complete_through, null);
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
    assert.equal(first.recounted, 3, "Alice's open row + the C5 zero rows of Bob and Carol");
    assert.equal(w.repDays.row(ALICE, "2026-10-04")!.goal_snapshot.configuration_version, "v-test");
    const second = await refreshOpenRepDays(NOW, deps);
    assert.equal(second.recounted, 0, "frozen and complete: nothing to do");
  });

  test("olr C1a refresh: a complete row of today whose stored count_scope differs from the configured one is recounted", async () => {
    const w = world();
    await applyContactSources([call(w.events, outboundCall("101", NUMBER, "2026-10-05T14:10:00Z")), call(w.events, outboundCall("101", newId(), "2026-10-05T14:30:00Z"))], { now: NOW, queueRepDays: false }, w.events, SESSION);
    // An older build wrote today's row under eligible_new_quoted (the 2026-10-06 production case).
    const narrowed = active(desk({ goals: { ...desk().goals!, count_scope_schedule: [{ from_day: "2026-10-01", scope: "eligible_new_quoted" }] } }));
    await recount(w, ALICE, TODAY, narrowed);
    const stale = w.repDays.row(ALICE, TODAY)!;
    assert.deepEqual([stale.count_scope, stale.actual_confirmed, stale.coverage.state], ["eligible_new_quoted", 1, "complete"]);
    // The active configuration has no schedule (all_outbound): the refresh self-corrects the complete row.
    const deps = { loader: fixedConfigurationLoader(activeInspection(desk())), repDays: w.repDays, transaction: memoryTransaction };
    const first = await refreshOpenRepDays(NOW, deps);
    assert.equal(first.recounted, 4, "today's stale row + the C5 zero rows of yesterday's three roster reps");
    const fixed = w.repDays.row(ALICE, TODAY)!;
    assert.deepEqual([fixed.count_scope, fixed.actual_confirmed], ["all_outbound", 2]);
    assert.equal(fixed.publication_revision, stale.publication_revision + 1);
    const second = await refreshOpenRepDays(NOW, deps);
    assert.equal(second.recounted, 0, "scope matches and coverage complete: nothing to do");
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

  test("olr C5 refresh: after midnight one frozen zero row per roster rep without a row yesterday — none today, none off the roster", async () => {
    const w = world();
    const outsider = newId();
    const idle = newId(); // an Agent off the roster with no activity: never materialized
    w.ctx.link(outsider, "105");
    w.events.context = w.ctx.build();
    // Alice and an off-roster Agent called on 2026-10-04; Bob and Carol (roster) did not.
    await applyContactSources(
      [call(w.events, outboundCall("101", NUMBER, "2026-10-04T14:10:00Z")), call(w.events, outboundCall("105", newId(), "2026-10-04T14:20:00Z"))],
      { now: NOW, queueRepDays: false },
      w.events,
      SESSION,
    );
    await recount(w, ALICE, "2026-10-04", active(), new Date("2026-10-04T20:00:00Z"));
    await recount(w, outsider, "2026-10-04", active(), new Date("2026-10-04T20:00:00Z"));
    const afterMidnight = new Date("2026-10-05T04:30:00Z"); // 00:30 New York on 2026-10-05
    const deps = { loader: fixedConfigurationLoader(activeInspection(desk())), repDays: w.repDays, transaction: memoryTransaction };
    const first = await refreshOpenRepDays(afterMidnight, deps);
    assert.deepEqual([first.skipped, first.failures], [false, 0]);
    for (const agent of [BOB, CAROL]) {
      const row = w.repDays.row(agent, "2026-10-04")!;
      assert.ok(row, "a roster rep without a row yesterday gets one");
      assert.deepEqual(
        [row.actual_confirmed, row.actual_awaiting_confirmation, row.unattributed, row.count_scope, row.goal_state, row.publication_revision],
        [0, 0, 0, "all_outbound", "goal", 1],
      );
      assert.deepEqual(
        [row.goal_snapshot.configuration_version, row.goal_snapshot.goal, row.goal_snapshot.roster_version],
        ["v-test", 100, "roster-1"],
        "the goal snapshot is frozen",
      );
      assert.equal(row.coverage.state, "complete");
      assert.equal(w.repDays.row(agent, "2026-10-05"), null, "never today");
    }
    assert.equal(w.repDays.row(ALICE, "2026-10-04")!.actual_confirmed, 1, "a rep with activity keeps its row (no second row)");
    assert.equal(w.repDays.row(idle, "2026-10-04"), null, "off the roster: nothing");
    assert.equal([...w.repDays.rows.values()].filter((row) => row.business_day === "2026-10-04").length, 4);
    assert.equal([...w.repDays.rows.values()].filter((row) => row.business_day === "2026-10-05").length, 0);
    // Idempotent: a second refresh writes nothing.
    const before = JSON.stringify([...w.repDays.rows.entries()]);
    const second = await refreshOpenRepDays(afterMidnight, deps);
    assert.deepEqual([second.recounted, second.failures], [0, 0]);
    assert.equal(JSON.stringify([...w.repDays.rows.entries()]), before, "no row rewritten");
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

  test("olr C5: the zero row of a day whose coverage is still partial at midnight is written, then recounted until complete", async () => {
    const w = world();
    w.repDays.marks = { ...w.repDays.marks, capture_known_complete_through: new Date("2026-10-05T03:00:00Z"), derived_through: new Date("2026-10-05T03:00:00Z") };
    const afterMidnight = new Date("2026-10-05T04:30:00Z");
    const deps = { loader: fixedConfigurationLoader(activeInspection(desk())), repDays: w.repDays, transaction: memoryTransaction };
    assert.equal((await refreshOpenRepDays(afterMidnight, deps)).recounted, 3);
    const partial = w.repDays.row(BOB, "2026-10-04")!;
    assert.deepEqual([partial.coverage.state, partial.actual_confirmed, partial.goal_snapshot.configuration_version], ["partial", 0, "v-test"]);
    assert.equal((await refreshOpenRepDays(afterMidnight, deps)).recounted, 3, "incomplete rows stay in the refresh");
    w.repDays.marks = { ...w.repDays.marks, capture_known_complete_through: new Date("2026-10-05T04:20:00Z"), derived_through: new Date("2026-10-05T04:20:00Z") };
    await refreshOpenRepDays(afterMidnight, deps);
    const complete = w.repDays.row(BOB, "2026-10-04")!;
    assert.deepEqual(
      [complete.coverage.state, complete.publication_revision, complete.goal_snapshot.configuration_version],
      ["complete", partial.publication_revision + 1, "v-test"],
    );
    assert.equal((await refreshOpenRepDays(afterMidnight, deps)).recounted, 0);
  });

  test("olr C5 recountRepDay materialize: only a past day of a roster rep; the identity ignores the flag", async () => {
    const w = world();
    const outsider = newId();
    const past = await recountRepDay({ agent_id: BOB, business_day: "2026-10-04" }, active(), NOW, w.repDays, SESSION);
    assert.equal(past.outcome, "no_activity", "without materialize the no-row rule stands (queued rep-day jobs, sweep)");
    const today = await recountRepDay({ agent_id: BOB, business_day: TODAY }, active(), NOW, w.repDays, SESSION, { materialize: true });
    assert.equal(today.outcome, "no_activity", "never today");
    const offRoster = await recountRepDay({ agent_id: outsider, business_day: "2026-10-04" }, active(), NOW, w.repDays, SESSION, { materialize: true });
    assert.equal(offRoster.outcome, "no_activity", "never an Agent off the roster");
    assert.equal(w.repDays.rows.size, 0);
    const written = await recountRepDay({ agent_id: BOB, business_day: "2026-10-04" }, active(), NOW, w.repDays, SESSION, { materialize: true });
    assert.deepEqual([written.outcome, written.publication_revision], ["written", 1]);
    const again = await recountRepDay({ agent_id: BOB, business_day: "2026-10-04" }, active(), NOW, w.repDays, SESSION, { materialize: true });
    assert.equal(again.outcome, "unchanged");
    const key = { agent_id: BOB, business_day: "2026-10-04" };
    assert.equal(repDayKeyOf({ ...key, materialize: true }), repDayKeyOf(key));
    assert.deepEqual(repDayJob({ ...key, materialize: true }, ["m"]), repDayJob(key, ["m"]));
  });
});
