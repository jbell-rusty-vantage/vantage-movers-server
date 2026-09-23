import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { csiDataset } from "../../src/config/domain/salesIntelligence";
import { applyCsiMigration } from "../migrations/sales-intelligence.lib";
import { getContactNumberModel } from "../../src/models/ContactNumber";
import { getIntelligenceRunModel } from "../../src/models/IntelligenceRun";
import { getOutreachFollowupModel } from "../../src/models/OutreachFollowup";
import { getOutreachRecordModel } from "../../src/models/OutreachRecord";
import { payloadHash } from "../../src/services/salesIntelligence/transactions";
import { requireCsiOwner } from "../../src/services/salesIntelligence/auth";
import { computeAdminActorSignature } from "../../src/services/operationsRegistry/trustedActor";
import { commandAnalysis } from "../../src/services/salesIntelligence/analysis/ownerCommands";
import { outreachSuggestedNextStepDtoSchema } from "../../src/services/salesIntelligence/dto";
import { readOutreach } from "../../src/services/salesIntelligence/outreach/reads";
import { publishAttentionSnapshot, readAttention } from "../../src/services/salesIntelligence/outreach/attention";
import { legacyEnvelope } from "../../src/services/salesIntelligence/assessment/presentation.fixtures";
import { seedLead, seedNumber, seedRecord, seedSummaryConversation } from "./csi-move-assessment-fixtures";

/**
 * S1-SUGGEST replica proof (final spec §5.5 case 2): `outreach.suggested_next_step` on `GET /outreach/:id` and on the
 * published desk row, decided by the server from the newest completed run of the Number. Apply is enabled only when
 * `apply_suggestion` accepts it (a stale published pointer shows it blocked), the served fields drive the real command,
 * and the field disappears once applied (case 1, then the audit row after the follow-up is done). The publish reads the
 * runs once per page (one `intelligence_runs.aggregate`), whatever the row count.
 */
