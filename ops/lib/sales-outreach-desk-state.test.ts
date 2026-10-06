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
import { leadNumberE164s, leadPhonesOf } from "../../src/services/numberActivity/leadContactNumber";
import { getRingCentralCollectionName } from "../../src/services/ringcentral/ringcentral-config";
import { configurationContentHash } from "../../src/services/salesOutreach/config/store";
import { deskTimingOf } from "../../src/services/salesOutreach/config/timing";
import { completeConfigurationInput, TEST_AGENT_A, TEST_AGENT_B } from "../../src/services/salesOutreach/evaluation/testing";
import { mongoOverdueFilter } from "../../src/services/salesOutreach/reads/deskStore";
import { salesOutreachConfigurationValueSchema } from "../../src/validation/v1/salesOutreach";
import {
  agentTail,
  collectDeskState,
  collectDeskStateWithSnapshot,
  compareClosedPublication,
  composeServedRepDays,
  countsOf,
  DESK_STATE_CC04_INSTANT,
  DESK_STATE_SCOPES,
  designOverdueFilter,
  EXTERNAL_CALL_DIRECTIONS,
  findBySubjectPages,
  installReadOnlyCommandGuard,
  lagMinutes,
  LEAD_COLLECTIONS,
  leadPhoneStateOf,
  nestedCountsOf,
  otherOutboundByDayOf,
  parseClosedPublicationSnapshot,
  parseDeskStateArgs,
  READ_GUARD_EXIT_CODE,
  readOnlyDeskStateReader,
  repDayOtherOutboundOf,
  repDayRowOf,
  rowsReadingOverdue,
  summarizeCallsFreshnessInputs,
  summarizeConfiguration,
  summarizeRepDays,
  summarizeRepSmsMailboxes,
  summarizeSubjectsWithoutNumbers,
  summarizeWatermark,
  tallyChannelVerification,
  type DeskStateReader,
} from "./sales-outreach-desk-state";
import { CC04_INSTANT, SETTLE_DIRECTIONS } from "./sales-outreach-settle-pre-cc04";

const NOW = new Date("2026-10-06T15:00:00.000Z");

test("desk-state CLI: a named target is required; --pretty indents; there is no write mode", () => {
  assert.deepEqual(parseDeskStateArgs(["--target=vantagemovers"]), { target: "vantagemovers", pretty: false, out: null, compare: null });
  assert.deepEqual(parseDeskStateArgs(["--pretty", "--target=testvantagemovers_x1"]), { target: "testvantagemovers_x1", pretty: true, out: null, compare: null });
  // OPS-0c: the closed-row snapshot goes to / is compared with local files only.
  assert.deepEqual(parseDeskStateArgs(["--target=vantagemovers", "--out=closed-2355.json", "--compare=closed-2350.json"]), {
    target: "vantagemovers",
    pretty: false,
    out: "closed-2355.json",
    compare: "closed-2350.json",
  });
  assert.throws(() => parseDeskStateArgs(["--target=vantagemovers", "--out="]), /--out/);
  assert.throws(() => parseDeskStateArgs(["--target=vantagemovers", "--compare="]), /--compare/);
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
  assert.equal(state.summary_version, 3);
  // OPS-0c on an empty database without a configuration: no coverage, so no served overdue count and no proven waits.
  assert.deepEqual(state.wave2_acceptance.cadence_coverage, { available: false, call_through: null, sms_through: null, sms_capture_enabled: false });
  assert.deepEqual(state.wave2_acceptance.distinct_overdue_leads, { available: false, unknown_reason: "coverage_incomplete" });
  assert.deepEqual(state.wave2_acceptance.coverage_wait.call, { through: null, waiting: 0, proven: null, proven_and_pending: null, oldest_proven_wait: null, closed_waiting: 0 });
  assert.deepEqual(state.wave2_acceptance.closed_publication, { rows: 0, truncated: false, revision_sum: 0, rewritten_since_ny_midnight: 0, comparison: null });
  assert.equal(state.freshness_inputs.calls.served, null);
  assert.deepEqual([state.projections.next_evaluation.closed_scheduled, state.projections.next_evaluation.by_utc_hour_closed], [0, {}]);
  assert.deepEqual([state.contact_events.other_outbound_by_day, state.rep_days.other_outbound_by_day], [{}, {}]);
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
  // The watermark find never projects a token field; it projects the sticky reconcile success and the sync mode.
  const syncFinds = calls.filter((c) => c.op === "find" && c.collection === "sales_intelligence_sync_state");
  assert.equal(syncFinds.length, 2);
  for (const f of syncFinds) {
    const keys = Object.keys((f.arg as { projection: Document }).projection);
    assert.ok(keys.every((k) => !/(^|\.)token$/.test(k)), `token field projected: ${keys.join(",")}`);
  }
  assert.ok(["reconcile_sync_success_at", "last_run.sync_mode"].every((k) => k in (syncFinds[0]!.arg as { projection: Document }).projection));
  // Projection finds read channel fields and revisions only: no display (customer) field.
  for (const f of calls.filter((c) => c.op === "find" && c.collection === "sales_outreach_projections"))
    assert.doesNotMatch(JSON.stringify((f.arg as { projection: Document }).projection), /display|window_history|detail/);
});

