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
 *   number by whether their Lead has a phone) and the OPS-0c wave-2 reads (sticky reconcile success
 *   and the served calls freshness; read-time verification per channel; the served team overdue
 *   rule against the design count; `coverage_wait` against the cadence coverage; `next_evaluation_at`
 *   split open/closed; C8 other outbound per day from events (one per source per rep-day) and from
 *   stored rep-days; the closed-row `publication_revision` snapshot written by `--out` and diffed by
 *   `--compare`, a snapshot of another database refused);
 * - stdout is exactly one JSON document and carries no token, display name, phone or Lead selection;
 * - a `--target` that is not the resolved database is refused before connecting;
 * - the database is byte-identical afterwards (every document, every index, the collection list);
 * - the driver guard exits 97 before an insert is sent (the probe's row never lands).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
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
  const closedExtra = new ObjectId();
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
    // Cadence call coverage = min(Call Log −15 − 2 min allowance, derivation −20) = −20; SMS capture is off (no SMS coverage).
    // Row 0: call due 30 min ago, proven by coverage (reads overdue, counted by the team rule).
    projection(0, { subject_status: "active", workflow: "quoted", assigned_agent_id: agentA, call: { status: "due", due_at: min(-30) }, sms: { status: "not_required" }, status_flags: flags(["needs_contact", "overdue"]), queue_keys: { urgency_due: min(-30), call_due: min(-30), sms_due: min(24 * 60) }, next_evaluation_at: min(-5), coverage_wait: { call: null, sms: null } }),
    // Row 1 (written before A2: no sms_due): call due 10 min ago, past coverage (not yet verified), waits on coverage; SMS due 5 min ago.
    projection(1, { subject_status: "active", workflow: "new", assigned_agent_id: null, call: { status: "due", due_at: min(-10) }, sms: { status: "due", due_at: min(-5) }, status_flags: flags(["needs_contact"]), queue_keys: { urgency_due: min(24 * 60), call_due: min(-10) }, next_evaluation_at: min(120), coverage_wait: { call: min(-10), sms: null } }),
    // Row 2: pending on a 25-min-old wait that coverage already proves (the sweep's repair set).
    projection(2, { subject_status: "active", workflow: "new", assigned_agent_id: agentB, call: { status: "pending" }, sms: { status: "scheduled" }, status_flags: flags(["pending"]), queue_keys: { urgency_due: min(24 * 60), call_due: min(24 * 60), sms_due: min(24 * 60) }, next_evaluation_at: min(121), coverage_wait: { call: min(-25), sms: null } }),
    // Closed rows: one quiet (engine v2), one still scheduled (a v1 row the reconcile has not rewritten yet).
    projection(3, { subject_status: "closed", workflow: "closed", assigned_agent_id: agentB, call: { status: "not_required" }, sms: { status: "not_required" }, next_evaluation_at: null, publication_revision: 6, computed_as_of: min(-3 * 24 * 60) }),
    projection(4, { subject_id: closedExtra, subject_status: "closed", workflow: "closed", assigned_agent_id: agentB, call: { status: "not_required" }, sms: { status: "not_required" }, next_evaluation_at: min(60), publication_revision: 2, computed_as_of: min(-3 * 24 * 60) }),
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
      reconcile_sync_success_at: min(-1),
      last_run: { started_at: min(-1), finished_at: min(-1), error_code: null, sync_mode: "on", sync_token_stored: true, sync_error_code: null },
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
    { agent_id: agentA, business_day: today, count_scope: "all_outbound", actual_confirmed: 12, actual_awaiting_confirmation: 1, unattributed: 9, other_outbound: { no_lead: 0, lead_not_enrolled: 1, lead_closed: 0, before_activation: 0, ambiguous: 0, not_new_quoted: 0, unknown: 8 }, goal_snapshot: { goal: 100 }, goal_state: "behind", coverage: { state: "partial", reason: "capture_behind" }, computed_as_of: min(-3) },
    { agent_id: agentB, business_day: today, count_scope: "all_outbound", actual_confirmed: 30, actual_awaiting_confirmation: 0, unattributed: 28, goal_snapshot: { goal: 100 }, goal_state: "behind", coverage: { state: "partial" }, computed_as_of: min(-3) },
    { agent_id: agentA, business_day: yesterday, count_scope: "all_outbound", actual_confirmed: 86, actual_awaiting_confirmation: 0, unattributed: 74, goal_snapshot: { goal: 100 }, goal_state: "behind", coverage: { state: "complete" }, computed_as_of: min(-600) },
    { agent_id: agentA, business_day: addDays(today, -12), count_scope: "all_outbound", actual_confirmed: 5, actual_awaiting_confirmation: 0, unattributed: 0, goal_snapshot: { goal: 100 }, goal_state: "behind", coverage: { state: "complete" } },
  ]);

  const event = (business_date: string, association: string, goal_credit: string, eligible: boolean, kind = "outbound_attempt", reason: string | null = null, source_id = new ObjectId()) => ({
    source_kind: "call",
    source_id,
    goal_agent_id: agentA,
    association_reason: reason,
    subject_id: association === "unique" ? subjects[0] : null,
    direction: "outbound",
    kind,
    business_date,
    association,
    goal_credit,
    goal_scope_eligible: eligible,
  });
  const repeated = new ObjectId();
  await db.collection("sales_outreach_contact_events").insertMany([
    event(today, "unique", "confirmed", true, "outbound_attempt", "eligible"),
    event(today, "none", "confirmed", false, "other", "lead_not_enrolled", repeated),
    // A second event of the same source for the same rep-day: the rep-day counts the source once.
    event(today, "none", "confirmed", false, "other", "lead_not_enrolled", repeated),
    // Derived before C8: no reason (reads `unknown`).
    event(today, "none", "confirmed", false, "other"),
    event(yesterday, "ambiguous", "confirmed", false, "outbound_attempt", "ambiguous"),
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
  return { today, yesterday, closedIds: [subjects[3]!, closedExtra] };
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
    const { today, yesterday, closedIds } = await seed(db, new Date());
    const snapshotFile = path.join(os.tmpdir(), `${database}-closed.json`);
    const foreignFile = path.join(os.tmpdir(), `${database}-foreign.json`);
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
    assert.deepEqual([p.total, p.by_subject_status, p.by_exposure], [5, { active: 3, closed: 2 }, { enforcement: 5 }]);
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
    const sum = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);
    assert.equal(sum(p.next_evaluation.by_utc_hour), 4);
    // OPS-0c (A4): the histogram split open/closed; the still-scheduled closed row is visible.
    assert.deepEqual(
      [sum(p.next_evaluation.by_utc_hour_open), sum(p.next_evaluation.by_utc_hour_closed), p.next_evaluation.closed_scheduled, p.next_evaluation.open_none],
      [3, 1, 1, 0],
    );
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
    // Served view: roster reps (the configuration's two synthetic Agents) have no row; goal coverage is
    // 20 min behind, inside C0's 25-min today tolerance (complete), so they read a recorded 0
    // (`no_activity_recorded`, the wave-1 check); the two row Agents are served from the projection.
    assert.equal(rd.today_served.available, true);
    assert.equal(rd.today_served.capture_coverage.state, "complete");
    assert.deepEqual(rd.today_served.actual_basis, { no_activity_recorded: 2, projection: 2 });
    assert.equal(rd.today_served.pending_without_row, 0);
    assert.deepEqual(
      rd.today_served.reps.map((r: { agent: string; on_roster: boolean; has_row: boolean; actual_basis: string }) => [r.agent, r.on_roster, r.has_row, r.actual_basis]),
      [["aaaaaa", true, false, "no_activity_recorded"], ["bbbbbb", true, false, "no_activity_recorded"], ["3221ab", false, true, "projection"], ["32227e", false, true, "projection"]],
    );
    assert.equal(rd.yesterday_served.reps.find((r: { agent: string }) => r.agent === "3221ab").actual_confirmed, 86);
    assert.deepEqual(rd.recent_by_day_scope.map((r: { business_day: string; confirmed: number }) => [r.business_day, r.confirmed]), [[today, 42], [yesterday, 86]]);

    const e = s.contact_events;
    assert.equal(e.total, 6);
    assert.deepEqual(e.by_association, { ambiguous: 1, none: 4, unique: 1 });
    assert.deepEqual(e.awaiting_by_business_date, { "2026-09-22": 1 });
    assert.deepEqual(e.today_by_source_direction_credit_association_eligible, {
      "call/outbound/confirmed/none/false": 3,
      "call/outbound/confirmed/unique/true": 1,
    });
    assert.deepEqual(e.yesterday_by_source_direction_credit_association_eligible, { "call/outbound/confirmed/ambiguous/false": 1 });
    // OPS-0c (C8): every event by stored reason; other outbound one per source per rep-day, by bucket.
    assert.deepEqual(e.association_reason_by_day, { [today]: { eligible: 1, lead_not_enrolled: 2, null: 1 }, [yesterday]: { ambiguous: 1 } });
    const bucketsOf = (counts: Record<string, number>) => ({ no_lead: 0, lead_not_enrolled: 0, lead_closed: 0, before_activation: 0, ambiguous: 0, not_new_quoted: 0, unknown: 0, ...counts });
    assert.deepEqual(e.other_outbound_by_day, {
      [today]: { ...bucketsOf({ lead_not_enrolled: 1, unknown: 1 }), total: 2 },
      [yesterday]: { ...bucketsOf({ ambiguous: 1 }), total: 1 },
    });
    assert.deepEqual(rd.other_outbound_by_day[today], { rows: 2, rows_with_breakdown: 1, unattributed: 37, breakdown: bucketsOf({ lead_not_enrolled: 1, unknown: 8 }), breakdown_total: 9 });
    assert.deepEqual(rd.other_outbound_by_day[yesterday], { rows: 1, rows_with_breakdown: 0, unattributed: 74, breakdown: bucketsOf({}), breakdown_total: 0 });
    assert.deepEqual(Object.keys(rd.other_outbound_by_day), [today, yesterday]);

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
    // OPS-0c: the sticky reconcile success is read, and the served state is composed (fresh: confirmed 1 min ago, coverage 15 min back).
    assert.equal(f.calls.reconcile.sticky_success_at, f.calls.reconcile.success_at);
    assert.deepEqual([f.calls.reconcile.sync_mode, f.calls.served.state, f.calls.served.reason], ["on", "fresh", null]);

    // OPS-0c wave-2 acceptance reads.
    const w2 = s.wave2_acceptance;
    // Cadence call coverage = min(Call Log - 2 min allowance, derivation) = the derivation watermark (-20 min).
    assert.deepEqual(w2.cadence_coverage, { available: true, call_through: w.contact_calls.known_complete_through, sms_through: null, sms_capture_enabled: false });
    assert.deepEqual([w2.active_rows, w2.active_rows_truncated, w2.shadow_rows], [3, false, 0]);
    assert.deepEqual(
      [w2.call.stored_status, w2.call.stored_overdue, w2.call.due_passed, w2.call.read_overdue, w2.call.read_due_unverified],
      [{ due: 2, pending: 1 }, 0, 2, 1, 1],
    );
    assert.deepEqual([w2.sms.due_passed, w2.sms.read_overdue, w2.sms.read_due_unverified, w2.rows_reading_overdue], [1, 0, 1, 1]);
    assert.deepEqual(w2.distinct_overdue_leads, {
      available: true,
      cutoffs: { call: w.contact_calls.known_complete_through, sms: null },
      served_rule: 1,
      design_count: 1,
      active_without_sms_due: 1,
    });
    assert.deepEqual(
      [w2.coverage_wait.call.waiting, w2.coverage_wait.call.proven, w2.coverage_wait.call.proven_and_pending, w2.coverage_wait.call.closed_waiting],
      [2, 1, 1, 0],
    );
    assert.ok(Date.parse(w2.coverage_wait.call.oldest_proven_wait) < Date.parse(w2.coverage_wait.call.through));
    assert.deepEqual([w2.coverage_wait.sms.through, w2.coverage_wait.sms.proven, w2.coverage_wait.sms.waiting], [null, null, 0]);
    assert.deepEqual(w2.closed_publication, { rows: 2, truncated: false, revision_sum: 8, rewritten_since_ny_midnight: 0, comparison: null });
    assert.deepEqual(s.rep_sms_evidence, { total: 2, by_identity_status: { "reviewed/delivered": 1, "reviewed/received": 1 } });
    assert.equal(s.enrollment_runs.length, 1);
    assert.deepEqual([s.enrollment_runs[0].run_key, s.enrollment_runs[0].counts], ["backfill-synthetic", { enrolled: 3, skipped: 1 }]);

    // 3. --pretty prints the same document indented.
    const pretty = runCli(database, [`--target=${database}`, "--pretty"]);
    assert.equal(pretty.status, 0, pretty.stderr);
    assert.ok(pretty.stdout.split("\n").length > 50);
    assert.deepEqual(Object.keys(JSON.parse(pretty.stdout)), Object.keys(s));

    // 3b. --out writes the closed-row snapshot to a local file; --compare diffs a later run against it.
    const withOut = runCli(database, [`--target=${database}`, `--out=${snapshotFile}`]);
    assert.equal(withOut.status, 0, withOut.stderr);
    const snapshot = JSON.parse(readFileSync(snapshotFile, "utf8"));
    assert.deepEqual([snapshot.tool, snapshot.version, snapshot.database, snapshot.truncated], ["sales-outreach-desk-state/closed-publication", 1, database, false]);
    assert.deepEqual(snapshot.rows, { [closedIds[0]!.toHexString()]: 6, [closedIds[1]!.toHexString()]: 2 });
    for (const id of closedIds) assert.ok(!withOut.stdout.includes(id.toHexString()), "the summary lists no full subject id");
    const quiet = runCli(database, [`--target=${database}`, `--compare=${snapshotFile}`]);
    assert.equal(quiet.status, 0, quiet.stderr);
    const quietComparison = JSON.parse(quiet.stdout).wave2_acceptance.closed_publication.comparison;
    assert.deepEqual(
      [quietComparison.compared, quietComparison.unchanged, quietComparison.increased, quietComparison.decreased, quietComparison.newly_closed, quietComparison.missing],
      [2, 2, 0, 0, 0, 0],
    );
    // A snapshot of another database is refused (exit 1) before any summary is printed.
    writeFileSync(foreignFile, JSON.stringify({ ...snapshot, database: "vantagemovers" }));
    const foreign = runCli(database, [`--target=${database}`, `--compare=${foreignFile}`]);
    assert.equal(foreign.status, 1);
    assert.match(foreign.stderr, /--compare snapshot is of database 'vantagemovers'/);
    assert.equal(foreign.stdout, "");

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

    // 6. A closed row rewritten after the snapshot (the midnight regression the plan watches for) reads as increased.
    await db.collection("sales_outreach_projections").updateOne({ subject_id: closedIds[1] }, { $inc: { publication_revision: 1 } });
    const after = runCli(database, [`--target=${database}`, `--compare=${snapshotFile}`]);
    assert.equal(after.status, 0, after.stderr);
    const comparison = JSON.parse(after.stdout).wave2_acceptance.closed_publication.comparison;
    assert.deepEqual(
      [comparison.increased, comparison.unchanged, comparison.max_increase, comparison.increased_subjects],
      [1, 1, 1, [closedIds[1]!.toHexString().slice(-6)]],
    );

    console.log(
      "PASS: desk-state CLI on seeded rows: every section's numbers (wave-2 reads included), one JSON line, no secrets, target refusal, closed snapshot --out/--compare, database unchanged, guard exits 97 before an insert",
    );
  } finally {
    for (const file of [path.join(os.tmpdir(), `${database}-closed.json`), path.join(os.tmpdir(), `${database}-foreign.json`)]) if (existsSync(file)) rmSync(file);
    if (db.databaseName.startsWith("testvantagemovers_sodstate")) await db.dropDatabase();
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
