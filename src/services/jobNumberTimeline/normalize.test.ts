import assert from "node:assert/strict";
import { test } from "node:test";
import { jobsEquivalent, normalizeTypedJobNo } from "./normalize.js";

test("normalizeTypedJobNo trims and uppercases", () => {
  assert.equal(normalizeTypedJobNo(" p5562924 "), "P5562924");
  assert.equal(normalizeTypedJobNo("   "), undefined);
  assert.equal(normalizeTypedJobNo(null), undefined);
});

test("jobsEquivalent treats letter prefix as the same Job Number", () => {
  assert.equal(jobsEquivalent("P5562924", "5562924"), true);
  assert.equal(jobsEquivalent("5562924", "P5562924"), true);
  assert.equal(jobsEquivalent("9001001", "8002002"), false);
  assert.equal(jobsEquivalent("", "5562924"), false);
});