test("wave 2 acceptance through the collector: served overdue rule, design count, sweep-predicate waits, closed snapshot and its comparison", async () => {
  const min = (m: number) => new Date(NOW.getTime() + m * 60_000);
  const value = salesOutreachConfigurationValueSchema.parse(completeConfigurationInput({ cadence_enforcement_enabled: true, goal_metrics_enabled: true }));
  const hash = configurationContentHash(value);
  const closedIds = [new ObjectId("65a0000000000000000000c1"), new ObjectId("65a0000000000000000000c2")];
  const counts: Array<{ filter: Document; n: number }> = [];
  const reader: DeskStateReader = {
    async count(collection, filter = {}) {
      const n = collection === "sales_outreach_projections" ? 7 : 0;
      if (collection === "sales_outreach_projections") counts.push({ filter, n });
      return n;
    },
    async aggregate() {
      return [];
    },
    async findOne(collection, filter) {
      if (collection !== "sales_outreach_configuration") return null;
      if (filter.kind === "pointer") return { kind: "pointer", key: "active", version: "v5", revision: 5, content_hash: hash };
      return { kind: "version", key: "version:v5", version: "v5", value, content_hash: hash };
    },
    async find(collection, filter, options) {
      if (collection === "sales_intelligence_sync_state" && options.limit === 20)
        return [
          { scope: DESK_STATE_SCOPES.call_log, known_complete_through: min(-20), observed_complete_through: min(-18) },
          { scope: DESK_STATE_SCOPES.contact_calls, known_complete_through: min(-21), cursor: { outreach_coverage_from: min(-10_000) } },
        ];
      if (collection === "sales_outreach_projections" && JSON.stringify(filter).includes('"closed"') && "publication_revision" in options.projection)
        return filter.$and ? [] : closedIds.map((id, i) => ({ subject_id: id, publication_revision: 4 + i }));
      if (collection === "sales_outreach_projections" && "call.status" in options.projection)
        return [{ subject_id: new ObjectId(), exposure: "enforcement", call: { status: "due", due_at: min(-15) }, sms: { status: "not_required" } }];
      return [];
    },
  };
  const previous = parseClosedPublicationSnapshot({
    tool: "sales-outreach-desk-state/closed-publication",
    version: 1,
    database: "testvantagemovers_unit",
    as_of: min(-30).toISOString(),
    truncated: false,
    rows: { [closedIds[0]!.toHexString()]: 4, [closedIds[1]!.toHexString()]: 4 },
  });
  const { state, closed_snapshot } = await collectDeskStateWithSnapshot(reader, { database: "testvantagemovers_unit", now: NOW, previous_closed_snapshot: previous });
  const w = state.wave2_acceptance;
  // Cadence call coverage = min(capped capture − 2 min allowance, derivation) = min(−22, −21) = −22.
  const through = min(-22);
  assert.deepEqual(w.cadence_coverage, { available: true, call_through: through.toISOString(), sms_through: null, sms_capture_enabled: false });
  // The 15-min-old deadline is past coverage (−22): due — not yet verified.
  assert.deepEqual([w.call.due_passed, w.call.read_overdue, w.call.read_due_unverified], [1, 0, 1]);
  const served = mongoOverdueFilter({ call: through, sms: null });
  const design = designOverdueFilter({ call: through, sms: null });
  assert.ok(counts.some((c) => JSON.stringify(c.filter) === JSON.stringify(served)), "the served team overdue rule is counted");
  assert.ok(counts.some((c) => JSON.stringify(c.filter) === JSON.stringify(design)), "the design count is counted");
  assert.deepEqual(w.distinct_overdue_leads, { available: true, cutoffs: { call: through.toISOString(), sms: null }, served_rule: 7, design_count: 7, active_without_sms_due: 7 });
  // The proven waits use the sweep's own predicate (≤ current coverage); SMS has no coverage, so nothing is proven there.
  assert.ok(counts.some((c) => JSON.stringify(c.filter) === JSON.stringify({ "coverage_wait.call": { $ne: null, $lte: through } })));
  assert.deepEqual([w.coverage_wait.call.through, w.coverage_wait.call.proven, w.coverage_wait.sms.proven], [through.toISOString(), 7, null]);
  // Closed rows: the snapshot carries every id with its revision; the comparison reads one row increased.
  assert.deepEqual(closed_snapshot.rows, { [closedIds[0]!.toHexString()]: 4, [closedIds[1]!.toHexString()]: 5 });
  assert.deepEqual([closed_snapshot.database, closed_snapshot.as_of, closed_snapshot.tool], ["testvantagemovers_unit", NOW.toISOString(), "sales-outreach-desk-state/closed-publication"]);
  assert.deepEqual([w.closed_publication.rows, w.closed_publication.revision_sum, w.closed_publication.comparison?.increased, w.closed_publication.comparison?.increased_subjects], [2, 9, 1, ["0000c2"]]);
  assert.doesNotMatch(JSON.stringify(state), /65a0000000000000000000c/);
  // The served freshness is composed under the active configuration.
  assert.notEqual(state.freshness_inputs.calls.served, null);
  // A snapshot of another database is refused.
  await assert.rejects(collectDeskState(reader, { database: "vantagemovers", now: NOW, previous_closed_snapshot: previous }), /testvantagemovers_unit/);
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
      // olr CW1: a row that records no outbound call reads like no row: a recorded 0, not a projection.
      ["4494ff", false, true, "no_activity_recorded", 0],
    ],
  );
  assert.deepEqual([complete.actual_basis, complete.pending_without_row, complete.goal_metrics_enabled], [{ no_activity_recorded: 2, projection: 1 }, 0, true]);

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

