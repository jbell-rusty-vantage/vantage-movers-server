/**
 * SRV-6 replica proof (local csi01 loopback replica only; synthetic rows in a unique database that is
 * dropped afterwards). Never loads production env and never calls a provider. Run:
 *
 *   node --import tsx ops/sales-outreach/contact-events.replica.ts
 *
 * Proves on real Mongo what the unit tests prove on in-memory stand-ins:
 * - contact events: one row per source under three concurrent derivations (deterministic `_id`
 *   collides, the losers retry and converge), indexes build from the model, a replay writes nothing,
 *   `outreach_evaluate` / `outreach_rep_day` jobs land in `sales_intelligence_jobs` in the same
 *   transaction;
 * - rep-day upsert: the recount writes the row the S1 read expects (`sod_rep_day_unique`), a second
 *   identical recount is a no-op, a provisional → settled call moves awaiting → confirmed with a
 *   monotonic `publication_revision`;
 * - minute sweep: the `(updatedAt, _id)` cursor and the derivation watermark on the
 *   `outreach_contact_calls` sync-state row; a concurrent sweep is `lease_held`;
 * - call-inferred receiver: a reviewed rep's call on an unassigned subject whose Lead has no receiver
 *   writes `ringcentral_rep_call` with its EntityChange + `domain_revision` stamp in the same
 *   transaction; a later call by another rep or a replay does not move it;
 * - pre-CC-04 settle (olr C3): the dry run reports only the null Inbound/Outbound row before CC-04
 *   (the Internal row is left, the post-CC-04 row is an anomaly); apply settles it with a revision bump
 *   and one audit row, the sweep re-derives it awaiting → confirmed and the rep-day follows with one
 *   publication; a second apply matches 0;
 * - count scope from the configuration (olr C1a): a PATCH with a `goals.count_scope_schedule` entry on
 *   or before today is `count_scope_not_prospective` and writes nothing; a future entry commits; the
 *   recount writes `all_outbound` the day before the flip and `eligible_new_quoted` on it; the refresh
 *   pass rewrites a row an older build counted under another scope, once;
 * - re-derive wake (olr C4): a call derived `none` before its Lead was admitted is nominated by the
 *   admission's own transaction (`admit:<subject>` job identity; the activation's New York date only, a
 *   call the day before is not), a replayed nomination dedupes, and draining the job associates and
 *   credits the call and nominates the subject's evaluation; an earlier same-date call stays `none` but
 *   carries the subject;
 * - P05f/P10a subtraction (olr C4): two Leads enrolled in one cohort at 15:00 ET; the one called twice
 *   earlier that day owes 0 calls on the activation date after the wake drains, the other owes 2;
 * - subjects without numbers (olr C2a/C2b): a Call Lead received before capture began enrolls with no
 *   number; the read-only diagnostic lists it as `no_contact_number`, the mint script's dry run writes
 *   nothing, its apply mints the number (`created_via: call_lead`, audited), links it and nominates the
 *   subject's lead change in the same transaction; the drained job gives the subject the number and the
 *   diagnostic reports `no_contact_number: 0`; a rerun writes nothing;
 * - zero-activity days (olr C5): the refresh after New York midnight writes one zero row with a frozen
 *   goal snapshot per roster rep without a row yesterday (strict model, `sod_rep_day_unique`), none
 *   today or off the roster; a second pass rewrites nothing and racing passes converge on one row per rep.
 * - rep-day coverage (olr C0, D-A3): with the capped watermarks 50 min behind and the observed ones 17–18
 *   min behind, the recount (watermarks read in its transaction) and GET /rep-days both read today complete
 *   through as_of − 20 against as_of − 25, so a zero-call roster rep reads 0 / no_activity_recorded; with
 *   the capped watermarks alone the same rep reads Pending.
 * - other-outbound breakdown (olr C8): events store `association_reason` through the strict model; events
 *   made pre-C8 give an all-`unknown` breakdown; `rederive-contact-events` dry run writes and enqueues
 *   nothing, apply rewrites each event once, nominates the subject's evaluation and recounts the rep-day
 *   to the real breakdown (strict `other_outbound` subdocument), served by GET /rep-days and GET /team; a
 *   second run changes nothing.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { csiEnqueueReplicaTarget } from "../lib/csi-enqueue-replica-target";

const database = `testvantagemovers_sodcontacts${randomUUID().replaceAll("-", "")}`;
for (const key of Object.keys(process.env))
  if (/RINGCENTRAL|^RC_|BLOB|GATEWAY|OPENAI|ANTHROPIC|VERCEL|KV_REST|REDIS|UPSTASH|QSTASH|GOOGLE|MONGO|DOTENV/i.test(key)) delete process.env[key];
process.env.DOTENV_CONFIG_PATH = `${__dirname}/.sod-contacts-replica-no-dotenv.env`;
process.env.MONGO_URI = csiEnqueueReplicaTarget(process.argv);
process.env.TEST_MODE = "true";
process.env.TEST_MONGO_DATABASE_NAME = database;
process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID = "sod-contacts-replica";
process.env.SHEET_SYNC_MODE = "disabled";

async function main() {
  const { connectMongo, withTransaction } = await import("../../src/db.js");
  const { getCallInteractionModel } = await import("../../src/models/CallInteraction.js");
  const { getRepIdentityLinkModel } = await import("../../src/models/RepIdentityLink.js");

  const { getContactNumberModel } = await import("../../src/models/ContactNumber.js");
  const { getSalesIntelligenceJobModel } = await import("../../src/models/SalesIntelligenceJob.js");
  const { getSalesIntelligenceSyncStateModel } = await import("../../src/models/SalesIntelligenceSyncState.js");
  const { getSalesIntelligenceContactRestrictionModel } = await import("../../src/models/SalesIntelligenceContactRestriction.js");
  const models = await import("../../src/models/salesOutreach/index.js");
  const { getRingCentralRepSmsEvidenceModel } = await import("../../src/models/salesOutreach/repSmsEvidence.js");
  const { resetVerifiedCsiFences } = await import("../../src/models/salesIntelligence/common.js");
  const { applyContactSources } = await import("../../src/services/salesOutreach/contacts/apply.js");
  const { contactEventId } = await import("../../src/services/salesOutreach/contacts/derive.js");
  const { mongoContactEventStore } = await import("../../src/services/salesOutreach/contacts/mongoStore.js");
  const { mongoRepDayStore, recountRepDay } = await import("../../src/services/salesOutreach/contacts/repDayService.js");
  const { sweepContactSources } = await import("../../src/services/salesOutreach/contacts/sweep.js");
  const { activeInspection, fixedConfigurationLoader } = await import("../../src/services/salesOutreach/reads/testing.js");
  const { CALL_LOG_ALL_DIRECTIONS_SCOPE } = await import("../../src/services/numberActivity/reconcileCallLog.js");

  await connectMongo();
  assert.equal(mongoose.connection.name, database);
  resetVerifiedCsiFences();
  for (const Model of [
    getCallInteractionModel(),
    getRepIdentityLinkModel(),

    getContactNumberModel(),
    getSalesIntelligenceJobModel(),
    getSalesIntelligenceSyncStateModel(),
    getSalesIntelligenceContactRestrictionModel(),
    getRingCentralRepSmsEvidenceModel(),
    models.getSalesOutreachSubjectModel(),
    models.getSalesOutreachPolicyPeriodModel(),
    models.getSalesOutreachContactEventModel(),
    models.getSalesOutreachRepDayProjectionModel(),
    models.getSalesOutreachEnrollmentRunModel(),
    models.getSalesOutreachProjectionModel(),
    models.getSalesOutreachFollowupScheduleModel(),
  ] as unknown as Array<mongoose.Model<unknown>>) {
    await Model.createCollection();
    await Model.createIndexes();
  }

  const account = "800000000001";
  const alice = new mongoose.Types.ObjectId();
  const number = new mongoose.Types.ObjectId();
  const leadId = new mongoose.Types.ObjectId();
  const subjectId = new mongoose.Types.ObjectId();
  const activation = new Date("2026-10-01T12:00:00Z");
  await getRepIdentityLinkModel().create({
    agent_id: alice, agent_name_snapshot: "Alice", rc_account_id: account, rc_extension_id: "101", role_kind: "sales_rep", status: "reviewed",
    effective_from: new Date("2026-01-01T00:00:00Z"), reviewed_at: new Date("2026-01-01T00:00:00Z"), reviewed_by: "owner",
  });
  // All Numbers: the call credits the number's current Lead.
  await getContactNumberModel().create({ _id: number, e164: "+15550100000", digits_reversed: "00001005551", first_observed_at: activation, last_activity_at: activation,
    lead: { model: "FormLead", id: leadId, received_at: activation, state: "open" }, lead_link: { source: "automatic", set_at: activation } });
  await models.getSalesOutreachSubjectModel().create({
    _id: subjectId, lead_model: "FormLead", lead_id: leadId,
    enrollment: { cohort_id: "c1", kind: "pilot", enrolled_at: activation, activation_at: activation, manifest_hash: null },
    status: "active", received_quality: "instant", adapter_version: "v1",
  });
  await models.getSalesOutreachPolicyPeriodModel().create({
    subject_id: subjectId, transition_key: "activation", policy_version: "v-test", activation_boundary: activation, workflow: "new",
    start_kind: "activation", started_at: activation, time_basis: "activation_boundary",
  });
  const start = new Date("2026-10-05T14:10:00Z");
  const call = await getCallInteractionModel().create({
    provider_account_id: account, telephony_session_id: "s-1", identity_basis: "telephony_session_id", direction: "Outbound",
    contact_number_id: number, external_endpoint_kind: "external", started_at: start, provider_connected: true, provider_result: "Call connected",
    parties: [{ role: "user", direction: "Outbound", extension_id: "101" }], legs: [],
    call_log_state: null, terminal: true, first_observed_at: start, last_observed_at: start,
  });
  const source = { source_kind: "call" as const, source_id: String(call._id) };
  const now = new Date("2026-10-05T19:00:00Z");

  // --- concurrent derivation: one row -------------------------------------------------------------
  // Concurrent writers of one source collide on the deterministic `_id` (a write conflict is retried by
  // the transaction; a loser that still fails is retried by its job or the next sweep pass).
  const concurrent = await Promise.allSettled([1, 2, 3].map(() => withTransaction((session) => applyContactSources([source], { now, queueRepDays: true }, mongoContactEventStore, session))));
  assert.ok(concurrent.some((r) => r.status === "fulfilled"), "at least one derivation commits");
  const Events = models.getSalesOutreachContactEventModel();
  assert.equal(await Events.countDocuments({}), 1, "deterministic _id: one event per source");
  const event = await Events.findById(contactEventId("call", String(call._id))).lean();
  assert.equal(String(event?.subject_id), String(subjectId));
  assert.equal(event?.goal_credit, "awaiting_confirmation");
  assert.equal(await getSalesIntelligenceJobModel().countDocuments({ stage: "outreach_evaluate" }), 1);
  assert.equal(await getSalesIntelligenceJobModel().countDocuments({ stage: "outreach_rep_day" }), 1);
  const replay = await withTransaction((session) => applyContactSources([source], { now, queueRepDays: true }, mongoContactEventStore, session));
  assert.equal(replay.changed, 0, "a replay writes nothing");

  // --- rep-day upsert ------------------------------------------------------------------------------
  const configuration = activeInspection({
    controls: { desk_enabled: true, goal_metrics_enabled: true },
    goals: { roster_version: "r1", default_scheduled_goal: 100, zero_goal_rule: "no_goal_today_excluded_from_denominator", rep_work_schedules: [{ agent_id: String(alice), working_days: [1, 2, 3, 4, 5, 6, 7] }], effective_day_overrides: [] },
  });
  assert.equal(configuration.state, "active");
  if (configuration.state !== "active") return;
  const key = { agent_id: String(alice), business_day: "2026-10-05" };
  await withTransaction((session) => recountRepDay(key, configuration, now, mongoRepDayStore, session));
  const Rows = models.getSalesOutreachRepDayProjectionModel();
  let row = await Rows.findOne({ agent_id: alice, business_day: "2026-10-05" }).lean();
  assert.deepEqual([row?.actual_confirmed, row?.actual_awaiting_confirmation, row?.publication_revision, row?.count_scope], [0, 1, 1, "all_outbound"]);
  assert.equal((await withTransaction((session) => recountRepDay(key, configuration, now, mongoRepDayStore, session))).outcome, "unchanged");
  await getCallInteractionModel().updateOne({ _id: call._id }, { $set: { call_log_state: "settled", legs: [{ extension_id: "101", direction: "Outbound", start_time: start, result: "Call connected" }] }, $inc: { projection_revision: 1 } });
  await withTransaction((session) => applyContactSources([source], { now, queueRepDays: true }, mongoContactEventStore, session));
  await withTransaction((session) => recountRepDay(key, configuration, now, mongoRepDayStore, session));
  row = await Rows.findOne({ agent_id: alice, business_day: "2026-10-05" }).lean();
  assert.deepEqual([row?.actual_confirmed, row?.actual_awaiting_confirmation, row?.publication_revision], [1, 0, 2]);

  // --- minute sweep: cursor, watermark, lease -----------------------------------------------------
  // olr A3: capture carries both watermarks (the observed one is not capped by provisional rows); the
  // strict sync-state schema must accept them and the reconcile's sticky success instant.
  await getSalesIntelligenceSyncStateModel().updateOne(
    { scope: CALL_LOG_ALL_DIRECTIONS_SCOPE },
    { $set: { known_complete_through: new Date("2026-10-05T18:40:00Z"), observed_complete_through: new Date("2026-10-05T18:44:00Z"), reconcile_sync_success_at: new Date("2026-10-05T18:58:00Z") } },
    { upsert: true },
  );
  const loader = fixedConfigurationLoader(configuration);
  const swept = await sweepContactSources("call", now, { loader });
  assert.equal(swept.caught_up, true);
  const state = await getSalesIntelligenceSyncStateModel().findOne({ scope: "outreach_contact_calls" }).lean();
  assert.equal(state?.known_complete_through?.toISOString(), "2026-10-05T18:40:00.000Z");
  assert.equal(state?.observed_complete_through?.toISOString(), "2026-10-05T18:44:00.000Z", "A3: the sweep stores the observed derivation watermark");
  const { loadCallWatermarks, cadenceCallCoverage, goalCallCoverage } = await import("../../src/services/salesOutreach/evidence/coverage.js");
  const { deskTimingOf } = await import("../../src/services/salesOutreach/config/timing.js");
  const marks = await withTransaction((session) => loadCallWatermarks(session));
  assert.deepEqual(
    [marks.capture_known, marks.capture_observed, marks.derived_known, marks.derived_observed].map((d) => d?.toISOString() ?? null),
    ["2026-10-05T18:40:00.000Z", "2026-10-05T18:44:00.000Z", "2026-10-05T18:40:00.000Z", "2026-10-05T18:44:00.000Z"],
    "A3: one find over both call scopes",
  );
  assert.ok(marks.coverage_from, "coverage_from from the sweep cursor");
  assert.equal(cadenceCallCoverage(marks, deskTimingOf(null))?.toISOString(), "2026-10-05T18:38:00.000Z");
  assert.equal(goalCallCoverage(marks, deskTimingOf(null))?.toISOString(), "2026-10-05T18:42:00.000Z");
  // olr A3: the ISync lane's dotted $set keeps `isync_lane.last_success_at` when a run stores no token.
  const { isyncLaneSetOf } = await import("../../src/services/numberActivity/callLogIsyncLane.js");
  const laneWrite = (success: Date | null, ran: Date) => ({
    call_log_sync: null,
    quarantined_records: [],
    record_failures: [],
    isync_lane: { last_run_at: ran, last_success_at: success, last_error_code: success ? null : "provider_throttled", last_records: 0, last_applied: 0 },
  });
  const SyncState = getSalesIntelligenceSyncStateModel();
  await SyncState.updateOne({ scope: CALL_LOG_ALL_DIRECTIONS_SCOPE }, { $set: isyncLaneSetOf(laneWrite(new Date("2026-10-05T18:57:00Z"), new Date("2026-10-05T18:57:00Z")), now) });
  await SyncState.updateOne({ scope: CALL_LOG_ALL_DIRECTIONS_SCOPE }, { $set: isyncLaneSetOf(laneWrite(null, new Date("2026-10-05T18:59:00Z")), now) });
  const lane = (await SyncState.findOne({ scope: CALL_LOG_ALL_DIRECTIONS_SCOPE }).lean()) as unknown as {
    isync_lane?: { last_run_at?: Date; last_success_at?: Date | null; last_error_code?: string | null };
    reconcile_sync_success_at?: Date;
  } | null;
  assert.equal(lane?.isync_lane?.last_success_at?.toISOString(), "2026-10-05T18:57:00.000Z", "A3: last_success_at never regresses to null");
  assert.equal(lane?.isync_lane?.last_run_at?.toISOString(), "2026-10-05T18:59:00.000Z");
  assert.equal(lane?.isync_lane?.last_error_code, "provider_throttled");
  assert.equal(lane?.reconcile_sync_success_at?.toISOString(), "2026-10-05T18:58:00.000Z", "A3: the lane write leaves the reconcile's instant alone");
  assert.ok(state?.cursor?.outreach_source_updated_at, "cursor stored");
  const { MongoLeaseStore } = await import("../../src/services/durableWork/leases.js");
  const leases = new MongoLeaseStore(getSalesIntelligenceSyncStateModel());
  // Hold the lease on the sweep's clock: a lease taken on the wall clock would already look expired to a
  // sweep running at the synthetic instant, which would steal it. Past the first sweep's 120 s lease,
  // because that sweep releases on the wall clock, which no longer frees a synthetic-clock lease once the
  // real time is past `now`.
  const leaseAt = new Date(+now + 121_000);
  const held = await leases.acquire({ scope: "outreach_contact_calls", owner: "other", ttl_ms: 60_000, now: leaseAt });
  assert.ok(held);
  assert.equal((await sweepContactSources("call", leaseAt, { loader })).reason, "lease_held");
  await leases.release({ token: held, now: leaseAt });

  // --- call-inferred receiver fill ----------------------------------------------------------------
  const { Agent } = await import("../../src/models/Agent.js");
  const { getFormLeadModel } = await import("../../src/models/FormLead.js");
  await getFormLeadModel().createCollection();
  await Agent.createCollection();
  await Agent.collection.insertOne({ _id: alice, name: "Alice", normalized_name: "alice", active: true });
  const bob = new mongoose.Types.ObjectId();
  await getRepIdentityLinkModel().create({
    agent_id: bob, agent_name_snapshot: "Bob", rc_account_id: account, rc_extension_id: "102", role_kind: "sales_rep", status: "reviewed",
    effective_from: new Date("2026-01-01T00:00:00Z"), reviewed_at: new Date("2026-01-01T00:00:00Z"), reviewed_by: "owner",
  });
  await Agent.collection.insertOne({ _id: bob, name: "Bob", normalized_name: "bob", active: true });
  await getFormLeadModel().collection.insertOne({ _id: leadId, name: "Replica Lead", domain_revision: 1 });
  const fillCall = async (extension: string, at: string, session: string) => {
    const started = new Date(at);
    const row = await getCallInteractionModel().create({
      provider_account_id: account, telephony_session_id: session, identity_basis: "telephony_session_id", direction: "Outbound",
      contact_number_id: number, external_endpoint_kind: "external", started_at: started, provider_connected: true, provider_result: "Call connected",
      parties: [{ role: "user", direction: "Outbound", extension_id: extension }], legs: [{ extension_id: extension, direction: "Outbound", start_time: started, result: "Call connected" }],
      call_log_state: "settled", terminal: true, first_observed_at: started, last_observed_at: started,
    });
    return { source_kind: "call" as const, source_id: String(row._id) };
  };
  const bobCall = await fillCall("102", "2026-10-05T15:00:00Z", "s-fill-1");
  const filled = await withTransaction((session) => applyContactSources([bobCall], { now, queueRepDays: false }, mongoContactEventStore, session));
  assert.equal(filled.receivers_filled, 1);
  let lead = await getFormLeadModel().collection.findOne({ _id: leadId });
  assert.equal(String(lead?.receiver_agent), String(bob));
  assert.deepEqual([lead?.receiver_agent_source, lead?.receiver_agent_source_value, lead?.receiver_agent_name_snapshot], ["ringcentral_rep_call", bobCall.source_id, "Bob"]);
  assert.ok((lead?.domain_revision ?? 0) > 1, "the write stamps a new Lead revision (the subject feed re-syncs it)");
  const change = await mongoose.connection.db!.collection("entity_changes").findOne({ "entity.model": "FormLead", "entity.id": String(leadId) });
  assert.ok(change, "one EntityChange row for the receiver write");
  const aliceLater = await fillCall("101", "2026-10-05T16:00:00Z", "s-fill-2");
  const kept = await withTransaction((session) => applyContactSources([aliceLater, bobCall], { now, queueRepDays: false }, mongoContactEventStore, session));
  assert.equal(kept.receivers_filled, 0, "a filled receiver is never replaced by a later call");
  lead = await getFormLeadModel().collection.findOne({ _id: leadId });
  assert.equal(String(lead?.receiver_agent), String(bob));

  // --- olr C3: settle the pre-CC-04 Call Log rows (`ops/lib/sales-outreach-settle-pre-cc04.ts`) -----
  // A call the Call Log read before CC-04 stamped `call_log_state` stays awaiting forever; the settle
  // stamps it `settled` + revision, and the minute sweep's cursor re-derives it to confirmed.
  const { applySettle, reportSettle } = await import("../lib/sales-outreach-settle-pre-cc04.js");
  const { csiOperatorActor } = await import("../../src/services/salesIntelligence/auth.js");
  const { getSalesIntelligenceAuditEventModel } = await import("../../src/models/SalesIntelligenceAuditEvent.js");
  await getSalesIntelligenceAuditEventModel().createCollection();
  await getSalesIntelligenceAuditEventModel().createIndexes();
  const preCc04Call = async (direction: "Outbound" | "Internal", at: string, session: string) => {
    const started = new Date(at);
    return getCallInteractionModel().create({
      provider_account_id: account, telephony_session_id: session, identity_basis: "telephony_session_id", direction,
      contact_number_id: number, external_endpoint_kind: "external", started_at: started, provider_connected: true, provider_result: "Call connected",
      parties: [{ role: "user", direction: "Outbound", extension_id: "101" }], legs: [{ extension_id: "101", direction: "Outbound", start_time: started, result: "Call connected" }],
      call_log_ids: [`log-${session}`], call_log_state: null, terminal: true, first_observed_at: started, last_observed_at: started,
    });
  };
  const pre = await preCc04Call("Outbound", "2026-09-23T14:00:00Z", "s-pre-cc04");
  const preInternal = await preCc04Call("Internal", "2026-09-23T14:05:00Z", "s-pre-cc04-internal");
  const late = await preCc04Call("Outbound", "2026-09-25T14:00:00Z", "s-post-cc04"); // anomaly: reported, never written
  // Sweeps run on clocks past the lease step above: a sweep releases its lease on the wall clock, which
  // no longer frees a synthetic-clock lease, so each later sweep is ≥ 121 s after the previous one (a
  // step added after this one must sweep at `settleSweepAt + 121 s` or later).
  const preSweepAt = new Date(+leaseAt + 1_000);
  const settleSweepAt = new Date(+preSweepAt + 121_000);
  // The sweep derives the rows (awaiting), recounts the 2026-09-23 rep-day and moves its cursor past
  // them; the settle's `updatedAt` bump is what brings the row back after the 2-minute overlap.
  const firstSweep = await sweepContactSources("call", preSweepAt, { loader });
  assert.deepEqual([firstSweep.skipped, firstSweep.caught_up], [false, true]);
  const preEventId = contactEventId("call", String(pre._id));
  assert.equal((await Events.findById(preEventId).lean())?.goal_credit, "awaiting_confirmation", "pre-CC-04 row derives awaiting");
  const preRow = await Rows.findOne({ agent_id: alice, business_day: "2026-09-23" }).lean();
  assert.deepEqual([preRow?.actual_confirmed, preRow?.actual_awaiting_confirmation], [0, 1]);

  const dry = await reportSettle();
  assert.deepEqual(dry.ids, [String(pre._id)], "only the Inbound/Outbound pre-CC-04 row is a candidate");
  assert.deepEqual(dry.summary.by_day, { "2026-09-23": { Inbound: 0, Outbound: 1, total: 1 } });
  assert.deepEqual(dry.summary.contact_events.by_goal_credit, { awaiting_confirmation: 1 });
  assert.deepEqual(dry.summary.anomalies, { count: 1, sample_ids: [String(late._id)] });
  assert.equal(dry.summary.internal_left, 1);
  assert.equal((await getCallInteractionModel().findById(pre._id).lean())?.call_log_state, null, "the dry run writes nothing");

  const preUpdatedAt = (await getCallInteractionModel().findById(pre._id).lean())!.updatedAt as Date;
  // olr CW0: the stamp is the database clock ($currentDate), bracketed by the server's own `localTime`.
  const dbClock = async () => ((await mongoose.connection.db!.admin().command({ hello: 1 })) as { localTime: Date }).localTime;
  const dbBefore = await dbClock();
  const settled = await applySettle({ actor: csiOperatorActor("settle-pre-cc04-replica"), run_id: "settle-pre-cc04-replica" }, { batch: 1 });
  const dbAfter = await dbClock();
  assert.deepEqual([settled.settled, settled.batches, settled.ids], [1, 1, [String(pre._id)]]);
  const settledRow = await getCallInteractionModel().findById(pre._id).lean();
  assert.deepEqual([settledRow?.call_log_state, settledRow?.projection_revision], ["settled", 2]);
  const settledAt = settledRow?.updatedAt as Date;
  assert.ok(settledAt.getTime() > preUpdatedAt.getTime(), "updatedAt moves so the sweep cursor sees the row");
  assert.ok(+settledAt >= +dbBefore && +settledAt <= +dbAfter, `updatedAt ${settledAt.toISOString()} is the database clock [${dbBefore.toISOString()}, ${dbAfter.toISOString()}]`);
  for (const untouched of [preInternal, late]) {
    const row = await getCallInteractionModel().findById(untouched._id).lean();
    assert.deepEqual([row?.call_log_state, row?.projection_revision], [null, 1], "Internal and post-CC-04 rows are untouched");
  }
  const audits = await getSalesIntelligenceAuditEventModel().find({ event_kind: "call_interactions_settled_pre_cc04" }).lean();
  assert.equal(audits.length, 1, "one audit row per batch");
  assert.deepEqual((audits[0]?.current as { ids?: string[] } | undefined)?.ids, [String(pre._id)], "the audit row holds the rollback id set");
  assert.equal(+(audits[0]?.happened_at as Date), +settledAt, "the audit row is dated with the database stamp, not the operator clock");

  // The minute sweep re-derives the settled row from its cursor (no wake, no job).
  const resweep = await sweepContactSources("call", settleSweepAt, { loader });
  assert.equal(resweep.skipped, false);
  assert.equal(resweep.caught_up, true);
  assert.equal((await Events.findById(preEventId).lean())?.goal_credit, "confirmed", "the settled row's event is confirmed");
  const settledDay = await Rows.findOne({ agent_id: alice, business_day: "2026-09-23" }).lean();
  assert.deepEqual(
    [settledDay?.actual_confirmed, settledDay?.actual_awaiting_confirmation, settledDay?.publication_revision],
    [1, 0, (preRow?.publication_revision ?? 0) + 1],
    "the rep-day moves awaiting → confirmed with one publication",
  );
  const again = await applySettle({ actor: csiOperatorActor("settle-pre-cc04-replica-2"), run_id: "settle-pre-cc04-replica-2" });
  assert.deepEqual([again.settled, again.batches], [0, 0], "a second apply matches 0");
  assert.equal(await getSalesIntelligenceAuditEventModel().countDocuments({ event_kind: "call_interactions_settled_pre_cc04" }), 1, "and audits nothing");

  // --- olr C1a: count scope from the configuration ------------------------------------------------
  // Through the real PATCH (Mongo transaction, command ledger) and loader: an entry on or before today
  // is refused with nothing written; a future entry commits; recounts then write each day's scope from
  // the schedule; the refresh pass rewrites a row an older build counted under another scope.
  const { getSalesOutreachConfigurationModel } = await import("../../src/models/salesOutreach/configuration.js");
  const { getSalesIntelligenceCommandExecutionModel } = await import("../../src/models/SalesIntelligenceCommandExecution.js");
  const { patchSalesOutreachConfiguration } = await import("../../src/services/salesOutreach/config/commands.js");
  const { createConfigurationLoader } = await import("../../src/services/salesOutreach/config/load.js");
  const { refreshOpenRepDays } = await import("../../src/services/salesOutreach/contacts/sweep.js");
  const { newYorkBusinessDay } = await import("../../src/services/salesOutreach/reads/businessDay.js");
  const { addDays } = await import("../../src/services/salesOutreach/engine/calendar.js");
  for (const Model of [getSalesOutreachConfigurationModel(), getSalesIntelligenceCommandExecutionModel()] as unknown as Array<mongoose.Model<unknown>>) {
    await Model.createCollection();
    await Model.createIndexes();
  }
  const owner = csiOperatorActor("sod-c1a-replica");
  const goalsValue = {
    controls: { desk_enabled: true, goal_metrics_enabled: true },
    goals: { roster_version: "r1", default_scheduled_goal: 100, zero_goal_rule: "no_goal_today_excluded_from_denominator", rep_work_schedules: [{ agent_id: String(alice), working_days: [1, 2, 3, 4, 5, 6, 7] }], effective_day_overrides: [] },
  };
  const withSchedule = (schedule: unknown) => ({ ...goalsValue, goals: { ...goalsValue.goals, count_scope_schedule: schedule } });
  await patchSalesOutreachConfiguration({ actor: owner, idempotency_key: "c1a-init", expected_revision: 0, value: goalsValue });
  const realToday = newYorkBusinessDay(new Date()); // the PATCH guard runs on the command's wall clock
  const flipDay = addDays(realToday, 2);
  await assert.rejects(
    patchSalesOutreachConfiguration({ actor: owner, idempotency_key: "c1a-today", expected_revision: 1, value: withSchedule([{ from_day: realToday, scope: "eligible_new_quoted" }]) }),
    (error: unknown) => {
      const issues = (error as { code?: string; issues?: Array<{ code: string }> }).issues ?? [];
      return (error as { code?: string }).code === "INVALID_INPUT" && issues.some((i) => i.code === "count_scope_not_prospective");
    },
  );
  const Configuration = getSalesOutreachConfigurationModel();
  assert.equal(await Configuration.countDocuments({ kind: "version" }), 1, "a refused PATCH writes no version");
  const flip = await patchSalesOutreachConfiguration({ actor: owner, idempotency_key: "c1a-flip", expected_revision: 1, value: withSchedule([{ from_day: flipDay, scope: "eligible_new_quoted" }]) });
  assert.equal(flip.response.revision, 2);
  const scheduled = await createConfigurationLoader().requireActive();
  assert.deepEqual(scheduled.value.goals.count_scope_schedule, [{ from_day: flipDay, scope: "eligible_new_quoted" }]);
  // Alice calls her Lead and a number with no subject on the day before the flip and on the flip day.
  const otherNumber = new mongoose.Types.ObjectId();
  const scopeCall = async (day: string, contact: mongoose.Types.ObjectId, session: string) => {
    const started = new Date(`${day}T15:00:00Z`);
    const row = await getCallInteractionModel().create({
      provider_account_id: account, telephony_session_id: session, identity_basis: "telephony_session_id", direction: "Outbound",
      contact_number_id: contact, external_endpoint_kind: "external", started_at: started, provider_connected: true, provider_result: "Call connected",
      parties: [{ role: "user", direction: "Outbound", extension_id: "101" }], legs: [{ extension_id: "101", direction: "Outbound", start_time: started, result: "Call connected" }],
      call_log_state: "settled", terminal: true, first_observed_at: started, last_observed_at: started,
    });
    return { source_kind: "call" as const, source_id: String(row._id) };
  };
  const beforeFlip = addDays(flipDay, -1);
  const scopeSources = [
    await scopeCall(beforeFlip, number, "s-c1a-1"), await scopeCall(beforeFlip, otherNumber, "s-c1a-2"),
    await scopeCall(flipDay, number, "s-c1a-3"), await scopeCall(flipDay, otherNumber, "s-c1a-4"),
  ];
  const scopeNow = new Date(`${addDays(flipDay, 1)}T16:00:00Z`);
  await withTransaction((session) => applyContactSources(scopeSources, { now: scopeNow, queueRepDays: false }, mongoContactEventStore, session));
  for (const day of [beforeFlip, flipDay])
    await withTransaction((session) => recountRepDay({ agent_id: String(alice), business_day: day }, scheduled, scopeNow, mongoRepDayStore, session));
  const dayBefore = await Rows.findOne({ agent_id: alice, business_day: beforeFlip }).lean();
  const dayOf = await Rows.findOne({ agent_id: alice, business_day: flipDay }).lean();
  assert.deepEqual([dayBefore?.count_scope, dayBefore?.actual_confirmed, dayBefore?.unattributed], ["all_outbound", 2, 1], "the day before the flip counts all outbound");
  assert.deepEqual([dayOf?.count_scope, dayOf?.actual_confirmed, dayOf?.unattributed], ["eligible_new_quoted", 1, 1], "the flip day counts eligible only");
  // The 2026-10-06 production case: a row an older build counted eligible-only while the configuration
  // has no schedule. The refresh (at `now`, business day 2026-10-05) rewrites it as all_outbound.
  const staleKey = { agent_id: alice, business_day: "2026-10-05" };
  const staleBefore = await Rows.findOne(staleKey).lean();
  await Rows.updateOne(staleKey, { $set: { count_scope: "eligible_new_quoted", input_fingerprint: "pre-c1a" } });
  const refreshAt = new Date(+settleSweepAt + 121_000);
  const refreshed = await refreshOpenRepDays(refreshAt, { loader: fixedConfigurationLoader(configuration) });
  assert.equal(refreshed.skipped, false);
  const corrected = await Rows.findOne(staleKey).lean();
  assert.equal(corrected?.count_scope, "all_outbound", "the refresh self-corrects the stored scope");
  assert.equal(corrected?.publication_revision, (staleBefore?.publication_revision ?? 0) + 1);
  await refreshOpenRepDays(refreshAt, { loader: fixedConfigurationLoader(configuration) });
  assert.equal((await Rows.findOne(staleKey).lean())?.publication_revision, corrected?.publication_revision, "a second refresh does not rewrite the corrected row");

  // --- olr C1b: both counts stored, the other scope served, recount-rep-days ---------------------------
  // The recounts above stored both scopes' counts through the strict model; GET /rep-days and GET /team
  // serve the other scope as `alternate_scope` / `outbound_calls.alternate`. A row written before C1b
  // (fields absent) reads null — never 0 — until `recount-rep-days` (dry run writes nothing; apply writes
  // it; a second run is unchanged). `--materialize-roster` writes a frozen zero row for a roster rep
  // without a row on a past day.
  assert.deepEqual(
    [dayBefore?.actual_confirmed_all, dayBefore?.actual_confirmed_eligible, dayBefore?.actual_awaiting_all, dayBefore?.actual_awaiting_eligible],
    [2, 1, 0, 0],
    "C1b: the day before the flip stores both scopes",
  );
  assert.deepEqual([dayOf?.actual_confirmed, dayOf?.actual_confirmed_all, dayOf?.actual_confirmed_eligible], [1, 2, 1], "C1b: the headline is the row's scope, both counts stored");
  const { readRepDays: c1bReadRepDays, readTeam: c1bReadTeam } = await import("../../src/services/salesOutreach/reads/service.js");
  const c1bOwner = { role: "owner" as const, actor: { kind: "owner" as const, id: "owner-c1b", request_id: "r-c1b", run_id: null }, agent_id: null };
  const c1bDeps = { loader: fixedConfigurationLoader(scheduled), now: scopeNow };
  const c1bRep = async (day: string) => (await c1bReadRepDays(c1bOwner, { business_day: day }, c1bDeps)).reps!.find((rep) => rep.agent_id === String(alice))!;
  assert.deepEqual((await c1bRep(flipDay)).alternate_scope, { count_scope: "all_outbound", count_scope_label: "Outbound calls", actual_confirmed: 2, actual_awaiting_confirmation: 0 });
  assert.deepEqual((await c1bRep(beforeFlip)).alternate_scope?.actual_confirmed, 1, "the day before the flip: eligible-only is the secondary figure");
  const c1bTeam = await c1bReadTeam(c1bOwner, { business_day: flipDay }, c1bDeps);
  assert.deepEqual([c1bTeam.goals?.outbound_calls.actual, c1bTeam.goals?.outbound_calls.alternate], [1, { count_scope: "all_outbound", actual: 2 }], "C1b: /team serves the alternate total");
  // A row written before C1b: the four fields absent.
  const preC1b = { agent_id: alice, business_day: beforeFlip };
  await Rows.collection.updateOne(preC1b, {
    $unset: { actual_confirmed_all: 1, actual_confirmed_eligible: 1, actual_awaiting_all: 1, actual_awaiting_eligible: 1 },
    $set: { input_fingerprint: "pre-c1b" },
  });
  assert.equal((await c1bRep(beforeFlip)).alternate_scope, null, "a pre-C1b row serves alternate_scope null, never 0");
  assert.equal((await c1bReadTeam(c1bOwner, { business_day: beforeFlip }, c1bDeps)).goals?.outbound_calls.alternate?.actual, null);
  const { dryRunRepDayStore, planRecountKeys, readRowsInRange, runRecount, summarizeRecount } = await import("../lib/sales-outreach-recount-rep-days.js");
  const c1bZero = new mongoose.Types.ObjectId();
  const c1bConfig = activeInspection(
    {
      controls: { desk_enabled: true, goal_metrics_enabled: true },
      goals: {
        roster_version: "r1", default_scheduled_goal: 100, zero_goal_rule: "no_goal_today_excluded_from_denominator", effective_day_overrides: [],
        rep_work_schedules: [String(alice), String(c1bZero)].map((agent_id) => ({ agent_id, working_days: [1, 2, 3, 4, 5, 6, 7] })),
        count_scope_schedule: [{ from_day: flipDay, scope: "eligible_new_quoted" }],
      },
    },
    "v-c1b",
    11,
  );
  assert.equal(c1bConfig.state, "active");
  if (c1bConfig.state !== "active") return;
  const c1bToday = newYorkBusinessDay(scopeNow);
  const c1bRun = async (apply: boolean) => {
    const rows = await readRowsInRange(beforeFlip, flipDay);
    const keys = planRecountKeys({ rows, roster: [String(alice), String(c1bZero)], from: beforeFlip, to: flipDay, today: c1bToday, materialize_roster: true });
    return summarizeRecount(rows, await runRecount({ keys, loader: fixedConfigurationLoader(c1bConfig), now: scopeNow, store: apply ? mongoRepDayStore : dryRunRepDayStore(mongoRepDayStore), transaction: withTransaction, publishGoal: async () => undefined }));
  };
  const c1bDry = await c1bRun(false);
  assert.deepEqual([c1bDry.keys, c1bDry.materialize_keys, c1bDry.outcomes, c1bDry.both_counts_added, c1bDry.rows_created], [4, 2, { written: 3, unchanged: 1, no_activity: 0, failed: 0 }, 1, 2], JSON.stringify(c1bDry));
  assert.equal((await Rows.findOne(preC1b).lean())?.actual_confirmed_all, undefined, "the dry run writes nothing");
  assert.equal(await Rows.countDocuments({ agent_id: c1bZero }), 0);
  const c1bApplied = await c1bRun(true);
  assert.deepEqual([c1bApplied.outcomes.written, c1bApplied.outcomes.failed], [3, 0]);
  const restored = await Rows.findOne(preC1b).lean();
  assert.deepEqual([restored?.actual_confirmed_all, restored?.actual_confirmed_eligible, restored?.count_scope], [2, 1, "all_outbound"], "apply restores both counts");
  const zeroes = await Rows.find({ agent_id: c1bZero }).lean();
  assert.deepEqual(zeroes.map((z) => [z.business_day, z.actual_confirmed_all, z.goal_snapshot?.configuration_version]).sort(), [[beforeFlip, 0, "v-c1b"], [flipDay, 0, "v-c1b"]], "materialized frozen zero rows");
  assert.equal((await c1bRep(beforeFlip)).alternate_scope?.actual_confirmed, 1);
  const c1bAgain = await c1bRun(false);
  assert.deepEqual(c1bAgain.outcomes, { written: 0, unchanged: 4, no_activity: 0, failed: 0 }, "a second run is unchanged for every key");

  // --- olr C4: a subject created after its first call re-derives that call ---------------------------
  // The call is derived while its Lead is no subject (`none`); intake then admits the Lead with an
  // activation boundary before the call. The admission's transaction nominates the call's
  // `outreach_contact_change` job (`admit:<subject>`); draining it associates and credits the call and
  // nominates the subject's evaluation. The wake covers the activation's New York date: an earlier
  // same-date call re-derives as `none` carrying the subject (P05f/P10a input), a call the day before is
  // not woken; a replay dedupes.
  const { syncSubject, loadSubjectPageContext } = await import("../../src/services/salesOutreach/subjects/sync.js");
  const { mongoDeskSubjectStore } = await import("../../src/services/salesOutreach/subjects/store.js");
  const { accepted, deskConfiguration, leadFacts } = await import("../../src/services/salesOutreach/subjects/testing.js");
  const { runOutreachContactChangeJob } = await import("../../src/services/salesOutreach/contacts/jobs.js");
  const c4Lead = new mongoose.Types.ObjectId();
  const c4Number = new mongoose.Types.ObjectId();
  const c4Arrival = new Date("2026-10-04T14:00:00Z");
  const c4NumberFor = async (numberId: mongoose.Types.ObjectId, e164: string, lead: mongoose.Types.ObjectId, receivedAt: Date) =>
    getContactNumberModel().create({ _id: numberId, e164, digits_reversed: e164.slice(1).split("").reverse().join(""), first_observed_at: receivedAt, last_activity_at: receivedAt,
      lead: { model: "FormLead", id: lead, received_at: receivedAt, state: "open" }, lead_link: { source: "automatic", set_at: receivedAt } });
  await c4NumberFor(c4Number, "+15550100044", c4Lead, c4Arrival);
  const c4Call = async (at: string, session: string, numberId = c4Number) => {
    const started = new Date(at);
    const row = await getCallInteractionModel().create({
      provider_account_id: account, telephony_session_id: session, identity_basis: "telephony_session_id", direction: "Outbound",
      contact_number_id: numberId, external_endpoint_kind: "external", started_at: started, provider_connected: true, provider_result: "Call connected",
      parties: [{ role: "user", direction: "Outbound", extension_id: "101" }], legs: [{ extension_id: "101", direction: "Outbound", start_time: started, result: "Call connected" }],
      call_log_state: "settled", terminal: true, first_observed_at: started, last_observed_at: started,
    });
    return { source_kind: "call" as const, source_id: String(row._id) };
  };
  const prevDayCall = await c4Call("2026-10-03T20:00:00Z", "s-c4-prev-day");
  const earlyCall = await c4Call("2026-10-04T13:00:00Z", "s-c4-early"); // 09:00 ET, before arrival, same date
  const gapCall = await c4Call("2026-10-04T14:00:30Z", "s-c4-gap");
  const c4Now = new Date("2026-10-04T14:01:30Z");
  await withTransaction((session) => applyContactSources([prevDayCall, earlyCall, gapCall], { now: c4Now, queueRepDays: false }, mongoContactEventStore, session));
  const gapEventId = contactEventId("call", gapCall.source_id);
  assert.deepEqual([(await Events.findById(gapEventId).lean())?.association, (await Events.findById(gapEventId).lean())?.subject_id ?? null], ["none", null], "derived before the admission: no subject");
  // ET wall clock 10:00 on 2026-10-04 (= 14:00Z): the Lead arrives at 14:00Z and intake activates at arrival.
  const c4Facts = leadFacts({ model: "FormLead", id: String(c4Lead), timestamp: new Date("2026-10-04T10:00:00.000Z"), created_at: new Date("2026-10-04T14:00:05Z") });
  const c4Config = deskConfiguration({ controls: { desk_enabled: true } });
  const admitted = await withTransaction(async (session) => {
    const context = await loadSubjectPageContext(mongoDeskSubjectStore, [c4Facts], c4Now, session);
    return syncSubject(
      { facts: c4Facts, subject: null, enrollment: { cohort_id: "intake:c4", kind: "intake", enrolled_at: c4Now, activation_at: c4Arrival, manifest_hash: null }, configuration: c4Config, context },
      mongoDeskSubjectStore,
      session,
    );
  });
  assert.deepEqual([admitted.outcome, admitted.contact_wakes], ["created", 2], "the activation date's two calls are woken");
  const Jobs = getSalesIntelligenceJobModel();
  const wakeKey = `sod:contact_change:call:${gapCall.source_id}:admit:${admitted.subject_id}`;
  const wakeJob = await Jobs.findOne({ dedupe_key: wakeKey }).lean();
  assert.ok(wakeJob, "the admission's transaction enqueued the re-derive");
  assert.equal(wakeJob?.subject_key, `call:${gapCall.source_id}`);
  const earlyJob = await Jobs.findOne({ dedupe_key: `sod:contact_change:call:${earlyCall.source_id}:admit:${admitted.subject_id}` }).lean();
  assert.ok(earlyJob, "an earlier same-date call is woken");
  assert.equal(await Jobs.countDocuments({ dedupe_key: { $regex: `^sod:contact_change:call:${prevDayCall.source_id}:` } }), 0, "a call the day before is not woken");
  const replayed = await withTransaction((session) =>
    mongoDeskSubjectStore.nominateContactSources({ lead: { model: "FormLead", id: String(c4Lead) }, since: c4Arrival, source_revision: `admit:${admitted.subject_id}`, limit_per_kind: 50, now: c4Now }, session));
  assert.equal(replayed, 1);
  assert.equal(await Jobs.countDocuments({ dedupe_key: wakeKey }), 1, "a replay dedupes on the job identity");
  const drainC4 = (jobId: unknown, now: Date) =>
    runOutreachContactChangeJob(String(jobId), { loader: fixedConfigurationLoader(configuration), now: () => now, publish: async () => undefined });
  assert.equal((await drainC4(wakeJob!._id, c4Now)).status, "completed");
  assert.equal((await drainC4(earlyJob!._id, c4Now)).status, "completed");
  const gapEvent = await Events.findById(gapEventId).lean();
  assert.deepEqual(
    [gapEvent?.association, String(gapEvent?.subject_id), gapEvent?.subject_workflow, gapEvent?.goal_scope_eligible, gapEvent?.goal_credit],
    ["unique", admitted.subject_id, "new", true, "confirmed"],
    "the re-derive associates and credits the call",
  );
  const earlyEvent = await Events.findById(contactEventId("call", earlyCall.source_id)).lean();
  assert.deepEqual(
    [earlyEvent?.association, String(earlyEvent?.subject_id), earlyEvent?.subject_workflow ?? null, earlyEvent?.goal_scope_eligible, earlyEvent?.verification],
    ["none", admitted.subject_id, null, false, "confirmed"],
    "an earlier same-date call stays uncredited but carries the subject",
  );
  assert.equal((await Events.findById(contactEventId("call", prevDayCall.source_id)).lean())?.subject_id ?? null, null, "the day before carries nothing");
  assert.equal(await Jobs.countDocuments({ stage: "outreach_evaluate", dedupe_key: { $regex: `^sod:evaluate:${admitted.subject_id}:r1:contacts:` } }), 2, "and each drained re-derive nominates the subject's evaluation");

  // --- olr C4: P05f/P10a — a late-enrolled Lead's earlier same-date calls lower its activation-date quota ---
  // Two older Leads (received 2026-10-01) enter one cohort at 15:00 ET on 2026-10-05. Lead A was called
  // at 10:00 and 11:00 ET that day (derived `none`: not enrolled yet); Lead B was not called. After the
  // enrollment's wake drains, the evaluator (Mongo stores) owes A 0 calls on the activation date and B 2.
  const { mongoEvaluationStore } = await import("../../src/services/salesOutreach/evaluation/store.js");
  const { evaluateAndProject, evaluationAdmissionOf } = await import("../../src/services/salesOutreach/evaluation/evaluateJob.js");
  const { completeConfigurationInput } = await import("../../src/services/salesOutreach/evaluation/testing.js");
  const cohortActivation = new Date("2026-10-05T19:00:00Z");
  const cohortNow = new Date("2026-10-05T19:01:00Z");
  const cohortReceived = new Date("2026-10-01T14:00:00Z");
  const leadA = new mongoose.Types.ObjectId();
  const leadB = new mongoose.Types.ObjectId();
  const numberA = new mongoose.Types.ObjectId();
  const numberB = new mongoose.Types.ObjectId();
  await c4NumberFor(numberA, "+15550100045", leadA, cohortReceived);
  await c4NumberFor(numberB, "+15550100046", leadB, cohortReceived);
  const priorCalls = [await c4Call("2026-10-05T14:00:00Z", "s-c4-a-1", numberA), await c4Call("2026-10-05T15:00:00Z", "s-c4-a-2", numberA)];
  await withTransaction((session) => applyContactSources(priorCalls, { now: cohortNow, queueRepDays: false }, mongoContactEventStore, session));
  const cohortFacts = [leadA, leadB].map((id) =>
    leadFacts({ model: "FormLead", id: String(id), timestamp: new Date("2026-10-01T10:00:00.000Z"), created_at: new Date("2026-10-01T14:00:05Z"), ...accepted("0", "2026-10-02T14:00:00Z") }));
  const enrolled = await withTransaction(async (session) => {
    const context = await loadSubjectPageContext(mongoDeskSubjectStore, cohortFacts, cohortNow, session);
    const out = [];
    for (const facts of cohortFacts)
      out.push(await syncSubject(
        { facts, subject: null, enrollment: { cohort_id: "expansion:c4", kind: "expansion", enrolled_at: cohortNow, activation_at: cohortActivation, manifest_hash: null }, configuration: c4Config, context },
        mongoDeskSubjectStore,
        session,
      ));
    return out;
  });
  assert.deepEqual(enrolled.map((r) => [r.outcome, r.contact_wakes]), [["created", 2], ["created", 0]], "the cohort wakes Lead A's two same-date calls");
  for (const call of priorCalls) {
    const job = await Jobs.findOne({ dedupe_key: `sod:contact_change:call:${call.source_id}:admit:${enrolled[0]!.subject_id}` }).lean();
    assert.equal((await drainC4(job!._id, cohortNow)).status, "completed");
  }
  const carried = await mongoEvaluationStore.loadContactEvents(enrolled[0]!.subject_id, null);
  assert.deepEqual(carried.map((e) => [e.kind, e.verification]), [["outbound_attempt", "confirmed"], ["outbound_attempt", "confirmed"]], "the evaluator reads both earlier calls");
  const admission = evaluationAdmissionOf(activeInspection(completeConfigurationInput({ cadence_enforcement_enabled: true }), "v-c4", 2));
  assert.ok(admission.ok);
  for (const result of enrolled)
    await withTransaction((session) => evaluateAndProject(result.subject_id, admission.context, cohortNow, mongoEvaluationStore, session));
  const required = async (subjectId: string) =>
    ((await models.getSalesOutreachProjectionModel().findOne({ subject_id: new mongoose.Types.ObjectId(subjectId) }).lean()) as { call?: { required?: number } } | null)?.call?.required;
  assert.deepEqual([await required(enrolled[0]!.subject_id), await required(enrolled[1]!.subject_id)], [0, 2], "two earlier same-date calls lower the activation date's quota by two");

  // --- olr C5: zero-activity days freeze their goal snapshot -----------------------------------------
  // After New York midnight the refresh writes a zero row (frozen snapshot) for each roster rep without a
  // row yesterday, through the strict model and `sod_rep_day_unique`; never today, never off the roster.
  // Two refreshes racing on the same day converge on one row per rep (the loser's insert fails on the
  // unique index and the next pass sees the row); a later pass writes nothing.
  const c5Bob = new mongoose.Types.ObjectId();
  const stranger = new mongoose.Types.ObjectId();
  const c5Config = activeInspection(
    {
      controls: { desk_enabled: true, goal_metrics_enabled: true },
      goals: {
        roster_version: "r-c5", default_scheduled_goal: 100, zero_goal_rule: "no_goal_today_excluded_from_denominator",
        rep_work_schedules: [String(alice), String(c5Bob)].map((agent_id) => ({ agent_id, working_days: [1, 2, 3, 4, 5, 6, 7] })), effective_day_overrides: [],
      },
    },
    "v-c5",
    9,
  );
  const c5Rows = (day: string) => Rows.find({ business_day: day }).lean();
  // 2026-11-02 00:30 New York (EST after the DST change): yesterday = 2026-11-01, nobody has a row.
  const c5Midnight = new Date("2026-11-02T05:30:00Z");
  assert.equal((await c5Rows("2026-11-01")).length, 0);
  const c5First = await refreshOpenRepDays(c5Midnight, { loader: fixedConfigurationLoader(c5Config) });
  assert.deepEqual([c5First.skipped, c5First.recounted, c5First.failures], [false, 2, 0]);
  const zeroRows = await c5Rows("2026-11-01");
  assert.deepEqual(zeroRows.map((r) => String(r.agent_id)).sort(), [String(alice), String(c5Bob)].sort(), "one zero row per roster rep");
  for (const zero of zeroRows) {
    assert.deepEqual([zero.actual_confirmed, zero.actual_awaiting_confirmation, zero.unattributed, zero.count_scope, zero.publication_revision], [0, 0, 0, "all_outbound", 1]);
    assert.deepEqual([zero.goal_snapshot?.configuration_version, zero.goal_snapshot?.goal], ["v-c5", 100], "the goal snapshot is frozen");
  }
  assert.equal(await Rows.countDocuments({ agent_id: stranger }), 0, "off the roster: nothing");
  assert.equal((await c5Rows("2026-11-02")).length, 0, "never today");
  await refreshOpenRepDays(c5Midnight, { loader: fixedConfigurationLoader(c5Config) });
  assert.deepEqual((await c5Rows("2026-11-01")).map((r) => r.publication_revision), [1, 1], "a second refresh rewrites nothing");
  // Racing refreshes on the next day: one row per rep.
  const c5Next = new Date("2026-11-03T05:30:00Z");
  const raced = await Promise.all([1, 2].map(() => refreshOpenRepDays(c5Next, { loader: fixedConfigurationLoader(c5Config) })));
  const racedRows = await c5Rows("2026-11-02");
  assert.equal(racedRows.length, 2, "sod_rep_day_unique: one row per rep under racing refreshes");
  assert.ok(raced.reduce((sum, r) => sum + r.failures, 0) <= 2, "a racing loser fails only its own key");
  await refreshOpenRepDays(c5Next, { loader: fixedConfigurationLoader(c5Config) });
  assert.equal(await Rows.countDocuments({ business_day: "2026-11-02" }), 2);
  assert.ok((await c5Rows("2026-11-02")).every((r) => r.goal_snapshot?.configuration_version === "v-c5"));

  // --- olr C2a/C2b: a Call Lead older than every call gets its Contact Number ------------------------
  // A Call Lead received before capture began has no number, so its subject enrolls with
  // `contact_number_ids: []`. The read-only diagnostic names it `no_contact_number`; the mint script's dry
  // run writes nothing; its apply mints the number (`created_via: call_lead`, audited), links it and, in
  // the same transaction, nominates the subject's `outreach_lead_change`; draining that job gives the
  // subject the number and the diagnostic no longer lists it. A rerun writes nothing.
  const { readOnlyDeskStateReader } = await import("../lib/sales-outreach-desk-state.js");
  const { collectSubjectsWithoutNumbers } = await import("../lib/sales-outreach-subjects-without-numbers.js");
  const { runMintLeadNumbers } = await import("../numbers-v2/mint-lead-numbers.js");
  const { getCallLeadModel } = await import("../../src/models/CallLead.js");
  const { runOutreachLeadChangeJob } = await import("../../src/services/salesOutreach/subjects/leadChangeJob.js");
  await getCallLeadModel().createCollection();
  const c2Lead = new mongoose.Types.ObjectId();
  const c2Received = new Date("2026-07-27T15:00:00Z");
  await getCallLeadModel().collection.insertOne({ _id: c2Lead, name: "C2 Caller", timestamp: c2Received, createdAt: c2Received, domain_revision: 1,
    phone_number: "(555) 010-0088", normalized_phone_number: "5550100088", ringcentral: { telephony_session_id: "s-c2-before-capture" } });
  const c2Now = new Date();
  const c2Subject = await withTransaction(async (session) => {
    const [facts] = await mongoDeskSubjectStore.loadLeads([{ model: "CallLead", id: String(c2Lead) }], session);
    const context = await loadSubjectPageContext(mongoDeskSubjectStore, [facts!], c2Now, session);
    return syncSubject({ facts: { ...facts!, ...accepted("0", "2026-07-28T14:00:00Z") }, subject: null,
      enrollment: { cohort_id: "expansion:c2", kind: "expansion", enrolled_at: c2Now, activation_at: c2Now, manifest_hash: null }, configuration: c4Config, context },
    mongoDeskSubjectStore, session);
  });
  assert.equal(c2Subject.outcome, "created");
  const Subjects = models.getSalesOutreachSubjectModel();
  assert.deepEqual((await Subjects.findById(c2Subject.subject_id).lean())?.contact_number_ids, [], "enrolled with no number");
  const diagnose = () => collectSubjectsWithoutNumbers(readOnlyDeskStateReader(mongoose.connection.db!), { database, now: new Date(), account: null });
  const c2Before = await diagnose();
  const c2Row = c2Before.rows.find((row) => row.subject_id === c2Subject.subject_id);
  assert.deepEqual([c2Row?.reason, c2Row?.lead_model, c2Row?.e164_masked, c2Row?.received_at], ["no_contact_number", "CallLead", "…0088", c2Received.toISOString()]);
  const quiet = () => undefined;
  const mintDry = await runMintLeadNumbers([`--target=${database}`], quiet);
  assert.equal(mintDry.mode, "dry_run");
  assert.ok((mintDry.numbers_to_create as number) >= 1 && (mintDry.to_mint_by_model as { CallLead: number }).CallLead === 1, JSON.stringify(mintDry));
  assert.equal(await getContactNumberModel().countDocuments({ e164: "+15550100088" }), 0, "the dry run writes nothing");
  const mintApplied = await runMintLeadNumbers([`--target=${database}`, "--apply"], quiet) as { applied: { numbers_created: number; links_changed: number;
    desk_subjects_nominated: number; failures: Record<string, number> }; after: { numbers_to_create: number }; desk_wants_contact_evidence: boolean };
  assert.deepEqual(mintApplied.applied.failures, {});
  assert.ok(mintApplied.applied.numbers_created >= 1 && mintApplied.applied.links_changed >= 1);
  assert.equal(mintApplied.after.numbers_to_create, 0, "nothing left to mint");
  assert.equal(mintApplied.desk_wants_contact_evidence, true);
  assert.ok(mintApplied.applied.desk_subjects_nominated >= 1);
  const c2Number = await getContactNumberModel().findOne({ e164: "+15550100088" }).lean();
  assert.deepEqual([c2Number?.created_via, String(c2Number?.lead?.id), c2Number?.lead?.model, c2Number?.lead_link?.source, c2Number?.calls?.inbound, c2Number?.calls?.outbound],
    ["call_lead", String(c2Lead), "CallLead", "automatic", 0, 0], "minted, linked to the Call Lead, zero calls");
  assert.equal(await getSalesIntelligenceAuditEventModel().countDocuments({ event_kind: "contact_number_created_from_lead", subject_key: `number:${String(c2Number!._id)}` }), 1);
  const c2Job = await Jobs.findOne({ stage: "outreach_lead_change", dedupe_key: `sod:lead-change:CallLead:${String(c2Lead)}:link:${String(c2Number!._id)}:r${c2Number!.revision}` }).lean();
  assert.ok(c2Job, "the link write nominated the subject's lead change in the same transaction");
  assert.equal((await runOutreachLeadChangeJob(String(c2Job!._id))).status, "completed");
  assert.deepEqual(((await Subjects.findById(c2Subject.subject_id).lean())?.contact_number_ids ?? []).map(String), [String(c2Number!._id)], "the subject holds its number");
  const c2After = await diagnose();
  assert.ok(!c2After.rows.some((row) => row.subject_id === c2Subject.subject_id), "the diagnostic no longer lists it");
  assert.ok(c2Before.without_numbers.by_reason.no_contact_number >= 1);
  assert.equal(c2After.without_numbers.by_reason.no_contact_number, 0, "plan §2 C2 acceptance: no subject's phone lacks a Contact Number");
  const mintAgain = await runMintLeadNumbers([`--target=${database}`, "--apply"], quiet) as { applied: { numbers_created: number; links_changed: number } };
  assert.deepEqual([mintAgain.applied.numbers_created, mintAgain.applied.links_changed], [0, 0], "a rerun writes nothing");

  // --- olr C0: rep-day coverage from goal coverage (D-A3) -------------------------------------------
  // A stuck provisional Call Log row holds both capped watermarks 50 min back; the observed ones are 17–18
  // min behind. The recount reads both scopes inside its transaction (`loadCallWatermarks`) and the
  // GET /rep-days read assembles the same marks from its own rows: today is complete through as_of − 20
  // (required as_of − 25), so a zero-call roster rep reads 0 / `no_activity_recorded`, not Pending.
  // Without the observed values (a pre-A3 row) the same day is partial and the rep reads Pending.
  const { readRepDays } = await import("../../src/services/salesOutreach/reads/service.js");
  const c0Now = new Date("2026-12-01T19:00:00Z"); // 14:00 New York (EST)
  const c0Min = (m: number) => new Date(c0Now.getTime() + m * 60_000);
  const c0Zero = new mongoose.Types.ObjectId();
  const c0Config = activeInspection(
    {
      controls: { desk_enabled: true, goal_metrics_enabled: true },
      goals: {
        roster_version: "r-c0", default_scheduled_goal: 100, zero_goal_rule: "no_goal_today_excluded_from_denominator",
        rep_work_schedules: [{ agent_id: String(c0Zero), working_days: [1, 2, 3, 4, 5, 6, 7] }], effective_day_overrides: [],
      },
    },
    "v-c0",
    10,
  );
  assert.equal(c0Config.state, "active");
  if (c0Config.state !== "active") return;
  const setMarks = async (known: Date, observed: { capture: Date; derived: Date } | null) => {
    for (const [scope, value] of [[CALL_LOG_ALL_DIRECTIONS_SCOPE, observed?.capture], ["outreach_contact_calls", observed?.derived]] as const)
      await SyncState.updateOne({ scope }, observed ? { $set: { known_complete_through: known, observed_complete_through: value } } : { $set: { known_complete_through: known }, $unset: { observed_complete_through: 1 } });
  };
  await setMarks(c0Min(-50), { capture: c0Min(-18), derived: c0Min(-17) });
  const c0Key = { agent_id: String(c0Zero), business_day: "2026-12-01" };
  const c0Recount = await withTransaction((session) => recountRepDay(c0Key, c0Config, c0Now, mongoRepDayStore, session));
  assert.equal(c0Recount.outcome, "no_activity", "a zero-call rep still gets no row today");
  assert.deepEqual(
    [c0Recount.fields.coverage.state, c0Recount.fields.coverage.known_complete_through, c0Recount.fields.coverage.required_through],
    ["complete", c0Min(-20).toISOString(), c0Min(-25).toISOString()],
    "C0: goal coverage = min(observed capture − 2 min, observed derivation) against as_of − 25 min",
  );
  const c0Owner = { role: "owner" as const, actor: { kind: "owner" as const, id: "owner-c0", request_id: "r-c0", run_id: null }, agent_id: null };
  const c0Read = async () => (await readRepDays(c0Owner, { business_day: "2026-12-01" }, { loader: fixedConfigurationLoader(c0Config), now: c0Now })).reps!.find((rep) => rep.agent_id === String(c0Zero))!;
  const c0Served = await c0Read();
  assert.deepEqual(
    [c0Served.actual_confirmed, c0Served.actual_basis, c0Served.coverage.state, c0Served.coverage.required_through, c0Served.unknown_reason],
    [0, "no_activity_recorded", "complete", c0Min(-25).toISOString(), null],
    "C0 acceptance: a zero-call rep reads 0, not Pending",
  );
  await setMarks(c0Min(-50), null);
  const c0Capped = await c0Read();
  assert.deepEqual([c0Capped.actual_confirmed, c0Capped.actual_basis, c0Capped.coverage.state], [null, "pending", "partial"], "capped watermarks alone stay Pending");
  const c0CappedRecount = await withTransaction((session) => recountRepDay(c0Key, c0Config, c0Now, mongoRepDayStore, session));
  assert.equal(c0CappedRecount.fields.coverage.state, "partial");

  // --- olr C8: association_reason on every event, the Other outbound breakdown, rederive-contact-events ---
  // Alice calls her eligible Lead, a Lead that is not enrolled and a number with no Lead. The events store
  // their reasons through the strict model; made to look pre-C8 (reason absent, another fingerprint) the
  // rep-day breakdown reads all `unknown`. The re-derive dry run writes nothing and predicts the change;
  // apply rewrites each event once (fingerprint moves), nominates the eligible subject's evaluation,
  // recounts the dirty rep-day to the real breakdown; GET /rep-days and GET /team serve it; a second run
  // changes nothing.
  const { dryRunContactEventStore, mongoRederiveSourcePager, recountDirtyRepDays, rederivePages, resolveRederiveRange } = await import("../lib/sales-outreach-rederive-contact-events.js");
  const c8Day = "2026-12-15";
  const c8Now = new Date("2026-12-16T16:00:00Z");
  const c8NotEnrolled = new mongoose.Types.ObjectId();
  await getContactNumberModel().create({ _id: c8NotEnrolled, e164: "+15550100081", digits_reversed: "18001005551", first_observed_at: activation, last_activity_at: activation,
    lead: { model: "FormLead", id: new mongoose.Types.ObjectId(), received_at: activation, state: "open" }, lead_link: { source: "automatic", set_at: activation } });
  const c8Call = async (contact: mongoose.Types.ObjectId, minute: number) => {
    const started = new Date(`${c8Day}T15:${String(minute).padStart(2, "0")}:00Z`);
    const row = await getCallInteractionModel().create({
      provider_account_id: account, telephony_session_id: `s-c8-${minute}`, identity_basis: "telephony_session_id", direction: "Outbound",
      contact_number_id: contact, external_endpoint_kind: "external", started_at: started, provider_connected: true, provider_result: "Call connected",
      parties: [{ role: "user", direction: "Outbound", extension_id: "101" }], legs: [{ extension_id: "101", direction: "Outbound", start_time: started, result: "Call connected" }],
      call_log_state: "settled", terminal: true, first_observed_at: started, last_observed_at: started,
    });
    return { source_kind: "call" as const, source_id: String(row._id) };
  };
  const c8Sources = [await c8Call(number, 0), await c8Call(c8NotEnrolled, 10), await c8Call(new mongoose.Types.ObjectId(), 20)];
  const c8Ids = c8Sources.map((s) => new mongoose.Types.ObjectId(contactEventId("call", s.source_id)));
  await withTransaction((session) => applyContactSources(c8Sources, { now: c8Now, queueRepDays: false }, mongoContactEventStore, session));
  const c8Reasons = async () => (await Events.find({ _id: { $in: c8Ids } }, { association_reason: 1 }).sort({ event_at: 1 }).lean()).map((e) => (e as { association_reason?: string | null }).association_reason);
  assert.deepEqual(await c8Reasons(), ["eligible", "lead_not_enrolled", "no_lead"], "C8: the reason is stored through the strict model");
  // As a pre-C8 build wrote them.
  await Events.collection.updateMany({ _id: { $in: c8Ids } }, { $unset: { association_reason: 1 }, $set: { input_fingerprint: "pre-c8" } });
  const c8Key = { agent_id: String(alice), business_day: c8Day };
  await withTransaction((session) => recountRepDay(c8Key, configuration, c8Now, mongoRepDayStore, session));
  const c8Before = await Rows.findOne({ agent_id: alice, business_day: c8Day }).lean();
  assert.deepEqual(c8Before?.other_outbound, { no_lead: 0, lead_not_enrolled: 0, lead_closed: 0, before_activation: 0, ambiguous: 0, not_new_quoted: 0, unknown: 2 }, "pre-C8 events read unknown");
  const c8From = resolveRederiveRange({ from: c8Day, today: "2026-12-16" }).from_instant;
  const c8Pass = (apply: boolean) =>
    rederivePages({ kinds: ["call", "sms"], from: c8From, now: c8Now, pager: mongoRederiveSourcePager, store: apply ? mongoContactEventStore : dryRunContactEventStore(mongoContactEventStore), transaction: withTransaction });
  const c8Evaluations = () => getSalesIntelligenceJobModel().countDocuments({ stage: "outreach_evaluate" });
  const evaluationsBefore = await c8Evaluations();
  const c8Dry = await c8Pass(false);
  assert.deepEqual([c8Dry.sources, c8Dry.changed, c8Dry.pages_failed], [{ call: 3, sms: 0 }, 3, 0], JSON.stringify(c8Dry));
  assert.deepEqual([c8Dry.changed_by_reason.eligible, c8Dry.changed_by_reason.lead_not_enrolled, c8Dry.changed_by_reason.no_lead], [1, 1, 1]);
  assert.deepEqual(c8Dry.other_outbound_by_day[c8Day], { no_lead: 1, lead_not_enrolled: 1, lead_closed: 0, before_activation: 0, ambiguous: 0, not_new_quoted: 0, unknown: 0 });
  assert.deepEqual(await c8Reasons(), [undefined, undefined, undefined], "the dry run writes nothing");
  assert.equal(await c8Evaluations(), evaluationsBefore, "and enqueues nothing");
  const c8Applied = await c8Pass(true);
  assert.deepEqual([c8Applied.changed, c8Applied.evaluations, c8Applied.dirty_rep_days], [3, 1, [c8Key]]);
  assert.deepEqual(await c8Reasons(), ["eligible", "lead_not_enrolled", "no_lead"]);
  assert.equal(await c8Evaluations(), evaluationsBefore + 1, "the eligible subject's evaluation is nominated in the page's transaction");
  const c8Recount = await recountDirtyRepDays({ keys: c8Applied.dirty_rep_days, loader: fixedConfigurationLoader(configuration), now: c8Now, store: mongoRepDayStore, transaction: withTransaction, publishGoal: async () => undefined });
  assert.deepEqual(c8Recount.outcomes, { written: 1, unchanged: 0, no_activity: 0, failed: 0 });
  const c8After = await Rows.findOne({ agent_id: alice, business_day: c8Day }).lean();
  assert.deepEqual(c8After?.other_outbound, { no_lead: 1, lead_not_enrolled: 1, lead_closed: 0, before_activation: 0, ambiguous: 0, not_new_quoted: 0, unknown: 0 });
  assert.deepEqual([c8After?.unattributed, c8After?.publication_revision], [2, (c8Before?.publication_revision ?? 0) + 1]);
  const c8Again = await c8Pass(true);
  assert.deepEqual([c8Again.derived, c8Again.changed, c8Again.evaluations], [3, 0, 0], "a second run changes nothing (the fingerprint moved once)");
  const { readTeam: c8ReadTeam } = await import("../../src/services/salesOutreach/reads/service.js");
  const c8Owner = { role: "owner" as const, actor: { kind: "owner" as const, id: "owner-c8", request_id: "r-c8", run_id: null }, agent_id: null };
  const c8Deps = { loader: fixedConfigurationLoader(configuration), now: c8Now };
  const c8Rep = (await readRepDays(c8Owner, { business_day: c8Day }, c8Deps)).reps!.find((rep) => rep.agent_id === String(alice))!;
  assert.deepEqual(c8Rep.other_outbound, { count: 2, label: "Other outbound", breakdown: { no_lead: 1, lead_not_enrolled: 1, lead_closed: 0, before_activation: 0, ambiguous: 0, not_new_quoted: 0, unknown: 0 } });
  const c8Team = await c8ReadTeam(c8Owner, { business_day: c8Day }, c8Deps);
  assert.deepEqual([c8Team.goals?.other_outbound_total, c8Team.goals?.other_outbound_breakdown], [2, c8Rep.other_outbound.breakdown], "C8: /team serves the roster sum");

  console.log(JSON.stringify({ ok: true, database }));
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      if (mongoose.connection.readyState === 1 && mongoose.connection.name === database) await mongoose.connection.dropDatabase();
    } finally {
      await mongoose.disconnect();
    }
  });
