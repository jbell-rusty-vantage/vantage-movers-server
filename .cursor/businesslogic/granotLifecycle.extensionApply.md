**Platform glossary:** [`../../../CONTEXT.md`](../../../CONTEXT.md)  
**Primary code:** `src/services/granotLifecycle/extensionApply.ts`, `src/services/granotLifecycle/capture.ts`, `src/routes/extension-granot-apply.routes.ts`, `src/validation/v1/granotLifecycle.validation.ts`  
**Domain terms used:** Granot Observation Receipt, Observation Channel, Synchronization Decision, System of Record

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

Authenticated extension session + **Owner** only. Mapped to a durable human initiator with `origin: "browser_extension"`. Admin, secret, employee, and unauthenticated requests create no receipt.

## After capture

`claimAndProcessOrPoll` owns processing. Completed returns the stored Decision result. A lost claim or disabled processing returns durable `accepted_for_processing` for the same operation ID. `changed_paths` come only from processor effect summaries and are `[]` while shadow stays on. Messages are fixed safe strings.

## Out of scope here

Preview/search, HTTP automation apply, Lead writes/creation, Booking/Release commands, and restoring a patch-authoritative bypass. The Form Edit Lead page still uses ordinary `PATCH /api/v1/form-leads/:id` and is not a Granot final-apply URL.
