---
type: Service
title: Granot Release reconciliation
description: Historical Release-case module and HTTP routes. New Release evidence lands on the booking intake.
tags: [granot-lifecycle]
status: draft
stale_after: 2026-12-01
resource: src/services/granotLifecycle/releaseReconciliation.ts
applies_to:
  - src/services/granotLifecycle/releaseReconciliation.ts
  - src/services/granotLifecycle/releaseOwnerCommands.ts
  - src/models/GranotReleaseReconciliationCase.ts
  - scripts/migrations/granot-lifecycle-release-cases-into-booking-intake.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/granotLifecycle/releaseReconciliation.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
  - id: adr-0001
    resource: ../docs/adr/0001-mongodb-system-of-record.md
generated:
  by: process:docs-keeper
  at: 2026-09-01T18:20:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**Authority (owner surface retired):** [`release-into-booking-intake.md`](./release-into-booking-intake.md). New Release evidence is booking-case work in [`booking-reconciliation.md`](./booking-reconciliation.md). FINAL SPEC still wins on identity-conflict discrepancy reasons.  
**Primary code:** `src/services/granotLifecycle/releaseReconciliation.ts`, `src/models/GranotReleaseReconciliationCase.ts`, `src/services/granotLifecycle/releaseOwnerCommands.ts`, `scripts/migrations/granot-lifecycle-release-cases-into-booking-intake.ts`  
**Domain terms used:** [Granot Release Reconciliation Case](../../../../CONTEXT.md), [Granot Booking Reconciliation Case](../../../../CONTEXT.md), [Confirm Granot Cancellation](../../../../CONTEXT.md), [Synchronization Decision](../../../../CONTEXT.md), [Granot Observation](../../../../CONTEXT.md)

# Granot Release reconciliation

**Role:** Historical only. A [Granot Release Reconciliation Case](../../../../CONTEXT.md) is a retired owner work item. The processor no longer opens or refreshes these cases. New Release Granot Observations land on the [Granot Booking Reconciliation Case](../../../../CONTEXT.md). Existing rows stay readable for audit. They are not a Cancellation and never auto-cancelled. Conflict classifications for identity still persist as [Granot Release Discrepancy](../../../../CONTEXT.md) rows through the processor (`discrepancies.ts`), not through this module.

## Owner surface retired

`maybeReconcileRelease` is **removed** from `processor.ts`. `createGranotReleaseReconciliation` is not invoked from the processor. Release case/command flags stay false; do not enable them to make new owner work appear. Missing Booking is not `release_without_vantage_booking` for new traffic.

HTTP Release-case routes remain for **historical** open cases until an operator runs the migrate helper and those cases resolve:

| Method | Path | Command | HTTP |
|--------|------|---------|------|
| `POST` | `/api/v1/admin/granot-lifecycle/release-cases/:id/confirm-cancellation` | `createCancellation` (route telemetry `confirmGranotCancellation`) | 201 (200 on replay/`already_satisfied`) |
| `POST` | `.../update-booking` | `updateBooking` (route telemetry `updateGranotReleaseBooking`) | 200 |
| `POST` | `.../no-action` | `resolveGranotReleaseCaseNoAction` (route telemetry `resolveGranotReleaseNoAction`) | 200 |

New UI must not create these cases. Confirm Granot Cancellation for new work is `POST .../booking-cases/:id/confirm-cancellation` — see [`booking-reconciliation.md`](./booking-reconciliation.md). Official write + case-resolve CAS is shared (`officialCancellationWrite.ts`).

## Persistence contract (historical rows)

`GranotReleaseReconciliationCase` is a separate collection with fixed `action_kind:"release"` and no persisted mode. Existing rows require the deterministic Booking ID and immutable `booking_revision_at_open`. Evidence contains only Observation ID, Decision ID, capture time, and `action:"release"`. Collections are **not** dropped in this change set.

The partial-open and job/action/sequence unique indexes stay separate from Booking-case uniqueness. Resolved rows and existing evidence IDs remain immutable. New Booked or Release Observations do **not** refresh a historical Release case.

## Read-only posture

Protected technical case list/detail can still project `kind:"release"` when the caller asks for `kind=release`. Default Owner Intakes (`/intakes`) is booking-only — see [`projections.md`](./projections.md). An open historical Release case exposes command capability only when `release_commands_enabled` is true. Job timeline still renders historical `cancellation_intake` events; new Release evidence emits `booking_intake`.

## Migrate helper

Operator script (not applied to production by this change set):

`scripts/migrations/granot-lifecycle-release-cases-into-booking-intake.ts`

Package script: `migration:granot-lifecycle:release-cases-into-booking-intake`.

For each open Release case the planner finds or opens the `{normalized_job_no, action_kind:"booked"}` booking case, appends missing Release evidence (`action: "release"`), keeps/sets `review_existing_booking` when a live official Booking exists, and resolves the Release case with `outcome: "no_action"`, `reason_code: "already_handled_elsewhere"`, `reason_text: "migrated_to_booking_intake"`. It does not invent official Booking or Cancellation writes. Open `release_without_vantage_booking` discrepancies are left historical (`discrepancy.action: "leave_historical"`). Apply requires `--confirm-production` matching the connected name; historical DB is refused.

## Historical Owner commands

Implementation lives in `releaseOwnerCommands.ts` (re-exported from `releaseReconciliation.ts`). Each requires `requireRegistryOwnerActor` and one `Idempotency-Key`. Flag-off is **422** `POLICY_BLOCKED`. Stale case/Booking revision is **409** `CASE_REVISION_CONFLICT` / `DOMAIN_REVISION_CONFLICT`. Create Cancellation uses the shared official-write helper. Update Booking is a complete official replacement. No Action changes only the case and Command.

Checked-in `GRANOT_LIFECYCLE_RELEASE_CASES_ENABLED=false` and `GRANOT_LIFECYCLE_RELEASE_COMMANDS_ENABLED=false`. Owner mutations on historical cases stay gated. Index report/verify is read-only; apply, deployment, and flag enablement require separate authorization. No email send is attached to these commands (`GRANOT_LIFECYCLE_EMAIL_ENABLED` stays false).