test("calls freshness inputs: the read's confirmation rule (sticky reconcile success, last-run fallback in mode on) and the served state", () => {
  const min = (m: number) => new Date(NOW.getTime() + m * 60_000); // NOW = 11:00 ET, inside [07:45, 20:30)
  const timing = deskTimingOf(null); // code defaults: freshness 10, coverage 25 + 2, webhook silence 30 min
  // A3-cap row: the sticky reconcile success (3 min ago) stands although the last run was a shadow run.
  const row = {
    known_complete_through: min(-18),
    observed_complete_through: min(-16),
    reconcile_sync_success_at: min(-3),
    last_run: { finished_at: min(-1), sync_mode: "shadow", sync_token_stored: true, sync_error_code: null as string | null, error_code: null as string | null },
    isync_lane: { last_success_at: min(-12) as Date | null },
  };
  const fresh = summarizeCallsFreshnessInputs(row, min(-2), NOW, timing);
  assert.deepEqual(fresh, {
    in_staffed_window: true,
    lane_success_at: min(-12).toISOString(),
    lane_success_lag_min: 12,
    reconcile: {
      finished_at: min(-1).toISOString(),
      sync_mode: "shadow",
      sync_token_stored: true,
      sync_error_code: null,
      sticky_success_at: min(-3).toISOString(),
      success_at: min(-3).toISOString(),
      success_lag_min: 3,
    },
    confirmation_at: min(-3).toISOString(),
    confirmation_lag_min: 3,
    last_webhook_at: min(-2).toISOString(),
    webhook_lag_min: 2,
    known_complete_through_lag_min: 18,
    observed_complete_through_lag_min: 16,
    last_error_code: null,
    served: { state: "fresh", reason: null, last_updated_at: min(-3).toISOString(), age_seconds: 180 },
  });

  // A row reconciled before the sticky field existed: the last run counts only in sync mode `on` with a stored token.
  const legacy = { ...row, reconcile_sync_success_at: undefined, last_run: { ...row.last_run, finished_at: min(-3), sync_mode: "on" } };
  const fallback = summarizeCallsFreshnessInputs(legacy, null, NOW);
  assert.deepEqual([fallback.reconcile.success_at, fallback.confirmation_at], [min(-3).toISOString(), min(-3).toISOString()]);
  // Shadow, no token or a sync error: not a confirmation; the lane's 12 min stands and the served state is delayed.
  const failing: Array<Record<string, unknown>> = [
    { sync_mode: "shadow" },
    { sync_mode: "on", sync_token_stored: false },
    { sync_mode: "on", sync_error_code: "token_expired", error_code: "rc_429" },
  ];
  for (const run of failing) {
    const out = summarizeCallsFreshnessInputs({ ...legacy, last_run: { ...legacy.last_run, ...run } }, min(-2), NOW, timing);
    assert.deepEqual([out.reconcile.success_at, out.confirmation_at, out.served?.state], [null, min(-12).toISOString(), "delayed"]);
    assert.equal(out.served?.reason, run.error_code ?? "confirmation_stale");
  }
  // The sticky success survives a later failing run (it is the read's own rule, so the served state agrees).
  const sticky = summarizeCallsFreshnessInputs(
    { ...row, reconcile_sync_success_at: min(-4), last_run: { ...row.last_run, sync_mode: "on", sync_error_code: "token_expired" } },
    min(-2),
    NOW,
    timing,
  );
  assert.deepEqual([sticky.reconcile.success_at, sticky.confirmation_at, sticky.served?.state], [min(-4).toISOString(), min(-4).toISOString(), "fresh"]);
  // Coverage behind (both watermarks 40 min back) reads delayed coverage_behind even with a fresh confirmation.
  const behind = summarizeCallsFreshnessInputs({ ...row, known_complete_through: min(-40), observed_complete_through: min(-40) }, min(-2), NOW, timing);
  assert.deepEqual([behind.served?.state, behind.served?.reason], ["delayed", "coverage_behind"]);
  // Night (01:00 ET): outside the staffed window; with no lane success the reconcile alone confirms.
  const night = summarizeCallsFreshnessInputs({ ...row, isync_lane: { last_success_at: null } }, null, new Date("2026-10-06T05:00:00Z"));
  assert.deepEqual([night.in_staffed_window, night.confirmation_at, night.served], [false, min(-3).toISOString(), null]);
  const none = summarizeCallsFreshnessInputs(null, null, NOW, timing);
  assert.deepEqual([none.confirmation_at, none.served?.state], [null, "unknown"]);
});

