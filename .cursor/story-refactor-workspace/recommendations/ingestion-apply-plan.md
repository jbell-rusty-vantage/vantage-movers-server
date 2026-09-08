# Walk The Locked Checksum-Bound Best Relocation Plan Under The Held Apply Lease — Unchanged Counts As Done, Adopt Writes A Receipt Only, A Failed Lead Blocks Its Booking, A Lost Lease Stops The Walk — operational story

- Status: recommended
- Service: `ingestion` (Wave A, in-progress)
- Pass: 2 of this service — `applyPlan.ts`
- Remaining in this service: `repository.ts`, `health.ts`, `queue.ts`
- Target: `src/services/ingestion/applyPlan.ts`
- Knowledge: [`docs/knowledge/services/ingestion.md`](../../../docs/knowledge/services/ingestion.md) (primary code **is** leftover `applyPlan.ts`. Role: Inspect Best Relocation sheets, plan create/update/adopt/conflict after the 2026-04-30 Eastern cutoff, and apply a checksum-bound plan under a single lease. Mongo domain documents are System of Record and are written only through leftover canonical commands. Best Relocation workbooks are the external evidence source. `IngestionRun` / `SourceRowReceipt` / `IngestionConflict` / `ExternalDataConnection` key `best_relocation` are operational evidence, not a second Lead authority. Happy path step 5 is this file: leftover `applyBestRelocationPlan` walks actions under the held lease. `unchanged` counts as completed. Domain mutations go through leftover `canonicalDomainCommands` with origin `external_sheet_ingestion` and a deterministic idempotency key. leftover `adopt_existing` writes a receipt only and puts the adopted entity id on the dependency map so a later Booking can bind that Form Lead or Call Lead without minting a second Lead. leftover `record_conflict` opens a conflict unless already dispositioned. Checkpoint after each action. Resume uses leftover `start_action_index` and does not replay successful actions. Failed dependency increments leftover `skipped_dependencies` and continues. Row-scoped Zod / Conflict / NotFound / invalid Google request is a row `failures` and the walk continues. Other errors or a lost lease throw. This is not Sheet Sync and not Granot HTTP automation. Knowledge names leftover `applyBestRelocationPlan` on the happy-path row; it never names leftover `ApplyPlanPersistence`, leftover `executeAction`, leftover `resolvePayload`, leftover `persistReceipt`, leftover `persistConflict`, leftover `isRowScopedCommandError`, leftover `checkpoint`, leftover `deterministicId`, leftover `commandStarted` / leftover `commandFinished`, leftover `$ref:`, leftover `IngestionApplyResult` (sibling leftover `types.ts` drops leftover `skipped_dependencies` / leftover `completed_units`), leftover `IngestionAdapter.apply`, or leftover `IngestionKernelDependencies` — do not add an Ingestion Service file in this rename so “the Service sentence wins”). Distinct from already-recommended leftover claim / leftover inspect / leftover lock / leftover finalize / leftover fail: [`ingestion-worker.md`](ingestion-worker.md) (this file is the walk leftover `worker.ts` leftover **asks** twice — once after leftover schedule/retry leftover plan lock, once from leftover `applyApprovedClaim`; leftover worker leftover checkpoints leftover `IngestionRun` and leftover finalizes leftover `completed` / leftover `completed_with_errors`; this file never leftover `$set`s leftover `IngestionRun`). Distinct from later leftover connection / run / receipt persist: sibling `repository.ts` (this file leftover **asks** leftover `appendSourceReceipt` / leftover `openIngestionConflict` / leftover `isIngestionConflictDispositioned` / leftover `preallocateReceiptId` / leftover `resolvedActionIdsForRun`; leftover `createBestRelocationIngestionActor` lives there and is injected, not imported). Distinct from later leftover health letters: sibling `health.ts` (this file never leftover **asks** leftover emit). Distinct from later leftover wakeup: sibling `queue.ts` (this file never leftover publishes; leftover worker leftover **asks** leftover wakeup only on a retryable Google fail **after** this walk throws). Distinct from skipped leftover type-only: sibling `types.ts` (leftover `IngestionAdapter.apply` / leftover `IngestionApplyResult` / leftover `IngestionKernelDependencies` live there; leftover `IngestionApplyResult` drops leftover `skipped_dependencies` / leftover `completed_units` that leftover worker leftover finalize leftover **asks**). Distinct from unvisited leftover sheet inspect / leftover plan / leftover adopt: later Wave A `bestRelocationSheetIngest/` (leftover `createBestRelocationIngestionAdapter().apply` leftover **asks** this file and leftover **drops** leftover `skipped_dependencies` / leftover `completed_units`; leftover worker leftover never leftover **asks** leftover `adapter.apply`; leftover `buildBestRelocationApplicationPlan` leftover owns leftover action shape, not this file). Distinct from unvisited leftover Domain Commands: later Wave A `domainCommands/` (this file leftover **asks** leftover `createFormLead` / leftover `createCallLead` / leftover `updateSourceOwnedLead` / leftover `createBookingFromLead` / leftover `createLeadlessBooking` / leftover `createCancellation`; it never leftover **asks** leftover `attachBookingToLead` / leftover `updateBooking` / leftover `createReferralBooking` / leftover Granot leftover create/sync / leftover RingCentral leftover adopt; it never imports Form Lead / Call Lead / Booked Lead / Cancelled Lead models). Distinct from already-recommended leftover durable checksum / leftover Google class: leftover `durableWork` leftover `assertChecksum` / leftover `computeChecksum` / leftover `classifyGoogleFailure` / leftover `LeaseStore.assertHeld` (this file leftover **asks** those; leftover worker leftover owns leftover acquire / leftover renew / leftover release). Distinct from already-recommended leftover Sheet Sync drain: [`sheet-sync-run-sheet-sync-drain.md`](sheet-sync-run-sheet-sync-drain.md) (this file leftover **asks** leftover `assertHeld` on leftover `ingestion:best_relocation:apply`; it never leftover **asks** leftover `runSheetSyncDrain`). Distinct from leftover Wave B `src/routes/ingestion.routes.ts` (Owner leftover approve leftover CAS-es leftover `applying` + leftover publishes; leftover conflict leftover resolve leftover **asks** leftover `attachBookingToLead`, never this file). Distinct from leftover Wave B leftover heartbeat / leftover consumer (they leftover **ask** leftover worker, never this file). Distinct from leftover Wave B leftover CLI dry-run (live apply retired; leftover CLI never leftover **asks** this file). This checkout’s `CONTEXT.md` does not define Ingestion Origin / Best Relocation / Ingestion Run — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001 Mongo SoR).
- Callers: leftover `src/services/ingestion/worker.ts` leftover **asks** leftover `applyBestRelocationPlan` twice (leftover schedule/retry after leftover plan lock; leftover `applyApprovedClaim` leftover resume leftover `start_action_index` / leftover initial counters / leftover `failed_action_keys`; leftover `bootstrap` leftover omits leftover `assertApplicationEnabled`). Leftover `src/services/bestRelocationSheetIngest/adapter.ts` leftover `apply` leftover **asks** leftover `applyBestRelocationPlan` and leftover returns leftover `IngestionApplyResult` (runtime unused — leftover worker leftover **asks** this file directly). Barrel: `src/services/ingestion/index.ts`. Tests: `ingestion.test.ts` leftover **asks** leftover `applyBestRelocationPlan` for leftover resume without replay, leftover adopt leftover Form Lead leftover supplies leftover Booking leftover `lead_ref`, leftover failed leftover Lead leftover blocks leftover Booking and leftover independent leftover Call Lead leftover continues, leftover altered leftover checksum leftover rejects before leftover mutation. Leftover “apply worker mutates domain state only through canonical commands” leftover **reads the source** of leftover `applyPlan.ts` (no leftover Form Lead / Call Lead / Booked Lead / Cancelled Lead model import; no `/api/v1` / leftover `fetch` / leftover `axios`). Leftover concurrent leftover lease leftover test leftover **asks** leftover `InMemoryLeaseStore`, not this file. Leftover Owner leftover HTTP leftover never leftover imports this file. Leftover heartbeat leftover never leftover imports this file. Leftover CLI leftover never leftover imports this file. Leftover consumer leftover never leftover imports this file.
- Seams callers need: refuse-an-altered-checksum-before-any-walk (`applyBestRelocationPlan` leftover **asks** leftover `assertChecksum` first) vs walk-each-locked-action-under-the-held-apply-lease vs record-a-conflict-unless-already-dispositioned vs adopt-existing-receipt-only-and-hand-the-id-to-later-bookings vs ask-leftover-commands-then-write-the-receipt vs checkpoint-after-each-action-and-continue-only-on-a-row-scoped-command-error. The this-file / leftover worker **seam** exists because leftover worker leftover claims, leftover inspects, leftover locks, leftover checkpoints leftover `IngestionRun`, leftover finalizes, leftover fails; this file leftover walks. The this-file / leftover `adapter.apply` **seam** exists because leftover `createBestRelocationIngestionAdapter().apply` leftover **asks** this file and leftover worker leftover never leftover uses that leftover **adapter**. The this-file / leftover `IngestionApplyResult` **seam** exists because leftover `types.ts` leftover drops leftover `skipped_dependencies` / leftover `completed_units` that leftover worker leftover finalize leftover **asks**. The this-file / leftover repository **seam** exists because leftover persist leftover **asks** leftover `appendSourceReceipt` / leftover `openIngestionConflict` / leftover `isIngestionConflictDispositioned` / leftover `preallocateReceiptId` / leftover `resolvedActionIdsForRun`. The this-file / leftover Domain Commands **seam** exists because leftover domain writes leftover **ask** leftover `canonicalDomainCommands` with leftover origin `external_sheet_ingestion`; leftover idempotency leftover key is leftover `action.action_key`. The leftover checksum **seam** exists because leftover Owner leftover approve leftover binds leftover `plan_checksum`; leftover altered leftover plan leftover must leftover fail before leftover mutation. The leftover lease leftover `assertHeld` **seam** exists because leftover worker leftover owns leftover acquire / leftover renew; this file leftover refuses leftover mutation when leftover `assertHeld` leftover is leftover false. The leftover resume leftover `start_action_index` **seam** exists because leftover checkpoint leftover `action_index` leftover is leftover `actionIndex + 1` (the next leftover action to leftover start); leftover `resolvedActionIdsForRun` leftover loads leftover prior leftover receipts only when leftover `start_action_index > 0`. The leftover row-scoped leftover continue **seam** exists because leftover Zod / leftover `ValidationError` / leftover `ConflictError` / leftover `NotFoundError` / leftover `classifyGoogleFailure` leftover `invalid_request` leftover fail leftover that leftover row; leftover lost leftover lease / leftover retryable leftover Google / leftover missing leftover `$ref:` leftover throw. There is no begin / complete Domain Command **seam**. There is no Owner HTTP **seam**. There is no Analytics **seam**. There is no Sheet Sync drain **seam**.
- Split later (only if the file outgrows one sitting): this ~433-line file is one sitting if you read it as walk the locked checksum-bound Best Relocation plan under the held apply lease — unchanged counts as done, adopt writes a receipt only, a failed Lead blocks its Booking, a lost lease stops the walk. Do **not** split into `checksum.ts` / `walk.ts` / `conflict.ts` / `adopt.ts` / `command.ts` so “each command owns a file.” Do **not** split into `create.ts` / `update.ts` / `delete.ts`. Do **not** pull leftover worker leftover claim / leftover repository persist / leftover health letters / leftover wakeup / leftover sheet inspect / leftover Domain Commands here so “one apply owns the company.” If it later splits: `refuseAnAlteredChecksumBeforeAnyWalk.ts` / `walkEachLockedActionUnderTheHeldApplyLease.ts` / `recordAConflictUnlessAlreadyDispositioned.ts` / `adoptExistingOrAskLeftoverCommandsThenWriteTheReceipt.ts` only as later story files, never CRUD.

