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
 *   `outreach_contact_calls` sync-state row; a concurrent sweep is `lease_held`.
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
  const { getNumberLeadAttachmentModel } = await import("../../src/models/NumberLeadAttachment.js");
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
    getNumberLeadAttachmentModel(),
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
  await getNumberLeadAttachmentModel().create({ contact_number_id: number, lead_ref: { model: "FormLead", id: leadId }, state: "attached", certainty: "exact" });
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
  await getSalesIntelligenceSyncStateModel().updateOne({ scope: CALL_LOG_ALL_DIRECTIONS_SCOPE }, { $set: { known_complete_through: new Date("2026-10-05T18:40:00Z") } }, { upsert: true });
  const loader = fixedConfigurationLoader(configuration);
  const swept = await sweepContactSources("call", now, { loader });
  assert.equal(swept.caught_up, true);
  const state = await getSalesIntelligenceSyncStateModel().findOne({ scope: "outreach_contact_calls" }).lean();
  assert.equal(state?.known_complete_through?.toISOString(), "2026-10-05T18:40:00.000Z");
  assert.ok(state?.cursor?.outreach_source_updated_at, "cursor stored");
  const { MongoLeaseStore } = await import("../../src/services/durableWork/leases.js");
  const leases = new MongoLeaseStore(getSalesIntelligenceSyncStateModel());
  const held = await leases.acquire({ scope: "outreach_contact_calls", owner: "other", ttl_ms: 60_000, now: new Date() });
  assert.ok(held);
  assert.equal((await sweepContactSources("call", now, { loader })).reason, "lease_held");
  await leases.release({ token: held, now: new Date() });
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
