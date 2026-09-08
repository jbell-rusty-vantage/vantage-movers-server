---
type: Completion Report
title: GLS-02 — Owner webhook receipt search API
status: complete
closed: 2026-09-03
owners: [team:main-server]
---

# GLS-02 completion

Repository: `vantage-main-server` on current `main` (unrelated extension-users work was already dirty; no new branch). No commit. No Admin UI.

## Module

`src/services/granotLifecycle/receiptSearch.ts` — `searchReceipts(query, stores?)`.

Route: `GET /api/v1/admin/granot-lifecycle/receipts` on `granot-lifecycle-admin.routes.ts`, after `/receipts/live`, before `/receipts/:id/requeue`. Owner-only (`requireRegistryOwnerActor`). Envelope `{ ok: true, data }`.

Query: `granotLifecycleReceiptSearchQuerySchema` / `GRANOT_WEBHOOK_RECEIPT_SEARCH_QUERY_KEYS` in `src/validation/v1/granotLifecycle.validation.ts`. Re-exported from `v1.validation.ts`.

## Query / DTO

Keys: `ref_no`, `job_no`, `name`, `phone`, `email`, `source_company_id`, `route_event_class`, `booking_action`, `captured_from`, `captured_to`, `processing_state`, `cursor`, `limit` (default 25, max 100). Strict.

`booking_action` without `route_event_class` implies `booking_status_changed`. Other pairings are 400.

DTO at close matched spec §6: contact masked (`maskPhone` / `maskEmail`), no `granot_statement`. **Later override:** the live GET is unmasked contact plus credential-redacted `granot_statement` — [`../../knowledge/granot-lifecycle/live-receipts.md`](../../knowledge/granot-lifecycle/live-receipts.md). `intake_case_id` is a Granot Booking Reconciliation Case **by Job Number**.

## Indexes

Existing receipt `(route_event_class, captured_at)` and Observation identity/phone indexes. **No email index added** — collection scan not proven. Do not apply `granot_observation_normalized_email_captured` to production from this issue.

## Status codes

Owner 200. Admin 403 `GRANOT_OWNER_REQUIRED`. Isolated unsigned calls on this router are 403 (same `sendError` as live SSE), not 401. Production `requireApiSecret` may 401 first.

## Commands

Focused: 59 pass (`receiptSearch`, `granot-lifecycle-admin.routes`, `granotLifecycle.validation`). `pnpm typecheck` pass. Live SSE tests 14/14.

## For GLS-03

- BFF: `GET /api/proxy/v1/admin/granot-lifecycle/receipts`
- Query key names: `GRANOT_WEBHOOK_RECEIPT_SEARCH_QUERY_KEYS`
- Do not reuse Health GET permission
- Deep-link Job Timeline via `job_no`; Intake via `intake_case_id` → `/intakes?case=`
