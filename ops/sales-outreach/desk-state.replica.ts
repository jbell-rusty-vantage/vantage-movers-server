/**
 * OPS-0 replica proof for `ops/sales-outreach/desk-state.ts` (local csi01 loopback replica only;
 * synthetic rows in a unique `testvantagemovers_*` database that is dropped afterwards). Never loads
 * production env. Run: `pnpm test:outreach:desk-state:replica`.
 *
 * Proves, by running the real CLI as a child process against seeded rows:
 * - every PRODUCTION-STATE section is computed with the expected numbers (configuration revision,
 *   state and both hash paths; subjects; periods; projections by status; the `next_evaluation_at`
 *   histogram; open/dead-letter/recently completed jobs; watermarks and the ISync lane; rep SMS
 *   mailbox lag; rep-day rows for NY today/yesterday with count scope and coverage; contact events by
 *   association; unconfirmed `call_interactions` by day and direction with the OPS-1 split before
 *   CC-04; enrollment runs) and the OPS-0b reads (served `actual_basis` per rep with roster reps
 *   without a row; calls freshness inputs with the newest call webhook; open subjects without a
 *   number by whether their Lead has a phone);
 * - stdout is exactly one JSON document and carries no token, display name, phone or Lead selection;
 * - a `--target` that is not the resolved database is refused before connecting;
 * - the database is byte-identical afterwards (every document, every index, the collection list);
 * - the driver guard exits 97 before an insert is sent (the probe's row never lands).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { type Db, MongoClient, ObjectId } from "mongodb";
import { CSI_ENQUEUE_LOCAL_REPLICA_URI } from "../lib/csi-enqueue-replica-target";
import { isLoopbackMongoUri } from "../lib/loopback-mongo";
import { installReadOnlyCommandGuard, READ_GUARD_EXIT_CODE } from "../lib/sales-outreach-desk-state";
import { canonicalJson } from "../../src/services/durableWork/checksum";
import { configurationContentHash } from "../../src/services/salesOutreach/config/store";
import { completeConfigurationInput } from "../../src/services/salesOutreach/evaluation/testing";
import { addDays } from "../../src/services/salesOutreach/engine/calendar";
import { newYorkBusinessDay } from "../../src/services/salesOutreach/reads/businessDay";
import { salesOutreachConfigurationValueSchema } from "../../src/validation/v1/salesOutreach";

const SERVER_ROOT = path.resolve(__dirname, "../..");
const CLI = "ops/sales-outreach/desk-state.ts";
const SECRET_MARKERS = ["SYNTHETIC-PROVIDER-TOKEN", "Zed Synthetic", "3055550199", "lead-ref-should-not-print"];

function childEnv(database: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env))
    if (!/RINGCENTRAL|^RC_|BLOB|GATEWAY|OPENAI|ANTHROPIC|VERCEL|KV_REST|REDIS|UPSTASH|QSTASH|GOOGLE|MONGO|DOTENV|^TEST_/i.test(key)) env[key] = value;
  // RINGCENTRAL_COLLECTION_MODE is pinned to "test" so a local `.env` loaded by the child cannot switch
  // it to the production collection names: the seeded webhook events are the test-suffixed ones.
  return { ...env, MONGO_URI: CSI_ENQUEUE_LOCAL_REPLICA_URI, TEST_MODE: "true", TEST_MONGO_DATABASE_NAME: database, RINGCENTRAL_COLLECTION_MODE: "test" };
}

const runCli = (database: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}) =>
  spawnSync(process.execPath, ["--import", "tsx", CLI, ...args], {
    cwd: SERVER_ROOT,
    env: { ...childEnv(database), ...extraEnv },
    encoding: "utf8",
    timeout: 120_000,
  });

/** Every document, index and collection of the database, hashed: equal before and after ⇒ nothing was written. */
async function fingerprint(db: Db): Promise<string> {
  const hash = createHash("sha256");
  const collections = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).sort();
  for (const name of collections) {
    hash.update(`#${name}\n`);
    for (const index of await db.collection(name).indexes()) hash.update(canonicalJson(index)).update("\n");
    for await (const doc of db.collection(name).find({}, { sort: { _id: 1 } })) hash.update(canonicalJson(JSON.parse(JSON.stringify(doc)))).update("\n");
  }
  return hash.digest("hex");
}