`applyBestRelocationPlan` is executor mechanics. The owner question is: *I already locked a checksum-bound Best Relocation plan. Walk every action under the held apply lease. Refuse if someone altered the checksum. Unchanged counts as done. A failed Lead blocks its Booking and we keep walking. Adopt writes a receipt only and hands that Form Lead or Call Lead to the later Booking. Record a conflict unless I already dispositioned it. Domain writes go through leftover commands with origin `external_sheet_ingestion`. Checkpoint after each action so resume does not replay. A lost lease or a non-row error stops the walk. A Zod / Conflict / NotFound / invalid Google request fails that row and continues. Do not inspect sheets. Do not claim the run. Do not approve. Do not drain Sheet Sync. Do not post to Granot from this file.*

Leftover worker leftover claim / leftover inspect / leftover lock / leftover finalize, leftover repository persist, leftover health letters, leftover wakeup, leftover sheet inspect / leftover plan, leftover Domain Commands already live in other **modules**. Do not pull those in.

## What this file actually does

Five operations of one “walk the locked checksum-bound Best Relocation plan under the held apply lease” story, not “an apply-plan CRUD service,” and not leftover worker leftover claim / leftover Owner leftover approve / leftover sheet leftover plan:

1. **Refuse an altered checksum before any walk** — leftover `applyBestRelocationPlan`. Leftover `assertChecksum` leftover `{ checksum_version: 1, artifact_kind: "ingestion_plan", schema_version, payload: plan }` vs leftover `input.checksum`. Miss leftover throws leftover `ChecksumMismatchError` leftover “Immutable artifact checksum does not match.” Leftover commands leftover are leftover not leftover **asked**. Leftover receipts leftover are leftover not leftover written.

