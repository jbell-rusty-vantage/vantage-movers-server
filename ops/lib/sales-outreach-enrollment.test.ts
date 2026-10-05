import assert from "node:assert/strict";
import { test } from "node:test";
import { parseEnrollmentArgs } from "./sales-outreach-enrollment";

test("enrollment CLI: report by default against a named target; apply/verify need a run key", () => {
  assert.deepEqual(parseEnrollmentArgs(["--target=testvantagemovers"]), {
    target: "testvantagemovers",
    mode: "report",
    selection: { mode: "backfill_scope" },
    kind: "expansion",
    cohort_id: null,
    run_key: null,
    out: null,
  });
  assert.deepEqual(parseEnrollmentArgs(["apply", "--target=vantagemovers", "--run-key=backfill-2026-10-05", "--leads=pilot.json", "--kind=pilot", "--cohort=pilot:1"]), {
    target: "vantagemovers",
    mode: "apply",
    selection: { mode: "selected", file: "pilot.json" },
    kind: "pilot",
    cohort_id: "pilot:1",
    run_key: "backfill-2026-10-05",
    out: null,
  });
});

test("enrollment CLI refuses an unnamed target, a missing run key and unknown arguments", () => {
  assert.throws(() => parseEnrollmentArgs([]), /--target/);
  assert.throws(() => parseEnrollmentArgs(["--target=prod db"]), /plain database name/);
  assert.throws(() => parseEnrollmentArgs(["apply", "--target=x"]), /--run-key/);
  assert.throws(() => parseEnrollmentArgs(["verify", "--target=x", "--run-key=bad key"]), /run-key/);
  assert.throws(() => parseEnrollmentArgs(["--target=x", "--everything"]), /Unknown argument/);
  assert.throws(() => parseEnrollmentArgs(["--target=x", "--kind=intake"]), /--kind/);
});
