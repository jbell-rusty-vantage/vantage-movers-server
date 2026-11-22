import assert from "node:assert/strict";
import { test } from "node:test";
import { isCloudStorageError, type CloudStorageErrorCode } from "./contract";
import { CONTRACT_HOLD_KEYS, objectStoreContract, rejectsWith } from "./contractSuite";
import { createFakeBucket, createFakeObjectStore } from "./fakeBucket";

objectStoreContract("in-memory fake bucket", () => createFakeBucket());

const prefix = "unit/";
const DRAIN = 800_000;
const name = prefix + "a.bin";
const body = Buffer.from("payload");
/** A Granot-shaped store with its real 800 s review drain and a controllable clock. */
function granotLike() {
  const clock = { at: Date.parse("2026-11-21T12:00:00.000Z") };
  const { store, bucket } = createFakeObjectStore({
    prefix, holdKeys: CONTRACT_HOLD_KEYS, now: () => new Date(clock.at),
    reuse: { mode: "rehold", holder: "publisher", cancels: ["review"] },
    review: { holder: "review", drainMs: DRAIN },
  });
  const put = (bytes = body) => store.put({ name, bytes, contentType: "application/octet-stream" });
  return { store, bucket, clock, put };
}

test("corrupted or altered stored bytes fail verification and are never deleted", async () => {
  const { store, bucket, clock, put } = granotLike();
  const stored = await put();
  await store.hold(stored, { holder: "review", token: "r" });
  clock.at += DRAIN;
  bucket.corrupt(name);
  await rejectsWith(store.readVerified(stored), "verification_failed");
  await rejectsWith(store.deleteIfGeneration(stored, { references: async () => false, reviewToken: "r" }), "verification_failed");
  await rejectsWith(store.startRecoveryClock(stored, { references: async () => false, reviewToken: "r" }), "verification_failed");
  assert.ok(bucket.peek(name), "the object stays for investigation");
  const download = bucket.download.bind(bucket);
  bucket.download = async (n, g) => Buffer.concat([await download(n, g), Buffer.from("!")]);
  await rejectsWith(store.put({ name: prefix + "b.bin", bytes: body, contentType: "x" }), "verification_failed");
});

test("the recovery clock and delete both wait out the namespace review drain", async () => {
  for (const operation of ["startRecoveryClock", "deleteIfGeneration"] as const) {
    const { store, clock, put } = granotLike();
    const stored = await put();
    await store.hold(stored, { holder: "review", token: "r" });
    const guard = { references: async () => false, reviewToken: "r" };
    clock.at += DRAIN - 1_000;
    await rejectsWith(store[operation](stored, guard), "hold_not_drained");
    clock.at += 1_000;
    await store[operation](stored, guard);
  }
});

/**
 * The review blocker: a writer whose re-put of identical bytes writes nothing, then records its
 * locator after `put` returns, must never be left pointing at a deleted object.
 */
test("a re-put racing a delete keeps the object for its new locator", async () => {
  const interleavings: Array<{ case: string; refusal: CloudStorageErrorCode; race: (env: ReturnType<typeof granotLike> & { writer: () => Promise<void> }) => Promise<void> }> = [
    {
      case: "writer's put returned before the review; locator written during the drain",
      refusal: "referenced",
      race: async ({ store, clock, writer }) => {
        await writer();
        await store.hold({ name, generation: (await store.stat(name))!.generation }, { holder: "review", token: "r" });
        clock.at += DRAIN;
      },
    },
    {
      case: "writer re-puts during the review",
      refusal: "hold_not_drained",
      race: async ({ store, clock, writer }) => {
        await store.hold({ name, generation: (await store.stat(name))!.generation }, { holder: "review", token: "r" });
        clock.at += DRAIN / 2;
        await writer();
        clock.at += DRAIN;
      },
    },
    {
      case: "writer re-puts between the delete's checks and its release patch",
      refusal: "generation_mismatch",
      race: async ({ store, bucket, clock, writer }) => {
        await store.hold({ name, generation: (await store.stat(name))!.generation }, { holder: "review", token: "r" });
        clock.at += DRAIN;
        const patch = bucket.patch.bind(bucket);
        bucket.patch = async (n, fence, changes) => { bucket.patch = patch; await writer(); return patch(n, fence, changes); };
      },
    },
    {
      case: "writer re-puts between the delete's release patch and its remove",
      refusal: "generation_mismatch",
      race: async ({ store, bucket, clock, writer }) => {
        await store.hold({ name, generation: (await store.stat(name))!.generation }, { holder: "review", token: "r" });
        clock.at += DRAIN;
        const remove = bucket.remove.bind(bucket);
        bucket.remove = async (n, fence) => { bucket.remove = remove; await writer(); return remove(n, fence); };
      },
    },
  ];
  for (const { case: label, refusal, race } of interleavings) {
    const env = granotLike();
    const first = await env.put();
    const locators = new Set<string>();
    const writer = async () => {
      const stored = await env.put();
      locators.add(stored.generation); // the locator is written only after put returns
    };
    await race({ ...env, writer });
    await assert.rejects(
      env.store.deleteIfGeneration(first, { references: async () => locators.size > 0, reviewToken: "r" }),
      (error) => isCloudStorageError(error, refusal) || assert.fail(`${label}: expected ${refusal}, got ${String(error)}`),
    );
    assert.ok((await env.store.readVerified(first)).equals(body), `${label}: the new locator still reads`);
  }
});