test("subjects without numbers: counted by status, Lead model and the mint's phone rule (CW1); no phone or id leaves", () => {
  const ids = Array.from({ length: 7 }, (_, i) => new ObjectId(`65a00000000000000000000${i}`));
  const subjects = [
    { status: "active", lead_model: "CallLead", lead_id: ids[0] },
    { status: "active", lead_model: "CallLead", lead_id: ids[1] },
    { status: "active", lead_model: "FormLead", lead_id: ids[2] },
    { status: "review", lead_model: "FormLead", lead_id: ids[3] },
    { status: "active", lead_model: "CallLead", lead_id: ids[4] },
    { status: "active", lead_model: "FormLead", lead_id: ids[5] },
    { status: "active", lead_model: "FormLead", lead_id: ids[6] },
  ];
  const callLeads: Document[] = [
    { _id: ids[0], normalized_phone_number: "3055550199" },
    // Only the RingCentral original caller path carries the phone: still a phone.
    { _id: ids[1], normalized_phone_number: "", ringcentral: { original_caller: { normalized_phone_number: "+13055550123" } } },
  ];
  const formLeads: Document[] = [
    { _id: ids[2], normalized_phone_number: "12" },
    // Only the Granot snapshot carries the phone: the mint numbers it (CW1), so it counts.
    { _id: ids[3], granot_contact_snapshot: { normalized_phone_number: "7865550100" } },
    // A Duplicate and a Bad Lead with a phone: the mint skips them, so they are not the wave-1 number.
    { _id: ids[5], normalized_phone_number: "3055550111", duplicate: true },
    { _id: ids[6], ingested_contact_snapshot: { normalized_phone_number: "3055550112" }, bad_lead: "spam" },
  ];
  const summary = summarizeSubjectsWithoutNumbers(subjects, { CallLead: callLeads, FormLead: formLeads }, false);
  assert.deepEqual(summary, {
    checked: 7,
    truncated: false,
    by_status_model_phone: {
      "active/CallLead/has_phone": 2,
      "active/CallLead/lead_missing": 1,
      "active/FormLead/no_phone": 1,
      "active/FormLead/not_candidate": 2,
      "review/FormLead/has_phone": 1,
    },
    active_lead_has_phone: 2,
  });
  assert.doesNotMatch(JSON.stringify(summary), /555|65a0/);
  // The state is exactly the mint's decision (`leadNumberE164s` over `leadPhonesOf`).
  const all: Array<readonly ["CallLead" | "FormLead", Document]> = [...callLeads.map((l) => ["CallLead", l] as const), ...formLeads.map((l) => ["FormLead", l] as const)];
  for (const [model, lead] of all) {
    const decision = leadNumberE164s(model, { ...leadPhonesOf(lead as never), duplicate: lead.duplicate ?? null, bad_lead: lead.bad_lead ?? null });
    assert.equal(leadPhoneStateOf(model, lead) === "has_phone", "e164s" in decision);
  }
});

