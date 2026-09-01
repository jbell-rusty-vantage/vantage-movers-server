# Wait For The Quota Window Then Try This Google Call Again — A 429 Does Not Leave The Source Sheet Stale — After Five Retries Throw So The Caller Can Mark Failed — operational story

- Status: recommended
- Service: `googleSheets` (Wave A, in-progress)
- Pass: 7 of this service — `retry.ts`
- Remaining in this service: `projections/formLeadRow.ts`, `projections/callLeadRow.ts`, `projections/bookedLeadRow.ts`, `projections/cancelledLeadRow.ts` (`types.ts` / `auth.ts` / `diagnostics.ts` / `projections/cells.ts` skipped on open)
- Target: `src/services/googleSheets/retry.ts`
- Knowledge: [`docs/knowledge/services/google-sheets.md`](../../../docs/knowledge/services/google-sheets.md) (external Google calls belong in this folder or its `auth` / `tabs` / `retry` submodules — not in lead or booking services). Distinct from already-recommended choose-tabs-then-write-or-take-off: [recommendations/google-sheets-google-sheets.md](google-sheets-google-sheets.md) (that facade never imports this file; already-recommended write / take-off / ensure wrap Google here). Distinct from already-recommended destination naming: [recommendations/google-sheets-targets.md](google-sheets-targets.md) (that file never talks to Google). Distinct from already-recommended one-tab ensure: [recommendations/google-sheets-tabs.md](google-sheets-tabs.md) (wraps every Google call here — `values.update.headers`, `values.clear`, `batchUpdate.addSheet`, `batchUpdate.expandColumns`, `batchUpdate.formatTimestampColumn`, `spreadsheets.get`). Distinct from already-recommended live write loop: [recommendations/google-sheets-sync-rows.md](google-sheets-sync-rows.md) (that file does **not** wrap Google; already-recommended upsert does). Distinct from already-recommended find-then-write: [recommendations/google-sheets-row-lookup.md](google-sheets-row-lookup.md) (`values.get.rowCheck`, `values.get.lookup`, `values.update.row`, `values.append.row`). Distinct from already-recommended live take-off: [recommendations/google-sheets-delete-rows.md](google-sheets-delete-rows.md) (`batchUpdate.deleteRow` singular). Distinct from already-recommended queued batch: [recommendations/sheet-sync-batch-writer.md](sheet-sync-batch-writer.md) (`values.batchUpdate.rows`, `values.append.rows`, `batchUpdate.deleteRows` plural, `spreadsheets.get.sheetId` — reserves first, then still asks this file). Distinct from already-recommended tab map: [recommendations/sheet-sync-tab-row-map.md](sheet-sync-tab-row-map.md) (`values.get.tabMap`). Distinct from already-recommended reserve-never-sleep: [recommendations/sheet-sync-quota-limiter.md](sheet-sync-quota-limiter.md) (that file **never sleeps** and never calls Google; a denied token lets the writer defer; this file **sleeps** so the same call can land in this invocation). Distinct from already-recommended drain finalize: [recommendations/sheet-sync-run-sheet-sync-drain.md](sheet-sync-run-sheet-sync-drain.md) (job-level `retrying` is 30s × 2^(attempts-1), cap 15 min, 8 attempts, or quota `deferred` → 60s **without** burning an attempt — a different clock). Distinct from admin `retrySheetSyncJobs` on [`sheet-sync.md`](../../../docs/knowledge/services/sheet-sync.md) (Owner requeues `failed` jobs; does not wrap a Google call). Distinct from skipped `diagnostics.ts` (`formatGoogleApiError` is the reason/status fold this file already asks — do not pull that file in). Distinct from leftover root barrel `src/services/googleSheets.service.ts` (Wave A `legacy-root` — does **not** re-export this file). Distinct from executor-owned txn + non-replay finalize: [`domain-commands.md`](../../../docs/knowledge/services/domain-commands.md). This checkout’s `CONTEXT.md` names Sheet Sync in the intro and points at a parent glossary that is not in this tree — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. The file comment already names the source-sheet “did not update” symptom; knowledge already names queued defer-not-sleep; do not “fix” those in this rename.
- Callers: **five runtime import sites, sixteen call sites. No file test. `isRetryableSheetsError` has no external importer.** Already-recommended ensure: `tabs.ts` — six labels (`values.update.headers`, `values.clear`, `batchUpdate.addSheet`, `batchUpdate.expandColumns`, `batchUpdate.formatTimestampColumn`, `spreadsheets.get`). Already-recommended find-then-write: `rowLookup.ts` — four labels (`values.get.rowCheck`, `values.get.lookup`, `values.update.row`, `values.append.row`). Already-recommended live take-off: `deleteRows.ts` — one label (`batchUpdate.deleteRow`). Already-recommended tab map: `sheetSync/drainer/tabRowMap.ts` — one label (`values.get.tabMap`). Already-recommended queued writer: `sheetSync/drainer/batchWriter.ts` — four labels (`values.batchUpdate.rows`, `values.append.rows`, `batchUpdate.deleteRows`, `spreadsheets.get.sheetId`). Already-recommended facade / `syncRows.ts` / `targets.ts` / leftover domain services / `v1.service.ts` / leftover root barrel do **not** import this file. There is no `retry.test.ts`. Not this **interface**: already-recommended Forms-or-Duplicates choice, already-recommended Master-vs-source destination lists, already-recommended one-tab ensure itself, already-recommended continue-on-failure write, already-recommended hint-then-scan, already-recommended `deleteDimension`, already-recommended queued high-to-low batch, already-recommended grant-or-deny minute, already-recommended job-level `retrying`, later `*ToRow`, skipped error format / client factory.
- Seams callers need: wrap this Google call vs decide the tab / cells / destination; sleep-and-retry this invocation vs already-recommended reserve-and-defer the job; honor `Retry-After` vs exponential + jitter; a quota/backend blip vs a permission / not-found / auth throw; the `operation` string as a log label vs a domain verb; live unmetered wait (`waitUntil` can sit on the request) vs queued reserve-then-still-wait
- Split later (only if the file outgrows one sitting): this ~95-line file is one sitting if you read it as wait for the quota window then try this Google call again, a 429 does not leave the source sheet stale, after five retries throw so the caller can mark failed. If it later splits: `thisGoogleErrorIsAQuotaOrBackendBlip.ts` / `howLongToWaitForTheQuotaWindow.ts` — story files, never `create.ts` / `update.ts` / `delete.ts` / `retry.ts` as a CRUD dump, and never merge already-recommended `ensureTabsAndHeaders`, already-recommended `upsertRow`, already-recommended `deleteRowsFromTargets`, already-recommended `writeBatchedTargets`, already-recommended `QuotaLimiter`, or already-recommended drain finalize into this file

