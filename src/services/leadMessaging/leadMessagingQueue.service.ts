import { send } from "@vercel/queue";
import {
  getLeadMessagingQueueTopic,
  shouldPublishLeadMessagingQueue,
} from "../../config/domain";
import { logger } from "../../logger";

export type LeadMessagingWakeupReason =
  | "initial"
  | "retry"
  | "manual_retry"
  | "cron";

export async function publishLeadMessagingWakeup(
  reason: LeadMessagingWakeupReason,
  idempotencyKey?: string,
): Promise<boolean> {
  if (!shouldPublishLeadMessagingQueue()) return false;
  try {
    await send(
      getLeadMessagingQueueTopic(),
      { kind: "lead_messaging_wakeup", reason },
      { idempotencyKey },
    );
    logger.info({
      msg: "lead_messaging.queue.published",
      reason,
      idempotency_key: idempotencyKey ?? null,
    });
    return true;
  } catch (error) {
    logger.error({
      err: error,
      msg: "lead_messaging.queue.publish_failed",
      reason,
    });
    return false;
  }
}
