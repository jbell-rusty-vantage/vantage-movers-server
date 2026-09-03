# Call Log Sync — operational story

- Status: recommended
- Service: `ringcentral` (Wave A, in-progress)
- Pass: 12 of this service — `call-log-sync.service.ts`
- Remaining in this service: `call-log-sync-state.store.ts`, `call-log-vetting.ts`, `analytics-reconcile.service.ts`, `auth.ts`
- Target: `src/services/ringcentral/call-log-sync.service.ts`
- Knowledge: [`docs/knowledge/services/ringcentral-call-lead-qualification.md`](../../../docs/knowledge/services/ringcentral-call-lead-qualification.md) (section 3 is this cron sweep; section 4 is already-recommended promote). Distinct from the next-checklist lease/cursor store: `call-log-sync-state.store.ts` (`acquireCallLogSyncLease` / `renewCallLogSyncLease` / `recordCallLogSyncSuccess` / `recordCallLogSyncError` / `assertCallLogSyncStateSingletonIndex` — this file **asks** those; it does not own the singleton row). Distinct from later-checklist Call Log vet: `call-log-vetting.ts` (`vetRingCentralCallLogRecord` — same 120s inbound-answered rule as already-recommended evaluate). Distinct from already-recommended promote: [recommendations/ringcentral-call-lead-ingest.md](ringcentral-call-lead-ingest.md) (`ingestRingCentralQualifiedCall` — this file **asks** it with `ingestionSource: "call_log_sync"`; it does not skip, adopt, classify, or write a Lead). Distinct from later-checklist analytics: `analytics-reconcile.service.ts` (count-level only — must not create). Distinct from skipped config / metrics / HTTP client. Distinct from Wave B `src/routes/ringcentral-cron.routes.ts` (`GET|POST /api/cron/ringcentral-call-log-sync` is a trigger and mapper only). This checkout has no `CONTEXT.md` / `docs/adr/` — do not invent copies. Do not add this path to knowledge in this rename.
- Callers: Wave B `src/routes/ringcentral-cron.routes.ts` (`runCallLogSync` default); Wave B `src/routes/ringcentral-cron.routes.test.ts` (type `RingCentralCallLogSyncSummary` only); this file’s `call-log-sync.service.test.ts` (AC-17 injectable harness); `call-log-sync-lease.replica.test.ts` (real lease + real promote, provider HTTP injected). Gitignored `scripts/dev_ops/ringcentral/ringcentral-call-log-sync-run.ts` is the local **asker**. `granotLifecycle/projections.ts` **asks** `getCallLogSyncState`, not this file. State-store tests, vet tests, analytics, auth, seed — **do not import this file’s function**.
- Seams callers need: public sweep (Wave B cron and the local runner both **ask** the same export); lease-held skip vs thrown failure (Wave B maps skip to `{ ok: true, skipped: true, reason: "lease_held" }` and a throw to HTTP 500 with a non-sensitive body); injectable **adapters** for file tests (clock, owner, lease, fetch, vet, promote, events); locked 12-hour window (`resolveWindowStart` is the window **seam**, not a second owner operation)
- Split later (only if the file outgrows one sitting): this ~700-line file is one sitting if you read it as elect the one sweeper, open the conservative twelve-hour window, page inbound Call Log, promote each already-qualified inbound through the same gate the webhook uses, and move the cursor only when the whole sweep finished. If it later splits: `electTheOneCallLogSweeper.ts` / `openTheConservativeCallLogWindow.ts` / `sweepInboundCallLogPagesAndPromote.ts` / `advanceTheCallLogCursorOnlyAfterACompleteSweep.ts` — story files, never `create.ts` / `update.ts` / `delete.ts` / `sync.ts`, and never merge the lease store, Call Log vet, already-recommended promote, analytics, HTTP client, config, or Wave B cron HTTP into this file

