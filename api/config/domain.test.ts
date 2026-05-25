import assert from "node:assert/strict";
import test from "node:test";
import { CALL_SHEET_HEADERS, FORM_SHEET_HEADERS } from "./domain";

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
