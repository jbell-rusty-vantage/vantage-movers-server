import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { outreachRepairNomination, waitExpiryNomination } from "./worker";

const id = () => new mongoose.Types.ObjectId();

test("repair nominations are semantic: an idle row maps to the same job on every sweep", () => {
  const lead = { _id: id(), booked: null, cancelled: null, duplicate: false, bad_lead: null, no_sync: false };
  const first = outreachRepairNomination("FormLead", lead), again = outreachRepairNomination("FormLead", { ...lead });
  assert.ok(first && again);
  assert.equal(first.dedupe_key, again.dedupe_key);
  assert.equal(first.subject_key, `outreach-lead:FormLead:${lead._id}`);
  // Official flags are the fingerprint; a booking changes it, unrelated edits do not.
  assert.notEqual(outreachRepairNomination("FormLead", { ...lead, booked: id() })!.dedupe_key, first.dedupe_key);
  assert.equal(outreachRepairNomination("FormLead", { ...lead, name: "edited" } as never)!.dedupe_key, first.dedupe_key);

  const call = { _id: id(), contact_number_id: id(), projection_revision: 3 };
  const interaction = outreachRepairNomination("CallInteraction", call)!;
  assert.equal(interaction.subject_key, `number:${call.contact_number_id}`);
  assert.equal(interaction.input_revision, 3);
  assert.equal(outreachRepairNomination("CallInteraction", call)!.dedupe_key, interaction.dedupe_key);
  assert.notEqual(outreachRepairNomination("CallInteraction", { ...call, projection_revision: 4 })!.dedupe_key, interaction.dedupe_key);
  // A call without a Contact Number has no Outreach subject and is never nominated (production stall, 2026-09-21).
  assert.equal(outreachRepairNomination("CallInteraction", { _id: id(), projection_revision: 1 }), null);

  // The Outreach Record key is its own revision, never a sweep-cycle clock:
  // the former cycle key inserted one completed job per record per cycle.
  const record = { _id: id(), revision: 7 };
  const clock = outreachRepairNomination("OutreachRecord", record)!;
  assert.equal(clock.subject_key, `outreach-clock:${record._id}`);
  assert.equal(clock.dedupe_key, `csi:outreach:repair:OutreachRecord:${record._id}:r7`);
  assert.equal(outreachRepairNomination("OutreachRecord", record)!.dedupe_key, clock.dedupe_key);
  assert.doesNotMatch(clock.dedupe_key, /\d{13}/, "no timestamp in the key");
});

test("an expired wait is nominated once per boundary, and a re-dated wait is a new boundary", () => {
  const wait = { _id: id(), outreach_record_id: id(), due_at: new Date("2026-09-21T12:00:00Z") };
  const nomination = waitExpiryNomination(wait)!;
  assert.equal(nomination.subject_key, `outreach-clock:${wait.outreach_record_id}`);
  assert.equal(nomination.input_revision, +wait.due_at);
  assert.deepEqual(nomination.input_refs, [String(wait.outreach_record_id)]);
  assert.equal(waitExpiryNomination(wait)!.dedupe_key, nomination.dedupe_key);
  assert.notEqual(waitExpiryNomination({ ...wait, due_at: new Date("2026-09-22T12:00:00Z") })!.dedupe_key, nomination.dedupe_key);
  assert.equal(waitExpiryNomination({ ...wait, due_at: null }), null);
});
