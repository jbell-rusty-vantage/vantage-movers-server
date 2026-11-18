/** Indexed Pool reads and batch identity equivalence on the fixed local replica, synthetic data only. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { csiEnqueueReplicaTarget } from "../lib/csi-enqueue-replica-target";

const database = `testvantagemovers_queueperf${randomUUID().replaceAll("-", "")}`;
for (const key of Object.keys(process.env)) if (/MONGO|DOTENV|RINGCENTRAL|^RC_|VERCEL|GOOGLE|REDIS|UPSTASH/i.test(key)) delete process.env[key];
process.env.DOTENV_CONFIG_PATH = `${__dirname}/.queue-performance-no-dotenv.env`;
process.env.TEST_MODE = "true";
process.env.TEST_MONGO_DATABASE_NAME = database;
process.env.MONGO_URI = csiEnqueueReplicaTarget(process.argv);
process.env.SHEET_SYNC_MODE = "disabled";
mongoose.set("autoIndex", false);
mongoose.set("autoCreate", false);

async function main() {
  const { connectMongo } = await import("../../src/db.js");
  const { poolQueuePipeline } = await import("../../src/services/salesOutreach/reads/deskStore.js");
  const { mongoQueuePageQueries, mongoQueueFilter, queueSortSpec } = await import("../../src/services/salesOutreach/reads/queueQuery.js");
  const { normalizeQueueQuery } = await import("../../src/services/salesOutreach/reads/queue.js");
  const { poolBatchJobFilter } = await import("../../src/services/salesOutreach/pool/admission.js");
  const { equivalentNormalizedJobFilter } = await import("../../src/services/bookings/bookingIdentity.js");
  const { getSalesOutreachProjectionModel } = await import("../../src/models/salesOutreach/index.js");
  await connectMongo();
  assert.equal(mongoose.connection.name, database);
  assert.equal(mongoose.connection.host, "127.0.0.1");
  const Model = getSalesOutreachProjectionModel();
  await Model.createCollection(); await Model.createIndexes();
  const agent = new mongoose.Types.ObjectId(), foreign = new mongoose.Types.ObjectId();
  const docs = Array.from({ length: 2000 }, (_, i) => ({ subject_id: new mongoose.Types.ObjectId(), assigned_agent_id: i < 10 ? agent : foreign,
    subject_status: "active", workflow: i % 2 ? "new" : "quoted", priority_raw: i % 2 ? "0" : "1",
    status_flags: { needs_contact: i !== 12, blocked: false, pending: false },
    display: { move_date: i % 2 ? "2026-10-15" : null },
    queue_keys: { urgency_due: new Date(1000 + i), urgency_next: new Date(2000 + i), received_asc: new Date(3000 + i), received_desc: new Date(3000 + i), last_interaction: new Date(4000 + i) },
  }));
  await Model.collection.insertMany(docs);
  const overrides = [
    { subject_id: String(docs[11]!.subject_id), fields: { assigned_agent_id: agent, workflow: "none", priority_raw: "9", status_flags: { needs_contact: true, blocked: false, pending: false } } },
    { subject_id: String(docs[12]!.subject_id), fields: { assigned_agent_id: agent, workflow: "none", priority_raw: "9", status_flags: { needs_contact: true, blocked: false, pending: false } } },
    { subject_id: String(docs[1]!.subject_id), fields: { assigned_agent_id: foreign, workflow: "none", priority_raw: "9", status_flags: { needs_contact: false, blocked: false, pending: false } } },
  ];
  const actor = { role: "rep" as const, agent_id: String(agent), actor: { kind: "rep" as const, id: "probe", request_id: "probe", run_id: null } };
  // Independent oracle: apply every per-subject override before filtering or limiting.
  const baseline: mongoose.PipelineStage[] = [{ $replaceWith: { $mergeObjects: ["$$ROOT", { $switch: {
    branches: overrides.map((o) => ({ case: { $eq: ["$subject_id", new mongoose.Types.ObjectId(o.subject_id)] }, then: { $literal: o.fields } })),
    default: {},
  } }] } }];
  let plans = 0;
  for (const scope of [undefined, "pool"] as const) for (const workflow of ["new", "quoted", "other", "all"] as const)
    for (const state of ["needs_contact", "all_active", "blocked", "pending"] as const)
      for (const sort of ["urgency", "lead_received", "last_interaction", "move_date"] as const) {
        const normalized = normalizeQueueQuery(actor, { workflow, state, ...(scope ? { queue_scope: scope } : {}) }, true);
        const match = { ...normalized.match, pool_overrides: overrides, ...(scope ? { pool_subject_ids: overrides.map((o) => o.subject_id) } : {}) };
        for (const { filter, sort: order } of mongoQueuePageQueries({ match, sort: queueSortSpec(sort, "asc"), after: null, limit: 5 })) {
          const tail: mongoose.PipelineStage[] = [{ $sort: order }, { $limit: 5 }, { $project: { _id: 0, subject_id: 1 } }];
          const before = await Model.aggregate([...baseline, { $match: filter }, ...tail]);
          const after = await Model.aggregate([...poolQueuePipeline(match, filter), ...tail]);
          assert.deepEqual(after, before, `${scope}/${workflow}/${state}/${sort}`);
          plans++;
        }
        const filter = mongoQueueFilter(match);
        assert.deepEqual(await Model.aggregate([...poolQueuePipeline(match, filter), { $count: "n" }]),
          await Model.aggregate([...baseline, { $match: filter }, { $count: "n" }]));
      }
  const match = { ...normalizeQueueQuery(actor, { queue_scope: "pool" }, true).match, pool_overrides: overrides, pool_subject_ids: overrides.map((o) => o.subject_id) };
  const explain = await Model.aggregate(poolQueuePipeline(match, mongoQueueFilter(match))).explain("executionStats");
  const stages = explain.stages as Array<{ $cursor?: { executionStats?: { totalDocsExamined: number }; queryPlanner?: unknown } }>;
  const cursor = stages.find((stage) => stage.$cursor)?.$cursor;
  assert.ok(cursor && cursor.executionStats!.totalDocsExamined <= overrides.length, "Pool must examine only selected subjects before overlay");
  assert.match(JSON.stringify(cursor.queryPlanner), /IXSCAN/);
  assert.doesNotMatch(JSON.stringify(cursor.queryPlanner), /COLLSCAN/);

  for (const direction of ["asc", "desc"] as const) for (const workflow of ["new", "quoted", "other", "all"] as const) {
    const base = normalizeQueueQuery(actor, { workflow, state: "all_active" }, true);
    const match = { ...base.match, pool_overrides: overrides };
    const sort = queueSortSpec("lead_received", direction);
    const plan = { match, sort, after: null, limit: 2 };
    const [first] = mongoQueuePageQueries(plan);
    const reference = await Model.aggregate([...baseline, { $match: first!.filter }, { $sort: first!.sort }]);
    if (reference.length < 2) continue;
    const last = reference[1];
    const key = direction === "asc" ? last.queue_keys.received_asc : last.queue_keys.received_desc;
    const [next] = mongoQueuePageQueries({ ...plan, after: [key.toISOString(), String(last.subject_id)] });
    const actual = await Model.aggregate([...poolQueuePipeline(match, next!.filter), { $sort: next!.sort }, { $limit: 2 }]);
    assert.deepEqual(actual.map((r) => String(r.subject_id)), reference.slice(2, 4).map((r) => String(r.subject_id)));
  }

  const identities = mongoose.connection.db!.collection("synthetic_job_identities");
  const jobs = ["P123", "AB0042", "A 123", "X.Y", "Z999", "Q12", "789"];
  await identities.insertMany(["123", "P123", "Q123", "ABC123", "0042", "Q0042", "42", "A 123", "X.Y", "XAY", "Z999", "999", "Q12", "912", "1234", "ABX123", "P789", "PP789", "RF789", "789", "P789\n", "P789\r\n"].map((normalized_job_no) => ({ normalized_job_no })));
  for (const batch of [jobs, [], ["X.Y"], ["P123", "P123"], ["123", "0042"]]) {
    const oldFilter = batch.length ? { $or: batch.map(equivalentNormalizedJobFilter) } : { normalized_job_no: { $in: [] } };
    const before = await identities.find(oldFilter).sort({ normalized_job_no: 1 }).toArray();
    const after = await identities.find(poolBatchJobFilter(batch)).sort({ normalized_job_no: 1 }).toArray();
    assert.deepEqual(after, before);
  }
  console.log(`PASS: ${plans} Pool plans/counts match full-overlay semantics; indexed prefilter examines ${cursor.executionStats!.totalDocsExamined}/2000 rows; batched Job aliases equal original Mongo filters`);
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (mongoose.connection.name === database) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
