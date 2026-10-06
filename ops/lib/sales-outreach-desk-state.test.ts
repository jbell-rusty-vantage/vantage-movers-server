import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { ObjectId, type Document } from "mongodb";
import { OUTREACH_CONTACT_CALLS_SCOPE, OUTREACH_CONTACT_SMS_SCOPE } from "../../src/config/domain/salesOutreachContacts";
import { CALL_LOG_ALL_DIRECTIONS_SCOPE } from "../../src/services/numberActivity/reconcileCallLog";
import { WEBHOOK_SUBSCRIPTION_SCOPE } from "../../src/services/numberActivity/webhookSubscriptionCron";
import { SUBSCRIPTION_HEALTH_SCOPE_CALLS, SUBSCRIPTION_HEALTH_SCOPE_REP_SMS } from "../../src/services/ringcentral/subscriptionHealth";
import { configurationContentHash } from "../../src/services/salesOutreach/config/store";
import { completeConfigurationInput, TEST_AGENT_A } from "../../src/services/salesOutreach/evaluation/testing";
import { salesOutreachConfigurationValueSchema } from "../../src/validation/v1/salesOutreach";
import {
  agentTail,
  collectDeskState,
  countsOf,
  DESK_STATE_SCOPES,
  installReadOnlyCommandGuard,
  lagMinutes,
  nestedCountsOf,
  parseDeskStateArgs,
  READ_GUARD_EXIT_CODE,
  readOnlyDeskStateReader,
  summarizeConfiguration,
  summarizeRepDays,
  summarizeRepSmsMailboxes,
  summarizeWatermark,
  type DeskStateReader,
} from "./sales-outreach-desk-state";

const NOW = new Date("2026-10-06T15:00:00.000Z");

test("desk-state CLI: a named target is required; --pretty indents; there is no write mode", () => {
  assert.deepEqual(parseDeskStateArgs(["--target=vantagemovers"]), { target: "vantagemovers", pretty: false });
  assert.deepEqual(parseDeskStateArgs(["--pretty", "--target=testvantagemovers_x1"]), { target: "testvantagemovers_x1", pretty: true });
  assert.throws(() => parseDeskStateArgs([]), /--target/);
  assert.throws(() => parseDeskStateArgs(["--target="]), /--target/);
  assert.throws(() => parseDeskStateArgs(["--target=prod db"]), /plain database name/);
  assert.throws(() => parseDeskStateArgs(["--target=vantagemovers", "--apply"]), /read-only/);
  assert.throws(() => parseDeskStateArgs(["--target=vantagemovers", "--everything"]), /Unknown argument/);
});

test("the sync-state scopes the snapshot reads are the ones the services write", () => {
  assert.deepEqual(DESK_STATE_SCOPES, {
    call_log: CALL_LOG_ALL_DIRECTIONS_SCOPE,
    contact_calls: OUTREACH_CONTACT_CALLS_SCOPE,
    contact_sms: OUTREACH_CONTACT_SMS_SCOPE,
    subscription_maintenance: WEBHOOK_SUBSCRIPTION_SCOPE,
    subscription_health_calls: SUBSCRIPTION_HEALTH_SCOPE_CALLS,
    subscription_health_rep_sms: SUBSCRIPTION_HEALTH_SCOPE_REP_SMS,
  });
});

test("the reader exposes reads only, refuses write stages before touching the database and caps finds", async () => {
  const touched: string[] = [];
  let findLimit: number | undefined;
  const fakeDb = {
    collection: (name: string) => {
      touched.push(name);
      return {
        countDocuments: async () => 3,
        aggregate: () => ({ toArray: async () => [{ _id: "x", n: 1 }] }),
        findOne: async () => null,
        find: (_filter: unknown, options: { limit?: number }) => {
          findLimit = options.limit;
          return { toArray: async () => [] };
        },
      };
    },
  };
  const reader = readOnlyDeskStateReader(fakeDb as never);
  assert.deepEqual(Object.keys(reader).sort(), ["aggregate", "count", "find", "findOne"]);
  await assert.rejects(reader.aggregate("c", [{ $match: {} }, { $out: "copy" }]), /\$out/);
  await assert.rejects(reader.aggregate("c", [{ $facet: { a: [{ $merge: { into: "copy" } }] } }]), /\$merge/);
  await assert.rejects(reader.aggregate("c", [{ $lookup: { from: "x", pipeline: [{ $out: "y" }], as: "z" } }]), /\$out/);
  assert.deepEqual(touched, [], "a refused pipeline never reaches the collection");
  assert.deepEqual(await reader.aggregate("c", [{ $group: { _id: "$a", n: { $sum: 1 } } }]), [{ _id: "x", n: 1 }]);
  await reader.find("c", {}, { projection: { _id: 1 }, limit: 1_000_000 });
  assert.equal(findLimit, 1_000);
});

