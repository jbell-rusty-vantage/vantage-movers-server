import { onRegistryCacheInvalidation } from "./cacheInvalidation";

export const GRANOT_LIFECYCLE_SOURCE_POLICY_CACHE_KEY =
  "granot_lifecycle_source_policy";
export const GRANOT_LIFECYCLE_SOURCE_LIST_CACHE_KEY =
  "granot_lifecycle_source_list";
export const GRANOT_LIFECYCLE_SOURCE_HEALTH_CACHE_KEY =
  "granot_lifecycle_source_health";

export const GRANOT_LIFECYCLE_SOURCE_CACHE_KEYS = [
  GRANOT_LIFECYCLE_SOURCE_POLICY_CACHE_KEY,
  GRANOT_LIFECYCLE_SOURCE_LIST_CACHE_KEY,
  GRANOT_LIFECYCLE_SOURCE_HEALTH_CACHE_KEY,
] as const;

type CacheEntry<T> = { value: T };

const detailCache = new Map<string, CacheEntry<unknown>>();
const listCache = new Map<string, CacheEntry<unknown>>();
const policyCache = new Map<string, CacheEntry<unknown>>();

let bound = false;

function bindInvalidation(): void {
  if (bound) {
    return;
  }
  bound = true;
  onRegistryCacheInvalidation((keys) => {
    if (keys.some((key) => (GRANOT_LIFECYCLE_SOURCE_CACHE_KEYS as readonly string[]).includes(key))) {
      clearGranotCrmSourceCaches();
    }
  });
}

export function clearGranotCrmSourceCaches(): void {
  detailCache.clear();
  listCache.clear();
  policyCache.clear();
}

export function resetGranotCrmSourceCachesForTests(): void {
  bound = false;
  clearGranotCrmSourceCaches();
  bindInvalidation();
}

export function readGranotCrmSourceDetailCache<T>(id: string): T | undefined {
  bindInvalidation();
  return detailCache.get(id)?.value as T | undefined;
}

export function writeGranotCrmSourceDetailCache<T>(id: string, value: T): void {
  bindInvalidation();
  detailCache.set(id, { value });
}

export function readGranotCrmSourceListCache<T>(key: string): T | undefined {
  bindInvalidation();
  return listCache.get(key)?.value as T | undefined;
}

export function writeGranotCrmSourceListCache<T>(key: string, value: T): void {
  bindInvalidation();
  listCache.set(key, { value });
}

export function readGranotSourcePolicyCache<T>(key: string): T | undefined {
  bindInvalidation();
  return policyCache.get(key)?.value as T | undefined;
}

export function writeGranotSourcePolicyCache<T>(key: string, value: T): void {
  bindInvalidation();
  policyCache.set(key, { value });
}
