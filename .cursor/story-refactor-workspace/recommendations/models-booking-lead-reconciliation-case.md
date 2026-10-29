# Pending Booking-to-Lead attachment evidence

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/BookingLeadReconciliationCase.ts`
- Knowledge: `docs/knowledge/services/bookings.md`, `docs/knowledge/services/employee-bookings.md`

## Current storage contract

One case per Booking stores submission/source, candidates, retry lease, attempts, resolution history and revision. This differs from Granot official Leadless Booking and Granot booking intake.

## Remaining naming and organization work

Group submitted facts, matching evidence, retry and resolution schemas. Keep uniqueness/default model/optimistic concurrency; do not claim schema enforces append-only history when it does not.

No schema, collection, index, default, enum or model-registration change is authorized. Public model names already expressing the domain should remain. Preserve importing callers and guarded writes; keep exact aliases if an exported helper changes.

## Current exports

`BookingLeadReconciliationCaseDocument`; `BookingLeadReconciliationCase`

## Parity checks for future implementation

Submission minimum; candidate/status enums; unique Booking; retry indexes; independent revision; Form preference remains evaluator-owned; no official fact created.

Use schema validation and declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require it. Declared indexes do not prove production installation. Inspect existing tests before relying on them; this documentation refresh executed no runtime/production checks.
