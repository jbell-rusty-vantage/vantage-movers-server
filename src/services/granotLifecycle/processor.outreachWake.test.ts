import assert from "node:assert/strict";
import { test } from "node:test";
import { boundedOutreachWake, createGranotObservationProcessor, OUTREACH_WAKE_TIMEOUT_MS, wakeOutreachAfterGranotApply, type OutreachWakeDependencies } from "./processor";
import { publishOutreachWakeup, salesIntelligenceQueueTopic } from "../numberActivity/webhookFanout";
import { outreachChangeNomination } from "../salesIntelligence/outreach/worker";

/** AC6-WAKE (Attention and Case File spec §8.2): post-commit Outreach wake-up after a Granot Lead change. */
const LEAD = "650000000000000000000101", OBSERVATION = "650000000000000000000102", CHANGE = "650000000000000000000103";
const change = { _id: CHANGE, entity: { model: "FormLead", id: LEAD }, revision_after: 7 };

function recorder(overrides: Partial<OutreachWakeDependencies> = {}) {
  const enqueued: unknown[] = [], published: string[] = [];
  const deps: OutreachWakeDependencies = {
    enabled: () => true,
    findLeadChanges: async () => [change],
    enqueue: async nomination => { enqueued.push(nomination); return { _id: "job-1", status: "pending" }; },
    publish: async id => { published.push(id); },
    ...overrides,
  };
  return { deps, enqueued, published };
}

test("K32 unit: a committed Lead change enqueues the scan's own nomination (same dedupe key) and wakes it", async () => {
  const { deps, enqueued, published } = recorder();
  const result = await wakeOutreachAfterGranotApply({ observation_id: OBSERVATION, target: { model: "FormLead", id: LEAD } }, deps);
  assert.deepEqual(enqueued, [outreachChangeNomination(change)]);
  assert.equal((enqueued[0] as { dedupe_key: string }).dedupe_key, `csi:outreach:entity-change:v2:${CHANGE}`);
  assert.equal((enqueued[0] as { subject_key: string }).subject_key, `outreach-lead:FormLead:${LEAD}`);
  assert.deepEqual(published, ["job-1"]);
  assert.deepEqual(result.job_ids, ["job-1"]);
});

test("no target, a non-Lead target, or the Outreach flag off: nothing is read or enqueued", async () => {
  for (const [target, enabled] of [[undefined, true], [{ model: "GranotRecordLink", id: LEAD }, true], [{ model: "CallLead", id: LEAD }, false]] as const) {
    let read = false;
    const { deps, enqueued, published } = recorder({ enabled: () => enabled, findLeadChanges: async () => { read = true; return [change]; } });
    await wakeOutreachAfterGranotApply({ observation_id: OBSERVATION, target: target as never }, deps);
    assert.equal(read, false);
    assert.deepEqual([enqueued.length, published.length], [0, 0]);
  }
});

test("a replay whose job already ran publishes nothing; a Lead with no committed change enqueues nothing", async () => {
  const done = recorder({ enqueue: async () => ({ _id: "job-1", status: "completed" }) });
  await wakeOutreachAfterGranotApply({ observation_id: OBSERVATION, target: { model: "FormLead", id: LEAD } }, done.deps);
  assert.deepEqual(done.published, []);
  const none = recorder({ findLeadChanges: async () => [] });
  await wakeOutreachAfterGranotApply({ observation_id: OBSERVATION, target: { model: "FormLead", id: LEAD } }, none.deps);
  assert.deepEqual([none.enqueued.length, none.published.length], [0, 0]);
});

test("failures are logged, never thrown (read, enqueue and publish)", async () => {
  for (const broken of [{ findLeadChanges: async () => { throw new Error("read"); } }, { enqueue: async () => { throw new Error("enqueue"); } },
    { publish: async () => { throw new Error("publish"); } }] as Partial<OutreachWakeDependencies>[]) {
    const { deps } = recorder(broken);
    await assert.doesNotReject(wakeOutreachAfterGranotApply({ observation_id: OBSERVATION, target: { model: "FormLead", id: LEAD } }, deps));
  }
});

test("the processor wraps the committed result and never lets the wake-up fail processing", async () => {
  const seen: unknown[] = [];
  const processor = createGranotObservationProcessor({
    flags: { processing_enabled: false } as never,
    wakeOutreach: async result => { seen.push(result); throw new Error("wake failed"); },
  });
  // Processing disabled throws before any commit: the wake-up is never reached.
  await assert.rejects(processor.process({ receipt_id: OBSERVATION }), /disabled/i);
  assert.deepEqual(seen, []);
});

test("K33: publishOutreachWakeup is a no-op in tests; with a queue it sends { job_id } to the SI topic; a send failure is swallowed", async () => {
  assert.deepEqual(await publishOutreachWakeup("job-1"), { published: false, error_code: null });
  const sent: Array<[string, unknown]> = [];
  assert.deepEqual(await publishOutreachWakeup("job-2", { shouldPublish: () => true, send: async (topic, payload) => { sent.push([topic, payload]); } }),
    { published: true, error_code: null });
  assert.deepEqual(sent, [[salesIntelligenceQueueTopic(), { job_id: "job-2" }]]);
  const events: unknown[] = [];
  assert.deepEqual(await publishOutreachWakeup("job-3", { shouldPublish: () => true, send: async () => { throw new Error("queue down"); },
    recordEvent: async event => { events.push(event); return undefined as never; } }), { published: false, error_code: "publish_failed" });
  assert.equal(events.length, 1);
});

test("V-AC N2: the wake-up holds processing for at most the bound; a slow or failing wake-up never delays or fails the receipt", async () => {
  const fast = await boundedOutreachWake(async () => undefined, OBSERVATION, 1_000);
  assert.equal(fast, "done");
  const started = Date.now();
  let finished = false;
  const slow = await boundedOutreachWake(() => new Promise(resolve => setTimeout(() => { finished = true; resolve(undefined); }, 300)), OBSERVATION, 50);
  assert.equal(slow, "timeout");
  assert.ok(Date.now() - started < 250, "returned at the bound, not when the wake-up finished");
  assert.equal(finished, false, "the wake-up keeps running in the background");
  await new Promise(resolve => setTimeout(resolve, 320));
  assert.equal(finished, true);
  assert.equal(await boundedOutreachWake(async () => { throw new Error("mongo down"); }, OBSERVATION, 1_000), "failed");
  assert.equal(await boundedOutreachWake(() => { throw new Error("sync throw"); }, OBSERVATION, 1_000), "failed");
  assert.equal(OUTREACH_WAKE_TIMEOUT_MS, 2_000);
});

