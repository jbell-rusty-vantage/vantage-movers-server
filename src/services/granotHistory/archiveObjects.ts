import {
  CLOUD_STORAGE_NAMESPACES,
  CONTENT_TYPES,
  granotHistoryObjectName,
  sha256Hex,
  storeForNamespace,
  type ObjectStore,
  type ResolvedNamespace,
} from "../cloudStorage";
import { isVantageTestRunner } from "../../config/domain/runtime";

/** The Granot history store. The defaults are production: bucket and prefix cannot move (cloud-storage.md). */
const GRANOT_HISTORY: ResolvedNamespace = { ...CLOUD_STORAGE_NAMESPACES["granot-history"], namespace: "granot-history", source: "default" };
let production: ObjectStore | undefined;
const granotHistoryStore = () => (production ??= storeForNamespace(GRANOT_HISTORY));

/** Replica tests only: route the default Granot archive seam to a fake-bucket store. Refused outside the test runner. */
export function useGranotArchiveStoreForTests(store: ObjectStore | undefined) {
  if (!isVantageTestRunner()) throw new Error("Granot archive store override is test-only");
  production = store;
}

export type ArchiveRead = (database: string, hash: string, generation?: string) => Promise<Buffer>;
export type ArchiveStore = (database: string, bytes: Buffer) => Promise<{ hash: string; persisted: Buffer; generation: string }>;
export type ArchiveStorage = { store: ArchiveStore; read: ArchiveRead };

/**
 * The Granot archive seam over one `ObjectStore`. Object names, bytes, content type and hold
 * metadata are byte-identical to the writer this replaced: content addressing plus generation zero
 * make retries safe, a reused generation under review or release is re-held before it gains a
 * reader, and every read is pinned to the recorded generation and verified against its SHA-256.
 * Tests pass a fake-bucket store; production uses the Granot history namespace.
 */
export function granotArchiveStorage(store: ObjectStore): ArchiveStorage {
  const name = (database: string, hash: string) => granotHistoryObjectName(store.prefix, database, hash);
  return {
    read: (database, hash, generation) => store.readVerified({ name: name(database, hash), generation, sha256: hash }),
    async store(database, bytes) {
      const stored = await store.put({ name: name(database, sha256Hex(bytes)), bytes, contentType: CONTENT_TYPES.granotHistory });
      return { hash: stored.sha256, persisted: stored.persisted, generation: stored.generation };
    },
  };
}

export const readArchiveObject: ArchiveRead = (database, hash, generation) =>
  granotArchiveStorage(granotHistoryStore()).read(database, hash, generation);

/** Content addressing and generation zero make retries safe. The returned bytes were read back and verified. */
export const storeArchiveObject: ArchiveStore = (database, bytes) =>
  granotArchiveStorage(granotHistoryStore()).store(database, bytes);