`withSheetsRetry` is executor mechanics. The owner question is: *A burst of lead syncs can momentarily exceed Google’s per-minute write quota. Without waiting, the Source Company sheet stays stale until the next owner edit — that is the “did not update” symptom the file already names. Try the Google call. If Google says 429, 503, a known quota/rate-limit/backend reason, or the message says quota exceeded, wait (honor `Retry-After` when Google sent seconds, otherwise back off from one second with jitter, never more than 32 seconds), then try the same call again. After five retries, throw so already-recommended live write can store `failed` and already-recommended queued writer can mark the chunk `failed`. Do not reserve a minute-token. Do not persist. Do not decide which tab. Do not decide Forms or Duplicates. Queued already reserves first and defers without sleeping; this file still wraps the actual Google call so a 429 that slipped past the 45/45 budget can still land in this drain. Do not silently teach this file to deny-and-return so “we match the limiter.” Sheets are reporting. They are never the record.*

Already-recommended facade tab choice, already-recommended destination naming, already-recommended one-tab ensure, already-recommended live write / take-off, already-recommended queued batch, already-recommended grant-or-deny minute, and already-recommended job-level retry already live in other **modules**. Do not pull those in.

## What this file actually does

Three beats of one “wait for the quota window then try this Google call again — a 429 does not leave the source sheet stale — after five retries throw so the caller can mark failed” story, not “a retry CRUD helper,” and not the limiter’s grant-or-deny:

