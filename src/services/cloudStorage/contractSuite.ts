import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, test } from "node:test";
import { isCloudStorageError, sha256Hex, type CloudStorageErrorCode, type ObjectStore } from "./contract";
import type { BucketDriver } from "./driver";
import { createObjectStore } from "./objectStore";

/** The hold policy the suite exercises: the Granot rule (publisher hold, cancellable release review). */
export const CONTRACT_HOLD_KEYS = { publisher: "contractPublisherHold", review: "contractReleaseReview" };

const rejectsWith = (promise: Promise<unknown>, code: CloudStorageErrorCode) =>
  assert.rejects(promise, (error) => isCloudStorageError(error, code) || assert.fail(`expected ${code}, got ${String(error)}`));
const unreferenced = { references: async () => false };

/**
 * Behaviour every `BucketDriver` must give `ObjectStore`. It runs against the in-memory fake on
 * every `pnpm test`, and against a real disposable bucket only when an operator opts in
 * (see gcsDriver.contract.test.ts). Every object lives under a fresh run prefix and is removed after.
 */
export function objectStoreContract(label: string, makeDriver: () => BucketDriver, options: { skip?: string | false } = {}) {
  describe(`ObjectStore contract: ${label}`, { skip: options.skip }, () => {
    const run = `contract/${randomUUID()}/`;
    let store: ObjectStore | undefined;
    const open = () => (store ??= createObjectStore(makeDriver(), {
      prefix: run, holdKeys: CONTRACT_HOLD_KEYS, reuse: { mode: "rehold", holder: "publisher", cancels: ["review"] },
    }));
    const bytes = (text: string) => Buffer.from(`${text}:${randomUUID()}`);
    const written = new Map<string, string>();
    const put = async (name: string, body: Buffer) => {
      const stored = await open().put({ name: run + name, bytes: body, contentType: "application/octet-stream" });
      written.set(stored.name, stored.sha256);
      return stored;
    };
    const ref = (o: { name: string; generation: string; sha256: string }) => ({ name: o.name, generation: o.generation, sha256: o.sha256 });

    after(async () => {
      if (!store) return;
      for (const [name, sha256] of written) {
        const current = await store.stat(name);
        if (!current) continue;
        for (const holder of Object.keys(current.holds)) await store.release(current, holder);
        await store.deleteIfGeneration({ name, generation: current.generation, sha256 }, unreferenced);
      }
    });

    test("put returns generation and SHA-256, and a verified read returns the same bytes", async () => {
      const body = bytes("first");
      const stored = await put("put/first.bin", body);
      assert.match(stored.generation, /^\d+$/);
      assert.equal(stored.sha256, sha256Hex(body));
      assert.equal(stored.created, true);
      assert.ok(stored.persisted.equals(body));
      assert.ok((await open().readVerified({ ...ref(stored), size: body.length })).equals(body));
    });

    test("put of identical bytes is idempotent and keeps the generation", async () => {
      const body = bytes("same");
      const first = await put("put/same.bin", body);
      const second = await put("put/same.bin", Buffer.from(body));
      assert.equal(second.generation, first.generation);
      assert.equal(second.created, false);
    });

    test("put of different bytes under an existing name fails read-back and leaves the original", async () => {
      const original = await put("put/conflict.bin", bytes("original"));
      await rejectsWith(put("put/conflict.bin", bytes("different")), "verification_failed");
      assert.equal((await open().stat(original.name))?.generation, original.generation);
    });

    test("a read that does not match the recorded SHA-256 or generation fails", async () => {
      const stored = await put("read/check.bin", bytes("check"));
      await rejectsWith(open().readVerified({ ...ref(stored), sha256: sha256Hex(Buffer.from("other")) }), "verification_failed");
      await rejectsWith(open().readVerified({ ...ref(stored), size: stored.size + 1 }), "verification_failed");
      await rejectsWith(open().readVerified({ ...ref(stored), generation: String(BigInt(stored.generation) + 1n) }), "not_found");
    });

    test("deleteIfGeneration refuses a generation mismatch and keeps the object", async () => {
      const stored = await put("delete/mismatch.bin", bytes("mismatch"));
      await rejectsWith(open().deleteIfGeneration({ ...ref(stored), generation: String(BigInt(stored.generation) + 1n) }, unreferenced), "generation_mismatch");
      assert.ok(await open().readVerified(ref(stored)));
    });

    test("deleteIfGeneration refuses while a locator still references the object", async () => {
      const stored = await put("delete/referenced.bin", bytes("referenced"));
      await rejectsWith(open().deleteIfGeneration(ref(stored), { references: async () => true }), "referenced");
      assert.ok(await open().stat(stored.name));
    });

    test("a held object refuses delete and expiry; after release it deletes", async () => {
      const stored = await put("hold/held.bin", bytes("held"));
      const held = await open().hold(stored, { holder: "publisher" });
      assert.deepEqual(held.holds, { publisher: "1" });
      await rejectsWith(open().deleteIfGeneration(ref(stored), unreferenced), "held");
      await rejectsWith(open().startRecoveryClock(ref(stored), unreferenced), "held");
      const released = await open().release(stored, "publisher");
      assert.deepEqual(released.holds, {});
      await open().deleteIfGeneration(ref(stored), unreferenced);
      assert.equal(await open().stat(stored.name), null);
    });

    test("one holder cannot take a second token; a review replaces the publisher hold", async () => {
      const stored = await put("hold/review.bin", bytes("review"));
      await open().hold(stored, { holder: "review", token: "r1" });
      await rejectsWith(open().hold(stored, { holder: "review", token: "r2" }), "held");
      await open().release(stored, "review", "r1");
      await open().hold(stored, { holder: "publisher" });
      const review = await open().hold(stored, { holder: "review", token: "r3", replaces: ["publisher"], metadata: { contractEvidence: "e" } });
      assert.deepEqual(review.holds, { review: "r3" });
      assert.equal(review.metadata.contractEvidence, "e");
    });

    test("the recovery clock needs the review hold, then re-putting the bytes re-holds the generation", async () => {
      const body = bytes("clock");
      const stored = await put("clock/released.bin", body);
      await rejectsWith(open().startRecoveryClock(ref(stored), { ...unreferenced, requireHold: { holder: "review", token: "c1" } }), "hold_not_drained");
      await open().hold(stored, { holder: "review", token: "c1" });
      await rejectsWith(open().startRecoveryClock(ref(stored), { references: async () => true, requireHold: { holder: "review", token: "c1" } }), "referenced");
      const clock = await open().startRecoveryClock(ref(stored), { ...unreferenced, requireHold: { holder: "review", token: "c1", heldForMs: 0 } });
      assert.ok(clock.recoveryClockStartedAt);
      assert.deepEqual(clock.holds, {});
      assert.equal((await open().startRecoveryClock(ref(stored), unreferenced)).recoveryClockStartedAt, clock.recoveryClockStartedAt);
      const reused = await put("clock/released.bin", body);
      assert.equal(reused.generation, stored.generation);
      assert.deepEqual((await open().stat(stored.name))?.holds, { publisher: "1" });
    });

    test("list returns only names under the requested prefix, page by page", async () => {
      await put("list/a/1.bin", bytes("a1"));
      await put("list/a/2.bin", bytes("a2"));
      await put("list/b/1.bin", bytes("b1"));
      const first = await open().list({ prefix: run + "list/a/", maxResults: 1 });
      assert.equal(first.items.length, 1);
      assert.ok(first.nextPageToken);
      const second = await open().list({ prefix: run + "list/a/", maxResults: 1, pageToken: first.nextPageToken });
      assert.deepEqual([...first.items, ...second.items].map((item) => item.name).sort(), [run + "list/a/1.bin", run + "list/a/2.bin"]);
      await rejectsWith(open().list({ prefix: "elsewhere/" }), "invalid_name");
    });

    test("names outside the store prefix are refused before any request", async () => {
      await rejectsWith(open().put({ name: "elsewhere/x.bin", bytes: Buffer.from("x"), contentType: "text/plain" }), "invalid_name");
      await rejectsWith(open().readVerified({ name: run + "../x.bin", sha256: sha256Hex(Buffer.from("x")) }), "invalid_name");
    });
  });
}
