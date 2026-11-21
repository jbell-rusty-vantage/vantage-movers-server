import { CloudStorageError, type LifecycleRule, type ObjectStore } from "./contract";
import type { BucketDriver, Fence, InsertOptions, MetadataPatch, RawObject } from "./driver";
import { createObjectStore, type ObjectStoreOptions } from "./objectStore";

type Stored = RawObject & { bytes: Buffer };

export type FakeBucket = BucketDriver & {
  /** Overwrites stored bytes without a new generation, as silent corruption or a bad read would. */
  corrupt(name: string): void;
  /** A provider temporary hold that no named holder recorded (an operator or another system). */
  placeIndependentHold(name: string): void;
  /** Provider retention the module never sets (event-based hold). */
  placeEventBasedHold(name: string): void;
  setLifecycle(rules: LifecycleRule[]): void;
  /** Copy of the stored provider state, or `undefined`. */
  peek(name: string): (RawObject & { bytes: Buffer }) | undefined;
};

/**
 * In-memory bucket with GCS semantics: create-only inserts with generation zero, decimal
 * generations that never repeat, metagenerations that advance on every metadata change,
 * compare-and-swap patch and delete, held objects that cannot be deleted, and a recovery-clock
 * marker (`customTime`) that can only move forward. No versioning: a replaced or deleted
 * generation is gone.
 */
export function createFakeBucket(options: { bucket?: string; now?: () => Date } = {}): FakeBucket {
  const bucket = options.bucket ?? "fake-test-bucket";
  const now = options.now ?? (() => new Date());
  const objects = new Map<string, Stored>();
  let nextGeneration = 1_763_000_000_000_000n;
  let rules: LifecycleRule[] = [];

  const copy = ({ bytes: _bytes, ...raw }: Stored): RawObject => ({ ...raw, metadata: { ...raw.metadata } });
  const exact = (name: string, generation?: string) => {
    const stored = objects.get(name);
    return stored && (generation === undefined || stored.generation === generation) ? stored : undefined;
  };
  const fenced = (name: string, fence: Fence) => {
    const stored = objects.get(name);
    if (!stored) throw new CloudStorageError("not_found", "Object not found");
    if (stored.generation !== fence.generation || stored.metageneration !== fence.metageneration) {
      throw new CloudStorageError("generation_mismatch", "Precondition failed");
    }
    return stored;
  };
  const mustExist = (name: string) => {
    const stored = objects.get(name);
    if (!stored) throw new Error(`Fake bucket has no ${name}`);
    return stored;
  };

  return {
    bucket,
    async insert(name: string, bytes: Buffer, insert: InsertOptions) {
      if (objects.has(name)) return "exists";
      const generation = String(nextGeneration++);
      objects.set(name, {
        name, generation, metageneration: "1", size: bytes.length, contentType: insert.contentType,
        ...(insert.customTime ? { customTime: insert.customTime } : {}),
        temporaryHold: false, eventBasedHold: false, metadata: { ...insert.metadata },
        updated: now().toISOString(), bytes: Buffer.from(bytes),
      });
      return { generation };
    },
    async stat(name, generation) {
      const stored = exact(name, generation);
      return stored ? copy(stored) : null;
    },
    async download(name, generation) {
      const stored = exact(name, generation);
      if (!stored) throw new CloudStorageError("not_found", "Object not found");
      return Buffer.from(stored.bytes);
    },
    async patch(name, fence, changes: MetadataPatch) {
      const stored = fenced(name, fence);
      if (changes.customTime && stored.customTime && Date.parse(changes.customTime) < Date.parse(stored.customTime)) {
        throw new Error("customTime cannot decrease");
      }
      if (changes.temporaryHold !== undefined) stored.temporaryHold = changes.temporaryHold;
      if (changes.customTime) stored.customTime = changes.customTime;
      if (changes.metadata) stored.metadata = { ...stored.metadata, ...changes.metadata };
      stored.metageneration = String(Number(stored.metageneration) + 1);
      stored.updated = now().toISOString();
      return copy(stored);
    },
    async remove(name, fence) {
      const stored = fenced(name, fence);
      if (stored.temporaryHold || stored.eventBasedHold) throw new CloudStorageError("held", "Object is under a hold");
      objects.delete(name);
    },
    async list(prefix, pageToken, maxResults = 1000) {
      const names = [...objects.keys()].filter((name) => name.startsWith(prefix)).sort();
      const start = pageToken ? Number(pageToken) : 0;
      const page = names.slice(start, start + maxResults);
      const next = start + page.length;
      return {
        items: page.map((name) => copy(objects.get(name)!)),
        ...(next < names.length ? { nextPageToken: String(next) } : {}),
      };
    },
    async lifecycle() {
      return structuredClone(rules);
    },
    corrupt(name) {
      const stored = mustExist(name);
      stored.bytes = Buffer.from(stored.bytes);
      stored.bytes[0] = stored.bytes.length ? stored.bytes[0] ^ 0xff : 0;
      if (!stored.bytes.length) stored.bytes = Buffer.from([0]);
    },
    placeIndependentHold(name) {
      const stored = mustExist(name);
      stored.temporaryHold = true;
      stored.metageneration = String(Number(stored.metageneration) + 1);
    },
    placeEventBasedHold(name) {
      const stored = mustExist(name);
      stored.eventBasedHold = true;
      stored.metageneration = String(Number(stored.metageneration) + 1);
    },
    setLifecycle(next) {
      rules = structuredClone(next);
    },
    peek(name) {
      const stored = objects.get(name);
      return stored ? { ...copy(stored), bytes: Buffer.from(stored.bytes) } : undefined;
    },
  };
}

/** An `ObjectStore` over a fresh fake bucket, for caller unit tests. */
export function createFakeObjectStore(options: ObjectStoreOptions & { bucket?: string }): { store: ObjectStore; bucket: FakeBucket } {
  const bucket = createFakeBucket({ bucket: options.bucket, now: options.now });
  return { store: createObjectStore(bucket, options), bucket };
}