test("holds the store cannot attribute block holds, reuse, expiry and delete", async () => {
  for (const place of ["placeIndependentHold", "placeEventBasedHold"] as const) {
    const { store, bucket, clock, put } = granotLike();
    const stored = await put();
    await store.hold(stored, { holder: "review", token: "r" });
    clock.at += DRAIN;
    await store.startRecoveryClock(stored, { references: async () => false, reviewToken: "r" });
    bucket[place](name);
    const guard = { references: async () => false, reviewToken: "r" };
    if (place === "placeIndependentHold") {
      await rejectsWith(store.hold(stored, { holder: "publisher" }), "independent_hold");
      await rejectsWith(put(), "independent_hold");
    }
    await rejectsWith(store.deleteIfGeneration(stored, guard), place === "placeIndependentHold" ? "hold_not_drained" : "held");
    assert.ok(bucket.peek(name), place);
  }
});

test("reuse policies: Granot re-holds only matching bytes; packs refuse a released generation; only a sealed catalog starts on its clock", async () => {
  const granot = granotLike();
  const stored = await granot.put();
  const untouched = granot.bucket.peek(name)!.metageneration;
  await granot.put();
  assert.equal(granot.bucket.peek(name)!.metageneration, untouched, "an unreleased, unreviewed generation is reused without a write");
  await granot.store.hold(stored, { holder: "review", token: "r" });
  await rejectsWith(granot.put(Buffer.from("different")), "verification_failed");
  assert.deepEqual(granot.bucket.peek(name)!.metadata, { contractReleaseReview: "r" }, "different bytes never touch the holds");
  await granot.put();
  assert.deepEqual(granot.bucket.peek(name)!.metadata, { contractReleaseReview: "", contractPublisherHold: "1" }, "a reuse cancels the review");
  await granot.store.hold(stored, { holder: "review", token: "r2" });
  await granot.store.release(stored, "publisher");
  assert.equal(granot.bucket.peek(name)!.temporaryHold, true, "the provider hold stays while another named hold remains");
  await granot.store.release(stored, "review");
  assert.equal(granot.bucket.peek(name)!.temporaryHold, false, "the last named hold drops the provider hold");
  await rejectsWith(granot.store.put({ name: prefix + "c.bin", bytes: body, contentType: "x", customTime: new Date() }), "not_permitted");

  const { store: packs } = createFakeObjectStore({ prefix, reuse: { mode: "refuse_released" }, sealedNames: /\/catalog\.json$/ });
  const pack = await packs.put({ name: prefix + "p.bson.gz", bytes: body, contentType: "application/gzip" });
  await rejectsWith(packs.put({ name: pack.name, bytes: body, contentType: "application/gzip", customTime: new Date() }), "not_permitted");
  await packs.startRecoveryClock(pack, { references: async () => false });
  await rejectsWith(packs.put({ name: pack.name, bytes: body, contentType: "application/gzip" }), "released");
  await rejectsWith(packs.deleteIfGeneration({ ...pack, generation: pack.generation }, { references: async () => false, reviewToken: "r" }), "not_permitted");
  const catalog = { name: prefix + "catalog.json", bytes: Buffer.from("{}"), contentType: "application/json", customTime: new Date("2026-11-19T00:00:00Z") };
  const sealed = await packs.put(catalog);
  const retried = await packs.put(catalog);
  assert.deepEqual([retried.generation, retried.created], [sealed.generation, false], "a lost catalog response retries like production");
  const unsealed = { ...catalog, name: prefix + "other/catalog.json" };
  await packs.put({ ...unsealed, customTime: undefined });
  await rejectsWith(packs.put(unsealed), "generation_mismatch");
});

test("store options that would weaken a rule are refused at construction", () => {
  const reuse = { mode: "rehold" as const, holder: "publisher", cancels: ["review"] };
  const cases: Array<[string, Parameters<typeof createFakeObjectStore>[0]]> = [
    ["prefix without a trailing slash", { prefix: "unit", holdKeys: CONTRACT_HOLD_KEYS, reuse }],
    ["reuse holder without a key", { prefix, holdKeys: { review: "k" }, reuse }],
    ["review holder without a key", { prefix, holdKeys: CONTRACT_HOLD_KEYS, reuse, review: { holder: "other", drainMs: 0 } }],
    ["negative drain", { prefix, holdKeys: CONTRACT_HOLD_KEYS, reuse, review: { holder: "review", drainMs: -1 } }],
    ["re-put that keeps the review", { prefix, holdKeys: CONTRACT_HOLD_KEYS, reuse: { ...reuse, cancels: [] }, review: { holder: "review", drainMs: 0 } }],
    ["sealed names under rehold", { prefix, holdKeys: CONTRACT_HOLD_KEYS, reuse, sealedNames: /x/ }],
  ];
  for (const [label, options] of cases) {
    assert.throws(() => createFakeObjectStore(options), (e) => isCloudStorageError(e, "invalid_configuration"), label);
  }
});
