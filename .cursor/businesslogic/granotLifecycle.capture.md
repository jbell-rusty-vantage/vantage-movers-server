**Platform glossary:** [`../../../CONTEXT.md`](../../../CONTEXT.md)  
**Primary code:** `src/services/granotLifecycle/capture.ts`, `src/services/granotLifecycle/queuePublisher.ts`, `src/services/granotLifecycle/receiptEvidence.ts`, `src/services/granotLifecycle/metrics.ts`, `src/models/GranotObservationReceipt.ts`, `src/models/granotLifecycleSchemas.ts`, `src/middleware/requireGranotWebhookSecret.ts`, `src/routes/granot-webhook.routes.ts`  
**Domain terms used:** Granot Observation Receipt, Observation Channel, System of Record

# Granot webhook capture (`granotLifecycle/`)

**Role:** Authenticate a Granot webhook delivery, persist one credential-redacted **Granot Observation Receipt**, return `202` only after Mongo commit, then attempt a best-effort `{ receipt_id }` queue wake-up. This path does **not** normalize, process, or mutate a Lead, Booking, or Cancellation.

**Stack:** thin webhook route → secret middleware → `capture.ts` → optional Vercel Queue publisher. Mongo is the **System of Record**. The queue is only a wake-up.

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
- route-derived `route_event_class` / compatibility `event_type`
- pending processing defaults; compatibility `processing_status: "received"`
- compatibility fields still written on insert: `provider`, `schema_version`, `event_type`, `received_at`, `processing_status`
- no `channel_operation_kind`, `channel_operation_id`, or human `initiator`

Stored headers are exactly `content-type`, `content-length`, `user-agent`, `x-request-id`, and `x-vercel-id`, each value truncated to 1,024 characters.

Identical deliveries are distinct receipts. `payload_sha256` is diagnostic, never idempotency.

## Responses

| Outcome | Status | Body |
|---------|--------|------|
| Committed | `202` | `{ ok: true, accepted: true, event_type, receipt_id }` |
| Unauthorized | `401` | `{ ok: false, code: "GRANOT_WEBHOOK_UNAUTHORIZED", error: "Unauthorized" }` |
| Missing secret config | `500` | `{ ok: false, error: "Granot webhook authentication is not configured" }` |
| Capture failure | `503` | `{ ok: false, error: "Webhook receipt could not be stored" }` |

`202` cannot precede commit. Capture failure creates no row and does not publish.

## Queue wake-up

After commit, publish exactly `{ receipt_id }` when the environment is an approved production Vercel function runtime. Tests and unapproved environments skip publish. Publish failure is logged/metriced as `granot_lifecycle.queue.publish_failed` and cannot change `202` or the receipt. No consumer/drainer exists yet. The Unit 07 processor is callable only and is not invoked from capture.

Indexes for a future drainer/lease exist on the receipt model; nothing claims or drains them yet.

## Related

- CRM Posting on form-lead create does **not** write a receipt and is not triggered by webhooks ([`form-lead.service.md`](form-lead.service.md)).
- HTTP automation is a separate mutation path ([`granotHttpCollector.service.md`](granotHttpCollector.service.md)).
- Software map: [`granot-lifecycle-capture.mdc`](../rules/granot-lifecycle-capture.mdc).

## Out of scope here

Capture does not call Observation normalization or the Decision processor. Normalization lives in [`granotLifecycle.normalization.md`](granotLifecycle.normalization.md). The Decision/activation/Record Link skeleton lives in [`granotLifecycle.processor.md`](granotLifecycle.processor.md). Queue consumer/cron remain Unit 08. Lead/Booking/Cancellation effects remain later units.
