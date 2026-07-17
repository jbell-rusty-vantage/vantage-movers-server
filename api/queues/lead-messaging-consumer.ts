import { QueueClient } from "@vercel/queue";
import { connectMongo } from "../../src/db";
import { logger } from "../../src/logger";
import { runLeadMessagingDrain } from "../../src/services/leadMessaging";

const queue = new QueueClient();

export default queue.handleNodeCallback(async () => {
  await connectMongo();
  const summary = await runLeadMessagingDrain("queue");
  logger.info({ msg: "lead_messaging.consumer.drained", ...summary });
});
