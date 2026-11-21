import assert from "node:assert/strict";
import { test } from "node:test";
import { isCloudStorageError, sha256Hex, type CloudStorageErrorCode } from "./contract";
import { CONTRACT_HOLD_KEYS, objectStoreContract } from "./contractSuite";
import { createFakeBucket, createFakeObjectStore } from "./fakeBucket";

objectStoreContract("in-memory fake bucket", () => createFakeBucket());

const prefix = "unit/";
const rejectsWith = (promise: Promise<unknown>, code: CloudStorageErrorCode) =>
  assert.rejects(promise, (error) => isCloudStorageError(error, code) || assert.fail(`expected ${code}, got ${String(error)}`));
const unreferenced = { references: async () => false };
const granotLike = (now?: () => Date) => createFakeObjectStore({
  prefix, holdKeys: CONTRACT_HOLD_KEYS, reuse: { mode: "rehold", holder: "publisher", cancels: ["review"] }, now,
});
const body = Buffer.from("payload");
const put = (store: ReturnType<typeof granotLike>["store"], name = prefix + "a.bin", bytes = body) =>
  store.put({ name, bytes, contentType: "application/octet-stream" });

test("a corrupted stored object fails verified read and cannot be deleted", async () => {
  const { store, bucket } = granotLike();
  const stored = await put(store);
  bucket.corrupt(stored.name);
  await rejectsWith(store.readVerified(stored), "verification_failed");
  await rejectsWith(store.deleteIfGeneration(stored, unreferenced), "verification_failed");
  assert.ok(bucket.peek(stored.name), "the object stays for investigation");
});

test("a write whose read-back differs is refused", async () => {
  const { store, bucket } = granotLike();
  const download = bucket.download.bind(bucket);
  bucket.download = async (name, generation) => Buffer.concat([await download(name, generation), Buffer.from("!")]);
  await rejectsWith(put(store), "verification_failed");
});

test("generations are unique decimal strings and a delete followed by a put mints a new one", async () => {
  const { store } = granotLike();
  const first = await put(store);
  await store.deleteIfGeneration(first, unreferenced);
  const second = await put(store);
  assert.ok(BigInt(second.generation) > BigInt(first.generation));
  await rejectsWith(store.deleteIfGeneration(first, unreferenced), "generation_mismatch");
});

test("an independent provider hold blocks named holds, delete and reuse of a released generation", async () => {
  const { store, bucket } = granotLike();
  const stored = await put(store);
  await store.hold(stored, { holder: "review", token: "r" });
  await store.startRecoveryClock(stored, { ...unreferenced, requireHold: { holder: "review", token: "r" } });
  bucket.placeIndependentHold(stored.name);
  const state = await store.stat(stored.name);
  assert.equal(state?.independentHold, true);
  await rejectsWith(store.hold(stored, { holder: "publisher" }), "independent_hold");
  await rejectsWith(store.deleteIfGeneration(stored, unreferenced), "held");
  await rejectsWith(put(store), "independent_hold");
});

test("event-based retention refuses the recovery clock and delete", async () => {
  const { store, bucket } = granotLike();
  const stored = await put(store);
  bucket.placeEventBasedHold(stored.name);
  await rejectsWith(store.startRecoveryClock(stored, unreferenced), "held");
  await rejectsWith(store.deleteIfGeneration(stored, unreferenced), "held");
});

test("the review hold must drain the publication window before the recovery clock starts", async () => {
  let clock = Date.parse("2026-11-21T12:00:00.000Z");
  const { store, bucket } = granotLike(() => new Date(clock));
  const stored = await put(store);
  await store.hold(stored, { holder: "review", token: "r", replaces: ["publisher"] });
  const guard = { ...unreferenced, requireHold: { holder: "review", token: "r", heldForMs: 800_000 } };
  clock += 799_000;
  await rejectsWith(store.startRecoveryClock(stored, guard), "hold_not_drained");
  clock += 1_000;
  const started = await store.startRecoveryClock(stored, guard);
  assert.equal(started.recoveryClockStartedAt, "2026-11-21T12:13:20.000Z");
  const raw = bucket.peek(stored.name)!;
  assert.equal(raw.temporaryHold, false);
  assert.deepEqual(raw.metadata, { contractPublisherHold: "", contractReleaseReview: "" });
});

