# Drain Due Sheet-Sync Jobs — One Drain At A Time, Mongo Still Owns Who Is Due — Timeout Goes Back To Pending, A Crash Goes Back To Retrying — operational story

- Status: recommended
- Service: `sheetSync` (Wave A, in-progress)
- Pass: 6 of this service — `drainer/runSheetSyncDrain.ts`
- Remaining in this service: `drainer/jobPlanner.ts`, `drainer/batchWriter.ts`, `drainer/tabRowMap.ts`, `drainer/quotaLimiter.ts`
- Target: `src/services/sheetSync/drainer/runSheetSyncDrain.ts`
- Knowledge: [`docs/knowledge/services/sheet-sync.md`](../../../docs/knowledge/services/sheet-sync.md) (queue / cron / admin retry all enter here; global lease; claim → plan → batch → `updateOne` → finalize). Distinct from already-recommended mode-aware persist / finalize / unmigrated schedule: [recommendations/sheet-sync-coordinator.md](sheet-sync-coordinator.md). Distinct from already-recommended outbox coalesce + tombstone: [recommendations/sheet-sync-outbox.md](sheet-sync-outbox.md). Distinct from already-recommended wake-up (never claims): [recommendations/sheet-sync-queue.md](sheet-sync-queue.md). Distinct from already-recommended legacy `document.save()` remember: [recommendations/sheet-sync-persistence.md](sheet-sync-persistence.md) (this file’s `updateOne` is the queued **adapter**). Distinct from already-recommended live lookup-then-write: [recommendations/sheet-sync-source-lookup.md](sheet-sync-source-lookup.md) (legacy `waitUntil`; queued never imports it). Distinct from later plan / tab / batch / quota: `drainer/jobPlanner.ts`, `drainer/batchWriter.ts`, `drainer/tabRowMap.ts`, `drainer/quotaLimiter.ts`. Distinct from already-skipped lease **adapter**: `drainer/leases.ts`. Distinct from Google Sheets tabs / projections / dual Source Company writes: [`google-sheets.md`](../../../docs/knowledge/services/google-sheets.md) (this file asks the batch writer; it does not choose tabs). Distinct from Granot one-id claim + fence: [recommendations/granot-lifecycle-drainer.md](granot-lifecycle-drainer.md) (this drain is a due scan, not `{ receipt_id }`). Distinct from Lead Messaging due-row drain: [recommendations/lead-messaging-lead-messaging.md](lead-messaging-lead-messaging.md). Distinct from admin retry itself (sets `pending` / `due_at=now` then starts this file): later Wave A `admin`. Distinct from executor-owned txn + non-replay finalize: [`domain-commands.md`](../../../docs/knowledge/services/domain-commands.md). This checkout’s `CONTEXT.md` names Sheet Sync in the intro and points at a parent glossary that is not in this tree — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Knowledge already names timeout→`pending` vs crash→`retrying`; do not “fix” that in this rename.
- Callers: **three runtime import sites, plus the two barrels. No folder test of this file.** Queue consumer: `api/queues/sheet-sync-consumer.ts` ignores the payload and calls `runSheetSyncDrain("queue")`. Cron: `routes/sheet-sync-cron.routes.ts` no-ops unless `SHEET_SYNC_MODE=queued`, then `runSheetSyncDrain("cron")` and returns `{ ok: true, skipped: false, summary }` even when `summary.ok === false` (only an unexpected throw is 500). Admin retry: `admin/adminSheetSync.service.ts` `waitUntil(runSheetSyncDrain("admin"))` after it already requeued rows — swallows throw, does **not** publish. Barrel: `sheetSync/drainer/index.ts` and `sheetSync/index.ts` re-export `runSheetSyncDrain` / options / summary / `QuotaLimiter`. Coordinator, outbox, queue, persistence, and source lookup do **not** import this file. Trigger `"script"` is on the union and has no runtime caller. Tests: `drainer/drainer.test.ts` is **batchWriter** (not this file). `drainer/jobPlanner.test.ts` locks unmatched skip / missing Booking / tombstone on the planner **adapter**. Cron tests lock secret / 401 / non-queued skip and never start a drain. Config tests lock guardrail defaults. Observability fingerprint tests use `sheet_sync.drain.failed` as a sample key. There is no `runSheetSyncDrain.test.ts`.
- Seams callers need: take the global drain seat or skip; due scan (not a job id); timeout leftover claims → `pending` vs run-level throw leftover `processing` → `retrying`; empty plan → `synced`; quota defer without burning an attempt; metadata persist failure flips those outcomes to `failed` and does not abort the run; injected `sheets` / `quota` / `owner` for tests; cron mode gate lives on the route, not here
- Split later (only if the file outgrows one sitting): this ~740-line file is one sitting if you read it as take-the-seat → claim → plan → write → remember → finalize. If it later splits: `takeTheGlobalDrainSeat.ts` / `claimTheDueSheetSyncJobs.ts` / `rememberTheRowHintsWithoutAbortingTheRun.ts` / `finalizeEachClaimedJob.ts` — never `claim.ts` / `process.ts` / `retry.ts` / `create.ts` / `update.ts` / `delete.ts`, and never merge coordinator persist, outbox, wake-up, legacy lookup, later `planJobWrites`, or `writeBatchedTargets` into this file

