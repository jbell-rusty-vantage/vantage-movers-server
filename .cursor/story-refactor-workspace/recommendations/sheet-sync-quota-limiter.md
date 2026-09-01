# Reserve This Minute's Sheets Budget — Grant Or Deny, Never Sleep — A Denied Token Lets The Writer Defer Without Burning An Attempt — operational story

- Status: recommended
- Service: `sheetSync` (Wave A, visited after this pass)
- Pass: 10 of this service — `drainer/quotaLimiter.ts`
- Remaining in this service: none — `sheetSync` is **visited** after this pass
- Target: `src/services/sheetSync/drainer/quotaLimiter.ts`
- Knowledge: [`docs/knowledge/services/sheet-sync.md`](../../../docs/knowledge/services/sheet-sync.md) (queued step 5: batch write per tab via already-recommended `batchWriter.ts` + this limiter; step 7: quota `deferred` → drain retries in 60s **without** burning an attempt; Mongo owns Google quota; `QuotaLimiter` uses `SheetSyncQuotaBucket` for per-minute budgets). Distinct from already-recommended mode-aware persist / finalize / unmigrated schedule: [recommendations/sheet-sync-coordinator.md](sheet-sync-coordinator.md). Distinct from already-recommended outbox coalesce + tombstone: [recommendations/sheet-sync-outbox.md](sheet-sync-outbox.md). Distinct from already-recommended wake-up: [recommendations/sheet-sync-queue.md](sheet-sync-queue.md). Distinct from already-recommended legacy `document.save()` remember: [recommendations/sheet-sync-persistence.md](sheet-sync-persistence.md). Distinct from already-recommended live lookup-then-write: [recommendations/sheet-sync-source-lookup.md](sheet-sync-source-lookup.md) (legacy does not reserve here; it `waitUntil`s and can sit on the request). Distinct from already-recommended take-the-seat / claim / finalize: [recommendations/sheet-sync-run-sheet-sync-drain.md](sheet-sync-run-sheet-sync-drain.md) (the drain constructs this limiter once, hands it to the writer, and maps `deferred` → `retrying` in 60s). Distinct from already-recommended reload-and-plan: [recommendations/sheet-sync-job-planner.md](sheet-sync-job-planner.md). Distinct from already-recommended write-the-planned-rows: [recommendations/sheet-sync-batch-writer.md](sheet-sync-batch-writer.md) (the writer asks `reserve("read")` once per tab and `reserve("write")` once per chunk; this file never writes cells). Distinct from already-recommended tab map: [recommendations/sheet-sync-tab-row-map.md](sheet-sync-tab-row-map.md) (the map does not reserve). Distinct from Google Sheets tabs / projections / dual Source Company writes: [`google-sheets.md`](../../../docs/knowledge/services/google-sheets.md) (this file never calls Google). Distinct from executor-owned txn + non-replay finalize: [`domain-commands.md`](../../../docs/knowledge/services/domain-commands.md). This checkout’s `CONTEXT.md` names Sheet Sync in the intro and points at a parent glossary that is not in this tree — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Knowledge already names defer-not-sleep; do not “fix” that in this rename.
- Callers: **two runtime import sites, plus the two barrels, plus the folder test.** Drain: `drainer/runSheetSyncDrain.ts` does `options.quota ?? new QuotaLimiter()` once per drain and passes that object into `writeBatchedTargets`. Writer: `drainer/batchWriter.ts` type-imports `QuotaLimiter` and calls `quota.reserve("read" | "write", 1)` — denied read → whole tab `deferred`; denied write → that chunk `deferred`, later chunks still try. Barrel: `sheetSync/drainer/index.ts` re-exports `QuotaLimiter` / `QuotaReservation` / `QuotaBucketStore`. Service barrel `sheetSync/index.ts` re-exports `QuotaLimiter` (not the two types). Coordinator, outbox, queue, persistence, source lookup, planner, and tab map do **not** import this file. Tests: `drainer/drainer.test.ts` has one direct test (`QuotaLimiter grants within budget and denies (with rollback) past it`) — fake store, `readBudget: 2`, three `reserve("read", 1)`, third denied, stored rolled back to 2. The same file’s writer tests duck-type `{ reserve }` (`grantAll`, `denyReads`) — those are the writer **interface**, not this one. There is no write-budget test, no `count > 1` test, no `count <= 0` test, no window-floor test, no scope test, and no project-budget test on this file.
- Seams callers need: `reserve(opClass, count) → { granted, remaining }` (writer maps deny → `deferred`; drain maps job-level `deferred` → 60s retry, no attempt); injected `store` (tests without Mongo); injected `readBudget` / `writeBudget` (tests without env); default `SheetSyncQuotaBucket` + scope `"user"` on the live drain; one limiter instance per drain so every tab in that invocation shares the same minute
- Split later (only if the file outgrows one sitting): this ~90-line file is one sitting if you read it as open this minute’s budget → increment the token → grant, or roll the extra tokens back and deny. Do not split into `reserve.ts` / `rollback.ts` / `window.ts`. Never merge drain claim, already-recommended `writeBatchedTargets`, already-recommended `buildTabRowMap`, or legacy `waitUntil` into this file

