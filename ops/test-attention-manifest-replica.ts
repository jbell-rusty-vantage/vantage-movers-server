/** Synthetic replica-set checks in a newly named TEST_MODE database; removes only that database. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
function orderedIndex(key: mongoose.IndexDefinition): Record<string, 1 | -1> {
  const result: Record<string, 1 | -1> = {};
  for (const [field, direction] of Object.entries(key)) {
    if (direction !== 1 && direction !== -1) throw new Error("Unexpected non-ordered test index");
    result[field] = direction;
  }
  return result;
}
const database = `testvantagemovers_attention${randomUUID().replaceAll("-", "")}`;
process.env.TEST_MODE = "true";
process.env.TEST_MONGO_DATABASE_NAME = database;
process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID = "attention-replica-test";
process.env.OBSERVABILITY_ENABLED = "false";
process.env.SHEET_SYNC_MODE = "disabled";

async function main() {
  const { connectMongo, withTransaction } = await import("../src/db.js");
  const { csiDataset } = await import("../src/config/domain/salesIntelligence.js");
  const { getAttentionArtifactModel, ATTENTION_ARTIFACT_INDEXES } = await import("../src/models/salesIntelligence/attentionArtifact.js");
  const { getMoveAssessmentArtifactModel, MOVE_ASSESSMENT_ARTIFACT_INDEXES } = await import("../src/models/MoveAssessmentArtifact.js");
  const { getOutreachRecordModel } = await import("../src/models/OutreachRecord.js");
  const { getSalesIntelligenceAttentionSnapshotModel: snapshotModel, SALES_INTELLIGENCE_ATTENTION_SNAPSHOT_INDEXES } = await import("../src/models/SalesIntelligenceAttentionSnapshot.js");
  const { getSalesIntelligenceSyncStateModel, SALES_INTELLIGENCE_SYNC_STATE_INDEXES } = await import("../src/models/SalesIntelligenceSyncState.js");
  const { lockAttentionArtifacts, writeAttentionArtifacts, collectAttentionArtifacts, attentionArtifactEpoch, clearAttentionArtifacts } = await import("../src/services/salesIntelligence/outreach/attentionArtifactStore.js");
  const { purgeMoveAssessments } = await import("../src/services/salesIntelligence/assessment/runtime.js");
  const { encodeAttentionManifest } = await import("../src/services/salesIntelligence/outreach/attentionManifest.js");
  const { attentionIndexEntry } = await import("../src/services/salesIntelligence/outreach/attentionIndex.js");
  const { ambiguousReviewFixture, unknownCoverageFixture } = await import("../src/services/salesIntelligence/fixtures.js");
  const { readAttention, clearParsedAttentionSnapshots } = await import("../src/services/salesIntelligence/outreach/attention.js");
  const { defaultCsiPolicy } = await import("../src/services/salesIntelligence/policy.js");
  const { fenceAttentionPublish, attentionPublishFenceScope } = await import("../src/services/salesIntelligence/outreach/bandTransitions.js");
  await connectMongo();
  assert.equal(mongoose.connection.name, database);
  const Artifacts = getAttentionArtifactModel(), Assessments = getMoveAssessmentArtifactModel(), Snapshot = snapshotModel(), State = getSalesIntelligenceSyncStateModel();
  await Snapshot.createCollection(); await Artifacts.createCollection(); await Assessments.createCollection(); await State.createCollection();
  await getOutreachRecordModel().createCollection();
  await getOutreachRecordModel().createIndexes();
  for (const { key, ...options } of ATTENTION_ARTIFACT_INDEXES) await Artifacts.collection.createIndex(orderedIndex(key), { ...options, unique: Boolean(options.unique) });
  for (const { key, ...options } of MOVE_ASSESSMENT_ARTIFACT_INDEXES) await Assessments.collection.createIndex(orderedIndex(key), { ...options, unique: Boolean(options.unique) });
  // Do not enable TTL during the controlled race checks.
  for (const { key, ...options } of SALES_INTELLIGENCE_ATTENTION_SNAPSHOT_INDEXES.filter(i => !("expireAfterSeconds" in i))) await Snapshot.collection.createIndex(orderedIndex(key), { ...options, unique: Boolean(options.unique) });
  for (const { key, ...options } of SALES_INTELLIGENCE_SYNC_STATE_INDEXES) await State.collection.createIndex(orderedIndex(key), { ...options, unique: Boolean(options.unique) });
  const policy = defaultCsiPolicy();
  const rows = [ambiguousReviewFixture, { ...ambiguousReviewFixture, subject_key: "second" }];
  const content = encodeAttentionManifest(rows, { timezone: policy.timezone, staffed_hours: policy.staffed_hours }, attentionIndexEntry);
  const now = new Date();
  async function publish(id: string, asOf: Date, bound: Date | null, epoch = 0, fail = false) {
    return withTransaction(async session => {
      await lockAttentionArtifacts(session, epoch);
      await fenceAttentionPublish(session, { scope: attentionPublishFenceScope(csiDataset()), bound, asOf, snapshotId: id });
      const storage = await writeAttentionArtifacts(content.artifacts, session);
      if (fail) throw new Error("injected incomplete publication");
      await Snapshot.create([{ ...csiDataset(), snapshot_id: id, owner_id: "system", filter_digest: "test", policy_version: policy.version,
        as_of: asOf, expires_at: null, rows: [], counts: { total_items: rows.length }, manifest: content.manifest }], { session });
      return storage;
    });
  }
  const first = await publish("outreach:first", now, null);
  assert.equal(first.inserted_artifacts, content.artifacts.length);
  const deps = { coverage: async () => unknownCoverageFixture };
  const page = await readAttention({ limit: 1 }, deps);
  assert.equal(page.data.status, "ready"); assert.equal(page.data.total_items, 2);
  assert.deepEqual(page.data.items[0], rows[0]);
  assert.equal((await readAttention({ limit: 1, cursor: page.data.cursor! }, deps)).data.items[0]!.subject_key, "second");
  await assert.rejects(publish("outreach:failed", new Date(+now + 1), now, 0, true), /injected/);
  assert.equal(await Snapshot.countDocuments({ snapshot_id: "outreach:failed" }), 0);
  assert.equal((await readAttention({}, deps)).data.snapshot_id, "outreach:first");
  const next = new Date(+now + 2);
  const same = await publish("outreach:second", next, now);
  assert.equal(same.inserted_artifacts, 0); assert.equal(same.artifact_bytes, 0);
  await assert.rejects(publish("outreach:loser", new Date(+now + 3), now), /concurrent_publish/);
  // Artifacts old enough to collect must remain while any current or grace header pins them.
  await Artifacts.collection.updateMany({}, { $set: { created_at: new Date(+now - 3_600_000) } });
  await Snapshot.collection.updateMany({}, { $set: { cursor_expires_at: new Date(+now - 1), expires_at: new Date(+now + 300_000) } });
  assert.equal(await collectAttentionArtifacts(now), 0);
  assert.equal((await readAttention({}, deps)).data.status, "pending_projection");
  // Publish and collector contend on the real transaction mutex. Either winner is safe.
  await Snapshot.collection.updateMany({}, { $set: { expires_at: new Date(+now - 1) } });
  await Promise.all([collectAttentionArtifacts(now), publish("outreach:race", new Date(+now + 4), next)]);
  clearParsedAttentionSnapshots();
  assert.equal((await readAttention({}, deps)).data.total_items, 2);
  // A real retention purge invalidates manifest cursors and rejects a build that
  // captured the previous epoch; this must share its transaction with tombstoning.
  const retentionNumber = new mongoose.Types.ObjectId();
  const [assessment] = await Assessments.create([{ ...csiDataset(), subject_key: `number:${retentionNumber}`,
    contact_number_id: retentionNumber, schema_version: "retention-test", rubric_version: "retention-test",
    prompt_version: "retention-test", prompt_digest: "retention-test", schema_digest: "retention-test",
    model_version: "retention-test", input_fingerprint: "retention-test", input_mode: "lead_only",
    source_manifest: {}, context_as_of: now, status: "ready", shadow: false, model_output: {} }]);
  const manifestPage = await readAttention({ limit: 1 }, deps);
  assert.equal(manifestPage.data.status, "ready");
  assert.ok(manifestPage.data.cursor);
  const priorEpoch = await attentionArtifactEpoch();
  const purgedAt = new Date(+now - 1);
  const purge = await withTransaction(session => purgeMoveAssessments({ artifact_ids: [String(assessment!._id)] }, purgedAt, session));
  assert.deepEqual(purge, { artifacts: 1, projections: 0 });
  assert.equal((await Assessments.findById(assessment!._id).lean())?.status, "purged");
  assert.equal(await attentionArtifactEpoch(), priorEpoch + 1);
  await assert.rejects(readAttention({ cursor: manifestPage.data.cursor! }, deps), { code: "ATTENTION_SNAPSHOT_EXPIRED" });
  assert.equal((await readAttention({}, deps)).data.status, "pending_projection");
  await assert.rejects(publish("outreach:pre-erasure", new Date(+now + 6), new Date(+now + 4), priorEpoch), /concurrent_publish/);
  await Artifacts.collection.updateMany({}, { $set: { created_at: new Date(+now - 3_600_000) } });
  assert.equal(await collectAttentionArtifacts(now), content.artifacts.length);
  clearAttentionArtifacts();
  // Missing payloads fail explicitly, never become a partial list.
  await Snapshot.collection.updateOne({ snapshot_id: "outreach:race" }, { $set: { expires_at: null, cursor_expires_at: null } });
  clearParsedAttentionSnapshots();
  await assert.rejects(readAttention({}, deps), /artifact missing/);
  console.log(JSON.stringify({ ok: true, checks: ["binary round trip", "cursor pages", "rollback", "unchanged zero writes", "publish fence", "grace pin", "concurrent GC/publish", "retention purge epoch", "manifest cursor invalidation", "warm cache invalidation", "orphan GC", "missing artifact failure"] }));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (mongoose.connection.readyState === 1 && mongoose.connection.name === database && database.startsWith("testvantagemovers_attention")) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
