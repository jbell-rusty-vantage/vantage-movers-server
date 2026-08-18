import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { connectMongo } from "../../src/db";
import { CALL_LEAD_S08_INDEXES } from "../../src/models/CallLead";
import { FORM_LEAD_S08_INDEXES } from "../../src/models/FormLead";
import {
  applyLeadProvenancePlan,
  planLeadProvenanceCollection,
  projectLeadProvenanceInventoryRow,
  verifyLeadProvenanceMigration,
} from "./granot-lifecycle-lead-provenance.lib";
import {
  CALL_LEAD_COLLECTION,
  FORM_LEAD_COLLECTION,
  hasGlobalUniqueLeadJobIndex,
  leadS08IndexAlreadyPresent,
  verifyCallLeadS08IndexDefinitions,
  verifyFormLeadS08IndexDefinitions,
} from "./granot-lifecycle-indexes.lib";

const BASELINE = new Date("2026-08-17T21:00:00.000Z");
const BOUNDARY = new Date("2026-08-17T20:00:00.000Z");
const MARKER = "_u13_marker";

function replicaEnvironmentReady(): string | null {
  if (process.env.GRANOT_LIFECYCLE_REPLICA_TESTS !== "true") {
    return "Replica-set proof is opt-in via GRANOT_LIFECYCLE_REPLICA_TESTS=true.";
  }
  if (getMongoDatabaseName() !== "testvantagemovers") {
    return "Replica-set proof requires TEST_MODE=true before process start.";
  }
  return null;
}

const skipReason = replicaEnvironmentReady();

const BUSINESS_FIELDS = [
  "name",
  "phone_number",
  "email",
  "pickup_zip",
  "destination_zip",
  "move_size",
  "ref_no",
  "lid",
  "job_no",
  "duplicate",
  "bad_lead",
  "quoted",
  "booked",
  "cancelled",
  "cpl",
  "domain_revision",
  "change_history_started_at",
  "last_change_id",
  "sheet_sync",
] as const;

function pickBusiness(document: Record<string, unknown> | null) {
  assert.ok(document);
  return Object.fromEntries(BUSINESS_FIELDS.map((field) => [field, document[field]]));
}

