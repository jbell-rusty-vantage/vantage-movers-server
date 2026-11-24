/**
 * Incident Entity Change retirement, end to end on the local replica (csi01, loopback only) with a fake bucket.
 *   node --import tsx ops/domain-commands/entity-change-retirement.replica.ts
 * Proves: a storage failure changes nothing; a run archives and deletes only the proven incident rows (outside the newest
 * 50, tails past, Granot records retired) and keeps the creation row, the newest 50, a Lead with few rows and a row whose
 * Observation is hot; a retired row restores byte for byte by `_id` and by Call Lead; the next run finishes the pass and
 * a later pass is a no-op. Synthetic rows in `testvantagemovers_entchg`, dropped at the end.
 */
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { BSON, ObjectId } from "mongodb";
import { csiEnqueueReplicaTarget } from "../lib/csi-enqueue-replica-target";

const database = "testvantagemovers_entchg";
for (const key of Object.keys(process.env)) if (/RINGCENTRAL|^RC_|BLOB|GATEWAY|OPENAI|ANTHROPIC|VERCEL|KV_REST|REDIS|UPSTASH|QSTASH|GOOGLE|MONGO|DOTENV/i.test(key)) delete process.env[key];
process.env.MONGO_URI = csiEnqueueReplicaTarget(process.argv);
process.env.TEST_MODE = "true";
process.env.TEST_MONGO_DATABASE_NAME = database;

