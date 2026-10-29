# Granot lifecycle administration routes: reads and Owner commands

- Status: recommended; refreshed 2026-10-29.
- Target: `src/routes/granot-lifecycle-admin.routes.ts`.
- Current mount: `src/routes/v1.routes.ts`, after the `/api/v1` secret guard.
- Domain evidence: `docs/knowledge/granot-lifecycle/projections.md`, `docs/knowledge/granot-lifecycle/booking-reconciliation.md`, and `docs/knowledge/granot-lifecycle/release-reconciliation.md`.
- Existing route tests: `src/routes/granot-lifecycle-admin.routes.test.ts`.

## Current boundary

`createGranotLifecycleAdminRouter` injects dependencies for tests; its default router exposes protected lifecycle reads and delegates decisions to the services. Registry read actors can read cases, discrepancies, job and lead projections, and health. Owner-only reads include case candidates, creating observations, and booking connect-lead candidates. The case list defaults to open, descending by last evidence; a missing case is a typed 404, while a missing lead returns the existing `Lead not found` body.

Owner commands include Booking-case confirm, update, referral, cancellation and no-action; discrepancy re-evaluate, correct Record Link and no-action; connect Booking to Lead; activation; and dead-letter receipt requeue. Command routes parse their specific Zod schemas, require a single Idempotency-Key where the current handler does, derive the durable Owner actor, and delegate. Confirm/create actions return 201 for a new result and 200 for replay or already-satisfied results; update and no-action return 200. Preserve each existing envelope, validation, error mapping and `observeGranotOwnerCommandResult` call.

The three Release-case command routes remain as gated compatibility for historical cases; new Release evidence enters booking intake, and live discrepancy commands remain separate. The receipt list and live receipt SSE endpoints were retired and return 404; `POST .../receipts/:id/requeue` remains. Do not restore either read endpoint or its former route-order requirement.

## Remaining cleanup and parity

The repeated Booking-case command adapters can be made easier to read by naming the common parse/Owner/envelope steps while keeping each command, schema, observation labels and status decision explicit. The existing `discrepancyAction` already shares those steps for discrepancy commands; do not merge it with Booking or Release policy. Keep `createGranotLifecycleAdminRouter` and its dependency injection stable while moving callers.

Exercise signed Owner versus Admin reads and mutations, missing and duplicate idempotency headers, replay and already-satisfied status codes, missing case versus missing lead errors, and legacy Release gates. Check that requeue still exists and retired receipt list/SSE requests return 404. These checks are route parity, not permission to change case processing or recreate retired services.
