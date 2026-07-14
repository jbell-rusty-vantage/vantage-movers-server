import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { sanitizeEventDetails } from "./operationalEventSanitizer";

afterEach(() => {
  delete process.env.OBSERVABILITY_DETAILS_MAX_BYTES;
});

test("returns empty object for nullish or non-object details", () => {
  assert.deepEqual(sanitizeEventDetails(undefined), {});
  assert.deepEqual(sanitizeEventDetails(null), {});
});

test("truncates long strings to 500 characters with ellipsis", () => {
  const long = "x".repeat(600);
  const out = sanitizeEventDetails({ note: long });
  assert.equal((out.note as string).length, 501);
  assert.ok((out.note as string).endsWith("…"));
});

test("collapses oversized arrays and deep objects", () => {
  const out = sanitizeEventDetails({
    items: Array.from({ length: 50 }, (_, i) => i),
    deep: { a: { b: { c: { d: { e: "too deep" } } } } },
  });
  assert.equal(out.items, "[array:50]");
  // Depth-bounded objects below the limit are replaced with a marker.
  assert.ok(JSON.stringify(out.deep).includes("[object]"));
});

test("normalizes dates and drops unsupported values", () => {
  const out = sanitizeEventDetails({
    when: new Date("2026-06-11T00:00:00.000Z"),
    fn: () => 1,
  });
  assert.equal(out.when, "2026-06-11T00:00:00.000Z");
  assert.equal(out.fn, "[unsupported]");
});

test("replaces details exceeding byte budget with a truncation marker", () => {
  process.env.OBSERVABILITY_DETAILS_MAX_BYTES = "16";
  const out = sanitizeEventDetails({
    a: "value-a",
    b: "value-b",
    c: "value-c",
    d: "value-d",
  });
  assert.equal(out._truncated, true);
  assert.ok(Array.isArray(out._keys));
});