`QuotaLimiter.reserve` is executor mechanics. The owner question is: *The drain already claimed the jobs. The writer is about to spend one Google read or one Google write. Ask this minute’s bucket whether we still have that token. If we do, spend it and go on. If we do not, put the tokens back and say no — the writer will mark those rows deferred, and the drain will try again in sixty seconds without burning an attempt. Never sleep. A serverless invocation that waits for the next minute is a hung function, not a polite retry. This file does not write cells. This file does not claim. This file does not mark the job. Legacy still sits on the request with `waitUntil`. Do not silently teach this file to sleep, and do not silently teach legacy to reserve here.*

Coordinator persist / finalize, outbox coalesce, queue wake-up, legacy per-row upsert, drain seat / claim / finalize, planner tab choice, already-recommended batch write, already-recommended tab map, and Google Sheets projections already live in other **modules**. Do not pull those in.

## What this file actually does

One operation, not “a quota CRUD service,” and not the writer / the drain / a sleep:

1. **Reserve this minute's Sheets budget** — `new QuotaLimiter(options?).reserve(opClass, count = 1)`. Floor `Date.now()` to the current minute. `$inc` `count` on `{ scope, op_class, window_start }` (`upsert`, `returnDocument: "after"`). If `after > budget`, `$inc` the same count back down and return `{ granted: false, remaining: max(0, budget - (after - count)) }`. Else `{ granted: true, remaining: budget - after }`. `count <= 0` grants immediately with `remaining: budget` and does not touch the store. Default store is `SheetSyncQuotaBucket`. Default scope is `"user"`. Default budgets are `getSheetSyncBudgets().readsPerMinute` / `writesPerMinute` (45 / 45). Read and write are separate buckets. This function does not sleep. This function does not call Google. This function does not mark a job `deferred` / `retrying` / `synced`.

There is no second mutate operation. Mode, wake-up, claim, plan, write, remember, and outbox coalesce are other files. Legacy `waitUntil` is a different **adapter** for the same owner cells — it never asks this file.

## Organization

Keep one file as the screenplay for “reserve this minute's Sheets budget — grant or deny, never sleep — a denied token lets the writer defer without burning an attempt.” Drain seat / claim / finalize, already-recommended batch write, already-recommended tab map, planner tab choice, legacy `waitUntil`, coordinator, outbox, queue, and Google Sheets projections already live in deeper **modules**. Do not pull those in. Do not invent a `SheetSyncQuotaLimiterService` class. Do not keep `QuotaLimiter` as the *story* — a class here is a folder with a constructor. Do not invent a persist / finalize **seam** here — that **seam** already lives on the coordinator and the drain’s `updateOne`. Do not invent a second write **adapter** beside already-recommended `writeBatchedTargets`. Do not invent a sleep **adapter**.

Do not split this into `reserve.ts` / `rollback.ts` / `window.ts`. Those are beats of one ask. Do not move this into `batchWriter.ts` so “the writer already reserves.” Do not move this into `runSheetSyncDrain.ts` so “the drain already owns the minute.” Do not silently `sleep` until `window_start + 60s` so “we wait our turn.”

**External interface** stays small (this is the test surface). Increment, compare, and rollback are one story’s ask, not three CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `QuotaLimiter` (constructor) | `openThisMinutesSheetsBudget` | drain opens one budget for the whole invocation |
| `QuotaLimiter.reserve` | `reserveThisMinutesSheetsBudget` | writer asks before each Google read or write chunk |
| `QuotaReservation` | `SheetsMinuteReservation` | `{ granted, remaining }` is the writer’s defer **seam** |
| `QuotaBucketStore` | keep | tests inject Mongo without a live collection |

