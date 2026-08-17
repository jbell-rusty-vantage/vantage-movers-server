**Platform glossary:** [`../../../CONTEXT.md`](../../../CONTEXT.md)  
**Authority:** [Final Granot Lead Lifecycle specification](../../scripts/prototypes/granot-lead-lifecycle/specs/FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md) Sections 14.1, 23.2, 34.3–34.5  
**Primary code:** `src/models/granotLifecycleSchemas.ts`, `src/services/granotLifecycle/aggregateRevision.ts`, `scripts/migrations/granot-lifecycle-lead-provenance.ts`, `scripts/migrations/granot-lifecycle-aggregate-revisions.ts`  
**Domain terms used:** Form Lead, Call Lead, Booking, Cancellation, System of Record, Job Number

# Aggregate revisions (Unit 09 foundation)

**System of Record:** MongoDB. `domain_revision` is durable aggregate metadata, not a Sheet or memory counter. `__v` may remain for Mongoose compatibility and is not the lifecycle contract.

## Fields on Form Lead, Call Lead, Booking, and Cancellation

| Field | Rule |
|-------|------|
| `domain_revision` | Required nonnegative integer. New documents default to `0`. Revision `0` means no authoritative post-boundary lifecycle change has been recorded. |
| `last_change_id` / `last_changed_at` | Optional pair. Both absent until Unit 11 records a real `EntityChange`. One-sided pairs fail validation. |
| `change_history_started_at` | Honest start-of-history boundary. New documents receive trusted server creation time. Clients cannot supply it. Write-once outside the reviewed migration seam. |

Public/admin/trusted DTOs reject these fields. Historical collections are not write targets. Historical consolidation plans omit revision metadata; production schema defaults may attach `domain_revision: 0` and a server history boundary at insert validation without inventing `last_change_*` or `EntityChange` rows.

## Compare-and-swap primitive

Later authoritative mutations must filter `{ _id, domain_revision: expected }` and increment once. A zero-row filter is `DOMAIN_REVISION_CONFLICT`. Unit 09 supplies the primitive only. Units 10–11 own command replay, `EntityChange`, and adapter canonicalization.

## Migrations

| Command | Unit 09 scope |
|---------|----------------|
| `pnpm migration:granot-lifecycle:leads` | Form/Call missing `domain_revision -> 0` and the common history boundary |
| `pnpm migration:granot-lifecycle:revisions` | Booking/Cancellation same fill, plus normalized-Job uniqueness readiness |
| `pnpm migration:granot-lifecycle:indexes` | Reconcile the Booking unique partial Job index after a zero-collision report |

One reviewed UTC ISO boundary is persisted and reused by both apply and both verify commands. Apply is conditional on still-missing fields. Rerun never resets a positive revision or advances an existing boundary. Migrations do not write `last_change_*`, Decisions, Commands, `EntityChange`, or Sheet Sync.

## Related

- [`form-lead.service.md`](form-lead.service.md), [`call-lead.service.md`](call-lead.service.md), [`bookings.service.md`](bookings.service.md), [`cancelledLead.service.md`](cancelledLead.service.md)
- [`granotLifecycle.processor.md`](granotLifecycle.processor.md) — no revision enforcement yet
