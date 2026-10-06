import assert from "node:assert/strict";
import { test } from "node:test";
import { SYNTHETIC_COMPANY_DID, syntheticDirectory } from "../../src/services/numberActivity/fixtures";
import { decideLeadMint, emptyMintTally, mintSourceOf, parseMintArgs, tallyMint } from "./numbers-mint-lead-numbers";

test("mint args: target required and plain, dry run and desk scope by default, unknown flags refused", () => {
  assert.deepEqual(parseMintArgs(["--target=testdb"]), { target: "testdb", scope: "desk", apply: false, limit: null });
  assert.deepEqual(parseMintArgs(["--target=vantagemovers", "--scope=all", "--apply", "--limit=5", "--allow-schema-drift"]),
    { target: "vantagemovers", scope: "all", apply: true, limit: 5 });
  assert.throws(() => parseMintArgs([]), /--target/);
  assert.throws(() => parseMintArgs(["--target=a.b"]), /plain database name/);
  assert.throws(() => parseMintArgs(["--target=x", "--scope=everything"]), /--scope/);
  assert.throws(() => parseMintArgs(["--target=x", "--limit=0"]), /--limit/);
  assert.throws(() => parseMintArgs(["--target=x", "--apply=yes"]), /Unknown argument/);
  assert.throws(() => parseMintArgs(["--target=x", "--force"]), /Unknown argument/);
});

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

test("mint source and tally", () => {
  const received = new Date("2026-08-01T00:00:00Z");
  assert.deepEqual(mintSourceOf({ _id: "c1", createdAt: received, bad_lead: "spam", normalized_phone_number: "2025550100" }),
    { _id: "c1", timestamp: received, duplicate: false, bad_lead: "spam", normalized_phone_number: "2025550100", original_caller_phone: null });
  const tally = emptyMintTally();
  for (const decision of [{ kind: "mint", e164: "+1" }, { kind: "numbered", e164: "+2" }, { kind: "skip", reason: "no_phone" },
    { kind: "skip", reason: "company_number" }, { kind: "mint", e164: "+3" }] as const) tallyMint(tally, decision);
  assert.deepEqual(tally, { leads_checked: 5, numbers_reused: 1, numbers_to_create: 2, skipped: { no_phone: 1, company_number: 1, duplicate: 0, bad_lead: 0 } });
});
