# Official Booking storage

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/BookedLead.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/booking-reconciliation.md`, `docs/knowledge/services/bookings.md`, `docs/knowledge/services/employee-bookings.md`

## Current storage contract

booked_leads has conditional Lead requirement, Referral/Leadless flags, official allocations/snapshots and revision metadata. Partial unique normalized job and employee submission indexes are declared with autoIndex=false; optimisticConcurrency differs from domain_revision.

## Remaining naming and organization work

Name anonymous validate hook for job folding and conditional Lead requirement. Preserve virtual compatibility fields and index catalog. Form preference for shared jobs belongs to attachment/matching, not schema.

No schema, collection, index, default, enum or model-registration change is authorized. Public model names already expressing the domain should remain. Preserve importing callers and guarded writes; keep exact aliases if an exported helper changes.

## Current exports

`BOOKED_LEAD_NORMALIZED_JOB_INDEX`; `BookedLeadDocument`; `BookedLead`

## Parity checks for future implementation

Ordinary versus Referral/Leadless validation; job fold; index contracts; employee-only submission uniqueness; allocations required; __v separate; no invented getter.

Use schema validation and declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require it. Declared indexes do not prove production installation. Inspect existing tests before relying on them; this documentation refresh executed no runtime/production checks.
