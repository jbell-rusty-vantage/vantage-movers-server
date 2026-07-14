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
  assert.equal(normalizePhoneNumberForStorage(""), "");
  assert.equal(normalizePhoneNumberForStorage("   "), "");
  assert.equal(normalizePhoneNumberForStorage("12345"), "12345");
  assert.equal(normalizePhoneNumberForStorage("phone unavailable"), "phone unavailable");
});

test("normalizePhoneNumberForStorage preserves explicit foreign numbers", () => {
  assert.equal(normalizePhoneNumberForStorage("+44 20 7123 4567"), "+442071234567");
  assert.equal(normalizePhoneNumberForStorage("+49 30 12345678"), "+493012345678");
  assert.equal(normalizePhoneNumberForStorage("+353 1 234 5678"), "+35312345678");
});

test("normalizePhoneNumberForMatch keeps existing last-ten-digits matching behavior", () => {
  assert.equal(normalizePhoneNumberForMatch("15619889998"), "5619889998");
  assert.equal(normalizePhoneNumberForMatch("(561) 988-9998"), "5619889998");
});

test("normalizePhoneNumberForMatch uses full foreign number digits", () => {
  assert.equal(normalizePhoneNumberForMatch("+44 20 7123 4567"), "442071234567");
  assert.equal(normalizePhoneNumberForMatch("44 20 7123 4567"), "442071234567");
  assert.equal(normalizePhoneNumberForMatch("+353 1 234 5678"), "35312345678");
  assert.equal(normalizePhoneNumberForMatch("+376 123 456"), "376123456");
});