Keep the old class as a one-line compatibility wrapper until the drain, the writer, both barrels, and `drainer.test.ts` migrate. Do not make callers learn `SheetSyncQuotaBucket` / `window_start` / `op_class` as the domain language.

**Principle: old exports stay as aliases.** `new QuotaLimiter().reserve("read", 1)` remains the imported shape until `runSheetSyncDrain` and `writeBatchedTargets` point at the story names.

Do not grow this **interface** with `deferred` / `status` so “the limiter can finish the job.” Do not grow it with `sleepMs` so “the caller can wait.” Do not grow it with `project` reservations — config lists those ceilings; this file never spends them.

**No class for the workflow.** The type that *does* earn a name is the answer we hand the writer:

```ts
type SheetsMinuteReservation = {
  granted: boolean
  remaining: number
}
```

That is the handoff from “we are about to spend one Google call” to “write the tab, or hand the drain `deferred` so it comes back next minute.” Do **not** add `status: "deferred"` so “the limiter can finish the job,” do **not** add `sleepMs` so “the writer can wait,” and do **not** add `official_booking_details` so “a booked reserve can confirm.”

`store` / `readBudget` / `writeBudget` / `scope` stay on the open-args because they are a real injected **adapter**, not a second persistence. Default scope stays `"user"` because the binding Google ceiling is per service account.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// drainer/quotaLimiter.ts
// The drain already claimed the jobs.
// The writer is about to spend one Google read or one Google write.
// Ask this minute’s bucket whether we still have that token.
// If we do, spend it and go on.
// If we do not, put the tokens back and say no.
// The writer will mark those rows deferred.
// The drain will try again in sixty seconds without burning an attempt.
// Never sleep.
// A serverless invocation that waits for the next minute is a hung function.
// This file does not write cells.
// This file does not claim.
// This file does not mark the job.
// Legacy still sits on the request with waitUntil.
// Do not silently teach this file to sleep.

// ── 1. Reserve this minute's Sheets budget ────────────────

export function openThisMinutesSheetsBudget(options?: {
  store?: QuotaBucketStore
  scope?: string
  readBudget?: number
  writeBudget?: number
}): { reserve: typeof reserveThisMinutesSheetsBudget }

export async function reserveThisMinutesSheetsBudget(
  budget,
  opClass,          // "read" | "write" — separate buckets
  count = 1,
): Promise<SheetsMinuteReservation>

export class QuotaLimiter { /* alias until drain / writer / tests migrate */ }
export type QuotaReservation = SheetsMinuteReservation

function thisMinutesWindow(now = Date.now())
  // floor to the current calendar minute

function budgetForThisKindOfCall(opClass)
  // readBudget vs writeBudget — never one mixed pool

async function incrementThisMinutesTokens(store, scope, opClass, window, count)
async function putTheExtraTokensBack(store, filter, count)
  // only when after > budget