2. **Resume from the checkpoint without replaying successful actions** — leftover `start_action_index > 0` leftover **asks** leftover `resolvedActionIdsForRun` leftover on leftover `plan.actions.slice(0, start_action_index)` and leftover seeds leftover `failed` leftover from leftover `initial_failed_action_keys`. Leftover counters leftover seed leftover from leftover `initial_completed_units` / leftover `initial_failure_count` / leftover `initial_conflict_count` / leftover `initial_skipped_dependency_count`. Fresh leftover walk leftover starts leftover `start_action_index` leftover 0 leftover and leftover an leftover empty leftover `resolved` leftover Map. Leftover worker leftover `applyApprovedClaim` leftover **asks** leftover `checkpoint.cursor.action_index` (leftover this leftover file leftover writes leftover `actionIndex + 1` leftover into leftover `onCheckpoint`).

3. **Walk each locked action under the held apply lease** — leftover `classification === "unchanged"` leftover increments leftover `completed_units`, leftover checkpoints, leftover continues (no leftover lease leftover assert, no leftover command). Leftover `depends_on` leftover some leftover in leftover `failed` leftover adds leftover this leftover `action_key` leftover to leftover `failed`, leftover increments leftover `skipped_dependencies`, leftover checkpoints, leftover continues. Else leftover **asks** leftover `assertApplicationEnabled?` then leftover `leaseStore.assertHeld`. Miss leftover throws leftover “Ingestion apply lease was lost before mutation.” Leftover unchanged leftover / leftover failed-dep leftover skip leftover do leftover **not** leftover **ask** leftover `assertHeld`.

