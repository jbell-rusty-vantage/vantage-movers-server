import assert from "node:assert/strict";
import { test } from "node:test";
import { leadMessageRetrySchema } from "./leadMessaging.validation";

test("manual retry requires explicit confirmation", () => {
  assert.deepEqual(leadMessageRetrySchema.parse({ confirm: true }), {
    confirm: true,
  });
  assert.throws(() => leadMessageRetrySchema.parse({}));
  assert.throws(() => leadMessageRetrySchema.parse({ confirm: false }));
});
