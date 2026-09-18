/** Engineering availability window, not a provider retention promise. Starts at first observation, so historical imports get a full window. */
export const RECORDING_AVAILABILITY_WINDOW_MS = 72 * 60 * 60 * 1000;
export const MEDIA_FETCH_STAGE = "media_fetch" as const;
export { csiMediaMaxBytes as mediaMaxBytes } from "../../../config/domain/salesIntelligence";
export function recordingPendingDelay(firstObserved: Date, now: Date): number {
  return Math.min(3_600_000, 60_000 * 2 ** Math.min(6, Math.floor(Math.max(0, now.getTime() - firstObserved.getTime()) / 3_600_000)));
}
export function recordingWindowExhausted(firstObserved: Date, now: Date) {
  return now.getTime() - firstObserved.getTime() >= RECORDING_AVAILABILITY_WINDOW_MS;
}
