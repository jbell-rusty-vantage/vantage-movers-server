import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { normalizeJobNo } from "../services/bookings/bookingIdentity";
import {
  FORM_LEAD_INGESTION_ORIGINS,
  PUBLIC_LEAD_FORBIDDEN_LIFECYCLE_FIELDS,
  RECEIVER_AGENT_SOURCES,
} from "./granotLifecycleSchemas";
import { FormLead } from "./FormLead";

function formLeadAttrs(overrides: Record<string, unknown> = {}) {
  return {
    name: "Synthetic User",
    pickup_zip: "10001",
    destination_zip: "94105",
    move_size: "Studio",
    phone_number: "5550100100",
    local: "local" as const,
    ...overrides,
  };
}

function indexKeys(): Array<Record<string, number>> {
  return (FormLead.schema.indexes() as Array<[Record<string, number>]>).map(
    ([key]) => key,
  );
}

function hasIndex(expected: Record<string, number>): boolean {
  return indexKeys().some(
    (key) => JSON.stringify(key) === JSON.stringify(expected),
  );
}

test("[AC-10] [AC-11] FormLead declares exact origin, snapshot, job, and provenance paths", async () => {
  const now = new Date("2026-08-17T16:00:00.000Z");
  const lead = new FormLead(
    formLeadAttrs({
      job_no: "ab-12",
      ingestion_origin: "wordpress_form",
      ingested_contact_snapshot: {
        name: "Synthetic User",
        phone_number: "5550100100",
        normalized_phone_number: "5550100100",
        captured_at: now,
        evidence_status: "captured_at_ingestion",
      },
      ingested_move_snapshot: {
        pickup_zip: "10001",
        destination_zip: "94105",
        move_size: "Studio",
        captured_at: now,
        evidence_status: "captured_at_ingestion",
      },
    }),
  );
  await lead.validate();
  assert.equal(lead.ingestion_origin, "wordpress_form");
  assert.equal(lead.job_no, "ab-12");
  assert.equal(lead.normalized_job_no, normalizeJobNo("ab-12"));
  assert.equal(lead.granot_contact_revision, 0);
  assert.equal(lead.ingested_contact_snapshot?.evidence_status, "captured_at_ingestion");
  assert.equal(lead.ingested_move_snapshot?.evidence_status, "captured_at_ingestion");
  assert.deepEqual([...FORM_LEAD_INGESTION_ORIGINS], [
    "wordpress_form",
    "granot_lead_created",
    "best_relocation_sheet",
    "vantage_admin",
    "legacy_unknown",
  ]);
});

test("[AC-03] Form Job Number is distinct from Tracking Reference ref_no", async () => {
  const lead = new FormLead(
    formLeadAttrs({
      ref_no: "DT_providerRef",
      job_no: "P5556278",
    }),
  );
  await lead.validate();
  assert.equal(lead.ref_no, "DT_providerRef");
  assert.equal(lead.job_no, "P5556278");
  assert.notEqual(lead.normalized_job_no, lead.ref_no);
  assert.equal(FormLead.schema.path("ref_no") != null, true);
  assert.equal(FormLead.schema.path("job_no") != null, true);
});

test("[AC-10] ingested Form snapshots and origin are immutable after insert", async () => {
  const now = new Date("2026-08-17T16:00:00.000Z");
  const lead = new FormLead(
    formLeadAttrs({
      ingestion_origin: "wordpress_form",
      ingested_contact_snapshot: {
        name: "Synthetic User",
        captured_at: now,
        evidence_status: "captured_at_ingestion",
      },
      ingested_move_snapshot: {
        pickup_zip: "10001",
        captured_at: now,
        evidence_status: "captured_at_ingestion",
      },
    }),
  );
  await lead.validate();
  lead.isNew = false;
  lead.ingestion_origin = "vantage_admin";
  await assert.rejects(() => lead.validate(), /ingestion_origin is immutable/);
  lead.ingestion_origin = "wordpress_form";
  lead.ingested_contact_snapshot = {
    name: "Changed",
    captured_at: now,
    evidence_status: "captured_at_ingestion",
  };
  await assert.rejects(() => lead.validate(), /ingested_contact_snapshot is immutable/);
});

test("[AC-10] new Form rows cannot use legacy_unknown or legacy_baseline", async () => {
  await assert.rejects(
    () =>
      new FormLead(formLeadAttrs({ ingestion_origin: "legacy_unknown" })).validate(),
    /migration-only/,
  );
  await assert.rejects(
    () =>
      new FormLead(
        formLeadAttrs({
          ingested_contact_snapshot: {
            captured_at: new Date(),
            evidence_status: "legacy_baseline",
          },
        }),
      ).validate(),
    /legacy_baseline/,
  );
});

test("[AC-07] Form persisted move_size is optional while snapshot/provenance enums reject malformed values", async () => {
  const withoutMoveSize = new FormLead(formLeadAttrs({ move_size: undefined }));
  delete (withoutMoveSize as { move_size?: string }).move_size;
  await withoutMoveSize.validate();
  await assert.rejects(
    () =>
      new FormLead(formLeadAttrs({ ingestion_origin: "not_a_real_origin" })).validate(),
  );
  await assert.rejects(
    () =>
      new FormLead(
        formLeadAttrs({
          current_contact_provenance: {
            source_system: "wordpress",
            changed_at: new Date(),
          },
        }),
      ).validate(),
  );
  await assert.rejects(
    () =>
      new FormLead(formLeadAttrs({ granot_contact_revision: -1 })).validate(),
  );
  await assert.rejects(
    () =>
      new FormLead(
        formLeadAttrs({
          last_accepted_granot_observation: {
            observation_id: "not-an-object-id",
            captured_at: new Date(),
          },
        }),
      ).validate(),
  );
});

test("[AC-12] FormLead receiver-agent enum gains granot_username_match and keeps compatibility", () => {
  const enumValues = (FormLead.schema.path("receiver_agent_source") as {
    enumValues: string[];
  }).enumValues;
  assert.ok(enumValues.includes("granot_username_match"));
  assert.ok(enumValues.includes("extension_crm_username_match"));
  assert.deepEqual([...RECEIVER_AGENT_SOURCES], enumValues);
});

test("[AC-07] FormLead declares the four exact S08 indexes and no unique Lead Job index", () => {
  assert.equal(hasIndex({ normalized_job_no: 1 }), true);
  assert.equal(hasIndex({ source_granularity_id: 1, normalized_job_no: 1 }), true);
  assert.equal(
    hasIndex({
      source_granularity_id: 1,
      normalized_phone_number: 1,
      duplicate: 1,
    }),
    true,
  );
  assert.equal(hasIndex({ ref_no: 1, duplicate: 1 }), true);
  const uniqueJob = (FormLead.schema.indexes() as Array<
    [Record<string, number>, { unique?: boolean }]
  >).some(
    ([key, options]) => options?.unique === true && "normalized_job_no" in key,
  );
  assert.equal(uniqueJob, false);
  assert.equal(
    PUBLIC_LEAD_FORBIDDEN_LIFECYCLE_FIELDS.includes("ingestion_origin"),
    true,
  );
});
