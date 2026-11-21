---
type: Service
title: "Granot receipt capture (`granotLifecycle/`)"
description: "Webhook and channel-neutral receipt capture with { receipt_id } wake-up. Does not invoke the processor."
tags: [granot-lifecycle]
status: draft
stale_after: 2026-12-19
resource: src/services/granotLifecycle/capture.ts
applies_to:
  - src/services/granotLifecycle/capture.ts
  - src/services/granotLifecycle/queuePublisher.ts
  - src/services/granotLifecycle/receiptEvidence.ts
  - src/models/GranotObservationReceipt.ts
  - src/services/granotHistory/completedWebhooks.ts
  - src/services/granotHistory/retireOnUse.ts
  - src/services/granotHistory/retiredRecords.ts
  - src/services/granotHistory/retireLeadEvidence.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/granotLifecycle/capture.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
  - id: adr-0001
    resource: ../docs/adr/0001-mongodb-system-of-record.md
generated:
  by: process:okf-docs-keeper
  at: 2026-08-24T18:54:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)
**Primary code:** `src/services/granotLifecycle/capture.ts`, `src/services/granotLifecycle/extensionApply.ts`, `src/services/granotLifecycle/queuePublisher.ts`, `src/services/granotLifecycle/receiptEvidence.ts`, `src/services/granotLifecycle/metrics.ts`, `src/models/GranotObservationReceipt.ts`, `src/models/granotLifecycleSchemas.ts`, `src/middleware/requireGranotWebhookSecret.ts`, `src/routes/granot-webhook.routes.ts`, `src/routes/extension-granot-apply.routes.ts`
**Domain terms used:** [Granot Observation Receipt](../../../../CONTEXT.md), [Observation Channel](../../../../CONTEXT.md), [System of Record](../../../../CONTEXT.md)

# Granot receipt capture (`granotLifecycle/`)

**Role:** Persist one credential-redacted **Granot Observation Receipt** per accepted webhook delivery or approved channel operation. Webhook capture returns `202` only after Mongo commit, then attempts a best-effort `{ receipt_id }` queue wake-up. Channel capture hashes the full apply item and enforces operation-ID uniqueness. Capture itself does **not** mutate a Lead, Booking, or Cancellation.

**Stack:** thin webhook route → secret middleware → `capture.ts` → optional Vercel Queue publisher; Owner extension routes call `captureChannelOperationReceipt` then `claimAndProcessOrPoll`. Mongo is the **System of Record**. The queue is only a wake-up.

## Public routes

| Path | Route event class |
|------|-------------------|
| `POST /api/webhooks/granot/lead-created` | `lead_created` |
| `POST /api/webhooks/granot/priority-updated` | `priority_updated` |
| `POST /api/webhooks/granot/booking-status-changed` | `booking_status_changed` |

`event_type` in the `202` body is the invoked route class, never payload authority.

## Authentication

- Accept scalar `x-api-secret` from header and/or body.
- No supplied form is unauthorized. One supplied form must match `GRANOT_WEBHOOK_SECRET`.
- When both forms exist, both must independently match. The stored method is then `header_secret`; the body is still validated.
- Delete header and body `x-api-secret` before capture, hashing, logging, errors, or publish — including `401` and missing-config `500` paths.
- Compare SHA-256 digests with `timingSafeEqual`.
- Missing/blank `GRANOT_WEBHOOK_SECRET` returns `500` and calls neither capture nor publisher.

## Capture

`src/services/granotLifecycle/capture.ts` is the single implementation of header allowlisting, credential-redacted hashing, and receipt insert. New rows are complete v2 webhook receipts:

- `observation_channel: "granot_webhook"`
- proven `authentication_method` (`body_secret` or `header_secret`), never `legacy_unknown`
- route-derived `route_event_class`; payload `event_type` remains evidence only
- nested `processing.*` pending defaults; retired flat work fields are neither read nor written
- `provider: "granot"` is retained while the v2 semantic authority is `source_system`
- no `channel_operation_kind`, `channel_operation_id`, or human `initiator`

