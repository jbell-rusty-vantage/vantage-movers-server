import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import {
  CALL_LEAD_INGESTION_ORIGINS,
  RECEIVER_AGENT_SOURCES,
  RINGCENTRAL_CONVERGENCE_STATES,
} from "./granotLifecycleSchemas";
import { CallLead } from "./CallLead";

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

test("[AC-12] CallLead requires quoted default false and exact origin/snapshot/convergence paths", async () => {
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
