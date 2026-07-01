import assert from "node:assert/strict";
import { test } from "node:test";
import { hasBbbRedaction } from "./testimonial.helpers";

test("hasBbbRedaction detects BBB PII redaction tokens", () => {
  assert.equal(hasBbbRedaction("10 stars for REMOVED and his crew"), true);
  assert.equal(hasBbbRedaction("Thank you REMOVED"), true);
  assert.equal(hasBbbRedaction("REMOVE and crew did fine job"), true);
  assert.equal(
    hasBbbRedaction("The movers were excellent and they arrived on time."),
    false,
  );
});
