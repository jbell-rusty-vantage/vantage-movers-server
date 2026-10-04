import assert from "node:assert/strict";
import { test } from "node:test";
import { overviewQuerySchema } from "../../validation/v1/analytics.validation";
import { rollingLast7DaysWindow } from "./overview.service";

test("overviewQuerySchema accepts production only", () => {
  assert.equal(overviewQuerySchema.parse({ database_scope: "production" }).database_scope, "production");
  assert.equal(overviewQuerySchema.parse({}).database_scope, undefined);
  assert.throws(() => overviewQuerySchema.parse({ database_scope: "historical" }));
  assert.throws(() => overviewQuerySchema.parse({ database_scope: "combined" }));
});

test("rollingLast7DaysWindow spans seven days ending now", () => {
  const before = Date.now();
  const { from, to } = rollingLast7DaysWindow();
  const after = Date.now();

  assert.ok(to.getTime() >= before && to.getTime() <= after);
  assert.equal(from.getHours(), 0);
  assert.equal(from.getMinutes(), 0);
  assert.equal(from.getSeconds(), 0);
  assert.ok(to.getTime() - from.getTime() >= 6 * 24 * 60 * 60 * 1000);
  assert.ok(to.getTime() - from.getTime() <= 8 * 24 * 60 * 60 * 1000);
});