`runSheetSyncDrain` is executor mechanics. The owner question is: *Someone woke us — a queue message, the five-minute cron, or an Owner retry. If another drain already holds the global seat, skip. If we take the seat, claim due jobs (pending or retrying, due now, unleased), fold duplicate keys onto one representative, ask the planner to reload Mongo, batch the writes per tab without burning the Google quota, remember the row hints on the documents with `updateOne`, then mark each job synced, retrying, or failed. Quota exhaustion comes back in a minute without burning an attempt. A run that times out puts leftover unplanned claims back to pending. A run that blows up puts leftover processing claims back to retrying. This file does not publish a wake-up. This file does not write the outbox. This file does not choose tabs itself. The planner and the batch writer already live next door.*

Coordinator persist / finalize, outbox coalesce, queue wake-up, legacy lookup-then-write, later plan / batch / quota, and Google Sheets projections already live in other **modules**. Do not pull those in.

## What this file actually does

One operation, not “a drain CRUD service,” and not the planner / the batch writer / the wake-up / the outbox:

1. **Drain due sheet-sync jobs** — `runSheetSyncDrain(trigger, options?)`. Connect Mongo. Ask sibling config for drain guardrails (500 jobs, 60s run, 120s lease, 8 attempts). Name this owner (`pid-time-random`, or the injected test owner). Take the global lease `sheet-sync:drain`. If someone else holds it, log `sheet_sync.drain.skipped_locked` and return `{ ok: true, skipped: true, runId: null, claimed: 0, … }` — no run row, no Google call. If we take it, open a `SheetSyncRun` (`running`), start a heartbeat that renews the drain lease and every claimed job lease (loss throws), then claim due rows (`pending` / `retrying`, `due_at ≤ now`, unleased) up to `maxJobsPerDrain`, sorted priority desc / createdAt asc, each with a compare-and-set to `processing`. Fold claimed jobs that share a `coalescing_key` onto one representative. For each representative still inside the run deadline: ask `planJobWrites` (sibling). Empty plan (document gone / unmatched Call skip / missing Booking or Cancellation) → mark `synced`. Plan throw → burn an attempt and maybe exhaust. Then ask `writeBatchedTargets` (sibling) once for the whole planned bag. Remember `sheet_sync[]` with direct `updateOne` (must not abort the run; persist failure flips those synced outcomes to `failed`). Write `SheetSyncAttempt` rows best-effort. Finalize each remaining job: any `failed` → `retrying` with 30s × 2^(attempts-1) backoff, cap 15 min, until attempt 8 then `failed`; any quota `deferred` → `retrying` in 60s **without** burning an attempt, `target_hints` = failed/deferred targets only; else `synced`. Duplicate keys are marked `synced` with `coalesced_into_representative`. Unplanned leftover claims after the deadline go back to `pending`. A throw after the seat is taken releases that run’s still-`processing` jobs to `retrying`, stamps the run `failed`, and writes `sheet_sync.drain.failed` (`notificationCandidate: true`). Clean finish writes `completed` or `partial_failure`. Always stop the heartbeat and release the seat. This function does not publish. This function does not write `sheet_sync_jobs` from a domain create. This function does not choose tabs.

There is no second mutate operation. Mode, wake-up, tab routing, and outbox coalesce are other files. The planner’s `plan*` functions and the batch writer are sibling **adapters**, not this file. Trigger `"script"` is on the union and has no publisher and no runtime drain caller.

## Organization

