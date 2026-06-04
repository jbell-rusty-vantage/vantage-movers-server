import assert from "node:assert/strict";
import test from "node:test";
import {
  CALL_SHEET_HEADERS,
  FORM_SHEET_HEADERS,
  SHEET_TAB_NAMES,
  getCallLeadSourceCompanyLabel,
  getFormLeadSourceCompanyLabel,
  getSourceCompanyLabel,
  resolveSourceCompany,
  resolveSourceCompanyFromLabel,
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
  assert.equal(SHEET_TAB_NAMES.duplicates, "Duplicates");
  assert.equal(CALL_SHEET_HEADERS.at(-1), "FormFill");
  assert.equal((FORM_SHEET_HEADERS as readonly string[]).includes("Duplicate"), false);
});

test("source label mapping accepts Granot compact BestRelocation labels", () => {
  assert.equal(resolveSourceCompanyFromLabel("BestRelocation Forms"), "best_relocation_leads");
  assert.equal(resolveSourceCompanyFromLabel("BestRelocation Locals"), "best_relocation_leads");
  assert.equal(resolveSourceCompanyFromLabel("BestRelocation Inbounds"), "best_relocation_leads");
});

test("top10_leads sheet label is Top 10 Forms while legacy labels still resolve", () => {
  assert.equal(getSourceCompanyLabel("tbm_leads"), "TBM Leads");
  assert.equal(getSourceCompanyLabel("top10_leads"), "Top 10 Forms");
  assert.equal(resolveSourceCompany("TBM Leads"), "tbm_leads");
  assert.equal(resolveSourceCompany("Top 10 Leads"), "top10_leads");
});

test("10best inbound labels resolve to their own source company", () => {
  assert.equal(resolveSourceCompany("10best Inbounds"), "10best_leads");
  assert.equal(resolveSourceCompanyFromLabel("10best Inbounds"), "10best_leads");
  assert.equal(resolveSourceCompany("Top10 Inbounds"), "top10_leads");
});

test("lead sheet source company labels are precise by lead type", () => {
  assert.equal(getFormLeadSourceCompanyLabel("tbm_leads"), "TBM Forms");
  assert.equal(getCallLeadSourceCompanyLabel("tbm_leads"), "TBM Inbounds");
  assert.equal(getFormLeadSourceCompanyLabel("tbm_prime_leads"), "TBM Prime Forms");
  assert.equal(getCallLeadSourceCompanyLabel("tbm_prime_leads"), "TBM Prime Inbounds");
  assert.equal(getFormLeadSourceCompanyLabel("top10_leads"), "Top10 Forms");
  assert.equal(getCallLeadSourceCompanyLabel("top10_leads"), "Top10 Inbounds");
  assert.equal(getCallLeadSourceCompanyLabel("10best_leads"), "10best Inbounds");
  assert.equal(getFormLeadSourceCompanyLabel("best_relocation_leads"), "Best Relocation Forms");
  assert.equal(getCallLeadSourceCompanyLabel("best_relocation_leads"), "Best Relocation Inbounds");
  assert.equal(getFormLeadSourceCompanyLabel("main_site"), "Main Site Forms");
  assert.equal(getCallLeadSourceCompanyLabel("main_site"), "Main Site Inbounds");
});
