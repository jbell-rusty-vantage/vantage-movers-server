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

test("sanitizeRegistrySnapshot truncates long strings and marks functions unsupported", () => {
  const out = sanitizeRegistrySnapshot({
    note: "x".repeat(600),
    fn: () => 1,
  });

  assert.equal((out?.note as string).length, 501);
  assert.ok((out?.note as string).endsWith("…"));
  assert.equal(out?.fn, "[unsupported]");
});

test("sanitizeRegistrySnapshot replaces a snapshot over the 16 KB budget with a truncation marker", () => {
  const snapshot: Record<string, unknown> = {};
  for (let index = 0; index < 45; index += 1) {
    snapshot[`field_${index}`] = "y".repeat(450);
  }

  const out = sanitizeRegistrySnapshot(snapshot);

  assert.equal(out?._truncated, true);
  assert.ok(Array.isArray(out?._keys));
  assert.equal((out?._keys as string[]).length, 20);
});