Keep one file as the screenplay for “drain due sheet-sync jobs — one drain at a time, Mongo still owns who is due — timeout goes back to pending, a crash goes back to retrying.” Planner, batch writer, tab map, quota limiter, lease store, coordinator, outbox, queue, legacy remember, and Google Sheets writers already live in deeper **modules**. Do not pull those in. Do not invent a `SheetSyncDrainerService` class. Do not invent a canonical-command `begin` / `complete` **seam** here — that **seam** already lives on the coordinator. Do not invent a Granot `{ receipt_id }` **seam** that has only one **adapter** here — this drain is a due scan. Do not invent a second remember **adapter** beside already-recommended `syncAndStore` — this file’s `updateOne` is the queued path on purpose.

Do not split this into `claim.ts` / `process.ts` / `retry.ts`. Those are beats of one drain. Do not move this into `sheetSyncQueue.service.ts` so “wake-up owns drain.” Do not move this into the consumer so “the queue already runs.” Do not move this into `jobPlanner.ts` so “one lookup owns every mode.” Do not silently call `syncSourceLeadById` so “queued reuses legacy.” Do not silently `document.save()` so “we match legacy remember.”

**External interface** stays small (this is the test surface). Take-the-seat, claim, write, remember, and finalize are one story’s drain, not five CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `runSheetSyncDrain` | `drainDueSheetSyncJobs` | queue consumer, five-minute cron, admin retry |
| `RunSheetSyncDrainOptions` | `DrainDueSheetSyncJobsOptions` | injected `sheets` / `quota` / `owner` for tests |
| `SheetSyncDrainSummary` | `SheetSyncDrainSummary` | skip vs claimed / synced / failed / deferred |

Keep the old name as a one-line alias until the consumer, cron route, admin retry, and the two barrels migrate. Do not make callers learn `SheetSyncLease` / `QuotaLimiter` / `planJobWrites` as the domain language.

**Principle: old exports stay as aliases.** `runSheetSyncDrain` remains the imported name until `sheet-sync-consumer.ts` / the cron route / `startAdminSheetSyncDrain` point at the story name.

`PlannedWrite` is re-exported from this file today. That is a type leak, not a second operation. Leave the alias until callers import it from `drainer/types.ts`. Do not make the drain **interface** grow a write-row type.

**No class for the workflow.** The type that *does* earn a name is the seat we hold until the lease dies:

```ts
type ThisDrainSeatIsOursUntilTheLeaseDies = {
  owner: string
  runId: mongoose.Types.ObjectId
  lease: LeaseToken
}
```

That is the handoff from “we won the global seat” to “claim, write, remember, finalize — or skip leftover work if the heartbeat lost.” Do **not** add `job_id` so “the consumer can claim this row,” do **not** add `published: true` so “the drain can prove the queue,” and do **not** add `official_booking_details` so “a booked job can confirm.”

`options.sheets` / `options.quota` / `options.owner` stay because they are a real test **adapter**, not a second persistence. Default remains `getSheetsClient()` and `new QuotaLimiter()`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// drainer/runSheetSyncDrain.ts
// Someone woke us — a queue message, the five-minute cron, or an Owner retry.
// If another drain already holds the global seat, skip.
// If we take the seat, claim due jobs.
// Fold duplicate keys onto one representative.
// Reload Mongo. Batch the writes per tab.
// Remember the row hints with updateOne — do not abort the run.
// Mark each job synced, retrying, or failed.
// Quota exhaustion comes back in a minute without burning an attempt.
// A run that times out puts leftover unplanned claims back to pending.
// A run that blows up puts leftover processing claims back to retrying.
// This file does not publish a wake-up.
// This file does not write the outbox.
// This file does not choose tabs itself.
// Cron does not live here.
// Admin retry does not live here.

// ── 1. Drain due sheet-sync jobs ──────────────────────────

export async function drainDueSheetSyncJobs(trigger, options?)
export const runSheetSyncDrain = drainDueSheetSyncJobs

async function takeTheGlobalDrainSeatOrSkip(owner, leaseMs)
  // acquire sheet-sync:drain; skip if held

async function openTheDrainRun(trigger)
async function keepRenewingTheSeatAndTheClaimedJobs(seat)
async function claimTheDueSheetSyncJobs(owner, runId, limit, leaseMs)
  // pending/retrying, due now, unleased → processing

function foldDuplicateKeysOntoOneRepresentative(claimed)
async function planEachRepresentativeOrReleaseWhenTheClockRunsOut(reps, deadline)
  // sibling planJobWrites
  // empty → synced later
  // throw → burn an attempt
  // past deadline → pending (unplanned only)