Stored headers are exactly `content-type`, `content-length`, `user-agent`, `x-request-id`, and `x-vercel-id`, each value truncated to 1,024 characters.

Webhook capture commits the receipt and the New York day/hour counters in one transaction. Daily Operations stores no receipt card. Identical deliveries are distinct receipts. `payload_sha256` is diagnostic, never idempotency. Its diagnostic index was removed on November 19. Webhook payload keys are not schema-validated. Granot may add unused fields or omit unused ones (for example `service_type` or `cubic_rate`). Capture stores the credential-redacted body as Mixed evidence; normalization later reads only known optional keys.

## Responses

| Outcome | Status | Body |
|---------|--------|------|
| Committed | `202` | `{ ok: true, accepted: true, event_type, receipt_id }` |
| Unauthorized | `401` | `{ ok: false, code: "GRANOT_WEBHOOK_UNAUTHORIZED", error: "Unauthorized" }` |
| Missing secret config | `500` | `{ ok: false, error: "Granot webhook authentication is not configured" }` |
| Capture failure | `503` | `{ ok: false, error: "Webhook receipt could not be stored" }` |

`202` cannot precede commit. Capture failure creates no row and does not publish.

## Queue wake-up

After webhook commit, `publishGranotLifecycleReceiptWakeup` may send exactly `{ receipt_id }`. Publish requires all of: not the test runner, not `TEST_MODE`, `VERCEL === "1"`, nonempty `VERCEL_REGION`, and [REDACTED] `VERCEL_ENV`. Preview/staging Vercel never publishes. The test runner skips even when those Vercel vars are set. Optional `GRANOT_LIFECYCLE_QUEUE_TOPIC` overrides the default topic (`granot-lifecycle-events` on [REDACTED] Vercel, otherwise `granot-lifecycle-events-dev`). Publish failure is logged/metriced as `granot_lifecycle.queue.publish_failed` and cannot change `202` or the receipt. Capture still does not invoke the processor. // pragma: allowlist secret

Channel capture (`captureChannelOperationReceipt`) does **not** publish. Extension and automation apply enter `claimAndProcessOrPoll` directly.

A dedicated consumer (`api/queues/granot-lifecycle-consumer.ts`) and five-minute cron `/api/cron/granot-lifecycle-drain` scan due work. Both are wake-ups only: Mongo receipt `processing.*` remains the durable work source. Details: [`drainer.md`](./drainer.md).

## Retirement of completed receipts (retire on use)

