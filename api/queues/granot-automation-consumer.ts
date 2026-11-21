import { QueueClient } from "@vercel/queue";
import { logger } from "../../src/logger";
import { acknowledgeWhenCredentialsRejected } from "../../src/queueConsumerFailure";
import {
  continueGranotRuns,
  runGranotWorker,
} from "../../src/services/granotHttpCollector/runWorkflow";

const queue = new QueueClient();

async function consumeGranotAutomationWakeup(): Promise<void> {
  const result = await runGranotWorker();
  if (!result.claimed && result.status === "lease_busy") {
    // Another callback owns the account-wide Granot session. It will publish
    // a continuation after its run, so this duplicate wake-up is safe to ACK.
    logger.info({ msg: "granot_automation.consumer.deferred", ...result });
    return;
  }
  const continuation = result.claimed && result.run_id
    ? await continueGranotRuns(result.run_id)
    : { recoverable: false, queue_published: false };
  if (continuation.recoverable && !continuation.queue_published) {
    throw new Error("Granot automation continuation could not be queued");
  }
  logger.info({
    msg: "granot_automation.consumer.completed",
    ...result,
    continuation,
  });
}

export default queue.handleNodeCallback(async () => {
  try {
    await consumeGranotAutomationWakeup();
  } catch (error) {
    if (acknowledgeWhenCredentialsRejected("granot_automation", error)) return;
    throw error;
  }
});
