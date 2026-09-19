import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import express, { type Request } from "express";
import { connectMongo } from "../src/db";
import { getMongoDatabaseName } from "../src/config/domain/runtime";
import { csiDataset } from "../src/config/domain/salesIntelligence";
import { applyCsiMigration } from "./migrations/sales-intelligence.lib";
import { getContactNumberModel } from "../src/models/ContactNumber";
import { getIntelligenceRunModel } from "../src/models/IntelligenceRun";
import { getIntelligenceFindingModel } from "../src/models/IntelligenceFinding";
import { getIntelligenceEffectModel } from "../src/models/IntelligenceEffect";
import { getOutreachFollowupModel } from "../src/models/OutreachFollowup";
import { requireCsiOwner } from "../src/services/salesIntelligence/auth";
import { payloadHash } from "../src/services/salesIntelligence/transactions";
import { computeAdminActorSignature } from "../src/services/operationsRegistry/trustedActor";
import { commandAnalysis } from "../src/services/salesIntelligence/analysis/ownerCommands";
import { intelligenceEnvelopeSchema } from "../src/validation/intelligence/intelligenceEnvelope.validation";
import { readOwnerRun } from "../src/services/salesIntelligence/analysis/ownerReads";
import { getSalesIntelligenceOwnerInstructionModel } from "../src/models/SalesIntelligenceOwnerInstruction";
import { getOutreachRecordModel } from "../src/models/OutreachRecord";
import { defaultCsiPolicy } from "../src/services/salesIntelligence/policy";

