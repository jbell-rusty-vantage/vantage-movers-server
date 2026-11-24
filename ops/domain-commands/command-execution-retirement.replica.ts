/**
 * Domain Command receipt retirement (phase 2), end to end on the local replica (csi01, loopback only) with a fake bucket.
 *   node --import tsx ops/domain-commands/command-execution-retirement.replica.ts
 * Proves: a storage failure changes nothing; a run deletes only the processor receipt whose Granot sources are retired,
 * and keeps the external-ingestion receipt (billing evidence), a processor receipt whose receipt is hot, an Owner-keyed
 * Granot receipt, a receipt whose Lead is gone and an Admin receipt; a retired receipt restores byte for byte by `_id`; a later pass
 * changes nothing. Synthetic rows in `testvantagemovers_entchg`, dropped at the end.
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
  const { DOMAIN_COMMAND_EXECUTION_INDEXES } = await import("../../src/models/DomainCommandExecution.js");
  const { CLOUD_STORAGE_NAMESPACES, createFakeObjectStore } = await import("../../src/services/cloudStorage/index.js");
  const { COMMAND_EXECUTION_ARCHIVE_PACK_INDEXES, COMMAND_EXECUTION_ARCHIVE_PACKS_COLLECTION, COMMAND_EXECUTION_RETIREMENT_CONTROL_ID,
    lookupArchivedCommandExecution, retireProvenCommandExecutions } = await import("../../src/services/domainCommands/retirement/commandExecutions.js");
  const { createCatalogIndexes, RETIREMENT_CONTROL_COLLECTION } = await import("../../src/services/domainCommands/retirement/shared.js");
  await connectMongo();
  assert.equal(mongoose.connection.name, database);
  assert.match(process.env.MONGO_URI!, /^mongodb:\/\/127\.0\.0\.1:/, "loopback replica only");
  const db = mongoose.connection.db!;
  const executions = db.collection("domain_command_executions");
  try {
    await db.dropDatabase();
    for (const i of DOMAIN_COMMAND_EXECUTION_INDEXES) await executions.createIndex(i.key, { name: i.name, ...("unique" in i ? { unique: true } : {}) });
    await createCatalogIndexes(db, COMMAND_EXECUTION_ARCHIVE_PACKS_COLLECTION, COMMAND_EXECUTION_ARCHIVE_PACK_INDEXES);
    const controls = db.collection<{ _id: string; [k: string]: unknown }>(RETIREMENT_CONTROL_COLLECTION);
    await controls.insertOne({ _id: COMMAND_EXECUTION_RETIREMENT_CONTROL_ID, enabled_at: new Date(), cursor: null });
    const now = new Date(), old = new Date(+now - 3 * 86_400_000);
    const lead = new ObjectId(), link = new ObjectId(), goneLead = new ObjectId(), hotReceipt = new ObjectId();
    await db.collection("call_leads").insertOne({ _id: lead });
    await db.collection("form_leads").insertOne({ _id: lead });
    await db.collection("granot_record_links").insertOne({ _id: link });
    await db.collection("granot_webhook_receipts").insertOne({ _id: hotReceipt });
    const receipt = (origin: string, key: string, over: Record<string, unknown> = {}) => {
      const id = new ObjectId();
      return { _id: id, origin, idempotency_key: key, command_id: String(id), command_name: "synchronizeLeadFromGranot", payload_checksum: "a".repeat(64),
        actor: { actor_id: "granot-lifecycle-processor" }, initiator: {}, provenance: {}, entity_refs: [{ model: "CallLead", id: String(lead) }],
        warnings: [], applied_at: old, ...over };
    };
    const processor = (receiptId: ObjectId, refs = [{ model: "CallLead", id: String(lead) }, { model: "GranotRecordLink", id: String(link) }]) => {
      const observation = new ObjectId();
      return receipt("granot_lifecycle", `granot:synchronize-lead:${observation}`, { entity_refs: refs,
        provenance: { origin: "granot_lifecycle", source_receipt_id: String(receiptId), observation_id: String(observation) } });
    };
    const sheet = receipt("external_sheet_ingestion", "create_form_lead:forms:lead:1", { command_name: "createFormLead",
      actor: { actor_id: "best-relocation-ingestion" }, entity_refs: [{ model: "FormLead", id: String(lead) }] });
    const retired = processor(new ObjectId());
    const hot = processor(hotReceipt);
    const owner = receipt("granot_lifecycle", "4eddbefb-eeb4-4869-a39c-a0d3d07979e3", { command_name: "confirmGranotBooking" });
    const gone = processor(new ObjectId(), [{ model: "CallLead", id: String(goneLead) }]);
    const admin = receipt("vantage_admin", "request:createFormLead:x", { command_name: "createFormLead" });
    const rows = [sheet, retired, hot, owner, gone, admin];
    await executions.insertMany(rows);
    const before = new Map((await executions.find({}, { raw: true }).toArray() as unknown as Buffer[]).map((raw) => [String(BSON.deserialize(raw)._id), Buffer.from(raw)]));
    const options = { prefix: CLOUD_STORAGE_NAMESPACES["domain-records-retirement"].prefix, reuse: { mode: "refuse_released" as const },
      sealedNames: CLOUD_STORAGE_NAMESPACES["domain-records-retirement"].sealedNames };

    // 1. Storage failure: nothing deleted, cursor unchanged, lease released.
    const broken = createFakeObjectStore(options).store;
    await assert.rejects(retireProvenCommandExecutions(db, { now, store: { ...broken, put: async () => { throw new Error("gcs down"); } } }));
    assert.equal(await executions.countDocuments(), rows.length);
    const afterFailure = await controls.findOne({ _id: COMMAND_EXECUTION_RETIREMENT_CONTROL_ID });
    assert.equal(afterFailure?.cursor, null); assert.equal(afterFailure?.lease_owner, null);

    // 2. A run deletes exactly the one proven receipt (the Admin receipt is never read).
    const { store, bucket } = createFakeObjectStore(options);
    const run = await retireProvenCommandExecutions(db, { now, store });
    assert.deepEqual([run.rows, run.retire, run.deleted, run.packs, run.pass_completed], [5, 1, 1, 1, true]);
    assert.deepEqual(run.held_reasons, { billing_evidence_best_relocation: 1, source_receipt_hot: 1, key_not_receipt_bound: 1, entity_ref_missing: 1 });
    const left = new Set((await executions.find({}, { projection: { _id: 1 } }).toArray()).map((d) => String(d._id)));
    for (const r of rows) assert.equal(left.has(String(r._id)), r !== retired, r.idempotency_key);
    const [pack] = await db.collection(COMMAND_EXECUTION_ARCHIVE_PACKS_COLLECTION).find().toArray();
    assert.ok(pack && pack.rows === 1 && pack.origins.granot_lifecycle === 1 && !pack.origins.external_sheet_ingestion && pack.expires_at > now);
    assert.ok((await bucket.stat(pack.name))?.customTime, "the pack's 90-day clock started at creation");

    // 3. Restore byte for byte by `_id`.
    const found = await lookupArchivedCommandExecution(db, String(retired._id), store);
    assert.ok(found && Buffer.from(BSON.serialize(found.doc)).equals(before.get(String(retired._id))!), "restored byte for byte");

    // 4. A pass a day later re-reviews the held receipts and changes nothing.
    const later = new Date(+now + 25 * 3_600_000);
    assert.equal((await retireProvenCommandExecutions(db, { now, store })).status, "resting");
    const again = await retireProvenCommandExecutions(db, { now: later, store });
    assert.deepEqual([again.rows, again.retire, again.deleted, again.packs], [4, 0, 0, 0]);
    console.log(JSON.stringify({ ok: true, database, run, pack: { rows: pack.rows, size: pack.size } }));
  } finally {
    await db.dropDatabase();
    await mongoose.disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
