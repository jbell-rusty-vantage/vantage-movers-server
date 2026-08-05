import { QueueClient } from "@vercel/queue";
import { logger } from "../../src/logger";
import { runGranotWorker } from "../../src/services/granotHttpCollector/runWorkflow";

const queue = new QueueClient();

export default queue.handleNodeCallback(async () => {
  const result = await runGranotWorker();
  if (!result.claimed && result.status === "lease_busy") {
    throw new Error("Granot automation account lease is busy");
  }
  logger.info({ msg: "granot_automation.consumer.completed", ...result });
});