test("reusing a generation under review cancels the review and restores the publisher hold", async () => {
  const { store, bucket } = granotLike();
  const stored = await put(store);
  await store.hold(stored, { holder: "review", token: "r" });
  const reused = await put(store);
  assert.equal(reused.created, false);
  const raw = bucket.peek(stored.name)!;
  assert.equal(raw.temporaryHold, true);
  assert.deepEqual(raw.metadata, { contractReleaseReview: "", contractPublisherHold: "1" });
  await rejectsWith(store.startRecoveryClock(stored, { ...unreferenced, requireHold: { holder: "review", token: "r" } }), "held");
});

test("an unreleased, unreviewed generation is reused without any metadata change", async () => {
  const { store, bucket } = granotLike();
  const stored = await put(store);
  const before = bucket.peek(stored.name)!.metageneration;
  await put(store);
  assert.equal(bucket.peek(stored.name)!.metageneration, before);
});

test("the refuse_released policy refuses to reuse a generation on its recovery clock", async () => {
  const { store } = createFakeObjectStore({ prefix, reuse: { mode: "refuse_released" } });
  const stored = await put(store);
  await store.startRecoveryClock(stored, unreferenced);
  await rejectsWith(put(store), "released");
});

test("put can create an object already on its recovery clock (a sealed catalog)", async () => {
  const { store } = createFakeObjectStore({ prefix, reuse: { mode: "refuse_released" } });
  const customTime = new Date("2026-11-19T00:00:00.000Z");
  const stored = await store.put({ name: prefix + "catalog.json", bytes: Buffer.from("{}"), contentType: "application/json", customTime });
  assert.equal((await store.stat(stored.name))?.recoveryClockStartedAt, customTime.toISOString());
});

test("release is idempotent and keeps the provider hold while another named hold remains", async () => {
  const { store, bucket } = granotLike();
  const stored = await put(store);
  await store.release(stored, "publisher");
  await store.hold(stored, { holder: "publisher" });
  await store.hold(stored, { holder: "review", token: "r" });
  await store.release(stored, "review");
  assert.equal(bucket.peek(stored.name)!.temporaryHold, true);
  await rejectsWith(store.release(stored, "publisher", "wrong"), "held");
  await store.release(stored, "publisher", "1");
  assert.equal(bucket.peek(stored.name)!.temporaryHold, false);
});

test("a lost compare-and-swap surfaces as a generation mismatch", async () => {
  const { store, bucket } = granotLike();
  const stored = await put(store);
  const patch = bucket.patch.bind(bucket);
  bucket.patch = async (name, fence, changes) => {
    bucket.placeEventBasedHold(name); // a concurrent writer advances the metageneration first
    return patch(name, fence, changes);
  };
  await rejectsWith(store.hold(stored, { holder: "publisher" }), "generation_mismatch");
});

test("readVerified accepts a legacy locator without a generation and still checks SHA-256", async () => {
  const { store } = granotLike();
  const stored = await put(store);
  assert.ok((await store.readVerified({ name: stored.name, sha256: sha256Hex(body) })).equals(body));
  await rejectsWith(store.readVerified({ name: stored.name, sha256: sha256Hex(Buffer.from("x")) }), "verification_failed");
});

test("unknown holders and bad generations are refused", async () => {
  const { store } = granotLike();
  const stored = await put(store);
  await rejectsWith(store.hold(stored, { holder: "stranger" }), "invalid_configuration");
  await rejectsWith(store.hold({ name: stored.name, generation: "abc" }, { holder: "publisher" }), "invalid_name");
  assert.throws(() => createFakeObjectStore({ prefix: "no-slash", reuse: { mode: "refuse_released" } }), /Invalid store prefix/);
  assert.throws(() => createFakeObjectStore({ prefix, reuse: { mode: "rehold", holder: "publisher", cancels: [] } }), /without a metadata key/);
});
