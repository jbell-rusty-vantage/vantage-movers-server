import {
  CloudStorageError,
  sha256Hex,
  type GenerationRef,
  type HoldRequest,
  type ObjectState,
  type ObjectStore,
  type PutInput,
  type RecoveryGuard,
  type ReferenceGuard,
  type ReusePolicy,
  type VerifiedRef,
} from "./contract";
import type { BucketDriver, RawObject } from "./driver";

export type ObjectStoreOptions = {
  /** Every name this handle touches must start with this prefix. Ends with "/". */
  prefix: string;
  /** Named holder -> object metadata key that records it. The provider hold is on while any is non-empty. */
  holdKeys?: Record<string, string>;
  reuse: ReusePolicy;
  now?: () => Date;
};

const GENERATION = /^\d+$/;
const fail = (code: CloudStorageError["code"], message: string): never => {
  throw new CloudStorageError(code, message);
};

/**
 * The one implementation of the storage rules. Drivers only move bytes and metadata; this module
 * owns hashing, read-back verification, hold bookkeeping, reuse, reference refusals and the
 * generation fences, so the fake bucket and GCS behave the same by construction.
 */
export function createObjectStore(driver: BucketDriver, options: ObjectStoreOptions): ObjectStore {
  const { prefix, reuse } = options;
  const holdKeys = options.holdKeys ?? {};
  const now = options.now ?? (() => new Date());
  if (!/^[a-z0-9][a-z0-9._-]*(\/[a-z0-9._-]+)*\/$/.test(prefix)) fail("invalid_configuration", `Invalid store prefix ${prefix}`);
  if (reuse.mode === "rehold" && ![reuse.holder, ...reuse.cancels].every((holder) => holdKeys[holder])) {
    fail("invalid_configuration", "Reuse policy names a holder without a metadata key");
  }

  function checkName(name: string) {
    if (typeof name !== "string" || !name.startsWith(prefix) || name.length > 1024 || name.includes("..") ||
        name.includes("//") || /[\u0000-\u001f\u007f]/.test(name)) {
      fail("invalid_name", `Object name outside ${prefix}`);
    }
  }
  function checkGeneration(generation: unknown): asserts generation is string {
    if (typeof generation !== "string" || !GENERATION.test(generation)) fail("invalid_name", "Exact generation required");
  }
  function keyFor(holder: string) {
    return holdKeys[holder] ?? fail("invalid_configuration", `Unknown holder ${holder}`);
  }
  function toState(raw: RawObject): ObjectState {
    const holds: Record<string, string> = {};
    for (const [holder, key] of Object.entries(holdKeys)) if (raw.metadata[key]) holds[holder] = raw.metadata[key];
    return {
      name: raw.name,
      generation: raw.generation,
      metageneration: raw.metageneration,
      size: raw.size,
      contentType: raw.contentType,
      recoveryClockStartedAt: raw.customTime,
      holds,
      independentHold: raw.temporaryHold && Object.keys(holds).length === 0,
      retentionLocked: raw.eventBasedHold || Boolean(raw.retainUntil),
      metadata: { ...raw.metadata },
      updated: raw.updated,
    };
  }
  async function pinned(ref: GenerationRef) {
    checkName(ref.name);
    checkGeneration(ref.generation);
    return (await driver.stat(ref.name, ref.generation)) ?? fail("not_found", "Generation not found");
  }
  const fence = (raw: RawObject) => ({ generation: raw.generation, metageneration: raw.metageneration });

  async function readVerified(ref: VerifiedRef) {
    checkName(ref.name);
    if (ref.generation !== undefined) checkGeneration(ref.generation);
    if (!/^[a-f0-9]{64}$/.test(ref.sha256)) fail("invalid_name", "SHA-256 locator required");
    const bytes = await driver.download(ref.name, ref.generation);
    if ((ref.size !== undefined && bytes.length !== ref.size) || sha256Hex(bytes) !== ref.sha256) {
      fail("verification_failed", "Stored object failed SHA-256 verification");
    }
    return bytes;
  }

  /** Protects an existing generation before it acquires another reader (see `ReusePolicy`). */
  async function reuseExisting(existing: RawObject, input: PutInput) {
    if (reuse.mode === "refuse_released") {
      // Packs: a later startRecoveryClock / customTime patch discharges the object; a new reader is refused.
      // Sealed catalogs are born with customTime (today's SI `seal()`). A lost insert that later 412s
      // must verify the existing generation, not throw `released`.
      if (existing.customTime && input.customTime === undefined) {
        fail("released", "Existing generation is already on its recovery clock");
      }
      return;
    }
    const state = toState(existing);
    const released = Boolean(existing.customTime);
    const cancelActive = reuse.cancels.some((holder) => state.holds[holder]);
    // Exactly the production Granot rule: a released, held generation must be held by the publisher or a cancellable review.
    if (released && existing.temporaryHold && !cancelActive && state.holds[reuse.holder] !== "1") {
      fail("independent_hold", "Released generation has an independent hold");
    }
    if (cancelActive || (released && !existing.temporaryHold)) {
      // A concurrent release must lose this metadata compare-and-swap before the generation gains a reader.
      const metadata = { ...existing.metadata };
      for (const holder of reuse.cancels) metadata[holdKeys[holder]] = "";
      metadata[holdKeys[reuse.holder]] = "1";
      await driver.patch(existing.name, fence(existing), { temporaryHold: true, metadata });
    }
  }

  return {
    bucket: driver.bucket,
    prefix,

    async put(input) {
      checkName(input.name);
      if (!Buffer.isBuffer(input.bytes)) fail("invalid_name", "Bytes must be a Buffer");
      const sha256 = sha256Hex(input.bytes);
      const inserted = await driver.insert(input.name, input.bytes, {
        contentType: input.contentType,
        customTime: input.customTime?.toISOString(),
        metadata: input.metadata,
      });
      let generation: string;
      let created = true;
      if (inserted === "exists") {
        const existing = (await driver.stat(input.name)) ?? fail("generation_mismatch", "Generation unavailable after a create conflict");
        generation = existing.generation;
        created = false;
        await reuseExisting(existing, input);
      } else {
        generation = inserted.generation;
      }
      checkGeneration(generation);
      const persisted = await driver.download(input.name, generation);
      if (persisted.length !== input.bytes.length || sha256Hex(persisted) !== sha256) {
        fail("verification_failed", "Read-back failed: stored bytes differ from the write");
      }
      return { name: input.name, generation, sha256, size: persisted.length, created, persisted };
    },

    readVerified,

    async stat(name, generation) {
      checkName(name);
      if (generation !== undefined) checkGeneration(generation);
      const raw = await driver.stat(name, generation);
      return raw ? toState(raw) : null;
    },

    async list(query) {
      if (!query.prefix.startsWith(prefix)) fail("invalid_name", `List prefix outside ${prefix}`);
      const page = await driver.list(query.prefix, query.pageToken, query.maxResults);
      return { items: page.items.map(toState), ...(page.nextPageToken ? { nextPageToken: page.nextPageToken } : {}) };
    },

    async hold(ref, request: HoldRequest) {
      const key = keyFor(request.holder);
      const raw = await pinned(ref);
      const state = toState(raw);
      if (state.independentHold) fail("independent_hold", "An independent hold is active");
      const token = request.token ?? "1";
      const current = state.holds[request.holder];
      if (current && current !== token) fail("held", `${request.holder} already holds this generation`);
      const replaced = (request.replaces ?? []).filter((holder) => state.holds[holder]);
      if (current === token && !replaced.length) return state;
      const reserved = new Set(Object.values(holdKeys));
      if (request.metadata) {
        for (const metaKey of Object.keys(request.metadata)) {
          if (reserved.has(metaKey)) fail("invalid_configuration", "Extra metadata cannot name a hold key");
        }
      }
      const metadata = { ...raw.metadata, ...request.metadata };
      for (const holder of request.replaces ?? []) metadata[keyFor(holder)] = "";
      metadata[key] = token;
      return toState(await driver.patch(raw.name, fence(raw), { temporaryHold: true, metadata }));
    },

    async release(ref, holder, token) {
      const key = keyFor(holder);
      const raw = await pinned(ref);
      const state = toState(raw);
      const current = state.holds[holder];
      if (!current) return state;
      if (token !== undefined && current !== token) fail("held", `${holder} holds this generation under another token`);
      const remaining = Object.keys(state.holds).filter((other) => other !== holder);
      return toState(await driver.patch(raw.name, fence(raw), {
        temporaryHold: remaining.length > 0,
        metadata: { ...raw.metadata, [key]: "" },
      }));
    },

    async startRecoveryClock(ref, guard: RecoveryGuard) {
      const raw = await pinned(ref);
      const state = toState(raw);
      if (state.retentionLocked) fail("held", "Independent retention applies");
      if (raw.customTime && !raw.temporaryHold) return state;
      if (await guard.references()) fail("referenced", "A locator still references this object");
      const required = guard.requireHold;
      const others = Object.keys(state.holds).filter((holder) => holder !== required?.holder);
      if (state.independentHold || others.length) fail("held", "Another hold is active");
      if (required) {
        if (state.holds[required.holder] !== required.token) fail("hold_not_drained", "The required review hold is not active");
        const heldSince = Date.parse(raw.updated);
        if (!Number.isFinite(heldSince) || +now() - heldSince < (required.heldForMs ?? 0)) {
          fail("hold_not_drained", "The review hold has not drained the publication window");
        }
      }
      await readVerified(ref);
      const changes: { customTime: string; temporaryHold?: boolean; metadata?: Record<string, string> } = { customTime: now().toISOString() };
      if (raw.temporaryHold) {
        changes.temporaryHold = false;
        changes.metadata = { ...raw.metadata };
        for (const key of Object.values(holdKeys)) changes.metadata[key] = "";
      }
      return toState(await driver.patch(raw.name, fence(raw), changes));
    },

    async deleteIfGeneration(ref, guard: ReferenceGuard) {
      checkName(ref.name);
      checkGeneration(ref.generation);
      const live = (await driver.stat(ref.name)) ?? fail("not_found", "Object not found");
      if (live.generation !== ref.generation) fail("generation_mismatch", "Locator generation is not the live generation");
      const state = toState(live);
      if (state.retentionLocked || live.temporaryHold) fail("held", "A hold protects this generation");
      if (await guard.references()) fail("referenced", "A locator still references this object");
      await readVerified(ref);
      await driver.remove(live.name, fence(live));
    },

    lifecycle: () => driver.lifecycle(),
  };
}