`runRingCentralCallLogSync` / `RingCentralCallLogSyncDependencies` / `fetchDetailedInboundCallLogPage` are executor mechanics. The owner question is: *The webhook is best-effort. Sweep RingCentral’s Call Log for inbound voice calls that webhook may have missed. Only one sweep may run. Look back at least twelve hours so a long call that finalized late still appears. For each inbound that matches a mapped number and was answered over two minutes, promote through the same gate the webhook uses. Move the high-water cursor only when the whole sweep finished. If anything failed or the lease was stolen, leave the window where it was so the next sweep retries the same range. Do not evaluate parties. Do not persist a session. Do not pick an adoption candidate. Do not invent a second promotion gate.*

Lease/cursor store, Call Log vet, already-recommended promote, registry snapshot, HTTP client, config names, metrics, analytics, and Wave B cron HTTP already live in other **modules**. Do not pull those in.

## What this file actually does

Four operations of one “sweep the Call Log for qualified inbound calls this webhook may have missed” story, not “a Call Log CRUD service,” and not Call Log vet / promote:

1. **Elect the one sweeper** — assert the singleton unique index, mint an owner, **ask** `acquireCallLogSyncLease` on `key: "account"`. Loser: contention metric, `lease_contended` event (masked owner hash only), return `skipped: true, skipReason: "lease_held"`. No provider fetch. No route observation. No promote. No cursor write. Winner: `started` event; `lease_recovered` warn if the claim took an expired lease.

2. **Open the conservative twelve-hour window** — `windowTo` is the winner’s claim instant, not the cron clock the caller passed. `windowFrom` is `resolveWindowStart`: earlier of cursor overlap (`lastSyncTo - overlap`, default 15 minutes) and rolling floor (`now - 12 hours`). First run uses initial lookback (default 30 minutes) under the same floor. The twelve-hour floor does **not** shrink with the 30-minute cron cadence.

3. **Sweep inbound Call Log pages and promote** — force-renew before pagination. Fetch Detailed inbound Voice, 250 per page, at most 20 pages. Per record: renew if due; **ask** `vetRingCentralCallLogRecord`; matched target → `candidateRecords` and **ask** `recordRingCentralRouteObservation` (even when the call later fails qualify); qualify only when vet has no rejection, source, caller phone, and route; then **ask** `ingestRingCentralQualifiedCall` with `ingestionSource: "call_log_sync"` and `qualificationReason: "call_log_inbound_target_answered_over_120s"`. Tally ingest actions, created / adopted / conflict / duplicate. A 429 is counted and rethrown — provider retry is out of this unit.

4. **Advance the cursor only after a complete sweep** — `recordCallLogSyncSuccess` is the only cursor move, and it is fenced by owner. Fence miss → `lease_lost`, no error write as the former owner. Mid-run renewal miss → stop new records, `lease_lost`, no terminal write. Route / fetch / throttle / promote failure → `recordCallLogSyncError` (bounded code only); fence miss on that write degrades to `lease_lost` and never `failed`. Already-committed promote stays valid; ingest is idempotent on the next rescan.

There is no evaluate-parties operation. There is no session persist. There is no adoption-candidate pick. There is no Lead write. `vetRingCentralCallLogRecord` is the Call Log qualification **adapter**. Already-recommended `ingestRingCentralQualifiedCall` is the only promotion **adapter**. `acquireCallLogSyncLease` / `recordCallLogSyncSuccess` are the claim / cursor **adapters**. Wave B cron HTTP is a trigger **adapter**.

`RingCentralCallLogSyncSummary` / `RingCentralCallLogSyncDependencies` sit on the sweep path. They are not extra owner operations. Do not invent a dashboard for `ingestActions` in this rename. Do not export `processRecord` or `classifyStageError` as a public **seam**.

## Organization