1. **Try this Google call — wait and try again on a quota or backend blip** — `withSheetsRetry(operation, fn)`. Call `fn`. On success, return that value. On throw: increment `attempt`. If `attempt > 5` or the error is not a quota/backend blip, rethrow the same error. Otherwise log `sheets.retry.backoff` with the `operation` label, the attempt, `maxRetries: 5`, the delay, and skipped `formatGoogleApiError` status/reasons, then `sleep`, then the same `fn` again. First try is not an attempt. Five retries means six calls in the worst case. This beat does not choose a tab. This beat does not persist. This beat does not reserve a token.

2. **This Google error is a quota or backend blip** — `isRetryableSheetsError(error)`. Ask skipped `formatGoogleApiError`. Retry when HTTP status is 429 or 503 (`details.status`, else `Number(details.code)`), when any reason lowercases into `ratelimitexceeded` / `userratelimitexceeded` / `quotaexceeded` / `backenderror`, or when the message lowercases to include `quota exceeded`. 403 / 404 / 401 / permission / not-found / invalid-grant are not blips. A 500 without `backenderror` is not a blip. Exported today; **no runtime importer** outside this file. This beat does not sleep. This beat does not call Google.

3. **How long to wait for the quota window** — `computeBackoffDelayMs`. If `error.response.headers["retry-after"]` parses as a finite non-negative number of **seconds**, wait that many milliseconds, capped at 32s. Otherwise `min(1000 * 2^(attempt-1), 32000)` plus jitter `0…999` ms, still capped at 32s. First retry (`attempt === 1`) is about one second. This beat does not parse HTTP-date `Retry-After`. This beat does not look at `Retry-After-Ms`. This beat does not reserve a token.

There is no fourth mutate operation. Tab **choice**, destination lists, header heal, upsert-by-Mongo-ID, `deleteDimension`, queued batch, grant-or-deny minute, and job-level `retrying` already live in other files. `sleep` is the wait, not a public **seam**.

## Organization

Keep one file as the screenplay for “wait for the quota window then try this Google call again — a 429 does not leave the source sheet stale — after five retries throw so the caller can mark failed.” Already-recommended `ensureTabsAndHeaders` / `upsertRow` / `deleteRowsFromTargets` / `writeBatchedTargets` / `buildTabRowMap`, already-recommended `QuotaLimiter`, already-recommended drain finalize, and skipped `formatGoogleApiError` already live in deeper **modules**. Do not pull those in. Do not invent a `GoogleSheetsRetryService` class. Do not invent a persist / finalize **seam** here — that **seam** already lives on the coordinator and already-recommended `syncAndStore`. Do not invent a grant-or-deny **seam** beside already-recommended `QuotaLimiter`. Do not invent a second job-retry **adapter** beside already-recommended drain finalize.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `retry.ts`. Those are HTTP verbs, not the owner story. Do not move this into `quotaLimiter.ts` so “one file owns every quota.” Do not move this into `batchWriter.ts` so “the writer already retries.” Do not move this into `diagnostics.ts` so “error format already knows 429.” Do not silently deny-and-return so “we never sleep.” Do not silently add 500 / `ECONNRESET` so “every blip waits.”

**External interface** stays small (this is the test surface). Try-again, blip decision, and wait are one story’s Google wait, not three CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `withSheetsRetry` | `waitForTheQuotaWindowThenTryThisGoogleCallAgain` | already-recommended ensure / find-then-write / live take-off / queued writer / tab map wrap every Google call |
| `isRetryableSheetsError` | `thisGoogleErrorIsAQuotaOrBackendBlip` | named decision the parent already asks — keep the export as an alias; do not grow a second public caller |

Keep the old names as one-line aliases until the five runtime import sites migrate. Do not make callers learn `MAX_RETRIES` / `RETRYABLE_REASONS` / `retry-after` as the domain language.

**Principle: old exports stay as aliases.** `withSheetsRetry` remains the imported name until already-recommended `tabs.ts` / `rowLookup.ts` / `deleteRows.ts` / `tabRowMap.ts` / `batchWriter.ts` point at the story name.

**No class for the workflow.** No new type earns a name here. The handoff is the `fn` the caller already built: “this is the Google call; if it 429s, wait and try **that same call** again.” Do **not** add `granted` so “this file can defer the job,” do **not** add `sleepMs` on the return so “the caller can wait,” and do **not** add `status: "failed"` so “this file can persist.”

