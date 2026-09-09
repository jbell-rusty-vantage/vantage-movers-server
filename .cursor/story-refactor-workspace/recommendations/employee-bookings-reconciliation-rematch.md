# Retry The Still-Pending Employee Job Until A Unique Lead Appears — Hold One Drain, Claim Each Due Case, Ask The Operational Matcher Again, Then Auto-Attach Without Rewriting Source Or Schedule The Next Delay — Never Mint, Never Ask The Owner, Never Book A Second Job — operational story

- Status: recommended
- Service: `employeeBookings` (Wave A, in-progress)
- Pass: 7 of this service — `reconciliationRematch.service.ts`
- Remaining in this service: `migrationPreflight.ts`, `migrationApplySafety.ts`
- Target: `src/services/employeeBookings/reconciliationRematch.service.ts`
- Knowledge: [`docs/knowledge/services/employee-bookings.md`](../../../docs/knowledge/services/employee-bookings.md) (HTTP/cron table + thin **Auto-rematch cron** section: flag on unless the env is the string `false`; default reason list is only `matching unavailable`; delays `5,30,120`; cron no-ops when the flag is off). The Service `applies_to` list does **not** name this file — do not invent a second Service. This checkout’s `CONTEXT.md` defines `employee booking submission`, `booking lead reconciliation case`, `employee booking origin`, and `matching unavailable` — link those terms; do not invent a second glossary. `docs/adr/` is absent here — do not invent ADR copies. This drain is **not** Book The Employee Job, **not** the Owner desk, **not** Sheet Sync drain, and **not** a Granot Booking case.
- Callers: Wave B `booking-reconciliation-cron.routes.ts` (`ALL /api/cron/booking-reconciliation-rematch`, `CRON_SECRET`, actor `"cron"`). Route also refuses when rematch is off and returns `{ skipped: true }` **before** calling this file. Barrel `employeeBookings/index.ts` re-exports the one function. Submit, desk, attach, and policy do **not** import this file. Tests: `reconciliationRematch.service.test.ts` (cold `connectMongo` only).
- Seams callers need: cron is the only **adapter**; hold-one-drain (global lease) vs claim-this-case (per-case `retry` lease); before-commit `persistSheetSyncIntent` vs after-commit `finalizeSheetSync`; attach sibling with `auto_attach_delayed` and **no** `sourceResolution` (preserve Lead Source). There is no Domain Command begin / complete **seam**.
- Split later (only if the file outgrows one sitting): `holdTheOneRematchDrain.ts`, `retryThisDuePendingCase.ts` — never `create.ts` / `update.ts` / `delete.ts` / `cron.ts`. Finder, matcher, attach, policy, and submit stay siblings.

`runDueBookingLeadRematches` is executor mechanics. The owner question is: *The employee Job is already booked and still leadless. Matching was unavailable, so we opened an Owner case and said we would look again. Every five minutes, if rematch is on, take the one drain seat. Claim each due pending case whose reason is still on the rematch list. Ask the same operational finder and matcher the employee form used — not the Owner search. If one unique Lead is there now, claim it and stamp the Booking without rewriting Source and without asking the Owner to name warnings. If not, wait the next delay, then stop. If the Booking is gone, cancelled, or already attached, stop retrying and leave the case as the Owner sees it. Never mint. Never book a second Job. Never POST Granot.*

## What this file actually does

Three operations of one “retry the still-pending employee Job until a unique Lead appears” story, not “a CRUD rematch service,” and not Book The Employee Job:

1. **Hold the one rematch drain** — rematch off → `{ claimed: 0, attached: 0, updated: 0, skipped: 0 }`. Connect Mongo. Take global lease `booking-reconciliation:rematch` for 60s. Miss → the same zeros (another drain is running). Heartbeat renews every 20s; a lost seat throws. Always release in `finally`.
2. **Retry each due pending case** — page pending cases whose reason is in `autoRematchReasons` (default only `matching_unavailable`), `retry.next_attempt_at` is due, and the case lease is free, oldest first, batch 25. CAS-claim `retry.lease_owner` / `leased_until`. Inside `runSheetSyncWrite` (`forceTransaction: true`): the case must still be pending, due, rematchable, and ours. Booking missing, cancelled, or already attached → clear the retry clock, do **not** resolve the case, skip. Else rebuild the prepared bag from the case, run the operational finder + matcher (Job / operational phone — not Granot snapshot search). Record a `delayed_retry` attempt. **Linked:** attach with `booking_reconciliation.auto_attach_delayed` and no `sourceResolution` (preserve Lead Source, no reprice), persist the Sheet job, resolve the case, stamp `auto_attach_delayed`, clear retry. **Still pending:** overwrite `reason`, bump `attempt_count`, schedule `autoRematchDelaysMinutes[attempt_count]` when the new reason is still rematchable and that slot exists, else clear `next_attempt_at` (stop). Matcher / claim throw → release the case lease, stamp `retry.last_error`, leave `next_attempt_at` so the next cron can try again, record `booking.lead_reconciliation.retry_failed`.
3. **Project attached rows after commit** — finalize each persisted job while the global seat is still ours. Record `booking.lead_reconciliation.resolved` with the four counts (the event key is “resolved”; the summary is “drain completed”). This file does not drain the Sheet Sync queue.