async function writeThePlannedRowsInBatches(writes, sheets, quota)
  // sibling writeBatchedTargets

async function rememberTheRowHintsWithoutAbortingTheRun(plannedDocs, outcomes)
  // updateOne sheet_sync[]; persist miss flips those synced outcomes to failed

async function rememberEachWriteAttempt(runId, outcomes)  // best-effort insertMany

async function finalizeEachClaimedJob(job, outcomes)
  // failed → retrying / exhausted
  // deferred → retrying in 60s, no attempt burn
  // else synced

async function markDuplicateKeysCoveredByTheRepresentative(duplicates)
async function putUnplannedLeftoverClaimsBackToPending(job)
async function putThisRunSStillProcessingJobsBackToRetrying(owner, runId, error)
async function rememberTheRunFinished(run, counts)       // completed | partial_failure
async function rememberTheRunBlewUp(run, error, released)
async function giveTheSeatBack(seat)
```

Read the primary path out loud: *The Lead (or Booking, or Cancellation) is already saved and the outbox row is already committed. A wake-up, the five-minute cron, or an Owner retry asks this host to drain. If another drain holds `sheet-sync:drain`, we skip — the cron will try again. If we take the seat, we claim due jobs, fold two pending rows that share a key onto one representative, reload Mongo, write the tabs in batches, `updateOne` the row hints, and mark the jobs. An unmatched Call stub or a vanished Booking is an empty plan marked synced — we do not invent a row. Quota exhaustion comes back in a minute and does not count as a failure. If the clock runs out before we plan a claimed job, that job goes back to pending. If the run throws, leftover processing jobs go back to retrying. Either way we give the seat back. The Form Lead 201 already happened.*

That is the operation. `runSheetSyncDrain` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This drain is a due scan, not an id claim.** The consumer ignores `kind` / `reason` / `run_hint` and calls this file with `"queue"`. Granot’s consumer parses exactly `{ receipt_id }`. Do not start switching on the wake-up reason so “the drain knows why,” and do not send `job_id` so “the consumer can claim this row.” Mongo owns due / coalesce / priority / lease / quota.

2. **This file does not check `SHEET_SYNC_MODE`.** Cron no-ops unless queued. The consumer and admin retry call this file whenever they run. Disabled / legacy hosts should not reach here. Do not add a mode refuse inside this file so “disabled never drains,” and do not delete the cron gate so “the drain is self-contained.”

3. **Timeout leftover claims go to `pending`. A crash leftover goes to `retrying`.** Knowledge names both. Deadline release is only for representatives not yet planned. Already-planned jobs still write after the clock. A throw after the seat is taken `updateMany`s that run’s still-`processing` rows to `retrying` with attempt-1 backoff. Do not flip timeout to `retrying` so “every leftover looks like a crash,” and do not flip crash to `pending` so “the operator note wins.” Do not reset stuck `processing` from admin without fixing the root cause — that is a later `admin` pass.

4. **Empty plan is `synced`, not `failed`.** Document gone, unmatched Call skip, missing Booking, missing Cancellation — the planner returns no writes and this file marks the job done. Legacy lookup warns + returns on a missing Booking and 404s a missing source Lead. Keep both **adapters**. Do not fail an empty plan so “a vanished Booking looks loud,” and do not call `syncSourceLeadById` so “queued reuses legacy.”

5. **Quota defer does not burn an attempt.** `deferJob` sets `retrying`, `due_at = now + 60s`, `last_error = quota_budget_exhausted`, and keeps `target_hints`. A real write failure increments `attempts` and uses 30s × 2^(attempts-1), cap 15 min, then `failed` at 8. Do not increment attempts on defer so “every miss counts,” and do not skip the attempt on a real write fail so “quota and Google errors match.”

6. **Metadata persist failure flips outcomes and does not abort the run.** Legacy `syncAndStore` `save()` can throw and abort that refresh. This file `updateOne`s, logs `sheet_sync.drain.metadata_persist_failed`, and rewrites those `synced` outcomes to `failed` so finalize retries the job. Delete tombstones have no surviving document and skip persist. Do not `save()` so “we match legacy,” and do not throw out of `persistDocSheetSync` so “a hint miss fails the whole drain.”

7. **Attempt rows are best-effort.** `insertMany({ ordered: false })` catch logs `sheet_sync.drain.attempt_persist_failed` and continues. Do not fail the run because audit history missed. Do not skip the await so “the drain never waits on history” unless a later measured hang proves it.

8. **Duplicate claimed keys are marked `synced` even when the representative failed.** The comment says they are “fully covered.” Finalize still stamps `coalesced_into_representative` after a failed or deferred representative. Name that. Do not silently copy the representative’s `failed` / `retrying` onto duplicates in this rename. Do not drop the fold so “every claimed row writes.” Outbox already refuses to coalesce onto `processing`.

9. **`maxCoalescedEntitiesPerDrain` is on the guardrails and unused here.** Config tests lock the default (500). This file never reads it. Do not start slicing the representative map so “the comment becomes true,” and do not delete the knob so “the type is honest” in this rename. Leave it visible.

10. **Claim is find-then-CAS, not one aggregation.** `find` due rows, then `findOneAndUpdate` each id with status / lease predicates. A race with another drain loses that row and moves on. Do not switch to Granot’s one-id fence so “every Vantage drain looks the same.”

11. **Lease loss on a job mutation throws.** `assertJobMutationApplied` / `requireActiveLease` throw `Sheet Sync job lease was lost.` That becomes a run-level failure and leftover `processing` → `retrying`. Do not quiet a missed CAS so “one job can finish after the seat died.”

12. **Heartbeat renews the seat and the claimed jobs.** Interval is `leaseDurationMs / 3` (min 1s), `unref`’d. Lost renew throws on the next `requireActiveLease`. Do not renew only the global seat so “job leases can expire mid-write.”

13. **Log and event keys are load-bearing.** `sheet_sync.drain.skipped_locked`, `sheet_sync.drain.claimed`, `sheet_sync.drain.run_summary`, `sheet_sync.drain.partial_failure`, `sheet_sync.drain.completed`, `sheet_sync.drain.failed`, `sheet_sync.write.failed`, `sheet_sync.write.deferred_quota`, `sheet_sync.job.exhausted`. Partial-failure / failed use env-scoped `dedupeKey`; a clean finish `autoResolveKey`s the partial-failure key. `drain.failed` pages (`notificationCandidate: true`). Job write fail pages only when terminal. Rename functions; keep the strings until log searches are migrated on purpose.

14. **Cron returns 200 when `summary.ok === false`.** Only an unexpected throw is 500. The drain’s own catch returns `{ ok: false, … }` and does not throw. Do not make cron 500 on `ok: false` so “Vercel retries the cron,” and do not throw from this file on a handled run failure so “the consumer can crash-retry.” Admin `waitUntil` already swallows.

15. **Trigger `"script"` has no runtime caller.** Union is `queue | cron | admin | script`. Do not add a script publisher so “every trigger is honest,” and do not delete `script` so “the type matches callers.”

16. **Leave sibling modules alone.** `planJobWrites` stays in later `jobPlanner.ts`. `writeBatchedTargets` stays in later `batchWriter.ts`. `QuotaLimiter` stays in later `quotaLimiter.ts`. `acquireLease` / `renewLease` / `releaseLease` stay in skipped `leases.ts`. `publishSheetSyncWakeup` stays on the already-recommended queue. `enqueueSheetSyncJob` stays on the outbox. `syncAndStore` stays on already-recommended persistence. `syncSourceLeadById` stays on already-recommended source lookup. `retrySheetSyncJobs` stays on later `admin`. This file orchestrates seat → claim → plan → write → remember → finalize.

## Testing

The **interface** is the test surface: `drainDueSheetSyncJobs` (today `runSheetSyncDrain`). `{ ok, skipped, runId, claimed, synced, failed, deferred }` is part of that **interface**. Injected `sheets` / `quota` / `owner` are the test **adapter**.

There is no `runSheetSyncDrain.test.ts`. `drainer.test.ts` locks batchWriter. Planner tests lock unmatched skip / missing Booking on the sibling **adapter**. Cron tests never start a drain. That is not enough for a drain this load-bearing. Add tests that name the operation. Stub `planJobWrites` and `writeBatchedTargets`; do not boot Google Sheets.

**Drain due sheet-sync jobs**
- Global seat held → `{ ok: true, skipped: true, runId: null, claimed: 0 }`, no `SheetSyncRun`, `sheet_sync.drain.skipped_locked`.
- Seat taken, no due jobs → run `completed`, `{ skipped: false, claimed: 0 }`, seat released in `finally`.
- Two claimed jobs share a `coalescing_key` → one representative is planned; the duplicate is marked `synced` with `coalesced_into_representative`.
- Empty plan (planner returns no writes) → job `synced`, writer not called.
- Plan throw → job `retrying` or `failed` at max attempts, `sheet_sync.write.failed`; exhausted also writes `sheet_sync.job.exhausted` with `notificationCandidate: true`.
- All writes `synced` → job `synced`, `updateOne` of `sheet_sync[]` on surviving docs, attempts inserted.
- Any write `failed` → job `retrying` with exponential `due_at`, `target_hints` = failed/deferred targets, attempt incremented.
- Any write `deferred` (no fail) → job `retrying` in 60s, attempt **not** incremented, `last_error = quota_budget_exhausted`, `sheet_sync.write.deferred_quota`.
- Metadata `updateOne` miss / throw → those previously-synced outcomes become `failed`; the run does not throw; finalize retries the job.
- Attempt `insertMany` throw → run still finishes; `sheet_sync.drain.attempt_persist_failed`.
- Deadline before a representative is planned → that job returns to `pending` (`leased_until` cleared); already-planned jobs still write.
- Throw after the seat is taken (lease lost / unexpected) → still-`processing` jobs for this `run_id` + owner become `retrying`, run `failed`, `sheet_sync.drain.failed` with `notificationCandidate: true`, `{ ok: false }`, seat released.
- Partial fail or defer → run `partial_failure` + `sheet_sync.drain.partial_failure` (`notificationCandidate: false`). Clean finish `autoResolveKey`s that env-scoped key.
- Tombstone planned docs with no `doc` → no `updateOne`.
- `"queue"` / `"cron"` / `"admin"` / `"script"` are accepted; no runtime caller passes `"script"`.

**Not this interface**
- Persist / finalize / unmigrated schedule stay on [recommendations/sheet-sync-coordinator.md](sheet-sync-coordinator.md).
- Remember-or-fold / tombstone stay on [recommendations/sheet-sync-outbox.md](sheet-sync-outbox.md).
- Wake-up stays on [recommendations/sheet-sync-queue.md](sheet-sync-queue.md).
- Legacy `save()` remember stays on [recommendations/sheet-sync-persistence.md](sheet-sync-persistence.md).
- Live lookup-then-write stays on [recommendations/sheet-sync-source-lookup.md](sheet-sync-source-lookup.md).
- Unmatched skip / missing Booking empty-plan stay on later `drainer/jobPlanner.ts`.
- Batch / append / delete-high-to-low / read-quota defer stay on later `drainer/batchWriter.ts` (`drainer.test.ts` already covers them).
- Cron secret / non-queued skip stay on `sheet-sync-cron.routes.test.ts`.
- Admin retry filter (`failed` only by default) stays on later Wave A `admin`.
- Granot `{ receipt_id }` stays on [recommendations/granot-lifecycle-drainer.md](granot-lifecycle-drainer.md).

Do **not** add a test per helper (`foldDuplicateKeysOntoOneRepresentative`, `keepRenewingTheSeatAndTheClaimedJobs`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do not add a test that this file publishes a wake-up — it must not. Do not add a test that this file writes `sheet_sync_jobs` from a domain create — it must not. Do not add a test that queued mode calls `syncSourceLeadById` — it must not. Do not add a test that cron 500s on `{ ok: false }` — it must not. Do not add a test that this file refuses `SHEET_SYNC_MODE !== "queued"` — the route owns that gate.

`options.sheets` / `options.quota` / `options.owner` stay because they are a real test **adapter**, not a test leak.

## What I would not do

- A `SheetSyncDrainerService` class with `claim` / `process` / `retry`.
- Thirty two-line functions that only wrap `findOneAndUpdate`.
- Moving this into a CRUD folder, or into the consumer / cron route / `jobPlanner.ts` / `sheetSyncQueue.service.ts` “for cleanliness.”
- Breaking the timeout→`pending` / crash→`retrying` **seam**. Those are the owner story.
- Treating `persistSheetSyncIntent` / `publishSheetSyncWakeup` / `syncAndStore` / `syncSourceLeadById` / `planJobWrites` / `writeBatchedTargets` as this story.
- Inventing a Granot `{ receipt_id }` **seam** that has only one **adapter** here.
- Silently routing this file through `syncSourceLeadById`, or silently failing an empty plan, or silently burning an attempt on quota defer.
- Writing a whole-folder recommendation for `sheetSync`.
- Jumping to `googleSheets` while this checklist has unchecked modules.
- Resetting stuck `processing` jobs to `pending` from this rename, or making the Form Lead 201 wait on a drain.
