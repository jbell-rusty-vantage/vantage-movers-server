import assert from "node:assert/strict";
import { test } from "node:test";
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

test("[AC-07][AC-08] trusted Form may omit move size/date without inventing facts", async () => {
  const withoutMoveSize = new FormLead(
    formLeadAttrs({ move_size: undefined, move_date: undefined }),
  );
  delete (withoutMoveSize as { move_size?: string }).move_size;
  delete (withoutMoveSize as { move_date?: Date }).move_date;
  await withoutMoveSize.validate();
  assert.equal(withoutMoveSize.move_date, undefined);
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