Finding candidates, picking the unique Lead, claiming/stamping, Owner warning overrides, and opening the case on submit are other files. This file never mints, never POSTs Granot, never opens a Granot Booking case, and never writes a second Booking.

## Organization

Keep one file. This is the screenplay for “look again at the still-pending employee Job.” Finder, matcher, attach, Sheet Sync persist/finalize, and the lease **adapter** already live in deeper **modules**. Do not pull those in. Do not invent a `ReconciliationRematchService` class. Do not invent a begin / complete Domain Command **seam** — cron is the only **adapter**. Inventing a second **adapter** so “rematch matches Owner attach” is forbidden.

If it later outgrows one sitting, split by hold-the-drain vs retry-this-case, never CRUD and never one file per delay minute.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `runDueBookingLeadRematches` | `retryDuePendingEmployeeJobsUntilAUniqueLeadAppears` | five-minute cron is the only **adapter** |

Keep the old name as a one-line alias until the cron route and barrel migrate. Do not export `renewCaseLease`, `preparedFromCase`, `toCaseCandidate`, or `hashCandidates`. Do not make callers learn `InTransaction` or `runDue` as the domain language. Do not add `beginRetryDuePendingEmployeeJobs` until a second real **adapter** exists.

**No class for the workflow.** The one type that earns a name is the after-commit handoff:

```ts
type DelayedEmployeeJobAttachInProgress = {
  jobs: FullSheetSyncJob[]
}
```

That is the handoff from “the Lead is claimed, the Booking points at it, Sheet Sync intent is remembered” to “project the row.” A miss returns `[]` and does not finalize. The four counts stay a plain result the cron JSON already echoes.

Leave `PreparedEmployeeBookingSubmission` on sibling `types.ts`. Leave delay / reason / batch knobs on `getBookingReconciliationConfig`. Leave the lease store on `sheetSync/drainer/leases`. Do not move warning overrides or Owner search here.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// reconciliationRematch.service.ts
// The employee Job is already booked and still leadless.
// Matching was unavailable, so we said we would look again.
// Take the one drain seat.
// For each due pending case, ask the same operational matcher
// the employee form used — not the Owner search.
// If one unique Lead is there now, claim it and stamp the Booking
// without rewriting Source and without asking the Owner.
// If not, wait the next delay, then stop.
// If the Booking is gone, cancelled, or already attached,
// stop retrying and leave the case as the Owner sees it.
// Book The Employee Job, the Owner desk, and Sheet Sync drain
// are other files.

const THE_ONE_REMATCH_DRAIN = "booking-reconciliation:rematch"

// ── 1. Hold the one rematch drain ─────────────────────────

export async function retryDuePendingEmployeeJobsUntilAUniqueLeadAppears({
  actor,
})
  // rematch off → zeros
  // connect Mongo, then take the seat
  // miss → zeros (another drain is running)
  // heartbeat 20s / 60s; lost seat throws
  // finally: stop heartbeat, release the seat

async function takeTheOneRematchDrainSeat()
async function keepTheRematchDrainSeatOrThrow(renew = false)

// ── 2. Retry each due pending case ────────────────────────

async function listTheNextDuePendingCases(now, limit)
  // pending + rematchable reason + next_attempt_at due + case lease free
  // oldest next_attempt_at, then createdAt; ids only

async function claimThisCaseForThisDrain(caseId, owner, now)
  // CAS retry.lease_owner / leased_until
  // miss → skipped (Owner or another drain took it)

async function retryThisDuePendingCase({ caseId, owner, actor, session })
  // still pending, due, rematchable, and ours?
  //   no → drop our lease, skip
  // Booking missing / cancelled / already attached?
  //   clear retry clock, do not resolve, skip
  // rebuild the prepared bag from the case (local and allocations empty)
  // operational finder + matcher — not Owner search
  // renew the case lease before mutate; miss → throw
  // record delayed_retry
  // linked → attachWithoutRewritingSource, persist, resolve
  // else → bump attempt, schedule next delay or stop

async function attachTheUniqueLeadWithoutRewritingSource({
  booking,
  prepared,
  leadModel,
  leadId,
  session,
})
  // sibling claimAndStampTheNamedLeadOnThisJob
  // operation booking_reconciliation.auto_attach_delayed
  // no sourceResolution → preserve Lead Source, no reprice

