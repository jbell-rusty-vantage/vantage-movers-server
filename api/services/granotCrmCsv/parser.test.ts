import assert from "node:assert/strict";
import test from "node:test";
import { parseGranotCsv } from "./parser";

test("parseGranotCsv normalizes headers and skips total rows", () => {
  const parsed = parseGranotCsv([
    "job no,Ref No,Customer,Phone,Email,Prior,Est CF",
    "P123,507f1f77bcf86cd799439011,Jane Customer,555-111-2222,jane@example.com,1,1200",
    ",,,,,,",
    ",,,,,,1200",
  ].join("\n"));

  assert.deepEqual(parsed.headers, [
    "job_no",
    "ref_no",
    "customer",
    "phone",
    "email",
    "prior",
    "est_cf",
  ]);
  assert.equal(parsed.counts.total, 2);
  assert.equal(parsed.counts.dataRows, 1);
  assert.equal(parsed.rows[0].rowKey, "job:P123");
  assert.equal(parsed.rows[0].customer, "Jane Customer");
});