test("the driver guard lets read commands through and exits before any write or admin command is sent", () => {
  const client = new EventEmitter();
  const exits: number[] = [];
  const reports: string[] = [];
  installReadOnlyCommandGuard(client as never, {
    exit: ((code: number) => {
      exits.push(code);
      return undefined as never;
    }) as (code: number) => never,
    report: (line) => reports.push(line),
  });
  const send = (commandName: string, command: Document = {}) => client.emit("commandStarted", { commandName, command, databaseName: "testvantagemovers" });
  for (const name of ["find", "aggregate", "count", "getMore", "listCollections", "hello", "endSessions"]) send(name, { pipeline: [] });
  assert.deepEqual(exits, []);
  send("aggregate", { pipeline: [{ $merge: { into: "x" } }] });
  for (const name of ["insert", "update", "delete", "createIndexes", "drop", "findAndModify", "create"]) send(name);
  assert.deepEqual(exits, Array(8).fill(READ_GUARD_EXIT_CODE));
  assert.match(reports[1] ?? "", /refused command 'insert'/);
});

test("group rows are shaped into sorted counts; compound ids join in field order; null and ObjectId keys are stable", () => {
  const id = new ObjectId("65a000000000000000a1b2c3");
  assert.deepEqual(countsOf([{ _id: "scheduled", n: 438 }, { _id: "due", n: 309 }, { _id: null, n: 2 }, { _id: "due", n: 1 }]), { due: 310, null: 2, scheduled: 438 });
  assert.deepEqual(countsOf([{ _id: { workflow: "quoted", start_kind: "activation" }, n: 438 }, { _id: { workflow: null, start_kind: "transition" }, n: 5 }]), {
    "null/transition": 5,
    "quoted/activation": 438,
  });
  assert.deepEqual(countsOf([{ _id: id, n: 1 }]), { [id.toHexString()]: 1 });
  assert.deepEqual(countsOf([{ _id: true, n: 4 }, { _id: "", n: 1 }]), { null: 1, true: 4 });
  assert.deepEqual(
    nestedCountsOf(
      [
        { _id: { stage: "outreach_evaluate", status: "pending" }, n: 36 },
        { _id: { stage: "call_log_refresh", status: "dead_letter" }, n: 1 },
        { _id: { stage: "outreach_evaluate", status: "leased" }, n: 2 },
      ],
      "stage",
      "status",
    ),
    { call_log_refresh: { dead_letter: 1 }, outreach_evaluate: { leased: 2, pending: 36 } },
  );
});

test("lag is whole minutes to the reference instant; unknown instants read null", () => {
  assert.equal(lagMinutes(new Date("2026-10-06T14:40:00Z"), NOW), 20);
  assert.equal(lagMinutes("2026-10-06T15:10:00Z", NOW), -10);
  assert.equal(lagMinutes(null, NOW), null);
  assert.equal(lagMinutes("not a date", NOW), null);
  assert.equal(agentTail(new ObjectId("65a000000000000000a1b2c3")), "a1b2c3");
  assert.equal(agentTail(null), "null");
});

