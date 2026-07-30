import assert from "node:assert/strict";
import { test } from "node:test";
import { sanitizeRegistrySnapshot } from "./snapshotSanitizer";

test("sanitizeRegistrySnapshot redacts secret-like keys", () => {
  const out = sanitizeRegistrySnapshot({
    name: "Main Site",
    api_secret: "super-secret",
    nested: {
      signing_token: "abc123",
      cpl: 195,
    },
  });

  assert.equal(out?.name, "Main Site");
  assert.equal(out?.api_secret, "[redacted]");
  assert.deepEqual(out?.nested, {
    signing_token: "[redacted]",
    cpl: 195,
  });
});

test("sanitizeRegistrySnapshot bounds oversized nested payloads", () => {
  const out = sanitizeRegistrySnapshot({
    aliases: Array.from({ length: 50 }, (_, index) => `alias_${index}`),
  });

  assert.equal(out?.aliases, "[array:50]");
});

test("sanitizeRegistrySnapshot returns null for empty snapshots", () => {
  assert.equal(sanitizeRegistrySnapshot(null), null);
  assert.equal(sanitizeRegistrySnapshot(undefined), null);
});
