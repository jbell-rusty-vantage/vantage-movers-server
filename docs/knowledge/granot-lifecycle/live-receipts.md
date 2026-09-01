---
type: Service
title: Granot live webhook receipts
description: Owner-only SSE of Granot webhook receipts. Polls Mongo; does not emit in-process.
tags: [granot-lifecycle]
status: draft
stale_after: 2026-12-01
resource: src/services/granotLifecycle/liveReceipts.ts
applies_to:
  - src/services/granotLifecycle/liveReceipts.ts
  - src/services/granotLifecycle/liveReceiptStream.ts
  - src/routes/granot-lifecycle-admin.routes.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/granotLifecycle/liveReceipts.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
generated:
  by: process:docs-keeper
  at: 2026-09-01T18:20:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**Authority (intake_link, receipt_updated):** [`release-into-booking-intake.md`](./release-into-booking-intake.md) Part B.  
**Primary code:** `src/services/granotLifecycle/liveReceipts.ts`, `src/services/granotLifecycle/liveReceiptStream.ts`, `src/routes/granot-lifecycle-admin.routes.ts`  
**Domain terms used:** [Granot Observation Receipt](../../../../CONTEXT.md), [Granot Observation](../../../../CONTEXT.md), [Granot Booking Reconciliation Case](../../../../CONTEXT.md)

# Granot live webhook receipts

**Role:** Stream Owner-visible Granot webhook receipts (`lead_created`, `priority_updated`, `booking_status_changed`) as Server-Sent Events. Capture, the queue consumer, and this read are separate Vercel invocations, so the stream **polls Mongo** on `captured_at`. It does not use `EventEmitter`, module-level response registries, or WebSockets.

## Public route

`GET /api/v1/admin/granot-lifecycle/receipts/live` — Owner only (`requireRegistryOwnerActor`). `Content-Type: text/event-stream`.

| Event | When | Payload |
| --- | --- | --- |
| `snapshot` | First open | `{ receipts: LiveWebhookReceipt[] }` (enriched) |
| `receipt` | Each newer webhook row after the cursor | enriched receipt; `Last-Event-ID` is `captured_at:receipt_id` |
| `receipt_updated` | A receipt **already in the 30-minute window** whose `processing_state` or `intake_link` changed | the full enriched receipt; **no** `id:` — does not advance the capture cursor |
| `heartbeat` | Keep-alive while idle | `{ ts }` |

Credential keys are stripped; lead facts come from the redacted Granot body. Extension and HTTP-automation receipts are excluded.

The stream closes at the function max duration. The Admin BFF at `/api/granot-live-receipts` pipes this response; `EventSource` reconnects. Admin merge replaces by `receipt_id` (incoming wins) so a later `intake_link` overwrites `null` without reload.

## Wire shape

`LiveWebhookReceipt` includes `observation_id` and `intake_link` in addition to `receipt_id`, `captured_at`, `route_event_class`, `observation_channel`, `processing_state`, `lead`, and `granot_statement`.

`observation_id` is set whenever the Observation exists, including non-booking routes. `intake_link` is null unless all of these hold:

- `route_event_class === "booking_status_changed"`
- the event type is a supported Booked or Release action (empty / unsupported never qualify)
- a Granot Booking Reconciliation Case has `evidence.observation_id` equal to this receipt’s Observation

`intake_link` shape: `{ case_id, kind: "booking", state: "open" | "resolved", matched_via: "evidence_observation_id" }`. Never send a Release/cancellation kind. Resolved booking cases still link.

## Join (never by job_no)

`resolveLiveReceiptIntakeLink` / `enrichLiveWebhookReceipts` own the join. Snapshot, `listAfter`, and `listUpdated` batch: one Observation find by `receipt_id`, one booking-case find by `evidence.observation_id`. Unique match returns the link. Two cases for one Observation fail closed (`intake_link: null` + operational event `granot_lifecycle.live_receipt.ambiguous_intake_link`). Routes and React cards do not query cases by Job Number.

No link for `lead_created`, `priority_updated`, pending rows with no Observation, discrepancy-only completions, or historical Release-only cases that were never migrated onto a booking case.

Named index `granot_booking_case_evidence_observation_id` (`{ "evidence.observation_id": 1 }`, not unique) is defined on the booking-case model and consumed by the existing indexes CLIs. **Not applied to production** by this change set.

## SSE late update

Capture SSE may first emit `intake_link: null` while processing is pending. After the processor opens or refreshes the booking case, `listUpdated` re-lists the 30-minute window and emits `receipt_updated` when `processing_state` or `intake_link` changed. Do not emit `receipt_updated` for a receipt just sent as `receipt`. Still Mongo-polled; no in-process emit from the processor.
