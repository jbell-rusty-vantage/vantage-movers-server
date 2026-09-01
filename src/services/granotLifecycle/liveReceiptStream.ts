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
  listUpdated?: () => Promise<LiveWebhookReceipt[]>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  pollMs?: number;
  heartbeatMs?: number;
  maxMs?: number;
  signal?: AbortSignal;
};

type LiveReceiptEmittedFingerprint = {
  processing_state: string;
  intake_link: string;
};

function fingerprintIntakeLink(link: LiveWebhookReceipt["intake_link"]): string {
  if (!link) {
    return "";
  }
  return `${link.case_id}:${link.kind}:${link.state}:${link.matched_via}`;
}

function fingerprintReceipt(receipt: LiveWebhookReceipt): LiveReceiptEmittedFingerprint {
  return {
    processing_state: receipt.processing_state,
    intake_link: fingerprintIntakeLink(receipt.intake_link),
  };
}

function rememberReceipts(
  remembered: Map<string, LiveReceiptEmittedFingerprint>,
  receipts: LiveWebhookReceipt[],
): void {
  for (const receipt of receipts) {
    remembered.set(receipt.receipt_id, fingerprintReceipt(receipt));
  }
}

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
  const remembered = new Map<string, LiveReceiptEmittedFingerprint>();

  if (!cursor) {
    const snapshot = await deps.listSnapshot();
    writer.write(formatSse("snapshot", { receipts: snapshot }));
    rememberReceipts(remembered, snapshot);
    const newest = snapshot[0];
    cursor = newest
      ? cursorFromReceipt(newest)
      : { captured_at: new Date(started).toISOString(), receipt_id: "0".repeat(24) };
  } else if (deps.listUpdated) {
    rememberReceipts(remembered, await deps.listUpdated());
  }

  while (deps.now() - started < maxMs) {
    if (deps.signal?.aborted) {
      return;
    }
    const next = await deps.listAfter(cursor);
    const justEmitted = new Set<string>();
    for (const receipt of next) {
      writer.write(
        formatSse("receipt", receipt, encodeLiveReceiptEventId(cursorFromReceipt(receipt))),
      );
      cursor = cursorFromReceipt(receipt);
      remembered.set(receipt.receipt_id, fingerprintReceipt(receipt));
      justEmitted.add(receipt.receipt_id);
    }
    if (deps.listUpdated) {
      const window = await deps.listUpdated();
      const windowIds = new Set<string>();
      for (const receipt of window) {
        windowIds.add(receipt.receipt_id);
        if (justEmitted.has(receipt.receipt_id)) {
          remembered.set(receipt.receipt_id, fingerprintReceipt(receipt));
          continue;
        }
        const previous = remembered.get(receipt.receipt_id);
        if (previous) {
          const current = fingerprintReceipt(receipt);
          if (
            previous.processing_state !== current.processing_state ||
            previous.intake_link !== current.intake_link
          ) {
            writer.write(formatSse("receipt_updated", receipt));
          }
          remembered.set(receipt.receipt_id, current);
        }
      }
      for (const receiptId of [...remembered.keys()]) {
        if (!windowIds.has(receiptId) && !justEmitted.has(receiptId)) {
          remembered.delete(receiptId);
        }
      }
    }
    const tick = deps.now();
    if (tick - lastHeartbeat >= heartbeatMs) {
      writer.write(formatSse("heartbeat", { ts: new Date(tick).toISOString() }));
      lastHeartbeat = tick;
    }
    await deps.sleep(pollMs);
  }
}
