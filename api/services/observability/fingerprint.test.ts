import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDedupeKey, computeFingerprint } from "./fingerprint";

const base = {
  environment: "production",
  eventKey: "sheet_sync.drain.failed",
  workflow: "sheet_sync_drain",
};

test("fingerprint is deterministic for the same inputs", () => {
  assert.equal(computeFingerprint(base), computeFingerprint(base));
});

test("fingerprint differs by event key and environment", () => {
  assert.notEqual(
    computeFingerprint(base),
    computeFingerprint({ ...base, eventKey: "sheet_sync.drain.partial_failure" }),
  );
  assert.notEqual(
    computeFingerprint(base),
    computeFingerprint({ ...base, environment: "preview" }),
  );
});

test("explicit dedupeKey takes precedence over composed fields", () => {
  const a = computeFingerprint({ ...base, dedupeKey: "custom-key", entityId: "1" });
  const b = computeFingerprint({ ...base, dedupeKey: "custom-key", entityId: "2" });
  assert.equal(a, b);
});

test("normalized error messages group transient differences", () => {
  const a = computeFingerprint({
    ...base,
    errorMessage: "Timeout after 1234 ms calling abcdef0123456789",
  });
  const b = computeFingerprint({
    ...base,
    errorMessage: "Timeout after 9999 ms calling fedcba9876543210",
  });
  assert.equal(a, b);
});

test("dedupe key is human-readable and stable", () => {
  assert.equal(
    buildDedupeKey({ ...base, entityType: "form_lead", entityId: "abc" }),
    "sheet_sync.drain.failed:production:form_lead:abc",
  );
  assert.equal(
    buildDedupeKey({ ...base, dedupeKey: "  explicit  " }),
    "explicit",
  );
});
