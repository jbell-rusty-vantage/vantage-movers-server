import assert from "node:assert/strict";
import { test } from "node:test";
import type { Db } from "mongodb";
import type { storage_v1 } from "googleapis";
import { digest } from "../granotHistory/archiveCodec";
import { isCloudStorageError } from "./contract";
import { objectStoreContract } from "./contractSuite";
import type { RawObject } from "./driver";
import { createFakeBucket, type FakeBucket } from "./fakeBucket";
import { createGcsDriver, type GcsApi, type GcsScope } from "./gcsDriver";
import { CLOUD_STORAGE_NAMESPACES, CONTENT_TYPES, granotHistoryObjectName, openObjectStore } from "./namespaces";

type Call = { scope: GcsScope; method: string; params: Record<string, unknown>; options: Record<string, unknown> };

const providerError = (code: number, message = "provider error") => Object.assign(new Error(message), { code });
const schema = (raw: RawObject): storage_v1.Schema$Object => ({
  name: raw.name, generation: raw.generation, metageneration: raw.metageneration, size: String(raw.size),
  contentType: raw.contentType, customTime: raw.customTime, temporaryHold: raw.temporaryHold,
  eventBasedHold: raw.eventBasedHold, metadata: raw.metadata, updated: raw.updated,
});
async function translated<T>(call: () => Promise<T>) {
  try {
    return await call();
  } catch (error) {
    if (isCloudStorageError(error, "generation_mismatch")) throw providerError(412, "conditionNotMet");
    if (isCloudStorageError(error, "not_found")) throw providerError(404, "No such object");
    if (isCloudStorageError(error, "held")) throw providerError(403, "Object is under active Temporary hold");
    throw error;
  }
}

/** A GCS JSON API emulator over the fake bucket, recording every request the driver sends. */
function emulator(bucket: FakeBucket) {
  const calls: Call[] = [];
  const client = (scope: GcsScope): GcsApi => {
    const record = (method: string, params: Record<string, unknown>, options: Record<string, unknown>) =>
      calls.push({ scope, method, params, options: { ...options } });
    return {
      objects: {
        async insert(params, options) {
          record("objects.insert", params, options);
          const media = params.media as { mimeType: string; body: Buffer };
          const body = params.requestBody as { customTime?: string; metadata?: Record<string, string> } | undefined;
          const result = await bucket.insert(String(params.name), media.body, { contentType: media.mimeType, ...body });
          if (result === "exists") throw providerError(412, "conditionNotMet");
          return { data: { generation: result.generation } };
        },
        async get(params, options) {
          record("objects.get", params, options);
          const object = String(params.object);
          const generation = params.generation as string | undefined;
          if (params.alt === "media") {
            const bytes = await translated(() => bucket.download(object, generation));
            return { data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) };
          }
          const raw = await bucket.stat(object, generation);
          if (!raw) throw providerError(404, "No such object");
          return { data: schema(raw) };
        },
        async patch(params, options) {
          record("objects.patch", params, options);
          const raw = await translated(() => bucket.patch(String(params.object), {
            generation: String(params.ifGenerationMatch), metageneration: String(params.ifMetagenerationMatch),
          }, params.requestBody as Record<string, never>));
          return { data: schema(raw) };
        },
        async delete(params, options) {
          record("objects.delete", params, options);
          await translated(() => bucket.remove(String(params.object), {
            generation: String(params.ifGenerationMatch), metageneration: String(params.ifMetagenerationMatch),
          }));
          return {};
        },
        async list(params, options) {
          record("objects.list", params, options);
          const page = await bucket.list(String(params.prefix), params.pageToken as string | undefined, params.maxResults as number | undefined);
          return { data: { items: page.items.map(schema), nextPageToken: page.nextPageToken } };
        },
      },
      buckets: {
        async get(params, options) {
          record("buckets.get", params, options);
          type Rules = NonNullable<NonNullable<storage_v1.Schema$Bucket["lifecycle"]>["rule"]>;
          return { data: { lifecycle: { rule: (await bucket.lifecycle()) as Rules } } };
        },
      },
    };
  };
  return { calls, client };
}

objectStoreContract("GCS driver over an emulated JSON API", () => {
  const fake = createFakeBucket({ bucket: "emulated" });
  return createGcsDriver({ bucket: "emulated", client: emulator(fake).client, sleep: async () => {} });
});

