import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { csiDataset } from "../../src/config/domain/salesIntelligence";
import { applyCsiMigration } from "../migrations/sales-intelligence.lib";
import { getContactNumberModel } from "../../src/models/ContactNumber";
import { getFormLeadModel } from "../../src/models/FormLead";
import { getOutreachRecordModel } from "../../src/models/OutreachRecord";
import { getIntelligenceRunModel } from "../../src/models/IntelligenceRun";
import { persistLeadAttachments } from "../../src/services/salesIntelligence/attachment/store";
import { ensureLead, workerContext } from "../../src/services/salesIntelligence/outreach/ensure";
import { readOutreach } from "../../src/services/salesIntelligence/outreach/reads";
import { outreachDetailDtoSchema } from "../../src/services/salesIntelligence/outreach/detailDto";
import { listOwnerRuns, readOwnerRun } from "../../src/services/salesIntelligence/analysis/ownerReads";
import { readContentSchema } from "../../src/services/salesIntelligence/analysis/reads";
import { payloadHash } from "../../src/services/salesIntelligence/transactions";

/** Every stage name and index name anywhere in an explain document (classic and SBE shapes). */
function planStages(node: unknown, out: { stages: string[]; indexes: string[] } = { stages: [], indexes: [] }) {
  if (Array.isArray(node)) node.forEach(n => planStages(n, out));
  else if (node && typeof node === "object") {
    const row = node as Record<string, unknown>;
    if (typeof row.stage === "string") out.stages.push(row.stage);
    if (typeof row.indexName === "string") out.indexes.push(row.indexName);
    for (const [key, value] of Object.entries(row)) if (key !== "rejectedPlans") planStages(value, out);
  }
  return out;
}

