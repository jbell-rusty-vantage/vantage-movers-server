import { send } from "@vercel/queue";
import { logger } from "../../logger";

export const REPORTING_DELIVERY_TOPIC = "reporting-delivery-events";

export async function publishReportingWakeup(input: {
  reason: "manual" | "schedule" | "retry" | "cron" | "recovery";
  run_hint?: string | null;
}): Promise<boolean> {
  if (process.env.VERCEL !== "1" || process.env.NODE_ENV !== "production") {
    return false;
  }
  try {
    // Wakeups are intentionally not provider-deduplicated. Durable run leases
    // make duplicate deliveries harmless, while deduplicating by run/reason can
    // suppress later cancellation and heartbeat recovery wakeups.
    await send(
      REPORTING_DELIVERY_TOPIC,
      {
        kind: "reporting_wakeup",
        reason: input.reason,
        run_hint: input.run_hint ?? null,
      },
    );
    return true;
  } catch (error) {
    logger.error({
      err: error,
      msg: "reporting.queue.publish_failed",
      runId: input.run_hint ?? null,
    });
    return false;
  }
}
