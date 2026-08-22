---
type: Service
title: "Browser-extension receipt apply (`granotLifecycle/extensionApply`)"
description: Owner extension apply items capture a receipt and enter claimAndProcessOrPoll.
tags: [granot-lifecycle]
status: draft
stale_after: 2026-11-19
resource: src/services/granotLifecycle/extensionApply.ts
applies_to:
  - src/services/granotLifecycle/extensionApply.ts
  - src/services/granotLifecycle/capture.ts
  - src/routes/extension-granot-apply.routes.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/granotLifecycle/extensionApply.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
  - id: adr-0001
    resource: ../docs/adr/0001-mongodb-system-of-record.md
generated:
  by: process:okf-docs-optimization
  at: 2026-08-22T06:52:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**Primary code:** `src/services/granotLifecycle/extensionApply.ts`, `src/services/granotLifecycle/capture.ts`, `src/routes/extension-granot-apply.routes.ts`, `src/validation/v1/granotLifecycle.validation.ts`  
**Domain terms used:** [Granot Observation Receipt](../../../../CONTEXT.md), [Observation Channel](../../../../CONTEXT.md), [Synchronization Decision](../../../../CONTEXT.md), [System of Record](../../../../CONTEXT.md)

# Browser-extension receipt apply (`granotLifecycle/extensionApply`)

**Role:** Accept a strict Owner apply item on the existing v1 URLs, capture one `browser_extension` receipt, enter Unit 08 `claimAndProcessOrPoll`, and return a PII-safe compatibility result. The extension does not decide identity or desired state. Preview URLs stay read-only.

## Public routes

| Method | Path | Body |
|--------|------|------|
| `PATCH` | `/api/v1/form-leads/:id/granot-sync` | one `ExtensionGranotApplyItem`; `expected_target`, when present, must be `{ model: "FormLead", id }` |
| `POST` | `/api/v1/call-leads/enrichment/sync` | `{ items }` of `lead_snapshot_apply` only; max 100; unique operation IDs |
| `POST` | `/api/v1/call-leads/booked-reconciliation/sync` | `{ items }` of `booking_action_apply` only; expected model `CallLead` when present |

Envelope remains `{ ok: true, data }`. Follow Up uses `lead_snapshot_apply`. Booked Jobs uses `booking_action_apply` and retains raw `Booked` evidence. The statement is the full bounded Granot row: raw Priority, separate `user`/`rep`, no `quoted` Boolean, no Lead patch.

## Auth and initiator

Routes sit behind v1 `requireApiSecret` first (missing/invalid secret is typically `401`). Then `requireExtensionOwnerInitiator`: `vantageAuth.kind === "user"` and `role === "owner"`. Mapped to a durable human initiator with `origin: "browser_extension"`. Employee, secret-only, Admin, and unauthenticated requests create no receipt (`403 GRANOT_OWNER_REQUIRED` in the route tests). Zod failure is `400 GRANOT_VALIDATION_FAILED`.

`operation_id` must be a lowercase UUID v4. Capture uses `payload_schema_hint: "extension_granot_apply_item_v1"`. Batch max is 100 unique operation IDs. Enrichment `/sync` accepts only `lead_snapshot_apply`; booked-reconciliation `/sync` accepts only `booking_action_apply`.

## After capture

`claimAndProcessOrPoll(receipt_id)` in [`drainer.md`](./drainer.md) owns processing (initiator lives on the receipt; the default wrapper does not pass it). HTTP stays **200** `{ ok: true, data }`.

| Claim / Decision | Extension `processing_state` |
|------------------|------------------------------|
| `processed` with a stored Decision | `completed` (includes `outcome: "pending_match"`) |
| lost claim / poll miss / processing disabled / `dead_letter` | `accepted_for_processing` (no `error_code` on this path) |

Automation maps `pending_match` and `dead_letter` differently — see [`automation-apply.md`](./automation-apply.md). `changed_paths` come only from processor effect summaries and are `[]` while shadow stays on. `expected_target` disagreement forces `outcome: "conflict"` and clears `changed_paths`. Messages are fixed safe strings via `mapSynchronizationOutcomeMessage`. Replay (same operation ID + hash + kind) reuses the receipt and claims again.

## Out of scope here

Preview/search, HTTP automation apply, Lead writes/creation, Booking/Release commands, and restoring a patch-authoritative bypass. The Form Edit Lead page still uses ordinary `PATCH /api/v1/form-leads/:id` and is not a Granot final-apply URL.
