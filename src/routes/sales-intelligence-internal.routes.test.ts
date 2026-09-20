import assert from "node:assert/strict";
import { test } from "node:test";
import { ZodError } from "zod";
import { intelligenceToolArguments } from "../services/salesIntelligence/analysis/contracts";
import { CsiError } from "../services/salesIntelligence/auth";
import { repPromiseVsCustomerCallbackFixture } from "../validation/intelligence/fixtures";
import { intelligenceRouteFailure } from "./sales-intelligence-internal.routes";

test("submit INVALID_INPUT names finding_keys mismatch without echoing envelope text", () => {
  const parsed = intelligenceToolArguments.submit_intelligence_analysis.safeParse({
    idempotency_key: "synthetic",
    envelope: {
      ...repPromiseVsCustomerCallbackFixture,
      summary: {
        ...repPromiseVsCustomerCallbackFixture.summary,
        finding_keys: ["not_a_finding_in_this_envelope"],
      },
    },
  });
  assert.equal(parsed.success, false);
  assert.ok(parsed.error instanceof ZodError);
  const failure = intelligenceRouteFailure(parsed.error, "req-submit-400");
  assert.equal(failure.status, 400);
  assert.equal(failure.body.code, "INVALID_INPUT");
  assert.ok(
    failure.body.issues?.some((issue) => issue.path.includes("finding_keys")),
    JSON.stringify(failure.body.issues),
  );
  const serialized = JSON.stringify(failure.body);
  assert.equal(serialized.includes("I will call you Friday after 2."), false);
  assert.equal(serialized.includes("Can you call me Friday morning?"), false);
  assert.equal(failure.body.request_id, "req-submit-400");
});

test("non-schema CSI failures stay closed and do not invent issue paths", () => {
  const failure = intelligenceRouteFailure(new CsiError("EVIDENCE_SCOPE_INVALID"), "req-scope");
  assert.equal(failure.status, 400);
  assert.equal(failure.body.code, "EVIDENCE_SCOPE_INVALID");
  assert.equal(failure.body.issues, undefined);
});
