import assert from "node:assert/strict";
import { test } from "node:test";
import { equivalentObservationJobFilter } from "./load.js";

test("observation Job filter remaps equivalentNormalizedJobFilter onto identity.normalized_job_no", () => {
  const filter = equivalentObservationJobFilter("5562924");
  assert.ok("$or" in filter);
  const clauses = (filter as { $or: Array<Record<string, unknown>> }).$or;
  assert.equal(clauses.some((clause) => clause["identity.normalized_job_no"] === "5562924"), true);
  assert.equal(clauses.some((clause) => clause["identity.normalized_job_no"] === "5562924" || clause["identity.normalized_job_no"] === undefined), true);
  assert.equal(
    clauses.some((clause) => {
      const value = clause["identity.normalized_job_no"];
      return typeof value === "object" && value != null && "$regex" in value;
    }),
    true,
  );
});
