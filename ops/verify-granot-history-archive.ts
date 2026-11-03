import assert from "node:assert/strict";
import { MongoClient, ObjectId } from "mongodb";
import { publishArchiveChunk } from "../src/services/granotHistory/publishArchiveChunk";
import { recentHistoryObservations } from "../src/services/granotHistory/archiveReads";
import { JobTimelineEvidenceLimitError, loadJobNumberTimelineRows } from "../src/services/jobNumberTimeline/mongo-evidence-loader";

async function verify() {
  const client = new MongoClient("mongodb://127.0.0.1:27961/?replicaSet=storageRs", { serverSelectionTimeoutMS: 2000 });
  try {
    const db = client.db("testvantagemovers_storage");
    const suffix = String(Date.now()), job = "A" + suffix;
    const chain = (offset: number, jobNo = job) => {
      const receipt = new ObjectId(), observation = new ObjectId();
      return { observation: { _id: observation, receipt_id: receipt, identity: { normalized_job_no: jobNo },
        captured_at: new Date(Date.now() + offset), kind: "lead_snapshot", normalization_result: "valid" },
        receipt: { _id: receipt, captured_at: new Date(), observation_channel: "granot_http_automation", processing: { state: "completed" } },
        decisions: [{ _id: new ObjectId(), observation_id: observation, outcome: "already_current", decided_at: new Date(), attempt: 1 }] };
    };
    const shared = chain(-5000), hot = chain(0), alias = chain(-9000, suffix);
    const published = await publishArchiveChunk(db, job, [shared]);
    assert.equal((await publishArchiveChunk(db, job, [shared])).inserted, false);
    await publishArchiveChunk(db, suffix, [alias]);
    for (const item of [shared, hot]) {
      await db.collection("granot_observations").insertOne(item.observation);
      await db.collection("granot_webhook_receipts").insertOne(item.receipt);
      await db.collection("synchronization_decisions").insertMany(item.decisions);
    }
    const inspect = async () => {
      const rows = await loadJobNumberTimelineRows(db, job);
      assert.equal(rows.observations?.length, 3);
      assert.equal(rows.decisions?.length, 3);
      assert.equal(rows.observation_receipts?.length, 3);
      await assert.rejects(loadJobNumberTimelineRows(db, job, { maxRowsPerQuery: 2 }), JobTimelineEvidenceLimitError);
      const hotRows = await db.collection("granot_observations").find({ "identity.normalized_job_no": job }).toArray();
      const recent = await recentHistoryObservations(db, job, hotRows, 20);
      assert.deepEqual(recent.map(x => String(x._id)), [hot, shared].map(c => String(c.observation._id)));
    };
    await inspect();
    await db.collection("granot_observations").deleteOne({ _id: shared.observation._id });
    await db.collection("granot_webhook_receipts").deleteOne({ _id: shared.receipt._id });
    await db.collection("synchronization_decisions").deleteOne({ _id: shared.decisions[0]._id });
    await inspect();
    console.log(JSON.stringify({ database: db.databaseName, chunkBytes: published.bytes, duplicateAndColdOnlyParity: true }));
  } finally { await client.close(); }
}
verify().catch(error => { console.error(error.name, error.message); process.exitCode = 1; });
