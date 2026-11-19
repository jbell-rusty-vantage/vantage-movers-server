import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import { FormLead, type FormLeadDocument } from "../../models/FormLead";
import {
  buildCrmFormLeadPayload,
  summarizeCrmPayloadForLog,
} from "./formLeadPayload";

function hydrateFormLead(
  overrides: Partial<FormLeadDocument> = {},
): FormLeadDocument {
  return FormLead.hydrate({
    _id: new mongoose.Types.ObjectId(),
    name: "Jane Customer",
    pickup_zip: "07030",
    destination_zip: "33139",
    email: "jane@example.com",
    phone_number: "555-111-2222",
    move_size: "2 Bedrooms",
    move_date: new Date(Date.UTC(2026, 4, 28)),
    lid: "LID-EXISTING",
    ref_no: "Mob_providerRef123",
    ...overrides,
  }) as FormLeadDocument;
}

test("[AC-03] buildCrmFormLeadPayload uses the provider ref_no as Granot leadno", () => {
  const lead = hydrateFormLead({
    lid: "LID6a6255e58ad8d",
    ref_no: "DT_czj2atkThs",
  });
  const payload = buildCrmFormLeadPayload(lead);
  assert.equal(payload.leadno, "DT_czj2atkThs");
});

test("[AC-03] Form Job Number parity does not reinterpret ref_no as CRM leadno", () => {
  const lead = hydrateFormLead({
    ref_no: "DT_czj2atkThs",
    job_no: "P5556278",
    normalized_job_no: "P5556278",
  });
  const payload = buildCrmFormLeadPayload(lead);
  assert.equal(payload.leadno, "DT_czj2atkThs");
  assert.notEqual(payload.leadno, lead.job_no);
  assert.notEqual(payload.leadno, lead.normalized_job_no);
});

test("buildCrmFormLeadPayload maps lead fields onto the Granot wire shape", () => {
  const lead = hydrateFormLead({
    name: "Jane Maria Customer",
    pickup_zip: "10001",
    destination_zip: "90210",
    email: "jane@example.com",
    phone_number: "555-111-2222",
    move_size: "Studio",
    move_date: new Date(2026, 5, 1),
  });

  const payload = buildCrmFormLeadPayload(lead, "Main Site Forms");

  assert.deepEqual(
    {
      label: payload.label,
      firstname: payload.firstname,
      lastname: payload.lastname,
      ozip: payload.ozip,
      dzip: payload.dzip,
      email: payload.email,
      phone1: payload.phone1,
      movesize: payload.movesize,
      movedte: payload.movedte,
      leadno: payload.leadno,
    },
    {
      label: "Main Site Forms",
      firstname: "Jane",
      lastname: "Customer",
      ozip: "10001",
      dzip: "90210",
      email: "jane@example.com",
      phone1: "555-111-2222",
      movesize: "Studio",
      movedte: "6/1/2026",
      leadno: "Mob_providerRef123",
    },
  );
});

test("[AC-08] CRM payload does not invent an absent trusted Granot move date", () => {
  const lead = hydrateFormLead({ move_date: undefined });
  assert.equal(buildCrmFormLeadPayload(lead).movedte, "");
});

test("summarizeCrmPayloadForLog masks PII and fingerprints identifiers and locations", () => {
  const lead = hydrateFormLead({
    name: "Jane Maria Customer",
    pickup_zip: "10001",
    destination_zip: "90210",
    email: "jane@example.com",
    phone_number: "5551112222",
  });
  const payload = buildCrmFormLeadPayload(lead, "BestRelocation");
  const summary = summarizeCrmPayloadForLog(payload);

  assert.equal(summary.label, "BestRelocation");
  assert.equal(summary.firstname, "J***");
  assert.equal(summary.lastname, "C***");
  assert.equal(summary.email, "j***@example.com");
  assert.equal(summary.phone1, "***2222");
  assert.match(summary.ozip, /^sha256:[0-9a-f]{12}$/);
  assert.match(summary.dzip, /^sha256:[0-9a-f]{12}$/);
  assert.match(summary.leadno, /^sha256:[0-9a-f]{12}$/);
  assert.match(summary.notes, /^sha256:[0-9a-f]{12}$/);
  assert.notEqual(summary.leadno, payload.leadno);
  assert.notEqual(summary.notes, payload.notes);
});
