export const BEST_RELOCATION_INGESTION_TOPIC = "best-relocation-ingestion-events";
/** Retired: old callers cannot publish recurring work, even with old env flags. */
export async function publishIngestionWakeup(_input: {
  reason: "manual" | "schedule" | "retry" | "cron" | "recovery";
  run_hint?: string | null;
}): Promise<boolean> { return false; }
