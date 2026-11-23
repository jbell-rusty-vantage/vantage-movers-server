import { Readable } from "node:stream";
import { google, type storage_v1 } from "googleapis";
import { createGoogleServiceAccountAuth } from "../googleAuth/serviceAccount";
import { CloudStorageError, type LifecycleRule } from "./contract";
import type { BucketDriver, RawObject } from "./driver";

/** Least privilege per call, exactly as the existing Granot archive writer uses them. */
export const GCS_SCOPES = {
  read: "https://www.googleapis.com/auth/devstorage.read_only",
  write: "https://www.googleapis.com/auth/devstorage.read_write",
  control: "https://www.googleapis.com/auth/devstorage.full_control",
} as const;
export type GcsScope = keyof typeof GCS_SCOPES;

type Params = Record<string, unknown>;
type CallOptions = { timeout: number; responseType?: "arraybuffer" };
/** The promise-returning subset of the googleapis Storage v1 client this driver calls. */
export type GcsApi = {
  objects: {
    insert(params: Params, options: CallOptions): Promise<{ data: storage_v1.Schema$Object }>;
    get(params: Params, options: CallOptions): Promise<{ data: unknown }>;
    patch(params: Params, options: CallOptions): Promise<{ data: storage_v1.Schema$Object }>;
    delete(params: Params, options: CallOptions): Promise<unknown>;
    list(params: Params, options: CallOptions): Promise<{ data: storage_v1.Schema$Objects }>;
  };
  buckets: { get(params: Params, options: CallOptions): Promise<{ data: storage_v1.Schema$Bucket }> };
};

export type GcsDriverOptions = {
  bucket: string;
  /** Defaults match the Granot archive: 15 s reads, 30 s writes. */
  timeouts?: { readMs?: number; writeMs?: number };
  /** Test seam. Production builds one client per scope from the shared service-account auth. */
  client?: (scope: GcsScope) => GcsApi;
  /** Attempts for idempotent requests (reads, stat, list, create-only insert). Default 3. */
  attempts?: number;
  sleep?: (ms: number) => Promise<void>;
};

const OBJECT_FIELDS = "name,generation,metageneration,size,contentType,customTime,temporaryHold,eventBasedHold,retention,retentionExpirationTime,metadata,updated";
const TRANSIENT_HTTP = new Set([408, 429, 500, 502, 503, 504]);
const TRANSIENT_NETWORK = new Set(["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ECONNREFUSED", "EPIPE"]);

function status(error: unknown) {
  const e = error as { code?: unknown; status?: unknown; response?: { status?: unknown } };
  return Number(e?.response?.status ?? e?.status ?? e?.code);
}
const isTransient = (error: unknown) =>
  TRANSIENT_HTTP.has(status(error)) || TRANSIENT_NETWORK.has(String((error as { code?: unknown })?.code));

function defaultClient(): (scope: GcsScope) => GcsApi {
  const clients = new Map<GcsScope, GcsApi>();
  return (scope) => {
    let client = clients.get(scope);
    if (!client) {
      // googleapis declares callback overloads beside the promise form; only the promise form is used.
      client = google.storage({ version: "v1", auth: createGoogleServiceAccountAuth([GCS_SCOPES[scope]]) }) as unknown as GcsApi;
      clients.set(scope, client);
    }
    return client;
  };
}

function toRaw(data: storage_v1.Schema$Object): RawObject {
  if (!data.name || !data.generation || !data.metageneration) {
    throw new CloudStorageError("generation_mismatch", "Storage response lacks a generation fence");
  }
  const metadata: Record<string, string> = {};
  for (const [key, value] of Object.entries(data.metadata ?? {})) if (value != null) metadata[key] = String(value);
  const retainUntil = data.retention?.retainUntilTime ?? data.retentionExpirationTime ?? undefined;
  return {
    name: data.name,
    generation: String(data.generation),
    metageneration: String(data.metageneration),
    size: Number(data.size ?? 0),
    ...(data.contentType ? { contentType: data.contentType } : {}),
    ...(data.customTime ? { customTime: data.customTime } : {}),
    temporaryHold: Boolean(data.temporaryHold),
    eventBasedHold: Boolean(data.eventBasedHold),
    ...(retainUntil ? { retainUntil } : {}),
    metadata,
    updated: data.updated ?? "",
  };
}

/**
 * Google Cloud Storage JSON API driver. Request shapes reproduce today's Granot archive writer:
 * create-only `objects.insert` with `ifGenerationMatch: "0"` and `fields: "generation"`, pinned
 * `alt: "media"` reads, and metadata changes fenced on generation plus metageneration. Compare-and-swap
 * patches and deletes are never retried here: after a lost response the caller re-reads state.
 */