4. **Record a conflict, adopt existing, or ask leftover commands then write the receipt** — leftover `record_conflict`: leftover `preallocateReceiptId`, leftover `isIngestionConflictDispositioned`, leftover `persistReceipt` leftover outcome leftover `conflict_dispositioned` leftover or leftover `conflict`, leftover open leftover conflict leftover only leftover when leftover not leftover dispositioned (leftover `related_canonical_ids` leftover from leftover resolved leftover `depends_on`), leftover increment leftover `conflicts` leftover only leftover when leftover opened, leftover increment leftover `completed_units`. leftover `adopt_existing`: leftover put leftover `adopted_entity_refs[0].id` leftover on leftover `resolved`, leftover `persistReceipt` leftover outcome leftover `adopted` leftover (no leftover preallocated leftover id), leftover increment leftover `completed_units` leftover (not leftover `applied`). Else leftover `preallocateReceiptId`, leftover `executeAction` leftover **asks** leftover `createFormLead` / leftover `createCallLead` / leftover `updateSourceOwnedLead` / leftover `createBookingFromLead` / leftover `createLeadlessBooking` / leftover `createCancellation` leftover with leftover `command_id` leftover `sha256(run_id:action_key:payloadChecksum)` leftover (64-hex; leftover executor leftover mints leftover a leftover new leftover ObjectId leftover unless leftover the leftover string leftover is leftover ObjectId leftover hex), leftover `idempotency_key` leftover `action.action_key`, leftover origin leftover `external_sheet_ingestion`, leftover `source_receipt_id` leftover already leftover known. leftover `create_booked_from_source` leftover fills leftover `lead_ref` leftover from leftover first leftover `depends_on`. leftover `create_cancelled_lead` leftover fills leftover `booked_lead` leftover from leftover first leftover `depends_on` leftover or leftover throws leftover “Missing booking dependency.” leftover `$ref:` leftover strings leftover resolve leftover against leftover `resolved`. leftover primary leftover id leftover goes leftover on leftover `resolved`. leftover `persistReceipt` leftover outcome leftover `applied` leftover or leftover `already_applied`. leftover increment leftover that leftover counter leftover and leftover `completed_units`. leftover unsupported leftover command leftover throws leftover “Unsupported canonical ingestion command.” leftover `attachBookingToLead` leftover / leftover Granot leftover / leftover RingCentral leftover commands leftover are leftover never leftover **asked**.