function theNextDelayOrStop(reason, attemptCount, config)
  // delays[attemptCount] only when reason is still rematchable
  // missing slot → stop (clear next_attempt_at)

function rememberTheMatcherFailed(caseId, owner, error)
  // clear case lease, stamp last_error, leave next_attempt_at

// ── 3. Project attached rows after commit ─────────────────

async function projectTheAttachedRows(jobs)
  // finalize each job while the global seat is still ours

function recordThatTheRematchDrainFinished(counts)
  // eventKey booking.lead_reconciliation.resolved
  // summary is drain completed — not “a case resolved”
```

Read the path out loud: *If rematch is on, take the one drain seat. Claim each due pending case. If the Booking is gone, cancelled, or already attached, stop retrying and leave the case. Else ask the operational matcher again. A unique Lead → claim it, stamp the Booking without rewriting Source, remember Sheet Sync, resolve as delayed auto-attach. Still pending → wait the next delay if that reason is still rematchable and a slot remains, else stop. After commit, project the attached rows. A throw releases the case lease, stamps the error, and leaves the case due. Never mint. Never ask the Owner. Never book a second Job.*

That is the operation. `runDueBookingLeadRematches` is not.

Submit opened the retry clock. The Owner desk may attach, mint, dismiss, or reopen while this drain is off. Policy never speaks here. Sheet Sync drain is a different seat.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **The route and this file both refuse when rematch is off.** Wave B returns `{ skipped: true }` and never calls. This file still returns zeros if a script hits the barrel. Leave both. Do not delete the service fence so “the route already checked,” or skip the route check so “the service owns the flag.”

2. **Default rematch reason is only `matching unavailable`.** `no_match`, conflicts, booked, and cancelled are legal on the env list and are **not** default. Submit only stamps `next_attempt_at` when the opening reason is on that list. Do not rematch every pending reason so “the cron has something to do,” or drop `matching_unavailable` from the default so “a matcher throw should wait for the Owner.”

3. **Delay index is `attempt_count` after the increment.** Submit opens `attempt_count: 0` and waits `delays[0]` (5). First miss → `1` and `delays[1]` (30). Second miss → `2` and `delays[2]` (120). Third miss → `3` and no slot → stop. That is three looks after the first wait. Do not index before increment so “we get a fourth look,” or reuse `delays[0]` every miss so “backoff is flat.”

4. **A miss that leaves the rematch list stops the clock.** `no_match` after a `matching_unavailable` open clears `next_attempt_at` under the default list. The case stays `pending` for the Owner. Do not keep retrying `no_match` so “maybe a Lead appears,” or auto-dismiss so “the cron cleaned up.”

5. **Attach never sends `sourceResolution`.** Omitted means preserve Lead Source and do not reprice. Owner attach may send `apply_submission_source`. Do not pass `apply_submission_source` so “the Job’s Source wins,” or pass `preserve_lead_source` as a literal so “the enum is explicit” if that changes the sibling’s omitted-vs-preserve branch — leave the omit.

6. **Rematch never asks for warning overrides.** The matcher only returns `linked` for a unique source-compatible eligible Lead. Hard blocks stay pending. Do not call `assertExactWarningOverrides` so “attach is attach,” or attach a `lead_already_booked` Lead so “the cron is helpful.”

7. **Rematch never asks policy who-is-speaking.** Actor is the cron string. Do not import `deriveTrustedOwnerActor` so “someone must be an Owner,” or stamp `owner:cron` so “history looks like the desk.”

8. **Already-attached or cancelled Booking clears retry and does not resolve.** Status stays `pending` (or whatever it was) with no `resolution_history` row. The Owner still sees the case. Desk reopen already clears the rematch lease so a cancelled Booking cannot re-enter. Do not auto-resolve so “the Job is attached, close it,” or auto-dismiss cancelled so “the cron tidied the queue.”

9. **Finder is the operational six lookups, not Owner search.** Same siblings submit uses. No Granot snapshot paths. Do not call `searchBookingLeadCandidates` so “we might find more,” or skip overflow so “the cron can guess.”

10. **Case lease renew sits after finder+matcher, before mutate.** A slow evaluate can burn the 60s case lease; renew miss throws and the catch leaves the case due. Do not move evaluate outside the write so “the lease lasts,” or skip renew so “we already claimed.”

11. **Two leases, two meanings.** Global `booking-reconciliation:rematch` is one drain at a time (Sheet Sync lease **adapter**, different scope than `sheet-sync:drain`). Per-case `retry.lease_owner` is “this case is being retried.” Do not reuse the Sheet Sync drain seat so “one lease owns the box,” or skip the case lease so “the global seat is enough.”

12. **Throw does not bump `attempt_count`.** Catch only clears the case lease and stamps `last_error`. `next_attempt_at` stays due. The next cron may claim immediately. Do not increment on throw so “errors burn a delay slot,” or clear `next_attempt_at` on throw so “one failure stops rematch.”

13. **`skipped` is three different beats.** Case-lease miss, inside-write “no longer due,” and Booking gone/cancelled/attached all increment `skipped`. `claimed` counts a case-lease win even when the write later skips. Leave the four counts as the cron JSON. Do not split `skipped` into three exported numbers so “the dashboard is precise” in this pass.

14. **The finish event key says `resolved`.** The summary is “rematch drain completed” and the details are the four counts. A drain with zero attaches still writes it. Do not skip the event when `attached === 0` so “nothing resolved,” or emit per-case `resolved` instead of the drain rollup so “each attach is an incident.”

15. **`preparedFromCase` / `toCaseCandidate` / `hashCandidates` are copies of the desk.** Same shape, empty `local` and `agentAllocations` on the rematch bag. Leave the copies. Do not extract a shared helper **module** in this pass so “DRY,” or start locating the move here so “local is real.”

16. **Policy version and enabled rules are read from env inside the write.** Same strings submit/desk stamp on attempts. Do not import `getEmployeeBookingMatchingConfig` here so “one config,” or persist a new version so “rematch has its own policy.”

17. **Cold test only proves `connectMongo` before the lease.** That is not the story. Do not add a helper-unit test for `hashCandidates` or `theNextDelayOrStop`.

18. **Leave sibling modules alone.** `queryEmployeeBookingCandidates`, `evaluateEmployeeBookingMatch`, `attachLeadToEmployeeBooking`, `persistSheetSyncIntent`, `finalizeSheetSync`, and `acquireLease` stay where they are. This file holds the drain and retries the case.

19. **Do not treat Book The Employee Job, Owner attach/mint/reassign, or Granot Connect Booking to Lead as this story.** Submit opens the clock. The desk claims with overrides. Granot cases are another collection.

20. **Do not treat Sheet Sync drain, Lead Messaging drain, or Granot receipt drain as this story.** Those seats have different scopes and different due rows.

## Testing

The **interface** is the test surface: `retryDuePendingEmployeeJobsUntilAUniqueLeadAppears`.

Today’s `reconciliationRematch.service.test.ts` only proves a cold Mongo connect throws before a lease. That is not enough for a drain this long.

Replace the stub style with tests that name the operation:

**Hold the drain**
- Rematch off → zeros, no Mongo case query (already partly implied; lock it).
- Global lease miss → zeros, no case claim.
- Lost heartbeat mid-batch → throw, `finally` releases the seat.

**Retry the case**
- Default list: a due `matching_unavailable` pending case is claimed; a due `no_match` case is not.
- Unique Lead → Booking stamped, case `resolved`, `resolution_history.action === "auto_attach_delayed"`, Sheet intent remembered **before** commit, finalize **after**, Lead Source unchanged (no `apply_submission_source`).
- Matcher still pending `matching_unavailable` → `attempt_count` 0→1, `next_attempt_at` uses `delays[1]`.
- Matcher returns `no_match` under the default list → `next_attempt_at` cleared, status stays `pending`.
- Third miss after `delays[0..2]` → stop.
- Booking cancelled or already attached → retry cleared, status not auto-resolved, no attach.
- Case-lease miss → `skipped`, no matcher call.
- Matcher throw → `last_error` set, lease cleared, `next_attempt_at` still due, `retry_failed` recorded, no finalize.

**Not this interface**
- Does not mint. Does not call Owner search. Does not ask warning overrides. Does not take the Sheet Sync drain seat.

Do **not** add a test per helper (`theNextDelayOrStop`, `preparedFromCase`, `hashCandidates`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

## What I would not do

- A `ReconciliationRematchService` class with `run` / `retry` / `attach`.
- Thirty two-line functions that only wrap `findOneAndUpdate`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or `cron.ts`.
- Breaking the before-commit / after-commit **seam**. Finalize must not sit inside the Mongo write.
- Inventing a begin / complete Domain Command **seam** (cron is the only **adapter**).
- Rematching every pending reason, applying the submission Source, or asking the Owner for warning overrides.
- Auto-resolving a cancelled or already-attached Booking so “the queue is clean.”
- Calling Owner search or mint so “the cron can finish the case.”
- Reusing the Sheet Sync drain seat or a Granot receipt id.
- Treating Book The Employee Job, the Owner desk, Sheet Sync drain, or Granot Booking-case rematch as this story.
- Opening Wave B or the next service while this checklist has unchecked modules.
