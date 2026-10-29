# Normalize immutable receipt meaning once

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/granotLifecycle/normalization.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/capture.md`, `docs/knowledge/granot-lifecycle/identity.md`, `docs/knowledge/granot-lifecycle/normalization.md`, `docs/knowledge/granot-lifecycle/source-policy.md`

## Current operation and boundaries

Normalization owns bounded scalars, route authority, source/job/contact/move/priority/action and meaning equality. Releas/Release normalize together; strict New York dates and display money remain evidence. It never matches or mutates Leads.

## Remaining recommendation

Keep pure normalization, persistence and upsert distinct. Name parsers by accepted input/issue result, preserving canonical equality and ObservationIntegrityError behavior.

Preserve compatibility aliases while live callers migrate. Stored command names, event keys, reason codes, collection names, checksums and DTO fields are contracts, not rename targets. No policy change, flag enablement, migration or production write is authorized.

## Current exports to account for

`VANTAGE_BUSINESS_TIMEZONE`; `NORMALIZATION_FIELD_BOUNDS`; `PRIORITY_BROAD_ENRICHMENT_CANONICALS`; `ObservationIntegrityError`; `NormalizationReceiptInput`; `NormalizedObservationIssue`; `NormalizedObservationCandidate`; `ObservationStore`; `UpsertGranotObservationInput`; `UpsertGranotObservationResult`; `calendarDateInBusinessTimezone`; `normalizeBookingAction`; `isSupportedGranotBookingAction`; `extractNormalizationStatement`; `normalizeGranotReceipt`; `observationMeaningEquals`; `persistObservationCandidate`; `upsertGranotObservation`

## Parity proof

Malformed/non-object/bounded/control/bidi inputs; impossible dates/timezone; invalid priority by route; Release alias; route conflict; exact semantic replay versus changed immutable meaning.

Start with existing target unit/replica suites and direct importing callers. Add only missing behavior proofs for the selected cleanup; run affected suites and typecheck migrated callers. This documentation refresh ran no runtime tests.
