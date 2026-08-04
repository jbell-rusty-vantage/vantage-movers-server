import { QueueClient } from "@vercel/queue";
import { logger } from "../../src/logger";
import { runBestRelocationIngestionWorker } from "../../src/services/ingestion";

const queue = new QueueClient();

export default queue.handleNodeCallback(async () => {
  const result = await runBestRelocationIngestionWorker();
  if (!result.claimed && result.status === "lease_busy") {
    // Reject so Vercel Queue retries after the active worker releases the
    // adapter-wide lease. Acknowledging here could strand durable queued work.
    throw new Error("Best Relocation ingestion apply lease is busy");
  }
  logger.info({
    msg: "best_relocation_ingestion.consumer.completed",
    ...result,
  });
});