Keep one file as the screenplay for “elect the one sweeper, open the conservative twelve-hour window, page inbound Call Log, promote each already-qualified inbound through the same gate the webhook uses, and move the cursor only when the whole sweep finished.” Lease/cursor store, Call Log vet, already-recommended promote, registry snapshot, HTTP client, config names, metrics, analytics, and Wave B cron HTTP already live in deeper **modules**. Do not pull those in. Do not invent a `CallLogSyncService` class. Do not invent a begin / complete **seam** — already-recommended promote already owns Call Lead begin / complete; success / error already own lease clear. Do not invent a vet **adapter** beside `vetRingCentralCallLogRecord`. Do not invent a promote **adapter** beside already-recommended `ingestRingCentralQualifiedCall`.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `sync.ts`. Those are persistence verbs, not the owner story. Do not move lease claim into this file so “one file owns elect and persist.” Do not move Call Log vet into this file so “one file owns qualify and sweep.” Do not silently promote an unmatched Call Log row so “we always write a Lead.” Do not silently advance the cursor after throttle so “we make progress.”

**External interface** stays small (this is the test surface). Elect, open-window, sweep, and finalize are one story’s sweep, not four CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `runRingCentralCallLogSync` | `sweepTheCallLogForQualifiedInboundCallsThisWebhookMayHaveMissed` | Wave B cron and the local runner both **ask** the same sweep |
| `resolveWindowStart` | `openTheConservativeCallLogWindow` | 12-hour floor vs cursor overlap; file tests name the lock |
| `RingCentralCallLogSyncSummary` | `WhetherTheSweepSkippedAdvancedOrFailed` | Wave B maps `skipped` / throw; counts stay PII-free |
| `RingCentralCallLogSyncDependencies` | `InjectableSweepAdaptersForFileTests` | file tests replace lease / fetch / vet / promote |

Keep the old names as one-line aliases until Wave B cron, the local runner, the file test, and replica tests migrate. Do not make callers learn `withTransaction` / `PER_PAGE` / `RunStage` / `RingCentralCallLogLeaseLostError` as the domain language.

**Principle: old exports stay as aliases.** `runRingCentralCallLogSync` remains the imported name until Wave B cron migrates.

**No class for the workflow.** The type that *does* earn a name is the PII-free summary Wave B already returns:

```ts
type WhetherTheSweepSkippedAdvancedOrFailed = {
  skipped: boolean
  skipReason: "lease_held" | null
  leaseAcquired: boolean
  leaseLost: boolean
  cursorAdvanced: boolean
  windowFrom: string
  windowTo: string
  leaseOwnerHash: string | null   // never the owner value
  errors: /* bounded codes only */
  // counts: fetched / candidate / qualified / created / adopted / conflict / throttle
}
```

That is the handoff from “a cron tick arrived” to “Wave B may say skip, ok, or 500.” Do **not** add `records[]` so “the summary can replace Call Log vet,” and do **not** add `callerPhoneNumber` so “the owner can see who called.”

Do not add `vetRingCentralCallLogRecord` as a public story **seam** on this file — Call Log vet already owns that export. Do not add `ingestRingCentralQualifiedCall` as a public **seam** — already-recommended promote already owns that. Do not add `acquireCallLogSyncLease` as a public **seam** — the state store already owns that. Do not export `releaseLease` as a public **seam** — this file never **asks** it.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// call-log-sync.service.ts
// The webhook is best-effort.
// Sweep RingCentral's Call Log for inbound voice calls it may have missed.
// Only one sweep may run.
// Look back at least twelve hours.
// Promote each already-qualified inbound through the same gate the webhook uses.
// Move the cursor only when the whole sweep finished.

// ── 1. Elect the one sweeper ──────────────────────────────

export async function sweepTheCallLogForQualifiedInboundCallsThisWebhookMayHaveMissed(
  startedAt?: Date,
  dependencies?: Partial<InjectableSweepAdaptersForFileTests>,
)

