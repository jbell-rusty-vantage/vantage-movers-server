# Project safe evidence, field groups and summaries

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/jobNumberTimeline/evidence.ts`
- Knowledge: `docs/knowledge/services/job-number-timeline.md`

## Current operation and boundaries

This module maps event kinds and change paths to owner stages, status, summaries, evidence level, correlation and safe refs. Form snapshot reflects stored Form facts; it is not a provider fetch or domain authority.

The Form snapshot masks name, phone, and email but displays available city, state, ZIP, move date and move size; preserve that specific projection rather than assuming all submitted fields are masked.

## Remaining recommendation

Keep projections together; name ownerGroupForPath and placeLine by their output. Consolidate repeated mapping only when the same evidence rule applies; retain explicit domain stage distinctions and no new generic event vocabulary.

Keep aliases exact while importing callers migrate. Stored enums, ids, event keys, DTOs and error shapes are contracts; naming work must preserve transaction sessions and side-effect order. This recommendation authorizes no behavior change, migration, flag enablement or external write.

## Current exports

`OwnerFieldGroup`; `stageForKind`; `ownerGroupsForPaths`; `OwnerFormSnapshot`; `formSnapshotForLead`; `leadUpdateSummary`; `evidenceLevelFor`; `eventStatus`; `eventSummary`; `correlationFor`; `evidenceRefsFor`

## Parity proof

Known/unknown paths; source/contact/move/receiver grouping; partial Form snapshot; safe refs/summary; all supported event kinds and no raw credential/contact leakage.

Start from existing target tests and actual importing callers. Add only missing outcome proofs for the chosen cleanup, run affected suites and typecheck migrated callers. This recommendation refresh ran no runtime tests.