async function seed(db: Db, now: Date) {
  const min = (m: number) => new Date(now.getTime() + m * 60_000);
  const today = newYorkBusinessDay(now);
  const yesterday = addDays(today, -1);
  const agentA = new ObjectId("65a0000000000000003221ab");
  const agentB = new ObjectId("65a00000000000000032227e");

  // Configuration: revision 5, the stored value is the parsed value and both hash paths agree.
  const value = salesOutreachConfigurationValueSchema.parse(completeConfigurationInput({ cadence_enforcement_enabled: true, goal_metrics_enabled: true }));
  const hash = configurationContentHash(value);
  await db.collection("sales_outreach_configuration").insertMany([
    { kind: "version", key: "version:v-r4", version: "v-r4", schema_version: 1, value, content_hash: hash, approval_ref: "synthetic", created_by: { kind: "operator", id: "replica" } },
    { kind: "version", key: "version:v-r5", version: "v-r5", schema_version: 1, value, content_hash: hash, approval_ref: "synthetic-r5", created_by: { kind: "operator", id: "replica" } },
    { kind: "pointer", key: "active", version: "v-r5", value: null, content_hash: hash, revision: 5, updated_by: "replica", updatedAt: min(-60) },
  ]);

  const subjects = [new ObjectId(), new ObjectId(), new ObjectId(), new ObjectId()];
  // The Lead of the numberless subject has a phone (C2 acceptance: counted, never printed).
  const callLeadId = new ObjectId();
  await db.collection("call_leads").insertOne({ _id: callLeadId, name: "Zed Synthetic", phone_number: "(305) 555-0199", normalized_phone_number: "3055550199" });
  await db.collection("sales_outreach_subjects").insertMany([
    { _id: subjects[0], status: "active", assigned_agent_id: agentA, contact_number_ids: [new ObjectId()], enrollment: { kind: "expansion" }, priority: { raw: "1" }, review_reasons: [], display: { name: "Zed Synthetic", normalized_phone: "3055550199" } },
    { _id: subjects[1], status: "active", assigned_agent_id: null, contact_number_ids: [new ObjectId()], enrollment: { kind: "expansion" }, priority: { raw: null }, review_reasons: [] },
    { _id: subjects[2], status: "active", assigned_agent_id: agentB, contact_number_ids: [], enrollment: { kind: "intake" }, priority: { raw: "1" }, review_reasons: [], lead_model: "CallLead", lead_id: callLeadId },
    { _id: subjects[3], status: "closed", assigned_agent_id: agentB, contact_number_ids: [new ObjectId()], enrollment: { kind: "expansion" }, priority: { raw: "5" }, review_reasons: ["priority_closed"] },
  ]);
  await db.collection("sales_outreach_policy_periods").insertMany([
    { subject_id: subjects[0], workflow: "quoted", start_kind: "activation", ended_at: null },
    { subject_id: subjects[1], workflow: "new", start_kind: "activation", ended_at: null },
    { subject_id: subjects[3], workflow: "closed", start_kind: "transition", ended_at: min(-500) },
  ]);
  const projection = (i: number, extra: Record<string, unknown>) => ({
    subject_id: subjects[i],
    exposure: "enforcement",
    engine_version: "sod-engine-v1",
    configuration_version: "v-r5",
    computed_as_of: min(-10 - i),
    queue_keys: { urgency_due: min(24 * 60) },
    status_flags: { needs_contact: false, overdue: false, pending: false, blocked: false, job_pending: false, move_date_passed: false, move_date_unknown: false, advisory_cooldown: false },
    display: { name: "Zed Synthetic", phone: "(305) 555-0199" },
    ...extra,
  });
  const flags = (on: string[]) => Object.fromEntries(["needs_contact", "overdue", "pending", "blocked", "job_pending", "move_date_passed", "move_date_unknown", "advisory_cooldown"].map((f) => [f, on.includes(f)]));
  await db.collection("sales_outreach_projections").insertMany([
    projection(0, { subject_status: "active", workflow: "quoted", assigned_agent_id: agentA, call: { status: "due" }, sms: { status: "not_required" }, status_flags: flags(["needs_contact", "overdue"]), queue_keys: { urgency_due: min(-30) }, next_evaluation_at: min(-5) }),
    projection(1, { subject_status: "active", workflow: "new", assigned_agent_id: null, call: { status: "due" }, sms: { status: "due" }, status_flags: flags(["needs_contact"]), next_evaluation_at: min(120) }),
    projection(2, { subject_status: "active", workflow: "new", assigned_agent_id: agentB, call: { status: "pending" }, sms: { status: "scheduled" }, status_flags: flags(["pending"]), next_evaluation_at: min(121) }),
    projection(3, { subject_status: "closed", workflow: "closed", assigned_agent_id: agentB, call: { status: "not_required" }, sms: { status: "not_required" }, next_evaluation_at: null }),
  ]);

  await db.collection("sales_intelligence_jobs").insertMany([
    { stage: "outreach_evaluate", status: "pending", next_attempt_at: min(-3), dedupe_key: "e1" },
    { stage: "outreach_evaluate", status: "pending", next_attempt_at: min(-1), dedupe_key: "e2" },
    { stage: "outreach_evaluate", status: "retry", next_attempt_at: min(30), dedupe_key: "e3" },
    { stage: "call_log_refresh", status: "dead_letter", next_attempt_at: min(-600), dedupe_key: "d1" },
    { stage: "outreach_evaluate", status: "completed", completed_at: min(-5), dedupe_key: "c1" },
    { stage: "outreach_rep_day", status: "completed", completed_at: min(-30), dedupe_key: "c2" },
    { stage: "outreach_rep_day", status: "completed", completed_at: min(-120), dedupe_key: "c3" },
    { stage: "directory", status: "retired", completed_at: min(-20), dedupe_key: "r1" },
  ]);

  await db.collection("sales_intelligence_sync_state").insertMany([
    {
      scope: "call_log_all_directions",
      known_complete_through: min(-15),
      last_run: { started_at: min(-1), finished_at: min(-1), error_code: null, sync_token_stored: true, sync_error_code: null },
      isync_lane: { last_run_at: min(-1), last_success_at: min(-4), last_error_code: null, last_records: 1 },
      call_log_sync: { token: "SYNTHETIC-PROVIDER-TOKEN", sync_time: min(-2), consecutive_expiries: 0 },
    },
    { scope: "outreach_contact_calls", known_complete_through: min(-20), cursor: { outreach_coverage_from: min(-90 * 24 * 60) }, last_run: { started_at: min(-2), error_code: null } },
    { scope: "outreach_contact_sms", known_complete_through: null, last_run: { started_at: min(-2), error_code: null } },
    { scope: "webhook_subscription_maintenance", last_run: { started_at: min(-600), error_code: "subscription_missing" } },
    { scope: "webhook_subscription_health:calls", last_run: { started_at: min(-10), error_code: null } },
    { scope: "rep_sms:101", message_sync: { token: "SYNTHETIC-PROVIDER-TOKEN", last_success_at: min(-6) } },
    { scope: "rep_sms:102", message_sync: { last_success_at: min(-2) } },
  ]);
  // The child runs with RINGCENTRAL_COLLECTION_MODE=test, so it reads the test-suffixed collection.
  await db.collection("ringcentral_webhook_events_test").insertMany([
    { provider: "ringcentral", telephonySessionId: "s-synthetic-1", receivedAt: min(-2), normalizedPreview: { from: "3055550199" } },
    { provider: "ringcentral", telephonySessionId: "s-synthetic-0", receivedAt: min(-9) },
    // Newer, but not a call (no telephony session): ignored.
    { provider: "ringcentral", telephonySessionId: null, receivedAt: min(-1) },
  ]);
  await db.collection("ringcentral_webhook_subscriptions").insertMany([
    { purpose: "calls", status: "Active", verification_token: "SYNTHETIC-PROVIDER-TOKEN" },
    { purpose: "rep_sms", status: "Active" },
  ]);

  await db.collection("sales_outreach_rep_day_projections").insertMany([
    { agent_id: agentA, business_day: today, count_scope: "all_outbound", actual_confirmed: 12, actual_awaiting_confirmation: 1, unattributed: 9, goal_snapshot: { goal: 100 }, goal_state: "behind", coverage: { state: "partial", reason: "capture_behind" }, computed_as_of: min(-3) },
    { agent_id: agentB, business_day: today, count_scope: "all_outbound", actual_confirmed: 30, actual_awaiting_confirmation: 0, unattributed: 28, goal_snapshot: { goal: 100 }, goal_state: "behind", coverage: { state: "partial" }, computed_as_of: min(-3) },
    { agent_id: agentA, business_day: yesterday, count_scope: "all_outbound", actual_confirmed: 86, actual_awaiting_confirmation: 0, unattributed: 74, goal_snapshot: { goal: 100 }, goal_state: "behind", coverage: { state: "complete" }, computed_as_of: min(-600) },
    { agent_id: agentA, business_day: addDays(today, -12), count_scope: "all_outbound", actual_confirmed: 5, actual_awaiting_confirmation: 0, unattributed: 0, goal_snapshot: { goal: 100 }, goal_state: "behind", coverage: { state: "complete" } },
  ]);

  const event = (business_date: string, association: string, goal_credit: string, eligible: boolean, kind = "outbound_attempt") => ({
    source_kind: "call",
    source_id: new ObjectId(),
    subject_id: association === "unique" ? subjects[0] : null,
    direction: "outbound",
    kind,
    business_date,
    association,
    goal_credit,
    goal_scope_eligible: eligible,
  });
  await db.collection("sales_outreach_contact_events").insertMany([
    event(today, "unique", "confirmed", true),
    event(today, "none", "confirmed", false, "other"),
    event(today, "none", "confirmed", false, "other"),
    event(yesterday, "ambiguous", "confirmed", false),
    event("2026-09-22", "none", "awaiting_confirmation", false, "other"),
  ]);

  await db.collection("call_interactions").insertMany([
    { started_at: new Date("2026-10-05T15:00:00Z"), terminal: true, call_log_state: "settled", direction: "Outbound" },
    { started_at: new Date("2026-09-22T15:00:00Z"), terminal: false, call_log_state: null, direction: "Internal" },
    { started_at: new Date("2026-09-23T15:00:00Z"), terminal: true, call_log_state: null, direction: "Outbound" },
    // After the CC-04 instant (2026-09-24T01:28:03Z): unconfirmed, but outside the OPS-1 split.
    { started_at: new Date("2026-09-24T03:00:00Z"), terminal: true, call_log_state: null, direction: "Inbound" },
  ]);
  await db.collection("ringcentral_rep_sms_evidence").insertMany([
    { identity_state: "reviewed", status: "delivered" },
    { identity_state: "reviewed", status: "received" },
  ]);
  await db.collection("sales_outreach_enrollment_runs").insertOne({
    run_key: "backfill-synthetic",
    mode: "apply",
    kind: "expansion",
    status: "completed",
    activation_at: min(-300),
    started_at: min(-301),
    finished_at: min(-299),
    counts: { enrolled: 3, skipped: 1, note: "not a number" },
    selected_leads: [{ model: "FormLead", id: "lead-ref-should-not-print" }],
    results: { first: "lead-ref-should-not-print" },
  });
  return { today, yesterday };
}

