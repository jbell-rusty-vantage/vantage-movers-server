# Create the Lead authorized by immutable Granot evidence

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/granotLifecycle/createLeadFromGranot.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/processor.md`, `docs/knowledge/granot-lifecycle/revisions.md`, `docs/knowledge/services/domain-commands.md`, `docs/knowledge/services/lead-messaging.md`

## Current operation and boundaries

This checkout still permits Form OR Call lead_created with create_if_missing; priority_updated never mints. It reloads receipt/activation/policy/route/identity/minimum fields in transaction. Call with phone uses convergence lock; sparse job-only Call remains. Desired RingCentral-only minting is not fully enforced here.

## Remaining recommendation

Keep the command story, deterministic key/checksum, race errors and Decision/Lead/link/Change/Command/outbox atomicity. Name executeCreation, reserveRecordLink and source checks by their effect. Closing non-RingCentral mint paths is separate behavior work.

Preserve compatibility aliases while live callers migrate. Stored command names, event keys, reason codes, collection names, checksums and DTO fields are contracts, not rename targets. No policy change, flag enablement, migration or production write is authorized.

## Current exports to account for

`CREATE_LEAD_FROM_GRANOT_COMMAND_NAME`; `CreateLeadFromGranotInput`; `CreateLeadFromGranotRaceError`; `createLeadFromGranotIdempotencyKey`; `observationLoadAllowsCreateRouteEventClass`; `snapshotAllowsCreateRouteEventClass`; `createLeadFromGranotPayloadChecksum`; `createLeadFromGranot`; `dailyOperationsLeadOf`

## Parity proof

Form contact/states/zips; Call job-only/phone-lock; existing link reservation conflict; identity/policy races replan; replay/checksum conflict; post_to_granot=false; temporal CPL snapshot; Sheets before best-effort SMS/Daily Operations finalize.

Start with existing target unit/replica suites and direct importing callers. Add only missing behavior proofs for the selected cleanup; run affected suites and typecheck migrated callers. This documentation refresh ran no runtime tests.
