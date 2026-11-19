import assert from "node:assert/strict";
import { test } from "node:test";
import { boundedLeadLinkWake, LEAD_LINK_WAKE_TIMEOUT_MS } from "./processor";

/** Post-commit All Numbers lead-link wake-up after a Granot Lead change (`numberActivity/leadLinkJobs.ts`). */
const OBSERVATION = "650000000000000000000102";

test("the wake-up holds processing for at most the bound; a slow or failing wake-up never delays or fails the receipt", async () => {
  const fast = await boundedLeadLinkWake(async () => undefined, OBSERVATION, 1_000);
  assert.equal(fast, "done");
  const started = Date.now();
  let finished = false;
  const slow = await boundedLeadLinkWake(() => new Promise(resolve => setTimeout(() => { finished = true; resolve(undefined); }, 300)), OBSERVATION, 50);
  assert.equal(slow, "timeout");
  assert.ok(Date.now() - started < 250, "returned at the bound, not when the wake-up finished");
  assert.equal(finished, false, "the wake-up keeps running in the background");
  await new Promise(resolve => setTimeout(resolve, 320));
  assert.equal(finished, true);
  assert.equal(await boundedLeadLinkWake(async () => { throw new Error("mongo down"); }, OBSERVATION, 1_000), "failed");
  assert.equal(await boundedLeadLinkWake(() => { throw new Error("sync throw"); }, OBSERVATION, 1_000), "failed");
  assert.equal(LEAD_LINK_WAKE_TIMEOUT_MS, 2_000);
});
