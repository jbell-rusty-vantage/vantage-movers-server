import { QueueClient } from "@vercel/queue";
import { connectMongo } from "../../src/db";
import { logger } from "../../src/logger";
import { runSheetSyncDrain } from "../../src/services/sheetSync";

/**
 * Vercel Queue consumer for the sheet-sync wake-up topic.
 *
 * This is a DEDICATED Vercel function, intentionally NOT mounted on the Express
 * app. The app is served as a single function via the `"/(.*)" -> "/api"`
 * rewrite, and a `queue/v2beta` trigger makes its route private; mixing the two
 * would shadow the consumer. The trigger binding lives in `vercel.json`
 * (`functions["api/queues/sheet-sync-consumer.ts"].experimentalTriggers`).
 *
 * The wake-up payload is intentionally ignored: MongoDB owns all
 * due/coalesce/priority/quota decisions, so the consumer simply drains the
 * outbox. The drainer's global lease guarantees only one drain runs at a time,
 * so overlapping wake-ups and the cron safety net never contend for quota.
 */
const queue = new QueueClient();

export default queue.handleNodeCallback(async () => {
  await connectMongo();
  const summary = await runSheetSyncDrain("queue");
  logger.info({ msg: "sheet_sync.consumer.drained", ...summary });
});
