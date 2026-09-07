# Mark Leftover Artifacts For Later Janitor Without Rewriting How The Delivery Ended, Then Trash Only Failed Or Cancelled Leftovers — Never Trash A Published Snapshot, Never Delete A Visible Tab — operational story

- Status: recommended
- Service: `reporting` (Wave A, in-progress)
- Pass: 23 of this service — `cleanup.ts`
- Remaining in this service: `ownershipMarker.ts`, `registryFilters.ts`, remaining `google/*` adapters, remaining `live/*` harness
- Target: `src/services/reporting/cleanup.ts`
- Knowledge: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (primary code is `reporting.service.ts`. Role: Owner-designed, checksum-bound reports. Happy path: preview → immutable revision → two-step confirmed run → **worker write**. Cron table names `/api/cron/reporting-delivery-heartbeat` (+ health-scan, cleanup, test-artifact janitor) — it never names this file, `enqueueIncompleteArtifactCleanup`, `runReportingCleanupJanitor`, `cleanupDeliveryArtifacts`, `positivelyMarkedForCleanup`, `cleanup.state`, `staging_not_hidden`, or `cleanup_retry` — do not add a Reporting Service file in this rename so “the Service sentence wins”). Distinct from already-recommended persist: [`reporting-delivery-repository.md`](reporting-delivery-repository.md) (`patchReportingDeliveryCleanup` / `listCleanupPendingDeliveries` / `loadReportingDelivery` are the persist **adapter** this file **asks** — leftover patch refuses `status` and any key that is not `cleanup.*`; leftover list is `cleanup.state: "pending"` oldest `updated_at`; this file never writes `ReportingDelivery.status`). Distinct from already-recommended claim / write / fail / cancel: [`reporting-reporting-worker.md`](reporting-reporting-worker.md) (`failRun` transitions the run and fenced-patches delivery `failed` **before** snapshot verify **asks** enqueue; `cancelIfRequested` cancels the run and fenced-patches delivery `cancelled` **before** enqueue; replace-tab verify fail **asks** `failRun` and does **not** enqueue). Distinct from already-recommended tell: [`reporting-reporting-observability.md`](reporting-reporting-observability.md) (`emitReportingCleanupJanitorFailed` is `staging_not_hidden` only — `cleanup_retry` does **not** **ask** leftover tell; leftover health-scan backlog **asks** `listCleanupPendingDeliveries` from Wave B cron, not this file). Distinct from leftover live-test janitor: `live/testArtifactJanitor.ts` (harness_container folders under the export root; **asks** `recordReportingLiveTestJanitorOutcome`; Wave B `/api/cron/reporting-test-artifact-janitor` **asks** leftover live, not this file). Distinct from leftover live cleanup helper: `live/liveTestCleanup.ts` (`trashHarnessContainerWithConfirmation` — live test folders, not delivery workbooks). Distinct from leftover Drive trash **adapter**: `google/reportingDriveAdapter.ts` (`trashFile` **asks** `assertSafeToTrashReportingArtifact` — identity / spreadsheet MIME / `ownedByMe` / Drive `appProperties` run match; this file **asks** trash with `expectedRunId` / `expectedDestinationId` and never asserts). Distinct from leftover Sheets marker **adapter**: `google/reportingSheetsAdapter.ts` (`verifyOwnershipAndRunMarkers` is ZZ1 ownership + ZY1 run marker; `deleteSheet` is by `sheetId`, never by title). Distinct from leftover unvisited `ownershipMarker.ts` / `google/runMarker.ts` (`positivelyMarkedForCleanup` **asks** `runMarkerMatches` only and **ignores** `ownershipRaw`; leftover janitor never **asks** `positivelyMarkedForCleanup`). Distinct from Wave B `src/routes/reporting-cron.routes.ts` (`/api/cron/reporting-cleanup-janitor` **asks** `runReportingCleanupJanitor` `{ drive, sheets, limit: 25 }`; leftover health-scan **asks** `listCleanupPendingDeliveries(100)` then leftover scan — it does **not** **ask** this file). Distinct from `api/queues/reporting-consumer.ts` (after leftover worker, **asks** leftover janitor `{ drive, sheets, limit: 10 }` only when `REPORTING_GOOGLE_DELIVERY_ENABLED`). This is not Admin Analytics and not Sheet Sync. This checkout’s `CONTEXT.md` does not define Reporting / Reporting Sheets — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001 Mongo SoR).
- Callers: leftover `reportingWorker.ts` (**asks** `enqueueIncompleteArtifactCleanup` after cancel `artifact.workbookId` twice — after persist-before-write, during stream write; after snapshot `VERIFICATION_MISMATCH` `failRun` **asks** enqueue `artifact.workbookId`; replace-tab verify fail **asks** `failRun` only). Wave B `src/routes/reporting-cron.routes.ts` (**asks** `runReportingCleanupJanitor` `{ drive, sheets, limit: 25 }`). `api/queues/reporting-consumer.ts` (**asks** leftover janitor `{ drive, sheets, limit: 10 }` after leftover worker when delivery is on). Tests: leftover `reportingDelivery.test.ts` **asks** `positivelyMarkedForCleanup` true matching run marker / false `"not a marker"`; **asks** `cleanupDeliveryArtifacts` completed snapshot `skipped` and Drive never touched. Leftover `reportingDelivery.regressions.test.ts` **asks** `patchReportingDeliveryCleanup` rejecting `status: "cleanup_pending"` and `void enqueueIncompleteArtifactCleanup` as the contract name. Leftover `reporting.test.ts` does **not** **ask** `runReportingCleanupJanitor`. Leftover heartbeat / leftover health-scan / leftover live test janitor do **not** import this file.
- Seams callers need: mark-leftover-artifacts-for-later (`enqueueIncompleteArtifactCleanup`) vs walk-the-cleanup-janitor (`runReportingCleanupJanitor`) vs trash-or-delete-one-failed-or-cancelled-leftover (`cleanupDeliveryArtifacts`) vs mark-without-rewriting-terminal-truth (`patchReportingDeliveryCleanup`). The mark / trash **seam** exists because leftover worker **asks** leftover enqueue under the lease after terminal fail or cancel; leftover cron / leftover consumer **ask** leftover janitor after the lease is gone — leftover janitor has **no** fence. The snapshot-trash-workbook / replace-tab-delete-hidden-staging **seam** exists because leftover snapshot **asks** Drive `trashFile` on each unique artifact id (`cleanup.artifact_ids` plus `workbook_id`); leftover replace-tab **asks** list sheets, refuse a visible staging tab by immutable `sheetId`, then `verifyOwnershipAndRunMarkers` + `deleteSheet`. The tell-visible-staging / retry-quietly **seam** exists because `staging_not_hidden` **asks** leftover tell and sets `cleanup.state: "failed"`; leftover catch `cleanup_retry` stays `pending` and does **not** **ask** leftover tell. The official-delivery / live-test-janitor **seam** exists because leftover live **asks** harness folders, not `ReportingDelivery`. The unused “positively marked” / Drive assert **seam** exists because `positivelyMarkedForCleanup` is a test fold of `runMarkerMatches`; leftover janitor **asks** `drive.trashFile` / `sheets.verifyOwnershipAndRunMarkers`. There is no begin / complete Domain Command **seam**. There is no run-transition **seam**. There is no Analytics **seam**. There is no Sheet Sync **seam**.
- Split later (only if the file outgrows one sitting): this ~168-line file is one sitting if you read it as mark leftover artifacts for later janitor without rewriting how the delivery ended, then trash only failed or cancelled leftovers — never trash a published snapshot, never delete a visible tab. Do **not** split into `enqueue.ts` / `janitor.ts` / `create.ts` / `update.ts` / `delete.ts`. Do **not** pull leftover worker `failRun`, leftover Drive `assertSafeToTrashReportingArtifact`, leftover live test janitor, or leftover actor audit here so “one cleanup file owns the company.” If it later splits: `markLeftoverArtifactsForLaterJanitor.ts` / `walkTheCleanupJanitor.ts` / `trashOrDeleteOneFailedOrCancelledLeftover.ts` only as later story files, never CRUD.