async function main() {
  const { connectMongo } = await import("../../src/db.js");
  const { ENTITY_CHANGE_INDEXES } = await import("../../src/models/EntityChange.js");
  const { CLOUD_STORAGE_NAMESPACES, createFakeObjectStore } = await import("../../src/services/cloudStorage/index.js");
  const { ENTITY_CHANGE_ARCHIVE_PACKS_COLLECTION, readArchivedEntityChanges } = await import("../../src/services/domainCommands/retirement/archivedEntityChanges.js");
  const { ENTITY_CHANGE_ARCHIVE_PACK_INDEXES, ENTITY_CHANGE_RETIREMENT_CONTROL_ID, lookupArchivedEntityChange, retireIncidentEntityChanges } =
    await import("../../src/services/domainCommands/retirement/entityChanges.js");
  const { createCatalogIndexes, RETIREMENT_CONTROL_COLLECTION } = await import("../../src/services/domainCommands/retirement/shared.js");
  await connectMongo();
  assert.equal(mongoose.connection.name, database);
  assert.match(process.env.MONGO_URI!, /^mongodb:\/\/127\.0\.0\.1:/, "loopback replica only");
  const db = mongoose.connection.db!;
  try {
    await db.dropDatabase();
    for (const i of ENTITY_CHANGE_INDEXES) await db.collection("entity_changes").createIndex(i.key, { name: i.name, ...("unique" in i ? { unique: true } : {}) });
    await createCatalogIndexes(db, ENTITY_CHANGE_ARCHIVE_PACKS_COLLECTION, ENTITY_CHANGE_ARCHIVE_PACK_INDEXES);
    const controls = db.collection<{ _id: string; [k: string]: unknown }>(RETIREMENT_CONTROL_COLLECTION);
    await controls.insertOne({ _id: ENTITY_CHANGE_RETIREMENT_CONTROL_ID, enabled_at: new Date(), cursor: null });
    const now = new Date(), hour = 3_600_000;
    const at = (hoursAgo: number) => new Date(+now - hoursAgo * hour);
    for (const scope of ["outreach_entity_changes", "lead_link_entity_changes"]) {
      await db.collection("sales_intelligence_sync_state").insertOne({ scope, cursor: { entity_change_applied_at: at(1), entity_change_id: new ObjectId() } });
    }
    const big = String(new ObjectId()), small = String(new ObjectId());
    const hotObservation = new ObjectId();
    await db.collection("granot_observations").insertOne({ _id: hotObservation });
    const change = (lead: string, revision: number, hoursAgo: number, over: Record<string, unknown> = {}) => ({
      _id: new ObjectId(), entity: { model: "CallLead", id: lead }, command_execution_id: new ObjectId(), command_name: "synchronizeLeadFromGranot",
      provenance: { source_system: "granot", receipt_id: new ObjectId(), observation_id: new ObjectId(), decision_id: new ObjectId() },
      changed_paths: ["current_move_provenance", "last_accepted_granot_observation"],
      fields: [{ path: "current_move_provenance", value_mode: "reference_only" }, { path: "last_accepted_granot_observation", value_mode: "reference_only" }],
      revision_before: revision - 1, revision_after: revision, applied_at: at(hoursAgo), ...over });
    // Big Lead: creation (r1), 61 incident revisions r2..r62; the newest 50 are r13..r62, so r2..r12 are outside; r5 cites a hot Observation.
    const rows = [change(big, 1, 900, { command_name: "createLeadFromGranot", changed_paths: ["job_no"] })];
    for (let r = 2; r <= 62; r++) rows.push(change(big, r, 900 - r, r === 5 ? { provenance: { source_system: "granot", observation_id: hotObservation } } : {}));
    for (let r = 1; r <= 5; r++) rows.push(change(small, r, 800 - r)); // fewer than 50 rows: all kept
    await db.collection("entity_changes").insertMany(rows);
    const expected = rows.filter((r) => r.entity.id === big && r.revision_after >= 2 && r.revision_after <= 12 && r.revision_after !== 5);
    const before = new Map((await db.collection("entity_changes").find({}, { raw: true }).toArray() as unknown as Buffer[]).map((raw) => [String(BSON.deserialize(raw)._id), Buffer.from(raw)]));
    const options = { prefix: CLOUD_STORAGE_NAMESPACES["domain-records-retirement"].prefix, reuse: { mode: "refuse_released" as const },
      sealedNames: CLOUD_STORAGE_NAMESPACES["domain-records-retirement"].sealedNames };

    // 1. Storage failure: nothing deleted, cursor unchanged, lease released.
    const broken = createFakeObjectStore(options).store;
    await assert.rejects(retireIncidentEntityChanges(db, { now, store: { ...broken, put: async () => { throw new Error("gcs down"); } } }));
    assert.equal(await db.collection("entity_changes").countDocuments(), rows.length);
    const afterFailure = await controls.findOne({ _id: ENTITY_CHANGE_RETIREMENT_CONTROL_ID });
    assert.equal(afterFailure?.cursor, null); assert.equal(afterFailure?.lease_owner, null);

    // 2. A run deletes exactly the ten proven rows and keeps everything else.
    const { store, bucket } = createFakeObjectStore(options);
    const run = await retireIncidentEntityChanges(db, { now, store });
    assert.deepEqual([run.rows, run.retire, run.deleted, run.packs], [66, 10, 10, 1]);
    // Holds: big r13..r61 and small r2..r4 (newest 50), both latest rows, small r1 (creation shape), big r5 (hot Observation).
    assert.deepEqual(run.held_reasons, { newest_50: 52, latest_revision: 2, not_incident_revision: 1, granot_record_hot: 1 });
    const left = new Set((await db.collection("entity_changes").find({}, { projection: { _id: 1 } }).toArray()).map((d) => String(d._id)));
    for (const r of rows) assert.equal(left.has(String(r._id)), !expected.includes(r), `r${r.revision_after} of ${r.entity.id === big ? "big" : "small"}`);
    const [pack] = await db.collection(ENTITY_CHANGE_ARCHIVE_PACKS_COLLECTION).find().toArray();
    assert.ok(pack && pack.rows === 10 && pack.entity_ids.length === 1 && pack.entity_ids[0] === big && pack.expires_at > now);
    assert.ok((await bucket.stat(pack.name))?.customTime, "the pack's 90-day clock started at creation");

    // 3. Restore byte for byte by `_id`, and by Call Lead for the timelines.
    const found = await lookupArchivedEntityChange(db, String(expected[0]!._id), store);
    assert.ok(found && Buffer.from(BSON.serialize(found.doc)).equals(before.get(String(expected[0]!._id))!), "restored byte for byte");
    const byLead = await readArchivedEntityChanges(db, [{ model: "CallLead", id: big }, { model: "CallLead", id: small }], { store });
    assert.deepEqual(byLead.map((d) => d.revision_after).sort((a, b) => a - b), expected.map((r) => r.revision_after));

    // 4. That run finished the pass, so the next one rests; a day later the next pass re-reviews the held rows and changes nothing.
    assert.ok(run.pass_completed);
    assert.equal((await retireIncidentEntityChanges(db, { now, store })).status, "resting");
    const later = new Date(+now + 25 * hour);
    await db.collection("sales_intelligence_sync_state").updateMany({}, { $set: { "cursor.entity_change_applied_at": later } });
    const again = await retireIncidentEntityChanges(db, { now: later, store });
    assert.deepEqual([again.rows, again.retire, again.deleted, again.packs], [56, 0, 0, 0]);
    console.log(JSON.stringify({ ok: true, database, run, pack: { rows: pack.rows, size: pack.size } }));
  } finally {
    await db.dropDatabase();
    await mongoose.disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