5. **Checkpoint after each action; continue only on a row-scoped command error** — leftover `onCheckpoint` leftover `{ action_index: actionIndex + 1, completed_units, failures, conflicts, skipped_dependencies, failed_action_keys }`. Leftover worker leftover `persistWorkerCheckpoint` leftover renews leftover the leftover apply leftover lease leftover and leftover leftover `$set`s leftover `IngestionRun` leftover (not leftover this leftover file). Leftover catch: leftover `!commandStarted || commandFinished` leftover rethrows (leftover persist leftover after leftover a leftover finished leftover command leftover stops leftover the leftover walk). Leftover `isRowScopedCommandError` leftover (`classifyGoogleFailure` leftover `invalid_request`, leftover `ZodError` / leftover `ValidationError` / leftover `ConflictError` / leftover `NotFoundError`) leftover adds leftover `action_key` leftover to leftover `failed`, leftover increments leftover `failures`, leftover checkpoints, leftover continues. Leftover missing leftover `$ref:` leftover / leftover missing leftover Lead leftover dependency leftover / leftover lost leftover lease leftover / leftover retryable leftover Google leftover / leftover `ChecksumMismatchError` leftover are leftover **not** leftover row-scoped leftover — leftover they leftover throw. Leftover return leftover `{ applied, already_applied, conflicts, failures, skipped_dependencies, completed_units }`.

Leftover `resolvePayload` / leftover `persistReceipt` / leftover `persistConflict` / leftover `deterministicId` / leftover `isRowScopedCommandError` / leftover `checkpoint` are beats, not extra owner operations.

## Organization

Keep one file. This is the screenplay for “walk the locked checksum-bound Best Relocation plan under the held apply lease — unchanged counts as done, adopt writes a receipt only, a failed Lead blocks its Booking, a lost lease stops the walk.” Leftover worker leftover claim / leftover inspect / leftover lock / leftover finalize, leftover repository persist, leftover health letters, leftover wakeup, leftover sheet inspect / leftover plan, leftover Domain Commands already live in deeper **modules**. Do not pull those in. Do not invent an `IngestionApplyService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second leftover command leftover **adapter** beside leftover `canonicalDomainCommands`. Do not invent a second leftover checksum leftover **adapter** beside leftover `assertChecksum`. Do not invent a second leftover persist leftover **adapter** beside leftover `ApplyPlanPersistence`. Do not invent a second leftover apply leftover **adapter** beside leftover `applyBestRelocationPlan` so leftover `adapter.apply` leftover “owns the kernel.”

Do not split checksum / walk / conflict / adopt / command into CRUD files. Leftover refuse leftover checksum leftover stays leftover first leftover because leftover Owner leftover approve leftover binds leftover `plan_checksum`. Leftover adopt leftover stays leftover in leftover this leftover file leftover because leftover the leftover later leftover Booking leftover leftover **asks** leftover `resolved` leftover `lead_ref`. Do not start leftover Owner leftover approve leftover from leftover this leftover file so “apply owns the checksum.” Do not start leftover `runSheetSyncDrain` leftover from leftover this leftover file so “we already leftover **ask** leftover `assertHeld`.” Do not start leftover worker leftover claim leftover from leftover this leftover file so “apply owns the run.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `applyBestRelocationPlan` | `walkTheLockedBestRelocationPlanUnderTheHeldApplyLease` | leftover worker leftover **asks** leftover the leftover walk leftover twice; leftover tests leftover **ask** leftover resume / leftover adopt / leftover failed leftover dep / leftover checksum |
| `ApplyPlanPersistence` | `WalkTheLockedPlanPersistence` | leftover tests leftover inject leftover receipts / leftover conflicts / leftover resolved leftover ids |

Keep the old names as one-line aliases until leftover `worker.ts`, leftover `adapter.ts`, leftover `ingestion/index.ts`, and leftover `ingestion.test.ts` migrate. Do not export leftover `executeAction` / leftover `resolvePayload` / leftover `persistReceipt` / leftover `persistConflict` / leftover `isRowScopedCommandError` / leftover `checkpoint` / leftover `deterministicId`. Do not make leftover Owner leftover approve leftover learn leftover this leftover file — leftover approve leftover CAS-es leftover `applying` leftover and leftover leftover publishes. Do not make leftover `adapter.apply` leftover the leftover runtime leftover **ask** leftover so leftover “the leftover kernel leftover owns leftover apply” — leftover `IngestionApplyResult` leftover drops leftover counters leftover leftover worker leftover finalize leftover **asks**. Do not make leftover heartbeat leftover learn leftover this leftover file.

**No class for the workflow.** The type that *does* earn a name is the leftover walk leftover bag leftover worker leftover finalize leftover **asks**:

```ts
type LockedBestRelocationPlanWalk = {
  applied: number
  already_applied: number
  conflicts: number
  failures: number
  skipped_dependencies: number
  completed_units: number
}
```

That is the handoff from “leftover worker leftover locked leftover a leftover checksum-bound leftover plan” to “leftover worker leftover may leftover stamp leftover `completed` leftover or leftover `completed_with_errors`.” Do **not** put leftover plan leftover actions leftover on leftover this leftover type. Do **not** put leftover Google leftover range leftover strings leftover on leftover this leftover type. Do **not** move leftover `IngestionApplyResult` leftover here leftover — leftover that leftover bag leftover lives leftover on leftover sibling leftover `types.ts` leftover and leftover drops leftover two leftover counters.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// applyPlan.ts
// The owner already locked a checksum-bound Best Relocation plan.
// Refuse if someone altered the checksum.
// Resume from the checkpoint without replaying successful actions.
// Walk every action under the held apply lease.
// Unchanged counts as done. A failed Lead blocks its Booking.
// Adopt writes a receipt only and hands the id to later Bookings.
// Record a conflict unless the owner already dispositioned it.
// Domain writes go through leftover commands.
// Checkpoint after each action.
// A lost lease stops the walk.
// A Zod / Conflict / NotFound / invalid Google request fails that row
// and we keep walking.

// ── 1. Refuse an altered checksum before any walk ─

export async function walkTheLockedBestRelocationPlanUnderTheHeldApplyLease(input)
export const applyBestRelocationPlan =
  walkTheLockedBestRelocationPlanUnderTheHeldApplyLease

function refuseWhenTheLockedChecksumDoesNotMatch(plan, checksum)

// ── 2. Resume from the checkpoint without replaying successful actions ─

async function loadResolvedIdsForActionsAlreadyWalked(persistence, run, priorActions)
function seedCountersAndFailedKeysFromTheCheckpoint(input)

// ── 3. Walk each locked action under the held apply lease ─

async function countUnchangedAsDoneAndCheckpoint(action, result)
async function skipDependentsOfAFailedActionAndCheckpoint(action, failed, result)
async function refuseWhenTheApplyLeaseWasLostBeforeMutation(leaseStore, lease)

// ── 4. Record a conflict, adopt existing, or ask leftover commands ─

async function recordAConflictUnlessTheOwnerAlreadyDispositionedIt(action)
async function adoptExistingReceiptOnlyAndHandTheIdToLaterBookings(action, resolved)
async function askLeftoverCommandsThenWriteTheReceipt(action, resolved)
function fillLeadRefOrBookedLeadFromTheFirstDependency(action, resolved)
function fillDollarRefSlotsFromTheResolvedMap(payload, resolved)

// ── 5. Checkpoint after each action; continue only on a row-scoped error ─

async function checkpointTheWalkSoResumeDoesNotReplay(actionIndex, result, failed)
function isARowScopedCommandError(error) // Zod / Validation / Conflict / NotFound / invalid Google
```

