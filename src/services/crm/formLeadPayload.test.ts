import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import { FormLead, type FormLeadDocument } from "../../models/FormLead";
import {
  buildCrmFormLeadPayload,
  formatCrmMoveDate,
  splitNameForCrm,
  summarizeCrmPayloadForLog,
} from "./formLeadPayload";
import { CRM_FORM_LEAD_LABEL } from "./crmConfig";

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
    ...overrides,
  }) as FormLeadDocument;
}

test("splitNameForCrm returns empty firstname and lastname for blank input", () => {
  assert.deepEqual(splitNameForCrm(""), { firstname: "", lastname: "" });
  assert.deepEqual(splitNameForCrm("   "), { firstname: "", lastname: "" });
});

test("splitNameForCrm duplicates a single token into firstname and lastname", () => {
  assert.deepEqual(splitNameForCrm("Madonna"), {
    firstname: "Madonna",
    lastname: "Madonna",
  });
  assert.deepEqual(splitNameForCrm("  Bob  "), {
    firstname: "Bob",
    lastname: "Bob",
  });
});

test("splitNameForCrm takes the first and last token for multi-word names", () => {
  assert.deepEqual(splitNameForCrm("Jane Maria Customer"), {
    firstname: "Jane",
    lastname: "Customer",
  });
  assert.deepEqual(splitNameForCrm("  John   Q.   Public  "), {
    firstname: "John",
    lastname: "Public",
  });
});

test("formatCrmMoveDate produces unpadded M/D/YYYY local-component date", () => {
  const d = new Date(2026, 0, 5);
  assert.equal(formatCrmMoveDate(d), "1/5/2026");
  const d2 = new Date(2025, 11, 31);
  assert.equal(formatCrmMoveDate(d2), "12/31/2025");
});

test("buildCrmFormLeadPayload defaults label to CRM_FORM_LEAD_LABEL when blank", () => {
  const lead = hydrateFormLead();
  const payload = buildCrmFormLeadPayload(lead, "   ");
  assert.equal(payload.label, CRM_FORM_LEAD_LABEL);
});

test("buildCrmFormLeadPayload uses lead Mongo _id as leadno (Granot ref_no contract)", () => {
  const lead = hydrateFormLead();
  const payload = buildCrmFormLeadPayload(lead);
  assert.equal(payload.leadno, lead._id.toString());
});

test("buildCrmFormLeadPayload generates a notes lead id for Granot", () => {
  const lead = hydrateFormLead({ lid: "LID-12345" });
  const payload = buildCrmFormLeadPayload(lead);
  assert.match(payload.notes, /^LID[0-9a-f]{13}$/);
  assert.notEqual(payload.notes, "LID-12345");
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
      leadno: lead._id.toString(),
    },
  );
});

test("summarizeCrmPayloadForLog masks name, email, and phone but keeps zips, label, and leadno", () => {
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
  assert.equal(summary.ozip, "10001");
  assert.equal(summary.dzip, "90210");
  assert.equal(summary.leadno, payload.leadno);
});

test("summarizeCrmPayloadForLog handles blank PII fields without throwing", () => {
  const lead = hydrateFormLead({
    name: "",
    email: undefined,
    phone_number: "",
  });
  const payload = buildCrmFormLeadPayload(lead, "Main Site Forms");
  const summary = summarizeCrmPayloadForLog(payload);

  assert.equal(summary.firstname, "");
  assert.equal(summary.lastname, "");
  assert.equal(summary.email, "");
  assert.equal(summary.phone1, "");
});
