# Activate once or requeue a dead-letter receipt

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/granotLifecycle/operations.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/drainer.md`

## Current operation and boundaries

Activation fixes historical/live boundary with immutable actor/version evidence. Requeue is an idempotent canonical command with causal provenance and guarded dead-letter transition. Neither operation enables effects or matches Leads.

## Remaining recommendation

Keep two explicit public operations and name storage helpers by immutable activation or guarded transition. Preserve requeue command/key/checksum/provenance and best-effort wake after persistence.

Preserve compatibility aliases while live callers migrate. Stored command names, event keys, reason codes, collection names, checksums and DTO fields are contracts, not rename targets. No policy change, flag enablement, migration or production write is authorized.

## Current exports to account for

`PROCESSOR_VERSION_PATTERN`; `ActivateGranotLifecycleInput`; `GranotLifecycleActivationProjection`; `RequeueDeadLetterInput`; `RequeueDeadLetterProjection`; `RequeueCommandDeps`; `RequeueProvenanceInput`; `GRANOT_RECEIPT_REQUEUE_COMMAND_NAME`; `receiptRequeueIdempotencyKey`; `ActivationCommandDeps`; `durableActorFromOwnerActor`; `projectActivation`; `activateGranotLifecycle`; `requeueDeadLetterReceipt`

## Parity proof

Activation race preserves original boundary; version validation; exact requeue replay; non-dead-letter refused; receipt evidence/flags unchanged; wake failure cannot undo transition.

Start with existing target unit/replica suites and direct importing callers. Add only missing behavior proofs for the selected cleanup; run affected suites and typecheck migrated callers. This documentation refresh ran no runtime tests.