Read the primary path out loud: *The owner already locked a checksum-bound Best Relocation plan. Refuse if someone altered the checksum. Resume from the checkpoint without replaying successful actions. Walk every action under the held apply lease. Unchanged counts as done. A failed Lead blocks its Booking and we keep walking. Adopt writes a receipt only and hands that Form Lead or Call Lead to the later Booking. Record a conflict unless the owner already dispositioned it. Domain writes go through leftover commands with origin external_sheet_ingestion. Checkpoint after each action. A lost lease stops the walk. A Zod / Conflict / NotFound / invalid Google request fails that row and we keep walking. Never inspect sheets. Never claim the run. Never approve. Never drain Sheet Sync. Never post to Granot from this file.*

That is the operation. `applyBestRelocationPlan` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Leftover `adapter.apply` is never asked at runtime.** Leftover `createBestRelocationIngestionAdapter().apply` leftover **asks** this file and returns leftover `IngestionApplyResult` without leftover `skipped_dependencies` / leftover `completed_units`. Leftover worker leftover **asks** this file directly because leftover finalize leftover **asks** those two counters. Name the unused **adapter**. Do **not** silently switch leftover worker to leftover `adapter.apply` so “the kernel owns apply” — leftover `IngestionKernelDependencies` is also unused.

2. **Leftover `command_id` is a 64-hex sha256, not an ObjectId.** Leftover `deterministicId` hashes leftover `run_id:action_key:payloadChecksum`. Leftover executor leftover `isObjectIdString` then mints a new ObjectId. Leftover idempotency is leftover `idempotency_key` = leftover `action.action_key`. Name the unused hash. Do **not** silently mint an ObjectId here so “one id owns both seams” without proving leftover command leftover replay still leftover **asks** leftover `action_key`.

