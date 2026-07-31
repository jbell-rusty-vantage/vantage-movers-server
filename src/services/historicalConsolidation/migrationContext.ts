import { AsyncLocalStorage } from "node:async_hooks";

export type HistoricalMigrationContext = {
  manifest_hash: string;
  apply_timestamp: Date;
  suppress_sheet_sync: true;
  suppress_crm: true;
  suppress_messages: true;
  suppress_notifications: true;
  suppress_observability: true;
  suppress_enrichment: true;
};

const storage = new AsyncLocalStorage<HistoricalMigrationContext>();
const capability = Symbol("historical-migration-capability");

export type HistoricalMigrationRunner = {
  run<T>(manifestHash: string, applyTimestamp: Date, callback: () => Promise<T>): Promise<T>;
};

export function createHistoricalMigrationRunner(scriptEntrypoint: string): HistoricalMigrationRunner {
  const normalized = scriptEntrypoint.replaceAll("\\", "/");
  if (!normalized.includes("/scripts/historical_production_db_staged_merge_ingestion/")) {
    throw new Error("Historical migration context is restricted to the canonical local command adapters");
  }
  const token = capability;
  return {
    async run<T>(manifestHash: string, applyTimestamp: Date, callback: () => Promise<T>): Promise<T> {
      if (token !== capability) throw new Error("Invalid migration capability");
      return storage.run({
        manifest_hash: manifestHash,
        apply_timestamp: applyTimestamp,
        suppress_sheet_sync: true,
        suppress_crm: true,
        suppress_messages: true,
        suppress_notifications: true,
        suppress_observability: true,
        suppress_enrichment: true,
      }, callback);
    },
  };
}

export function requireHistoricalMigrationContext(): HistoricalMigrationContext {
  const context = storage.getStore();
  if (!context) throw new Error("Exact historical operation attempted without migration context");
  return context;
}