test("wave 2 verification: each channel read with the read's own rule at as_of and the channel's cadence coverage", () => {
  const min = (m: number) => new Date(NOW.getTime() + m * 60_000);
  const rows: Document[] = [
    // Stored overdue (the engine proved it): read overdue, verified.
    { subject_id: new ObjectId(), exposure: "enforcement", call: { status: "overdue", due_at: min(-60) }, sms: { status: "not_required" } },
    // Due 20 min ago, coverage 25 min back: due — not yet verified since the deadline.
    { subject_id: new ObjectId(), exposure: "enforcement", call: { status: "due", due_at: min(-20) }, sms: { status: "due", due_at: min(-30) } },
    // Due 40 min ago, coverage past it: read overdue although stored due.
    { subject_id: new ObjectId(), exposure: "enforcement", call: { status: "due", due_at: min(-40), oldest_actionable_due_at: min(-50) }, sms: { status: "scheduled", due_at: min(60) } },
    // Due later today: unchanged, no verification.
    { subject_id: new ObjectId(), exposure: "shadow", call: { status: "due", due_at: min(30) }, sms: { status: "pending" } },
  ];
  const coverage = { call: min(-25), sms: null };
  assert.deepEqual(tallyChannelVerification(rows, "call", NOW, coverage.call), {
    coverage_through: min(-25).toISOString(),
    stored_status: { due: 3, overdue: 1 },
    stored_overdue: 1,
    due_passed: 2,
    read_overdue: 2,
    read_due_unverified: 1,
    oldest_unverified_since: min(-20).toISOString(),
  });
  // SMS without capture coverage: every passed deadline stays unverified, none reads overdue.
  const sms = tallyChannelVerification(rows, "sms", NOW, coverage.sms);
  assert.deepEqual(
    [sms.coverage_through, sms.stored_overdue, sms.due_passed, sms.read_overdue, sms.read_due_unverified, sms.oldest_unverified_since],
    [null, 0, 1, 0, 1, min(-30).toISOString()],
  );
  assert.equal(rowsReadingOverdue(rows, NOW, coverage), 2);
  // Coverage catches up to as_of: the unverified call deadline is proven and reads overdue.
  const caughtUp = tallyChannelVerification(rows, "call", NOW, NOW);
  assert.deepEqual([caughtUp.read_overdue, caughtUp.read_due_unverified, caughtUp.oldest_unverified_since], [3, 0, null]);
});