```

Read the primary path out loud: *The drain opened one budget for this invocation. The writer is about to read Calls. We increment this minute’s read bucket by one. The count is still at or under 45, so we say yes and how many tokens are left. The writer reads the tab. Later it asks again for a write. Same story, other bucket. We do not sleep. We do not mark the job.*

Read the deny beat out loud: *The increment landed at 46. That is over the operational budget. We subtract the one we just added and say no, remaining 0. The writer marks every write on that tab `deferred`. The drain sets the job `retrying` for sixty seconds and does not burn an attempt. Next minute is a new window. We never wait here for that minute.*

Read the two-adapters beat out loud: *Legacy `waitUntil` still sits on the incoming request and can spend Google calls without asking this bucket. This file is the queued minute. Both **adapters** stay. We do not call `sleep` from here so “queued waits like legacy,” and we do not teach `syncSourceLeadById` to reserve here so “one limiter owns every mode.”*

That is the operation. `QuotaLimiter.reserve` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **A class is executor mechanics.** `QuotaLimiter` with `reserve` is a token-bucket object. The owner story is “ask this minute, grant or deny, never sleep.” Open a budget, then reserve against it. Keep the class as a one-line compatibility wrapper. Do not grow a `SheetSyncQuotaLimiterService` with `get` / `tryReserve` / `release`.

2. **Increment-then-rollback is the load-bearing ask, not compare-and-set.** `$inc` first; if `after > budget`, `$inc` the same count back down. Two concurrent reserves can both increment past the ceiling and both deny — that is fail-closed. Do not switch to `findOneAndUpdate` with `{ count: { $lte: budget - count } }` in this rename so “one write is enough” without a concurrency test. Do not drop the rollback so “the next drain can see we tried” — leftover count would starve the rest of the minute.

3. **Read and write are separate buckets.** Same `scope`, same `window_start`, different `op_class`. A spent read budget does not block a write, and the other way around. Do not merge them into one “Sheets call” pool in this rename so “Google counts both” — Google’s published ceilings are already split, and the writer’s one-read-then-N-writes shape depends on that split.

4. **Default scope is `user`. Project ceilings are declared and unused.** `getSheetSyncBudgets()` also returns `projectReadsPerMinute` / `projectWritesPerMinute` (250 / 250 under Google 300 / 300). The model comment says `scope` distinguishes `user` from `project`. This file never opens a project bucket. Do not start reserving both scopes in this rename so “we honor both ceilings” — only the per-user 60 is the binding constraint the comment names, and only the user 45 is wired.

5. **The window is the calendar minute, not a sliding 60 seconds.** `Math.floor(now / 60_000) * 60_000`. A reserve at `:59` and one at `:00` are different documents. The drain’s 60s defer is how we land in the next window. Do not change to `now - 60_000` sliding so “fairer.” Do not inject a clock **adapter** in this pass so “tests can freeze time” unless a window test needs it — today’s fake store ignores `filter`.

6. **`count <= 0` grants without touching the store, and `remaining` is the full budget, not leftover.** The writer always passes `1`. Do not start `$inc` 0 so “the window document exists.” Do not change leftover math on this path in this rename so “zero-count remaining is honest” — nothing calls it.

7. **`count > 1` that would overflow rolls back the whole increment.** One ask, all-or-nothing. The writer never batches tokens (`reserve("write", chunk.length)`). Do not start charging one token per row in this rename so “the budget matches cells” — the writer’s unit is one Google call.

8. **`remaining` on deny is `budget - (after - count)`, floored at 0.** That is “what was already spent before this ask.” On grant it is `budget - after`. Name both. Do not return `budget` on deny so “remaining means the ceiling.”

9. **This file does not sleep, defer, or mark a job.** `granted: false` is the whole answer. Writer maps deny → `deferred` + `quota_budget_exhausted`. Drain maps job-level `deferred` → `retrying` in 60s, no attempt. Do not `await setTimeout` until the next window so “we wait our turn.” Do not return `{ status: "deferred" }` so “the limiter can finish the job.” Do not call `markJobFailure` / `deferJob` from here.

10. **`ensureTabsAndHeaders` and `spreadsheets.get` (sheet id) are unmetered on the writer.** Already named on [recommendations/sheet-sync-batch-writer.md](sheet-sync-batch-writer.md). Do not start reserving those from this file so “every Google call is honest.” The limiter answers the asks it is given.

11. **Budgets are snapshotted at open, not re-read per reserve.** Constructor calls `getSheetSyncBudgets()` once. Live tuning mid-drain does not change this invocation. Do not re-read env on every `reserve` so “ops can tighten a running drain.”

12. **Store default is `SheetSyncQuotaBucket` via a double cast.** Tests inject `QuotaBucketStore`. Keep that **adapter**. Do not import the model from the writer. Do not add a second store for project scope.

13. **Unique `{ scope, op_class, window_start }` can throw on concurrent upsert.** The limiter does not retry 11000. Do not add a retry loop in this rename so “races are quiet” without a test. Leave the index on the model.

14. **TTL is one hour after `window_start`.** That lives on the model, not here. Do not add a janitor in this file so “we clean our own windows.”

15. **Leave sibling modules alone.** `writeBatchedTargets` / `deferGroup` stay on already-recommended `batchWriter.ts`. `deferJob` / `runSheetSyncDrain` stay on the already-recommended drain. `buildTabRowMap` stays on already-recommended `tabRowMap.ts`. `getSheetSyncBudgets` stays in `config/domain`. `SheetSyncQuotaBucket` stays on the model. `waitUntil` / `upsertRow` stay on already-recommended source lookup / later `googleSheets`. This file orchestrates open the minute → increment → grant or put the tokens back.

## Testing

The **interface** is the test surface: `openThisMinutesSheetsBudget` + `reserveThisMinutesSheetsBudget` (today `new QuotaLimiter(...).reserve`). `{ granted, remaining }` is part of that **interface**. Inject `store` and budgets; do not boot Google Sheets or Mongo.

`drainer.test.ts` already locks two granted reads at budget 2, a third deny, and rollback to stored `2`. That is the right **interface**. It is not enough. The same file also tests already-recommended `writeBatchedTargets` and already-recommended `buildTabRowMap` — leave those; do not treat writer `denyReads` as coverage of this file’s rollback.

**Reserve this minute's Sheets budget**
- Two `reserve("read", 1)` at `readBudget: 2` → both `granted: true`; third → `granted: false` and store rolled back to 2 (already locked).
- Same pattern on `"write"` with `writeBudget: 2` — read spends do **not** consume write tokens.
- `reserve("read", 2)` at `readBudget: 2` when empty → granted, `remaining: 0`.
- `reserve("read", 3)` at `readBudget: 2` when empty → denied, store back to 0 (whole increment rolled back).
- `count <= 0` → `granted: true`, no `findOneAndUpdate`.
- Grant `remaining` is `budget - after`; deny `remaining` is leftover before this ask.
- Filter includes `scope` (default `"user"`), `op_class`, and a `window_start` floored to the current minute.
- Two scopes (`"user"` vs `"other"`) do not share a count.
- Does not call `setTimeout` / `sleep`.
- Does not call `values.get` / `values.update` / `values.append` / `spreadsheets.batchUpdate`.

**Not this interface**
- Persist / finalize / unmigrated schedule stay on [recommendations/sheet-sync-coordinator.md](sheet-sync-coordinator.md).
- Remember-or-fold / tombstone enqueue stay on [recommendations/sheet-sync-outbox.md](sheet-sync-outbox.md).
- Wake-up stays on [recommendations/sheet-sync-queue.md](sheet-sync-queue.md).
- Legacy `save()` remember stays on [recommendations/sheet-sync-persistence.md](sheet-sync-persistence.md).
- Live lookup-then-write / `upsertRow` / `waitUntil` stay on [recommendations/sheet-sync-source-lookup.md](sheet-sync-source-lookup.md) and later `googleSheets/`.
- Take-the-seat / claim / empty-plan→`synced` / quota defer **of the job** stay on [recommendations/sheet-sync-run-sheet-sync-drain.md](sheet-sync-run-sheet-sync-drain.md).
- Reload current Mongo / unmatched skip / vanished Booking stay on [recommendations/sheet-sync-job-planner.md](sheet-sync-job-planner.md).
- Update / append / delete / remembered-row refuse / read-quota defer **of the tab** stay on [recommendations/sheet-sync-batch-writer.md](sheet-sync-batch-writer.md).
- Mongo-id column vs shifted-cell fallback stays on [recommendations/sheet-sync-tab-row-map.md](sheet-sync-tab-row-map.md).
- Default 45 / 45 and env overrides stay on `src/config/domain/sheetSync.test.ts` (`getSheetSyncBudgets`).
- Projection cell values stay on later `googleSheets/projections`.

Do **not** add a test per helper (`thisMinutesWindow`, `putTheExtraTokensBack`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do not add a test that this file marks a job `synced` or `deferred` — it must not. Do not add a test that this file sleeps until the next minute — it must not. Do not add a test that a denied reserve still leaves the increment in the store — it must not. Do not add a test that project budgets are spent — they are not wired.

`store` stays on the open-args because the tests are a real **adapter**, not a test leak.

## What I would not do

- A `SheetSyncQuotaLimiterService` class with `get` / `tryReserve` / `release`.
- Thirty two-line functions that only wrap `$inc`.
- Moving this into a CRUD folder, or into `batchWriter.ts` / `runSheetSyncDrain.ts` / `googleSheets/` “for cleanliness.”
- Breaking the increment / compare / rollback **seam**. Order is the owner story.
- Treating `persistSheetSyncIntent` / `publishSheetSyncWakeup` / `syncAndStore` / `syncSourceLeadById` / `planJobWrites` / `writeBatchedTargets` / `runSheetSyncDrain` as this story.
- Inventing a sleep **seam** that has only one **adapter** here.
- Silently teaching this file to `sleep` until the next window, or silently teaching legacy `waitUntil` to reserve here, or silently spending the unused project budget, or silently leaving an overflowing `$inc` in the store.
- Writing a whole-folder recommendation for `sheetSync`.
- Opening `googleSheets` in this same pass — this was the last unchecked `sheetSync` module; the next run enumerates `googleSheets`.
- Marking the job `synced` from this file, or making the Form Lead 201 wait on a quota reserve.
