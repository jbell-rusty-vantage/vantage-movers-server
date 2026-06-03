import { promises as fs } from "node:fs";
import mongoose from "mongoose";
import { getRingCentralRuntimeConfig } from "../../api/services/ringcentral/ringcentral-config";
import { runRingCentralCallLogSync } from "../../api/services/ringcentral/call-log-sync.service";

/**
 * Manual, local trigger for the Call Log cron sync — the same code path Vercel
 * Cron will hit in production via `/api/cron/ringcentral-call-log-sync`.
 *
 * Use this to validate the cron strategy end-to-end against real RingCentral
 * Call Log data without deploying. It honors all the same env flags, so with
 * `RINGCENTRAL_CREATE_CALL_LEADS=false` it is a safe dry-run that only writes
 * to `ringcentral_processed_calls(_test)` and the sync-state cursor.
 *
 * Uses the file token cache (like the other scripts) and writes a sanitized
 * artifact for review.
 */
process.env.RC_TOKEN_STORE = process.env.RC_TOKEN_STORE ?? "file";

const ARTIFACT_PATH = "ringcentral-call-log-sync-output.json";

async function main(): Promise<void> {
  const config = getRingCentralRuntimeConfig();
  console.log("RingCentral Call Log sync (manual run)");
  console.log(`Hybrid mode: ${config.hybridMode}`);
  console.log(`Lead write mode: createCallLeads=${config.createCallLeads} shadow=${config.shadowCallLeads}`);
  console.log(`Collection mode: ${config.collectionMode}`);
  console.log(
    `Lookback: ${config.callLogSyncLookbackMinutes}m | overlap: ${config.callLogSyncOverlapMinutes}m`,
  );
  console.log("");

  if (!config.callLogSyncEnabled) {
    console.log(
      "WARNING: RINGCENTRAL_CALL_LOG_SYNC_ENABLED is not true. Running anyway for local testing; " +
        "in production the cron route would return skipped.",
    );
    console.log("");
  }

  const summary = await runRingCentralCallLogSync();

  console.log("Sync summary");
  console.log(`  window: ${summary.windowFrom} -> ${summary.windowTo}`);
  console.log(`  fetched records: ${summary.fetchedRecords}`);
  console.log(`  candidate records (matched target number): ${summary.candidateRecords}`);
  console.log(`  qualified records: ${summary.qualifiedRecords}`);
  console.log(`  leads created/flagged: ${summary.leadsCreated}`);
  console.log(`  duplicates flagged: ${summary.duplicatesFlagged}`);
  console.log(`  ingest actions: ${JSON.stringify(summary.ingestActions)}`);

  await fs.writeFile(
    ARTIFACT_PATH,
    `${JSON.stringify({ config, summary }, null, 2)}\n`,
  );
  console.log("");
  console.log(`Wrote ${ARTIFACT_PATH}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });
