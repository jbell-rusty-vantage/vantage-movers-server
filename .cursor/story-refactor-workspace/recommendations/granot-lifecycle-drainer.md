# Claim due receipts and finalize under the winning fence

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/granotLifecycle/drainer.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/drainer.md`

## Current operation and boundaries

Queue, cron and synchronous callers share Mongo due-claims and owner/epoch fences. Renewal/finalization stay fenced. Pending-match clocks differ from technical retry/dead letter. Automation replay may request zero polling deadline; claim contention is not failure.

## Remaining recommendation

Name claim, fenced execution, business pending and technical failure distinctly. Keep builders/injected dependencies for real fence tests; never split by transport or move claim into processor.

Preserve compatibility aliases while live callers migrate. Stored command names, event keys, reason codes, collection names, checksums and DTO fields are contracts, not rename targets. No policy change, flag enablement, migration or production write is authorized.

## Current exports to account for

`DrainTrigger`; `ProcessorResult`; `ClaimedReceiptSnapshot`; `ClaimResult`; `DrainItemResult`; `DrainSummary`; `AcceptedForProcessing`; `SyncClaimResult`; `buildClaimFilter`; `buildClaimUpdate`; `buildFenceFilter`; `createLeaseOwner`; `DrainerDeps`; `drainRequestedReceipt`; `drainDueReceipts`; `claimAndProcessOrPoll`; `parseReceiptWakeup`; `emitDrainRunEvent`; `applyDueGauges`

## Parity proof

Expired recovery; active claimant skip; lost fence cannot finalize; pending offsets/24h expiry; technical retry/dead letter; processing off; terminal replay; zero-deadline polling; bounded drain concurrency.

Start with existing target unit/replica suites and direct importing callers. Add only missing behavior proofs for the selected cleanup; run affected suites and typecheck migrated callers. This documentation refresh ran no runtime tests.