/** Child mode: a guarded client attempts one insert; the guard must exit 97 before it is sent. */
async function guardProbe(database: string) {
  const client = new MongoClient(CSI_ENQUEUE_LOCAL_REPLICA_URI, { monitorCommands: true, serverSelectionTimeoutMS: 10_000 });
  installReadOnlyCommandGuard(client);
  await client.connect();
  await client.db(database).collection("sales_outreach_subjects").countDocuments({});
  await client.db(database).collection("desk_state_guard_probe").insertOne({ probe: true });
  process.stdout.write("GUARD-DID-NOT-FIRE\n");
  await client.close();
}

async function main() {
  const probe = process.env.DESK_STATE_GUARD_PROBE_DB;
  if (probe) return guardProbe(probe);
  assert.ok(isLoopbackMongoUri(CSI_ENQUEUE_LOCAL_REPLICA_URI));
  const database = `testvantagemovers_sodstate${randomUUID().replaceAll("-", "")}`;
  const client = new MongoClient(CSI_ENQUEUE_LOCAL_REPLICA_URI, { serverSelectionTimeoutMS: 10_000 });
  await client.connect();
  const db = client.db(database);
  try {
    const { today, yesterday } = await seed(db, new Date());
    await db.collection("sales_outreach_projections").createIndex({ next_evaluation_at: 1 }, { name: "sod_projection_next_evaluation" });
    const before = await fingerprint(db);

    // 1. A target that is not the resolved database is refused before connecting.
    const wrong = runCli(database, ["--target=vantagemovers"]);
    assert.equal(wrong.status, 1, wrong.stderr);
    assert.match(wrong.stderr, /Refusing: --target=vantagemovers/);
    assert.equal(wrong.stdout, "");

    // 2. The real CLI against the seeded database: one JSON document with the expected numbers.
    const run = runCli(database, [`--target=${database}`]);
    assert.equal(run.status, 0, run.stderr);
    const lines = run.stdout.trim().split("\n");
    assert.equal(lines.length, 1, "compact output is one line");
    for (const marker of SECRET_MARKERS) assert.ok(!run.stdout.includes(marker), `stdout carries ${marker}`);
    const s = JSON.parse(lines[0]!);
    assert.equal(s.database, database);
    if (s.ny_today !== today) throw new Error("the run crossed NY midnight; re-run the proof");
    assert.equal(s.ny_yesterday, yesterday);

    assert.deepEqual(
      [s.configuration.state, s.configuration.revision, s.configuration.version, s.configuration.approval_ref, s.configuration.versions_stored],
      ["active", 5, "v-r5", "synthetic-r5", 2],
    );
    assert.deepEqual(s.configuration.integrity, { stored_hash_present: true, pointer_matches_version: true, raw_hash_matches: true, parsed_hash_matches: true, parse_ok: true });
    assert.equal(s.configuration.goals.roster_size, 2);
    assert.equal(s.configuration.controls.cadence_enforcement_enabled, true);

    assert.deepEqual(s.subjects, {
      total: 4,
      by_status: { active: 3, closed: 1 },
      by_enrollment_kind: { expansion: 3, intake: 1 },
      unassigned_active: 1,
      active_without_contact_number: 1,
      active_by_priority: { "1": 2, null: 1 },
      review_reasons: { priority_closed: 1 },
    });
    assert.deepEqual(s.periods, { total: 3, ended: 1, active_by_workflow_start: { "new/activation": 1, "quoted/activation": 1 } });

    const p = s.projections;
    assert.deepEqual([p.total, p.by_subject_status, p.by_exposure], [4, { active: 3, closed: 1 }, { enforcement: 4 }]);
    assert.deepEqual(p.active_call_status, { due: 2, pending: 1 });
    assert.deepEqual(p.active_sms_status, { due: 1, not_required: 1, scheduled: 1 });
    assert.deepEqual(
      [p.active_status_flags.needs_contact, p.active_status_flags.overdue, p.active_status_flags.pending, p.active_status_flags.blocked],
      [2, 1, 1, 0],
    );
    assert.equal(p.team_overdue_urgency_due_passed, 1);
    assert.equal(p.unassigned_due_calls, 1);
    assert.equal(p.next_evaluation.past_due, 1);
    assert.equal(p.next_evaluation.none, 1);
    assert.equal(Object.values(p.next_evaluation.by_utc_hour as Record<string, number>).reduce((a, b) => a + b, 0), 3);
    assert.ok(Object.keys(p.next_evaluation.by_utc_hour).every((k) => /^\d{4}-\d{2}-\d{2}T\d{2}Z$/.test(k)));

    const j = s.jobs;
    assert.deepEqual(j.open_by_stage_status, { call_log_refresh: { dead_letter: 1 }, outreach_evaluate: { pending: 2, retry: 1 } });
    assert.equal(j.dead_letters_total, 1);
    assert.equal(j.pending_or_retry_due_now, 2);
    assert.deepEqual(j.completed_last_10_min_by_stage, { outreach_evaluate: 1 });
    assert.deepEqual(j.completed_last_hour_by_stage, { directory: 1, outreach_evaluate: 1, outreach_rep_day: 1 });

    const w = s.watermarks;
    assert.deepEqual([w.call_log.present, w.call_log.lag_min, w.call_log.isync_lane.success_lag_min, w.call_log.isync_lane.last_records], [true, 15, 4, 1]);
    assert.deepEqual([w.contact_calls.lag_min, w.contact_sms.known_complete_through, w.contact_sms.present], [20, null, true]);
    assert.equal(w.subscription_maintenance.last_run.error_code, "subscription_missing");
    assert.equal(w.subscription_health_calls.last_run.error_code, null);
    assert.equal(w.subscription_health_rep_sms.present, false);
    assert.deepEqual(s.rep_sms_mailboxes, { mailboxes: 2, never_synced: 0, worst_lag_min: 6, best_lag_min: 2 });
    assert.deepEqual(s.subscriptions, { "calls/Active": 1, "rep_sms/Active": 1 });

    const rd = s.rep_days;
    assert.deepEqual([rd.today.rows, rd.today.count_scope, rd.today.coverage_state, rd.today.totals], [
      2,
      { all_outbound: 2 },
      { partial: 2 },
      { confirmed: 42, awaiting_confirmation: 1, other_outbound: 37 },
    ]);
    assert.deepEqual(rd.today.reps.map((r: { agent: string }) => r.agent), ["32227e", "3221ab"]);
    assert.deepEqual([rd.yesterday.rows, rd.yesterday.totals.confirmed, rd.yesterday.coverage_state], [1, 86, { complete: 1 }]);
    // Served view: roster reps (the configuration's two synthetic Agents) have no row and capture is
    // 20 min behind (partial), so they read Pending; the two row Agents are served from the projection.
    assert.equal(rd.today_served.available, true);
    assert.equal(rd.today_served.capture_coverage.state, "partial");
    assert.deepEqual(rd.today_served.actual_basis, { pending: 2, projection: 2 });
    assert.equal(rd.today_served.pending_without_row, 2);
    assert.deepEqual(
      rd.today_served.reps.map((r: { agent: string; on_roster: boolean; has_row: boolean; actual_basis: string }) => [r.agent, r.on_roster, r.has_row, r.actual_basis]),
      [["aaaaaa", true, false, "pending"], ["bbbbbb", true, false, "pending"], ["3221ab", false, true, "projection"], ["32227e", false, true, "projection"]],
    );
    assert.equal(rd.yesterday_served.reps.find((r: { agent: string }) => r.agent === "3221ab").actual_confirmed, 86);
    assert.deepEqual(rd.recent_by_day_scope.map((r: { business_day: string; confirmed: number }) => [r.business_day, r.confirmed]), [[today, 42], [yesterday, 86]]);

    const e = s.contact_events;
    assert.equal(e.total, 5);
    assert.deepEqual(e.by_association, { ambiguous: 1, none: 3, unique: 1 });
    assert.deepEqual(e.awaiting_by_business_date, { "2026-09-22": 1 });
    assert.deepEqual(e.today_by_source_direction_credit_association_eligible, {
      "call/outbound/confirmed/none/false": 2,
      "call/outbound/confirmed/unique/true": 1,
    });
    assert.deepEqual(e.yesterday_by_source_direction_credit_association_eligible, { "call/outbound/confirmed/ambiguous/false": 1 });

    assert.deepEqual(s.call_interactions, {
      total: 4,
      unconfirmed_total: 3,
      unconfirmed_by_utc_day: { "2026-09-22": 1, "2026-09-23": 1, "2026-09-24": 1 },
      unconfirmed_by_direction: { Inbound: 1, Internal: 1, Outbound: 1 },
      unconfirmed_inbound_outbound_total: 2,
      unconfirmed_internal_total: 1,
      unconfirmed_by_utc_day_direction: { "2026-09-22": { Internal: 1 }, "2026-09-23": { Outbound: 1 }, "2026-09-24": { Inbound: 1 } },
      before_cc04: { instant: "2026-09-24T01:28:03.000Z", inbound_outbound: 1, internal: 1 },
    });
    assert.deepEqual(s.subjects_without_numbers, { checked: 1, truncated: false, by_status_model_phone: { "active/CallLead/has_phone": 1 }, active_lead_has_phone: 1 });
    const f = s.freshness_inputs;
    assert.equal(f.webhook_collection, "ringcentral_webhook_events_test");
    assert.deepEqual(
      [f.calls.lane_success_lag_min, f.calls.reconcile.success_lag_min, f.calls.confirmation_lag_min, f.calls.webhook_lag_min, f.calls.known_complete_through_lag_min],
      [4, 1, 1, 2, 15],
    );
    assert.deepEqual(s.rep_sms_evidence, { total: 2, by_identity_status: { "reviewed/delivered": 1, "reviewed/received": 1 } });
    assert.equal(s.enrollment_runs.length, 1);
    assert.deepEqual([s.enrollment_runs[0].run_key, s.enrollment_runs[0].counts], ["backfill-synthetic", { enrolled: 3, skipped: 1 }]);

    // 3. --pretty prints the same document indented.
    const pretty = runCli(database, [`--target=${database}`, "--pretty"]);
    assert.equal(pretty.status, 0, pretty.stderr);
    assert.ok(pretty.stdout.split("\n").length > 50);
    assert.deepEqual(Object.keys(JSON.parse(pretty.stdout)), Object.keys(s));

    // 4. Nothing was written: every document, index and collection is unchanged.
    assert.equal(await fingerprint(db), before, "the database changed during the snapshot");

    // 5. The driver guard exits before an insert is sent.
    const guarded = spawnSync(process.execPath, ["--import", "tsx", "ops/sales-outreach/desk-state.replica.ts"], {
      cwd: SERVER_ROOT,
      env: { ...childEnv(database), DESK_STATE_GUARD_PROBE_DB: database },
      encoding: "utf8",
      timeout: 120_000,
    });
    assert.equal(guarded.status, READ_GUARD_EXIT_CODE, guarded.stderr);
    assert.match(guarded.stderr, /refused command 'insert'/);
    assert.ok(!guarded.stdout.includes("GUARD-DID-NOT-FIRE"));
    assert.equal(await db.collection("desk_state_guard_probe").countDocuments({}), 0);
    assert.equal(await fingerprint(db), before);

    console.log("PASS: desk-state CLI on seeded rows: every section's numbers, one JSON line, no secrets, target refusal, database unchanged, guard exits 97 before an insert");
  } finally {
    if (db.databaseName.startsWith("testvantagemovers_sodstate")) await db.dropDatabase();
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