const granot = CLOUD_STORAGE_NAMESPACES["granot-history"];
const productionDb = { databaseName: "vantagemovers", collection: () => ({ findOne: async () => null }) } as unknown as Db;
const granotRule = { action: { type: "Delete" }, condition: { daysSinceCustomTime: 30, matchesPrefix: ["history/granot/v1/vantagemovers/", "history/granot/released/vantagemovers/"] } };

test("Granot requests reproduce today's archive writer: create-only insert, pinned read-back, fenced re-hold", async () => {
  let clock = Date.parse("2026-11-21T12:00:00.000Z");
  const fake = createFakeBucket({ bucket: granot.bucket, now: () => new Date(clock) });
  fake.setLifecycle([granotRule]);
  const { calls, client } = emulator(fake);
  const { store } = await openObjectStore(productionDb, "granot-history", {
    capability: "release", driver: createGcsDriver({ bucket: granot.bucket, timeouts: granot.timeouts, client }), now: () => new Date(clock),
  });
  const bytes = Buffer.from("granot chunk");
  const name = granotHistoryObjectName(granot.prefix, "vantagemovers", digest(bytes));
  calls.length = 0;
  const stored = await store.put({ name, bytes, contentType: CONTENT_TYPES.granotHistory });
  assert.deepEqual(calls.map(({ scope, method, params, options }) => ({ scope, method, params, options })), [
    { scope: "write", method: "objects.insert", options: { timeout: 30_000 }, params: {
      bucket: "vantage-mongodb-backups-496816", name, fields: "generation", ifGenerationMatch: "0",
      media: { mimeType: "application/octet-stream", body: bytes } } },
    { scope: "read", method: "objects.get", options: { responseType: "arraybuffer", timeout: 15_000 }, params: {
      bucket: granot.bucket, object: name, generation: stored.generation, alt: "media" } },
  ]);

  await store.hold(stored, { holder: "review", token: "r", replaces: ["publisher"] });
  clock += 800_000;
  await store.startRecoveryClock(stored, { references: async () => false, reviewToken: "r" });
  const before = fake.peek(name)!;
  calls.length = 0;
  await store.put({ name, bytes, contentType: CONTENT_TYPES.granotHistory });
  const patch = calls.find((call) => call.method === "objects.patch")!;
  assert.equal(patch.scope, "control");
  const { fields: _fields, ...params } = patch.params;
  assert.deepEqual(params, {
    bucket: granot.bucket, object: name, generation: stored.generation, ifGenerationMatch: stored.generation,
    ifMetagenerationMatch: before.metageneration,
    requestBody: { temporaryHold: true, metadata: { granotReleaseReview: "", granotPublisherHold: "1" } },
  });
});

test("provider errors: idempotent requests retry, compare-and-swap never does, and codes map to the contract", async () => {
  let inserts = 0;
  let patches = 0;
  const failing = (code: number, message?: string) => async () => { throw providerError(code, message); };
  const api = {
    objects: {
      async insert() {
        if (++inserts === 1) throw providerError(503);
        throw providerError(412); // the first attempt landed: report the existing object
      },
      async patch() { patches++; throw providerError(503); },
      get: failing(404),
      delete: failing(403, "Object is under active Temporary hold"),
    },
  } as unknown as GcsApi;
  const driver = createGcsDriver({ bucket: "b", client: () => api, sleep: async () => {} });
  assert.equal(await driver.insert("p/x", Buffer.from("x"), { contentType: "text/plain" }), "exists");
  assert.equal(inserts, 2);
  await assert.rejects(driver.patch("p/x", { generation: "1", metageneration: "1" }, {}), /provider error/);
  assert.equal(patches, 1);
  assert.equal(await driver.stat("p/x"), null);
  for (const [call, code] of [
    [() => driver.download("p/x"), "not_found"],
    [() => driver.remove("p/x", { generation: "1", metageneration: "1" }), "held"],
  ] as const) await assert.rejects(call(), (e) => isCloudStorageError(e, code));
  const conflict = createGcsDriver({ bucket: "b", client: () => ({ objects: { patch: failing(412) } }) as unknown as GcsApi });
  await assert.rejects(conflict.patch("p/x", { generation: "1", metageneration: "1" }, {}), (e) => isCloudStorageError(e, "generation_mismatch"));
});
