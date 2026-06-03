import { promises as fs } from "node:fs";
import mongoose from "mongoose";
import { runRingCentralAnalyticsReconcile } from "../../api/services/ringcentral/analytics-reconcile.service";

/**
 * Manual, local trigger for the Analytics reconcile snapshot — the same code
 * the Vercel cron hits via `/api/cron/ringcentral-analytics-reconcile`.
 *
 * Analytics Aggregate is used for reconciliation only (grouped counters), not
 * for creating leads. This stores a snapshot of inbound answered calls >=120s
 * per company number for the owner to compare against produced leads.
 */
process.env.RC_TOKEN_STORE = process.env.RC_TOKEN_STORE ?? "file";

const ARTIFACT_PATH = "ringcentral-analytics-reconcile-output.json";

function parseHoursBack(args: string[]): number {
  const index = args.indexOf("--hours");
  if (index >= 0 && args[index + 1]) {
    const value = Number(args[index + 1]);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return 24;
}

async function main(): Promise<void> {
  const hoursBack = parseHoursBack(process.argv.slice(2));
  console.log(`RingCentral Analytics reconcile (manual run), hoursBack=${hoursBack}`);

  const summary = await runRingCentralAnalyticsReconcile({ hoursBack });

  console.log("Analytics snapshot summary");
  console.log(`  window: ${summary.windowFrom} -> ${summary.windowTo}`);
  console.log(`  company-number groups: ${summary.groupCount}`);
  console.log(`  total answered >=120s: ${summary.totalAnsweredOver120}`);

  await fs.writeFile(ARTIFACT_PATH, `${JSON.stringify(summary, null, 2)}\n`);
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
