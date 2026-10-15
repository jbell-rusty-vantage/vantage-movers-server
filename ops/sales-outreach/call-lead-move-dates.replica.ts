/** Actual date repair, audit and queue ordering on a disposable fixed-loopback database. No production env. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { csiEnqueueReplicaTarget } from "../lib/csi-enqueue-replica-target";
const database = `testvantagemovers_calldates${randomUUID().replaceAll("-", "")}`;
for (const key of Object.keys(process.env)) if (/MONGO|DOTENV|RINGCENTRAL|^RC_|VERCEL|GOOGLE|REDIS|UPSTASH/i.test(key)) delete process.env[key];
process.env.MONGO_URI = csiEnqueueReplicaTarget(process.argv);
process.env.TEST_MODE = "true"; process.env.TEST_MONGO_DATABASE_NAME = database;
process.env.DOTENV_CONFIG_PATH = `${__dirname}/.call-move-dates-no-dotenv.env`;
process.env.SHEET_SYNC_MODE = "disabled";
process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID = "call-move-dates-replica";
mongoose.set("autoIndex", false); mongoose.set("autoCreate", false);

async function main() {
  const { connectMongo } = await import("../../src/db.js");
  const { getCallLeadModel } = await import("../../src/models/CallLead.js");
  const { getGranotObservationModel } = await import("../../src/models/GranotObservation.js");
  const models = await import("../../src/models/salesOutreach/index.js");
  const { DomainCommandExecution } = await import("../../src/models/DomainCommandExecution.js");
  const { EntityChange } = await import("../../src/models/EntityChange.js");
  const { getSalesIntelligenceJobModel } = await import("../../src/models/SalesIntelligenceJob.js");
  const { completeConfigurationInput, subjectRow } = await import("../../src/services/salesOutreach/evaluation/testing.js");
  const { salesOutreachConfigurationValueSchema } = await import("../../src/validation/v1/salesOutreach.js");
  const { configurationContentHash } = await import("../../src/services/salesOutreach/config/store.js");
  const { salesOutreachConfigurationLoader } = await import("../../src/services/salesOutreach/config/load.js");
  const { inspectCallMoveDateRecovery, recoverCallMoveDate } = await import("../../src/services/granotLifecycle/callLeadMoveDateRepair.js");
  const { readQueue } = await import("../../src/services/salesOutreach/reads/queue.js");
  await connectMongo(); assert.equal(mongoose.connection.name, database); assert.equal(mongoose.connection.host, "127.0.0.1");
  for (const Model of [...models.SALES_OUTREACH_MODEL_REGISTRY.map((row) => row.model()), getCallLeadModel(), getGranotObservationModel(), DomainCommandExecution, EntityChange, getSalesIntelligenceJobModel()] as unknown as Array<mongoose.Model<unknown>>) {
    await Model.createCollection(); await Model.createIndexes();
  }
  const value = salesOutreachConfigurationValueSchema.parse(completeConfigurationInput({ desk_enabled: true, cadence_enforcement_enabled: true }));
  const hash = configurationContentHash(value), version = "call-dates-replica";
  await models.getSalesOutreachConfigurationModel().collection.insertMany([
    { kind: "version", key: `version:${version}`, version, value, content_hash: hash, approval_ref: "replica" },
    { kind: "pointer", key: "active", version, content_hash: hash, revision: 1 },
  ] as never[]);
  const observation = new mongoose.Types.ObjectId(), now = new Date(), captured = new Date(+now - 86400000), move = new Date("2026-12-01T00:00:00Z");
  await getGranotObservationModel().collection.insertOne({ _id: observation, captured_at: captured, kind: "lead_snapshot", normalization_result: "valid",
    identity: { normalized_job_no: "123456" }, move: { move_date: move }, priority: { valid: true, canonical: "0" } } as never);
  const lead = await getCallLeadModel().create({ phone_number: "3055550101", normalized_phone_number: "3055550101", job_no: "P123456", normalized_job_no: "P123456", timestamp: captured,
    ingestion_origin: "vantage_admin", domain_revision: 1, granot_priority: "0", last_accepted_granot_observation: { observation_id: observation, captured_at: captured }, no_sync: true });
  const fixture = subjectRow({ lead: { model: "CallLead", id: String(lead._id) }, received_at: captured, received_date: captured.toISOString().slice(0, 10),
    priority: { raw: "0", accepted_at: captured, observation_id: String(observation), basis: "accepted_observation", uncertain: false } });
  const { id, lead: ref, ...stored } = fixture;
  await models.getSalesOutreachSubjectModel().collection.insertOne({ ...stored, _id: new mongoose.Types.ObjectId(id), lead_model: ref.model, lead_id: lead._id } as never);
  const before = await inspectCallMoveDateRecovery(); assert.equal(before.candidates.length, 1);
  assert.equal(await recoverCallMoveDate(before.candidates[0]!), true);
  assert.equal(await recoverCallMoveDate(before.candidates[0]!), false, "replay must not write again");
  const after = await getCallLeadModel().findById(lead._id).lean();
  assert.equal(after?.move_date?.toISOString(), move.toISOString());
  assert.equal(after?.domain_revision, 2); assert.equal(after?.no_sync, true); assert.equal(after?.receiver_agent, undefined);
  assert.equal(String(after?.last_accepted_granot_observation?.observation_id), String(observation));
  assert.equal(await EntityChange.countDocuments({ "entity.id": String(lead._id), changed_paths: "move_date" }), 1);
  assert.equal(await DomainCommandExecution.countDocuments({ command_name: "recoverCallLeadMoveDate" }), 1);
  const projection = await models.getSalesOutreachProjectionModel().findOne({ subject_id: fixture.id }).lean();
  assert.equal(projection?.display.move_date, "2026-12-01");
  const unknownId = new mongoose.Types.ObjectId();
  await models.getSalesOutreachProjectionModel().collection.insertOne({ ...projection, _id: new mongoose.Types.ObjectId(), subject_id: unknownId,
    display: { ...projection!.display, move_date: null } } as never);
  const owner = { role: "owner" as const, agent_id: null, actor: { kind: "owner" as const, id: "replica", request_id: "replica", run_id: null } };
  const result = await readQueue(owner, { state: "all_active", sort: "move_date", limit: 1 }, { now, loader: salesOutreachConfigurationLoader, cursorSecret: "replica" });
  assert.equal(result.rows[0]?.move_date, "2026-12-01"); assert.equal(result.has_more, true);
  const second = await readQueue(owner, { state: "all_active", sort: "move_date", limit: 1, cursor: result.next_cursor! }, { now, loader: salesOutreachConfigurationLoader, cursorSecret: "replica" });
  assert.equal(second.rows[0]?.move_date, null, "unknown dates stay visible after dated Leads");
  assert.equal((await inspectCallMoveDateRecovery()).candidates.length, 0);
  console.log("PASS: accepted Call move date recovered once with audit/revision, source facts preserved, card projection populated, dated-first/unknown-last keyset paging");
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (mongoose.connection.name === database) await mongoose.connection.dropDatabase(); await mongoose.disconnect();
});