export function createGcsDriver(options: GcsDriverOptions): BucketDriver {
  const { bucket } = options;
  const readMs = options.timeouts?.readMs ?? 15_000;
  const writeMs = options.timeouts?.writeMs ?? 30_000;
  const client = options.client ?? defaultClient();
  const attempts = Math.max(1, options.attempts ?? 3);
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  async function retried<T>(call: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await call();
      } catch (error) {
        if (attempt >= attempts || !isTransient(error)) throw error;
        await sleep(250 * 2 ** (attempt - 1));
      }
    }
  }
  function translate(error: unknown): never {
    const code = status(error);
    if (code === 412) throw new CloudStorageError("generation_mismatch", "Precondition failed");
    if (code === 404) throw new CloudStorageError("not_found", "Object not found");
    if (code === 403 && /hold|retention/i.test(String((error as Error)?.message))) {
      throw new CloudStorageError("held", "A provider hold or retention protects the object");
    }
    throw error;
  }

  return {
    bucket,
    async insert(name, bytes, insert) {
      const requestBody = {
        ...(insert.customTime ? { customTime: insert.customTime } : {}),
        ...(insert.metadata ? { metadata: insert.metadata } : {}),
      };
      try {
        const multipart = Object.keys(requestBody).length > 0;
        const created = await retried(() => client("write").objects.insert({
          bucket, name, fields: "generation", ifGenerationMatch: "0",
          ...(multipart ? { requestBody } : {}),
          // A multipart upload (metadata or customTime with the bytes) streams its media part, so the client needs a
          // stream; a fresh one per attempt, since a retry re-sends the body. A media-only upload accepts the Buffer.
          media: { mimeType: insert.contentType, body: multipart ? Readable.from([bytes]) : bytes },
        }, { timeout: writeMs }));
        if (!created.data.generation) throw new CloudStorageError("generation_mismatch", "Storage generation unavailable");
        return { generation: String(created.data.generation) };
      } catch (error) {
        if (status(error) === 412) return "exists";
        throw error;
      }
    },
    async stat(name, generation) {
      try {
        const { data } = await retried(() => client("read").objects.get({ bucket, object: name, generation, fields: OBJECT_FIELDS }, { timeout: readMs }));
        return toRaw(data as storage_v1.Schema$Object);
      } catch (error) {
        if (status(error) === 404) return null;
        return translate(error);
      }
    },
    async download(name, generation) {
      try {
        const result = await retried(() => client("read").objects.get(
          { bucket, object: name, generation, alt: "media" },
          { responseType: "arraybuffer", timeout: readMs },
        ));
        return Buffer.from(result.data as ArrayBuffer);
      } catch (error) {
        return translate(error);
      }
    },
    async patch(name, fence, changes) {
      try {
        const { data } = await client("control").objects.patch({
          bucket, object: name, generation: fence.generation,
          ifGenerationMatch: fence.generation, ifMetagenerationMatch: fence.metageneration,
          fields: OBJECT_FIELDS, requestBody: changes,
        }, { timeout: readMs });
        return toRaw(data);
      } catch (error) {
        return translate(error);
      }
    },
    async remove(name, fence) {
      try {
        await client("control").objects.delete({
          bucket, object: name, generation: fence.generation,
          ifGenerationMatch: fence.generation, ifMetagenerationMatch: fence.metageneration,
        }, { timeout: readMs });
      } catch (error) {
        translate(error);
      }
    },
    async list(prefix, pageToken, maxResults) {
      const { data } = await retried(() => client("read").objects.list({
        bucket, prefix, pageToken, maxResults, fields: `items(${OBJECT_FIELDS}),nextPageToken`,
      }, { timeout: readMs }));
      return {
        items: (data.items ?? []).map(toRaw),
        ...(data.nextPageToken ? { nextPageToken: data.nextPageToken } : {}),
      };
    },
    async lifecycle() {
      const { data } = await retried(() => client("read").buckets.get({ bucket, fields: "lifecycle" }, { timeout: readMs }));
      return (data.lifecycle?.rule ?? []).map((rule): LifecycleRule => ({
        action: { type: String(rule.action?.type ?? ""), ...(rule.action?.storageClass ? { storageClass: rule.action.storageClass } : {}) },
        condition: { ...(rule.condition ?? {}) } as LifecycleRule["condition"],
      }));
    },
  };
}
