import assert from "node:assert/strict";
import { test } from "node:test";
import {
  equivalentNormalizedJobFilter,
  equivalentNormalizedJobSnapshotFilter,
  jobNumberDigitCore,
  jobNumbersEquivalent,
  normalizeJobNo,
} from "./bookingIdentity";

test("letter prefixes are equivalent to the same Granot digit core", () => {
  assert.equal(jobNumberDigitCore("P5562366"), "5562366");
  assert.equal(jobNumberDigitCore("RF5555313"), "5555313");
  assert.equal(jobNumberDigitCore("5562366"), "5562366");
  assert.equal(jobNumberDigitCore("SYNTHETIC JOB 100"), undefined);

  assert.equal(jobNumbersEquivalent("P5562366", "5562366"), true);
  assert.equal(jobNumbersEquivalent("5562366", "P5562366"), true);
  assert.equal(jobNumbersEquivalent("RF5555313", "5555313"), true);
  assert.equal(jobNumbersEquivalent("P5562366", "P5562366"), true);
  assert.equal(jobNumbersEquivalent("P5562366", "5562365"), false);
  assert.equal(jobNumbersEquivalent("SYNTHETIC JOB 100", "SYNTHETIC JOB 100"), true);
  assert.equal(jobNumbersEquivalent("SYNTHETIC JOB 100", "SYNTHETIC JOB 101"), false);
  assert.equal(jobNumbersEquivalent(normalizeJobNo("p5562366"), "5562366"), true);
});

test("equivalent job filter matches exact, core, and letter-prefixed variants", () => {
  assert.deepEqual(equivalentNormalizedJobFilter("SYNTHETIC JOB 100"), {
    normalized_job_no: "SYNTHETIC JOB 100",
  });
  const filter = equivalentNormalizedJobFilter("5562366");
  assert.ok("$or" in filter);
  assert.deepEqual(filter.$or?.[0], { normalized_job_no: "5562366" });
  assert.deepEqual(filter.$or?.[1], { normalized_job_no: "5562366" });
  assert.deepEqual(filter.$or?.[2], { normalized_job_no: { $regex: "^[A-Z]+5562366$" } });
});

test("equivalent snapshot filter remaps to the indexed cancellation snapshot field", () => {
  assert.deepEqual(equivalentNormalizedJobSnapshotFilter("SYNTHETIC JOB 100"), {
    normalized_job_no_snapshot: "SYNTHETIC JOB 100",
  });
  const filter = equivalentNormalizedJobSnapshotFilter("7702");
  assert.ok("$or" in filter);
  assert.deepEqual(filter.$or?.[0], { normalized_job_no_snapshot: "7702" });
  assert.deepEqual(filter.$or?.[2], { normalized_job_no_snapshot: { $regex: "^[A-Z]+7702$" } });
});