A receipt leaves MongoDB as soon as it is used. "Used" is defined per channel in [storage retention](./storage-retention-operations.md#retire-on-use): the Lead effect is committed, or the outcome is a terminal already-current, stale or policy-final one. Inbound webhooks also need their Daily Operations day count, and HTTP actions need their row in a verified closed-run replay. Pending matches, retries, conflicts, ambiguous and deferred outcomes stay hot. `booking_status_changed` receipts stay hot by policy.

The drainer stamps `processing.retention_review_at` with the completion time on a retirement candidate (an inbound Lead webhook or a `lead_snapshot_apply` channel operation). The two-minute storage cron reviews that queue once the Owner enables it, and the per-route webhook scan remains a backstop. The worker stores the exact receipt BSON, gzipped, as a create-only GCS object and reads it back from the pinned generation, verifying its SHA-256. It then compares the restored bytes with the original. Inside one MongoDB transaction it rereads the receipt and the "used" proof, inserts a compact locator in `granot_archived_receipts` and deletes the hot receipt. Failed storage verification leaves the receipt available for retry.

- **Webhook locator** (`completed-webhook-bson-v1`, unchanged): hash, generation, route, capture time, latest Decision ID and certified Lead.
- **Channel-operation locator** (`channel-receipt-bson-v1`, extension and HTTP automation): hash, generation, channel, `channel_operation_id`, kind, payload hash, capture and completion time, latest Decision ID, saved replay and certified Lead. The unique index `granot_archived_receipt_operation_unique` (`observation_channel, channel_operation_id`) carries the operation identity after the hot unique index no longer does.

**Duplicate delivery after retirement.** Once the locator operation index is installed, channel capture inserts inside a transaction that first looks up the retired operation key. Before that, no operation can have retired, and capture keeps its plain insert. A match behaves as the hot unique index would: the capture replays the original receipt ID, and a changed payload hash or kind raises `OperationIdempotencyConflictError`. A retirement committing concurrently either write-conflicts with the insert (the transaction retries and sees the locator) or leaves the hot key in place (duplicate key, then the same replay). The drainer then answers the replayed ID from the restored receipt and its saved replay. Webhooks have no delivery key: each delivery is its own receipt, and its retirement keeps the Daily Operations count untouched.

**Reads by original ID.** `readGranotReceipt`, `readGranotObservation` and `readGranotDecision` in [`retiredRecords.ts`](../../../src/services/granotHistory/retiredRecords.ts) return the hot document or the verified archive. The drainer, Owner requeue, case readers, decision repointing, Pool admission and the job timeline use them or the locator itself.

## Retirement of Lead Observations and Decisions

The two-minute retention job scans Observations in ID order, 192 per pass. For a completed HTTP automation receipt the saved replay must identify the same Observation, Decision and Lead and report an effect-free already-current or stale outcome. If the original Decision was previously removed, history contains the Observation and an empty Decision list. A surviving Decision also requires a later winning Lead Observation. For a receipt already in GCS (an inbound Lead webhook, or an extension or HTTP Lead snapshot), the worker uses the verified retired receipt and the linked live Decision. Priority 5, booking actions, unresolved work and live references stay hot.

The worker verifies a compressed GCS page, repeats the source and reference checks, then commits the job history catalog, original-ID lookup, receipt locator and source removals together. The receipt continues serving its original replay. A sealed automation run can verify an archived Decision against the saved replay digest. Nothing in this path depends on a TTL index.

## Related

- CRM Posting on form-lead create does **not** write a receipt and is not triggered by webhooks ([`form-lead.md`](../services/form-lead.md)).
- Approved Owner browser-extension apply uses `captureChannelOperationReceipt` (`observation_channel: "browser_extension"`, `authentication_method: "extension_session"`). Same channel + operation ID + same hash **and** same `channel_operation_kind` replays the receipt. A different hash **or** kind is `409 GRANOT_OPERATION_IDEMPOTENCY_CONFLICT` and creates no row. Unique-index races reload the winner and apply the same check. A race with no reload winner throws `CaptureUnavailableError` (`503 GRANOT_CAPTURE_UNAVAILABLE`). Unique index is `{ observation_channel, channel_operation_id }` partial on string `channel_operation_id`. Details: [`extension-apply.md`](./extension-apply.md).
- Pre-cutover HTTP automation captures used `captureChannelOperationReceipt` (`observation_channel: "granot_http_automation"`, `authentication_method: "automation_owner_approval"`). Operation ID is `${run_id}:${action_id}`. Same hash/kind conflict rules. New scheduled Estimates actions apply directly without a receipt. Details: [`automation-apply.md`](./automation-apply.md).
- Index and read paths for receipts and locators: [storage and retention](./storage-retention-operations.md#storage-indexes-and-read-paths).
- Software map: [`granot-lifecycle-capture.mdc`](../../../.cursor/rules/granot-lifecycle-capture.mdc).

## Out of scope here

Capture does not call Observation normalization or the Decision processor. Normalization lives in [`normalization.md`](./normalization.md). Processor orchestration lives in [`processor.md`](./processor.md). Claim/lease/retry/requeue live in [`drainer.md`](./drainer.md). Official Lead/Booking writes and Owner Booking commands stay in those modules; the capture transaction owns the webhook receipt and its aggregate contribution.
