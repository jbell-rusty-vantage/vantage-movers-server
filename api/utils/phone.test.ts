import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizePhoneNumberForMatch,
  normalizePhoneNumberForStorage,
} from "./phone";

test("normalizePhoneNumberForStorage strips US formatting and leading country code", () => {
  assert.equal(normalizePhoneNumberForStorage("(561) 988-9998"), "5619889998");
  assert.equal(normalizePhoneNumberForStorage("15619889998"), "5619889998");
  assert.equal(normalizePhoneNumberForStorage("+1 561 988 9998"), "5619889998");
});

test("normalizePhoneNumberForStorage preserves unrecognized phone values", () => {
  assert.equal(normalizePhoneNumberForStorage("12345"), "12345");
  assert.equal(normalizePhoneNumberForStorage("phone unavailable"), "phone unavailable");
});

test("normalizePhoneNumberForMatch keeps existing last-ten-digits matching behavior", () => {
  assert.equal(normalizePhoneNumberForMatch("15619889998"), "5619889998");
});
