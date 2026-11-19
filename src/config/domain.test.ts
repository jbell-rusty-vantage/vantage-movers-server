import assert from "node:assert/strict";
import test from "node:test";
import {
  CALL_SHEET_HEADERS,
  FORM_SHEET_HEADERS,
  SHEET_TAB_NAMES,
  getCallLeadSourceCompanyLabel,
  getFormLeadSourceCompanyLabel,
} from "./domain";

test("lead sheet headers include booked date on Forms and Calls tabs", () => {
  assert.ok(FORM_SHEET_HEADERS.includes("Booked Date"));
  assert.ok(CALL_SHEET_HEADERS.includes("Booked Date"));
});

test("call sheet headers omit owner-hidden descriptive and location columns", () => {
  const callHeaders: readonly string[] = CALL_SHEET_HEADERS;
  for (const header of [
    "Name",
    "Email",
    "Pickup Zip",
    "Delivery Zip",
    "Pickup State",
    "Delivery State",
  ]) {
    assert.equal(callHeaders.includes(header), false);
  }
});

test("lead sheet configuration includes duplicate and form fill surfaces", () => {
  assert.equal(SHEET_TAB_NAMES.duplicates, "Duplicate Forms");
  assert.equal(SHEET_TAB_NAMES.badLeads, "Bad Form Leads");
  assert.equal(SHEET_TAB_NAMES.badCalls, "Bad Call Leads");
  assert.equal(CALL_SHEET_HEADERS.at(-1), "Sales Rep");
  assert.equal((FORM_SHEET_HEADERS as readonly string[]).includes("Duplicate"), false);
});

test("lead sheet source company labels are precise by lead type", () => {
  assert.equal(getFormLeadSourceCompanyLabel("tbm_leads"), "TBM Forms");
  assert.equal(getCallLeadSourceCompanyLabel("tbm_leads"), "10best Inbounds");
  assert.equal(getFormLeadSourceCompanyLabel("tbm_prime_leads"), "TBM Prime Forms");
  assert.equal(getCallLeadSourceCompanyLabel("tbm_prime_leads"), "TBM Prime Inbounds");
  assert.equal(getFormLeadSourceCompanyLabel("top10_leads"), "Top10 Forms");
  assert.equal(getCallLeadSourceCompanyLabel("top10_leads"), "Top10 Inbounds");
  assert.equal(
    getFormLeadSourceCompanyLabel("best_relocation_leads", "long_distance"),
    "Best Relocation Forms",
  );
  assert.equal(
    getFormLeadSourceCompanyLabel("best_relocation_leads", "local"),
    "Best Relocation Locals",
  );
  assert.equal(getCallLeadSourceCompanyLabel("best_relocation_leads"), "Best Relocation Inbounds");
  assert.equal(getFormLeadSourceCompanyLabel("get_movers_leads"), "GetMovers Forms");
  assert.equal(getCallLeadSourceCompanyLabel("get_movers_leads"), "GetMovers Inbounds");
  assert.equal(getFormLeadSourceCompanyLabel("main_site"), "Main Site Forms");
  assert.equal(getCallLeadSourceCompanyLabel("main_site"), "Main Site Inbounds");
  assert.equal(getFormLeadSourceCompanyLabel("paid_overflow"), "Paid Overflow");
  assert.equal(getCallLeadSourceCompanyLabel("paid_overflow"), "Paid Overflow");
});