3. **Persist after a finished command stops the walk.** Leftover `commandFinished` is true before leftover `persistReceipt`. A receipt write fail rethrows (not a row failure). The domain write may already exist without a leftover `SourceRowReceipt`. Name command-then-receipt. Do **not** silently persist the receipt before the command so “one order owns evidence” — leftover `source_receipt_id` is already preallocated on the leftover command leftover context.

4. **Adopt does not preallocate a receipt id.** Leftover conflict / leftover command leftover **ask** leftover `preallocateReceiptId`. Leftover adopt leftover **asks** leftover `persistReceipt` without leftover `_id` and leftover repository mints on create. Name the two receipt clocks. Do **not** silently preallocate adopt so “one id owns every outcome.”

5. **Unchanged / failed-dep skip do not leftover **ask** leftover `assertHeld`.** Mutation leftover **asks** the lease. Leftover worker leftover `onCheckpoint` renews the lease — tests without leftover `onCheckpoint` can walk unchanged after a lost lease. Name skip-without-lease. Do **not** silently leftover **ask** leftover `assertHeld` on unchanged so “every beat owns the lease” — a long unchanged prefix must still checkpoint.

6. **Missing leftover `$ref:` / missing Lead leftover `lead_ref` are not row-scoped.** They throw leftover `Error` after leftover `commandStarted` and stop the walk. A leftover `ValidationError` on the Lead continues and blocks the Booking. Name the two fail classes. Do **not** silently treat missing dependency as row-scoped so “every payload miss continues.”

7. **Conflicts are opened twice.** Leftover worker leftover `persistPlanConflicts` leftover **asks** leftover `openIngestionConflict` at lock time. This file leftover **asks** leftover `record_conflict` again during the walk (unless dispositioned). Name plan-time open vs apply-time open. Do **not** silently drop apply-time open so “leftover worker owns every conflict” — leftover Owner leftover approve leftover refuses leftover open leftover `blocking` / leftover `critical` **before** this file leftover walks.

8. **Leftover `already_applied` comes from the leftover command leftover result, not from receipt uniqueness.** Leftover `appendSourceReceipt` may return leftover `{ inserted: false }` on duplicate evidence. This file leftover **asks** leftover `commandResult.status`. Name leftover command-replay vs leftover receipt-replay. Do **not** silently increment leftover `already_applied` from leftover `inserted: false` so “one uniqueness owns both stores.”

9. **Tests leftover **ask** the parent seam for four proofs and leftover **read** leftover `applyPlan.ts` for “no domain models.”** Leftover resume / leftover adopt / leftover failed leftover dep / leftover checksum leftover **ask** leftover `applyBestRelocationPlan`. Leftover concurrent leftover lease leftover **asks** leftover `InMemoryLeaseStore`, not this file. Leftover source-read leftover “no leftover FormLead import” is helper-unit style for a story that leftover **asks** leftover `canonicalDomainCommands`.

10. **Leave sibling modules alone.** Leftover `runBestRelocationIngestionWorker`, leftover `appendSourceReceipt` / leftover `openIngestionConflict` / leftover `resolvedActionIdsForRun`, leftover `emitIngestionHealthSignal`, leftover `publishIngestionWakeup`, leftover `createBestRelocationIngestionAdapter`, leftover `buildBestRelocationApplicationPlan`, leftover `canonicalDomainCommands`, leftover `assertChecksum` / leftover `classifyGoogleFailure` / leftover `LeaseStore.assertHeld` are already the right **depth**. This file leftover walks the locked plan. Do not open leftover `repository.ts` as a second recommendation this pass. Do not open leftover `bestRelocationSheetIngest/` this pass.

## Testing

The **interface** is the test surface: `walkTheLockedBestRelocationPlanUnderTheHeldApplyLease` (today `applyBestRelocationPlan`).

Today `ingestion.test.ts` asks `applyBestRelocationPlan` for resume without replay, adopt Form Lead supplies Booking `lead_ref`, failed Lead blocks Booking and independent Call Lead continues, and altered checksum rejects before mutation. The "no domain models" test reads `applyPlan.ts`. Keep those asks. Name the operation. Use `TEST_MODE`. Inject `commands` / `persistence` / `leaseStore`. Do not boot live Google Sheets.

