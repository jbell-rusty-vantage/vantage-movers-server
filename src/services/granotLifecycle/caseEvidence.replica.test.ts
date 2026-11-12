import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose, { Types } from "mongoose";
import { connectMongo, withTransaction } from "../../db";
import { preserveCaseEvidence, readCaseDecision, readCaseObservation, readCaseStatement } from "./caseEvidence";

test("case evidence survives removal of the hot originals and an aborted pin leaves no copies", async t => {
  if (process.env.GRANOT_LIFECYCLE_REPLICA_TESTS !== "true") return t.skip("requires disposable replica");
  assert.equal(process.env.TEST_MODE, "true");
  assert.match(process.env.MONGO_URI ?? "", /^mongodb:\/\/127\.0\.0\.1:/);
  await connectMongo();
  t.after(() => mongoose.disconnect());
  const db = mongoose.connection.db!;
  assert.match(db.databaseName, /^testvantagemovers_/);
  const obs = new Types.ObjectId(), receipt = new Types.ObjectId(), decision = new Types.ObjectId();
  const payload = { event_type: "Booked", provider_extra: "preserve this" };
  const inputs = [
    { name: "granot_webhook_receipts", doc: { _id: receipt, observation_channel: "granot_webhook", payload } },
    { name: "granot_observations", doc: { _id: obs, receipt_id: receipt, captured_at: new Date(), booking_action: { normalized: "booked" } } },
    { name: "synchronization_decisions", doc: { _id: decision, observation_id: obs, execution_mode: "live", reason_code: "booking_case_opened" } },
  ];
  for (const input of inputs) await db.collection(input.name).insertOne(input.doc);
  await assert.rejects(withTransaction(async session => {
    await preserveCaseEvidence(obs, decision, session);
    throw new Error("abort case");
  }), /abort case/);
  assert.equal(await db.collection("granot_case_observations").findOne({ _id: obs }), null);
  await withTransaction(s => preserveCaseEvidence(obs, decision, s));
  await withTransaction(s => preserveCaseEvidence(obs, decision, s));
  for (const input of inputs) await db.collection(input.name).deleteOne({ _id: input.doc._id });
  assert.deepEqual((await readCaseStatement(receipt))?.payload, payload);
  assert.equal((await readCaseObservation(obs))?.booking_action?.normalized, "booked");
  assert.equal((await withTransaction(s => readCaseDecision(decision, s)))?.reason_code, "booking_case_opened");
});