`enqueueIncompleteArtifactCleanup` / `runReportingCleanupJanitor` / `cleanupDeliveryArtifacts` / `positivelyMarkedForCleanup` are executor mechanics. The owner question is: *The worker already failed or cancelled this delivery. Remember the leftover Google artifacts on the delivery row without changing how the delivery ended. Later, cron or the queue consumer walks the pending list. Trash a failed or cancelled snapshot workbook only after Drive proves it is ours. Delete a replace-tab staging sheet only when it is hidden and the ownership and run markers match — never by tab name. If the staging tab is visible, stop, mark cleanup failed, and tell the owner. If Google throws, leave cleanup pending and try again later. Never trash a completed snapshot. Never rewrite `failed` / `cancelled` / `completed`. Never fail the run from here.*

Already-recommended leftover persist, leftover worker fail / cancel, leftover tell, leftover Drive trash assert, leftover Sheets markers, leftover live test janitor already live in other **modules**. Do not pull those in.

## What this file actually does

Three operations of one “mark leftover artifacts for later janitor without rewriting how the delivery ended, then trash only failed or cancelled leftovers” story, not “a cleanup CRUD service,” and not leftover worker `failRun` / leftover live test janitor:

1. **Mark leftover artifacts for later janitor without rewriting terminal truth** — `enqueueIncompleteArtifactCleanup`. Load the delivery. Merge `input.artifactIds` onto `existing.cleanup.artifact_ids` as a unique set. **Ask** `patchReportingDeliveryCleanup` `{ "cleanup.state": "pending", "cleanup.artifact_ids": merged, "cleanup.updated_at": now }`. Leftover worker **asks** this after cancel (any strategy, `artifact.workbookId`) and after snapshot `VERIFICATION_MISMATCH` only. Replace-tab verify fail does **not** enqueue. This file does not set delivery `status`. This file does not transition the run.

