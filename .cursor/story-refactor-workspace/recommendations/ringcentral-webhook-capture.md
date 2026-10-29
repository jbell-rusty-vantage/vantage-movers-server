# Ringcentral Webhook Capture

- Status: recommended; refreshed 2026-10-29.
- Target: `src/services/ringcentral/webhook-capture.ts`
- Domain evidence: `docs/knowledge/services/ringcentral-call-lead-qualification.md`
- Current exported operations and constants: `captureRingCentralWebhookEvent`, `buildRingCentralWebhookCaptureDocument`, `previewRingCentralWebhookPayload`, `sanitizeHeaders`, `listRingCentralWebhookEvents`, `hasWebhookReceiptForSubscriptionSince`, `ensureRingCentralWebhookEventIndexes`, `RINGCENTRAL_TELEPHONY_SESSIONS_EVENT_FILTER`, `WEBHOOK_EVENTS_TEST_COLLECTION`, `WEBHOOK_EVENT_RETENTION_SECONDS`, `WEBHOOK_EVENT_TTL_INDEX`.

## Current operation and naming boundary

Capture builds a receipt and sanitized headers, then attempts durable insert. Missing Mongo configuration logs a redacted record and returns storedRawEvent false/receiptId null; persistence failure also returns a non-durable outcome. Duplicate uuid acknowledges the existing durable receipt and tries to recover its id, which can still be null if lookup fails. Preserve receiptId for fan-out/watermark recovery and the seven-day receivedAt TTL; Call Log recovery covers expired receipts. This is live integration receipt storage, distinct from retired Operational Events. The route's subscription verification precedes capture. Qualification and Lead creation stay elsewhere.

A cleanup preserves public signatures, stored strings, errors, ordering and idempotency. Rename only when the operation becomes clearer; keep current aliases until callers migrate. Do not add effects or change policy. This review inspected code and did not run runtime tests.
