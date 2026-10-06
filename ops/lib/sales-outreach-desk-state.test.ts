import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { ObjectId, type Document } from "mongodb";
import { OUTREACH_CONTACT_CALLS_SCOPE, OUTREACH_CONTACT_SMS_SCOPE } from "../../src/config/domain/salesOutreachContacts";
import { CALL_LOG_ALL_DIRECTIONS_SCOPE } from "../../src/services/numberActivity/reconcileCallLog";
import { WEBHOOK_SUBSCRIPTION_SCOPE } from "../../src/services/numberActivity/webhookSubscriptionCron";
import { SUBSCRIPTION_HEALTH_SCOPE_CALLS, SUBSCRIPTION_HEALTH_SCOPE_REP_SMS } from "../../src/services/ringcentral/subscriptionHealth";
import { CallLead } from "../../src/models/CallLead";
import { FormLead } from "../../src/models/FormLead";
import { getRingCentralCollectionName } from "../../src/services/ringcentral/ringcentral-config";
import { configurationContentHash } from "../../src/services/salesOutreach/config/store";
import { completeConfigurationInput, TEST_AGENT_A, TEST_AGENT_B } from "../../src/services/salesOutreach/evaluation/testing";
import { salesOutreachConfigurationValueSchema } from "../../src/validation/v1/salesOutreach";
import {
  agentTail,
  collectDeskState,
  composeServedRepDays,
  countsOf,
  DESK_STATE_CC04_INSTANT,
  DESK_STATE_SCOPES,
  EXTERNAL_CALL_DIRECTIONS,
  installReadOnlyCommandGuard,
  lagMinutes,
  LEAD_COLLECTIONS,
  nestedCountsOf,
  parseDeskStateArgs,
  READ_GUARD_EXIT_CODE,
  readOnlyDeskStateReader,
  repDayRowOf,
  summarizeCallsFreshnessInputs,
  summarizeConfiguration,
  summarizeRepDays,
  summarizeRepSmsMailboxes,
  summarizeSubjectsWithoutNumbers,
  summarizeWatermark,
  type DeskStateReader,
} from "./sales-outreach-desk-state";
import { CC04_INSTANT, SETTLE_DIRECTIONS } from "./sales-outreach-settle-pre-cc04";

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

