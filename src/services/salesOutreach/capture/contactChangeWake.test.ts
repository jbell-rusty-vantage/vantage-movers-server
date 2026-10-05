import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import {
  contactChangeDedupeKey,
  enqueueOutreachContactChangeJobs,
  OUTREACH_CONTACT_CHANGE_CONSUMER_READY,
  OUTREACH_CONTACT_CHANGE_STAGE,
  sourcesFromTouchedCalls,
  wakeOutreachContactChange,
  type ContactChangeDeps,
} from "./contactChangeWake";

const NOW = new Date("2026-10-05T14:01:00.000Z");
const A = new mongoose.Types.ObjectId().toHexString();
const B = new mongoose.Types.ObjectId().toHexString();

test("wake sources: one per (row, revision); a merged-away row carries its winner so its credit can be revoked", () => {
  const sources = sourcesFromTouchedCalls([
    { interaction_id: A, projection_revision: 4, merged_into: null },
    { interaction_id: A, projection_revision: 4, merged_into: null },
    { interaction_id: B, projection_revision: null, merged_into: A },
  ]);
  assert.deepEqual(sources, [
    { source_kind: "call", source_id: A, source_revision: "r4" },
    { source_kind: "call", source_id: B, source_revision: `m${A}` },
  ]);
  assert.equal(contactChangeDedupeKey(sources[0]!), `sod:contact_change:call:${A}:r4`);
});

test("wake seam is inert until the SRV-6 consumer is registered: no configuration read, no job, no publish", async () => {
  assert.equal(OUTREACH_CONTACT_CHANGE_CONSUMER_READY, false, "phase A ships the seam only");
  const touched: string[] = [];
  const deps: ContactChangeDeps = {
    wanted: async () => {
      touched.push("wanted");
      return true;
    },
    enqueue: (async () => {
      touched.push("enqueue");
      throw new Error("must not enqueue");
    }) as never,
    transaction: async () => {
      touched.push("transaction");
      throw new Error("must not open a transaction");
    },
  };
  const outcome = await wakeOutreachContactChange([{ source_kind: "call", source_id: A, source_revision: "r1" }], deps);
  assert.deepEqual(outcome, { status: "skipped", reason: "consumer_pending" });
  assert.deepEqual(await enqueueOutreachContactChangeJobs([{ source_kind: "call", source_id: A, source_revision: "r1" }], {} as never, NOW, deps), []);
  assert.deepEqual(touched, []);
});

test("wake seam with a consumer: fails closed when the desk does not want contact evidence", async () => {
  const outcome = await wakeOutreachContactChange([{ source_kind: "call", source_id: A, source_revision: "r1" }], {
    consumerReady: true,
    wanted: async () => false,
    transaction: async () => assert.fail("no transaction when not wanted"),
  });
  assert.deepEqual(outcome, { status: "skipped", reason: "not_wanted" });
  assert.deepEqual(await wakeOutreachContactChange([], { consumerReady: true }), { status: "skipped", reason: "nothing_touched" });
});

test("wake seam with a consumer: one deduplicated outreach_contact_change job per source, only newly created ones are published", async () => {
  const enqueued: Array<{ dedupe_key: string; stage: string; subject_key: string; input_refs?: string[] }> = [];
  const existing = new Map<string, Date>([[`sod:contact_change:call:${B}:r2`, new Date(NOW.getTime() - 60_000)]]);
  const published: string[][] = [];
  const outcome = await wakeOutreachContactChange(
    [
      { source_kind: "call", source_id: A, source_revision: "r1" },
      { source_kind: "call", source_id: B, source_revision: "r2" },
    ],
    {
      consumerReady: true,
      wanted: async () => true,
      now: () => NOW,
      transaction: async (work) => work({} as never),
      enqueue: (async (input: { dedupe_key: string; stage: string; subject_key: string; input_refs?: string[] }, _session: unknown, now: Date) => {
        enqueued.push(input);
        return { _id: input.dedupe_key, createdAt: existing.get(input.dedupe_key) ?? now };
      }) as never,
      publish: async (ids) => {
        published.push([...ids]);
        return { published: ids.length };
      },
    },
  );
  assert.deepEqual(outcome, { status: "enqueued", jobs: 2, created: 1, published: 1 });
  assert.deepEqual(enqueued.map((j) => [j.stage, j.subject_key, j.input_refs]), [
    [OUTREACH_CONTACT_CHANGE_STAGE, `call:${A}`, [A]],
    [OUTREACH_CONTACT_CHANGE_STAGE, `call:${B}`, [B]],
  ]);
  assert.deepEqual(published, [[`sod:contact_change:call:${A}:r1`]]);
});

test("wake seam never throws into capture: a failing transaction is reported as failed", async () => {
  const outcome = await wakeOutreachContactChange([{ source_kind: "sms", source_id: A, source_revision: "r1" }], {
    consumerReady: true,
    wanted: async () => true,
    transaction: async () => {
      throw new TypeError("mongo down");
    },
  });
  assert.deepEqual(outcome, { status: "failed", error_name: "TypeError" });
});
