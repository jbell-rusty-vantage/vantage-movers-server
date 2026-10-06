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
 *   admission's own transaction (`admit:<subject>` job identity; a call before arrival is not), a
 *   replayed nomination dedupes, and draining the job associates and credits the call and nominates the
 *   subject's evaluation.
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
  const settled = await applySettle({ actor: csiOperatorActor("settle-pre-cc04-replica"), run_id: "settle-pre-cc04-replica" }, { batch: 1 });
  assert.deepEqual([settled.settled, settled.batches, settled.ids], [1, 1, [String(pre._id)]]);
  const settledRow = await getCallInteractionModel().findById(pre._id).lean();
  assert.deepEqual([settledRow?.call_log_state, settledRow?.projection_revision], ["settled", 2]);
  assert.ok((settledRow?.updatedAt as Date).getTime() > preUpdatedAt.getTime(), "updatedAt moves so the sweep cursor sees the row");
  for (const untouched of [preInternal, late]) {
    const row = await getCallInteractionModel().findById(untouched._id).lean();
    assert.deepEqual([row?.call_log_state, row?.projection_revision], [null, 1], "Internal and post-CC-04 rows are untouched");
  }
  const audits = await getSalesIntelligenceAuditEventModel().find({ event_kind: "call_interactions_settled_pre_cc04" }).lean();
  assert.equal(audits.length, 1, "one audit row per batch");
  assert.deepEqual((audits[0]?.current as { ids?: string[] } | undefined)?.ids, [String(pre._id)], "the audit row holds the rollback id set");

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

  // --- olr C4: a subject created after its first call re-derives that call ---------------------------
  // The call is derived while its Lead is no subject (`none`); intake then admits the Lead with an
  // activation boundary before the call. The admission's transaction nominates the call's
  // `outreach_contact_change` job (`admit:<subject>`); draining it associates and credits the call and
  // nominates the subject's evaluation. A call before the boundary is not woken; a replay dedupes.
  const { syncSubject, loadSubjectPageContext } = await import("../../src/services/salesOutreach/subjects/sync.js");
  const { mongoDeskSubjectStore } = await import("../../src/services/salesOutreach/subjects/store.js");
  const { deskConfiguration, leadFacts } = await import("../../src/services/salesOutreach/subjects/testing.js");
  const { runOutreachContactChangeJob } = await import("../../src/services/salesOutreach/contacts/jobs.js");
  const c4Lead = new mongoose.Types.ObjectId();
  const c4Number = new mongoose.Types.ObjectId();
  const c4Arrival = new Date("2026-10-04T14:00:00Z");
  await getContactNumberModel().create({ _id: c4Number, e164: "+15550100044", digits_reversed: "44001005551", first_observed_at: c4Arrival, last_activity_at: c4Arrival,
    lead: { model: "FormLead", id: c4Lead, received_at: c4Arrival, state: "open" }, lead_link: { source: "automatic", set_at: c4Arrival } });
  const c4Call = async (at: string, session: string) => {
    const started = new Date(at);
    const row = await getCallInteractionModel().create({
      provider_account_id: account, telephony_session_id: session, identity_basis: "telephony_session_id", direction: "Outbound",
      contact_number_id: c4Number, external_endpoint_kind: "external", started_at: started, provider_connected: true, provider_result: "Call connected",
      parties: [{ role: "user", direction: "Outbound", extension_id: "101" }], legs: [{ extension_id: "101", direction: "Outbound", start_time: started, result: "Call connected" }],
      call_log_state: "settled", terminal: true, first_observed_at: started, last_observed_at: started,
    });
    return { source_kind: "call" as const, source_id: String(row._id) };
  };
  const earlyCall = await c4Call("2026-10-04T13:00:00Z", "s-c4-early");
  const gapCall = await c4Call("2026-10-04T14:00:30Z", "s-c4-gap");
  const c4Now = new Date("2026-10-04T14:01:30Z");
  await withTransaction((session) => applyContactSources([earlyCall, gapCall], { now: c4Now, queueRepDays: false }, mongoContactEventStore, session));
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
  assert.deepEqual([admitted.outcome, admitted.contact_wakes], ["created", 1], "one call since arrival is woken");
  const Jobs = getSalesIntelligenceJobModel();
  const wakeKey = `sod:contact_change:call:${gapCall.source_id}:admit:${admitted.subject_id}`;
  const wakeJob = await Jobs.findOne({ dedupe_key: wakeKey }).lean();
  assert.ok(wakeJob, "the admission's transaction enqueued the re-derive");
  assert.equal(wakeJob?.subject_key, `call:${gapCall.source_id}`);
  assert.equal(await Jobs.countDocuments({ dedupe_key: { $regex: `^sod:contact_change:call:${earlyCall.source_id}:` } }), 0, "a call before arrival is not woken");
  const replayed = await withTransaction((session) =>
    mongoDeskSubjectStore.nominateContactSources({ lead: { model: "FormLead", id: String(c4Lead) }, since: c4Arrival, source_revision: `admit:${admitted.subject_id}`, limit_per_kind: 50, now: c4Now }, session));
  assert.equal(replayed, 1);
  assert.equal(await Jobs.countDocuments({ dedupe_key: wakeKey }), 1, "a replay dedupes on the job identity");
  const drained = await runOutreachContactChangeJob(String(wakeJob!._id), { loader: fixedConfigurationLoader(configuration), now: () => c4Now, publish: async () => undefined });
  assert.equal(drained.status, "completed");
  const gapEvent = await Events.findById(gapEventId).lean();
  assert.deepEqual(
    [gapEvent?.association, String(gapEvent?.subject_id), gapEvent?.subject_workflow, gapEvent?.goal_scope_eligible, gapEvent?.goal_credit],
    ["unique", admitted.subject_id, "new", true, "confirmed"],
    "the re-derive associates and credits the call",
  );
  assert.equal(await Jobs.countDocuments({ stage: "outreach_evaluate", dedupe_key: { $regex: `^sod:evaluate:${admitted.subject_id}:r1:contacts:` } }), 1, "and nominates the subject's evaluation");

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
