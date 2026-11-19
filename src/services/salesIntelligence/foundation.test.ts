import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import { assertTrustedActor, assertCurrentScope } from "./auth";
const original = { ...process.env };
afterEach(() => {
  process.env = { ...original };
});
test("forged actors and non-production scopes are refused", () => {
  assert.throws(() =>
    assertTrustedActor({
      kind: "owner",
      id: "forged",
      request_id: "x",
      run_id: null,
    }),
  );
  assert.throws(() => assertCurrentScope("combined"));
  assert.throws(() => assertCurrentScope("production", "historical"));
});
