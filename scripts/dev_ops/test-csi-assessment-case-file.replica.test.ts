/**
 * AC2-ASSESS K11 (Attention and Case File spec §4.10, §3.3) on the csi01 replica, with the real Case File
 * assembler. The final-UI seed (`testvantagemovers_finalui`) is copied, read-only, into a disposable database
 * (the dataset's `database` field is rewritten to it); nothing is written to the seed.
 *
 * - Flag on: seed assessments assemble a Case File (audience "assessment") with the catalog ids under each call.
 * - §3 Granot and §5 Outreach changes leave the assessment fingerprint unchanged; a customer-evidence change moves it.
 * - Assembling a context reads only.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { assembleAssessmentContext, type AssessmentContext } from "../../src/services/salesIntelligence/assessment/context";

const SEED = "testvantagemovers_finalui";
const WRITE_METHODS = /^(insert|update|replace|delete|findOneAndUpdate|findOneAndReplace|findOneAndDelete|findAndModify|bulkWrite|createIndex|drop|rename)/i;

test("AC2-ASSESS K11: Case File assessments on the seed copy; §3/§5 changes keep the fingerprint", { skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 300_000 }, async (t) => {
  const database = getMongoDatabaseName();
  assert.match(database, /^testvantagemovers_t4cassess[a-z0-9]+$/);
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  await connectMongo();
  const target = mongoose.connection.useDb(database, { useCache: true }).db!;
  const seed = mongoose.connection.useDb(SEED, { useCache: true }).db!;
  t.after(async () => { await target.dropDatabase(); await mongoose.disconnect(); });

  // Copy the seed (reads only on the seed) with its indexes.
  for (const info of await seed.listCollections().toArray()) {
    if (info.type === "view") continue;
    const rows = await seed.collection(info.name).find({}).toArray();
    const indexes = (await seed.collection(info.name).indexes()).filter(i => i.name !== "_id_");
    await target.createCollection(info.name).catch(() => undefined);
    for (const index of indexes) { const { key, name, v: _v, ns: _ns, ...options } = index as Record<string, unknown>; await target.collection(info.name).createIndex(key as never, { name: name as string, ...options }).catch(() => undefined); }
    if (rows.length) await target.collection(info.name).insertMany(rows.map(r => (r.database === SEED ? { ...r, database } : r)));
  }

  // Candidate subjects: Lead records whose Number has summarized conversations.
  const summarized = new Set((await target.collection("intelligence_evidence_snapshots").distinct("conversation_id", { source_type: "summary", artifact_key: { $type: "string" } })).map(String));
  const numbers = new Set((await target.collection("lead_conversations").find({ _id: { $in: [...summarized].map(id => new mongoose.Types.ObjectId(id)) } }).project({ contact_number_id: 1 }).toArray())
    .map(r => String(r.contact_number_id)));
  const records = (await target.collection("outreach_records").find({ "subject.kind": "lead", state: { $ne: "closed" } }).project({ _id: 1, primary_contact_number_id: 1, subject: 1 }).toArray())
    .filter(r => numbers.has(String(r.primary_contact_number_id)));
  assert.ok(records.length >= 1, "the seed has Lead subjects with summarized calls");

  const now = new Date();
  const contexts: Array<{ record: string; context: AssessmentContext }> = [];
  const ops: string[] = [];
  mongoose.set("debug", (collection: string, method: string) => { ops.push(`${collection}.${method}`); });
  for (const record of records.slice(0, 6)) {
    const context = await assembleAssessmentContext({ outreach_record_id: String(record._id), now, allow_lead_only: true }, undefined, undefined, { layout: "case_file" });
    if (!("skip" in context)) contexts.push({ record: String(record._id), context });
  }
  mongoose.set("debug", false);
  assert.deepEqual(ops.filter(op => WRITE_METHODS.test(op.split(".").at(-1)!)), [], `assembling contexts read only (${ops.length} ops)`);
  assert.ok(contexts.length >= 1);
  for (const { context } of contexts) {
    assert.equal(context.layout, "case_file");
    assert.match(context.prompt_payload.case_file!, /^CASE FILE \(data\) · /);
    assert.match(context.prompt_payload.case_file!, /§1 WHO AND WHAT/);
    assert.match(context.prompt_payload.case_file!, /§7 THIS RUN\nAssess: /);
    assert.doesNotMatch(context.prompt_payload.case_file!, /PRIOR ANALYSIS[\s\S]*Prior findings/, "the assessment audience lists no prior findings");
    const catalogIds = new Set(context.catalog.map(e => e.id));
    const cited = [...context.prompt_payload.case_file!.matchAll(/\[(e\d+)\]/g)].map(m => m[1]);
    assert.ok(cited.every(id => catalogIds.has(id)), "every [eN] under a call is a catalog id");
  }
  console.log(JSON.stringify({ k11_contexts: contexts.map(({ record, context }) => ({ record, bytes: context.case_file?.bytes, trimmed: context.case_file?.trimmed_steps,
    catalog: context.catalog.length, evidence_ids_in_file: new Set([...context.prompt_payload.case_file!.matchAll(/\[(e\d+)\]/g)].map(m => m[1])).size })) }));

  // K11 fingerprint scope on one subject: §3 (a newer accepted Granot observation) and §5 (a new open follow-up) keep it; a summary change moves it.
  // Prefer a subject whose Lead has accepted Granot history, so the §3 change is exercised.
  let pick = contexts[0];
  for (const candidate of contexts) {
    const row = await target.collection("outreach_records").findOne({ _id: new mongoose.Types.ObjectId(candidate.record) });
    const leadRow = await target.collection(row!.subject.model === "CallLead" ? "call_leads" : "form_leads").findOne({ _id: row!.subject.id });
    if (leadRow?.normalized_job_no && await target.collection("granot_observations").findOne({ "identity.normalized_job_no": leadRow.normalized_job_no,
      normalization_result: { $in: ["valid", "valid_with_issues"] } })) { pick = candidate; break; }
  }
  const { record, context: before } = pick;
  const recordRow = await target.collection("outreach_records").findOne({ _id: new mongoose.Types.ObjectId(record) });
  const reassemble = async () => { const c = await assembleAssessmentContext({ outreach_record_id: record, now, allow_lead_only: true }, undefined, undefined, { layout: "case_file" }); assert.ok(!("skip" in c)); return c; };
  // §5: an open system_default follow-up on the record.
  await target.collection("outreach_followups").insertOne({ outreach_record_id: recordRow!._id, commitment_key: `t4c-assess:${record}`, kind: "call", description: "Follow up on the quote",
    status: "open", due_at: new Date(+now - 3_600_000), origin: "system_default", date_resolution: { precision: "day", timezone: "America/New_York" }, trigger_interaction_ids: [], owner_instruction_ids: [],
    source_finding_ids: [], revision: 1, createdAt: new Date(+now - 7_200_000), updatedAt: new Date(+now - 7_200_000) });
  // §3: a newer accepted Granot observation for the subject's Lead Job Number with a new estimate.
  const lead = await target.collection(recordRow!.subject.model === "CallLead" ? "call_leads" : "form_leads").findOne({ _id: recordRow!.subject.id });
  const jobNo = lead?.normalized_job_no ?? null;
  const template = jobNo ? await target.collection("granot_observations").findOne({ "identity.normalized_job_no": jobNo, normalization_result: { $in: ["valid", "valid_with_issues"] } }, { sort: { captured_at: -1 } }) : null;
  if (template) await target.collection("granot_observations").insertOne({ ...template, _id: new mongoose.Types.ObjectId(), receipt_id: new mongoose.Types.ObjectId(),
    captured_at: new Date(+now - 1_800_000), display_money: { ...(template.display_money ?? {}), estimate: { raw: "4321.00" } } });
  const after35 = await reassemble();
  assert.notEqual(after35.case_file!.digest, before.case_file!.digest, "the rendered Case File changed (§5, and §3 when the Lead has Granot history)");
  assert.equal(after35.case_file!.customer_evidence_digest, before.case_file!.customer_evidence_digest);
  assert.equal(after35.fingerprint, before.fingerprint, "K11: §3/§5 changes keep the assessment fingerprint");
  if (template) assert.match(after35.prompt_payload.case_file!, /\$4,321/);
  // Customer evidence: the canonical summary of one of the Number's calls changes.
  const conversation = await target.collection("lead_conversations").findOne({ contact_number_id: recordRow!.primary_contact_number_id, _id: { $in: [...summarized].map(id => new mongoose.Types.ObjectId(id)) } });
  await target.collection("intelligence_evidence_snapshots").updateMany({ source_type: "summary", conversation_id: conversation!._id },
    { $set: { "response.analysis_summary.summary.overview": "The customer says the move is now in December." } });
  const afterSummary = await reassemble();
  assert.notEqual(afterSummary.case_file!.customer_evidence_digest, before.case_file!.customer_evidence_digest, "a call summary is customer evidence");
  assert.notEqual(afterSummary.fingerprint, before.fingerprint);
  console.log(JSON.stringify({ k11_scope: { record, granot_observation_added: Boolean(template), before: before.fingerprint.slice(0, 12), after_s3_s5: after35.fingerprint.slice(0, 12),
    after_summary: afterSummary.fingerprint.slice(0, 12), case_file_bytes: [before.case_file!.bytes, after35.case_file!.bytes, afterSummary.case_file!.bytes] } }));

  // Flag off on the same subject: legacy payload, no Case File.
  const legacy = await assembleAssessmentContext({ outreach_record_id: record, now, allow_lead_only: true }, undefined, undefined, { layout: "legacy" });
  assert.ok(!("skip" in legacy) && !("case_file" in legacy.prompt_payload) && legacy.layout === "legacy");
});