test("watermarks report instants, lags and error codes and never carry provider tokens", () => {
  const row = {
    scope: "call_log_all_directions",
    known_complete_through: new Date("2026-10-06T14:45:00Z"),
    observed_complete_through: new Date("2026-10-06T14:55:00Z"),
    last_run: { started_at: new Date("2026-10-06T14:59:00Z"), finished_at: null, error_code: null, records: 4 },
    isync_lane: { last_run_at: new Date("2026-10-06T14:59:00Z"), last_success_at: new Date("2026-10-06T14:58:00Z"), last_error_code: null, last_records: 1 },
    call_log_sync: { token: "SECRET-SYNC-TOKEN", sync_time: new Date("2026-10-06T14:58:30Z"), consecutive_expiries: 0 },
    message_sync: { token: "SECRET-MESSAGE-TOKEN" },
  };
  const summary = summarizeWatermark("call_log_all_directions", row, NOW);
  assert.equal(summary.lag_min, 15);
  assert.equal(summary.observed_lag_min, 5);
  assert.equal(summary.isync_lane?.success_lag_min, 2);
  assert.equal(summary.call_log_sync?.sync_time, "2026-10-06T14:58:30.000Z");
  assert.equal(summary.last_run?.error_code, null);
  assert.doesNotMatch(JSON.stringify(summary), /SECRET/);

  const missing = summarizeWatermark(OUTREACH_CONTACT_SMS_SCOPE, null, NOW);
  assert.deepEqual(
    { present: missing.present, kct: missing.known_complete_through, lag: missing.lag_min, isync: "isync_lane" in missing },
    { present: false, kct: null, lag: null, isync: false },
  );
  assert.deepEqual(
    summarizeRepSmsMailboxes([{ message_sync: { last_success_at: new Date("2026-10-06T14:54:00Z") } }, { message_sync: { last_success_at: new Date("2026-10-06T14:59:00Z") } }, {}], NOW),
    { mailboxes: 3, never_synced: 1, worst_lag_min: 6, best_lag_min: 1 },
  );
});

test("rep-days: one business day's rows with count scope, coverage, totals and other outbound, most confirmed first", () => {
  const a = new ObjectId("65a0000000000000003221ab");
  const b = new ObjectId("65a00000000000000032227e");
  const rows = [
    { agent_id: b, business_day: "2026-10-06", count_scope: "all_outbound", actual_confirmed: 69, actual_awaiting_confirmation: 2, unattributed: 56, goal_snapshot: { goal: 100 }, goal_state: "behind", coverage: { state: "partial", reason: "capture_behind" } },
    { agent_id: a, business_day: "2026-10-06", count_scope: "all_outbound", actual_confirmed: 97, actual_awaiting_confirmation: 0, unattributed: 83, goal_snapshot: { goal: 100 }, goal_state: "behind", coverage: { state: "complete" } },
    { agent_id: a, business_day: "2026-10-05", count_scope: "eligible_new_quoted", actual_confirmed: 5, actual_awaiting_confirmation: 0, unattributed: 0, goal_snapshot: { goal: null }, goal_state: "no_goal", coverage: null },
  ];
  const today = summarizeRepDays("2026-10-06", rows);
  assert.equal(today.rows, 2);
  assert.deepEqual(today.totals, { confirmed: 166, awaiting_confirmation: 2, other_outbound: 139 });
  assert.deepEqual(today.count_scope, { all_outbound: 2 });
  assert.deepEqual(today.coverage_state, { complete: 1, partial: 1 });
  assert.deepEqual(today.reps.map((r) => [r.agent, r.confirmed, r.coverage_reason]), [["3221ab", 97, null], ["32227e", 69, "capture_behind"]]);
  const yesterday = summarizeRepDays("2026-10-05", rows);
  assert.deepEqual([yesterday.count_scope, yesterday.coverage_state, yesterday.reps[0]?.goal], [{ eligible_new_quoted: 1 }, { null: 1 }, null]);
  assert.equal(summarizeRepDays("2026-10-07", rows).rows, 0);
});

