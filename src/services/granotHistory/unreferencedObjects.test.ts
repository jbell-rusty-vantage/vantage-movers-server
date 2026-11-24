import assert from "node:assert/strict";
import test from "node:test";
import { ObjectId } from "mongodb";
import { digest, encodeChains } from "./archiveCodec";
import { fakeGranotArchive } from "./archiveTestSupport";
import { applyEntry, classifyObject, decodeObject, type Coverage, type ManifestEntry } from "./unreferencedObjects";

const o = new ObjectId(), r = new ObjectId();
const chain = { observation: { _id: o, receipt_id: r, captured_at: new Date("2026-11-10"), identity: { normalized_job_no: "P1" } },
  receipt: { _id: r, payload: { n: 1 } }, decisions: [{ _id: new ObjectId(), observation_id: o }] };
const bytes = encodeChains("P1", [chain]);
const now = new Date("2026-11-23T12:00:00Z");

test("an unreferenced object is confirmed only when every document has a byte-identical live copy", () => {
  const decoded = decodeObject(bytes, digest(bytes));
  assert.equal(decoded.kind, "job_chunk");
  if (decoded.kind !== "job_chunk") return;
  const full: Coverage = new Map([...decoded.docs].map(([k, d]) => [k, [{ digest: d, hash: "n".repeat(64) }]]));
  const missing: Coverage = new Map([...full].slice(1));
  const differs: Coverage = new Map([...full].map(([k, v], i) => [k, i ? v : [{ digest: "x", hash: "n".repeat(64) }]]));
  const clean = { holds: {}, independentHold: false, retentionLocked: false, updated: "2026-11-15T00:00:00Z" };
  const cases: [string, Parameters<typeof classifyObject>, string][] = [
    ["covered", [clean, decoded, full, now], "confirmed_superseded"],
    ["one document has no other copy", [clean, decoded, missing, now], "held:chain_not_archived_elsewhere"],
    ["the newer copy differs", [clean, decoded, differs, now], "held:newer_copy_differs"],
    ["written in the last day", [{ ...clean, updated: "2026-11-23T06:00:00Z" }, decoded, full, now], "held:recent"],
    ["a hold is present", [{ ...clean, holds: { publisher: "1" } }, decoded, full, now], "held:hold_present"],
    ["already on its clock", [{ ...clean, recoveryClockStartedAt: "2026-11-20T00:00:00Z" }, decoded, full, now], "held:already_on_clock"],
    ["not a job chunk", [clean, { kind: "other", format: "granot-lead-evidence-v1" }, full, now], "held:not_job_chunk:granot-lead-evidence-v1"],
    ["unreadable", [clean, { kind: "unreadable" }, full, now], "held:unreadable"],
  ];
  for (const [name, input, expected] of cases) assert.equal(classifyObject(...input).class, expected, name);
  assert.deepEqual(classifyObject(clean, decoded, full, now).covering, ["n".repeat(64)]);
});

test("apply re-verifies generation and references, drains the review, and protects a refused object", async () => {
  let clock = new Date("2026-11-23T00:00:00Z");
  const { store, storage } = fakeGranotArchive(() => clock);
  const stored = await storage.store("testvantagemovers", bytes);
  const entry: ManifestEntry = { hash: stored.hash, generation: stored.generation, size: bytes.length, class: "confirmed_superseded", covering: ["c".repeat(64)] };
  const name = `history/granot/v1/testvantagemovers/${stored.hash.slice(0, 2)}/${stored.hash}.bson.gz`;
  let referenced = false, covered = true;
  const guards = { referenced: async () => referenced, covered: async () => covered };
  const step = (e = entry) => applyEntry(store, "testvantagemovers", e, guards, clock);

  assert.equal(await step({ ...entry, generation: "1" }), "generation_changed");
  covered = false;
  assert.equal(await step(), "covering_gone");
  covered = true;
  assert.equal(await step(), "review_started");
  assert.equal(await step(), "draining");
  clock = new Date(+clock + 861_000);
  referenced = true; // a locator appeared during the drain: the review is abandoned and the publisher hold restored
  assert.equal(await step(), "now_referenced");
  assert.deepEqual((await store.stat(name))!.holds, { publisher: "1" });
  assert.equal((await store.stat(name))!.recoveryClockStartedAt, undefined);

  referenced = false;
  assert.equal(await step(), "review_started");
  clock = new Date(+clock + 861_000);
  assert.equal(await step(), "released");
  assert.ok((await store.stat(name))!.recoveryClockStartedAt);
  assert.equal(await step(), "already_released");
});