test("S1-SUGGEST card suggestion on the csi01 replica", { skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 300_000 }, async t => {
  assert.equal(process.env.TEST_MODE, "true");
  assert.match(getMongoDatabaseName(), /^testvantagemovers_s1suggest[a-f0-9]*$/);
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  t.after(async () => { mongoose.set("debug", false); await db.dropDatabase(); await mongoose.disconnect(); });
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  assert.equal((await applyCsiMigration()).ready, true);
  t.mock.method(globalThis, "fetch", async () => { throw new Error("External traffic forbidden in the S1-SUGGEST replica proof"); });
  const oid = () => new mongoose.Types.ObjectId();
  const at = (day: number, hour = 15) => new Date(`2026-09-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00Z`);
  const ADMIN = "/api/v1/admin/sales-intelligence", OWNER_ID = "5eed00000000000000000001";
  const ownerActor = (path: string) => {
    const timestamp = String(Date.now()), requestId = randomUUID(), email = "owner@example.test";
    const signature = computeAdminActorSignature({ adminId: OWNER_ID, email, role: "owner", timestamp, requestId, method: "POST", path }, process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET!);
    const headers: Record<string, string> = { "x-vantage-admin-user-id": OWNER_ID, "x-vantage-admin-email": email, "x-vantage-admin-role": "owner",
      "x-vantage-admin-request-id": requestId, "x-vantage-admin-timestamp": timestamp, "x-vantage-admin-signature": signature };
    return requireCsiOwner({ method: "POST", originalUrl: path, url: path, header: (name: string) => headers[name.toLowerCase()], vantageAuth: { kind: "secret" } } as never);
  };
  const suggestion = { action_kind: "call", description: "Call with a price for the Orlando to Atlanta move", date_text: "tomorrow", timezone_text: null,
    target_followup_id: null, rationale: "The customer asked for a price.", finding_keys: ["f1"] };
  const insertRun = async (input: { numberId: mongoose.Types.ObjectId; recordId: string; conversationId: mongoose.Types.ObjectId | null; createdAt: Date; suggestion: unknown }) => {
    const _id = oid();
    await getIntelligenceRunModel().collection.insertOne({ _id, ...csiDataset(), job_id: oid(), conversation_id: input.conversationId, contact_number_id: input.numberId,
      outreach_record_id: new mongoose.Types.ObjectId(input.recordId), subject_key: input.conversationId ? `conversation:${input.conversationId}` : `number:${input.numberId}`,
      status: "completed", completed_at: input.createdAt, schema_version: "csi-envelope-v1", prompt_version: "csi-agent-v3", model_version: "openai/gpt-5-mini", mode: "initial",
      revision: 1, input_fingerprint: "synthetic", manifest_snapshot_ids: [], purged_at: null, purge_started_at: null,
      output: { ...legacyEnvelope(), next_step_suggestion: input.suggestion }, createdAt: input.createdAt, updatedAt: input.createdAt } as never);
    return _id;
  };
  const pointTo = (numberId: mongoose.Types.ObjectId, runId: mongoose.Types.ObjectId) =>
    getContactNumberModel().collection.updateOne({ _id: numberId }, { $set: { running_summary: { text: "Synthetic running summary", run_id: runId, updated_at: at(12) } } });

  // ── Seed: A (case 2: older conversation run without a suggestion, newest Number run with one) and B (newest run has none).
  const numberA = await seedNumber(), leadA = await seedLead("FormLead", numberA.national_ten!), recordA = await seedRecord(leadA, String(numberA._id));
  const convA = await seedSummaryConversation(String(numberA._id), at(10), { overview: "Customer wants a price." });
  await insertRun({ numberId: numberA._id, recordId: recordA, conversationId: convA.conversation._id, createdAt: at(10, 16), suggestion: null });
  const runA = await insertRun({ numberId: numberA._id, recordId: recordA, conversationId: null, createdAt: at(11), suggestion });
  await pointTo(numberA._id, runA);
  const numberB = await seedNumber(), leadB = await seedLead("FormLead", numberB.national_ten!), recordB = await seedRecord(leadB, String(numberB._id));
  await insertRun({ numberId: numberB._id, recordId: recordB, conversationId: null, createdAt: at(10), suggestion });
  const runB = await insertRun({ numberId: numberB._id, recordId: recordB, conversationId: null, createdAt: at(11), suggestion: null });
  await pointTo(numberB._id, runB);

  const detail = async (id: string) => (await readOutreach(id))!.data.outreach;
  await t.test("GET /outreach/:id serves case 2 from the newest run with an enabled Apply", async () => {
    const served = outreachSuggestedNextStepDtoSchema.parse((await detail(recordA)).suggested_next_step);
    const record = (await getOutreachRecordModel().findById(recordA).lean())!;
    assert.deepEqual({ ...served, apply: { ...served.apply } }, { run_id: String(runA), action_kind: "call", action_label: "Call", description: suggestion.description,
      date_text: "tomorrow", timezone_text: null, apply: { action: "apply_suggestion", target_id: String(runA), expected_revision: 1, enabled: true, blocker_codes: [],
        suggestion_output_digest: payloadHash(suggestion), outreach_id: recordA, outreach_expected_revision: record.revision } });
    assert.equal((await detail(recordB)).suggested_next_step, null, "the newest run has no suggestion: no fallback to an older run");
  });

  await t.test("a stale published pointer shows Apply blocked (REVISION_CONFLICT), as the command would refuse it", async () => {
    await pointTo(numberA._id, oid());
    const served = (await detail(recordA)).suggested_next_step!;
    assert.deepEqual([served.apply.enabled, served.apply.blocker_codes], [false, ["REVISION_CONFLICT"]]);
    await pointTo(numberA._id, runA);
  });

  await t.test("Attention publish carries the same field on the desk row with one run read per page", async () => {
    const aggregates: string[] = [];
    mongoose.set("debug", (collection: string, method: string) => { if (collection === "intelligence_runs" && method === "aggregate") aggregates.push(collection); });
    const out = await publishAttentionSnapshot();
    mongoose.set("debug", false);
    assert.equal(out.status, "published");
    assert.equal(aggregates.length, 1, "one newest-run aggregation for the page");
    const page = await readAttention({ limit: 200 });
    const row = (id: string) => page.data.items.find(item => item.outreach?.id === id);
    assert.equal(row(recordA)?.outreach?.suggested_next_step?.run_id, String(runA));
    assert.equal(row(recordA)?.outreach?.suggested_next_step?.apply.enabled, true);
    assert.equal(row(recordB)?.outreach?.suggested_next_step ?? null, null);
  });

  await t.test("the served Apply drives apply_suggestion; the field then disappears (case 1, then applied)", async () => {
    const served = (await detail(recordA)).suggested_next_step!;
    const result = await commandAnalysis({ actor: ownerActor(`${ADMIN}/analysis-runs/${served.run_id}/apply-suggestion`), target_id: served.apply.target_id,
      idempotency_key: `suggest-apply-${served.run_id}`, command: { command: "apply_suggestion", expected_revision: served.apply.expected_revision, run_id: served.run_id,
        suggestion_output_digest: served.apply.suggestion_output_digest, expected_revisions: [{ target: "outreach", id: served.apply.outreach_id, revision: served.apply.outreach_expected_revision }] } });
    assert.equal((result as { response?: { status?: string } }).response?.status, "applied", JSON.stringify(result).slice(0, 800));
    const after = await detail(recordA);
    assert.ok(after.next_action, "case 1: the applied suggestion is now the open follow-up");
    assert.equal(after.suggested_next_step, null);
    await getOutreachFollowupModel().collection.updateMany({ outreach_record_id: new mongoose.Types.ObjectId(recordA) }, { $set: { status: "completed" } });
    assert.equal((await detail(recordA)).suggested_next_step, null, "no open follow-up, but the suggestion is applied (audit row)");
  });
});