test("configuration: loader verdict plus both hash paths (R0); the roster is counted, never listed", () => {
  const value = salesOutreachConfigurationValueSchema.parse(completeConfigurationInput({ cadence_enforcement_enabled: true }));
  const hash = configurationContentHash(value);
  const pointer = { kind: "pointer", key: "active", version: "v5", revision: 5, content_hash: hash, updatedAt: new Date("2026-10-05T18:14:15.820Z") };
  const version = { kind: "version", key: "version:v5", version: "v5", value, content_hash: hash, approval_ref: "owner-session" };
  const active = summarizeConfiguration({
    inspection: { state: "active", version: "v5", revision: 5, content_hash: hash, approval_ref: "owner-session", value, updated_at: null, updated_by: null },
    pointer,
    version,
    versions_stored: 5,
  });
  assert.equal(active.state, "active");
  assert.equal(active.revision, 5);
  assert.equal(active.updated_at, "2026-10-05T18:14:15.820Z");
  assert.deepEqual(active.integrity, { stored_hash_present: true, pointer_matches_version: true, raw_hash_matches: true, parsed_hash_matches: true, parse_ok: true });
  assert.equal(active.goals.roster_size, 2);
  assert.equal(active.goals.default_scheduled_goal, 100);
  assert.deepEqual(active.controls, value.controls);
  assert.doesNotMatch(JSON.stringify(active), new RegExp(TEST_AGENT_A));

  // A value stored with a key this build does not know: the raw hash still matches, the parse fails.
  // (A0 made evidence.*_minutes known keys, so use a key no schema defines.)
  const future = { ...value, evidence: { ...value.evidence, unknown_future_key_minutes: 10 } };
  const futureHash = configurationContentHash(future as never);
  const drift = summarizeConfiguration({
    inspection: { state: "unavailable", reason: "invalid_value", version: "v6", revision: 6, updated_at: null, updated_by: null },
    pointer: { ...pointer, version: "v6", revision: 6, content_hash: futureHash },
    version: { ...version, version: "v6", value: future, content_hash: futureHash },
    versions_stored: 6,
  });
  assert.deepEqual([drift.state, drift.reason], ["unavailable", "invalid_value"]);
  assert.deepEqual(drift.integrity, { stored_hash_present: true, pointer_matches_version: true, raw_hash_matches: true, parsed_hash_matches: null, parse_ok: false });
  assert.equal((drift.evidence as Record<string, unknown>).unknown_future_key_minutes, 10);

  // A tampered stored value matches neither path.
  const tampered = summarizeConfiguration({
    inspection: { state: "unavailable", reason: "hash_mismatch", version: "v5", revision: 5, updated_at: null, updated_by: null },
    pointer,
    version: { ...version, value: { ...value, goals: { ...value.goals, default_scheduled_goal: 1 } } },
    versions_stored: 5,
  });
  assert.deepEqual([tampered.integrity.raw_hash_matches, tampered.integrity.parsed_hash_matches], [false, false]);

  const empty = summarizeConfiguration({ inspection: { state: "uninitialized" }, pointer: null, version: null, versions_stored: 0 });
  assert.deepEqual([empty.state, empty.revision, empty.integrity.raw_hash_matches, empty.goals.roster_size], ["uninitialized", null, null, null]);
});

test("the collector runs every query through the reader: read-only pipelines, bounded finds, one summary for an empty database", async () => {
  const calls: Array<{ op: string; collection: string; arg: unknown }> = [];
  const reader: DeskStateReader = {
    async count(collection, filter) {
      calls.push({ op: "count", collection, arg: filter });
      return 0;
    },
    async aggregate(collection, pipeline) {
      calls.push({ op: "aggregate", collection, arg: pipeline });
      assert.doesNotMatch(JSON.stringify(pipeline), /"\$(out|merge)"/);
      return [];
    },
    async findOne(collection, filter) {
      calls.push({ op: "findOne", collection, arg: filter });
      return null;
    },
    async find(collection, filter, options) {
      calls.push({ op: "find", collection, arg: options });
      assert.ok(options.limit > 0 && options.limit <= 1_000);
      return [];
    },
  };
  const state = await collectDeskState(reader, { database: "testvantagemovers_unit", now: NOW });
  assert.deepEqual(
    [state.database, state.as_of, state.ny_today, state.ny_yesterday, state.configuration.state],
    ["testvantagemovers_unit", NOW.toISOString(), "2026-10-06", "2026-10-05", "uninitialized"],
  );
  assert.deepEqual(Object.keys(state.watermarks), Object.keys(DESK_STATE_SCOPES));
  assert.equal(state.rep_days.today.rows, 0);
  assert.equal(state.jobs.dead_letters_total, 0);
  assert.deepEqual(
    [...new Set(calls.map((c) => c.collection))].sort(),
    [
      "call_interactions",
      "ringcentral_rep_sms_evidence",
      "ringcentral_webhook_subscriptions",
      "sales_intelligence_jobs",
      "sales_intelligence_sync_state",
      "sales_outreach_configuration",
      "sales_outreach_contact_events",
      "sales_outreach_enrollment_runs",
      "sales_outreach_policy_periods",
      "sales_outreach_projections",
      "sales_outreach_rep_day_projections",
      "sales_outreach_subjects",
    ],
  );
  // The watermark find never projects a token field.
  const syncFinds = calls.filter((c) => c.op === "find" && c.collection === "sales_intelligence_sync_state");
  assert.equal(syncFinds.length, 2);
  for (const f of syncFinds) assert.doesNotMatch(JSON.stringify(f.arg), /token/);
});