async function refuseWhenTheSingletonIndexIsMissing()
async function claimTheAccountLeaseOrSkip(owner, now)
function returnABoundedSkipWhenAnotherSweepHoldsTheLease(ownerHash)
async function announceTheWinnerAndWhetherTheLeaseWasRecovered(claim)

// ── 2. Open the conservative twelve-hour window ───────────

export function openTheConservativeCallLogWindow(windowTo, state)
function honorTheTwelveHourFloorOverARecentCursor(windowTo, lastSyncTo)
function honorTheTwelveHourFloorOnAFirstRun(windowTo)

// ── 3. Sweep inbound Call Log pages and promote ───────────

async function renewTheLeaseBeforeTheLongFetch(owner)
async function fetchTheNextDetailedInboundVoicePage(window, page)
function countAProviderThrottleAndRethrow(error)
async function observeAMatchedTargetEvenWhenTheCallDoesNotQualify(vet)
async function promoteThisAlreadyQualifiedCallLogInbound(vet, now)
function stopPagingWhenThePageIsShort(pageRecords, perPage)

// ── 4. Advance the cursor only after a complete sweep ─────

async function stampSuccessAndMoveTheCursorOnlyIfWeStillOwnTheLease(owner, window)
function stopAndWriteNothingWhenTheLeaseWasStolen(stage)
async function stampABoundedFailureWithoutMovingTheCursor(owner, errorCode)
function degradeToLeaseLostWhenTheFailureWriteLosesTheFence()
function neverPutCallerOrProviderContentOnTheSummaryOrTheEvent()
```

Read the primary path out loud: *Assert the singleton unique index. Claim the account lease. If another sweep holds it, skip. Do not fetch. Do not promote. Do not move the cursor. If we won, `windowTo` is that claim instant. Open `windowFrom` as the earlier of cursor overlap and the twelve-hour floor. Renew the lease. Page Detailed inbound Voice. For each record, vet; observe a matched target even when qualify later fails; promote only a qualified inbound through the same gate the webhook uses. Renew the lease while work remains. If the lease is stolen, stop new records and write no terminal fact as the former owner. If fetch, throttle, snapshot, or promote fails, stamp a bounded error and leave the cursor where it was. Only after every page and every qualified record finishes, stamp success and move the cursor. Do not evaluate parties. Do not persist a session. Do not pick an adoption candidate. Do not invent a second promotion gate.*

That is the operation. `runRingCentralCallLogSync` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`releaseLease` is wired and never asked.** `recordCallLogSyncSuccess` and `recordCallLogSyncError` already `$unset` the lease on the state store. Mid-run lease-lost must not release as the former owner — a successor may already own the row. Do not silently call `releaseCallLogSyncLease` after success so “we clean up.” Do not silently release on lease-lost so “every path clears.” Leave `releaseCallLogSyncLease` on the next-checklist state store.

2. **Matched-target observation is not qualify.** `processRecord` increments `candidateRecords` and **asks** `recordRingCentralRouteObservation` when `matchedTargetNumber` is true, **before** rejection. A short inbound still observes the route. Do not silently observe only qualified rows so “observation means promote.” Do not promote unmatched rows so “every candidate becomes a Lead.”

3. **Twenty full pages still advance the cursor.** `MAX_PAGES` 20 × 250 = 5,000 records. A full twentieth page exits the loop and **asks** `recordCallLogSyncSuccess`. The twelve-hour floor rescans the same range on the next run. Do not silently refuse success after max pages so “we never skip a record” without a paired 12-hour rescan test.

4. **`startedAt` vs injected `now`.** `dependencies.now` wins over `startedAt`. Winner `windowTo` is `claim.leaseAcquiredAt`, not `startedAt`. Do not silently use `startedAt` as `windowTo` so “the cron clock owns the window.”

5. **429 counts and rethrows.** Provider retry is out of this unit. An unrecovered throttle is a partial run: the cursor does not move. Do not silently swallow 429 so “we finish the page.” Do not advance the cursor after throttle so “we make progress.”

6. **Lease-lost writes nothing as the former owner.** Mid-run renewal miss and fenced success miss both throw `RingCentralCallLogLeaseLostError`. They do **not** **ask** `recordError`. A fenced error write that loses the fence degrades to `lease_lost` and never `failed`. Do not silently stamp `failed` on lease-lost so “every miss notifies.”

7. **Already-committed promote stays valid.** Knowledge says Unit 20 effects are idempotent on the next rescan. Do not rewind `lastSyncTo` so “we retry clean.” Do not delete promoted Leads because the cursor did not move.

8. **Leave sibling modules alone.** `acquireCallLogSyncLease` / `recordCallLogSyncSuccess` stay on next-checklist `call-log-sync-state.store.ts`. `vetRingCentralCallLogRecord` stays on later `call-log-vetting.ts`. Already-recommended `ingestRingCentralQualifiedCall` stays on already-recommended promote. `loadRingCentralRouteSnapshot` / `recordRingCentralRouteObservation` stay on unvisited `operationsRegistry`. `ringCentralRequest` stays on skipped `client.ts`. Window minutes stay on skipped `ringcentral-config.ts`. Wave B cron HTTP stays in Wave B. This file orchestrates them.

## Testing

The **interface** is the test surface: `sweepTheCallLogForQualifiedInboundCallsThisWebhookMayHaveMissed` and `openTheConservativeCallLogWindow`.

Today’s `call-log-sync.service.test.ts` already names AC-17 at this **interface**. Keep those proofs. Name them as the operation when renaming.

**Elect**
- The loser returns `lease_held` after index assert + claim only. No fetch, observe, promote, or cursor write.
- Two overlapping asks produce exactly one winner.

**Window**
- First run uses the 12-hour floor over the 30-minute initial lookback.
- A 30-minute-old cursor still rescans 12 hours.
- A cursor older than the floor keeps its overlap window.
- Winner `windowTo` is the claim instant.

**Sweep**
- A matched target that fails qualify observes the route and does not promote.
- A qualified inbound **asks** already-recommended promote with `ingestionSource: "call_log_sync"`.
- 429 counts and rethrows. Cursor does not move.
- Pagination stops on a short page and continues through full pages.

**Finalize**
- A complete successful run advances the cursor exactly once.
- Route / fetch / throttle / promote failure stamps a bounded error and leaves the cursor unchanged.
- Fenced success miss is `lease_lost` and writes no terminal error as the former owner.
- Mid-run lease loss stops new records and writes nothing.
- Fenced error-write miss degrades to `lease_lost` and never `failed`.
- Recovered expired lease reports recovery and still reads the predecessor’s committed cursor.
- Events and the summary carry no caller phone, caller name, provider body, token, or raw owner.

`call-log-sync-lease.replica.test.ts` is the Mongo proof of overlap, expiry takeover, cursor immobility on failure, and rescan idempotency. Wave B `ringcentral-cron.routes.test.ts` proves auth, disabled skip, `lease_held` skip, and a safe 500 — not this file’s window or promote beats.

Do **not** add a test per helper (`honorTheTwelveHourFloorOverARecentCursor`, `countAProviderThrottleAndRethrow`, `classifyStageError`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

## What I would not do

- A `CallLogSyncService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an existing call.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `sync.ts`) for cleanliness.
- Breaking the claim-before-work / cursor-only-on-full-success **seam**. Fetch, observe, and promote must not run for the lease loser. The cursor must not move on throttle, promote failure, or lease loss.
- Treating already-recommended promote, Call Log vet, the lease store, or leftover analytics as this story.
- Inventing a **seam** that has only one **adapter**.
- Silently “fixing” a known order gap while recommending a rename: do not start releasing the lease after success; do not rewind a successful cursor; do not swallow 429; do not promote unmatched rows.
- Jumping to the next service while this one has unchecked modules.
- Writing a whole-folder recommendation for `ringcentral`.
