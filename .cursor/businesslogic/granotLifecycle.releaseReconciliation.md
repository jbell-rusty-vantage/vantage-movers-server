---
type: Service
title: Granot Release reconciliation
description: Separate Release cases plus gated Owner create-Cancellation, Booking replacement, and No Action.
tags: [granot-lifecycle]
status: draft
stale_after: 2026-11-19
resource: src/services/granotLifecycle/releaseReconciliation.ts
applies_to:
  - src/services/granotLifecycle/releaseReconciliation.ts
  - src/models/GranotReleaseReconciliationCase.ts
  - src/services/granotLifecycle/processor.ts
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
  by: process:okf-docs-conversion
  at: 2026-08-21T02:20:00Z
---
**Platform glossary:** [`../../../CONTEXT.md`](../../../CONTEXT.md)  
**Primary code:** `src/services/granotLifecycle/releaseReconciliation.ts`, `src/models/GranotReleaseReconciliationCase.ts`, `src/services/granotLifecycle/processor.ts`, `src/services/granotLifecycle/projections.ts`  
**Domain terms used:** [Granot Release Reconciliation Case](../../../CONTEXT.md), [Synchronization Decision](../../../CONTEXT.md), [deterministic Booking](../../../CONTEXT.md), [Granot Observation](../../../CONTEXT.md)

# Granot Release reconciliation

**Role:** Persist owner work for an actual Granot Release, then allow an Owner to explicitly create the official Cancellation, fully replace the existing Booking, or resolve No Action. Automatic processing still never changes a Booking, Cancellation, Lead, Record Link, Sheet, or discrepancy. A Release case is not itself a Cancellation and is separate from a Booking case.

## Trigger and routing

The processor is the only automatic caller. It invokes the service only for post-activation `live` evidence whose independent `booking_action.normalized` is `release`, whose reviewed source gates all allow the effect, and whose Release-case flag is true. Malformed Priority does not suppress an otherwise valid Release. Shadow, disabled/deferred/unclassified source policy, missing Job, unsupported action, or a false flag creates no Release case.

Inside the transaction, current Unit 14 identity and deterministic Booking/Cancellation facts are reread. One compatible active Booking opens or refreshes a case even when that Booking has no Lead. An officially cancelled Booking writes an `already_current` / `booking_already_cancelled` Decision and no case. No Booking returns `release_without_vantage_booking`; exact identity conflicts return only `release_record_link_conflict`, `release_job_number_conflict`, or `release_source_scope_conflict`. These are typed Unit 29 seams and do not persist discrepancies here.

## Persistence contract

`GranotReleaseReconciliationCase` is a separate collection with fixed `action_kind:"release"` and no persisted mode. It requires the deterministic Booking ID and immutable `booking_revision_at_open`. Evidence contains only Observation ID, Decision ID, capture time, and `action:"release"`; bounded observed display context is not official state.

One transaction allocates `max(job+release sequence)+1`, opens or refreshes the case, and inserts the causal Decision. The partial-open and job/action/sequence unique indexes are separate from Booking-case uniqueness. One bounded retry converges duplicate/open/sequence races. Exact Observation replay is a no-op. New evidence increments `evidence_revision`; an owner-relevant current Booking revision or link change increments `case_revision` without rewriting the opening Booking revision. A case never silently retargets. Resolved rows and existing evidence IDs are immutable; later evidence gets the next Release sequence.

## Read-only posture

Protected case list/detail and Job/Lead timelines project Release as `kind:"release"`, `mode:"release"`. Default lists merge Booking and Release under stable selected timestamp plus ObjectId cursor ordering. Detail shows immutable Granot evidence separately from the live deterministic Booking and current Cancellation. It has no suggestion, employee-reconciliation substitution, or candidate search. An open case exposes command capability only when `release_commands_enabled` is true. Booking and Release entries remain distinct in timelines and may coexist open for one Job.

## Owner commands

The exact Owner-only, idempotency-keyed commands are `createCancellation`, `updateBooking`, and `resolveGranotReleaseCaseNoAction`, exposed respectively at `release-cases/:id/confirm-cancellation`, `/update-booking`, and `/no-action`. Each reruns current source policy, lifecycle/effect gates, open case revision, immutable Job/Booking identity, active Record Link, and current Booking revision inside the canonical transaction. Booking replacement also revalidates active Agent/Merchant catalog rows. Referral Bookings are supported without fabricating a Lead mirror; an optional linked Lead changes only when it still matches the verified Booking/link scope.

Create Cancellation uses the cancellation service's transaction-aware primitive to CAS the active Booking, insert exactly one complete `CancelledLead`, optionally mirror the linked Lead, append adjacent `EntityChange` rows, resolve the case, store the canonical Command result, and enqueue one `cancellation_chain` Sheet outbox intent atomically. A verified matching official cancellation is `already_satisfied` with no aggregate, Change, or Sheet write. Update Booking is a complete official replacement and enqueues one `booking_chain` intent. No Action changes only the case and Command. Replays return the stored result; checksum reuse conflicts and stale races fail closed with stable 409 errors. Queue publishing occurs only after commit.

Checked-in `GRANOT_LIFECYCLE_RELEASE_CASES_ENABLED=false` and `GRANOT_LIFECYCLE_RELEASE_COMMANDS_ENABLED=false`. Unit 26 adds no Owner mutation, official effect, Sheet intent, notification, email, or Unit 29 storage. Index report/verify is read-only; apply, deployment, and flag enablement require separate authorization.
