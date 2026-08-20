import { send } from "@vercel/queue";
import {
  getGranotLifecycleQueueTopic,
  shouldPublishGranotLifecycleQueue,
} from "../../config/domain/granotWebhook";
import { logger } from "../../logger";
import { incrementGranotLifecycleQueuePublishFailures } from "./metrics";
import { emitGranotLifecycleEvent } from "./observability";

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
      receipt_id,
      observation_channel: "granot_webhook",
    });
    return { published: false };
  }

  try {
    const publish = deps.send ?? send;
    await publish(getGranotLifecycleQueueTopic(), payload);
    logger.info({
      msg: "granot_lifecycle.queue.published",
      receipt_id,
      observation_channel: "granot_webhook",
    });
    return { published: true };
  } catch (error) {
    incrementGranotLifecycleQueuePublishFailures();
    logger.error({
      err: error,
      msg: "granot_lifecycle.queue.publish_failed",
      receipt_id,
      observation_channel: "granot_webhook",
    });
    await emitGranotLifecycleEvent({
      level: "error",
      eventKey: "granot_lifecycle.queue.publish_failed",
      category: "queue",
      workflow: "granot_lifecycle_queue",
      summary: "Granot lifecycle queue wake-up publish failed.",
      details: {
        receipt_id,
        channel: "granot_webhook",
      },
      entity: { type: "granot_observation_receipt", id: receipt_id },
    });
    return { published: false };
  }
}