test("S3-READS replica: §4.1 detail additions (B21), D3 query count (B11), D12 order and plan", { skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 240000 }, async (t) => {
  assert.match(getMongoDatabaseName(), /^testvantagemovers_s3reads[a-z0-9]+$/);
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  t.after(async () => { mongoose.set("debug", false); await db.dropDatabase(); await mongoose.disconnect(); });
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  assert.equal((await applyCsiMigration()).ready, true);
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Network/provider access forbidden in S3-READS proof"); });
  const oid = () => new mongoose.Types.ObjectId();
  const at = new Date("2026-09-01T12:00:00Z"), minutes = (n: number) => new Date(+at + n * 60_000);
  const dataset = csiDataset();
  const runs = db.collection("intelligence_runs"), snapshots = db.collection("intelligence_evidence_snapshots");
  let serial = 0;

  async function leadFixture(extra: Record<string, unknown> = {}) {
    const n = await getContactNumberModel().create({ e164: `+120255503${String(++serial).padStart(2, "0")}`, digits_reversed: `s3r${serial}`, first_observed_at: at, last_activity_at: at });
    const lead = { _id: oid(), timestamp: at, createdAt: at, updatedAt: at, name: "Synthetic S3-READS", normalized_phone_number: n.e164,
      ingested_contact_snapshot: { normalized_phone_number: n.e164, captured_at: at }, receiver_agent: oid(), ...extra };
    await getFormLeadModel().collection.insertOne(lead);
    await withTransaction(async session => {
      await ensureLead({ model: "FormLead", id: String(lead._id) }, workerContext(session, String(oid()), at), String(n._id));
      await persistLeadAttachments(lead, "FormLead", session, String(oid()), at);
    });
    const record = await getOutreachRecordModel().findOne({ "subject.id": lead._id }).orFail().lean();
    return { n, lead, record };
  }
  const run = (numberId: unknown, fields: Record<string, unknown>) => ({ _id: oid(), ...dataset, subject_key: `number:${numberId}`, contact_number_id: numberId,
    conversation_id: null, mode: "initial", job_id: oid(), status: "completed", revision: 1, createdAt: at, updatedAt: at, completed_at: at, output: null, ...fields });

  await t.test("B21: latest_summary, newest_run_id and official for a Number run, then a conversation run", async () => {
    const f = await leadFixture({ granot_priority: "1" });
    assert.ok(f.record.primary_contact_number_id, "fixture has a primary Contact Number");
    // Before any analysis: explicit nulls, and the official status of an open Lead with its Priority.
    let detail = (await readOutreach(String(f.record._id)))!;
    outreachDetailDtoSchema.parse(detail.data.outreach);
    assert.equal(detail.data.outreach.newest_run_id, null);
    assert.equal(detail.data.outreach.latest_summary, null);
    assert.deepEqual(detail.data.outreach.official, { status: "open_lead", booking_id: null, priority: { code: "1", label: "Quoted" } });

    const longOverview = `${"The customer is moving a three-bedroom house from Austin to Denver in late October. ".repeat(3)}${"x".repeat(40)} tail sentence.`;
    const numberRun = run(f.n._id, { createdAt: minutes(10), completed_at: minutes(12), output: { summary: { overview: longOverview } },
      step_artifacts: { summaries: [oid(), oid()], context: oid() } });
    // Newer rows that must not win: still running, purged, another Number.
    await runs.insertMany([numberRun,
      run(f.n._id, { createdAt: minutes(30), status: "running", output: null }),
      run(f.n._id, { createdAt: minutes(31), output: { summary: { overview: "Purged." } }, purged_at: minutes(32) }),
      run(oid(), { createdAt: minutes(40), output: { summary: { overview: "Someone else." } } })]);
    detail = (await readOutreach(String(f.record._id)))!;
    outreachDetailDtoSchema.parse(detail.data.outreach);
    assert.equal(detail.data.outreach.newest_run_id, String(numberRun._id));
    const numberSummary = detail.data.outreach.latest_summary!;
    assert.equal(numberSummary.run_kind, "number");
    assert.equal(numberSummary.run_id, String(numberRun._id));
    assert.equal(numberSummary.completed_at, minutes(12).toISOString());
    assert.equal(numberSummary.conversations_covered, 2);
    assert.ok(numberSummary.overview.length <= 280 && numberSummary.overview.endsWith("October. …"), numberSummary.overview);

    const conversationRun = run(f.n._id, { createdAt: minutes(50), completed_at: minutes(51), conversation_id: oid(),
      output: { summary: { overview: "Customer confirmed the October date on the call." } }, step_artifacts: { summaries: [oid()] } });
    await runs.insertOne(conversationRun);
    await db.collection("booked_leads").insertOne({ _id: oid(), lead_model: "FormLead", lead_ref: f.lead._id, book_date: minutes(55), job_no: "S3R-1" });
    detail = (await readOutreach(String(f.record._id)))!;
    outreachDetailDtoSchema.parse(detail.data.outreach);
    assert.deepEqual(detail.data.outreach.latest_summary, { run_id: String(conversationRun._id), run_kind: "conversation", completed_at: minutes(51).toISOString(),
      overview: "Customer confirmed the October date on the call.", conversations_covered: 1 });
    assert.equal(detail.data.outreach.newest_run_id, String(conversationRun._id));
    // The exact booked_leads row makes it Booked even though the Lead's `booked` mirror is unset.
    assert.equal(detail.data.outreach.official?.status, "booked");
    assert.ok(detail.data.outreach.official?.booking_id);

    // Content purge pending on the Number hides the model text (same guard as readOwnerRun).
    await getContactNumberModel().updateOne({ _id: f.n._id }, { $set: { content_purge_pending: true } });
    detail = (await readOutreach(String(f.record._id)))!;
    assert.equal(detail.data.outreach.latest_summary, null);
    assert.equal(detail.data.outreach.newest_run_id, null);
    await getContactNumberModel().updateOne({ _id: f.n._id }, { $set: { content_purge_pending: false } });
  });

  await t.test("B11: readOwnerRun issues the same number of queries for 1 and 10 transcript-bearing snapshots", async () => {
    const number = await getContactNumberModel().create({ e164: "+12025550399", digits_reversed: "s3r-b11", first_observed_at: at, last_activity_at: at });
    const coverage = { known_through: null, gaps: [], capabilities: {}, ai_paused: false };
    async function seedRun(transcripts: number) {
      const runId = oid(), manifest: Array<{ _id: mongoose.Types.ObjectId; content_digest: string }> = [], sources = [];
      for (let i = 0; i < transcripts; i++) {
        const conversationId = oid(), sourceId = oid(), snapshotId = oid();
        sources.push({ _id: sourceId, ...dataset, run_id: null, conversation_id: conversationId, transcript_version: "v1", source_type: "transcript",
          source_id: String(conversationId), source_revision: "v1", subject_key: `conversation:${conversationId}`, arguments: {}, response: {}, content_digest: "x",
          retrieved_at: at, purged_at: null, purge_started_at: null });
        const response = readContentSchema.parse({ page: { records: [], next_cursor: null, complete: true, missing_ranges: [] }, coverage,
          allowed_followup_ids: [], instructions: [], speaker_refs: [],
          transcript: { conversation_id: String(conversationId), transcript_version: "v1", source_snapshot_id: String(sourceId), segments: [] } });
        manifest.push({ _id: snapshotId, content_digest: payloadHash(response) });
        await snapshots.insertOne({ _id: snapshotId, ...dataset, run_id: runId, conversation_id: null, transcript_version: null, source_type: "tool_response",
          tool_call_id: `call-${i}`, source_id: `call-${i}`, source_revision: "r", subject_key: `number:${number._id}`, arguments: {}, response,
          content_digest: payloadHash(response), retrieved_at: at, purged_at: null, purge_started_at: null });
      }
      await snapshots.insertMany(sources);
      manifest.sort((a, b) => String(a._id).localeCompare(String(b._id)));
      await runs.insertOne(run(number._id, { _id: runId, finalized_at: at, rendered_prompt: "synthetic", manifest_snapshot_ids: manifest.map(m => m._id),
        manifest_digest: payloadHash(manifest.map(m => ({ id: String(m._id), digest: m.content_digest }))) }));
      return { runId, sources };
    }
    const counted = async (id: string) => {
      const calls: string[] = [];
      mongoose.set("debug", (collection: string, method: string) => { calls.push(`${collection}.${method}`); });
      try { return { read: await readOwnerRun(id), calls }; } finally { mongoose.set("debug", false); }
    };
    const one = await seedRun(1), ten = await seedRun(10);
    const a = await counted(String(one.runId)), b = await counted(String(ten.runId));
    assert.equal(a.read?.data.original_evidence_available, true);
    assert.equal(b.read?.data.original_evidence_available, true);
    const snapshotReads = (calls: string[]) => calls.filter(c => c.startsWith("intelligence_evidence_snapshots.")).length;
    console.log(`B11 query count: 1 snapshot → ${a.calls.length} (${snapshotReads(a.calls)} snapshot reads); 10 snapshots → ${b.calls.length} (${snapshotReads(b.calls)} snapshot reads)`);
    console.log(`B11 queries (10): ${b.calls.join(", ")}`);
    assert.equal(b.calls.length, a.calls.length, "no per-snapshot query");
    assert.equal(snapshotReads(b.calls), snapshotReads(a.calls));
    // The one `$in` read still refuses a purged transcript source.
    await snapshots.updateOne({ _id: ten.sources[7]!._id }, { $set: { purged_at: at } });
    assert.equal((await readOwnerRun(String(ten.runId)))?.data.original_evidence_available, false);
  });

  await t.test("D12: listOwnerRuns is newest-first by (createdAt, _id), keyset-exact across ties, on csi_run_number with no blocking SORT", async () => {
    const number = oid();
    const tie = minutes(100);
    const rows = [run(number, { createdAt: minutes(90) }), run(number, { createdAt: tie }), run(number, { createdAt: tie }), run(number, { createdAt: tie }),
      run(number, { createdAt: minutes(110) }), run(number, { createdAt: minutes(80) }), run(number, { createdAt: minutes(120), status: "running" })];
    await runs.insertMany(rows);
    const expected = [...rows].sort((x, y) => (+y.createdAt - +x.createdAt) || (String(y._id) < String(x._id) ? -1 : 1)).map(r => String(r._id));
    for (const limit of [1, 2, 3, 4]) {
      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await listOwnerRuns({ contact_number_id: String(number), limit, ...(cursor ? { cursor } : {}) });
        seen.push(...page.data.items.map(i => i.id));
        cursor = page.data.next_cursor ?? undefined;
      } while (cursor);
      assert.deepEqual(seen, expected, `limit ${limit}`);
    }
    // A pre-D12 cursor (a bare run id) resolves to that run's keyset position; an unknown one is INVALID_INPUT.
    const fromLegacy = await listOwnerRuns({ contact_number_id: String(number), limit: 50, cursor: expected[2] });
    assert.deepEqual(fromLegacy.data.items.map(i => i.id), expected.slice(3));
    await assert.rejects(listOwnerRuns({ contact_number_id: String(number), cursor: String(oid()) }), /INVALID_INPUT/);
    // Completed-only still filters.
    assert.ok((await listOwnerRuns({ contact_number_id: String(number), status: "completed" })).data.items.every(i => i.status === "completed"));

    const model = getIntelligenceRunModel();
    const firstPage = await model.find({ ...dataset, contact_number_id: number }).sort({ createdAt: -1 }).limit(51).explain("queryPlanner") as unknown;
    const after = rows[4]!;
    const nextPage = await model.find({ ...dataset, contact_number_id: number, $or: [{ createdAt: { $lt: after.createdAt } }, { createdAt: after.createdAt, _id: { $lt: after._id } }] })
      .sort({ createdAt: -1 }).limit(51).explain("queryPlanner") as unknown;
    const newest = await model.findOne({ contact_number_id: number, status: "completed", ...dataset, output: { $ne: null }, purged_at: null, purge_started_at: null })
      .sort({ createdAt: -1, _id: -1 }).explain("queryPlanner") as unknown;
    for (const [name, plan] of [["list first page", firstPage], ["list keyset page", nextPage]] as const) {
      const winning = planStages((plan as { queryPlanner?: { winningPlan?: unknown } }).queryPlanner?.winningPlan ?? (Array.isArray(plan) ? (plan[0] as { queryPlanner?: { winningPlan?: unknown } }).queryPlanner?.winningPlan : plan));
      console.log(`D12 ${name}: stages ${winning.stages.join(" > ")}; indexes ${winning.indexes.join(", ")}`);
      assert.ok(winning.indexes.includes("csi_run_number"), `${name} uses csi_run_number`);
      assert.ok(!winning.stages.includes("SORT"), `${name} has no blocking SORT`);
    }
    const newestPlan = planStages((newest as { queryPlanner?: { winningPlan?: unknown } }).queryPlanner?.winningPlan ?? newest);
    console.log(`§4.1 newest_run_id: stages ${newestPlan.stages.join(" > ")}; indexes ${newestPlan.indexes.join(", ")}`);
    assert.ok(newestPlan.indexes.includes("csi_run_number"), "newest_run_id uses csi_run_number");
  });
});