test("wave 2 overdue: the design count compares each channel's due key with min(as_of, coverage) and has no pre-A2 fallback", () => {
  const call = new Date("2026-10-06T14:35:00Z");
  const sms = new Date("2026-10-06T14:40:00Z");
  assert.deepEqual(designOverdueFilter({ call, sms }), {
    subject_status: "active",
    $or: [{ "queue_keys.call_due": { $lte: call } }, { "queue_keys.sms_due": { $lte: sms } }],
  });
  assert.deepEqual(designOverdueFilter({ call, sms: null }), { subject_status: "active", $or: [{ "queue_keys.call_due": { $lte: call } }] });
});

test("closed publication snapshot: validated on read, compared row by row, ids listed as tails only", () => {
  const [a, b, c, d] = ["65a0000000000000000000a1", "65a0000000000000000000a2", "65a0000000000000000000a3", "65a0000000000000000000a4"] as const;
  const tool = "sales-outreach-desk-state/closed-publication";
  const previous = parseClosedPublicationSnapshot({ tool, version: 1, database: "vantagemovers", as_of: "2026-10-07T03:55:00.000Z", truncated: false, rows: { [a]: 3, [b]: 5, [c]: 2 } });
  assert.deepEqual(compareClosedPublication(previous, { [a]: 3, [b]: 7, [d]: 1 }), {
    previous_as_of: "2026-10-07T03:55:00.000Z",
    compared: 2,
    unchanged: 1,
    increased: 1,
    decreased: 0,
    newly_closed: 1,
    missing: 1,
    max_increase: 2,
    increased_subjects: ["0000a2"],
  });
  // A quiet midnight: the same map compares unchanged.
  const quiet = compareClosedPublication(previous, previous.rows);
  assert.deepEqual([quiet.compared, quiet.unchanged, quiet.increased, quiet.missing, quiet.newly_closed], [3, 3, 0, 0, 0]);
  const at = "2026-10-07T03:55:00Z";
  const invalid: unknown[] = [
    null,
    { tool: "other", version: 1 },
    { tool, version: 2, database: "vantagemovers", as_of: at, rows: {} },
    { tool, version: 1, database: "prod db", as_of: at, rows: {} },
    { tool, version: 1, database: "vantagemovers", as_of: "never", rows: {} },
    { tool, version: 1, database: "vantagemovers", as_of: at, rows: { "not-an-id": 1 } },
    { tool, version: 1, database: "vantagemovers", as_of: at, rows: { [a]: "3" } },
  ];
  for (const bad of invalid) assert.throws(() => parseClosedPublicationSnapshot(bad), /--compare/);
});