describe("Unit 13 replica-set Lead provenance and index proofs", {
  concurrency: 1,
  skip: skipReason ?? false,
}, () => {
  before(async () => {
    await connectMongo();
    if (mongoose.connection.db?.databaseName !== "testvantagemovers") {
      throw new Error("Refusing replica-set proof against a non-test database.");
    }
    const hello = await mongoose.connection.db?.admin().command({ hello: 1 });
    if (!hello || hello.setName == null) {
      throw new Error("Connected Mongo is not a replica set.");
    }
  });

  after(async () => {
    await mongoose.disconnect().catch(() => undefined);
  });

  test("[AC-10][AC-11][AC-12] foundation/partial: report writes zero; apply is additive, idempotent, and preserves business/revision fields", async () => {
    const forms = mongoose.connection.db?.collection(FORM_LEAD_COLLECTION);
    const calls = mongoose.connection.db?.collection(CALL_LEAD_COLLECTION);
    const changes = mongoose.connection.db?.collection("entity_changes");
    const commands = mongoose.connection.db?.collection("domain_command_executions");
    assert.ok(forms && calls && changes && commands);

    const changeBefore = await changes.countDocuments();
    const commandBefore = await commands.countDocuments();

    const missing = await forms.insertOne({
      name: "Synthetic User",
      phone_number: "5550100140",
      email: "synthetic.u13@example.test",
      pickup_zip: "10001",
      destination_zip: "94105",
      move_size: "Studio",
      ref_no: "DT_u13ref",
      lid: "u13-lid",
      job_no: "SYN-U13-140",
      duplicate: false,
      quoted: false,
      cpl: 0,
      domain_revision: 3,
      change_history_started_at: BOUNDARY,
      [MARKER]: "provenance-apply",
    });
    const captured = await forms.insertOne({
      name: "Synthetic Captured",
      phone_number: "5550100141",
      pickup_zip: "10001",
      destination_zip: "94105",
      move_size: "Studio",
      ingestion_origin: "wordpress_form",
      ingested_contact_snapshot: {
        name: "Synthetic Captured",
        phone_number: "5550100141",
        captured_at: new Date("2026-01-02T00:00:00.000Z"),
        evidence_status: "captured_at_ingestion",
      },
      ingested_move_snapshot: {
        pickup_zip: "10001",
        captured_at: new Date("2026-01-02T00:00:00.000Z"),
        evidence_status: "captured_at_ingestion",
      },
      domain_revision: 1,
      change_history_started_at: BOUNDARY,
      [MARKER]: "provenance-apply",
    });
    const callMissing = await calls.insertOne({
      name: "Synthetic Caller",
      phone_number: "5550100142",
      job_no: "SYN-U13-142",
      quoted: false,
      duplicate: true,
      domain_revision: 0,
      change_history_started_at: BOUNDARY,
      [MARKER]: "provenance-apply",
    });

    try {
      const beforeMissing = await forms.findOne({ _id: missing.insertedId });
      const beforeCaptured = await forms.findOne({ _id: captured.insertedId });
      const beforeCall = await calls.findOne({ _id: callMissing.insertedId });
      const formPlan = planLeadProvenanceCollection({
        collection: "form_leads",
        rows: [beforeMissing, beforeCaptured].map((document) =>
          projectLeadProvenanceInventoryRow(document as Record<string, unknown>),
        ),
      });
      const callPlan = planLeadProvenanceCollection({
        collection: "call_leads",
        rows: [projectLeadProvenanceInventoryRow(beforeCall as Record<string, unknown>)],
      });
      assert.equal(formPlan.planned.length, 1);
      assert.equal(formPlan.unchanged, 1);
      assert.equal(callPlan.planned.length, 1);

      const formApply = await applyLeadProvenancePlan({
        collection: forms,
        collectionName: "form_leads",
        planned: formPlan.planned,
        baselineCapturedAt: BASELINE,
      });
      const callApply = await applyLeadProvenancePlan({
        collection: calls,
        collectionName: "call_leads",
        planned: callPlan.planned,
        baselineCapturedAt: BASELINE,
      });
      assert.equal(formApply.concurrent_mismatch, false);
      assert.equal(callApply.concurrent_mismatch, false);
      assert.ok(formApply.updated > 0);
      assert.ok(callApply.updated > 0);

      const afterMissing = await forms.findOne({ _id: missing.insertedId });
      const afterCaptured = await forms.findOne({ _id: captured.insertedId });
      const afterCall = await calls.findOne({ _id: callMissing.insertedId });
      assert.equal(afterMissing?.ingestion_origin, "legacy_unknown");
      assert.equal(afterMissing?.normalized_job_no, "SYN U13 140");
      assert.equal(afterMissing?.ingested_contact_snapshot?.evidence_status, "legacy_baseline");
      assert.equal(afterMissing?.ingested_move_snapshot?.evidence_status, "legacy_baseline");
      assert.deepEqual(
        afterMissing?.ingested_contact_snapshot?.captured_at,
        BASELINE,
      );
      assert.equal(afterCaptured?.ingestion_origin, "wordpress_form");
      assert.equal(
        afterCaptured?.ingested_contact_snapshot?.evidence_status,
        "captured_at_ingestion",
      );
      assert.deepEqual(
        afterCaptured?.ingested_contact_snapshot,
        beforeCaptured?.ingested_contact_snapshot,
      );
      assert.equal(afterCall?.ingestion_origin, "legacy_unknown");
      assert.equal(afterCall?.duplicate, true);
      assert.deepEqual(
        pickBusiness(afterMissing as Record<string, unknown>),
        pickBusiness(beforeMissing as Record<string, unknown>),
      );
      assert.deepEqual(
        pickBusiness(afterCaptured as Record<string, unknown>),
        pickBusiness(beforeCaptured as Record<string, unknown>),
      );
      assert.deepEqual(
        pickBusiness(afterCall as Record<string, unknown>),
        pickBusiness(beforeCall as Record<string, unknown>),
      );

      const rerunForm = await applyLeadProvenancePlan({
        collection: forms,
        collectionName: "form_leads",
        planned: planLeadProvenanceCollection({
          collection: "form_leads",
          rows: [afterMissing, afterCaptured].map((document) =>
            projectLeadProvenanceInventoryRow(document as Record<string, unknown>),
          ),
        }).planned,
        baselineCapturedAt: BASELINE,
      });
      const rerunCall = await applyLeadProvenancePlan({
        collection: calls,
        collectionName: "call_leads",
        planned: planLeadProvenanceCollection({
          collection: "call_leads",
          rows: [projectLeadProvenanceInventoryRow(afterCall as Record<string, unknown>)],
        }).planned,
        baselineCapturedAt: BASELINE,
      });
      assert.equal(rerunForm.updated, 0);
      assert.equal(rerunCall.updated, 0);
      assert.equal(rerunForm.concurrent_mismatch, false);

      const verified = verifyLeadProvenanceMigration({
        rowsByCollection: {
          form_leads: [afterMissing, afterCaptured].map((document) =>
            projectLeadProvenanceInventoryRow(document as Record<string, unknown>),
          ),
          call_leads: [projectLeadProvenanceInventoryRow(afterCall as Record<string, unknown>)],
        },
        baselineCapturedAt: BASELINE.toISOString(),
      });
      assert.equal(verified.ok, true);
      assert.equal(await changes.countDocuments(), changeBefore);
      assert.equal(await commands.countDocuments(), commandBefore);
    } finally {
      await forms.deleteMany({ [MARKER]: "provenance-apply" });
      await calls.deleteMany({ [MARKER]: "provenance-apply" });
    }
  });

  test("[AC-10] foundation/partial: concurrent origin write aborts instead of overwriting", async () => {
    const forms = mongoose.connection.db?.collection(FORM_LEAD_COLLECTION);
    assert.ok(forms);
    const inserted = await forms.insertOne({
      name: "Synthetic Race",
      phone_number: "5550100143",
      pickup_zip: "10001",
      destination_zip: "94105",
      domain_revision: 0,
      change_history_started_at: BOUNDARY,
      [MARKER]: "provenance-race",
    });
    try {
      const current = await forms.findOne({ _id: inserted.insertedId });
      const planned = planLeadProvenanceCollection({
        collection: "form_leads",
        rows: [projectLeadProvenanceInventoryRow(current as Record<string, unknown>)],
      }).planned;
      await forms.updateOne(
        { _id: inserted.insertedId },
        { $set: { ingestion_origin: "vantage_admin" } },
      );
      const result = await applyLeadProvenancePlan({
        collection: forms,
        collectionName: "form_leads",
        planned,
        baselineCapturedAt: BASELINE,
      });
      assert.equal(result.concurrent_mismatch, true);
      const stored = await forms.findOne({ _id: inserted.insertedId });
      assert.equal(stored?.ingestion_origin, "vantage_admin");
    } finally {
      await forms.deleteMany({ [MARKER]: "provenance-race" });
    }
  });

  test("[AC-10][AC-11][AC-12] foundation/partial: verify exits nonzero on injected mismatch", async () => {
    const forms = mongoose.connection.db?.collection(FORM_LEAD_COLLECTION);
    assert.ok(forms);
    const inserted = await forms.insertOne({
      name: "Synthetic Verify",
      phone_number: "5550100144",
      pickup_zip: "10001",
      destination_zip: "94105",
      ingestion_origin: "legacy_unknown",
      ingested_contact_snapshot: {
        name: "Synthetic Verify",
        captured_at: BASELINE,
        evidence_status: "legacy_baseline",
      },
      ingested_move_snapshot: {
        pickup_zip: "10001",
        captured_at: BASELINE,
        evidence_status: "legacy_baseline",
      },
      domain_revision: 0,
      change_history_started_at: BOUNDARY,
      [MARKER]: "provenance-verify",
    });
    try {
      const ok = await forms.findOne({ _id: inserted.insertedId });
      const valid = verifyLeadProvenanceMigration({
        rowsByCollection: {
          form_leads: [projectLeadProvenanceInventoryRow(ok as Record<string, unknown>)],
          call_leads: [],
        },
        baselineCapturedAt: BASELINE.toISOString(),
      });
      assert.equal(valid.ok, true);

      await forms.updateOne(
        { _id: inserted.insertedId },
        { $set: { ingestion_origin: "not_a_real_origin" } },
      );
      const broken = await forms.findOne({ _id: inserted.insertedId });
      const failed = verifyLeadProvenanceMigration({
        rowsByCollection: {
          form_leads: [projectLeadProvenanceInventoryRow(broken as Record<string, unknown>)],
          call_leads: [],
        },
        baselineCapturedAt: BASELINE.toISOString(),
      });
      assert.equal(failed.ok, false);
      assert.ok(failed.failures.some((failure) => failure.includes("contradiction") || failure.includes("blocker")));
    } finally {
      await forms.deleteMany({ [MARKER]: "provenance-verify" });
    }
  });

  test("[AC-10][AC-11][AC-12] foundation/partial: Lead S08 indexes deploy non-unique and verify exact definitions", async () => {
    const forms = mongoose.connection.db?.collection(FORM_LEAD_COLLECTION);
    const calls = mongoose.connection.db?.collection(CALL_LEAD_COLLECTION);
    assert.ok(forms && calls);
    const created: string[] = [];
    try {
      const existingForm = await forms.indexes();
      const existingCall = await calls.indexes();
      for (const index of FORM_LEAD_S08_INDEXES) {
        if (
          leadS08IndexAlreadyPresent(
            existingForm.map((entry) => ({
              name: String(entry.name),
              key: entry.key as Record<string, unknown>,
              unique: entry.unique === true ? true : undefined,
            })),
            index,
          )
        ) {
          continue;
        }
        await forms.createIndex(index.key, { name: index.name });
        created.push(index.name);
      }
      for (const index of CALL_LEAD_S08_INDEXES) {
        if (
          leadS08IndexAlreadyPresent(
            existingCall.map((entry) => ({
              name: String(entry.name),
              key: entry.key as Record<string, unknown>,
              unique: entry.unique === true ? true : undefined,
            })),
            index,
          )
        ) {
          continue;
        }
        await calls.createIndex(index.key, { name: index.name });
        created.push(index.name);
      }
      const formIndexes = await forms.indexes();
      const callIndexes = await calls.indexes();
      const formDeclared = formIndexes.map((entry) => ({
        name: String(entry.name),
        key: entry.key as Record<string, unknown>,
        unique: entry.unique === true ? true : undefined,
      }));
      const callDeclared = callIndexes.map((entry) => ({
        name: String(entry.name),
        key: entry.key as Record<string, unknown>,
        unique: entry.unique === true ? true : undefined,
      }));
      assert.equal(verifyFormLeadS08IndexDefinitions(formDeclared).ok, true);
      assert.equal(verifyCallLeadS08IndexDefinitions(callDeclared).ok, true);
      assert.equal(hasGlobalUniqueLeadJobIndex(formDeclared), false);
      assert.equal(hasGlobalUniqueLeadJobIndex(callDeclared), false);
    } finally {
      for (const name of created) {
        await forms.dropIndex(name).catch(() => undefined);
        await calls.dropIndex(name).catch(() => undefined);
      }
    }
  });
});
