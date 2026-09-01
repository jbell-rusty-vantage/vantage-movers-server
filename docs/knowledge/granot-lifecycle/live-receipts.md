---
type: Service
title: Granot live webhook receipts
description: Owner-only SSE of Granot webhook receipts. Polls Mongo; does not emit in-process.
tags: [granot-lifecycle]
status: draft
stale_after: 2026-11-28
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
  at: 2026-08-28T15:20:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**Later contract (not implemented):** [`release-into-booking-intake.md`](./release-into-booking-intake.md). This file still describes current code.  
**Primary code:** `src/services/granotLifecycle/liveReceipts.ts`, `src/services/granotLifecycle/liveReceiptStream.ts`, `src/routes/granot-lifecycle-admin.routes.ts`
**Domain terms used:** [Granot Observation Receipt](../../../../CONTEXT.md)

# Granot live webhook receipts

**Role:** Stream Owner-visible Granot webhook receipts (`lead_created`, `priority_updated`, `booking_status_changed`) as Server-Sent Events. Capture, the queue consumer, and this read are separate Vercel invocations, so the stream **polls Mongo** on `captured_at`. It does not use `EventEmitter`, module-level response registries, or WebSockets.

## Public route

`GET /api/v1/admin/granot-lifecycle/receipts/live` — Owner only (`requireRegistryOwnerActor`). `Content-Type: text/event-stream`.

| Event | When |
| --- | --- |
| `snapshot` | First open. Last 30 minutes, newest first. |
| `receipt` | Each newer webhook row after the cursor. |
| `heartbeat` | Keep-alive while idle. |

`Last-Event-ID` is `captured_at:receipt_id`. Credential keys are stripped; lead facts come from the redacted Granot body. Extension and HTTP-automation receipts are excluded.

The stream closes at the function max duration. The Admin BFF at `/api/granot-live-receipts` pipes this response; `EventSource` reconnects.
