# Validate trusted Granot create shapes

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/granotLifecycle/trustedLeadCreateValidation.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/revisions.md`, `docs/knowledge/services/call-lead.md`, `docs/knowledge/services/domain-commands.md`, `docs/knowledge/services/form-lead.md`

## Current operation and boundaries

Schemas are internal to authorized lifecycle create, not public admin DTOs. Form needs reviewed contact/move minimum; Call can be sparse with valid job. Trusted omission and post_to_granot follow command, not public ingest defaults.

## Remaining recommendation

Keep two schemas for two records. Name shared minimum checks; do not widen public input or close mint paths through a validation rename.

Preserve compatibility aliases while live callers migrate. Stored command names, event keys, reason codes, collection names, checksums and DTO fields are contracts, not rename targets. No policy change, flag enablement, migration or production write is authorized.

## Current exports to account for

`trustedGranotFormLeadCreateSchema`; `trustedGranotCallLeadCreateSchema`; `TrustedGranotFormLeadCreateInput`; `TrustedGranotCallLeadCreateInput`

## Parity proof

Form name/phone/zips/states and optional date; Call job-only minimum; invalid job/contact; forbidden metadata; no persistence/provider call.

Start with existing target unit/replica suites and direct importing callers. Add only missing behavior proofs for the selected cleanup; run affected suites and typecheck migrated callers. This documentation refresh ran no runtime tests.
