import {
  cursorFromReceipt,
  decodeLiveReceiptEventId,
  encodeLiveReceiptEventId,
  type LiveReceiptCursor,
  type LiveWebhookReceipt,
} from "./liveReceipts";

export const LIVE_RECEIPT_POLL_MS = 1_000;
export const LIVE_RECEIPT_HEARTBEAT_MS = 15_000;
export const LIVE_RECEIPT_MAX_MS = 240_000;

export type LiveReceiptSseWriter = {
  write(chunk: string): void;
};

export type LiveReceiptSseDeps = {
  listSnapshot: () => Promise<LiveWebhookReceipt[]>;
  listAfter: (cursor: LiveReceiptCursor) => Promise<LiveWebhookReceipt[]>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  pollMs?: number;
  heartbeatMs?: number;
  maxMs?: number;
  signal?: AbortSignal;
};

function formatSse(event: string, data: unknown, id?: string): string {
  const lines = [
    id ? `id: ${id}` : null,
    `event: ${event}`,
    `data: ${JSON.stringify(data)}`,
    "",
    "",
  ].filter((line): line is string => line !== null);
  return lines.join("\n");
}

export async function runLiveReceiptSse(
  writer: LiveReceiptSseWriter,
  deps: LiveReceiptSseDeps,
  lastEventId?: string,
): Promise<void> {
  const pollMs = deps.pollMs ?? LIVE_RECEIPT_POLL_MS;
  const heartbeatMs = deps.heartbeatMs ?? LIVE_RECEIPT_HEARTBEAT_MS;
  const maxMs = deps.maxMs ?? LIVE_RECEIPT_MAX_MS;
  const started = deps.now();
  let lastHeartbeat = started;
  let cursor = decodeLiveReceiptEventId(lastEventId);

  if (!cursor) {
    const snapshot = await deps.listSnapshot();
    writer.write(formatSse("snapshot", { receipts: snapshot }));
    const newest = snapshot[0];
    cursor = newest
      ? cursorFromReceipt(newest)
      : { captured_at: new Date(started).toISOString(), receipt_id: "0".repeat(24) };
  }

  while (deps.now() - started < maxMs) {
    if (deps.signal?.aborted) {
      return;
    }
    const next = await deps.listAfter(cursor);
    for (const receipt of next) {
      writer.write(
        formatSse("receipt", receipt, encodeLiveReceiptEventId(cursorFromReceipt(receipt))),
      );
      cursor = cursorFromReceipt(receipt);
    }
    const tick = deps.now();
    if (tick - lastHeartbeat >= heartbeatMs) {
      writer.write(formatSse("heartbeat", { ts: new Date(tick).toISOString() }));
      lastHeartbeat = tick;
    }
    await deps.sleep(pollMs);
  }
}
