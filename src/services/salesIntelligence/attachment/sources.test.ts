import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { leadAttachmentFingerprint, type LeadSource } from "./sources";

const at = new Date("2026-09-18T12:00:00Z");
function lead(over: Partial<LeadSource> = {}): LeadSource {
  return { _id: new mongoose.Types.ObjectId("aaaaaaaaaaaaaaaaaaaaaaaa"), timestamp: at, createdAt: at, updatedAt: at,
    normalized_phone_number: "2025550100", name: "Synthetic", job_no: "J1", booked: null, cancelled: null, duplicate: false, bad_lead: null,
    ingested_contact_snapshot: { normalized_phone_number: "2025550100", captured_at: at }, ...over };
}

test("the attachment fingerprint ignores unrelated Lead edits and changes with identity or display inputs", () => {
  const base = leadAttachmentFingerprint(lead());
  assert.equal(leadAttachmentFingerprint(lead({ updatedAt: new Date(+at + 86_400_000) })), base, "updatedAt is not identity");
  assert.equal(leadAttachmentFingerprint(lead({ ingested_contact_snapshot: { normalized_phone_number: "2025550100", captured_at: at, phone_number: undefined } })), base);
  assert.notEqual(leadAttachmentFingerprint(lead({ normalized_phone_number: "2025550199" })), base, "live phone");
  assert.notEqual(leadAttachmentFingerprint(lead({ current_contact_provenance: { changed_at: new Date(+at + 1000) } })), base, "phone change time bounds the evidence window");
  assert.notEqual(leadAttachmentFingerprint(lead({ granot_contact_snapshot: { phone_number: "(202) 555-0100", captured_at: at } })), base, "new snapshot path");
  assert.notEqual(leadAttachmentFingerprint(lead({ booked: new mongoose.Types.ObjectId() })), base, "display snapshot follows official flags");
  assert.notEqual(leadAttachmentFingerprint(lead({ ringcentral: { call_log_id: "log-1" } })), base, "exact identity alias");
  assert.notEqual(leadAttachmentFingerprint(lead({ name: "Renamed" })), base, "display name is refreshed on the edge");
});
