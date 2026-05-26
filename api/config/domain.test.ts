import assert from "node:assert/strict";
import test from "node:test";
import {
  CALL_SHEET_HEADERS,
  FORM_SHEET_HEADERS,
  SHEET_TAB_NAMES,
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