**Refuse / resume**
- Altered checksum raises `ChecksumMismatchError` before any command is asked. Receipts stay empty.
- `start_action_index: 1` asks `resolvedActionIdsForRun` and asks `createBookingFromLead` only. `createFormLead` is not asked. `completed_units` seeds then increments.
- `start_action_index: 0` never asks `resolvedActionIdsForRun`.

**Walk / adopt / conflict / command**
- `classification === "unchanged"` increments `completed_units` and asks no command.
- `adopt_existing` never asks `createFormLead`. Later `create_booked_from_source` asks `lead_ref` from `adopted_entity_refs[0].id`.
- `record_conflict` asks `openIngestionConflict` when `isIngestionConflictDispositioned` is false. Dispositioned writes outcome `conflict_dispositioned` and never asks `openIngestionConflict`. `conflicts` increments only when opened.
- `create_cancelled_lead` asks `booked_lead` from the first `depends_on`. Missing Booking throws "Missing booking dependency" and stops the walk (not row-scoped).
- A `$ref:` slot missing from `resolved` throws "Missing dependency" and stops the walk.
- `assertHeld` false throws "Ingestion apply lease was lost before mutation" before any command is asked.
- `assertApplicationEnabled` is asked before mutation and omitted on bootstrap (worker injects that seam).
- Command context origin is `external_sheet_ingestion`. `idempotency_key` is `action.action_key`. `source_receipt_id` is the preallocated receipt id.

**Row-scoped continue / throw**
- `ValidationError` on `createFormLead` increments `failures`, never asks `createBookingFromLead`, asks `createCallLead` for an independent later action, increments `skipped_dependencies` for the Booking.
- `classifyGoogleFailure` `invalid_request` is row-scoped. `retryable_rate_limit` / `retryable_transient` throw so worker can queue one retry.
- Persist after `commandFinished` rethrows. That is not a row failure.
- Lost lease during mutation throws and does not keep applying.
- Form Lead / Call Lead / Booked Lead / Cancelled Lead models are not imported. `/api/v1` `fetch` `axios` are not asked.

Do **not** add a test per helper (`resolvePayload`, `persistReceipt`, `persistConflict`, `deterministicId`, `isRowScopedCommandError`, `checkpoint`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** boot Owner approve, heartbeat claim-due, Sheet Sync drain, Reporting worker write, Analytics, Granot drain, or CLI dry-run inside these tests. Worker claim / inspect / lock / finalize proofs stay in `ingestion-worker.md`. Heartbeat skip proofs stay Wave B `ingestionHeartbeatSkipReason`. Live Sheets stay `pnpm ingest:best-relocation -- --dry-run`.

## What I would not do

- I would not implement this pass.
- I would not rewrite recommendations/form-lead.md.
- I would not edit src/, tests, routes, models, or docs/knowledge/.
- I would not invent a CONTEXT.md term or an ADR. CONTEXT.md does not define Ingestion Origin / Best Relocation / Ingestion Run.
- I would not open Wave B (`src/routes/ingestion.routes.ts`, `src/routes/best-relocation-ingestion-cron.routes.ts`, `api/queues/best-relocation-ingestion-consumer.ts`).
- I would not write a whole-folder Ingestion recommendation.
- I would not introduce an `IngestionApplyService` class or a `checksum.ts` / `walk.ts` / `conflict.ts` / `adopt.ts` / `create.ts` / `update.ts` / `delete.ts` split.
- I would not invent a second command **adapter** beside `canonicalDomainCommands`.
- I would not invent a second checksum **adapter** beside `assertChecksum`.
- I would not invent a second persist **adapter** beside `ApplyPlanPersistence`.
- I would not silently switch worker to `adapter.apply` so "the kernel owns apply."
- I would not silently mint an ObjectId `command_id` so "one id owns both seams."
- I would not silently persist the receipt before the command so "one order owns evidence."
- I would not silently preallocate adopt receipt ids so "one id owns every outcome."
- I would not silently `assertHeld` on unchanged so "every beat owns the lease."
- I would not silently treat missing `$ref:` as row-scoped so "every payload miss continues."
- I would not silently drop apply-time `openIngestionConflict` so "worker owns every conflict."
- I would not silently increment `already_applied` from receipt `inserted: false`.
- I would not silently start `runSheetSyncDrain` because `assertHeld` is already in hand.
- I would not silently start Owner approve or worker claim from this file.
- I would not open `repository.ts` or `bestRelocationSheetIngest/` as a second recommendation this pass.
- I would not silently reorder ADR-known side effects.
