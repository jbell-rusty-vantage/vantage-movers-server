import { QueueClient } from "@vercel/queue";
import { connectMongo } from "../../src/db";
import { logger } from "../../src/logger";
import {
  dispatchCsiWakeup,
  type DispatchDependencies,
  type DispatchOutcome,
} from "../../src/services/numberActivity/jobDispatch";

/**
 * Dedicated Vercel Queue consumer for Sales Intelligence durable-job wake-ups
 * (03 §11, §14). Registered in `vercel.json` under topic
 * `sales-intelligence-events*`; a handler file alone is not registration.
 *
 * Intentionally not mounted on the Express app. The payload is exactly
 * `{ job_id }`; stage/routing come from the Mongo job row. Cron recovery
 * (`/api/cron/sales-intelligence-job-recovery`) claims the same jobs, so a
 * lost wake-up loses nothing and duplicate delivery hits the claim fence.
 */
const queue = new QueueClient();

export async function handleSalesIntelligenceQueueMessage(
  payload: unknown,
  deps: DispatchDependencies = {},
): Promise<DispatchOutcome> {
  await connectMongo();
  const outcome = await dispatchCsiWakeup(payload, deps);
  logger.info({
    msg: "sales_intelligence.consumer.handled",
    status: outcome.status,
    stage: "stage" in outcome ? outcome.stage : null,
    jobId: "job_id" in outcome ? outcome.job_id : null,
  });
  return outcome;
}

export default queue.handleNodeCallback(async (message) => {
  try {
    await handleSalesIntelligenceQueueMessage(message);
  } catch (error) {
    logger.error({
      msg: "sales_intelligence.consumer.failed",
      errorName: error instanceof Error ? error.name : "Error",
    });
    throw error;
  }
});