Do not add `computeBackoffDelayMs` / `parseRetryAfterMs` / `sleep` as public **seams** so “tests can skip the loop.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// retry.ts
// A burst of lead syncs can momentarily exceed
// Google's per-minute write quota.
// Without waiting, the Source Company sheet stays stale
// until the next owner edit.
// That is the "did not update" symptom.
// Try the Google call.
// If Google says 429, 503, a known quota/rate-limit/backend reason,
// or the message says quota exceeded,
// wait, then try the same call again.
// Honor Retry-After when Google sent seconds.
// Otherwise back off from one second with jitter.
// Never wait more than 32 seconds.
// After five retries, throw so the caller can mark failed.
// Do not reserve a minute-token.
// Do not persist.
// Do not decide which tab.
// Queued already reserves first and defers without sleeping.
// This file still wraps the actual Google call
// so a 429 that slipped past the 45/45 budget can still land.
// Do not silently teach this file to deny-and-return.
// Sheets are reporting. They are never the record.

// ── 1. Try this Google call — wait and try again ──────────

export async function waitForTheQuotaWindowThenTryThisGoogleCallAgain<T>(
  operation, // log label only — not a domain verb
  googleCall: () => Promise<T>,
): Promise<T>
export const withSheetsRetry =
  waitForTheQuotaWindowThenTryThisGoogleCallAgain

function logThatWeAreWaitingForTheQuotaWindow(operation, attempt, delayMs, error)
async function waitThenTryTheSameGoogleCallAgain(delayMs)

// ── 2. This Google error is a quota or backend blip ───────

export function thisGoogleErrorIsAQuotaOrBackendBlip(error): boolean
export const isRetryableSheetsError = thisGoogleErrorIsAQuotaOrBackendBlip
  // 429 / 503
  // or reason in ratelimitexceeded / userratelimitexceeded / quotaexceeded / backenderror
  // or message includes "quota exceeded"
  // 403 / 404 / 401 / permission / not-found are not blips

// ── 3. How long to wait for the quota window ──────────────

function howLongToWaitForTheQuotaWindow(error, attempt)
  // Retry-After seconds, cap 32s
  // else 1000 * 2^(attempt-1) + jitter 0…999, cap 32s
