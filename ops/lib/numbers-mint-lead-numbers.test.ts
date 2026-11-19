import assert from "node:assert/strict";
import { test } from "node:test";
import { SYNTHETIC_COMPANY_DID, syntheticDirectory } from "../../src/services/numberActivity/fixtures";
import { decideLeadMint, mintCandidatesOf } from "./numbers-mint-lead-numbers";

test("mint decision: skip rules, existing number reused, two Leads on one phone mint once, our own DID skipped", () => {
  const directory = syntheticDirectory();
  const none = new Set<string>();
  const callLead = { _id: "c1", normalized_phone_number: "2025550100" };
  assert.deepEqual(decideLeadMint("CallLead", callLead, none, none, directory), { kind: "mint", e164: "+12025550100" });
  assert.deepEqual(decideLeadMint("CallLead", callLead, new Set(["+12025550100"]), none, directory), { kind: "numbered", e164: "+12025550100" });
  assert.deepEqual(decideLeadMint("FormLead", { _id: "f1", normalized_phone_number: "2025550100" }, none, new Set(["+12025550100"]), directory),
    { kind: "numbered", e164: "+12025550100" }, "an earlier Lead of this run mints the shared phone");
  assert.deepEqual(decideLeadMint("CallLead", { _id: "c2", normalized_phone_number: SYNTHETIC_COMPANY_DID.slice(2) }, none, none, directory),
    { kind: "skip", reason: "company_number" });
  assert.deepEqual(decideLeadMint("CallLead", { _id: "c3", normalized_phone_number: "2025550100", duplicate: true }, none, none, directory),
    { kind: "skip", reason: "duplicate" });
  assert.deepEqual(decideLeadMint("CallLead", { _id: "c4", normalized_phone_number: "2025550100", bad_lead: "spam" }, none, none, directory),
    { kind: "skip", reason: "bad_lead" });
  assert.deepEqual(decideLeadMint("FormLead", { _id: "f2", normalized_phone_number: null }, none, none, directory), { kind: "skip", reason: "no_phone" });
  assert.deepEqual(decideLeadMint("CallLead", { _id: "c5", ringcentral: { original_caller: { normalized_phone_number: "2025550177" } } }, none, none, null),
    { kind: "mint", e164: "+12025550177" }, "a Call Lead without a live phone mints its original caller");
});

test("olr CW1 mint decision: snapshot-only Leads mint, the live phone stays first, a DID passes to the next phone; the batch read covers every phone", () => {
  const directory = syntheticDirectory();
  const none = new Set<string>();
  const snapshotOnly = { _id: "s1", granot_contact_snapshot: { normalized_phone_number: "2025550104" } };
  assert.deepEqual(decideLeadMint("CallLead", snapshotOnly, none, none, directory), { kind: "mint", e164: "+12025550104" });
  const both = { _id: "s2", normalized_phone_number: "2025550101", ingested_contact_snapshot: { normalized_phone_number: "2025550103" } };
  assert.deepEqual(decideLeadMint("FormLead", both, new Set(["+12025550103"]), none, directory), { kind: "mint", e164: "+12025550101" });
  const didFirst = { _id: "s3", normalized_phone_number: SYNTHETIC_COMPANY_DID.slice(2), ingested_contact_snapshot: { normalized_phone_number: "2025550103" } };
  assert.deepEqual(decideLeadMint("CallLead", didFirst, none, none, directory), { kind: "mint", e164: "+12025550103" });
  assert.deepEqual(decideLeadMint("CallLead", didFirst, new Set(["+12025550103"]), none, directory), { kind: "numbered", e164: "+12025550103" });
  assert.deepEqual(mintCandidatesOf("CallLead", didFirst), [SYNTHETIC_COMPANY_DID, "+12025550103"]);
  assert.deepEqual(mintCandidatesOf("CallLead", { _id: "d", normalized_phone_number: "2025550100", duplicate: true }), []);
});
