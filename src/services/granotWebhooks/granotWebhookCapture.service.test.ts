import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyPayload, sanitizeHeaders } from "./granotWebhookCapture.service";

test("sanitizes authentication headers before durable storage", () => {
  assert.deepEqual(
    sanitizeHeaders({
      "x-api-secret": "must-not-be-stored",
      authorization: "Bearer must-not-be-stored",
      cookie: "must-not-be-stored",
      "content-type": "application/json",
      "x-granot-delivery-id": "delivery-123",
    }),
    {
      "content-type": "application/json",
      "x-granot-delivery-id": "delivery-123",
    },
  );
});

test("classifies flexible JSON payloads without defining their shape", () => {
  assert.equal(classifyPayload({ unknown: true }), "object");
  assert.equal(classifyPayload([1, 2]), "array");
  assert.equal(classifyPayload(null), "null");
  assert.equal(classifyPayload("value"), "primitive");
});
