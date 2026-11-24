import assert from "node:assert/strict";
import test from "node:test";
import { ObjectId } from "mongodb";
import { readEvidenceIds } from "./evidencePage";
import { closedRuns, packClosedRun } from "./closedAutomationRun";
import { fakeGranotArchive, historyReplica } from "./archiveTestSupport";
import { retireLeadEvidence, selectLeadEvidence } from "./retireLeadEvidence";
import { PROVEN_WINNER_CONTROL } from "./provenWinners";
import { installRetiredOperationIndex, retireReceipt } from "./retireOnUse";
import { readGranotChain, readRetiredReceipt } from "./retiredRecords";
import { loadClosedOperations } from "./prepareClosedRun";

test("evidence retirement preserves replay, original missing Decisions, and concurrent reference holds", async (t) => {
  const replica = await historyReplica(t, "evidence");
  if (!replica) return;
  const { client, db } = replica;
  try {
    const hot = db.collection("granot_webhook_receipts"),
      obs = db.collection("granot_observations"),
      ds = db.collection("synchronization_decisions");
    await hot.createIndex(
      { observation_channel: 1, channel_operation_id: 1 },
      { name: "granot_observation_receipt_channel_operation_id_unique" },
    );
    await installRetiredOperationIndex(db, new Date(0)); // installed long ago, past the settle window
    const run = String(new ObjectId()),
      at = new Date(Date.now() - 2 * 86400000);
    // Proven-winner release (Owner decision 8): a current winner with its v2 proof, accepted at `when`.
    async function seed(orphan = false, priority = "1", winner = false, proof = false, when = at) {
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
        captured_at: when,
        createdAt: when,
        observation_channel: "granot_http_automation",
        channel_operation_kind: "lead_snapshot_apply",
        channel_operation_id: (orphan ? String(new ObjectId()) : run) + ":" + o,
        payload_sha256: "a".repeat(64),
        processing: {
          latest_decision_id: d,
          ...(proof ? { certified_lead: { model: "FormLead", id: lead, decision_id: d } } : {}),
          state: "completed",
          completed_at: when,
          replay_result: replay,
        },
      });
      await obs.insertOne({
        _id: o,
        receipt_id: r,
        identity: { normalized_job_no: "T-7145" },
        kind: "lead_snapshot",
        priority: { valid: true, canonical: priority },
        captured_at: when,
      });
      if (!orphan)
        await ds.insertOne({
          _id: d,
          observation_id: o,
          outcome: "already_current",
          reason_code: "desired_state_already_current",
          effects: [],
          target,
          execution_mode: "live",
          decided_at: when,
        });
      await db.collection("form_leads").insertOne({
        _id: lead,
        last_accepted_granot_observation: {
          observation_id: winner ? o : new ObjectId(),
          captured_at: winner ? when : new Date(),
          ...(proof ? { evidence: { version: 2, decision_id: d, receipt_id: r, source_scope: { granot_crm_source_id: new ObjectId() } } } : {}),
        },
      });
      return { o, d, r };
    }
    const normal = await seed(),
      orphan = await seed(true),
      edited = await seed(),
      p5 = await seed(false, "5"),
      active = await seed(false, "2", true);
    const old = new Date(Date.now() - 31 * 86400000);
    // Table: only a proven winner older than 30 days leaves; a young or unproven winner stays hot.
    const proven = await seed(false, "2", true, true, old),
      young = await seed(false, "2", true, true),
      unproven = await seed(false, "2", true, false, old),
      openCase = await seed(false, "2", true, true, old),
      resolvedCase = await seed(false, "2", true, true, old);
    // An open case keeps its proven winner hot; a resolved one does not.
    await db.collection("granot_booking_reconciliation_cases").insertMany([
      { state: "open", evidence: [{ observation_id: openCase.o }] },
      { state: "resolved", evidence: [{ observation_id: resolvedCase.o }] },
    ]);
    const page = await obs.find().sort({ _id: 1 }).toArray();
    const selected = async () => new Set((await selectLeadEvidence(db, page)).map((r) => String(r.chain.observation._id)));
    assert.equal((await selected()).has(String(proven.o)), false, "switch off keeps every winner");
    await db.collection("granot_retention_control").insertOne({ _id: PROVEN_WINNER_CONTROL as never, enabled_at: new Date() });
    assert.equal((await selected()).has(String(proven.o)), true);
    const { storage } = fakeGranotArchive();
    const read = storage.read;
    await assert.rejects(
      retireLeadEvidence(db, async () => {
        throw Error("GCS unavailable");
      }),
    );
    assert.equal(await obs.countDocuments(), 10);
    const result = await retireLeadEvidence(db, async (name, bytes) => {
      await db
        .collection("lead_messages")
        .insertOne({ observation_id: edited.o });
      return storage.store(name, bytes);
    }, read);
    assert.equal(result.observations, 4);
    assert.equal(result.decisions, 3);
    assert.equal(await obs.countDocuments({ _id: { $in: [proven.o, resolvedCase.o] } }), 0);
    for (const row of [edited, p5, active, young, unproven, openCase])
      assert.ok(await obs.findOne({ _id: row.o }));
    assert.equal(
      (await readGranotChain(db, normal.r, read))?.decisions.length,
      1,
    );
    assert.equal(
      (await readGranotChain(db, orphan.r, read))?.decisions.length,
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
      { $set: { "processing.replay_result.outcome": "already_current" } },
    );
    // Without its closed-run replay the HTTP receipt is not used yet: it fences re-application.
    assert.deepEqual(await retireReceipt(db, normal.r, storage), {
      status: "held", channel: "granot_http_automation", reason: "closed_run:unfinished_or_recent",
    });
    const closed = await loadClosedOperations(db, run, new Date());
    assert.ok(closed.reason === "ready");
    const object = await storage.store(db.databaseName, packClosedRun(run, closed.rows));
    await closedRuns(db).insertOne({
      _id: run,
      count: closed.rows.length,
      generation: object.generation,
      hash: object.hash,
      closed_at: new Date(),
    });
    assert.equal((await retireReceipt(db, normal.r, storage)).status, "retired");
    assert.equal(await hot.countDocuments({ _id: normal.r }), 0);
    const recovered = await readRetiredReceipt(db, normal.r, { read });
    assert.equal(String(recovered?._id), String(normal.r));
    assert.equal(recovered?.observation_channel, "granot_http_automation");
    assert.equal(recovered?.processing.state, "completed");
    assert.equal(
      (await readGranotChain(db, normal.r, read))?.decisions.length,
      1,
    );
  } finally {
    await db.dropDatabase();
    await client.close();
  }
});
