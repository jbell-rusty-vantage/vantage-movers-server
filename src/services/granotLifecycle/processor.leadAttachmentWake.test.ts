import assert from "node:assert/strict";
import { test } from "node:test";
import { boundedLeadAttachmentWake, createGranotObservationProcessor, LEAD_ATTACHMENT_WAKE_TIMEOUT_MS } from "./processor";

/** Post-commit Lead attachment wake-up after a Granot Lead change (`attachment/leadTrigger.ts`). */
const OBSERVATION = "650000000000000000000102";

test("the processor wraps the committed result and never lets the wake-up fail processing", async () => {
  const seen: unknown[] = [];
  const processor = createGranotObservationProcessor({
    flags: { processing_enabled: false } as never,
    wakeLeadAttachments: async result => { seen.push(result); throw new Error("wake failed"); },
  });
  // Processing disabled throws before any commit: the wake-up is never reached.
  await assert.rejects(processor.process({ receipt_id: OBSERVATION }), /disabled/i);
  assert.deepEqual(seen, []);
});

test("the wake-up holds processing for at most the bound; a slow or failing wake-up never delays or fails the receipt", async () => {
  const fast = await boundedLeadAttachmentWake(async () => undefined, OBSERVATION, 1_000);
  assert.equal(fast, "done");
  const started = Date.now();
  let finished = false;
  const slow = await boundedLeadAttachmentWake(() => new Promise(resolve => setTimeout(() => { finished = true; resolve(undefined); }, 300)), OBSERVATION, 50);
  assert.equal(slow, "timeout");
  assert.ok(Date.now() - started < 250, "returned at the bound, not when the wake-up finished");
  assert.equal(finished, false, "the wake-up keeps running in the background");
  await new Promise(resolve => setTimeout(resolve, 320));
  assert.equal(finished, true);
  assert.equal(await boundedLeadAttachmentWake(async () => { throw new Error("mongo down"); }, OBSERVATION, 1_000), "failed");
  assert.equal(await boundedLeadAttachmentWake(() => { throw new Error("sync throw"); }, OBSERVATION, 1_000), "failed");
  assert.equal(LEAD_ATTACHMENT_WAKE_TIMEOUT_MS, 2_000);
});
