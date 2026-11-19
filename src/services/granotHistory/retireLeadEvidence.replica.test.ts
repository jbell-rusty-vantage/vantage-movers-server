import assert from "node:assert/strict";
import test from "node:test";
import { MongoClient, ObjectId } from "mongodb";
import { readEvidenceIds } from "./evidencePage";
import { policies, runFutureRetention } from "./futureRetention";
import { closedRuns, packClosedRun } from "./closedAutomationRun";
import { digest } from "./archiveCodec";
import { retireLeadEvidence } from "./retireLeadEvidence";
import { readArchivedReceipt } from "./settledLeadEvidence";
import { loadClosedOperations } from "./prepareClosedRun";

test("evidence retirement preserves replay, original missing Decisions, and concurrent reference holds", async (t) => {
  if (process.env.GRANOT_ARCHIVE_REPLICA_TESTS !== "true")
    return t.skip("isolated archive replica");
  const client = new MongoClient(
    "mongodb://127.0.0.1:27964/?replicaSet=archiveSlim",
    { serverSelectionTimeoutMS: 3000 },
  );
  const db = client.db("testvantagemovers_evidence" + new ObjectId());
  try {
    assert.deepEqual((await db.admin().command({ hello: 1 })).hosts, [
      "127.0.0.1:27964",
    ]);
    const hot = db.collection("granot_webhook_receipts"),
      obs = db.collection("granot_observations"),
      ds = db.collection("synchronization_decisions");
    await hot.createIndex(
      { observation_channel: 1, channel_operation_id: 1 },
      { name: "granot_observation_receipt_channel_operation_id_unique" },
    );
    const run = String(new ObjectId()),
      at = new Date(Date.now() - 2 * 86400000);
    async function seed(orphan = false, priority = "1", winner = false) {
      const d = new ObjectId(),
        o = new ObjectId(),
        r = new ObjectId(),
        lead = new ObjectId(),
        target = { model: "FormLead", id: String(lead) };
      const replay = {
        decision_id: String(d),
        observation_id: String(o),
        outcome: "already_current",
        target,
        effects: [],
      };
      await hot.insertOne({
        _id: r,
        captured_at: at,
        createdAt: at,
        observation_channel: "granot_http_automation",
        channel_operation_kind: "lead_snapshot_apply",
        channel_operation_id: (orphan ? String(new ObjectId()) : run) + ":" + o,
        payload_sha256: "a".repeat(64),
        processing: {
          latest_decision_id: d,
          state: "completed",
          completed_at: at,
          replay_result: replay,
        },
      });
      await obs.insertOne({
        _id: o,
        receipt_id: r,
        identity: { normalized_job_no: "T-7145" },
        kind: "lead_snapshot",
        priority: { valid: true, canonical: priority },
        captured_at: at,
      });
      if (!orphan)
        await ds.insertOne({
          _id: d,
          observation_id: o,
          outcome: "already_current",
          effects: [],
          target,
          execution_mode: "live",
          decided_at: at,
        });
      await db.collection("form_leads").insertOne({
        _id: lead,
        last_accepted_granot_observation: {
          observation_id: winner ? o : new ObjectId(),
          captured_at: new Date(),
        },
      });
      return { o, d, r };
    }
    const normal = await seed(),
      orphan = await seed(true),
      edited = await seed(),
      p5 = await seed(false, "5"),
      active = await seed(false, "2", true);
    const blobs = new Map<string, Buffer>();
    const read = async (_db: string, hash: string, generation?: string) => {
      assert.equal(generation, "123");
      return Buffer.from(blobs.get(hash)!);
    };
    await assert.rejects(
      retireLeadEvidence(db, async () => {
        throw Error("GCS unavailable");
      }),
    );
    assert.equal(await obs.countDocuments(), 5);
    const result = await retireLeadEvidence(db, async (_db, bytes) => {
      const hash = digest(bytes);
      blobs.set(hash, bytes);
      await db
        .collection("lead_messages")
        .insertOne({ observation_id: edited.o });
      return { hash, generation: "123", persisted: Buffer.from(bytes) };
    });
    assert.equal(result.observations, 2);
    assert.equal(result.decisions, 1);
    for (const row of [edited, p5, active])
      assert.ok(await obs.findOne({ _id: row.o }));
    assert.equal(
      (await readArchivedReceipt(db, normal.r, read))?.decisions.length,
      1,
    );
    assert.equal(
      (await readArchivedReceipt(db, orphan.r, read))?.decisions.length,
      0,
    );
    assert.equal(
      (await loadClosedOperations(db, run, new Date())).reason,
      "ready",
    );
    const archivedDecisions = await readEvidenceIds(
      db,
      [normal.d, orphan.d, edited.d],
      "decision",
      undefined,
      read,
    );
    assert.deepEqual(
      archivedDecisions.map((d) => String(d._id)),
      [String(normal.d)],
    );
    assert.equal(
      (await readEvidenceIds(db, [orphan.o], "observation", undefined, read))
        .length,
      1,
    );
    await hot.updateOne(
      { _id: normal.r },
      { $set: { "processing.replay_result.outcome": "stale" } },
    );
    assert.equal(
      (await loadClosedOperations(db, run, new Date())).reason,
      "incomplete_evidence",
    );
    await hot.updateOne(
      { _id: normal.r },
      {
        $set: {
          "processing.replay_result.outcome": "already_current",
          "processing.retention_review_at": at,
        },
      },
    );
    await hot.createIndex(
      { "processing.retention_review_at": 1 },
      { name: "granot_retention_review_v1", sparse: true },
    );
    const closed = await loadClosedOperations(db, run, new Date());
    assert.ok(closed.reason === "ready");
    const bytes = packClosedRun(run, closed.rows),
      hash = digest(bytes);
    blobs.set(hash, bytes);
    await closedRuns(db).insertOne({
      _id: run,
      count: closed.rows.length,
      generation: "123",
      hash,
      closed_at: new Date(),
    });
    await policies(db).insertOne({
      _id: "v1",
      mode: "future",
      new_data_from: new Date(+at - 1000),
    });
    const sweep = await runFutureRetention(db, new Date(), undefined, {
      read,
      store: async () => {
        throw Error("archive already exists");
      },
    });
    assert.equal(sweep.stamped, 1);
    assert.ok(
      (await hot.findOne({ _id: normal.r }))?.retention_purge_at instanceof
        Date,
    );
    await hot.deleteOne({ _id: normal.r });
    assert.equal(
      (await readArchivedReceipt(db, normal.r, read))?.decisions.length,
      1,
    );
  } finally {
    await db.dropDatabase();
    await client.close();
  }
});