2. **Walk the cleanup janitor** — `runReportingCleanupJanitor`. **Ask** `listCleanupPendingDeliveries(limit ?? 25)`. For each pending delivery, **ask** `cleanupDeliveryArtifacts`. Count `cleaned` when the result is `"cleaned"`; count everything else (`"skipped"` or `"failed"`) as `skipped`. Return `{ processed, cleaned, skipped }`. Wave B leftover cleanup cron **asks** limit 25. Leftover queue consumer **asks** limit 10 after leftover worker when Google delivery is on. This file does not publish a wake-up. This file does not **ask** leftover health-scan.

3. **Trash or delete one failed or cancelled leftover — or wait, fail quietly, or refuse a visible staging tab** — `cleanupDeliveryArtifacts`. If delivery `status` is not `failed` or `cancelled`, return `"skipped"` without touching Drive (a completed snapshot workbook is the published artifact). Collect unique artifact ids from `cleanup.artifact_ids`; leftover snapshot also appends `workbook_id`. Snapshot path: skip already-trashed files; **ask** leftover Drive `trashFile` with `expectedRunId` / `expectedDestinationId` (leftover adapter asserts identity, spreadsheet MIME, `ownedByMe`, Drive appProperties). Replace-tab path: ignore the looped artifact id; if `staging_sheet_id` is missing, continue; list sheets and find the staging tab by immutable `sheetId`; if the tab is gone, continue; if the tab is visible, patch `cleanup.state: "failed"` + `last_error_code: "staging_not_hidden"`, increment `attempts` from the in-memory delivery, **ask** leftover `emitReportingCleanupJanitorFailed`, return `"skipped"`; if hidden, **ask** leftover `verifyOwnershipAndRunMarkers` then leftover `deleteSheet` by `sheetId` — never by title. After the loop, patch `cleanup.state: "completed"` and return `"cleaned"`. Catch any throw: reload the delivery, patch `cleanup.state: "pending"` + `last_error_code: "cleanup_retry"`, increment `attempts` from the reloaded row, return `"failed"`. Do not **ask** leftover tell on leftover retry.

