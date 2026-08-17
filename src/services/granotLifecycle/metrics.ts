export type GranotLifecycleReceiptMetricLabels = {
  channel: string;
  event_class: string;
};

const receiptsTotal = new Map<string, number>();
let captureFailuresTotal = 0;
let queuePublishFailuresTotal = 0;

function receiptKey(labels: GranotLifecycleReceiptMetricLabels): string {
  return `${labels.channel}|${labels.event_class}`;
}

export function incrementGranotLifecycleReceiptsTotal(
  labels: GranotLifecycleReceiptMetricLabels,
): void {
  const key = receiptKey(labels);
  receiptsTotal.set(key, (receiptsTotal.get(key) ?? 0) + 1);
}

export function incrementGranotLifecycleCaptureFailures(): void {
  captureFailuresTotal += 1;
}

export function incrementGranotLifecycleQueuePublishFailures(): void {
  queuePublishFailuresTotal += 1;
}

export function getGranotLifecycleReceiptsTotal(
  labels: GranotLifecycleReceiptMetricLabels,
): number {
  return receiptsTotal.get(receiptKey(labels)) ?? 0;
}

export function getGranotLifecycleCaptureFailures(): number {
  return captureFailuresTotal;
}

export function getGranotLifecycleQueuePublishFailures(): number {
  return queuePublishFailuresTotal;
}

export function resetGranotLifecycleMetrics(): void {
  receiptsTotal.clear();
  captureFailuresTotal = 0;
  queuePublishFailuresTotal = 0;
}
