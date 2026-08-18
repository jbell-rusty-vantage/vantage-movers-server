import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import {
  CALL_LEAD_INGESTION_ORIGINS,
  RECEIVER_AGENT_SOURCES,
  RINGCENTRAL_CONVERGENCE_STATES,
} from "./granotLifecycleSchemas";
import { CALL_LEAD_S08_INDEXES, CallLead } from "./CallLead";

function callLeadAttrs(overrides: Record<string, unknown> = {}) {
  return {
    phone_number: "5550100101",
    ...overrides,
  };
}

function indexKeys(): Array<Record<string, number>> {
  return (CallLead.schema.indexes() as Array<[Record<string, number>]>).map(
    ([key]) => key,
  );
}

function hasIndex(expected: Record<string, number>): boolean {
  return indexKeys().some(
    (key) => JSON.stringify(key) === JSON.stringify(expected),
  );
}

test("[AC-08][AC-12] CallLead defaults quoted/post_to_granot false and has exact provenance paths", async () => {
  const now = new Date("2026-08-17T16:00:00.000Z");
  const lead = new CallLead(
    callLeadAttrs({
      ingestion_origin: "ringcentral",
      ingested_contact_snapshot: {
        phone_number: "5550100101",
        normalized_phone_number: "5550100101",
        captured_at: now,
        evidence_status: "captured_at_ingestion",
      },
    }),
  );
  await lead.validate();
  assert.equal(lead.quoted, false);
  assert.equal(lead.post_to_granot, false);
  assert.equal(lead.ingestion_origin, "ringcentral");
  assert.equal(lead.granot_contact_revision, 0);
  assert.equal(lead.ingested_contact_snapshot?.evidence_status, "captured_at_ingestion");
  assert.deepEqual([...CALL_LEAD_INGESTION_ORIGINS], [
    "ringcentral",
    "granot_lead_created",
    "best_relocation_sheet",
    "vantage_admin",
    "legacy_import",
    "legacy_unknown",
  ]);
  await assert.rejects(
    () =>
      new CallLead(
        callLeadAttrs({
          ingestion_origin: "granot_lead_created",
          post_to_granot: true,
        }),
      ).validate(),
    /post_to_granot/,
  );
  await new CallLead(
    callLeadAttrs({
      ingestion_origin: "legacy_import",
      post_to_granot: true,
    }),
  ).validate();
  assert.deepEqual([...RINGCENTRAL_CONVERGENCE_STATES], [
    "pending",
    "adopted",
    "conflict",
    "not_applicable",
  ]);
});

test("[AC-12] Call quoted and ingested snapshot/origin are immutable after insert", async () => {
  const now = new Date("2026-08-17T16:00:00.000Z");
  const lead = new CallLead(
    callLeadAttrs({
      ingestion_origin: "ringcentral",
      ingested_contact_snapshot: {
        phone_number: "5550100101",
        captured_at: now,
        evidence_status: "captured_at_ingestion",
      },
    }),
  );
  await lead.validate();
  assert.equal(lead.quoted, false);
  lead.isNew = false;
  lead.ingestion_origin = "vantage_admin";
  await assert.rejects(() => lead.validate(), /ingestion_origin is immutable/);
});

test("[AC-12] new Call rows reject legacy_unknown and malformed provenance", async () => {
  await assert.rejects(
    () =>
      new CallLead(callLeadAttrs({ ingestion_origin: "legacy_unknown" })).validate(),
    /migration-only/,
  );
  await assert.rejects(
    () =>
      new CallLead(
        callLeadAttrs({
          ringcentral_convergence: { state: "not-a-state" },
        }),
      ).validate(),
  );
  await assert.rejects(
    () =>
      new CallLead(
        callLeadAttrs({
          last_granot_contact_change: {
            observation_id: new mongoose.Types.ObjectId(),
            changed_at: "not-a-date",
            changed_paths: ["phone_number"],
            before_hash: "a",
            after_hash: "b",
          },
        }),
      ).validate(),
  );
});

test("[AC-12] CallLead receiver-agent enum gains granot_username_match", () => {
  const enumValues = (CallLead.schema.path("receiver_agent_source") as {
    enumValues: string[];
  }).enumValues;
  assert.ok(enumValues.includes("granot_username_match"));
  assert.ok(enumValues.includes("extension_crm_username_match"));
  assert.deepEqual([...RECEIVER_AGENT_SOURCES], enumValues);
});

test("[AC-07] CallLead declares the three exact S08 indexes and no unique Lead Job index", () => {
  assert.equal(CALL_LEAD_S08_INDEXES.length, 3);
  assert.equal(CALL_LEAD_S08_INDEXES[0]?.name, "call_lead_source_granularity_normalized_job_no");
  assert.equal(hasIndex({ source_granularity_id: 1, normalized_job_no: 1 }), true);
  assert.equal(
    hasIndex({
      source_granularity_id: 1,
      normalized_phone_number: 1,
      createdAt: -1,
    }),
    true,
  );
  assert.equal(
    hasIndex({
      ingestion_origin: 1,
      source_granularity_id: 1,
      "ingested_contact_snapshot.normalized_phone_number": 1,
      createdAt: -1,
    }),
    true,
  );
  const uniqueJob = (CallLead.schema.indexes() as Array<
    [Record<string, number>, { unique?: boolean }]
  >).some(
    ([key, options]) => options?.unique === true && "normalized_job_no" in key,
  );
  assert.equal(uniqueJob, false);
});

test("[AC-14] RingCentral original caller evidence is required and immutable", async () => {
  const now = new Date("2026-08-18T16:00:00.000Z");
  const lead = new CallLead(
    callLeadAttrs({
      ingestion_origin: "granot_lead_created",
      ringcentral: {
        ingestion_source: "webhook",
        original_caller: {
          phone_number: "5550002001",
          normalized_phone_number: "5550002001",
          captured_at: now,
        },
      },
    }),
  );
  await lead.validate();
  assert.equal(
    lead.ringcentral?.original_caller?.normalized_phone_number,
    "5550002001",
  );
  const path = CallLead.schema.path("ringcentral.original_caller") as {
    options?: { immutable?: boolean };
  };
  assert.equal(path.options?.immutable, true);
  await assert.rejects(
    () =>
      new CallLead(
        callLeadAttrs({
          ringcentral: {
            ingestion_source: "webhook",
            original_caller: {
              phone_number: "5550002001",
              captured_at: now,
            },
          },
        }),
      ).validate(),
    /normalized_phone_number/,
  );
});
