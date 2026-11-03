import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { CALL_SHEET_HEADERS, SHEET_TAB_NAMES } from "../../config/domain";
import { BEST_RELOCATION_TRACKER_ID, EXTERNAL_REVIEW_POLICY_VERSION, type ExternalSheetReview } from "../leads/externalSheetReview";
import { noSyncAppliesToNormalTabs } from "../sheetSync/noSyncLead";
import { planExpectedSheetTabs } from "./expectedSheetTabs";
import { syncCallLeadToSheets } from "./googleSheets.service";
import { callLeadTargets, hasFormBadProjection } from "./leadReportingTargets";
import { formLeadToRow } from "./projections/formLeadRow";
import { getMasterLeadsTabs, getSourceLeadTabs } from "./targets";
import type { CallLeadSheetSource, FormLeadSheetSource } from "./types";

const previousMaster = process.env.TEST_MASTER_LEADS_SHEET_ID;
const previousLiveMaster = process.env.MASTER_LEADS_SHEET_ID;
afterEach(() => {
  if (previousLiveMaster === undefined) delete process.env.MASTER_LEADS_SHEET_ID;
  else process.env.MASTER_LEADS_SHEET_ID = previousLiveMaster;
  if (previousMaster === undefined) delete process.env.TEST_MASTER_LEADS_SHEET_ID;
  else process.env.TEST_MASTER_LEADS_SHEET_ID = previousMaster;
});
const rc = { call_log_id: "rc-1", duration_seconds: 120, ingestion_source: "call_log_sync", qualification_reason: "call_log_inbound_target_answered_over_120s" };
function review(kind: ExternalSheetReview["kind"], raw_value = "Owner note"): ExternalSheetReview {
  return { kind, reason_code: kind === "bad_form" ? "external_bad_form" : kind === "bad_call" ? "external_bad_call" : "external_duplicate", raw_value, normalized_value: raw_value.toLowerCase(), source_workbook_id: BEST_RELOCATION_TRACKER_ID, source_sheet_id: kind === "bad_form" ? 0 : 1191420872, source_tab: kind === "bad_form" ? "Forms" : "Calls", stable_source_row_id: "row-1", source_content_hash: "a".repeat(64), policy_version: EXTERNAL_REVIEW_POLICY_VERSION, ingestion_run_id: "run-1", source_row_receipt_id: "receipt-1", applied_at: new Date("2026-11-03T12:00:00Z") };
}

test("contains and write routing agree on effective call disposition and no-sync exceptions", () => {
  process.env.TEST_MASTER_LEADS_SHEET_ID = "fixture-master";
  process.env.MASTER_LEADS_SHEET_ID = "fixture-master";
  const overnight = { ...rc, start_time: new Date("2026-11-01T05:30:00Z"), final_result: "Missed", final_result_answered: false, final_result_call_log_id: "rc-1", final_result_observed_at: new Date() };
  for (const [flags, expected] of [
    [{ ringcentral: rc }, SHEET_TAB_NAMES.calls],
    [{ ringcentral: rc, form_fill: true, no_sync: true }, SHEET_TAB_NAMES.duplicateCalls],
    [{ ringcentral: overnight, no_sync: true }, SHEET_TAB_NAMES.badCalls],
    [{ ringcentral: overnight, form_fill: true }, SHEET_TAB_NAMES.duplicateCalls],
    [{ ringcentral: rc, external_sheet_review: review("bad_call"), no_sync: true }, SHEET_TAB_NAMES.badCalls],
    [{ ringcentral: rc, external_sheet_review: review("duplicate_call") }, SHEET_TAB_NAMES.duplicateCalls],
  ] as const) {
    const plan = planExpectedSheetTabs("CallLead", flags);
    const targets = callLeadTargets({ ...flags, source_company: "main_site" });
    assert.deepEqual(plan.expected.map((tab) => tab.tabName), [expected]);
    assert.deepEqual(targets.map((target) => target.tabName), [expected]);
    assert.equal(plan.siblings.length, 2);
    assert.equal(targets[0].headers, CALL_SHEET_HEADERS);
    assert.equal(noSyncAppliesToNormalTabs(flags), false);
  }
});

test("direct facade rejects unqualified and unmatched calls before any Google access", async () => {
  const base = { _id: { toString: () => "call-1" }, source_company: "main_site" };
  assert.deepEqual(await syncCallLeadToSheets(base as CallLeadSheetSource), []);
  assert.deepEqual(await syncCallLeadToSheets({ ...base, ringcentral: rc, created_on_unmatched: true, duplicate: true } as CallLeadSheetSource), []);
});

test("imported Form notes remain supplemental on duplicate booked Forms and inert in projection", () => {
  const lead = { _id: { toString: () => "form-1" }, timestamp: new Date(), name: "Fixture", pickup_zip: "10001", destination_zip: "90001", move_date: new Date(), phone_number: "5551234567", source_company: "main_site", local: "long_distance", duplicate: true, booked: "booking-1", external_sheet_review: review("bad_form", '=IMPORTXML("https://example.invalid")'), no_sync: true } as FormLeadSheetSource;
  assert.equal(hasFormBadProjection(lead), true);
  assert.deepEqual(planExpectedSheetTabs("FormLead", lead).expected.map((tab) => tab.tabName), [SHEET_TAB_NAMES.duplicates, SHEET_TAB_NAMES.badLeads]);
  const row = formLeadToRow(lead);
  assert.equal(row.length, 22);
  assert.equal(row[20], '\'=IMPORTXML("https://example.invalid")');
  assert.equal(row[12], "booked");
  assert.equal(hasFormBadProjection({ external_sheet_review: { kind: "bad_form", raw_value: "forged" } }), false);
});

test("provisioning uses canonical names and each source tab appears only once", () => {
  const titles = getMasterLeadsTabs().map((tab) => tab.tabName);
  assert.deepEqual(titles, ["Forms", "Calls", "Duplicate Forms", "Duplicate Calls", "Bad Form Leads", "Bad Call Leads"]);
  for (const source of ["main_site", "best_relocation_leads", "tbm_leads"]) {
    const tabs = getSourceLeadTabs(source);
    assert.equal(new Set(tabs.map((tab) => tab.tabName)).size, tabs.length);
  }
});
