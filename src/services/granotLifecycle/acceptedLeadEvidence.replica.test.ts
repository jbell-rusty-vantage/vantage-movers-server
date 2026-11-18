import { inspectPoolCandidate } from "../salesOutreach/pool/admission";
import { pointReceiptToDecision } from "./receiptDecisionPointer";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Types } from "mongoose";
import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../../db";
import { getFormLeadModel } from "../../models/FormLead";
import { getGranotObservationModel } from "../../models/GranotObservation";
import { getSynchronizationDecisionModel } from "../../models/SynchronizationDecision";
import { finalizeReceiptClaim } from "./drainer";

test("certification records the winning Lead only and rolls back on failed receipt finalization", async (t) => {
  if (process.env.GRANOT_LIFECYCLE_REPLICA_TESTS !== "true") return t.skip("requires disposable replica");
  assert.equal(process.env.TEST_MODE, "true");
  assert.match(process.env.MONGO_URI ?? "", /^mongodb:\/\/127\.0\.0\.1:/);
  await connectMongo();
  t.after(() => mongoose.disconnect());
  const db = mongoose.connection.db!;
  assert.match(db.databaseName, /^testvantagemovers_/);
  const leads = db.collection(getFormLeadModel().collection.name);
  const observations = db.collection(getGranotObservationModel().collection.name);
  const decisions = db.collection(getSynchronizationDecisionModel().collection.name);
  const oid = () => new Types.ObjectId();
  const lead = oid(), observation = oid(), receipt = oid(), decision = oid(), when = new Date();
  const company = oid(), feed = oid(), crm = oid();
  const job = "P" + BigInt("0x" + String(lead)).toString();
  const scope = { lead_source_company:company, source_granularity_id:feed, granot_crm_source_id:crm, policy_version:"v1" };
  await db.collection("lead_source_companies").insertOne({_id:company,company_slug:String(company),active:true});
  await db.collection("lead_source_granularities").insertOne({_id:feed,granularity_key:String(feed),source_company:company,active:true,channel:"form"});
  await db.collection("granot_crm_sources").insertOne({_id:crm,lead_source_company:company,enabled:true,lifecycle_enabled:true,lifecycle_disposition:"source_scoped_lead",
    lifecycle_policy_version:"v1",lifecycle_routes:[{lead_model:"FormLead",source_granularity_id:feed}]});
  await db.collection("granot_record_links").insertOne({provider:"granot",state:"active",normalized_job_no:job,
    lead_ref:{model:"FormLead",id:lead},source_scope:scope,domain_revision:1});
  const winner = { observation_id: observation, captured_at: when };
  await leads.insertOne({ _id: lead, granot_priority:"9", job_no:job, normalized_job_no:job, domain_revision:1, lead_source_company:company, source_granularity_id:feed, last_accepted_granot_observation: winner });
  await observations.insertOne({ _id: observation, receipt_id: receipt, captured_at: when, normalization_result: "valid", priority: { valid: true, canonical: "9" }, identity: { normalized_job_no: job } });
  const receipts = db.collection("granot_webhook_receipts");
  await receipts.insertOne({ _id: receipt, processing: { state: "completed", latest_decision_id: decision } });
  const target = { model: "FormLead" as const, id: String(lead) };
  await decisions.insertOne({ _id: decision, execution_mode: "live", outcome: "already_current", observation_id: observation, target, source_scope: scope });
  const before = await inspectPoolCandidate(target);
  assert.equal(before.eligible, true, before.reason ?? "eligible");
  const result = { observation_id: String(observation), decision_id: String(decision), outcome: "already_current" as const, target, effects: [] };
  const read = async () => (await leads.findOne({ _id: lead }))?.last_accepted_granot_observation;
  await receipts.updateOne({ _id: receipt }, { $set: { "processing.state": "claimed", "processing.lease_owner": "owner" } });
  const completion = { $set: { "processing.state": "completed", "processing.latest_decision_id": decision },
    $unset: { "processing.lease_owner": "" } };
  assert.equal(await finalizeReceiptClaim(receipt, "lost-owner", completion, result), false);
  assert.equal((await read()).evidence, undefined);
  assert.equal((await receipts.findOne({ _id: receipt }))?.processing.state, "claimed");
  await assert.rejects(finalizeReceiptClaim(receipt, "owner", {
    ...completion, $set: { ...completion.$set, payload: "immutable" },
  }, result), /processing/);
  assert.equal((await read()).evidence, undefined);
  assert.equal((await receipts.findOne({ _id: receipt }))?.processing.state, "claimed");
  let receiptUpdates = 0;
  const previousDebug = mongoose.get("debug");
  mongoose.set("debug", (collection, method) => {
    if (collection === receipts.collectionName && method === "updateOne") receiptUpdates++;
  });
  try {
    assert.equal(await finalizeReceiptClaim(receipt, "owner", completion, result), true);
    assert.equal(receiptUpdates, 1);
  } finally {
    mongoose.set("debug", previousDebug ?? false);
  }
  const completed = await receipts.findOne({ _id: receipt });
  assert.equal(completed?.processing.state, "completed");
  assert.deepEqual(completed?.processing.certified_lead, { model: target.model, id: lead, decision_id: decision });
  assert.equal((await read()).evidence.normalized_job_no, job);
  const old = await observations.findOneAndDelete({_id:observation});
  assert.ok(old);
  const after = await inspectPoolCandidate(target);
  assert.deepEqual(after.anchor, before.anchor);
  assert.equal(after.eligible, true);
  await db.collection("granot_crm_sources").updateOne({_id:crm},{$set:{enabled:false}});
  assert.equal((await inspectPoolCandidate(target)).reason,"source_policy_unavailable");
  await observations.insertOne(old);
  await withTransaction(s => pointReceiptToDecision(receipt, oid(), s));
  assert.equal((await read()).evidence, undefined);
  await leads.updateOne({ _id: lead }, { $set: { last_accepted_granot_observation: { observation_id: oid(), captured_at: new Date(+when + 1) } } });
  await receipts.updateOne({ _id: receipt }, { $set: { "processing.state": "claimed", "processing.lease_owner": "again" } });
  assert.equal(await finalizeReceiptClaim(receipt, "again", completion, result), true);
  assert.equal((await receipts.findOne({ _id: receipt }))?.processing.certified_lead, undefined);
  assert.equal((await read()).evidence, undefined);
});
