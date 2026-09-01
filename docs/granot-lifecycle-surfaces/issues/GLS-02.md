# GLS-02 — Owner webhook receipt search API

> **Contract maturity: implementation-ready.** Session 1 (server,
> parallel with GLS-01). Historical list of webhook-channel Granot
> Observation Receipts. **No Admin UI. No Live Events change.**

## 1. Authority and required reading

- **Pack specification:** [`../granot-lifecycle-surfaces-specification.md`](../granot-lifecycle-surfaces-specification.md)
  — §3.2, §4, §5, §6, §8. Wins on filters, DTO, and auth.
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)
- **Live SSE (do not rebuild):** [`../../knowledge/granot-lifecycle/live-receipts.md`](../../knowledge/granot-lifecycle/live-receipts.md)
- **Normalization fields:** [`../../knowledge/granot-lifecycle/normalization.md`](../../knowledge/granot-lifecycle/normalization.md)
- **Receipt model:** `src/models/GranotObservationReceipt.ts`
- **Observation model:** `src/models/GranotObservation.ts`
- **Glossary:** workspace-root `CONTEXT.md`

## 2. Objective

Add `GET /api/v1/admin/granot-lifecycle/receipts` so an Owner can find
webhook-channel Granot Observation Receipts by identity, Source
Company, event type, and Granot Booking Action. Live SSE stays the
30-minute stream.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-main-server` only. No Admin UI.
- **Branch:** current server desk branch, or
  `granot-lifecycle-surfaces` if that is how this desk is isolated.
- **Prerequisites:** none. Startable in parallel with GLS-01.
- Ordinary checks use redacted synthetic data. Runtime reads require
  `TEST_MODE=true` and the test database.
- No commit, push, deploy, production index, or live payload read
  unless asked.

## 4. Current-state evidence to verify

Observed 2026-09-01; **reverify at implementation**.

- No historical list route exists. The only receipt GET is
  `/api/v1/admin/granot-lifecycle/receipts/live` (SSE).
- `liveReceipts.ts` projects webhook rows only
  (`observation_channel: "granot_webhook"`, `route_event_class` in
  `lead_created` | `priority_updated` | `booking_status_changed`).
  `extractLiveWebhookLead` reads redacted payload scalars
  (`job_no`, `email`, `phone` / `phone_number`, names, `event_type`).
- Collection name is `granot_webhook_receipts`. Webhook receipts
  require `route_event_class` and forbid `channel_operation_kind`.
- `GranotObservation.receipt_id` is unique. Identity lives on
  `identity.normalized_job_no` / `normalized_form_ref`. Contact lives
  on `contact.normalized_phone` / `normalized_email` / name fields.
  `booking_action.normalized` is `booked` | `release`.
  `granot_crm_source_id` is the Registry handle — not Source Company
  itself.
- Existing indexes: receipt `(route_event_class, captured_at)`;
  Observation `(identity.normalized_job_no, captured_at)`,
  `(identity.normalized_form_ref, captured_at)`,
  `(contact.normalized_phone, captured_at)`. No email index.
- Health GET is Owner/Admin. Live SSE is Owner-only
  (`requireRegistryOwnerActor`).
- Route file: `src/routes/granot-lifecycle-admin.routes.ts`.
  Validation: `src/validation/v1/granotLifecycle.validation.ts`.

## 5. Locked decisions and invariants at risk

- Channel is `granot_webhook` only. Extension and HTTP-automation
  receipts are excluded.
- `route_event_class` is the event type. Payload `event_type` does not
  reroute.
- Booked vs Release is Granot Booking Action, not a second route
  class. `booking_action` with a non-`booking_status_changed` event
  type is `400`.
- `source_company_id` and `booking_action` require an Observation.
  Identity filters may fall back to `extractLiveWebhookLead`.
- Source Company is reviewed catalog identity via Granot CRM Source.
  Do not filter on `normalized_source_label` as the Owner control.
- List DTO has no `granot_statement` and no credentials.
- Owner-only. Admin 403.
- Do not change `liveReceipts.ts` behavior. Reuse
  `extractLiveWebhookLead` / `LIVE_WEBHOOK_EVENT_CLASSES` if that
  avoids a second extract.

## 6. Deliverables and exact contract

### 6.1 Route

`GET /api/v1/admin/granot-lifecycle/receipts`

Must be registered so it does not collide with
`/receipts/live` or `/receipts/:id/requeue`. Place the static
`/receipts` list **before** any `/:id` receipt routes.

Authorize with `requireRegistryOwnerActor`.

### 6.2 Query (Zod)

`ref_no`, `job_no`, `name`, `phone`, `email`, `source_company_id`,
`route_event_class`, `booking_action`, `captured_from`,
`captured_to`, `processing_state`, `cursor`, `limit` (default 25,
max 100). Unknown keys reject.

Normalize `job_no`, `phone`, `email`, and `ref_no` with the existing
lifecycle / Job Timeline normalizers. Do not invent new ones.

### 6.3 Module

`src/services/granotLifecycle/receiptSearch.ts` (name may vary).

- Start from webhook receipts.
- Left-join Observation by `receipt_id`.
- Batch Registry (Granot CRM Source → Source Company), latest
  Synchronization Decision, and Booking case by Job Number for the
  page. No per-row loop.
- Sort `captured_at` desc, `_id` desc. Keyset cursor.
- Return spec §6 DTO. Mask phone and email the same way other Owner
  lifecycle reads do.

### 6.4 Indexes

Use existing indexes first. Add
`granot_observation_normalized_email_captured` only if email find
would collection-scan and the issue proves it. Do not add Atlas
Search. Do not apply a production index unless the user asks.

### 6.5 Tests

- Owner 200, Admin 403, unauthenticated 401.
- Channel filter excludes extension / automation.
- Each identity filter: Observation hit; pending-receipt fallback
  hit; miss.
- `source_company_id` and `booking_action` ignore pending receipts.
- `booking_action=release` with `route_event_class=lead_created`
  → 400.
- `booking_action` alone implies `booking_status_changed`.
- Booked vs Release are distinct.
- Payload `event_type` cannot reroute `route_event_class`.
- Masking: full phone / email / payload absent from the body.
- Cursor page is stable.
- Live SSE route tests still pass unchanged.

## 7. Explicitly out of scope

- Admin UI (GLS-03).
- Changing Live Events SSE events or window.
- Receipt writes / requeue on this path.
- Searching other Observation Channels.
- Unmasking or raw payload in the DTO.
- Case-detail or discrepancy APIs.
- Admin map / Health URL (GLS-01).

## 8. Flags and runtime posture

No new flag. Owner actor required.

## 9. Migration and indexes

Optional email index only if proven. Document the decision in the
completion report. Do not apply it to production in this issue.

## 10. Acceptance criteria

- [ ] `GET /api/v1/admin/granot-lifecycle/receipts` exists and is
      Owner-only.
- [ ] Filters in spec §5 work as specified, including Booked vs
      Release and Source Company via Granot CRM Source.
- [ ] Pending receipts are findable by identity and excluded by
      Source Company / Booking Action filters.
- [ ] DTO matches spec §6. No `granot_statement`. Contact is masked.
- [ ] `/receipts/live` and `/receipts/:id/requeue` still route
      correctly.
- [ ] Focused tests in §6.5 pass. `pnpm test` for the new module and
      `granot-lifecycle-admin.routes.test.ts`; `pnpm typecheck`.
- [ ] No capture / processor / live-stream file changes except shared
      extract reuse.

## 11. Required tests and commands

```bash
cd vantage-main-server && pnpm test -- src/services/granotLifecycle/receiptSearch src/routes/granot-lifecycle-admin.routes.test.ts
cd vantage-main-server && pnpm typecheck
```

Adjust the test path if the module name differs. Paste output.

## 12. Live/staging verification

Not required. Synthetic fixtures are enough. Do not read production
receipts.

## 13. Rollback

Remove the route, module, and any unused index definition. Live SSE
is unchanged.

## 14. Required completion handoff

Report: module path; query/DTO types; which indexes you used or
added; Owner/Admin status codes; what you did not do; anything GLS-03
must know (BFF path, query key names if you exported them).

**Unblocks:** GLS-03 (together with GLS-01).
