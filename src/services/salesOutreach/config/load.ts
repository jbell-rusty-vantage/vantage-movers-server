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
      const hash = configurationContentHash(parsed.data);
      if (hash !== row.content_hash || hash !== pointer.content_hash) return unavailable(pointer, "hash_mismatch");
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
