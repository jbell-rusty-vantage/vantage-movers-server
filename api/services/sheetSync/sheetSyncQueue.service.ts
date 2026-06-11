import { send } from "@vercel/queue";
import {
  getSheetSyncQueueTopic,
  shouldPublishSheetSyncQueue,
} from "../../config/domain";
import { logger } from "../../logger";
import { recordOperationalEvent } from "../observability";

export type SheetSyncWakeupReason =
  | "domain_write"
  | "domain_delete"
  | "cron"
  | "admin_retry"
  | "manual";

/**
 * Intentionally tiny payload. The queue is only a wake-up signal: it does not
 * decide which entity to process. MongoDB owns due/coalesce/priority/quota
 * decisions, so the consumer just drains the outbox.
 */
export type SheetSyncWakeupMessage = {
  kind: "sheet_sync_wakeup";
  reason: SheetSyncWakeupReason;
  run_hint: string | null;
};

export type PublishSheetSyncWakeupOptions = {
  reason?: SheetSyncWakeupReason;
  /**
   * Optional dedup key. Bursts of writes within a debounce window can pass the
   * same key so the queue collapses repeated wake-ups instead of waking the
   * drainer once per write.
   */
  idempotencyKey?: string;
  runHint?: string | null;
};

/**
 * Publishes a sheet-sync wake-up to the env-scoped Vercel Queue topic.
 *
 * Publishing is best-effort by design: the durable work already lives in the
 * Mongo outbox (written inside the domain transaction), and the cron safety
 * net drains due jobs even if a publish fails. We therefore never throw out of
 * this function -- a failed publish is logged and swallowed so it cannot break
 * an API response or roll back a committed domain write.
 *
 * Locally (off Vercel) we no-op unless `SHEET_SYNC_QUEUE_LOCAL_PUBLISH=true`,
 * since local/test drains run via the cron route or direct drainer calls.
 */
export async function publishSheetSyncWakeup(
  options: PublishSheetSyncWakeupOptions = {},
): Promise<{ published: boolean; messageId: string | null }> {
  const reason = options.reason ?? "domain_write";
  const topic = getSheetSyncQueueTopic();

  if (!shouldPublishSheetSyncQueue()) {
    logger.info({
      msg: "sheet_sync.queue.publish_skipped",
      reason,
      topic,
      detail: "queue publishing disabled for this environment",
    });
    return { published: false, messageId: null };
  }

  const message: SheetSyncWakeupMessage = {
    kind: "sheet_sync_wakeup",
    reason,
    run_hint: options.runHint ?? null,
  };

  try {
    const { messageId } = await send(topic, message, {
      idempotencyKey: options.idempotencyKey,
    });
    logger.info({
      msg: "sheet_sync.queue.published",
      reason,
      topic,
      messageId,
    });
    return { published: true, messageId };
  } catch (error) {
    logger.error({
      err: error,
      msg: "sheet_sync.queue.publish_failed",
      reason,
      topic,
    });
    await recordOperationalEvent({
      level: "error",
      eventKey: "sheet_sync.queue.publish_failed",
      category: "sheet_sync",
      workflow: "sheet_sync_queue",
      summary: "Sheet sync queue wake-up publish failed.",
      details: {
        reason,
        topic,
        causeMessage: error instanceof Error ? error.message : String(error),
      },
      errorMessage: error instanceof Error ? error.message : String(error),
      notificationCandidate: false,
    });
    return { published: false, messageId: null };
  }
}
