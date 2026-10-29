# Advance the aggregate only at the expected revision

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/granotLifecycle/aggregateRevision.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/revisions.md`

## Current operation and boundaries

The CAS primitive validates explicit id and nonnegative expected revision, uses the caller transaction, and preserves DOMAIN_REVISION_CONFLICT on a lost claim. It does not authorize domain effects or persist EntityChange.

## Remaining recommendation

Keep compareAndSwapDomainRevision as the public story; make validation and revision advancement read as one guarded operation. Do not merge Mongoose __v with domain_revision or add a wrapper for each Mongo operator.

Preserve compatibility aliases while live callers migrate. Stored command names, event keys, reason codes, collection names, checksums and DTO fields are contracts, not rename targets. No policy change, flag enablement, migration or production write is authorized.

## Current exports to account for

`DOMAIN_REVISION_CONFLICT`; `DomainRevisionCasFilter`; `DomainRevisionCasResult`; `assertDomainRevisionCasFilter`; `compareAndSwapDomainRevision`

## Parity proof

Matching revision advances once; missing id/revision rejected; stale revision changes nothing with the existing conflict; session reaches write.

Start with existing target unit/replica suites and direct importing callers. Add only missing behavior proofs for the selected cleanup; run affected suites and typecheck migrated callers. This documentation refresh ran no runtime tests.
