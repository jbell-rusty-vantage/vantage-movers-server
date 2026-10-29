# List safe conflicts and inspect their evidence

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/granotLifecycle/discrepancyProjections.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/projections.md`

## Current operation and boundaries

Read projections combine booking/release discrepancy work with current facts and stable cursors. They do not resolve conflicts, attach Leads or correct links. Release identity discrepancies remain live.

## Remaining recommendation

Keep list/detail operations and make listItem/cursors explain safe projection/pagination; avoid a generic repository or duplicate identity classifier.

Preserve compatibility aliases while live callers migrate. Stored command names, event keys, reason codes, collection names, checksums and DTO fields are contracts, not rename targets. No policy change, flag enablement, migration or production write is authorized.

## Current exports to account for

`GranotDiscrepancyListItem`; `GranotDiscrepancyDetail`; `listGranotLifecycleDiscrepancies`; `getGranotLifecycleDiscrepancyDetail`

## Parity proof

Both kinds; stable tied page ordering; malformed cursor; not-found envelope; safe evidence; no payload/contact leakage or writes.

Start with existing target unit/replica suites and direct importing callers. Add only missing behavior proofs for the selected cleanup; run affected suites and typecheck migrated callers. This documentation refresh ran no runtime tests.
