import assert from "node:assert/strict";
import { MongoClient, ObjectId } from "mongodb";
import { installRetention } from "./granot-retention-install";
import {
  policies,
  runFutureRetention,
} from "../src/services/granotHistory/futureRetention";
import { archivedChains } from "../src/services/granotHistory/archiveReads";
import { readClosedRun } from "../src/services/granotHistory/closedAutomationRun";

async function main() {
  const client = new MongoClient(
    "mongodb://127.0.0.1:27961/?replicaSet=storageRs",
    { serverSelectionTimeoutMS: 3000 },
  );
  try {
    const db = client.db(
        "testvantagemovers_ret" + new ObjectId().toHexString(),
      ),
      now = new Date(),
      day = 86400000;
    const run = new ObjectId().toHexString(),
      job = "TEST" + Date.now(),
      lead = new ObjectId();
    const collections = [
      "granot_webhook_receipts",
      "granot_observations",
      "synchronization_decisions",
    ];
    for (const name of collections) await db.createCollection(name);
    await db
      .collection(collections[0])
      .createIndex(
        { observation_channel: 1, channel_operation_id: 1 },
        {
          unique: true,
          partialFilterExpression: {
            channel_operation_id: { $type: "string" },
          },
          name: "granot_observation_receipt_channel_operation_id_unique",
        },
      );
    await installRetention(db, new Date(+now - 14 * day));
    const receipts: ObjectId[] = [];
    for (const [i, age] of [10, 9, 35].entries()) {
      const at = new Date(+now - age * day),
        r = new ObjectId(),
        o = new ObjectId(),
        d = new ObjectId();
      receipts.push(r);
      await db
        .collection(collections[0])
        .insertOne({
          _id: r,
          createdAt: at,
          captured_at: at,
          observation_channel: "granot_http_automation",
          channel_operation_id: run + ":" + i,
          channel_operation_kind: "lead_snapshot_apply",
          payload_sha256: "a".repeat(64),
          processing: {
            state: "completed",
            completed_at: at,
            latest_decision_id: d,
            retention_review_at: now,
          },
        });
      await db
        .collection(collections[1])
        .insertOne({
          _id: o,
          receipt_id: r,
          captured_at: at,
          identity: { normalized_job_no: job },
          priority: { valid: true, canonical: "9" },
          kind: "lead_snapshot",
        });
      await db
        .collection(collections[2])
        .insertOne({
          _id: d,
          observation_id: o,
          attempt: 1,
          execution_mode: "live",
          outcome: "already_current",
          target: { model: "FormLead", id: String(lead) },
          effects: [],
          decided_at: at,
        });
      if (i === 1)
        await db
          .collection("sales_outreach_pool_work")
          .insertOne({ episodes: [{ observation_id: o }] });
    }
    await db
      .collection("form_leads")
      .insertOne({
        _id: lead,
        last_accepted_granot_observation: {
          observation_id: new ObjectId(),
          captured_at: now,
        },
      });
    const shadow = await runFutureRetention(db, now);
    assert.equal(shadow.status, "shadow");
    assert.equal(shadow.archived, 1);
    assert.equal(shadow.stamped, 0);
    for (const name of collections)
      assert.equal(
        await db
          .collection(name)
          .countDocuments({ retention_purge_at: { $exists: true } }),
        0,
      );
    await policies(db).updateOne({ _id: "v1" }, { $set: { mode: "future" } });
    await db
      .collection(collections[0])
      .updateMany(
        { _id: { $in: receipts } },
        { $set: { "processing.retention_review_at": now } },
      );
    const active = await runFutureRetention(db, now);
    assert.equal(active.status, "future");
    assert.equal(active.stamped, 1);
    const rows = [];
    for await (const batch of archivedChains(db, job)) rows.push(...batch);
    assert.equal(rows.length, 1);
    assert.equal(String(rows[0].receipt._id), String(receipts[0]));
    assert.equal((await readClosedRun(db, run))?.length, 3);
    for (const id of receipts.slice(1))
      assert.ok(
        await db
          .collection(collections[0])
          .findOne({ _id: id, retention_purge_at: { $exists: false } }),
      );
    console.log(
      JSON.stringify({
        database: db.databaseName,
        shadow,
        active,
        protected: ["historic", "Pool episode"],
        archiveAndReplayVerified: true,
      }),
    );
  } finally {
    await client.close();
  }
}
main().catch((e) => {
  console.error(e.name, e.message);
  process.exitCode = 1;
});
