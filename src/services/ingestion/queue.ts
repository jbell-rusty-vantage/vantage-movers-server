import { send } from "@vercel/queue";
import { logger } from "../../logger";

export const BEST_RELOCATION_INGESTION_TOPIC =
  "best-relocation-ingestion-events";

export async function publishIngestionWakeup(input: {
  reason: "manual" | "schedule" | "retry" | "cron" | "recovery";
  run_hint?: string | null;
}): Promise<boolean> {
  if (process.env.VERCEL !== "1" || process.env.NODE_ENV !== "production") {
    return false;
  }
  try {
    await send(
      BEST_RELOCATION_INGESTION_TOPIC,
      {
        kind: "ingestion_wakeup",
        reason: input.reason,
        run_hint: input.run_hint ?? null,
      },
      {
        idempotencyKey: input.run_hint
          ? `best-relocation:${input.run_hint}`
          : undefined,
      },
    );
    return true;
  } catch (error) {
    logger.error({
      err: error,
      msg: "best_relocation_ingestion.queue.publish_failed",
      runId: input.run_hint ?? null,
    });
    return false;
  }
}
