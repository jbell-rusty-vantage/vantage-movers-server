---
type: Service
title: Aggregate revisions (Unit 09 foundation)
description: domain_revision CAS primitive and Lead provenance storage fields. Public DTOs reject these fields.
tags: [granot-lifecycle]
status: draft
stale_after: 2026-11-19
resource: src/services/granotLifecycle/aggregateRevision.ts
applies_to:
  - src/models/granotLifecycleSchemas.ts
  - src/services/granotLifecycle/aggregateRevision.ts
  - src/services/granotLifecycle/trustedLeadCreateValidation.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/granotLifecycle/aggregateRevision.ts
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
**Authority:** [Final Granot Lead Lifecycle specification](../../scripts/prototypes/granot-lead-lifecycle/specs/FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md) Sections 14.1, 23.2, 34.3–34.5  
**Primary code:** `src/models/granotLifecycleSchemas.ts`, `src/services/granotLifecycle/aggregateRevision.ts`, `src/services/granotLifecycle/trustedLeadCreateValidation.ts`, `scripts/migrations/granot-lifecycle-lead-provenance.ts`, `scripts/migrations/granot-lifecycle-aggregate-revisions.ts`  
**Domain terms used:** [Form Lead](../../../CONTEXT.md), [Call Lead](../../../CONTEXT.md), [Booking](../../../CONTEXT.md), [Cancellation](../../../CONTEXT.md), [System of Record](../../../CONTEXT.md), [Job Number](../../../CONTEXT.md)

# Aggregate revisions (Unit 09 foundation)

**System of Record:** MongoDB. `domain_revision` is durable aggregate metadata, not a Sheet or memory counter. `__v` may remain for Mongoose compatibility and is not the lifecycle contract.

## Fields on Form Lead, Call Lead, Booking, and Cancellation

| Field | Rule |
|-------|------|
| `domain_revision` | Required nonnegative integer. New documents default to `0`. Revision `0` means no authoritative post-boundary lifecycle change has been recorded. |
| `last_change_id` / `last_changed_at` | Optional pair. Both absent until an existing canonical adapter records a real `EntityChange`. One-sided pairs fail validation. |
| `change_history_started_at` | Honest start-of-history boundary. New documents receive trusted server creation time. Clients cannot supply it. Write-once outside the reviewed migration seam. |

Public/admin DTOs reject these fields and the Unit 12 Lead provenance fields (`ingestion_origin`, ingested/Granot snapshots, current provenance, temporal winner, `granot_contact_revision`, bounded contact summary, Call `ringcentral_convergence`). Shared provenance/temporal/convergence sub-schemas in `granotLifecycleSchemas.ts` are storage only. Trusted Granot create validators (`trustedLeadCreateValidation.ts`) force `post_to_granot=false` and are invoked only by `createLeadFromGranot`. That command stamps the Lead creation Change (`revision_before:0`) and the active Record Link Change in the same transaction. Unit 19 adds no migration or index. Historical collections are not write targets. Historical consolidation plans omit revision metadata; production schema defaults may attach `domain_revision: 0` and a server history boundary at insert validation without inventing `last_change_*` or `EntityChange` rows. Unit 13 extends `pnpm migration:granot-lifecycle:leads` with fail-closed `legacy_unknown` origin, `normalizeJobNo(job_no)` only, and `legacy_baseline` snapshots from current contact/move fields. It never rewrites business values, `captured_at_ingestion`, revisions, or the history boundary. `baseline_captured_at` is a separately persisted reviewed timestamp and is not `change_history_started_at`. The seven named non-unique Lead indexes are created by `pnpm migration:granot-lifecycle:indexes`. Report writes zero documents/indexes; production apply requires separate authorization. // pragma: allowlist secret

## Compare-and-swap primitive

Later authoritative mutations must filter `{ _id, domain_revision: expected }` and increment once. A zero-row filter is `DOMAIN_REVISION_CONFLICT`. Existing adapters and `createLeadFromGranot` / `synchronizeLeadFromGranot` / Owner Booking commands stamp this pair from the persisted `EntityChange`. `confirmGranotBooking`, `updateBooking`, and `resolveGranotBookingCaseNoAction` exist and stay gated by `GRANOT_LIFECYCLE_BOOKING_COMMANDS_ENABLED`. Release/Referral commands remain unavailable.

## Migrations

| Command | Scope |
|---------|----------------|
| `pnpm migration:granot-lifecycle:leads` | Unit 09 Form/Call revision `0` + common history boundary, plus Unit 13 additive origin / normalized Job / `legacy_baseline` snapshots |
| `pnpm migration:granot-lifecycle:revisions` | Booking/Cancellation same fill, plus normalized-Job uniqueness readiness |
| `pnpm migration:granot-lifecycle:indexes` | Predecessor lifecycle indexes, Booking unique partial Job index after a zero-collision report, and the seven non-unique Lead S08 indexes |

One reviewed UTC ISO history boundary and a separately reviewed `baseline_captured_at` are persisted and reused by apply/verify. Apply is conditional on still-missing fields. Rerun never resets a positive revision, advances an existing boundary, overwrites `captured_at_ingestion`, or guesses a deterministic origin. Unknown/ambiguous origin is `legacy_unknown`. Normalization collisions are inventory only. Migrations do not write `last_change_*`, Decisions, Commands, `EntityChange`, or Sheet Sync. Artifacts are two gitignored files: an access-limited apply/rollback manifest with exact IDs, and a PII-safe review projection.

## Related

- [`form-lead.service.md`](form-lead.service.md), [`call-lead.service.md`](call-lead.service.md), [`bookings.service.md`](bookings.service.md), [`cancelledLead.service.md`](cancelledLead.service.md)
- [`granotLifecycle.processor.md`](granotLifecycle.processor.md) — `createLeadFromGranot` and `synchronizeLeadFromGranot` persist creation/mutation Changes in the executor transaction
