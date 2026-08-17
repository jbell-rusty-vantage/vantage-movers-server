import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyPayload,
  sanitizeHeaders,
} from "./granotWebhookCapture.service";

test("[AC-35] compatibility sanitizeHeaders uses the exact five-header allowlist", () => {
  assert.deepEqual(
    sanitizeHeaders({
      "x-api-secret": "must-not-be-stored",
      authorization: "Bearer must-not-be-stored",
      cookie: "must-not-be-stored",
      "content-type": "application/json",
      "x-request-id": "synthetic-request",
      "x-granot-delivery-id": "delivery-123",
    }),
    {
      "content-type": "application/json",
      "x-request-id": "synthetic-request",
    },
  );
});

test("compatibility classifyPayload still classifies flexible JSON without defining shape", () => {
  assert.equal(classifyPayload({ unknown: true }), "object");
  assert.equal(classifyPayload([1, 2]), "array");
  assert.equal(classifyPayload(null), "null");
  assert.equal(classifyPayload("value"), "primitive");
});
