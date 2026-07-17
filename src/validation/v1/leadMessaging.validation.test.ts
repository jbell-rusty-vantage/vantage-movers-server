import assert from "node:assert/strict";
import { test } from "node:test";
import {
  leadMessageRetrySchema,
  leadMessagesQuerySchema,
} from "./leadMessaging.validation";

test("lead message admin query applies bounded pagination", () => {
  assert.deepEqual(leadMessagesQuerySchema.parse({}), {
    page: 1,
    limit: 25,
  });
  assert.throws(() => leadMessagesQuerySchema.parse({ limit: "101" }));
  assert.throws(() =>
    leadMessagesQuerySchema.parse({ status: "invented" }),
  );
});

test("manual retry requires explicit confirmation", () => {
  assert.deepEqual(leadMessageRetrySchema.parse({ confirm: true }), {
    confirm: true,
  });
  assert.throws(() => leadMessageRetrySchema.parse({}));
  assert.throws(() => leadMessageRetrySchema.parse({ confirm: false }));
});
