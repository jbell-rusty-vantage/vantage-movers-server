import assert from "node:assert/strict";
import test from "node:test";
import {
  escapeSheetTitleForRange,
  extractRowNumberFromRange,
} from "./ranges";

test("escapeSheetTitleForRange wraps plain titles in single quotes", () => {
  assert.equal(escapeSheetTitleForRange("Forms"), "'Forms'");
});

test("escapeSheetTitleForRange doubles single quotes inside a sheet title", () => {
  assert.equal(escapeSheetTitleForRange("O'Brien"), "'O''Brien'");
  assert.equal(escapeSheetTitleForRange("Booked 'Deals'"), "'Booked ''Deals'''");
});

test("escapeSheetTitleForRange preserves whitespace and non-quote punctuation", () => {
  assert.equal(escapeSheetTitleForRange("Bad Leads"), "'Bad Leads'");
  assert.equal(escapeSheetTitleForRange("Tab-1 (v2)"), "'Tab-1 (v2)'");
});

test("extractRowNumberFromRange parses single-cell updates", () => {
  assert.equal(extractRowNumberFromRange("'Forms'!A42"), 42);
});

test("extractRowNumberFromRange parses appended row ranges", () => {
  assert.equal(extractRowNumberFromRange("'Forms'!A42:V42"), 42);
  assert.equal(extractRowNumberFromRange("Sheet1!AA17:AZ17"), 17);
});

test("extractRowNumberFromRange returns undefined for missing or malformed input", () => {
  assert.equal(extractRowNumberFromRange(undefined), undefined);
  assert.equal(extractRowNumberFromRange(null), undefined);
  assert.equal(extractRowNumberFromRange(""), undefined);
  assert.equal(extractRowNumberFromRange("Forms!A:Z"), undefined);
  assert.equal(extractRowNumberFromRange("not-a-range"), undefined);
});
