import { QueueClient } from "@vercel/queue";
import { connectMongo } from "../../src/db";
import { logger } from "../../src/logger";
import {
  drainRequestedReceipt,
  emitDrainRunEvent,
  parseReceiptWakeup,
  type DrainerDeps,
} from "../../src/services/granotLifecycle/drainer";

/**
 * Dedicated Vercel Queue consumer for Granot lifecycle wake-ups.
 *
 * Intentionally not mounted on the Express app. The payload is exactly
 * `{ receipt_id }`; Mongo remains the durable work source if this wake-up
 * is lost. Queue and cron overlap is resolved by the claim fence.
 */
const queue = new QueueClient();

export async function handleGranotLifecycleQueueMessage(
  payload: unknown,
  deps: DrainerDeps = {},
): Promise<void> {
  await connectMongo();
  const receiptId = await parseReceiptWakeup(payload);
  const summary = await drainRequestedReceipt(receiptId, "queue", deps);
  await emitDrainRunEvent(summary, false);
  logger.info({
    msg: "granot_lifecycle.consumer.drained",
    scanned: summary.scanned,
    claimed: summary.claimed,
    completed: summary.completed,
    retried: summary.retried,
    dead_lettered: summary.dead_lettered,
    recovered: summary.recovered,
    lease_lost: summary.lease_lost,
    skipped: summary.skipped,
  });
}

export default queue.handleNodeCallback(async (message) => {
  try {
    await handleGranotLifecycleQueueMessage(message);
  } catch (error) {
    logger.error({ err: error, msg: "granot_lifecycle.consumer.failed" });
    await emitDrainRunEvent(
      {
        trigger: "queue",
        skipped: false,
        scanned: 0,
        claimed: 0,
        completed: 0,
        retried: 0,
        dead_lettered: 0,
        recovered: 0,
        lease_lost: 0,
      },
      true,
    );
    throw error;
  }
});
