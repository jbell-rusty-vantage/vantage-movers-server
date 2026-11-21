import {
  CloudStorageError,
  sha256Hex,
  type DeleteGuard,
  type GenerationRef,
  type HoldRequest,
  type ObjectState,
  type ObjectStore,
  type PutInput,
  type RecoveryGuard,
  type ReusePolicy,
  type ReviewPolicy,
  type VerifiedRef,
} from "./contract";
import type { BucketDriver, RawObject } from "./driver";

export type ObjectStoreOptions = {
  /** Every name this handle touches must start with this prefix. Ends with "/". */
  prefix: string;
  /** Named holder -> object metadata key that records it. The provider hold is on while any is non-empty. */
  holdKeys?: Record<string, string>;
  reuse: ReusePolicy;
  /** The namespace release review. Without one, the store never deletes directly. */
  review?: ReviewPolicy;
  /**
   * Whether this handle may start recovery clocks or delete. `openObjectStore` grants it only after
   * the bucket lifecycle rule has been checked. Defaults to true for directly built stores (tests).
   */
  canRelease?: boolean;
  now?: () => Date;
};

const GENERATION = /^\d+$/;
const fail = (code: CloudStorageError["code"], message: string): never => {
  throw new CloudStorageError(code, message);
};

/**
 * The one implementation of the storage rules. Drivers only move bytes and metadata; this module
 * owns hashing, read-back verification, hold bookkeeping, reuse, reference refusals, the review
 * drain and the generation fences, so the fake bucket and GCS behave the same by construction.
 */