`positivelyMarkedForCleanup` is a fold of leftover `runMarkerMatches`. It is not a fourth owner operation. It ignores `ownershipRaw`. Leftover janitor never **asks** it. Do not teach leftover cron to **ask** it instead of leftover `cleanupDeliveryArtifacts`.

## Organization

Keep one file. This is the screenplay for “mark leftover artifacts for later janitor, then trash only failed or cancelled leftovers.” Leftover persist, leftover worker fail / cancel, leftover tell, leftover Drive trash assert, leftover Sheets markers, leftover live test janitor already live in deeper **modules**. Do not pull those in. Do not invent a `ReportingCleanupService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second leftover Google-trash **adapter** beside leftover `drive.trashFile`. Do not invent a second leftover tell **adapter** beside leftover `emitReportingCleanupJanitorFailed`.

Do not split leftover enqueue / leftover janitor / leftover one-delivery trash into CRUD files. Leftover enqueue stays with leftover janitor because leftover worker marks and leftover cron / leftover consumer trash the same `cleanup.*` bag. Do not start leftover `failRun` from this file. Do not start leftover `runTestArtifactJanitor` from this file. Do not start leftover `transitionReportingRun` from this file. Do not move this into leftover `live/` so “every janitor lives together.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `enqueueIncompleteArtifactCleanup` | `markLeftoverArtifactsForLaterJanitor` | leftover worker cancel / leftover snapshot verify fail |
| `runReportingCleanupJanitor` | `walkTheCleanupJanitor` | Wave B leftover cleanup cron + leftover queue consumer |
| `cleanupDeliveryArtifacts` | `trashOrDeleteOneFailedOrCancelledLeftover` | leftover janitor + leftover completed-snapshot test |
| `positivelyMarkedForCleanup` | `theRunMarkerMatchesThisDelivery` | leftover test fold; no runtime caller |

Keep the old names as one-line aliases until leftover `reportingWorker.ts`, leftover Wave B leftover cleanup cron, leftover `api/queues/reporting-consumer.ts`, leftover `reportingDelivery.test.ts`, and leftover `reportingDelivery.regressions.test.ts` migrate. Do not make leftover worker learn leftover `walkTheCleanupJanitor` as leftover fail. Do not make leftover health-scan learn leftover `trashOrDeleteOneFailedOrCancelledLeftover` as leftover scan. Do not persist a new leftover `cleanup.last_error_code` string in this rename.

**No class for the workflow.** The type that *does* earn a name is the one leftover janitor already returns per delivery:

```ts
type CleanupOfOneDelivery = "cleaned" | "skipped" | "failed"
```

That is the handoff from “leftover cron already listed pending rows” to “leftover Drive may trash, leftover Sheets may delete a hidden staging tab, or leftover persist may leave leftover pending.” Do **not** put leftover `status: "cleanup_pending"` on this type. Do **not** put leftover live-test leftover harness leftover tags on this type.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// cleanup.ts
// The worker already failed or cancelled this delivery.
// Remember the leftover Google artifacts without changing
// how the delivery ended.
// Later, trash a failed snapshot workbook only after Drive
// proves it is ours.
// Delete a replace-tab staging sheet only when it is hidden
// and the markers match — never by tab name.
// If the staging tab is visible, stop and tell the owner.
// If Google throws, leave cleanup pending and try again.
// Never trash a completed snapshot.
// Never rewrite failed / cancelled / completed.

// ── 1. Mark leftover artifacts for later ──────────────────

export async function markLeftoverArtifactsForLaterJanitor(input)
  // leftover loadReportingDelivery
  // leftover merge unique artifact ids
  // leftover patch cleanup.state pending — never status

export const enqueueIncompleteArtifactCleanup = markLeftoverArtifactsForLaterJanitor

// ── 2. Walk the janitor ───────────────────────────────────

export async function walkTheCleanupJanitor(deps)
  // leftover listCleanupPendingDeliveries
  // leftover trash or delete each
  // leftover "failed" counts as skipped

export const runReportingCleanupJanitor = walkTheCleanupJanitor

// ── 3. Trash or delete one leftover ───────────────────────
export async function trashOrDeleteOneFailedOrCancelledLeftover(input)
  // load status — completed/writing/promoting skip with no Drive
  // snapshot: drive.trashFile after getFile
  // replace-tab visible staging: tell owner, cleanup.failed
  // replace-tab hidden staging: markers then deleteSheet
  // Google throw: cleanup.pending + cleanup_retry

export const cleanupDeliveryArtifacts = trashOrDeleteOneFailedOrCancelledLeftover

export function theRunMarkerMatchesThisDelivery(input)
  // runMarkerMatches only — ownershipRaw unused
export const positivelyMarkedForCleanup = theRunMarkerMatchesThisDelivery
```

