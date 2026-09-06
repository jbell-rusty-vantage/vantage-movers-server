import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeJobNo } from "../bookings/bookingIdentity";
import { ValidationError } from "../errors";
import {
  buildIngestedContactSnapshot,
  callLeadCreationProvenanceFields,
  deriveCallLeadIngestionOrigin,
  deriveFormLeadIngestionOrigin,
  formLeadCreationProvenanceFields,
  noSyncOnCreate,
  omitForbiddenLeadLifecycleFields,
} from "./leadIngestionProvenance";

test("[AC-10] Form origin derivation uses trusted entry points and fails closed", () => {
  assert.equal(deriveFormLeadIngestionOrigin({}), "wordpress_form");
  assert.equal(
    deriveFormLeadIngestionOrigin({
      commandOrigin: "vantage_admin",
      actorType: "system",
    }),
    "wordpress_form",
  );
  assert.equal(
    deriveFormLeadIngestionOrigin({
      commandOrigin: "vantage_admin",
      actorType: "owner",
    }),
    "vantage_admin",
  );
  assert.equal(
    deriveFormLeadIngestionOrigin({
      commandOrigin: "vantage_admin",
      actorType: "admin",
    }),
    "vantage_admin",
  );
  assert.equal(
    deriveFormLeadIngestionOrigin({ commandOrigin: "external_sheet_ingestion" }),
    "best_relocation_sheet",
  );
  assert.equal(
    deriveFormLeadIngestionOrigin({ commandOrigin: "granot_lifecycle" }),
    "granot_lead_created",
  );
  assert.throws(
    () => deriveFormLeadIngestionOrigin({ commandOrigin: "ringcentral" }),
    ValidationError,
  );
});

test("[AC-12] Call origin derivation uses trusted entry points and fails closed", () => {
  assert.equal(deriveCallLeadIngestionOrigin({}), "vantage_admin");
  assert.equal(
    deriveCallLeadIngestionOrigin({ commandOrigin: "vantage_admin" }),
    "vantage_admin",
  );
  assert.equal(
    deriveCallLeadIngestionOrigin({ commandOrigin: "external_sheet_ingestion" }),
    "best_relocation_sheet",
  );
  assert.equal(
    deriveCallLeadIngestionOrigin({ commandOrigin: "ringcentral" }),
    "ringcentral",
  );
  assert.equal(
    deriveCallLeadIngestionOrigin({ commandOrigin: "granot_lifecycle" }),
    "granot_lead_created",
  );
});

test("[AC-10] [AC-11] creation provenance captures ingested snapshots with trusted now", () => {
  const now = new Date("2026-08-17T16:05:00.000Z");
  const form = formLeadCreationProvenanceFields({
    origin: "wordpress_form",
    now,
    contact: {
      name: "Synthetic User",
      phone_number: "5550100100",
      email: "synthetic@example.test",
    },
    move: {
      pickup_zip: "10001",
      destination_zip: "94105",
      move_size: "Studio",
      move_date: now,
    },
    job_no: "ab 12",
  });
  assert.equal(form.ingestion_origin, "wordpress_form");
  assert.equal(form.normalized_job_no, normalizeJobNo("ab 12"));
  assert.equal(form.ingested_contact_snapshot.captured_at, now);
  assert.equal(form.ingested_contact_snapshot.evidence_status, "captured_at_ingestion");
  assert.equal(form.ingested_contact_snapshot.normalized_phone_number, "5550100100");
  assert.equal(form.ingested_move_snapshot.captured_at, now);
  assert.equal(form.ingested_move_snapshot.evidence_status, "captured_at_ingestion");
  assert.throws(
    () =>
      formLeadCreationProvenanceFields({
        origin: "legacy_unknown",
        now,
        contact: {},
        move: {},
      }),
    ValidationError,
  );
});

test("[AC-12] Call creation provenance forces quoted false and captured_at_ingestion", () => {
  const now = new Date("2026-08-17T16:05:00.000Z");
  const call = callLeadCreationProvenanceFields({
    origin: "ringcentral",
    now,
    contact: { phone_number: "5550100101" },
  });
  assert.equal(call.quoted, false);
  assert.equal(call.ingestion_origin, "ringcentral");
  assert.equal(call.ingested_contact_snapshot.evidence_status, "captured_at_ingestion");
  assert.equal(buildIngestedContactSnapshot({}, now).evidence_status, "captured_at_ingestion");
});

test("noSyncOnCreate defaults true for vantage_admin and ignores other-origin client true", () => {
  assert.equal(noSyncOnCreate("vantage_admin"), true);
  assert.equal(noSyncOnCreate("vantage_admin", undefined), true);
  assert.equal(noSyncOnCreate("vantage_admin", false), false);
  assert.equal(noSyncOnCreate("wordpress_form", true), false);
  assert.equal(noSyncOnCreate("ringcentral", true), false);
  assert.equal(noSyncOnCreate("granot_lead_created", true), false);
  assert.equal(noSyncOnCreate("best_relocation_sheet", true), false);
});

test("[AC-07] omitForbiddenLeadLifecycleFields strips internal metadata from updates", () => {
  const stripped = omitForbiddenLeadLifecycleFields({
    name: "Synthetic User",
    ingestion_origin: "granot_lead_created",
    granot_priority: "1",
    ingested_contact_snapshot: { name: "x" },
    domain_revision: 4,
  });
  assert.equal(stripped.name, "Synthetic User");
  assert.equal("ingestion_origin" in stripped, false);
  assert.equal("granot_priority" in stripped, false);
  assert.equal("ingested_contact_snapshot" in stripped, false);
  assert.equal("domain_revision" in stripped, false);
});
