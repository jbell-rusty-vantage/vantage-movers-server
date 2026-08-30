import assert from "node:assert/strict";
import { test } from "node:test";
import { luhnValid, redactTranscript } from "./redaction";

test("redactTranscript redacts a Luhn-valid card spoken as digit groups plus CVV, expiry, SSN, and routing", () => {
  const raw = [
    "Card 4111-1111-1111-1111",
    "expiry 07/2029",
    "CVV 123",
    "SSN 123-45-6789",
    "routing 021000021",
    "email pat@example.com and also chris at iCloud.com",
  ].join(" ");

  const result = redactTranscript(raw);
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

test("redactTranscript does not redact a job number, spoken phone, or cubic-feet figure", () => {
  const raw =
    "Job P5562014. Best phone is the 402 number, 402-555-1212. About 300 cubic feet, quote 2114.";
  const result = redactTranscript(raw);
  assert.equal(result.redactions, 0);
  assert.equal(result.text.includes("P5562014"), true);
  assert.equal(result.text.includes("402-555-1212"), true);
  assert.equal(result.text.includes("300"), true);
  assert.equal(result.text.includes("2114"), true);
});

test("an unvalidated 16-digit sequence that fails Luhn is left alone", () => {
  const raw = "Reference 1234567890123456 is not a card.";
  assert.equal(luhnValid("1234567890123456"), false);
  const result = redactTranscript(raw);
  assert.equal(result.redactions, 0);
  assert.equal(result.text.includes("1234567890123456"), true);
});
