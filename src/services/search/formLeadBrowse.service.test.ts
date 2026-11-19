import assert from "node:assert/strict";
import { test } from "node:test";
import { FormLead } from "../../models/FormLead";
import { browseFormLeadsQuerySchema } from "../../validation/v1.validation";
import { browseFormLeads } from "./formLeadBrowse.service";

test("browsing includes quarantined Forms and shows their Booking and Cancellation without exposing contact history", async (t) => {
  const form = {
    _id: "form", name: "Current Name", duplicate: true,
    ingested_contact_snapshot: { name: "Original Name" },
    granot_contact_snapshot: { name: "Granot Name" },
    booked: { _id: "booking", job_no: "MOV100", cancelled: "cancellation" },
    cancelled: { _id: "cancellation", job_no: "MOV100", reason: "customer request" },
  };
  const query = {
    sort() { return this; },
    skip() { return this; },
    limit() { return this; },
    populate() { return this; },
    lean() { return this; },
    exec: async () => [form],
  };
  t.mock.method(FormLead, "find", (filter: unknown) => {
    assert.deepEqual(filter, {});
    return query;
  });
  t.mock.method(FormLead, "countDocuments", (filter: unknown) => {
    assert.deepEqual(filter, {});
    return { exec: async () => 1 };
  });

  const page = await browseFormLeads(browseFormLeadsQuerySchema.parse({}));
  assert.equal(page.count, 1);
  const [card] = page.results;
  assert.equal(card.name, "Current Name");
  assert.equal(card.booked?.cancelled, "cancellation");
  assert.equal(card.cancelled?.job_no, "MOV100");
  assert.equal("ingested_contact_snapshot" in card, false);
  assert.equal("granot_contact_snapshot" in card, false);
});
