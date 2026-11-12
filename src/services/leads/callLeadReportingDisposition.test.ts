import assert from "node:assert/strict";
import { test } from "node:test";
import { getCallLeadReportingDecision as decision } from "./callLeadReportingDisposition";
import { classifyExternalReview, BEST_RELOCATION_TRACKER_ID, EXTERNAL_REVIEW_POLICY_VERSION } from "./externalSheetReview";

const qualified = (start: string, result = "Missed", answered = false) => ({ ringcentral: {
  ingestion_source: "call_log_sync", qualification_reason: "call_log_inbound_target_elapsed_at_least_120s",
  duration_seconds: 121, call_log_id: "call-1", start_time: new Date(start), final_result: result,
  final_result_answered: answered, final_result_call_log_id: "call-1", final_result_observed_at: new Date("2026-11-03T00:00:00Z"),
} });
const review = (kind: "duplicate_call" | "bad_call") => ({
  kind, reason_code: kind === "bad_call" ? "external_bad_call" : "external_duplicate", raw_value: "note", normalized_value: "note",
  source_workbook_id: BEST_RELOCATION_TRACKER_ID, source_sheet_id: 1191420872, source_tab: "Calls", stable_source_row_id: "vantage:stable",
  source_content_hash: "a".repeat(64), policy_version: EXTERNAL_REVIEW_POLICY_VERSION, ingestion_run_id: "run", source_row_receipt_id: "receipt", applied_at: new Date(),
});
test("overnight uses New York arrival, including DST repeated hour and summer", () => {
  for (const [instant, expected] of [
    ["2026-11-03T05:59:59Z", "calls"], ["2026-11-03T06:00:00Z", "bad_call_leads"],
    ["2026-11-03T11:59:59Z", "bad_call_leads"], ["2026-11-03T12:00:00Z", "calls"],
    ["2026-11-01T05:30:00Z", "bad_call_leads"], ["2026-11-01T06:30:00Z", "bad_call_leads"],
    ["2026-07-01T05:30:00Z", "bad_call_leads"],
  ]) assert.equal(decision(qualified(instant!)).disposition, expected);
});
test("result and same-call answered evidence prevent false missed classifications", () => {
  for (const result of ["Busy", "Voicemail", "No Answer", "Abandoned", "Answered", ""]) assert.equal(decision(qualified("2026-11-03T08:00:00Z", result)).billable, true);
  assert.deepEqual(decision(qualified("2026-11-03T08:00:00Z", "Missed", true)), { disposition: "calls", billable: true, reason_codes: ["conflicting_final_result"] });
  const call = qualified("2026-11-03T08:00:00Z"); call.ringcentral.final_result_call_log_id = "other-call";
  assert.equal(decision(call).disposition, "calls");
});
test("qualification wins; duplicates retain bad reasons; No-Sync does not change billing", () => {
  const call = qualified("2026-11-03T08:00:00Z");
  const result = decision({ ...call, form_fill: true, no_sync: true, external_sheet_review: review("bad_call") });
  assert.equal(result.disposition, "duplicate_calls"); assert.equal(result.billable, false);
  assert.deepEqual(result.reason_codes, ["form_fill", "external_bad_call", "overnight_missed_call"]);
  assert.equal(decision({ ...call, created_on_unmatched: true, external_sheet_review: review("duplicate_call") }).disposition, "excluded");
  assert.equal(decision({ external_sheet_review: review("bad_call") }).disposition, "excluded");
  assert.equal(decision({ ...qualified("2026-11-03T18:00:00Z"), no_sync: true }).billable, true);
  assert.equal(decision({ ...qualified("2026-11-03T18:00:00Z"), external_sheet_review: { kind: "bad_call" } }).billable, true);
});
test("checker mapping is exact, literal for Forms, and retains unknown genuine notes", () => {
  for (const value of [" FORM FILL ", "Duplicate", " Duplicate  Call "]) assert.equal(classifyExternalReview(value, "CallLead")?.kind, "duplicate_call");
  for (const value of ["international number", "current customer", "another moving company", "looking for fedex", "dead air", "labor only", "unloading truck only", "not moving", "Auto Transport Only", "sentence mentioning Duplicate Call"]) assert.equal(classifyExternalReview(value, "CallLead")?.kind, "bad_call");
  for (const value of ["", "  ", "no", "xx"]) assert.equal(classifyExternalReview(value, "FormLead"), null);
  for (const value of ["abc", "Duplicate Form", "Duplicate", "Bad Info", "=formula-like inert note"]) assert.equal(classifyExternalReview(value, "FormLead")?.kind, "bad_form");
  assert.throws(() => classifyExternalReview("#REF!", "CallLead"));
  assert.throws(() => classifyExternalReview("x".repeat(4001), "FormLead"));
});
test("Unicode labels normalize, detailed reasons agree with the specification, raw text remains exact", () => {
  const raw = "  \uFF26\uFF4F\uFF52\uFF4D\u3000\uFF26\uFF49\uFF4C\uFF4C  ";
  const fact = classifyExternalReview(raw, "CallLead");
  assert.equal(fact?.kind, "duplicate_call"); assert.equal(fact?.reason_code, "external_form_fill");
  assert.equal(fact?.normalized_value, "form fill"); assert.equal(fact?.raw_value, raw);
  assert.equal(classifyExternalReview(" Duplicate Call ", "CallLead")?.reason_code, "external_duplicate");
  const result = decision({...qualified("2026-11-03T18:00:00Z"), external_sheet_review: review("duplicate_call")});
  assert.deepEqual(result, {disposition:"duplicate_calls",billable:false,reason_codes:["external_duplicate"]});
});
