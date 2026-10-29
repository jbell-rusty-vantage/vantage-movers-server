# Project current Lead and Granot contact as separate cards

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/granotLifecycle/leadContactProjection.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/desired-state.md`

## Current operation and boundaries

The projection keeps current Lead contact separate from the qualified Granot snapshot. It never overwrites primary phone or grants unmasking.

submitted_contact comes from current top-level Lead contact, not ingested_contact_snapshot. Phone/email are masked but names are returned as stored; Granot snapshot is separate.

## Remaining recommendation

Public story is already clear; keep one small projection module and rename maskContact only if the masked-output contract becomes clearer.

Preserve compatibility aliases while live callers migrate. Stored command names, event keys, reason codes, collection names, checksums and DTO fields are contracts, not rename targets. No policy change, flag enablement, migration or production write is authorized.

## Current exports to account for

`LeadContactDisplaySource`; `MaskedLeadContact`; `RoleSafeLeadContactProjection`; `projectRoleSafeLeadContacts`

## Parity proof

Form/Call origins; missing snapshots; identical/different contact; phone/email masking, unchanged name presentation, and no new raw phone/email in DTOs.

Start with existing target unit/replica suites and direct importing callers. Add only missing behavior proofs for the selected cleanup; run affected suites and typecheck migrated callers. This documentation refresh ran no runtime tests.