export function createObjectStore(driver: BucketDriver, options: ObjectStoreOptions): ObjectStore {
  const { prefix, reuse, review } = options;
  const holdKeys = options.holdKeys ?? {};
  const canRelease = options.canRelease ?? true;
  const now = options.now ?? (() => new Date());
  if (!/^[a-z0-9][a-z0-9._-]*(\/[a-z0-9._-]+)*\/$/.test(prefix)) fail("invalid_configuration", `Invalid store prefix ${prefix}`);
  if (reuse.mode === "rehold" && ![reuse.holder, ...reuse.cancels].every((holder) => holdKeys[holder])) {
    fail("invalid_configuration", "Reuse policy names a holder without a metadata key");
  }
  if (review && (!holdKeys[review.holder] || !Number.isInteger(review.drainMs) || review.drainMs < 0)) {
    fail("invalid_configuration", "Review policy needs a known holder and a non-negative drain window");
  }
  if (reuse.mode === "rehold" && review && !reuse.cancels.includes(review.holder)) {
    fail("invalid_configuration", "A re-put must cancel the review hold");
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
  /** Metadata that clears every named hold, as production writes it (`""`, never a removed key). */
  const clearedHolds = (raw: RawObject) => {
    const metadata = { ...raw.metadata };
    for (const key of Object.values(holdKeys)) metadata[key] = "";
    return metadata;
  };

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

  /**
   * The namespace review hold must cover the generation under the caller's token, alone, for the
   * whole drain window. `updated` advances on every metadata change, so any later hold, cancel or
   * re-hold restarts the window.
   */
  function requireDrainedReview(raw: RawObject, state: ObjectState, token: string | undefined) {
    if (!review) return;
    if (!token || state.holds[review.holder] !== token) fail("hold_not_drained", "The namespace review hold is not active under this token");
    if (state.independentHold || Object.keys(state.holds).some((holder) => holder !== review.holder)) fail("held", "Another hold is active");
    if (review.drainMs === 0) return; // test namespaces only; avoids depending on clock skew against the provider
    const heldSince = Date.parse(raw.updated);
    if (!Number.isFinite(heldSince) || +now() - heldSince < review.drainMs) {
      fail("hold_not_drained", "The review hold has not drained the publication window");
    }
  }

  /** Protects an existing generation before it acquires another reader (see `ReusePolicy`). */
  async function reuseExisting(existing: RawObject, input: PutInput) {
    if (reuse.mode === "refuse_released") {
      // A sealed catalog is created on its clock; production accepts its existing generation on retry.
      if (existing.customTime && !input.customTime) fail("released", "Existing generation is already on its recovery clock");
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
      // A concurrent release or delete must lose this metadata compare-and-swap before the generation gains a reader.
      const metadata = { ...existing.metadata };
      for (const holder of reuse.cancels) metadata[holdKeys[holder]] = "";
      metadata[holdKeys[reuse.holder]] = "1";
      await driver.patch(existing.name, fence(existing), { temporaryHold: true, metadata });
    }
  }

  function requireReleaseCapability() {
    if (!canRelease) fail("not_permitted", "Store opened without release capability (lifecycle rule not checked)");
  }

  return {
    bucket: driver.bucket,
    prefix,

    async put(input) {
      checkName(input.name);
      if (!Buffer.isBuffer(input.bytes)) fail("invalid_name", "Bytes must be a Buffer");
      const sha256 = sha256Hex(input.bytes);
      const verify = (persisted: Buffer) => {
        if (persisted.length !== input.bytes.length || sha256Hex(persisted) !== sha256) {
          fail("verification_failed", "Read-back failed: stored bytes differ from the write");
        }
        return persisted;
      };
      const inserted = await driver.insert(input.name, input.bytes, {
        contentType: input.contentType,
        customTime: input.customTime?.toISOString(),
        metadata: input.metadata,
      });
      if (inserted !== "exists") {
        checkGeneration(inserted.generation);
        const persisted = verify(await driver.download(input.name, inserted.generation));
        return { name: input.name, generation: inserted.generation, sha256, size: persisted.length, created: true, persisted };
      }
      const existing = (await driver.stat(input.name)) ?? fail("generation_mismatch", "Generation unavailable after a create conflict");
      checkGeneration(existing.generation);
      // Compare bytes before touching any hold: a different object under this name is never re-held.
      const persisted = verify(await driver.download(input.name, existing.generation));
      await reuseExisting(existing, input);
      return { name: input.name, generation: existing.generation, sha256, size: persisted.length, created: false, persisted };
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
      const reserved = new Set(Object.values(holdKeys));
      if (Object.keys(request.metadata ?? {}).some((metaKey) => reserved.has(metaKey))) {
        fail("invalid_configuration", "Extra metadata cannot name a hold key");
      }
      const raw = await pinned(ref);
      const state = toState(raw);
      if (state.independentHold) fail("independent_hold", "An independent hold is active");
      const token = request.token ?? "1";
      const current = state.holds[request.holder];
      if (current && current !== token) fail("held", `${request.holder} already holds this generation`);
      const replaced = (request.replaces ?? []).filter((holder) => state.holds[holder]);
      if (current === token && !replaced.length) return state;
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
      requireReleaseCapability();
      const raw = await pinned(ref);
      const state = toState(raw);
      if (state.retentionLocked) fail("held", "Independent retention applies");
      if (raw.customTime && !raw.temporaryHold) return state;
      if (await guard.references()) fail("referenced", "A locator still references this object");
      if (review) requireDrainedReview(raw, state, guard.reviewToken);
      else if (raw.temporaryHold) fail("held", "A hold protects this generation");
      await readVerified(ref);
      const changes: { customTime: string; temporaryHold?: boolean; metadata?: Record<string, string> } = { customTime: now().toISOString() };
      if (raw.temporaryHold) {
        changes.temporaryHold = false;
        changes.metadata = clearedHolds(raw);
      }
      return toState(await driver.patch(raw.name, fence(raw), changes));
    },

    async deleteIfGeneration(ref, guard: DeleteGuard) {
      requireReleaseCapability();
      if (!review) fail("not_permitted", "This namespace has no review policy; it expires through the lifecycle only");
      checkName(ref.name);
      checkGeneration(ref.generation);
      const live = (await driver.stat(ref.name)) ?? fail("not_found", "Object not found");
      if (live.generation !== ref.generation) fail("generation_mismatch", "Locator generation is not the live generation");
      const state = toState(live);
      if (state.retentionLocked) fail("held", "Independent retention applies");
      requireDrainedReview(live, state, guard.reviewToken);
      if (await guard.references()) fail("referenced", "A locator still references this object");
      await readVerified(ref);
      // Mark the generation released while dropping the review: a re-put racing from here on
      // re-holds it, advancing the metageneration, so the fenced delete below refuses.
      const released = await driver.patch(live.name, fence(live), {
        temporaryHold: false, customTime: now().toISOString(), metadata: clearedHolds(live),
      });
      await driver.remove(released.name, fence(released));
    },

    lifecycle: () => driver.lifecycle(),
  };
}
