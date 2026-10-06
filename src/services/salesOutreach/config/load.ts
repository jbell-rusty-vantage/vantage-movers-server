import type { ClientSession } from "mongoose";
import {
  salesOutreachConfigurationValueSchema,
  type SalesOutreachConfigurationValue,
} from "../../../validation/v1/salesOutreach";
import { OutreachError } from "../errors";
import {
  configurationContentHash,
  mongoConfigurationStore,
  type ConfigurationPointer,
  type ConfigurationStore,
} from "./store";

/**
 * Configuration load semantics (CONTRACTS "Load semantics"):
 * - the active pointer is read from the primary on every request and every job/batch admission;
 *   there is no pointer TTL and no env fallback, so every instance sees a committed PATCH on its
 *   next read without a restart;
 * - only immutable versions are cached, keyed by version + content hash;
 * - no pointer ⇒ `uninitialized` (all desk features off), with no initialization side effect;
 * - the content hash is verified against the stored value as written (or, legacy, as re-parsed),
 *   so adding an optional key to the schema never invalidates a stored version (olr A0);
 * - a dangling pointer, a hash mismatch or a value the strict schema rejects ⇒ `unavailable`;
 *   desk reads/writes then fail closed with `CONFIGURATION_UNAVAILABLE`;
 * - a database failure propagates (no cached value is ever served as fresh).
 */
export type ActiveConfiguration = Readonly<{
  state: "active";
  version: string;
  revision: number;
  content_hash: string;
  approval_ref: string | null;
  value: SalesOutreachConfigurationValue;
  updated_at: Date | null;
  updated_by: string | null;
}>;

export type ConfigurationInspection =
  | Readonly<{ state: "uninitialized" }>
  | ActiveConfiguration
  | Readonly<{
      state: "unavailable";
      reason: "dangling_version" | "hash_mismatch" | "invalid_value";
      version: string;
      revision: number;
      updated_at: Date | null;
      updated_by: string | null;
    }>;

export type ConfigurationLoader = {
  /** Never throws for a broken configuration; reports it (the Owner settings/recovery path uses this). */
  inspect(session?: ClientSession): Promise<ConfigurationInspection>;
  /** `uninitialized` or the active configuration; throws `CONFIGURATION_UNAVAILABLE` when broken. */
  load(session?: ClientSession): Promise<Readonly<{ state: "uninitialized" }> | ActiveConfiguration>;
  /** The active configuration or `CONFIGURATION_UNAVAILABLE` (uninitialized included): for desk writes and job admission. */
  requireActive(session?: ClientSession): Promise<ActiveConfiguration>;
};

type CachedVersion = { value: SalesOutreachConfigurationValue; approval_ref: string | null };

/**
 * Integrity check of a stored version (olr A0). The hash is verified against the value **as
 * written** (every version is stored as its parsed value, `config/commands.ts`), so a schema
 * addition that changes the parsed form of an old version cannot turn it into `hash_mismatch`.
 * The legacy check (hash of the value re-parsed by the current schema) stays accepted. A stored
 * value edited out of band fails both, and the version row must agree with the pointer.
 */
function storedContentMatches(raw: unknown, parsed: SalesOutreachConfigurationValue, versionHash: string, pointerHash: string): boolean {
  if (versionHash !== pointerHash) return false;
  if (rawContentHash(raw) === versionHash) return true;
  return configurationContentHash(parsed) === versionHash;
}

/** Content hash of the raw stored value; `null` when it holds something canonical JSON cannot encode. */
function rawContentHash(raw: unknown): string | null {
  try {
    return configurationContentHash(raw as SalesOutreachConfigurationValue);
  } catch {
    return null;
  }
}

export function createConfigurationLoader(store: ConfigurationStore = mongoConfigurationStore, maxCachedVersions = 16): ConfigurationLoader {
  const cache = new Map<string, CachedVersion>();
  const unavailable = (pointer: ConfigurationPointer, reason: "dangling_version" | "hash_mismatch" | "invalid_value") =>
    ({
      state: "unavailable",
      reason,
      version: pointer.version,
      revision: pointer.revision,
      updated_at: pointer.updated_at,
      updated_by: pointer.updated_by,
    }) as const;

  async function inspect(session?: ClientSession): Promise<ConfigurationInspection> {
    const pointer = await store.readPointer(session);
    if (!pointer) return { state: "uninitialized" };
    const cacheKey = `${pointer.version}\n${pointer.content_hash}`;
    let cached = cache.get(cacheKey);
    if (!cached) {
      const row = await store.readVersion(pointer.version, session);
      if (!row) return unavailable(pointer, "dangling_version");
      const parsed = salesOutreachConfigurationValueSchema.safeParse(row.value);
      if (!parsed.success) return unavailable(pointer, "invalid_value");
      if (!storedContentMatches(row.value, parsed.data, row.content_hash, pointer.content_hash))
        return unavailable(pointer, "hash_mismatch");
      cached = { value: parsed.data, approval_ref: row.approval_ref };
      if (cache.size >= maxCachedVersions) cache.delete(cache.keys().next().value!);
      cache.set(cacheKey, cached);
    }
    return {
      state: "active",
      version: pointer.version,
      revision: pointer.revision,
      content_hash: pointer.content_hash,
      approval_ref: cached.approval_ref,
      value: cached.value,
      updated_at: pointer.updated_at,
      updated_by: pointer.updated_by,
    };
  }

  async function load(session?: ClientSession) {
    const inspected = await inspect(session);
    if (inspected.state === "unavailable") throw new OutreachError("CONFIGURATION_UNAVAILABLE");
    return inspected;
  }

  return {
    inspect,
    load,
    async requireActive(session) {
      const loaded = await load(session);
      if (loaded.state !== "active") throw new OutreachError("CONFIGURATION_UNAVAILABLE");
      return loaded;
    },
  };
}

/** Process-wide loader; its cache holds immutable versions only. */
export const salesOutreachConfigurationLoader = createConfigurationLoader();
