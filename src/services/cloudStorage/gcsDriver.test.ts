import assert from "node:assert/strict";
import { test } from "node:test";
import type { storage_v1 } from "googleapis";
import { archiveObject, digest } from "../granotHistory/archiveCodec";
import { isCloudStorageError } from "./contract";
import { objectStoreContract } from "./contractSuite";
import type { RawObject } from "./driver";
import { createFakeBucket, type FakeBucket } from "./fakeBucket";
import { createGcsDriver, GCS_SCOPES, type GcsApi, type GcsScope } from "./gcsDriver";
import { CLOUD_STORAGE_NAMESPACES, CONTENT_TYPES, granotHistoryObjectName, storeForNamespace } from "./namespaces";

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
const config = { ...granot, namespace: "granot-history" as const, source: "default" as const };

test("a Granot put sends exactly today's create-only insert and pinned read-back", async () => {
  const fake = createFakeBucket({ bucket: granot.bucket });
  const { calls, client } = emulator(fake);
  const store = storeForNamespace(config, createGcsDriver({ bucket: granot.bucket, timeouts: granot.timeouts, client }));
  const bytes = Buffer.from("granot chunk");
  const hash = digest(bytes);
  const name = granotHistoryObjectName(granot.prefix, "vantagemovers", hash);
  assert.equal(name, archiveObject("vantagemovers", hash), "unchanged object name");

  const stored = await store.put({ name, bytes, contentType: CONTENT_TYPES.granotHistory });
  assert.equal(stored.sha256, hash);
  assert.deepEqual(calls.map(({ scope, method }) => [scope, method]), [["write", "objects.insert"], ["read", "objects.get"]]);
  assert.deepEqual(calls[0].params, {
    bucket: "vantage-mongodb-backups-496816", name, fields: "generation", ifGenerationMatch: "0",
    media: { mimeType: "application/octet-stream", body: bytes },
  });
  assert.deepEqual(calls[0].options, { timeout: 30_000 });
  assert.deepEqual(calls[1].params, { bucket: granot.bucket, object: name, generation: stored.generation, alt: "media" });
  assert.deepEqual(calls[1].options, { responseType: "arraybuffer", timeout: 15_000 });
});

test("a Granot re-put of a released generation re-holds it with today's metadata and fences", async () => {
  const fake = createFakeBucket({ bucket: granot.bucket });
  const { calls, client } = emulator(fake);
  const store = storeForNamespace(config, createGcsDriver({ bucket: granot.bucket, client }));
  const bytes = Buffer.from("released chunk");
  const name = granotHistoryObjectName(granot.prefix, "vantagemovers", digest(bytes));
  const first = await store.put({ name, bytes, contentType: CONTENT_TYPES.granotHistory });
  await store.startRecoveryClock(first, { references: async () => false });
  const before = fake.peek(name)!;
  calls.length = 0;

  await store.put({ name, bytes, contentType: CONTENT_TYPES.granotHistory });
  const patch = calls.find((call) => call.method === "objects.patch")!;
  assert.equal(patch.scope, "control");
  assert.deepEqual(
    { ...patch.params, fields: undefined },
    {
      bucket: granot.bucket, object: name, generation: first.generation, ifGenerationMatch: first.generation,
      ifMetagenerationMatch: before.metageneration, fields: undefined,
      requestBody: { temporaryHold: true, metadata: { granotReleaseReview: "", granotPublisherHold: "1" } },
    },
  );
  assert.equal(fake.peek(name)!.temporaryHold, true);
});

test("transient failures are retried on idempotent requests only", async () => {
  let inserts = 0;
  let patches = 0;
  const api = {
    objects: {
      async insert() {
        if (++inserts === 1) throw providerError(503);
        return { data: { generation: "7" } };
      },
      async patch() {
        patches++;
        throw providerError(503);
      },
    },
  } as unknown as GcsApi;
  const driver = createGcsDriver({ bucket: "b", client: () => api, sleep: async () => {} });
  assert.deepEqual(await driver.insert("p/x", Buffer.from("x"), { contentType: "text/plain" }), { generation: "7" });
  assert.equal(inserts, 2);
  await assert.rejects(driver.patch("p/x", { generation: "7", metageneration: "1" }, { temporaryHold: true }), /provider error/);
  assert.equal(patches, 1, "a compare-and-swap is never blindly retried");
});

test("a lost insert response that later conflicts is reported as an existing object", async () => {
  const api = { objects: { insert: async () => { throw providerError(412); } } } as unknown as GcsApi;
  const driver = createGcsDriver({ bucket: "b", client: () => api });
  assert.equal(await driver.insert("p/x", Buffer.from("x"), { contentType: "text/plain" }), "exists");
});

test("provider errors map to contract codes", async () => {
  const fail = (code: number, message?: string) => async () => { throw providerError(code, message); };
  const api = { objects: { get: fail(404), patch: fail(412), delete: fail(403, "Object is under active Temporary hold") } } as unknown as GcsApi;
  const driver = createGcsDriver({ bucket: "b", client: () => api });
  assert.equal(await driver.stat("p/x"), null);
  await assert.rejects(driver.download("p/x"), (e) => isCloudStorageError(e, "not_found"));
  await assert.rejects(driver.patch("p/x", { generation: "1", metageneration: "1" }, {}), (e) => isCloudStorageError(e, "generation_mismatch"));
  await assert.rejects(driver.remove("p/x", { generation: "1", metageneration: "1" }), (e) => isCloudStorageError(e, "held"));
});

test("the scopes are the least-privilege scopes today's callers use", () => {
  assert.deepEqual(GCS_SCOPES, {
    read: "https://www.googleapis.com/auth/devstorage.read_only",
    write: "https://www.googleapis.com/auth/devstorage.read_write",
    control: "https://www.googleapis.com/auth/devstorage.full_control",
  });
});
