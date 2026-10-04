import { send } from "@vercel/queue";
import {
  getGranotLifecycleQueueTopic,
  shouldPublishGranotLifecycleQueue,
} from "../../config/domain/granotWebhook";
import { logger } from "../../logger";
import { incrementGranotLifecycleQueuePublishFailures } from "./metrics";
import { maskLifecycleId, safeLifecycleFailureLog } from "./safeLogging";

export type GranotLifecycleReceiptWakeup = {
  receipt_id: string;
};

export type PublishGranotLifecycleReceiptWakeupDeps = {
  shouldPublish?: () => boolean;
  send?: (
    topic: string,
    payload: GranotLifecycleReceiptWakeup,
  ) => Promise<unknown>;
};

export async function publishGranotLifecycleReceiptWakeup(
  message: GranotLifecycleReceiptWakeup,
  deps: PublishGranotLifecycleReceiptWakeupDeps = {},
): Promise<{ published: boolean }> {
  const receipt_id = message.receipt_id;
  const payload: GranotLifecycleReceiptWakeup = { receipt_id };
  const shouldPublish = deps.shouldPublish ?? shouldPublishGranotLifecycleQueue;

  if (!shouldPublish()) {
    logger.info({
      msg: "granot_lifecycle.queue.publish_skipped",
      receipt_id: maskLifecycleId(receipt_id),
      observation_channel: "granot_webhook",
    });
    return { published: false };
  }

  try {
    const publish = deps.send ?? send;
    await publish(getGranotLifecycleQueueTopic(), payload);
    logger.info({
      msg: "granot_lifecycle.queue.published",
      receipt_id: maskLifecycleId(receipt_id),
      observation_channel: "granot_webhook",
    });
    return { published: true };
  } catch (error) {
    incrementGranotLifecycleQueuePublishFailures();
    logger.error(safeLifecycleFailureLog({
      error,
      msg: "granot_lifecycle.queue.publish_failed",
      receipt_id,
      observation_channel: "granot_webhook",
    }));
    return { published: false };
  }
}