test("the OPS-1 split uses the settle script's CC-04 instant and directions; Lead collections are the models'", () => {
  assert.equal(DESK_STATE_CC04_INSTANT.toISOString(), CC04_INSTANT.toISOString());
  assert.deepEqual([...EXTERNAL_CALL_DIRECTIONS], [...SETTLE_DIRECTIONS]);
  assert.deepEqual(LEAD_COLLECTIONS, { FormLead: FormLead.collection.collectionName, CallLead: CallLead.collection.collectionName });
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
  assert.equal(state.summary_version, 2);
  assert.deepEqual(state.rep_days.today_served, { business_day: "2026-10-06", available: false, reason: "configuration_not_active" });
  assert.deepEqual(
    [state.call_interactions.unconfirmed_by_direction, state.call_interactions.unconfirmed_inbound_outbound_total, state.call_interactions.unconfirmed_internal_total, state.call_interactions.before_cc04],
    [{}, 0, 0, { instant: "2026-09-24T01:28:03.000Z", inbound_outbound: 0, internal: 0 }],
  );
  assert.deepEqual(state.subjects_without_numbers, { checked: 0, truncated: false, by_status_model_phone: {}, active_lead_has_phone: 0 });
  assert.equal(state.freshness_inputs.webhook_collection, getRingCentralCollectionName("webhookEvents"));
  assert.equal(state.freshness_inputs.calls.last_webhook_at, null);
  // The OPS-1 acceptance counts: unconfirmed AND started before CC-04 AND the direction class.
  const cc04Counts = calls.filter((c) => c.op === "count" && c.collection === "call_interactions" && JSON.stringify(c.arg ?? {}).includes("started_at"));
  assert.deepEqual(
    cc04Counts.map((c) => c.arg),
    [
      { $or: [{ terminal: { $ne: true } }, { call_log_state: null }], started_at: { $lt: DESK_STATE_CC04_INSTANT }, direction: { $in: ["Inbound", "Outbound"] } },
      { $or: [{ terminal: { $ne: true } }, { call_log_state: null }], started_at: { $lt: DESK_STATE_CC04_INSTANT }, direction: "Internal" },
    ],
  );
  // The newest call webhook is one row, newest first, `receivedAt` only.
  const webhookFind = calls.find((c) => c.op === "find" && c.collection === getRingCentralCollectionName("webhookEvents"));
  assert.deepEqual(webhookFind?.arg, { projection: { _id: 0, receivedAt: 1 }, sort: { receivedAt: -1 }, limit: 1 });
  assert.deepEqual(
    [...new Set(calls.map((c) => c.collection))].sort(),
    [
      "call_interactions",
      "ringcentral_rep_sms_evidence",
      getRingCentralCollectionName("webhookEvents"),
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
  for (const f of syncFinds) {
    const keys = Object.keys((f.arg as { projection: Document }).projection);
    assert.ok(keys.every((k) => !/(^|\.)token$/.test(k)), `token field projected: ${keys.join(",")}`);
  }
});

test("served rep-days: actual_basis per rep as GET /rep-days composes it, roster reps without a row included", () => {
  const value = salesOutreachConfigurationValueSchema.parse(completeConfigurationInput({ goal_metrics_enabled: true }));
  const configuration = { state: "active" as const, version: "v5", revision: 5, content_hash: "h", approval_ref: null, value, updated_at: null, updated_by: null };
  const outsider = new ObjectId("65a0000000000000004494ff");
  const min = (m: number) => new Date(NOW.getTime() + m * 60_000);
  const rows = [
    // Rep A called today: a positive count is served from the projection whatever the coverage.
    { agent_id: new ObjectId(TEST_AGENT_A), business_day: "2026-10-06", count_scope: "all_outbound", actual_confirmed: 12, actual_awaiting_confirmation: 1, unattributed: 3, coverage: null, publication_revision: 4, goal_snapshot: { goal: 100 } },
    // An Agent off the roster with a zero row.
    { agent_id: outsider, business_day: "2026-10-06", count_scope: "all_outbound", actual_confirmed: 0, actual_awaiting_confirmation: 0, unattributed: 0, coverage: null },
    { agent_id: new ObjectId(TEST_AGENT_B), business_day: "2026-10-05", count_scope: "all_outbound", actual_confirmed: 7 },
  ].map(repDayRowOf);
  assert.deepEqual([rows[0]!.agent_id, rows[0]!.publication_revision, rows[0]!.goal_snapshot?.goal, rows[1]!.goal_snapshot], [TEST_AGENT_A, 4, 100, null]);

  // Coverage complete (capture and derivation 1 min behind): the zero-call roster rep reads 0 / no_activity_recorded.
  const covered = { capture_known: min(-1), capture_observed: null, derived_known: min(-1), derived_observed: null, coverage_from: new Date("2026-09-20T00:00:00Z") };
  const complete = composeServedRepDays({ business_day: "2026-10-06", today: "2026-10-06", now: NOW, configuration, rows, marks: covered });
  assert.ok(complete.available);
  assert.equal(complete.capture_coverage.state, "complete");
  assert.deepEqual(
    complete.reps.map((r) => [r.agent, r.on_roster, r.has_row, r.actual_basis, r.actual_confirmed]),
    [
      [agentTail(TEST_AGENT_A), true, true, "projection", 12],
      [agentTail(TEST_AGENT_B), true, false, "no_activity_recorded", 0],
      ["4494ff", false, true, "projection", 0],
    ],
  );
  assert.deepEqual([complete.actual_basis, complete.pending_without_row, complete.goal_metrics_enabled], [{ no_activity_recorded: 1, projection: 2 }, 0, true]);

  // Capture an hour behind: zero counts are not zeros yet; the roster rep without a row is Pending.
  const behind = composeServedRepDays({ business_day: "2026-10-06", today: "2026-10-06", now: NOW, configuration, rows, marks: { ...covered, capture_known: min(-60) } });
  assert.ok(behind.available);
  assert.equal(behind.capture_coverage.state, "partial");
  assert.deepEqual(behind.reps.map((r) => [r.actual_basis, r.actual_confirmed]), [["projection", 12], ["pending", null], ["pending", null]]);
  assert.deepEqual([behind.actual_basis, behind.pending_without_row], [{ pending: 2, projection: 1 }, 1]);

  // olr C0 (D-A3): a stuck provisional row holds the capped watermarks 50 min back while the observed ones are
  // 17–18 min behind; goal coverage (observed − 2 min, today tolerance 25 min) is complete, so the zero reads 0.
  const provisional = { ...covered, capture_known: min(-50), capture_observed: min(-18), derived_known: min(-50), derived_observed: min(-17) };
  const observed = composeServedRepDays({ business_day: "2026-10-06", today: "2026-10-06", now: NOW, configuration, rows, marks: provisional });
  assert.ok(observed.available);
  assert.deepEqual([observed.capture_coverage.state, observed.capture_coverage.required_through, observed.pending_without_row], ["complete", min(-25).toISOString(), 0]);

  // Yesterday is read from yesterday's rows only (end of day required).
  const yesterday = composeServedRepDays({ business_day: "2026-10-05", today: "2026-10-06", now: NOW, configuration, rows, marks: covered });
  assert.ok(yesterday.available);
  assert.deepEqual(yesterday.reps.map((r) => [r.agent, r.has_row, r.actual_basis]), [[agentTail(TEST_AGENT_A), false, "no_activity_recorded"], [agentTail(TEST_AGENT_B), true, "projection"]]);

  assert.deepEqual(
    composeServedRepDays({ business_day: "2026-10-06", today: "2026-10-06", now: NOW, configuration: { state: "uninitialized" }, rows, marks: covered }),
    { business_day: "2026-10-06", available: false, reason: "configuration_not_active" },
  );
  assert.doesNotMatch(JSON.stringify(complete), new RegExp(TEST_AGENT_A));
});

test("calls freshness inputs: confirmation = max(lane success, reconcile sync success); webhook and staffed window reported", () => {
  const min = (m: number) => new Date(NOW.getTime() + m * 60_000); // NOW = 11:00 ET, inside [07:45, 20:30)
  const row = {
    known_complete_through: min(-18),
    observed_complete_through: min(-16),
    last_run: { finished_at: min(-3), sync_token_stored: true, sync_error_code: null, error_code: null },
    isync_lane: { last_success_at: min(-12) },
  };
  const fresh = summarizeCallsFreshnessInputs(row, min(-2), NOW);
  assert.deepEqual(fresh, {
    in_staffed_window: true,
    lane_success_at: min(-12).toISOString(),
    lane_success_lag_min: 12,
    reconcile: { finished_at: min(-3).toISOString(), sync_token_stored: true, sync_error_code: null, success_at: min(-3).toISOString(), success_lag_min: 3 },
    confirmation_at: min(-3).toISOString(),
    confirmation_lag_min: 3,
    last_webhook_at: min(-2).toISOString(),
    webhook_lag_min: 2,
    known_complete_through_lag_min: 18,
    observed_complete_through_lag_min: 16,
    last_error_code: null,
  });

  // A reconcile that stored no token (or hit a sync error) is not a confirmation: the lane instant stands.
  const noToken = summarizeCallsFreshnessInputs({ ...row, last_run: { ...row.last_run, sync_token_stored: false } }, null, NOW);
  assert.deepEqual([noToken.reconcile.success_at, noToken.confirmation_at, noToken.last_webhook_at], [null, min(-12).toISOString(), null]);
  const syncError = summarizeCallsFreshnessInputs({ ...row, last_run: { ...row.last_run, sync_error_code: "token_expired", error_code: "rc_429" } }, null, NOW);
  assert.deepEqual([syncError.reconcile.sync_error_code, syncError.confirmation_at, syncError.last_error_code], ["token_expired", min(-12).toISOString(), "rc_429"]);
  // Night (01:00 ET): outside the staffed window; with no lane success the reconcile alone confirms.
  const night = summarizeCallsFreshnessInputs({ ...row, isync_lane: { last_success_at: null } }, null, new Date("2026-10-06T05:00:00Z"));
  assert.equal(night.in_staffed_window, false);
  assert.equal(night.confirmation_at, min(-3).toISOString());
  assert.deepEqual(summarizeCallsFreshnessInputs(null, null, NOW).confirmation_at, null);
});

test("subjects without numbers: counted by status, Lead model and whether the Lead has a phone; no phone or id leaves", () => {
  const ids = Array.from({ length: 5 }, (_, i) => new ObjectId(`65a00000000000000000000${i}`));
  const subjects = [
    { status: "active", lead_model: "CallLead", lead_id: ids[0] },
    { status: "active", lead_model: "CallLead", lead_id: ids[1] },
    { status: "active", lead_model: "FormLead", lead_id: ids[2] },
    { status: "review", lead_model: "FormLead", lead_id: ids[3] },
    { status: "active", lead_model: "CallLead", lead_id: ids[4] },
  ];
  const leads = {
    CallLead: [
      { _id: ids[0], normalized_phone_number: "3055550199" },
      // Only the RingCentral original caller path carries the phone: still a phone.
      { _id: ids[1], normalized_phone_number: "", ringcentral: { original_caller: { normalized_phone_number: "+13055550123" } } },
    ],
    FormLead: [
      { _id: ids[2], normalized_phone_number: "12" },
      { _id: ids[3], granot_contact_snapshot: { normalized_phone_number: "7865550100" } },
    ],
  };
  const summary = summarizeSubjectsWithoutNumbers(subjects, leads, false);
  assert.deepEqual(summary, {
    checked: 5,
    truncated: false,
    by_status_model_phone: { "active/CallLead/has_phone": 2, "active/CallLead/lead_missing": 1, "active/FormLead/no_phone": 1, "review/FormLead/has_phone": 1 },
    active_lead_has_phone: 2,
  });
  assert.doesNotMatch(JSON.stringify(summary), /555|65a0/);
});
