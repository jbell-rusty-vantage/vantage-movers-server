import assert from "node:assert/strict";
import { test } from "node:test";
import { luhnValid, redactSensitiveText } from "./redaction";

test("redactSensitiveText redacts a Luhn-valid card spoken as digit groups plus CVV, expiry, SSN, and routing", () => {
  const raw = [
    "Card 4111-1111-1111-1111",
    "expiry 07/2029",
    "CVV 123",
    "SSN 123-45-6789",
    "routing 021000021",
    "email pat@example.com and also chris at iCloud.com",
  ].join(" ");

  const result = redactSensitiveText(raw);
  assert.equal(result.text.includes("4111"), false);
  assert.equal(result.text.includes("[REDACTED:CARD]"), true);
  assert.equal(result.text.includes("[REDACTED:CVV]"), true);
  assert.equal(result.text.includes("[REDACTED:EXPIRY]"), true);
  assert.equal(result.text.includes("[REDACTED:SSN]"), true);
  assert.equal(result.text.includes("[REDACTED:ROUTING]"), true);
  assert.equal(result.text.includes("[REDACTED:EMAIL]"), true);
  assert.equal(result.text.includes("icloud.com"), false);
  assert.equal(result.redactions, 7);
  assert.equal(luhnValid("4111111111111111"), true);
});
