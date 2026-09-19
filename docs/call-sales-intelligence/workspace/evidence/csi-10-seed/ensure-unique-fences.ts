import mongoose from "mongoose";
import { connectMongo } from "../../../../../src/db";
import { getMongoDatabaseName, isTestMode } from "../../../../../src/config/domain/runtime";

/** Unique fences required for directory snapshot + propose + review. Not the full CSI catalog. */
const FENCES = [
  { collection: "ringcentral_directory_snapshots", name: "csi_directory_digest_unique", key: { provider_account_id: 1, digest: 1 }, unique: true },
  { collection: "sales_intelligence_sync_state", name: "sales_intelligence_sync_state_scope_unique", key: { scope: 1 }, unique: true },
  { collection: "rep_identity_links", name: "ril_extension_current_unique", key: { rc_account_id: 1, rc_extension_id: 1 }, unique: true, partialFilterExpression: { effective_to: null } },
  { collection: "sales_intelligence_command_executions", name: "csi_command_idempotency_unique", key: { actor_scope: 1, idempotency_key: 1 }, unique: true },
  { collection: "sales_intelligence_jobs", name: "csi_job_dedupe_unique", key: { dedupe_key: 1 }, unique: true },
  { collection: "sales_intelligence_audit_events", name: "csi_audit_semantic_unique", key: { semantic_key: 1 }, unique: true },
] as const;

async function main() {
  if (isTestMode()) throw new Error("refusing TEST_MODE");
  await connectMongo();
  const database = getMongoDatabaseName();
  if (database !== "vantagemovers") throw new Error(`refusing database ${database}`);
  const db = mongoose.connection.useDb(database, { useCache: true }).db;
  if (!db) throw new Error("Mongo unavailable");
  const results = [];
  for (const spec of FENCES) {
    const created = await db.collection(spec.collection).createIndex(spec.key, {
      name: spec.name,
      unique: spec.unique,
      ...("partialFilterExpression" in spec ? { partialFilterExpression: spec.partialFilterExpression } : {}),
    });
    results.push({ collection: spec.collection, name: spec.name, created });
  }
  console.log(JSON.stringify({ database, ready: true, fences: results }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "fence failed");
  process.exitCode = 1;
}).finally(() => mongoose.disconnect());