Read the snapshot-cancel path out loud: *`cancelIfRequested` already marked the run cancelled and fenced-patched delivery `cancelled`. Then the worker asks `markLeftoverArtifactsForLaterJanitor` with `artifact.workbookId`. Cron later asks `walkTheCleanupJanitor`. `trashOrDeleteOneFailedOrCancelledLeftover` sees `cancelled`, asks Drive `trashFile`, and marks `cleanup.state: "completed"`. This file never wrote `status: "cancelled"`.*

Read the completed-snapshot path out loud: *Someone marked cleanup pending on a published snapshot. This file sees `status: "completed"`, returns `"skipped"`, and never calls `getFile` or `trashFile`.*

Read the visible-staging path out loud: *Replace-tab staging is still visible. This file refuses to delete by name, patches `cleanup.state: "failed"` + `staging_not_hidden`, asks `emitReportingCleanupJanitorFailed`, and returns `"skipped"`. The row leaves the pending list. A Google throw would have stayed pending as `cleanup_retry` with no tell.*

That is the operation. `cleanupDeliveryArtifacts` is not.

## Precise logic I would tighten while renaming

These are the smells I would keep as comments or tickets, not silent behavior changes.

1. **`positivelyMarkedForCleanup` is unused at runtime.** It wraps `runMarkerMatches` and ignores `ownershipRaw`. Acceptance 17 calls it, then calls Drive `trashFile` itself. The janitor never asks it — snapshot trash goes through `drive.trashFile` / `assertSafeToTrashReportingArtifact`, replace-tab delete goes through `verifyOwnershipAndRunMarkers`. Do not silently start calling it from the janitor so “the name becomes honest.”

2. **Replace-tab ignores the queued artifact ids.** Enqueue stores `artifact.workbookId` (the destination workbook). The replace-tab branch never uses the looped `artifactId`; it uses `staging_sheet_id` + `workbook_id` on the delivery. Do not silently start trashing that workbook id so “the queue is used.”

3. **Replace-tab verify fail never enqueues.** Worker enqueue sites are cancel (any strategy) and snapshot `VERIFICATION_MISMATCH` only. Other `failRun` paths, including replace-tab verify fail, do not mark `cleanup.state: "pending"`. Do not silently enqueue from those fails so “every leftover staging tab is janitored.”

4. **Visible staging is a one-shot refuse.** `staging_not_hidden` sets `cleanup.state: "failed"` and tells the owner. `cleanup_retry` stays `pending` and does not tell. Do not silently emit janitor-failed from the retry catch so “every Google throw notifies.” Do not silently leave visible staging pending so “the janitor retries hide.”

5. **Janitor counts `"failed"` as skipped.** `walkTheCleanupJanitor` increments `skipped` unless the result is `"cleaned"`. Do not silently add a `failed` counter so “the cron JSON is honest” in this rename — Wave B leftover cron spreads the return as-is.

6. **Attempts increment from two clocks.** Visible staging uses in-memory `input.delivery.cleanup.attempts`. Retry reloads then uses `latest.cleanup.attempts`. Do not silently unify those so “attempts are one source” without proving concurrent janitor walks.

7. **Replace-tab with no staging still “cleans.”** Missing `staging_sheet_id` or a missing sheet `continue`s, then the function patches `cleanup.state: "completed"`. Do not silently return `"skipped"` so “cleaned means we deleted something.”

