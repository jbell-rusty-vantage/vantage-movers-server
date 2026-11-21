import { createHash } from "node:crypto";

/**
 * Provider-neutral object storage contract. One `ObjectStore` handle is scoped to one bucket and
 * one prefix, so a caller can only touch its own namespace. Every write is create-only and is
 * read back before it returns. Every destructive or expiring step names an exact generation and
 * the SHA-256 the caller recorded, and refuses while a hold or a locator still protects the object.
 *
 * Service doc: docs/knowledge/services/cloud-storage.md.
 */
export interface ObjectStore {
  readonly bucket: string;
  readonly prefix: string;
  /**
   * Create-only write (generation zero precondition), then a pinned read-back that must return the
   * same length and SHA-256. Writing identical bytes to an existing name is idempotent and returns
   * the existing generation with `created: false`, after applying the store's reuse policy.
   */
  put(input: PutInput): Promise<StoredObject>;
  /** Downloads the pinned generation and fails with `verification_failed` unless length and SHA-256 match. */
  readVerified(ref: VerifiedRef): Promise<Buffer>;
  /** Current state of the live generation, or of one exact generation. `null` when absent. */
  stat(name: string, generation?: string): Promise<ObjectState | null>;
  /** One page of live objects under `prefix`, which must lie inside the store prefix. */
  list(query: ListQuery): Promise<ListPage>;
  /**
   * Adds a named hold to an exact generation. A hold blocks lifecycle expiry, `startRecoveryClock`
   * and `deleteIfGeneration`. Refuses when a hold the store cannot attribute is present, or when the
   * same holder already holds the object under a different token.
   */
  hold(ref: GenerationRef, request: HoldRequest): Promise<ObjectState>;
  /** Drops one named hold. Idempotent. The provider hold stays on while any other named hold remains. */
  release(ref: GenerationRef, holder: string, token?: string): Promise<ObjectState>;
  /**
   * Conditional expiry: stamps the recovery-clock marker on an exact, verified generation, after
   * which the bucket lifecycle deletes it once the recovery window has passed. Refuses while a
   * locator still points at the object, while any hold other than `guard.requireHold` is active,
   * and while the required hold has not been held for `heldForMs`. Idempotent once started.
   */
  startRecoveryClock(ref: VerifiedRef & { generation: string }, guard: RecoveryGuard): Promise<ObjectState>;
  /**
   * Immediate delete of an exact generation. Refuses unless the generation is live, unheld, unreferenced
   * and its bytes still verify. Uses generation and metageneration preconditions.
   */
  deleteIfGeneration(ref: VerifiedRef & { generation: string }, guard: ReferenceGuard): Promise<void>;
  /** Bucket lifecycle rules, read-only. The module never writes lifecycle configuration. */
  lifecycle(): Promise<LifecycleRule[]>;
}

export type PutInput = {
  name: string;
  bytes: Buffer;
  contentType: string;
  /** Starts the recovery clock at creation. Only for objects that are disposable from birth (a sealed catalog). */
  customTime?: Date;
  metadata?: Record<string, string>;
};

export type StoredObject = {
  name: string;
  generation: string;
  sha256: string;
  size: number;
  /** `false` when an object with these exact bytes already existed. */
  created: boolean;
  /** The bytes as read back from the pinned generation. Decode these, never the input. */
  persisted: Buffer;
};

export type GenerationRef = { name: string; generation: string };
/**
 * A locator as recorded in MongoDB. `generation` is optional only for legacy locators written
 * before generations were recorded: the read then uses the live generation and still verifies SHA-256.
 */
export type VerifiedRef = { name: string; generation?: string; sha256: string; size?: number };

export type ObjectState = {
  name: string;
  generation: string;
  metageneration: string;
  size: number;
  contentType?: string;
  /** Recovery-clock marker (GCS `customTime`). Once set it cannot be cleared, only re-held. */
  recoveryClockStartedAt?: string;
  /** Named holds currently active, by holder name, with their tokens. */
  holds: Record<string, string>;
  /** A provider hold the store cannot attribute to a named holder. */
  independentHold: boolean;
  /** Provider retention the module never sets (event-based hold, object retention). */
  retentionLocked: boolean;
  metadata: Record<string, string>;
  updated: string;
};

export type ListQuery = { prefix: string; pageToken?: string; maxResults?: number };
export type ListPage = { items: ObjectState[]; nextPageToken?: string };

export type HoldRequest = {
  holder: string;
  /** Stored as the hold value. Defaults to "1". */
  token?: string;
  /** Holders this hold replaces in the same compare-and-swap (a release review replaces the publisher hold). */
  replaces?: string[];
  /** Extra metadata written in the same compare-and-swap (for example review evidence). */
  metadata?: Record<string, string>;
};

/** Returns true while any MongoDB locator still points at the object. Called immediately before the change. */
export type ReferenceCheck = () => Promise<boolean>;
export type ReferenceGuard = { references: ReferenceCheck };
export type RecoveryGuard = ReferenceGuard & {
  /** A review hold that must be active with this token for at least `heldForMs` (the publication drain window). */
  requireHold?: { holder: string; token: string; heldForMs?: number };
};

export type LifecycleRule = {
  action: { type: string; storageClass?: string };
  condition: {
    age?: number;
    daysSinceCustomTime?: number;
    matchesPrefix?: string[];
    [key: string]: unknown;
  };
};

/**
 * How `put` treats an existing generation of the same name:
 * - `rehold`: a released or under-review generation is protected again by `holder` (cancelling
 *   `cancels`) before it acquires a new reader. A released generation under a hold the store
 *   cannot attribute is refused. This is the Granot history rule.
 * - `refuse_released`: a generation whose recovery clock has started is refused. This is the
 *   Sales Intelligence rollback-pack rule.
 */
export type ReusePolicy =
  | { mode: "rehold"; holder: string; cancels: string[] }
  | { mode: "refuse_released" };

export type CloudStorageErrorCode =
  | "invalid_name"
  | "invalid_configuration"
  | "not_found"
  | "generation_mismatch"
  | "verification_failed"
  | "held"
  | "independent_hold"
  | "referenced"
  | "hold_not_drained"
  | "released";

export class CloudStorageError extends Error {
  readonly code: CloudStorageErrorCode;
  constructor(code: CloudStorageErrorCode, message: string) {
    super(message);
    this.name = "CloudStorageError";
    this.code = code;
  }
}

export const isCloudStorageError = (error: unknown, code?: CloudStorageErrorCode): error is CloudStorageError =>
  error instanceof CloudStorageError && (code === undefined || error.code === code);

export const sha256Hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