test("C8 per day: other outbound buckets from grouped events and stored rep-day breakdowns against unattributed", () => {
  const events = otherOutboundByDayOf([
    { _id: { day: "2026-10-05", reason: "lead_not_enrolled" }, n: 137 },
    { _id: { day: "2026-10-05", reason: "before_activation" }, n: 80 },
    { _id: { day: "2026-10-05", reason: "no_lead" }, n: 28 },
    { _id: { day: "2026-10-05", reason: "lead_closed" }, n: 2 },
    { _id: { day: "2026-10-05", reason: "not_new_quoted" }, n: 1 },
    // Derived before C8 (no reason) and a stray `eligible` both read `unknown`, as the rep-day counts them.
    { _id: { day: "2026-10-06", reason: null }, n: 4 },
    { _id: { day: "2026-10-06", reason: "eligible" }, n: 1 },
  ]);
  assert.deepEqual(Object.keys(events), ["2026-10-06", "2026-10-05"]);
  assert.deepEqual(events["2026-10-05"], { no_lead: 28, lead_not_enrolled: 137, lead_closed: 2, before_activation: 80, ambiguous: 0, not_new_quoted: 1, unknown: 0, total: 248 });
  assert.deepEqual([events["2026-10-06"]!.unknown, events["2026-10-06"]!.total], [5, 5]);

  const stored = repDayOtherOutboundOf([
    { _id: "2026-10-05", rows: 3, rows_with_breakdown: 3, unattributed: 248, no_lead: 28, lead_not_enrolled: 137, lead_closed: 2, before_activation: 80, ambiguous: 0, not_new_quoted: 1, unknown: 0 },
    { _id: "2026-10-06", rows: 3, rows_with_breakdown: 1, unattributed: 20, unknown: 5 },
  ]);
  assert.deepEqual(Object.keys(stored), ["2026-10-06", "2026-10-05"]);
  assert.deepEqual(stored["2026-10-05"], {
    rows: 3,
    rows_with_breakdown: 3,
    unattributed: 248,
    breakdown: { no_lead: 28, lead_not_enrolled: 137, lead_closed: 2, before_activation: 80, ambiguous: 0, not_new_quoted: 1, unknown: 0 },
    breakdown_total: 248,
  });
  // Rows written before C8 carry no breakdown: the day's breakdown total trails its unattributed until the recount.
  assert.deepEqual([stored["2026-10-06"]!.rows_with_breakdown, stored["2026-10-06"]!.breakdown_total, stored["2026-10-06"]!.unattributed], [1, 5, 20]);
});

test("paged projection reads walk subject_id keysets up to the cap", async () => {
  const all = Array.from({ length: 2_350 }, (_, i) => ({ subject_id: new ObjectId(i.toString(16).padStart(24, "0")) }));
  const seen: Array<{ filter: Document; limit: number; sort: unknown }> = [];
  const reader = {
    async find(_collection: string, filter: Document, options: { limit: number; sort?: Document }) {
      seen.push({ filter, limit: options.limit, sort: options.sort });
      const after = (filter.$and?.[1]?.subject_id?.$gt ?? null) as ObjectId | null;
      return all.filter((r) => !after || r.subject_id.toHexString() > after.toHexString()).slice(0, options.limit);
    },
  } as unknown as DeskStateReader;
  const full = await findBySubjectPages(reader, "sales_outreach_projections", { subject_status: "closed" }, { _id: 0 });
  assert.deepEqual([full.rows.length, full.truncated, seen.map((s) => s.limit)], [2_350, false, [1_000, 1_000, 1_000]]);
  assert.deepEqual([seen[0]!.filter, seen[0]!.sort], [{ subject_status: "closed" }, { subject_id: 1 }]);
  assert.deepEqual(seen[1]!.filter, { $and: [{ subject_status: "closed" }, { subject_id: { $gt: all[999]!.subject_id } }] });
  assert.equal(new Set(full.rows.map((r) => r.subject_id.toHexString())).size, 2_350);
  seen.length = 0;
  const capped = await findBySubjectPages(reader, "sales_outreach_projections", {}, { _id: 0 }, 1_500);
  assert.deepEqual([capped.rows.length, capped.truncated, seen.map((s) => s.limit)], [1_500, true, [1_000, 500]]);
});
