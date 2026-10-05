/**
 * SRV-7 / evaluator replica proof (local csi01 loopback replica only; synthetic rows in a unique
 * database that is dropped afterwards). Part of `pnpm test:outreach:replica`. Never loads production env.
 *
 * Proves on real Mongo transactions what the unit tests prove on in-memory stand-ins:
 * - assignment: `receiver_agent` (source `manual`), its EntityChange and the Lead `domain_revision`
 *   CAS, the subject's assignment, the ledger row and the audit event commit together; the replay
 *   returns the committed result and writes nothing; Granot latest-wins never replaces the manual receiver;
 * - human plans: two concurrent Quoted commands at the same plan revision — one commits, one 409,
 *   one active plan (unique partial index); a callback replacement keeps the replaced row;
 * - day override: two concurrent overrides at the same configuration revision — one moves the pointer;
 * - restrictions: lift releases with reason/actor and nominates the number's subjects;
 * - `outreach_evaluate`: the job writes the projection, an identical re-run writes nothing, and the
 *   minute sweep nominates a due projection once.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { csiEnqueueReplicaTarget } from "../lib/csi-enqueue-replica-target";

const database = `testvantagemovers_sodcommands${randomUUID().replaceAll("-", "")}`;
for (const key of Object.keys(process.env))
  if (/RINGCENTRAL|^RC_|BLOB|GATEWAY|OPENAI|ANTHROPIC|VERCEL|KV_REST|REDIS|UPSTASH|QSTASH|GOOGLE|MONGO|DOTENV/i.test(key)) delete process.env[key];
process.env.DOTENV_CONFIG_PATH = `${__dirname}/.sod-commands-replica-no-dotenv.env`;
process.env.MONGO_URI = csiEnqueueReplicaTarget(process.argv);
process.env.TEST_MODE = "true";
process.env.TEST_MONGO_DATABASE_NAME = database;
process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID = "sod-commands-replica";
process.env.SHEET_SYNC_MODE = "disabled";

const oid = () => new mongoose.Types.ObjectId();
const at = (iso: string) => new Date(iso);

async function main() {
  const { connectMongo, withTransaction } = await import("../../src/db.js");
  const { enqueueCsiJob } = await import("../../src/services/salesIntelligence/jobs.js");
  const { SALES_OUTREACH_MODEL_REGISTRY } = await import("../../src/models/salesOutreach/registry.js");
  const { getSalesIntelligenceJobModel } = await import("../../src/models/SalesIntelligenceJob.js");
  const { getSalesIntelligenceSyncStateModel } = await import("../../src/models/SalesIntelligenceSyncState.js");
  const { getSalesIntelligenceCommandExecutionModel } = await import("../../src/models/SalesIntelligenceCommandExecution.js");
  const { getSalesIntelligenceAuditEventModel } = await import("../../src/models/SalesIntelligenceAuditEvent.js");
  const { getSalesIntelligenceContactRestrictionModel } = await import("../../src/models/SalesIntelligenceContactRestriction.js");
  const { getEntityChangeModel } = await import("../../src/models/EntityChange.js");
  const { csiOperatorActor } = await import("../../src/services/salesIntelligence/auth.js");
  const { patchSalesOutreachConfiguration } = await import("../../src/services/salesOutreach/config/commands.js");
  const { salesOutreachConfigurationLoader } = await import("../../src/services/salesOutreach/config/load.js");
  const { assignSubject } = await import("../../src/services/salesOutreach/commands/assignment.js");
  const { setQuotedFollowup, commandCallback } = await import("../../src/services/salesOutreach/commands/plans.js");
  const { setGoalDayOverride } = await import("../../src/services/salesOutreach/commands/dayOverride.js");
  const { liftRestriction } = await import("../../src/services/salesOutreach/commands/restrictions.js");
  const { evaluationJob, runOutreachEvaluateJob, sweepOutreachEvaluations } = await import("../../src/services/salesOutreach/evaluation/evaluateJob.js");
  const { receiverReplaceableByGranot } = await import("../../src/services/granotLifecycle/leadDesiredState.js");
  const { completeConfigurationInput, TEST_AGENT_A, TEST_AGENT_B } = await import("../../src/services/salesOutreach/evaluation/testing.js");
  await connectMongo();
  assert.equal(mongoose.connection.name, database);

  const csiModels = [
    getSalesIntelligenceJobModel(),
    getSalesIntelligenceSyncStateModel(),
    getSalesIntelligenceCommandExecutionModel(),
    getSalesIntelligenceAuditEventModel(),
    getSalesIntelligenceContactRestrictionModel(),
    getEntityChangeModel(),
    ...SALES_OUTREACH_MODEL_REGISTRY.map((e) => e.model()),
  ];
  for (const Model of csiModels) {
    await Model.createCollection();
    await Model.createIndexes();
  }
  const db = mongoose.connection.useDb(database, { useCache: true }).db!;
  for (const name of ["form_leads", "call_leads", "number_lead_attachments", "rep_identity_links", "granot_observations", "contact_numbers"]) await db.createCollection(name);

  const ownerCsi = csiOperatorActor("sod-commands-replica");
  const owner = { role: "owner" as const, actor: ownerCsi, agent_id: null };
  // A trusted Manager actor only comes from a signed request; the Manager paths are proven by the unit
  // and route suites. Here the Owner drives every command (the transactional fences are the same).
  await patchSalesOutreachConfiguration({
    actor: ownerCsi,
    idempotency_key: "sod-commands-config",
    expected_revision: 0,
    value: completeConfigurationInput({ cadence_shadow_enabled: true }),
  });
  const config = await salesOutreachConfigurationLoader.requireActive();

  for (const [agent, name] of [
    [TEST_AGENT_A, "Alice Rep"],
    [TEST_AGENT_B, "Bob Rep"],
  ] as const)
    await db.collection("rep_identity_links").insertOne({
      agent_id: new mongoose.Types.ObjectId(agent),
      agent_name_snapshot: name,
      rc_account_id: "acc",
      rc_extension_id: `ext-${agent.slice(0, 4)}`,
      role_kind: "sales_rep",
      status: "reviewed",
      effective_from: at("2026-01-01T00:00:00Z"),
      effective_to: null,
      revision: 1,
    });
  const number = oid();
  await db.collection("contact_numbers").insertOne({ _id: number, e164: "+15550100000" });
  const leadId = oid();
  await db.collection("form_leads").insertOne({
    _id: leadId,
    ingestion_origin: "wordpress_form",
    timestamp: at("2026-10-02T10:00:00Z"),
    createdAt: at("2026-10-02T14:00:03Z"),
    domain_revision: 3,
    receiver_agent: new mongoose.Types.ObjectId(TEST_AGENT_A),
    receiver_agent_source: "granot_username_match",
    phone_number: "(555) 010-0000",
    normalized_phone_number: "5550100000",
    name: "Synthetic Customer",
    duplicate: false,
    no_sync: false,
  });
  const Subjects = SALES_OUTREACH_MODEL_REGISTRY.find((e) => e.name === "SalesOutreachSubject")!.model();
  const Periods = SALES_OUTREACH_MODEL_REGISTRY.find((e) => e.name === "SalesOutreachPolicyPeriod")!.model();
  const Plans = SALES_OUTREACH_MODEL_REGISTRY.find((e) => e.name === "SalesOutreachFollowupSchedule")!.model();
  const Projections = SALES_OUTREACH_MODEL_REGISTRY.find((e) => e.name === "SalesOutreachProjection")!.model();
  const subjectId = oid();
  const boundary = at("2026-10-02T14:00:00Z");
  await Subjects.collection.insertOne({
    _id: subjectId,
    lead_model: "FormLead",
    lead_id: leadId,
    enrollment: { cohort_id: "replica", kind: "pilot", enrolled_at: boundary, activation_at: boundary, manifest_hash: null },
    status: "active",
    review_reasons: [],
    received_at: at("2026-10-02T14:00:00Z"),
    received_date: "2026-10-02",
    received_quality: "wall_clock",
    adapter_version: "lead-instant-v1",
    display: { job_no: "J-1", normalized_job_no: "J1", phone: "(555) 010-0000", normalized_phone: "5550100000", name: "Synthetic Customer", move_date: null },
    priority: { raw: "1", accepted_at: boundary, observation_id: null, basis: "accepted_observation", uncertain: false },
    assigned_agent_id: new mongoose.Types.ObjectId(TEST_AGENT_A),
    assignment_revision: 1,
    lead_revision_seen: 3,
    contact_number_ids: [number],
    revision: 1,
    createdAt: boundary,
    updatedAt: boundary,
  });
  const periodId = oid();
  await Periods.collection.insertOne({
    _id: periodId,
    subject_id: subjectId,
    transition_key: "replica:quoted",
    policy_version: config.version,
    activation_boundary: boundary,
    workflow: "quoted",
    start_kind: "activation",
    priority: "1",
    started_at: boundary,
    ended_at: null,
    end_reason: null,
    time_basis: "activation_boundary",
    revision: 1,
  });
  const Ledger = getSalesIntelligenceCommandExecutionModel();
  const Audit = getSalesIntelligenceAuditEventModel();

  // 1. Assignment: Lead write + EntityChange + subject + ledger + audit in one transaction; replay writes nothing.
  const assignInput = { actor: owner, subject_id: String(subjectId), idempotency_key: "replica-assign", expected_revision: 1, agent_id: TEST_AGENT_B };
  const assigned = await assignSubject(assignInput, { publish: async () => undefined });
  assert.deepEqual([assigned.changed, assigned.lead_revision, assigned.assignment_revision], [true, 4, 2]);
  const lead = await db.collection("form_leads").findOne({ _id: leadId });
  assert.deepEqual([String(lead?.receiver_agent), lead?.receiver_agent_source, lead?.domain_revision], [TEST_AGENT_B, "manual", 4]);
  const change = await getEntityChangeModel().findOne({ "entity.id": String(leadId), changed_paths: "receiver_agent" }).lean();
  assert.ok(change && change.revision_after === 4 && change.command_name === "sales_outreach_assignment", "EntityChange in the same transaction");
  assert.equal(String((await Subjects.findById(subjectId).lean())?.assigned_agent_id), TEST_AGENT_B);
  const counts = async () => [await Ledger.countDocuments({}), await Audit.countDocuments({}), await getEntityChangeModel().countDocuments({})];
  const before = await counts();
  assert.equal((await assignSubject(assignInput, { publish: async () => undefined })).replayed, true);
  assert.deepEqual(await counts(), before, "replay writes nothing");
  assert.equal(receiverReplaceableByGranot({ receiver_agent: TEST_AGENT_B, receiver_agent_source: "manual", receiver_agent_set_at: new Date() }, TEST_AGENT_A, new Date(Date.now() + 60_000)), false);
  assert.ok(await getSalesIntelligenceJobModel().exists({ dedupe_key: `sod:lead-change:FormLead:${leadId}:r4` }), "lead-change wake job");

  // 2. Concurrent Quoted commands at one plan revision: one commits, one conflicts; one active plan.
  const tomorrow = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(Date.now() + 2 * 86_400_000));
  const quoted = (key: string) =>
    setQuotedFollowup({ actor: owner, subject_id: String(subjectId), idempotency_key: key, expected_revision: 0, period_id: String(periodId), selected_date: tomorrow, replace_active_plan: false }, { publish: async () => undefined });
  const raced = await Promise.allSettled([quoted("race-1"), quoted("race-2")]);
  assert.equal(raced.filter((r) => r.status === "fulfilled").length, 1, "exactly one Quoted command commits");
  assert.equal(await Plans.countDocuments({ subject_id: subjectId, status: "active" }), 1);
  const replaced = await commandCallback(
    { actor: owner, subject_id: String(subjectId), idempotency_key: "cb-1", expected_revision: 1, operation: "set", appointment_at: new Date(Date.now() + 3 * 86_400_000).toISOString(), replace_active_plan: true },
    { publish: async () => undefined },
  );
  assert.equal(replaced.ended_plan?.status, "replaced");
  assert.deepEqual((await Plans.find({ subject_id: subjectId }).sort({ _id: 1 }).lean()).map((p) => p.status), ["replaced", "active"]);

  // 3. Concurrent day overrides at one configuration revision: one moves the pointer.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const override = (key: string, goal: number) =>
    setGoalDayOverride({ actor: owner, agent_id: TEST_AGENT_B, idempotency_key: key, expected_revision: config.revision, business_date: today, goal, reason: "partial_day" });
  const overrides = await Promise.allSettled([override("ov-1", 40), override("ov-2", 50)]);
  assert.equal(overrides.filter((r) => r.status === "fulfilled").length, 1, "one override wins the pointer CAS");
  assert.equal((await salesOutreachConfigurationLoader.requireActive()).revision, config.revision + 1);

  // 4. Lift an AI-origin restriction on the subject's number: released with reason/actor, subject re-evaluated.
  const restriction = await getSalesIntelligenceContactRestrictionModel().create({
    contact_number_id: number,
    channels: ["call"],
    origin: "intelligence",
    actor: { kind: "intelligence", id: "retired-ai", request_id: "retired", run_id: null },
    state: "active",
    revision: 1,
  });
  const lifted = await liftRestriction(
    { actor: owner, idempotency_key: "lift-1", restriction_id: String(restriction._id), expected_revision: 1, reason: "Reviewed by the Owner" },
    { publish: async () => undefined },
  );
  assert.deepEqual([lifted.restriction.state, lifted.restriction.resolution_reason], ["resolved", "Reviewed by the Owner"]);
  assert.ok(await getSalesIntelligenceJobModel().exists({ dedupe_key: `sod:evaluate:${subjectId}:restriction:${restriction._id}:r2` }));

  // 5. outreach_evaluate: the job writes the projection; an identical re-run writes nothing; the sweep nominates a due row.
  let status = "completed";
  for (let i = 0; i < 20 && status === "completed"; i++) status = (await runOutreachEvaluateJob()).status;
  const projection = await Projections.findOne({ subject_id: subjectId }).lean();
  assert.ok(projection, "projection written");
  await withTransaction((session) => enqueueCsiJob(evaluationJob(String(subjectId), "replica-rerun"), session));
  await runOutreachEvaluateJob();
  const after = await Projections.findOne({ subject_id: subjectId }).lean();
  assert.equal(after?.revision, projection.revision, "identical input writes nothing");
  await Projections.updateOne({ subject_id: subjectId }, { $set: { next_evaluation_at: new Date(Date.now() - 1_000) } });
  const swept = await sweepOutreachEvaluations(new Date());
  assert.ok(swept.due.nominated >= 1, "the due projection is nominated");
  console.log("PASS: assignment atomicity/replay/manual protection, plan race + replacement history, override pointer race, restriction lift, evaluate write/no-op/sweep");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.name === database) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
