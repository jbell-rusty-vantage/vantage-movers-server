import assert from "node:assert/strict";
import test from "node:test";
import { attachSidecar, BOOKED_SOURCE_ID, parseFrozenSnapshot, type FrozenSourceSnapshot } from "./sourceSnapshot";
import { partitionSourceIdentities, financialAdoptionMatches, primaryReceiptReference } from "./sourcePlan";
import { BEST_RELOCATION_TRACKER_ID, EXTERNAL_REVIEW_POLICY_VERSION } from "../../src/services/leads/externalSheetReview";
import type { SourceTab, TabReadResult } from "../../src/services/bestRelocationSheetIngest/types";

function tab(name: string, headers: string[], rows: string[][], id: number): TabReadResult {
  return { spreadsheetId: ["Booked Deals", "Refunds", "LID_BestRelo"].includes(name) ? BOOKED_SOURCE_ID : BEST_RELOCATION_TRACKER_ID,
    spreadsheetTitle: "Synthetic", tabId: id, tabName: name as SourceTab, headers, matrix: [headers, ...rows], rangeRead: "frozen" };
}
const formHeaders = ["Time Stamp", "Name", "Pickup Zip", "Destination Zip", "Move Size", "Move Date", "Phone", "Lead ID", "Ref No", "Bad Lead Checker"];
const form = (id: string, stamp = "2026-05-01T16:00:00Z") => [stamp, "Synthetic", "10001", "20001", "1 Bedroom", "", "+15550001234", id, "", "Bad Info"];
const callHeaders = ["PHONE NUMBER", "Date", "Time", "Form Fill Checker"];
function snapshot(): FrozenSourceSnapshot {
  return { version: EXTERNAL_REVIEW_POLICY_VERSION, captured_at: "2026-11-03T12:00:00Z", through: "2026-11-03T12:00:00Z", final_capture: false,
    workbooks: [{ id: BEST_RELOCATION_TRACKER_ID, title: "Synthetic", timezone: "America/New_York" }, { id: BOOKED_SOURCE_ID, title: "Synthetic", timezone: "America/Detroit" }], sidecar: [],
    tabs: [tab("Forms", formHeaders, [], 0), tab("Local Forms", formHeaders, [], 584355266), tab("Calls", callHeaders, [], 1191420872), tab("Local Calls", callHeaders, [], 625096718),
      tab("Booked Deals", ["Timestamp", "Agent", "Book Date", "Job Number:", "Customer Name", "Binder Amount", "Deposit Amount", "Merchant", "Lead Source", "LID"], [], 1668297426),
      tab("Refunds", ["Refund Request Date", "Status", "Timestamp", "Agent", "Job Number:", "Customer Name", "Binder Amount", "Deposit Amount", "Lead Source"], [], 151349723),
      tab("LID_BestRelo", ["Evidence"], [], 808380015)],
  };
}
test("duplicate Form identities quarantine every cohort member while independent Forms still plan", () => {
  const frozen = snapshot();
  frozen.tabs[0]!.matrix.push(form("synthetic-duplicate"), form("synthetic-independent"));
  frozen.tabs[1]!.matrix.push(form("synthetic-duplicate"));
  const parsed = parseFrozenSnapshot(frozen);
  const partition = partitionSourceIdentities(parsed.data);
  assert.equal(partition.conflicts.size, 2);
  assert.ok([...partition.conflicts.values()].every(entry => entry.reason === "duplicate_source_identity"));
  assert.equal(partition.data.forms.length, 1);
  assert.equal(partition.data.forms[0]?.lead_id, "synthetic-independent");
  assert.equal(partition.data.localForms.length, 0);
});
test("captured duplicate/copy Call identities are retained then quarantined, with stable sidecar on replay", () => {
  const frozen = snapshot();
  frozen.tabs[2]!.matrix.push(["+15550001234", "5/1/2026", "12:00:00 PM", "Form Fill"], ["+15550001234", "5/1/2026", "12:00:00 PM", "Bad Call"]);
  attachSidecar(frozen);
  const original = JSON.stringify(frozen.sidecar);
  attachSidecar(frozen);
  assert.equal(JSON.stringify(frozen.sidecar), original);
  assert.equal(frozen.tabs[2]!.matrix.length, 3);
  const partition = partitionSourceIdentities(parseFrozenSnapshot(frozen).data);
  assert.equal(partition.conflicts.size, 2);
  assert.equal(partition.data.calls.length, 0);
});
test("source cutoff, through watermark, invalid times and unrelated financial sources reconcile all parsed rows", () => {
  const frozen = snapshot();
  frozen.tabs[0]!.matrix.push(form("pre-cutoff", "2026-04-30T03:59:59Z"), form("at-cutoff", "2026-04-30T04:00:00Z"), form("after-through", "2026-11-03T12:00:00Z"), form("invalid-time", "unparseable"));
  frozen.tabs[4]!.matrix.push(["unparseable", "Synthetic", "", "other-job", "Synthetic", "100", "100", "Elavon", "Other Company", ""]);
  const { data, inventory } = parseFrozenSnapshot(frozen);
  assert.deepEqual(inventory.forms, { parsed: 4, in_window: 1, older: 1, invalid_time: 1, after_through: 1, out_of_scope: 0 });
  assert.equal(inventory.booked?.out_of_scope, 1);
  assert.equal(inventory.booked?.invalid_time, 0);
  assert.equal(data.forms[0]?.lead_id, "at-cutoff");
  assert.equal(data.booked.length, 0);
});
test("loaded snapshot must still verify Local Calls emptiness, identity and fixed watermark", () => {
  const populated = snapshot(); populated.tabs[3]!.matrix.push(["+15550001111"]);
  assert.throws(() => parseFrozenSnapshot(populated), /local_calls_scope_discrepancy/);
  const incorrect = snapshot(); incorrect.tabs[0]!.spreadsheetId = "other-book";
  assert.throws(() => parseFrozenSnapshot(incorrect), /snapshot_tab_source_identity_mismatch/);
  const invalid = snapshot(); invalid.through = "2027-01-01T00:00:00Z";
  assert.throws(() => parseFrozenSnapshot(invalid), /invalid_frozen_snapshot_watermark/);
  const missingChecker = snapshot(); missingChecker.tabs[0]!.headers = missingChecker.tabs[0]!.headers.filter(header => header !== "Bad Lead Checker");
  assert.throws(() => parseFrozenSnapshot(missingChecker), /snapshot_schema_drift/);
});
test("financial adoption uses original intended money and source scope even after command payload is stripped", () => {
  const payload = { total_binder_amount: 200, deposit_amount: 100 };
  assert.equal(financialAdoptionMatches("BookedLead", payload, { source: "best_relocation_leads", total_binder_amount: 200, deposit_amount: 100 }), true);
  assert.equal(financialAdoptionMatches("BookedLead", payload, { source: "best_relocation_leads", total_binder_amount: 100, deposit_amount: 100 }), false);
  assert.equal(financialAdoptionMatches("BookedLead", undefined, { source: "best_relocation_leads", total_binder_amount: 200, deposit_amount: 100 }), false);
  assert.equal(financialAdoptionMatches("BookedLead", payload, { source: "other_company", total_binder_amount: 200, deposit_amount: 100 }), false);
  assert.equal(financialAdoptionMatches("CancelledLead", { refund_amount: 50 }, { source: "BestRelocation Inbounds", refund_amount: 50 }), true);
});
test("financial receipt first ID is primary while linked IDs remain linkage evidence", () => {
  const primary = "507f1f77bcf86cd799439001", linked = "507f1f77bcf86cd799439002";
  assert.deepEqual(primaryReceiptReference("BookedLead", [primary, linked]), { primary: { model: "BookedLead", id: primary }, related_ids: [linked] });
  assert.deepEqual(primaryReceiptReference("CancelledLead", [primary, linked]), { primary: { model: "CancelledLead", id: primary }, related_ids: [linked] });
  assert.equal(primaryReceiptReference("FormLead", [primary, linked]), null);
  assert.equal(primaryReceiptReference("BookedLead", [primary, "malformed"]), null);
});
