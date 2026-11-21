/**
 * Cloud Storage service: one contract for every object-storage interaction.
 * Service doc: docs/knowledge/services/cloud-storage.md. No caller uses it yet; each existing
 * caller migrates in its own PR with byte-identical objects and unchanged locators.
 */
export * from "./contract";
export {
  CLOUD_STORAGE_CONTROL_COLLECTION,
  CLOUD_STORAGE_NAMESPACES,
  CONTENT_TYPES,
  GRANOT_RELEASE_EVIDENCE_KEY,
  checkRecoveryPolicy,
  granotHistoryObjectName,
  openObjectStore,
  readCloudStorageConfig,
  salesIntelligencePackObjectName,
  storeForNamespace,
  type CloudStorageNamespace,
  type ResolvedNamespace,
} from "./namespaces";
export { createObjectStore, type ObjectStoreOptions } from "./objectStore";
export { createFakeBucket, createFakeObjectStore, type FakeBucket } from "./fakeBucket";
