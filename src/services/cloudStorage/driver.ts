import type { LifecycleRule } from "./contract";

/**
 * The thin provider boundary under `ObjectStore`. A driver translates one primitive into one
 * provider request and nothing more: no hashing, no hold policy, no reference checks. The GCS
 * driver and the in-memory fake bucket both implement it, so every rule in `objectStore.ts` runs
 * identically against both.
 */
export interface BucketDriver {
  readonly bucket: string;
  /** Create-only (generation zero precondition). Returns `exists` when the name already has a live generation. */
  insert(name: string, bytes: Buffer, options: InsertOptions): Promise<{ generation: string } | "exists">;
  /** Metadata of the live generation, or of one exact generation. `null` when absent. */
  stat(name: string, generation?: string): Promise<RawObject | null>;
  /** Bytes of the live generation, or of one exact generation. Throws `not_found`. */
  download(name: string, generation?: string): Promise<Buffer>;
  /** Compare-and-swap on generation and metageneration. Throws `generation_mismatch` on a lost race. */
  patch(name: string, fence: Fence, changes: MetadataPatch): Promise<RawObject>;
  /** Compare-and-swap delete. Throws `generation_mismatch` on a lost race and `not_found` when absent. */
  remove(name: string, fence: Fence): Promise<void>;
  list(prefix: string, pageToken?: string, maxResults?: number): Promise<{ items: RawObject[]; nextPageToken?: string }>;
  lifecycle(): Promise<LifecycleRule[]>;
}

export type InsertOptions = { contentType: string; customTime?: string; metadata?: Record<string, string> };
export type Fence = { generation: string; metageneration: string };
export type MetadataPatch = { temporaryHold?: boolean; customTime?: string; metadata?: Record<string, string> };

/** Provider object state in GCS JSON API terms; generations are decimal strings. */
export type RawObject = {
  name: string;
  generation: string;
  metageneration: string;
  size: number;
  contentType?: string;
  customTime?: string;
  temporaryHold: boolean;
  eventBasedHold: boolean;
  retainUntil?: string;
  metadata: Record<string, string>;
  updated: string;
};
