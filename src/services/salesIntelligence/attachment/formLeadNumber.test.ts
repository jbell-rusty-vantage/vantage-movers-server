import assert from "node:assert/strict";
import { test } from "node:test";
import { formLeadNumberE164 } from "./formLeadNumber";

test("a non-duplicate Form Lead's live phone is its Contact Number E.164; no move-date gate", () => {
  assert.deepEqual(formLeadNumberE164({ normalized_phone_number: "2025550100" }), { e164: "+12025550100" });
  assert.deepEqual(formLeadNumberE164({ normalized_phone_number: "(202) 555-0100", duplicate: false, bad_lead: null }), { e164: "+12025550100" });
});

test("duplicates, Bad Leads and unusable phones never mint a Contact Number", () => {
  assert.deepEqual(formLeadNumberE164({ normalized_phone_number: "2025550100", duplicate: true }), { skip: "duplicate" });
  assert.deepEqual(formLeadNumberE164({ normalized_phone_number: "2025550100", bad_lead: "fake_info" }), { skip: "bad_lead" });
  assert.deepEqual(formLeadNumberE164({ normalized_phone_number: null }), { skip: "no_phone" });
  assert.deepEqual(formLeadNumberE164({ normalized_phone_number: "" }), { skip: "no_phone" });
});