8. **Leave sibling files alone.** Persist stays in leftover `reportingDeliveryRepository.ts`. Worker fail / cancel stays in leftover `reportingWorker.ts`. Tell stays in leftover `reportingObservability.ts`. Drive trash assert stays in leftover `google/reportingDriveAdapter.ts`. Live test janitor stays in leftover `live/testArtifactJanitor.ts`. Do not open unvisited leftover `ownershipMarker.ts` this pass.

## Testing

The **interface** is the test surface. Existing asserts: leftover `positivelyMarkedForCleanup` is true for a matching run marker and false for `"not a marker"`; leftover `cleanupDeliveryArtifacts` on a completed snapshot returns `"skipped"` and never touches Drive; leftover `patchReportingDeliveryCleanup` rejects `status: "cleanup_pending"`. No leftover `runReportingCleanupJanitor` walk is locked. No leftover replace-tab visible-staging tell is locked. No leftover enqueue merge is locked.

Add proofs at the new names (later implementer; not this Cloud pass):

- mark for later: leftover persist **asks** leftover `cleanup.state: "pending"`; leftover `status` is unchanged; leftover artifact ids are a unique merge
- walk the janitor: leftover list default 25; leftover `"cleaned"` increments leftover `cleaned`; leftover `"skipped"` and leftover `"failed"` increment leftover `skipped`
- completed snapshot: leftover Drive leftover `getFile` / leftover `trashFile` are not called
- snapshot failed/cancelled: leftover Drive leftover `trashFile` leftover **asks** leftover `expectedRunId` / leftover `expectedDestinationId`; already-trashed leftover files leftover continue
- replace-tab hidden staging: leftover `verifyOwnershipAndRunMarkers` then leftover `deleteSheet` by leftover `sheetId`; leftover title is not the delete key
- replace-tab visible staging: leftover `cleanup.state: "failed"`; leftover `last_error_code: "staging_not_hidden"`; leftover tell leftover **asks** leftover `emitReportingCleanupJanitorFailed`; leftover return leftover `"skipped"`
- Google throw: leftover `cleanup.state: "pending"`; leftover `last_error_code: "cleanup_retry"`; leftover tell is not called; leftover return leftover `"failed"`
- never rewrite terminal truth: leftover `ReportingDelivery.status` is not patched; leftover `transitionReportingRun` is not called
- never leftover live janitor: leftover `runTestArtifactJanitor` is not called

Do not add helper-unit tests for leftover `theRunMarkerMatchesThisDelivery`. Do not boot leftover live Google, leftover queue publisher, or leftover destination desk. Do not replace leftover worker leftover `failRun` tests with this file so “one test owns both stories.” Do not assert leftover Drive leftover `assertSafeToTrashReportingArtifact` categories as if they were leftover `trashOrDeleteOneFailedOrCancelledLeftover`.

## What I would not do

- I would not implement this pass.
- I would not rewrite `recommendations/form-lead.md`.
- I would not edit `src/`, tests, routes, models, or `docs/knowledge/`.
- I would not invent a CONTEXT.md term or an ADR. CONTEXT.md does not define Reporting.
- I would not open Wave B (`src/routes/reporting-cron.routes.ts`, `src/routes/reporting.routes.ts`).
- I would not write a whole-folder Reporting recommendation.
- I would not introduce a `ReportingCleanupService` class or a `create.ts` / `update.ts` / `delete.ts` / `enqueue.ts` split.
- I would not invent a second leftover Google-trash **adapter** beside leftover `drive.trashFile`.
- I would not pull leftover worker leftover `failRun`, leftover live leftover test leftover janitor, leftover actor leftover audit, or leftover Drive leftover assert into this file.
- I would not silently enqueue leftover cleanup from leftover replace-tab leftover `failRun`.
- I would not silently emit leftover janitor-failed from leftover `cleanup_retry`.
- I would not silently trash leftover replace-tab leftover `workbookId`.
- I would not silently start leftover janitor leftover **asking** leftover `positivelyMarkedForCleanup`.
- I would not open unvisited leftover `ownershipMarker.ts` while this checklist still has unchecked modules after this row.
- I would not silently reorder ADR-known side effects.
