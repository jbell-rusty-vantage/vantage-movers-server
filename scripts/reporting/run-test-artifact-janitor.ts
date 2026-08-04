/**
 * Manual or scheduled janitor for abandoned live-test Google artifacts.
 */
import process from "node:process";
import { connectMongo } from "../../src/db";
import { runTestArtifactJanitor } from "../../src/services/reporting/live/testArtifactJanitor";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  await connectMongo().catch(() => undefined);
  const result = await runTestArtifactJanitor({ dryRun, limit: 50 });
  console.log(JSON.stringify(result.evidence, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
