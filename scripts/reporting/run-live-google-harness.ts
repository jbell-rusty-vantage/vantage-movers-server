/**
 * Protected live Google integration harness (WP4.8).
 *
 * Requires dedicated test OAuth user, export root, and Mongo connection.
 * Rejects service-account credentials. Skips with a clear exit code when
 * prerequisites are absent.
 */
import process from "node:process";
import { connectMongo } from "../../src/db";
import {
  formatHarnessEvidenceForLog,
  runLiveGoogleHarness,
} from "../../src/services/reporting/live/liveGoogleHarness";

async function main(): Promise<void> {
  await connectMongo().catch(() => undefined);
  const result = await runLiveGoogleHarness();
  console.log(formatHarnessEvidenceForLog(result.evidence));

  if (result.skipped) {
    console.error(`SKIPPED: ${result.skipReason ?? "prerequisites missing"}`);
    process.exitCode = 2;
    return;
  }

  if (!result.ok) {
    console.error("FAILED: live Google harness reported failures.");
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
