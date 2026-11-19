import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { ObjectId, type Document } from "mongodb";
import { configurationContentHash } from "../../src/services/salesOutreach/config/store";
import { completeConfigurationInput, TEST_AGENT_A, TEST_AGENT_B } from "../../src/services/salesOutreach/evaluation/testing";
import { mongoOverdueFilter } from "../../src/services/salesOutreach/reads/deskStore";
import { salesOutreachConfigurationValueSchema } from "../../src/validation/v1/salesOutreach";
import {
  agentTail,
  collectDeskState,
  collectDeskStateWithSnapshot,
  compareClosedPublication,
  composeServedRepDays,
  DESK_STATE_SCOPES,
  designOverdueFilter,
  installReadOnlyCommandGuard,
  parseClosedPublicationSnapshot,
  READ_GUARD_EXIT_CODE,
  readOnlyDeskStateReader,
  repDayRowOf,
  type DeskStateReader,
} from "./sales-outreach-desk-state";

const NOW = new Date("2026-10-06T15:00:00.000Z");

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
