import { QueueClient } from "@vercel/queue";
import { connectMongo } from "../../src/db";
import { logger } from "../../src/logger";
import { acknowledgeWhenCredentialsRejected } from "../../src/queueConsumerFailure";
import { runLeadMessagingDrain } from "../../src/services/leadMessaging";

const queue = new QueueClient();

export default queue.handleNodeCallback(async () => {
  try {
    await connectMongo();
    const summary = await runLeadMessagingDrain("queue");
    logger.info({ msg: "lead_messaging.consumer.drained", ...summary });
  } catch (error) {
    if (acknowledgeWhenCredentialsRejected("lead_messaging", error)) return;
    logger.error({ err: error, msg: "lead_messaging.consumer.failed" });
    throw error;
  }
});