test("CSI-18 Owner interventions on isolated replica", { skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 180000 }, async t => {
  assert.equal(process.env.TEST_MODE, "true");
  assert.match(getMongoDatabaseName(), /^testvantagemovers_csi18[a-f0-9]+$/);
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  t.after(async () => { await db.dropDatabase(); await mongoose.disconnect(); });
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  await applyCsiMigration();
  const fields = { adminId: "synthetic-owner", email: "owner@example.test", role: "owner", timestamp: String(Date.now()), requestId: "csi18-proof", method: "POST", path: "/api/v1/admin/sales-intelligence/analysis-runs" };
  const req: Request = Object.assign(Object.create(express.request), { method: fields.method, originalUrl: fields.path,
    vantageAuth: { kind: "user", userId: fields.adminId, email: fields.email, roles: ["owner"] }, headers: {
      "x-vantage-admin-user-id": fields.adminId, "x-vantage-admin-email": fields.email, "x-vantage-admin-role": fields.role,
      "x-vantage-admin-timestamp": fields.timestamp, "x-vantage-admin-request-id": fields.requestId,
      "x-vantage-admin-signature": computeAdminActorSignature(fields, process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET!),
    } });
  const actor = requireCsiOwner(req), oid = () => new mongoose.Types.ObjectId();
  const number = await getContactNumberModel().create({ e164: "+12025550118", digits_reversed: "8110555202", first_observed_at: new Date(), last_activity_at: new Date() });
  const assertion = { key: "intent", kind: "intent", claim: "Moving inquiry", basis: "model_inference", actor: "unknown", speaker_ref: null, action_status: null,
    clarity: "uncertain", confidence: null, evidence: [{ source: "vantage_record", snapshot_id: String(oid()), record_type: "contact_number", record_id: String(number._id), field_paths: ["classification"] }], value: { intent: "unknown" } };
  const output = intelligenceEnvelopeSchema.parse({ schema_version: "csi-envelope-v1", summary: { overview: "Synthetic", customer_wanted: "Unknown", money_and_dates: "Unknown", outcome: "Unknown", commitments: "None", discrepancies: "Unknown", finding_keys: ["intent"] }, findings: [assertion], next_step_suggestion: null, owner_instruction_assessments: [] });
  const run = await getIntelligenceRunModel().create({ ...csiDataset(), subject_key: `number:${number._id}`, contact_number_id: number._id,
    job_id: oid(), input_fingerprint: "fixture", prompt_version: "fixture", schema_version: "csi-envelope-v1", model_version: "synthetic", output,
    finalized_at: new Date(), completed_at: new Date(), status: "completed", mode: "initial" });
  await getContactNumberModel().updateOne({ _id: number._id }, { $set: { running_summary: { text: "Synthetic", run_id: run._id, evidence_digest: "fixture", computed_at: new Date() } } });
  const finding = await getIntelligenceFindingModel().create({ run_id: run._id, key: "intent", assertion: output.findings[0], kind: "intent", contact_number_id: number._id,
    prompt_version: "fixture", schema_version: "csi-envelope-v1", model_version: "synthetic", validation: { schema_ok: true, source_snapshots_valid: true } });
  await t.test("confirmation is exact, durable and never applies effects", async () => {
    const input = { actor, target_id: String(run._id), idempotency_key: "confirm-once", command: { command: "confirm_run" as const, expected_revision: run.revision, expected_output_digest: payloadHash(output) } };
    const first = await commandAnalysis(input);
    assert.equal(first.replayed, false);
    assert.equal((await commandAnalysis(input)).replayed, true);
    assert.equal((await getIntelligenceFindingModel().findById(finding._id))?.review_state, "confirmed");
    assert.equal(await getIntelligenceEffectModel().countDocuments(), 0);
    assert.equal(await getOutreachFollowupModel().countDocuments(), 0);
    assert.deepEqual((await getIntelligenceRunModel().findById(run._id))?.output, output);
    await assert.rejects(commandAnalysis({ ...input, command: { ...input.command, expected_output_digest: "different" } }), /IDEMPOTENCY_CONFLICT/);
    await assert.rejects(commandAnalysis({ ...input, idempotency_key: "stale" }), /REVISION_CONFLICT/);
  });
  await t.test("correction persists immediately, preserves the assertion and leaves absent assessments unknown", async () => {
    const latest = (await getIntelligenceFindingModel().findById(finding._id))!;
    const replacement = { ...output.findings[0], claim: "Owner corrected the inquiry" };
    const input = { actor, target_id: String(finding._id), idempotency_key: "correct-once", command: {
      command: "correct_finding" as const, expected_revision: latest.revision, expected_output_digest: payloadHash(output),
      replacement, target_effect_id: null, target_followup_id: null, reason: "Synthetic Owner correction" } };
    await commandAnalysis(input);
    assert.equal((await commandAnalysis(input)).replayed, true);
    const corrected = (await getIntelligenceFindingModel().findById(finding._id))!;
    assert.equal(corrected.review_state, "corrected");
    assert.deepEqual(corrected.assertion, output.findings[0]);
    assert.deepEqual((await getIntelligenceRunModel().findById(run._id))?.output, output);
    assert.equal(await getSalesIntelligenceOwnerInstructionModel().countDocuments({ finding_id: finding._id }), 1);
    const read = await readOwnerRun(String(run._id));
    assert.equal(read?.data.instructions[0].assessment, "cannot_determine");
    await assert.rejects(commandAnalysis({ ...input, idempotency_key: "stale-correction" }), /REVISION_CONFLICT/);
  });
  await t.test("replay rejects unavailable originals and foreign Owner corrections", async () => {
    const latest = (await getIntelligenceRunModel().findById(run._id))!;
    const command = { command: "reanalyze" as const, expected_revision: latest.revision, source_run_id: String(run._id),
      mode: "original_evidence" as const, owner_correction_ids: [], reason: "Synthetic replay" };
    await assert.rejects(commandAnalysis({ actor, target_id: String(run._id), idempotency_key: "missing-original", command }), /ORIGINAL_EVIDENCE_UNAVAILABLE/);
    await assert.rejects(commandAnalysis({ actor, target_id: String(run._id), idempotency_key: "foreign-correction",
      command: { ...command, mode: "current_context", owner_correction_ids: [String(oid())] } }), /RUN_SCOPE_DENIED/);
  });
  await t.test("targeted correction works with AI disabled and preserves independent undated work", async () => {
    const record = await getOutreachRecordModel().create({ subject: { kind: "number_review", contact_number_id: number._id }, primary_contact_number_id: number._id,
      state: "open", trigger_kind: "owner_open", trigger_at: new Date(), policy_version: defaultCsiPolicy().version });
    const action = await getOutreachFollowupModel().create({ outreach_record_id: record._id, commitment_key: "csi18-action", kind: "call", description: "Original action",
      origin: "rep_promise", due_at: new Date(), base_attention_due_at: new Date(), source_finding_ids: [finding._id] });
    const independent = await getOutreachFollowupModel().create({ outreach_record_id: record._id, commitment_key: "csi18-independent", kind: "review", description: "Independent action", origin: "owner", due_at: null });
    await getIntelligenceEffectModel().create({ run_id: run._id, finding_id: finding._id, finding_key: "intent", effect_kind: "create_followup", target_key: `followup:${action._id}`,
      target_id: action._id, status: "applied", previous: {}, current: {}, applied_at: new Date() });
    const latest = (await getIntelligenceFindingModel().findById(finding._id))!;
    process.env.SALES_INTELLIGENCE_EXTRACTION_ENABLED = "false";
    const result = await commandAnalysis({ actor, target_id: String(finding._id), idempotency_key: "correct-action", command: {
      command: "correct_finding", expected_revision: latest.revision, expected_output_digest: payloadHash(output), replacement: output.findings[0], reason: "Owner correction",
      target_effect_id: null, target_followup_id: String(action._id), action_changes: { description: "Owner changed only this action", due_at: null },
      expected_revisions: [{ target: "followup", id: String(action._id), revision: action.revision }], reanalysis_mode: "original_evidence" } });
    assert.equal(result.replayed, false);
    const changed = (await getOutreachFollowupModel().findById(action._id))!;
    assert.equal(changed.description, "Owner changed only this action");assert.equal(changed.due_at, null);
    assert.equal((await getOutreachFollowupModel().findById(independent._id))?.revision, independent.revision);
    const corrected = (await getIntelligenceFindingModel().findById(finding._id))!;
    const retract = await commandAnalysis({ actor, target_id: String(finding._id), idempotency_key: "retract-after-owner", command: {
      command: "retract_finding", expected_revision: corrected.revision, expected_output_digest: payloadHash(output), reason: "Preserve later Owner work",
      expected_revisions: [{ target: "followup", id: String(action._id), revision: changed.revision }] } });
    assert.match(JSON.stringify(retract.response), /later_owner_work/);
    assert.equal((await getOutreachFollowupModel().findById(action._id))?.status, "open");
    assert.equal((await getOutreachFollowupModel().findById(independent._id))?.status, "open");
  });
  await t.test("retraction cancels only eligible work and records blocked completed and closed work", async () => {
    for (const state of ["open", "completed", "closed"] as const) {
      const n = await getContactNumberModel().create({ e164: `+12025550${state === "open" ? "201" : state === "completed" ? "202" : "203"}`, digits_reversed: state, first_observed_at: new Date(), last_activity_at: new Date() });
      const r = await getOutreachRecordModel().create({ subject: { kind: "number_review", contact_number_id: n._id }, primary_contact_number_id: n._id,
        state: state === "closed" ? "closed" : "open", closed_reason: state === "closed" ? "booked" : null, closure_origin: state === "closed" ? "official" : null,
        trigger_kind: "owner_open", trigger_at: new Date(), policy_version: defaultCsiPolicy().version });
      const version = await getIntelligenceRunModel().create({ ...csiDataset(), subject_key: `number:${n._id}`, contact_number_id: n._id, outreach_record_id: r._id,
        job_id: oid(), input_fingerprint: state, prompt_version: "fixture", schema_version: "csi-envelope-v1", model_version: "synthetic", output,
        finalized_at: new Date(), completed_at: new Date(), status: "completed", mode: "initial" });
      await getContactNumberModel().updateOne({ _id: n._id }, { $set: { running_summary: { text: "Synthetic", run_id: version._id, evidence_digest: "fixture", computed_at: new Date() } } });
      const f = await getIntelligenceFindingModel().create({ run_id: version._id, key: "intent", kind: "intent", assertion: output.findings[0], contact_number_id: n._id,
        outreach_record_id: r._id, prompt_version: "fixture", schema_version: "csi-envelope-v1", model_version: "synthetic", validation: { schema_ok: true, source_snapshots_valid: true } });
      const a = await getOutreachFollowupModel().create({ outreach_record_id: r._id, commitment_key: `retract:${state}`, kind: "call", description: "Retractable callback",
        origin: "rep_promise", source_finding_ids: [f._id], status: state === "completed" ? "completed" : "open", due_at: null });
      await getIntelligenceEffectModel().create({ run_id: version._id, finding_id: f._id, finding_key: "intent", effect_kind: "create_followup", target_key: `followup:${a._id}`,
        target_id: a._id, status: "applied", previous: {}, current: {}, applied_at: new Date() });
      const request = { actor, target_id: String(f._id), idempotency_key: `retract-${state}`, command: { command: "retract_finding" as const, expected_revision: f.revision,
        expected_output_digest: payloadHash(output), reason: "Synthetic reversal", expected_revisions: [{ target: "followup" as const, id: String(a._id), revision: a.revision }] } };
      const result = await commandAnalysis(request);assert.equal((await commandAnalysis(request)).replayed, true);
      assert.match(JSON.stringify(result.response), state === "open" ? /applied/ : /blocked/);
      assert.equal((await getOutreachFollowupModel().findById(a._id))?.status, state === "open" ? "cancelled" : state === "completed" ? "completed" : "open");
      assert.equal((await getIntelligenceFindingModel().findById(f._id))?.review_state, "retracted");
    }
  });
});
