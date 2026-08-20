import { createHash } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import { getMongoDatabaseName, isTestMode } from "../../src/config/domain/runtime.js";
import { connectMongo } from "../../src/db.js";
import { getGranotLifecycleActivationModel } from "../../src/models/GranotLifecycleActivation.js";
import { GRANOT_OBSERVATION_RECEIPT_COLLECTION } from "../../src/models/GranotObservationReceipt.js";
import { getSynchronizationDecisionModel } from "../../src/models/SynchronizationDecision.js";
import { granotObservationProcessor } from "../../src/services/granotLifecycle/processor.js";
import {
  GRANOT_LIFECYCLE_PRODUCTION_DATABASE,
  GRANOT_LIFECYCLE_TEST_DATABASE,
  assertGranotLifecycleDatabaseAllowed,
  granotLifecycleOutputDirectory,
} from "./granot-lifecycle-migration.lib.js";
import {
  fileCheckpointStore,
  parseShadowCliOptions,
  runHistoricalShadowCertification,
  stableHash,
  type ForbiddenCollectionSnapshot,
} from "./granot-lifecycle-shadow.lib.js";

const OUTPUT_DIR = granotLifecycleOutputDirectory("granot-lifecycle-shadow");
const CHECKPOINT_PATH = path.join(OUTPUT_DIR, "checkpoint.json");
const FORBIDDEN_COLLECTIONS = [
  "form_leads", "call_leads", "booked_leads", "cancelled_leads",
  "granot_booking_reconciliation_cases", "granot_release_reconciliation_cases",
  "granot_booking_discrepancies", "granot_release_discrepancies",
  "domain_command_executions", "entity_changes", "sheet_sync_jobs",
  "notification_deliveries",
] as const;

function assertPreconnectSafety(databaseName: string, confirmation?: string): void {
  assertGranotLifecycleDatabaseAllowed(databaseName);
  if (databaseName === GRANOT_LIFECYCLE_TEST_DATABASE && !isTestMode()) {
    throw new Error("Refusing test database shadow run unless TEST_MODE=true.");
  }
  if (databaseName === GRANOT_LIFECYCLE_PRODUCTION_DATABASE && confirmation !== databaseName) {
    throw new Error(`Refusing production shadow run without --confirm-production=${databaseName}.`);
  }
}

async function assertReplicaAndExternalIsolation(): Promise<void> {
  const hello = await mongoose.connection.db?.admin().command({ hello: 1 });
  if (!hello?.setName) throw new Error("Historical shadow requires a Mongo replica set.");
  if (process.env.SHEET_SYNC_MODE !== "disabled") throw new Error("Historical shadow requires SHEET_SYNC_MODE=disabled.");
}

async function snapshotForbiddenCollections(): Promise<ForbiddenCollectionSnapshot> {
  const db = mongoose.connection.db;
  if (!db) throw new Error("Mongo database is unavailable.");
  const result: ForbiddenCollectionSnapshot = {};
  for (const name of FORBIDDEN_COLLECTIONS) {
    const rows = await db.collection(name).find({}, { projection: { _id: 1, domain_revision: 1, updatedAt: 1 } }).sort({ _id: 1 }).toArray();
    result[name] = {
      count: rows.length,
      state_hash: stableHash(rows.map((row) => ({ id: String(row._id), revision: row.domain_revision ?? null, updated_at: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : null }))),
    };
  }
  return result;
}

async function activationFingerprint(): Promise<string> {
  const row = await getGranotLifecycleActivationModel().findOne({ key: "granot_lifecycle" }).select({ _id: 1, activated_at: 1, processor_version: 1 }).lean();
  return stableHash(row ? { id: String(row._id), activated_at: row.activated_at.toISOString(), processor_version: row.processor_version } : null);
}

async function main(): Promise<void> {
  const options = parseShadowCliOptions(process.argv.slice(2));
  const configuredDatabase = getMongoDatabaseName();
  assertPreconnectSafety(configuredDatabase, options.confirm_production);
  await connectMongo();
  const connectedDatabase = mongoose.connection.db?.databaseName;
  if (connectedDatabase !== configuredDatabase) throw new Error("Connected database does not match the preflight database.");
  assertGranotLifecycleDatabaseAllowed(connectedDatabase);
  await assertReplicaAndExternalIsolation();
  const environmentFingerprint = createHash("sha256").update(`unit31:${connectedDatabase}:replica:sheet-disabled`).digest("hex").slice(0, 16);
  const checkpoint = fileCheckpointStore(CHECKPOINT_PATH);
  const activation = await getGranotLifecycleActivationModel().findOne({ key: "granot_lifecycle" }).select({ activated_at: 1 }).lean();
  const cutoff = activation?.activated_at ?? null;
  const db = mongoose.connection.db!;
  const report = await runHistoricalShadowCertification({
    options,
    deps: {
      environmentFingerprint,
      activationFingerprint,
      loadCheckpoint: checkpoint.load,
      saveCheckpoint: checkpoint.save,
      async listReceipts({ afterId, limit }) {
        const historicalFilter = cutoff ? { captured_at: { $lt: cutoff } } : {};
        const afterFilter = afterId ? { _id: { $gt: new mongoose.Types.ObjectId(afterId) } } : {};
        const documents = await db.collection(GRANOT_OBSERVATION_RECEIPT_COLLECTION).find({ ...historicalFilter, ...afterFilter }, { projection: { _id: 1, captured_at: 1, route_event_class: 1 } }).sort({ _id: 1 }).limit(limit).toArray();
        const excludedPostCutoffCount = cutoff ? await db.collection(GRANOT_OBSERVATION_RECEIPT_COLLECTION).countDocuments({ captured_at: { $gte: cutoff }, ...afterFilter }) : 0;
        return { receipts: documents.map((row) => ({ id: String(row._id), captured_at: row.captured_at as Date, event_class: String(row.route_event_class ?? "none") })), excludedPostCutoffCount };
      },
      snapshotForbiddenCollections,
      processReceipt: (receiptId) => granotObservationProcessor.process({ receipt_id: receiptId }),
      async loadDecision(decisionId) {
        const decision = await getSynchronizationDecisionModel().findById(decisionId).select({ execution_mode: 1, outcome: 1, reason_code: 1, match_method: 1, "source_scope.granot_crm_source_id": 1, "source_policy.granot_crm_source_id": 1, effects: 1 }).lean();
        if (!decision) return null;
        const sourceId = decision.source_scope?.granot_crm_source_id ?? decision.source_policy?.granot_crm_source_id;
        const rawSourceId = sourceId ? String(sourceId) : "";
        return {
          decision_id: String(decision._id), execution_mode: decision.execution_mode, outcome: decision.outcome,
          reason_code: decision.reason_code, match_method: decision.match_method ?? "none",
          source_ref: rawSourceId ? `source:${rawSourceId.slice(0, 4)}…${rawSourceId.slice(-4)}` : "none",
          effect_kinds: decision.effects.map((effect) => effect.kind),
        };
      },
    },
  });
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(path.join(OUTPUT_DIR, "latest-report.json"), `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  console.log(JSON.stringify({ passed: report.passed, selected_count: report.selection.selected_count, excluded_post_cutoff_count: report.selection.excluded_post_cutoff_count, masked_sample_ids: report.masked_sample_ids, environment_fingerprint: report.environment_fingerprint, report_hash: stableHash(report) }));
  if (!report.passed) process.exitCode = 1;
}

main().catch(() => { console.error("Historical shadow failed with a bounded technical error."); process.exitCode = 1; }).finally(async () => { await mongoose.disconnect().catch(() => undefined); });
