# Sheet Sync metadata efficiency — November 17, 2026

The owner needs lower application/database work while retaining recoverable Sheet delivery. This local slice removes repeated metadata updates when several logical jobs plan the same physical document. It is implemented and locally tested; it has not been committed, deployed or production-qualified. No production writes, retention/index changes or provider calls were made.

## Trigger and scope

The queued drainer already combines outcomes by `docKey`, but previously iterated every `PlannedDoc` when saving the combined `sheet_sync` array. A source Lead plus overlapping chain jobs could therefore write the same combined metadata several times. The preserved capacity checkout's W6 investigation identified this duplication. Only that bounded opportunity is reused here: no expired-claim reclamation, active slots, detached retries, delivery facts, idle suppression or retention behavior is imported.

`persistDocSheetSync` now selects the last surviving document plan for each `docKey`, preserving the previous last-snapshot merge and relative final-write order. Every logical outcome still contributes in original order. A later tombstone without a document cannot erase the surviving snapshot. The helper is exported within its module for focused tests; the public barrel is unchanged.

Unchanged behavior:

- Every actual metadata update first checks drain ownership. Metadata is still saved after provider delivery and before per-job finalization, outside the domain transaction.
- Confirmed deletes remove their target metadata; failed/deferred deletes do not. Uncertain upserts clear row hints and retain pending/error metadata. Untouched targets keep their saved timestamps; touched successful targets get the current persistence timestamp.
- One persistence failure or missing document fails every confirmed subscriber outcome for that document. Existing failed/deferred outcomes retain their status and error. Logical attempts, retry hints, status and Daily Operations completion identities remain independent.
- Failure now causes one metadata attempt per document in that drain. Redundant later attempts previously sometimes saved metadata after an earlier failure, but still left all jobs retryable. The next durable drain remains the recovery path and reconstructs provider identity, so the change removes that incidental retry without asserting success or losing a recovery obligation.
- Lead qualification, reporting/billing, canonical projections, provider structural-write guards, leases, coalescing and cadence do not change.

## Before/after proof

Both measurements used the actual drainer and Mongoose driver against MongoDB 8.0 in root-managed disposable container `vantage-operability-sheet-proof`, with replica `sheetRecoveryProof` advertising only `127.0.0.1:27129`. Each harness run creates and drops only its PID-named `testvantagemovers_sheetrecovery<digits>` database. The stateful workbook is synthetic and external fetch is forbidden.

The scenario gives three jobs the same Form Lead: duplicate claimed keys plus an overlapping chain identity. The first append commits but loses its response; the next drain reloads a changed canonical name and converges without a second append.

| Measured work | Before | After |
| --- | ---: | ---: |
| Metadata update calls, uncertain drain | 3 | 1 |
| BSON bytes of update documents, uncertain drain | 879 | 293 |
| Metadata update calls, recovery drain | 3 | 1 |
| BSON bytes of update documents, recovery drain | 792 | 264 |
| Total physical appends across both drains | 1 | 1 |
| Logical jobs eventually synced | 3 | 3 |

These are synthetic driver update-call and BSON update-document measurements, excluding query filter, command envelopes and transport overhead. They do not measure production frequency, latency, oplog bytes, disk allocation or filesystem recovery. An explicit intervening canonical name update is excluded from the metadata counts.

Before output was captured from the successful tool execution (`6b6261`, exit 0), then preserved verbatim in [before log](../operations/evidence/sheet-metadata-before-2026-11-17.log); it was not originally redirected to disk. [After log](../operations/evidence/sheet-metadata-after-2026-11-17.log) is direct tee output from the final guarded harness. Both use `node --import tsx ops/sheet-sync-recovery/replica.ts`; the baseline preceded the dedupe and its new one-update assertions.

## Validation and limitations

- Before the runtime change, the new focused test file reproduced three expected failures (3 passes/3 failures): overlapping success wrote 3 instead of 2 physical documents; thrown and missing-document persistence wrote 3 instead of 1. After the change, all six passed with zero skips.
- Sheet Sync, Google Sheets, Admin Sheet Sync and cron focused suite: 160 passed, zero failed/skipped. Command: `node --import tsx --import ./ops/test-setup.ts --test --test-concurrency=2 "src/services/sheetSync/**/*.test.ts" "src/services/googleSheets/**/*.test.ts" src/services/admin/adminSheetSync.service.test.ts src/routes/sheet-sync-cron.routes.test.ts`.
- Actual replica suite: seven proofs passed before and after. Besides the measured overlap it covers domain/outbox transaction rollback, uncertain delete and neighbor preservation, independent financial retry hints, metadata failure followed by recovery, competing owner/takeover, and topology fencing. It injects boundaries; it does not kill an operating-system worker.
- Scoped runtime/test ESLint passed. Whole-project typecheck and final integrated validation are recorded by the coordinating review in [qualification](../operations/QUALIFICATION-2026-11-17.md).
- The harness now reuses the CLI's allowlisted local environment and identity contract, preflights the exact primary via a native `directConnection` client before model imports, refuses a preexisting PID namespace, disables automatic model collection/index creation, and rechecks identity before cleanup. Its existing explicit collection/index creation remains limited to that verified disposable database.

Independent persistence review found no blocking runtime defect; it requested native preflight before model loading, which is implemented. The next proof is representative production overlap/cost observation after a separately authorized release, with unchanged per-job outcomes and actual downstream delivery. No new flag, migration or index is required. Rollback to the prior application restores redundant metadata updates; existing job, attempt and metadata formats remain readable, and no queue reset or data cleanup is needed.
