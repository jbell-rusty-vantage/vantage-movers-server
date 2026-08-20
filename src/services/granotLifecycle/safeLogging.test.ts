import assert from "node:assert/strict";
import test from "node:test";
import { safeLifecycleFailureLog } from "./safeLogging.js";

test("[AC-35] lifecycle failure logs contain bounded codes and masked identifiers only", () => {
  const canary = "unit31-canary@example.invalid";
  const output = safeLifecycleFailureLog({
    msg: "granot_lifecycle.queue.publish_failed",
    error: new Error(`provider echoed ${canary}`),
    receipt_id: "66c000000000000000000001",
    observation_channel: "granot_webhook",
  });
  assert.deepEqual(output, {
    msg: "granot_lifecycle.queue.publish_failed",
    error_code: "technical_failure",
    receipt_id: "66c0…0001",
    observation_channel: "granot_webhook",
  });
  assert.equal(JSON.stringify(output).includes(canary), false);
  assert.equal("err" in output, false);
});
