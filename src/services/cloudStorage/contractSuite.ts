import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, test } from "node:test";
import { isCloudStorageError, sha256Hex, type CloudStorageErrorCode, type ObjectStore } from "./contract";
import type { BucketDriver } from "./driver";
import { createObjectStore } from "./objectStore";

/** The Granot hold policy (publisher hold, cancellable release review), with a zero drain window for a real bucket. */
export const CONTRACT_HOLD_KEYS = { publisher: "contractPublisherHold", review: "contractReleaseReview" };

export const rejectsWith = (promise: Promise<unknown>, code: CloudStorageErrorCode) =>
  assert.rejects(promise, (error) => isCloudStorageError(error, code) || assert.fail(`expected ${code}, got ${String(error)}`));
const unreferenced = { references: async () => false };

/**
 * Behaviour every `BucketDriver` must give `ObjectStore`: verification, holds, conditional
 * delete, the recovery clock and prefix confinement. It runs on the fake bucket and on the GCS
 * driver over an emulated API on every `pnpm test`, and on a real disposable bucket only on
 * opt-in (gcsDriver.contract.test.ts). Objects live under a fresh run prefix and are removed after.
 */
export function objectStoreContract(label: string, makeDriver: () => BucketDriver, options: { skip?: string | false } = {}) {
  describe(`ObjectStore contract: ${label}`, { skip: options.skip }, () => {
    const run = `contract/${randomUUID()}/`;
    let store: ObjectStore | undefined;
    const open = () => (store ??= createObjectStore(makeDriver(), {
      prefix: run, holdKeys: CONTRACT_HOLD_KEYS,
      reuse: { mode: "rehold", holder: "publisher", cancels: ["review"] },
      review: { holder: "review", drainMs: 0 },
    }));
    const written = new Map<string, string>();
    const bytes = (text: string) => Buffer.from(`${text}:${randomUUID()}`);
    const put = async (name: string, body: Buffer) => {
      const stored = await open().put({ name: run + name, bytes: body, contentType: "application/octet-stream" });
      written.set(stored.name, stored.sha256);
      return stored;
    };

    after(async () => {
      if (!store) return;
      for (const [name, sha256] of written) {
        const current = await store.stat(name);
        if (!current) continue;
        for (const holder of Object.keys(current.holds)) await store.release(current, holder);
        await store.hold(current, { holder: "review", token: "cleanup" });
        await store.deleteIfGeneration({ name, generation: current.generation, sha256 }, { ...unreferenced, reviewToken: "cleanup" });
      }
    });

    test("put and readVerified hold every read to the recorded generation and SHA-256", async () => {
      const body = bytes("verify");
      const stored = await put("verify.bin", body);
      assert.match(stored.generation, /^\d+$/);
      assert.equal(stored.sha256, sha256Hex(body));
      assert.ok(stored.created && stored.persisted.equals(body));
      const again = await put("verify.bin", Buffer.from(body));
      assert.deepEqual([again.generation, again.created], [stored.generation, false], "identical re-put is idempotent");
      await rejectsWith(put("verify.bin", bytes("different")), "verification_failed");
      const ref = { name: stored.name, generation: stored.generation, sha256: stored.sha256 };
      assert.ok((await open().readVerified({ ...ref, size: body.length })).equals(body));
      assert.ok((await open().readVerified({ name: ref.name, sha256: ref.sha256 })).equals(body), "legacy locator without generation");
      for (const [bad, code] of [
        [{ sha256: sha256Hex(Buffer.from("other")) }, "verification_failed"],
        [{ size: body.length + 1 }, "verification_failed"],
        [{ generation: String(BigInt(ref.generation) + 1n) }, "not_found"],
      ] as const) await rejectsWith(open().readVerified({ ...ref, ...bad }), code);
    });

    test("holds block expiry and delete until released; one holder has one token", async () => {
      const stored = await put("hold.bin", bytes("hold"));
      assert.deepEqual((await open().hold(stored, { holder: "publisher" })).holds, { publisher: "1" });
      await open().hold(stored, { holder: "review", token: "r1" });
      await rejectsWith(open().hold(stored, { holder: "review", token: "r2" }), "held");
      await rejectsWith(open().hold(stored, { holder: "review", token: "r1", metadata: { contractPublisherHold: "" } }), "invalid_configuration");
      await rejectsWith(open().startRecoveryClock(stored, { ...unreferenced, reviewToken: "r1" }), "held");
      await rejectsWith(open().deleteIfGeneration(stored, { ...unreferenced, reviewToken: "r1" }), "held");
      assert.deepEqual((await open().release(stored, "publisher")).holds, { review: "r1" });
      await open().deleteIfGeneration(stored, { ...unreferenced, reviewToken: "r1" });
      assert.equal(await open().stat(stored.name), null);
    });

    test("deleteIfGeneration refuses unless the live generation is reviewed and unreferenced", async () => {
      const stored = await put("delete.bin", bytes("delete"));
      const guard = { ...unreferenced, reviewToken: "d1" };
      await rejectsWith(open().deleteIfGeneration(stored, guard), "hold_not_drained");
      await open().hold(stored, { holder: "review", token: "d1" });
      for (const [ref, attempt, code] of [
        [{ ...stored, generation: String(BigInt(stored.generation) + 1n) }, guard, "generation_mismatch"],
        [stored, { ...guard, reviewToken: "other" }, "hold_not_drained"],
        [stored, { ...guard, references: async () => true }, "referenced"],
      ] as const) await rejectsWith(open().deleteIfGeneration(ref, attempt), code);
      assert.ok(await open().readVerified(stored), "every refusal leaves the object");
    });

    test("the recovery clock needs the review hold, and re-putting a released generation re-holds it", async () => {
      const body = bytes("clock");
      const stored = await put("clock.bin", body);
      await rejectsWith(open().startRecoveryClock(stored, unreferenced), "hold_not_drained");
      await open().hold(stored, { holder: "review", token: "c1", replaces: ["publisher"], metadata: { contractEvidence: "e" } });
      await rejectsWith(open().startRecoveryClock(stored, { references: async () => true, reviewToken: "c1" }), "referenced");
      const clock = await open().startRecoveryClock(stored, { ...unreferenced, reviewToken: "c1" });
      assert.ok(clock.recoveryClockStartedAt);
      assert.deepEqual(clock.holds, {});
      assert.equal(clock.metadata.contractEvidence, "e");
      const reused = await put("clock.bin", body);
      assert.equal(reused.generation, stored.generation);
      assert.deepEqual((await open().stat(stored.name))?.holds, { publisher: "1" });
    });

    test("the store is confined to its prefix", async () => {
      for (const name of ["list/a/1.bin", "list/a/2.bin", "list/b/1.bin"]) await put(name, bytes(name));
      const first = await open().list({ prefix: run + "list/a/", maxResults: 1 });
      const second = await open().list({ prefix: run + "list/a/", maxResults: 1, pageToken: first.nextPageToken });
      assert.deepEqual([...first.items, ...second.items].map((item) => item.name).sort(), [run + "list/a/1.bin", run + "list/a/2.bin"]);
      await rejectsWith(open().list({ prefix: "elsewhere/" }), "invalid_name");
      await rejectsWith(open().put({ name: "elsewhere/x.bin", bytes: Buffer.from("x"), contentType: "text/plain" }), "invalid_name");
      await rejectsWith(open().readVerified({ name: run + "../x.bin", sha256: sha256Hex(Buffer.from("x")) }), "invalid_name");
    });
  });
}
