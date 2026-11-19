import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizePhoneNumberForMatch,
  normalizePhoneNumberForStorage,
} from "./phone";

test("normalizePhoneNumberForStorage preserves explicit foreign numbers", () => {
  assert.equal(normalizePhoneNumberForStorage("+44 20 7123 4567"), "+442071234567");
  assert.equal(normalizePhoneNumberForStorage("+49 30 12345678"), "+493012345678");
  assert.equal(normalizePhoneNumberForStorage("+353 1 234 5678"), "+35312345678");
});

test("normalizePhoneNumberForMatch uses full foreign number digits", () => {
  assert.equal(normalizePhoneNumberForMatch("+44 20 7123 4567"), "442071234567");
  assert.equal(normalizePhoneNumberForMatch("44 20 7123 4567"), "442071234567");
  assert.equal(normalizePhoneNumberForMatch("+353 1 234 5678"), "35312345678");
  assert.equal(normalizePhoneNumberForMatch("+376 123 456"), "376123456");
});