```

Read the live Source Company 429 path out loud: *Already-recommended write already ensured Duplicates on Master and stored synced. Source Duplicates then 429s inside already-recommended upsert. We wait about a second, try the same `values.update` again, and the row lands. Already-recommended write never sees a throw. The Source Company sheet is not left stale until the next owner edit. We do not reserve a token. We do not save the document.*

Read the queued slip-past-budget path out loud: *Already-recommended limiter granted the write token. Google still 429s. We wait and try the same `values.batchUpdate` again. If it lands, the chunk is `synced`. If it 429s six times, we throw and the writer marks the chunk `failed` — not `deferred`. The drain’s 60-second no-attempt retry is only for a denied token. We do not return `{ granted: false }` so “retry matches reserve.”*

Read the permission throw out loud: *Google says 403. That is not a quota blip. We do not wait. We throw on the first failure so the caller can store `failed` with skipped `formatGoogleApiError`’s share-the-sheet hint. Five sleeps would hide a spreadsheet the service account cannot edit.*

That is the operation. `withSheetsRetry` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`withSheetsRetry` is executor mechanics.** The owner story is “wait for the quota window, then try this Google call again, so a 429 does not leave the source sheet stale.” Keep the old name as an alias. Do not grow a `GoogleSheetsRetryService` with `create` / `update` / `delete`.

2. **Two quota adapters, one Google ceiling.** Already-recommended `QuotaLimiter` grants or denies and **never sleeps**. This file sleeps so the same call can land in this invocation. Knowledge already names defer-not-sleep for queued. The file comment already names live “did not update.” Keep both **adapters**. Do not silently teach this file to return `{ granted: false }` so “we match the limiter.” Do not silently teach the limiter to `sleep` until `window_start + 60s` so “queued waits like live.” Do not import `QuotaLimiter` here so “every wait is honest.”

3. **Three clocks, one word “retry.”** This file: up to five sleeps, 1s exponential, cap 32s, same Google call. Already-recommended drain finalize: job `retrying` at 30s × 2^(attempts-1), cap 15 min, 8 attempts. Quota `deferred`: 60s **without** burning an attempt. Admin `retrySheetSyncJobs` requeues `failed` and starts a drain. Do not merge those clocks so “one retry owns every wait.” Do not change this file’s five retries to eight so “we match the job.” Do not start burning a job attempt from this file.

4. **`MAX_RETRIES = 5` is six calls.** The first `fn()` is attempt 0. The sixth failure (`attempt > 5`) throws. Testers who expect five total calls will write a false fail. Name the story “five retries after the first try.” Do not change the counter in this rename so “the constant matches the calls.”

5. **`isRetryableSheetsError` is exported and unused outside.** It is the named blip decision, not a second public **seam**. Keep the alias. Do not add a `batchWriter` import so “the writer can pre-check.” Do not drop the export in this pass so “the parent can inline it” without a test that 403 still throws on the first call.

6. **`Retry-After` is seconds only.** `Number(header) * 1000`. An HTTP-date header becomes `NaN` and falls through to exponential. Do not silently parse HTTP-date in this rename so “we honor RFC 7231.” Do not read `retry-after-ms`. Do not treat a missing header as zero seconds so “we retry immediately.”

7. **Jitter is `Math.random()`.** Exact-delay tests will flake. Prove `Retry-After` and the 32s cap. Do not inject a clock / random **adapter** in this pass so “tests can freeze jitter” unless a cap test needs it.

8. **Status 500 is not a blip unless the reason is `backenderror`.** 503 is. `ECONNRESET` via `Number(details.code)` is `NaN` and does not retry. Do not add 500 / network codes in this rename so “every blip waits” — a hung drain that retries a bad request is worse than a fast `failed`.

9. **The `operation` string is a log label.** Live take-off is `batchUpdate.deleteRow`. Queued take-off is `batchUpdate.deleteRows`. Live lookup is `values.get.lookup`. Queued map is `values.get.tabMap`. Rename functions; keep the strings until log / retry searches migrate on purpose. Do not unify live singular with queued plural so “one search owns every delete.” Do not start routing on the string so “this file can choose update vs append.”

10. **This file does not persist and does not mark the job.** Already-recommended live write catches the final throw and stores `failed`. Already-recommended queued writer catches and marks the chunk `failed`. Already-recommended live take-off does **not** catch — a throw here aborts the rest of that list. Do not `document.save()` here so “the waiter owns the hint.” Do not return `{ status: "failed" }` so “the caller can stop mapping.”

11. **This file does not reserve quota.** Live ensure / upsert / take-off are unmetered and may sit on `waitUntil`. Queued already reserved before it asks this file. Do not start reserving a token per retry so “each sleep is honest” — a retried call would spend two tokens for one write. Do not skip the wait when the limiter would have denied so “live matches queued.”

12. **Skipped `formatGoogleApiError` stays on `diagnostics.ts`.** This file asks it for status, reasons, and message. Do not copy reason parsing here so “retry can live without diagnostics.” Do not start returning the hint from this file so “the waiter can persist the share-the-sheet text.”

13. **Leave sibling modules alone.** Already-recommended `ensureTabsAndHeaders` / `upsertRow` / `deleteRowsFromTargets` / `writeBatchedTargets` / `buildTabRowMap` stay where they are. Already-recommended `QuotaLimiter` / drain finalize stay where they are. Skipped `formatGoogleApiError` / `getSheetsClient` stay where they are. This file orchestrates try → blip? → wait → try the same call.

## Testing

The **interface** is the test surface: the two exports (story names, old names as aliases). First-try success, 429-then-land, 403-throws-immediately, six-blips-then-throw, `Retry-After` seconds, 32s cap, and reason / message blips are part of that **interface**. Stub `fn` in-process; do not boot Google Sheets.

There is no `retry.test.ts` today. That is not enough for a wait this load-bearing.

Add tests that name the operation:

**Try this Google call — wait and try again**
- `fn` resolves on the first try → that value; `fn` called once; no sleep.
- `fn` throws 429 once, then resolves → that value; `fn` called twice; one `sheets.retry.backoff` with the caller’s `operation` label.
- `fn` throws 429 six times → the promise rejects with that error; `fn` called six times (first try + five retries).
- `operation` is echoed on the log and is not interpreted (a label `batchUpdate.deleteRow` does not change the wait).

**This Google error is a quota or backend blip**
- 429 → wait. 503 → wait. Reason `rateLimitExceeded` → wait. Reason `userRateLimitExceeded` → wait. Reason `quotaExceeded` → wait. Reason `backendError` → wait. Message `Quota exceeded` → wait.
- 403 / 404 / 401 → throw on the first call; `fn` called once.
- 500 with no `backenderror` reason → throw on the first call.
- Drive the blip through `waitForTheQuotaWindowThenTryThisGoogleCallAgain`, not a helper-unit on `thisGoogleErrorIsAQuotaOrBackendBlip`.

**How long to wait for the quota window**
- `Retry-After: 2` → sleep about 2000 ms (not 2 ms); then retry.
- `Retry-After: 120` → sleep 32000 ms (the cap), not two minutes.
- Non-numeric `Retry-After` → exponential path, not an immediate retry.
- Do not assert exact jitter on the exponential path.

**Not this interface**
- Forms-or-Duplicates / Calls-or-Duplicate-Calls stay on [recommendations/google-sheets-google-sheets.md](google-sheets-google-sheets.md).
- Master-vs-source destinations stay on [recommendations/google-sheets-targets.md](google-sheets-targets.md).
- Process-cache ensure / leftover clear stay on [recommendations/google-sheets-tabs.md](google-sheets-tabs.md).
- Continue-on-failure write stays on [recommendations/google-sheets-sync-rows.md](google-sheets-sync-rows.md).
- Hint check / tab scan / in-place write / append stay on [recommendations/google-sheets-row-lookup.md](google-sheets-row-lookup.md).
- Live `deleteDimension` / missing-tab no-op stay on [recommendations/google-sheets-delete-rows.md](google-sheets-delete-rows.md).
- Queued high-to-low batch stays on [recommendations/sheet-sync-batch-writer.md](sheet-sync-batch-writer.md).
- Grant-or-deny / never-sleep stays on [recommendations/sheet-sync-quota-limiter.md](sheet-sync-quota-limiter.md).
- Job-level `retrying` / 60s no-attempt defer stays on [recommendations/sheet-sync-run-sheet-sync-drain.md](sheet-sync-run-sheet-sync-drain.md).
- Cell values stay on later `projections/*Row.ts`.
- Share-the-sheet / enable-the-API hints stay on skipped `diagnostics.ts`.

Do **not** add a test per helper (`howLongToWaitForTheQuotaWindow`, `waitThenTryTheSameGoogleCallAgain`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do not add a test that this file chooses `Duplicates` from `duplicate=true` — it must not. Do not add a test that this file calls `document.save()` — it must not. Do not add a test that this file reserves quota — it must not. Do not add a test that this file returns `{ granted: false }` — it must not. Do not add a test that a 403 sleeps five times — it must not. Do not add a test that queued mode skips this file — it must not (the writer still wraps Google here). Do not add a test that live take-off catches here — catch vs throw lives on the caller.

## What I would not do

- A `GoogleSheetsRetryService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `sleep`.
- Moving this into a CRUD folder, or into `quotaLimiter.ts` / `batchWriter.ts` / `diagnostics.ts` / `syncRows.ts` “for cleanliness.”
- Breaking the sleep-and-retry-this-invocation **seam**, or the blip-vs-permission **seam**.
- Treating `ensureTabsAndHeaders` / `upsertRow` / `deleteRowsFromTargets` / `writeBatchedTargets` / `QuotaLimiter` / drain finalize as this story.
- Inventing a grant-or-deny **seam** that has only one **adapter** here, or a job-retry **seam** that has only one **adapter** here.
- Silently teaching this file to deny-and-return so “we match the limiter,” or silently teaching the limiter to sleep so “queued waits like live,” or silently adding 500 / `ECONNRESET` so “every blip waits,” or silently parsing HTTP-date `Retry-After` so “we honor the RFC,” or silently unifying `batchUpdate.deleteRow` with `batchUpdate.deleteRows`.
- Writing a whole-folder recommendation for `googleSheets`.
- Opening `projections/formLeadRow.ts` in this same pass — unchecked `googleSheets` modules remain.
- Making the Form Lead 204 wait on `waitForTheQuotaWindowThenTryThisGoogleCallAgain`.
