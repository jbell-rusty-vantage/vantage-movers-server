# Apply authorized observation to matched Lead and link

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/granotLifecycle/synchronizeLeadFromGranot.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/desired-state.md`, `docs/knowledge/granot-lifecycle/processor.md`, `docs/knowledge/granot-lifecycle/revisions.md`, `docs/knowledge/services/domain-commands.md`

## Current operation and boundaries

Command revalidates desired state against live receiver/temporal facts then records Decision/link/Lead Change/Command/outbox atomically. Pure temporal advance is not EntityChange. Processor wrapper separately mirrors successful Form results to Call sibling after commit.

## Remaining recommendation

Keep typed race errors and public command stable. Name revalidation, link classification, Lead mutation and winner-only advancement by guarded outcome; preserve idempotency/checksum and keep callLeadFormSibling separate.

Preserve compatibility aliases while live callers migrate. Stored command names, event keys, reason codes, collection names, checksums and DTO fields are contracts, not rename targets. No policy change, flag enablement, migration or production write is authorized.

## Current exports to account for

`SynchronizeLeadRaceError`; `SynchronizeLeadFromGranotInput`; `synchronizeLeadFromGranot`; `AuthorizedPathError`; `receiverAgentCatalogStamps`; `granotSnapshotDiffersFromIngested`

## Parity proof

Manual receiver race; snapshot never overwrites caller phone; stale/lost revision/link replan; association-only versus changed Lead; replay/conflict; atomic outbox/evidence; zero-effect winner advance and post-commit order.

Start with existing target unit/replica suites and direct importing callers. Add only missing behavior proofs for the selected cleanup; run affected suites and typecheck migrated callers. This documentation refresh ran no runtime tests.
