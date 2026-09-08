# Inject A Bounded Number Of Google 503s On Create-Spreadsheet, Write-Raw, And Write-Markers — Never On Trash, Never On List, Never On Promote — So Official Retry Can Prove Itself — Today Nobody Asks The Wrap — operational story

- Status: recommended
- Service: `reporting` (Wave A, in-progress)
- Pass: 43 of this service — `live/transientRetryWrapper.ts`
- Remaining in this service: `live/piiSafeEvidence.ts`, then leftover later janitor
- Target: `src/services/reporting/live/transientRetryWrapper.ts`
- Knowledge: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (primary code is `reporting.service.ts`. Role: Owner-designed, checksum-bound reports. Happy path: preview → immutable revision → two-step confirmed run → **worker write**. Skip / fail: “Run read failures — fixed safe envelopes; provider/source details are not exposed.” Cron table names `/api/cron/reporting-delivery-heartbeat` (+ health-scan, cleanup, test-artifact janitor). Knowledge never names this file, `wrapReportingAdaptersWithTransientFailures`, `remainingTransientFailures`, `Injected transient Google 503`, `failureCount`, or a live-test wrap that throws 503 before official Drive / Sheets verbs — do not add a Reporting Service file in this rename so “the Service sentence wins”). Distinct from already-skipped inject counter: `live/liveTestWorkerHooks.ts` (orchestration **asks** `configureLiveTestTransientWriteFailures` when Wave B `REPORTING_LIVE_TEST_INJECT_TRANSIENT_FAILURES>0`; leftover worker `writeBoundedReportingBatch` **asks** `consumeLiveTestTransientWriteFailure` and throws canned `PROVIDER_UNAVAILABLE` **before** leftover pack write; leftover `peek` has no caller; this file is never **asked**). Distinct from already-recommended live orchestration: [`reporting-live-google-orchestration.md`](reporting-live-google-orchestration.md) (snapshot inject **asks** leftover worker hooks then leftover `runReportingDeliveryWorker` / leftover `runWorkerToTerminal` with the unwrapped OAuth adapters; `0` skips leftover inject; this file is never imported). Distinct from already-recommended leftover OAuth wrap: [`reporting-live-test-oauth-adapters.md`](reporting-live-test-oauth-adapters.md) (prove-then-wrap returns official `drive` + `sheets`; this file would wrap those after the fact and does not). Distinct from already-recommended leftover Drive wrap: [`reporting-reporting-drive-adapter.md`](reporting-reporting-drive-adapter.md) (official `createSpreadsheet` / leftover `getFile` / leftover `trashFile` **ask** leftover `wrapProvider` **inside** the verb; this file throws **before** leftover `createSpreadsheet` and never wraps leftover trash / leftover get). Distinct from already-recommended leftover Sheets wrap: [`reporting-reporting-sheets-adapter.md`](reporting-reporting-sheets-adapter.md) (leftover `writeValuesRaw` / leftover `writeOwnershipAndRunMarkers` **ask** leftover `wrapProvider` **inside** the verb; leftover list / leftover create-tab / leftover hide / leftover rename / leftover delete / leftover promote / leftover read / leftover verify / leftover find are unwrapped here). Distinct from already-recommended leftover canned failure: [`reporting-provider-failures.md`](reporting-provider-failures.md) (leftover `sanitizeReportingProviderFailure` **asks** leftover Wave A `durableWork` `classifyGoogleFailure`; leftover `status >= 500` → leftover `retryable_transient`; this file never **asks** leftover sanitize). Distinct from already-recommended leftover pack replay: [`reporting-delivery-engine.md`](reporting-delivery-engine.md) (leftover `writeBoundedReportingBatch` catch **asks** leftover sanitize; leftover `retryable` **asks** leftover `verifyRange` then maybe leftover `writeValuesRaw` again; leftover pack never **asks** this file). Distinct from already-recommended leftover worker: [`reporting-reporting-worker.md`](reporting-reporting-worker.md) (leftover `toFailure` maps leftover `retryable` → leftover `PROVIDER_UNAVAILABLE`; leftover consume hook fires first). Distinct from leftover test fake: `google/fakeReportingGoogle.ts` (`forceTransientFailure` leftover `maybeFail` hits **every** leftover Drive leftover Sheets leftover verb, including leftover trash; leftover message is `Simulated Google 503` with leftover `status` only). Distinct from unvisited mask: `live/piiSafeEvidence.ts`. Distinct from unvisited later janitor / evaluate. Distinct from Wave B `src/config/domain/reportingLiveTest.ts` (`injectTransientFailures` 0–3; leftover orchestration **asks** leftover hooks, not this file). Distinct from Wave B `scripts/reporting/run-live-google-harness.ts` (**asks** leftover facade, never this file). This is not Admin Analytics and not Sheet Sync. This checkout’s `CONTEXT.md` does not define Reporting / Reporting Sheets — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001 Mongo SoR).
- Callers: **no `src/` import of `wrapReportingAdaptersWithTransientFailures`.** Already-recommended leftover orchestration **asks** leftover `configureLiveTestTransientWriteFailures`, never this wrap. Already-recommended leftover worker **asks** leftover `consumeLiveTestTransientWriteFailure`, never this wrap. Already-recommended leftover OAuth wrap never **asks** this file. Leftover pack never **asks** this file. Tests: leftover `live/liveGoogleHarness.test.ts` **asks** leftover `remainingTransientFailures(2, 1) === 1` and leftover `(2, 2) === 0` only — it never **asks** leftover wrap, leftover `createSpreadsheet`, leftover `writeValuesRaw`, or leftover `writeOwnershipAndRunMarkers`. Leftover `liveTestSecurity.test.ts` leftover consume test **asks** leftover worker hooks, not this file. Leftover `reportingDelivery.test.ts` leftover first-write-fails path **asks** leftover fake Google, not this file. Leftover `reporting.test.ts` / leftover `reportingDelivery.regressions.test.ts` do not import this file. Owner HTTP never **asks** this file. Queue consumer never **asks** this file. **No HTTP route** mounts this file.
- Seams callers need: inject-the-next-Google-503-if-any-remain (`maybeFail`) vs wrap-only-create-write-and-markers (`wrapReportingAdaptersWithTransientFailures`). The this-file-wrap / leftover-worker-hooks **seam** exists because leftover orchestration leftover inject **asks** leftover hooks; leftover wrap has **no runtime caller**. The this-file-throw / leftover-official-`wrapProvider` **seam** exists because leftover `maybeFail` throws **before** leftover `input.drive.createSpreadsheet` / leftover `input.sheets.writeValuesRaw` / leftover `input.sheets.writeOwnershipAndRunMarkers`; leftover official leftover `wrapProvider` never sees leftover `Injected transient Google 503`. The leftover-create / leftover-write / leftover-markers **shared-remaining** **seam** exists because one leftover `remaining` counts down across leftover three leftover verbs; leftover first leftover verb leftover wins. The leftover-wrapped-three / leftover-unwrapped-rest **seam** exists because leftover `trashFile` / leftover `getFile` / leftover `listSheets` / leftover `createHiddenStagingTab` / leftover `hideSheet` / leftover `renameSheet` / leftover `deleteSheet` / leftover `promoteStagingTab` / leftover `readValues` / leftover `verifyRange` / leftover `verifyOwnershipAndRunMarkers` / leftover `verifyPublishedManagedTab` / leftover `findSheetByRunMarker` / leftover `verifyOwnershipMarkerBySheetId` pass through. The leftover-wrap / leftover-fake **seam** exists because leftover fake leftover `maybeFail` leftover wraps leftover every leftover verb leftover including leftover trash; leftover message leftover differs. The leftover-wrap-remaining / leftover-`remainingTransientFailures` **seam** exists because leftover wrap leftover remaining is a leftover closure; leftover export leftover subtracts leftover `initial - consumed` and leftover wrap never **asks** it. The leftover-503 / leftover-classify **seam** exists because leftover `status: 503` leftover `code: 503` leftover would leftover classify leftover `retryable_transient` if leftover pack leftover catch leftover saw leftover it. There is no begin / complete Domain Command **seam**. There is no Google write **seam**. There is no leftover trash leftover prove **seam**. There is no HTTP **seam**. There is no Analytics **seam**. There is no Sheet Sync **seam**.
- Split later (only if the file outgrows one sitting): this ~53-line file is one sitting if you read it as inject a bounded number of Google 503s on create-spreadsheet, write-raw, and write-markers — never on trash, never on list, never on promote — so official retry can prove itself. Today nobody asks the wrap. Do **not** split into `wrap.ts` / `remaining.ts` / `create.ts` / `update.ts` / `delete.ts`. Do **not** pull leftover worker hooks, leftover official leftover `wrapProvider`, leftover pack leftover replay, leftover fake leftover `maybeFail`, leftover orchestration, or leftover OAuth wrap here so “one inject file owns the company.” If it later splits: `injectTheNextGoogle503IfAnyRemain.ts` / `wrapOnlyCreateSpreadsheetWriteRawAndWriteMarkers.ts` only as later story files, never CRUD.

`wrapReportingAdaptersWithTransientFailures` / `remainingTransientFailures` are the wrap and a leftover subtract — executor mechanics. The owner question is: *Wrap the live Drive and Sheets adapters so the next N create-spreadsheet, write-raw, or write-markers calls throw a Google 503 — never trash, never list, never promote — so official retry can prove itself. Share one remaining count across those three verbs. Do not throw a canned `PROVIDER_UNAVAILABLE`. Do not wrap the official adapter from the inside — throw before the official verb so leftover `wrapProvider` never sees it. Today nobody asks this wrap. Orchestration asks the worker-hooks inject instead. The leftover remaining-count export is not this wrap’s remaining. Do not start the worker from this file. Do not trash a folder. Do not hit HTTP. Do not sync the Master Sheet.*

Already-recommended leftover orchestration, leftover worker, leftover OAuth wrap, leftover Drive wrap, leftover Sheets wrap, leftover canned failure, leftover pack replay already live in other **modules**. Leftover worker hooks stay a skipped sibling. Leftover mask, leftover later janitor stay sibling **modules**. Do not pull those in.

## What this file actually does

Two operations of one “inject a bounded number of Google 503s on create-spreadsheet, write-raw, and write-markers — never on trash, never on list, never on promote — so official retry can prove itself” story, not “a retry CRUD helper,” and not worker-hooks `PROVIDER_UNAVAILABLE` consume:

1. **Inject the next Google 503 if any remain** — `maybeFail`. `remaining <= 0` returns. Else `remaining -= 1`, throw `Error("Injected transient Google 503")` with `status: 503` and `code: 503`. `failureCount` `Math.max(0, …)` seeds remaining. Wave A `classifyGoogleFailure` would treat `status >= 500` as `retryable_transient`. Official `wrapProvider` never sees this throw.

2. **Wrap only create-spreadsheet, write-raw, and write-markers** — `wrapReportingAdaptersWithTransientFailures`. Spreads `input.drive` / `input.sheets`. Overrides `drive.createSpreadsheet`, `sheets.writeValuesRaw`, `sheets.writeOwnershipAndRunMarkers` to **ask** `maybeFail` then passthrough. `trashFile` / `getFile` / list / create-tab / hide / rename / delete / promote / read / verify / find stay `…input`. Returns `{ drive, sheets }`. **No external caller.**

`remainingTransientFailures` is leftover subtract (`Math.max(0, initial - consumed)`), not a third owner operation. The wrap never **asks** it. The harness test is the only caller.

## Organization

Keep one file. This is the screenplay for “inject a bounded number of Google 503s on create-spreadsheet, write-raw, and write-markers.” Leftover worker hooks, leftover official leftover `wrapProvider`, leftover pack leftover replay, leftover fake leftover `maybeFail`, leftover orchestration already live in deeper **modules**. Do not pull those in. Do not invent a `TransientRetryWrapperService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second leftover inject leftover **adapter** beside leftover worker hooks in this rename — name the leftover orphan; do not silently start leftover orchestration leftover **asking** leftover wrap. Do not invent a second leftover `maybeFail` beside leftover fake leftover `forceTransientFailure`.

Do not split leftover inject / leftover wrap into CRUD files. Leftover inject stays with leftover wrap because leftover three leftover verbs leftover share leftover one leftover remaining leftover closure. Do not move leftover consume leftover hook here so “one inject owns both depths.” Do not start leftover `files.create` or leftover `values.update` from this file. Do not wrap leftover trash so “every leftover Drive leftover verb leftover retries.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `wrapReportingAdaptersWithTransientFailures` | `injectBoundedGoogle503sOnCreateWriteAndMarkers` | intended leftover live wrap; tests should **ask** this, not leftover subtract |
| `remainingTransientFailures` | `subtractHowManyInjectedFailuresWouldRemain` | leftover harness leftover subtract leftover test only |

Keep the old names as one-line aliases until leftover `live/liveGoogleHarness.test.ts` migrates. Do not make leftover orchestration learn leftover `injectBoundedGoogle503sOnCreateWriteAndMarkers` in this rename. Do not make leftover worker leftover consume leftover **ask** leftover this leftover file. Do not persist a new leftover harness leftover marker leftover version in this rename.

**No class for the workflow.** Do **not** turn leftover wrap into a leftover `TransientRetryWrapper` leftover class. The type that *does* earn a name is the leftover bag leftover wrap leftover already leftover returns:

```ts
type WrappedLiveAdaptersThatMayThrowAGoogle503 = {
  drive: ReportingDriveAdapter
  sheets: ReportingSheetsAdapter
}
```

That is the handoff from “we wrapped these leftover adapters” to “leftover worker leftover may leftover **ask** leftover `createSpreadsheet` / leftover `writeValuesRaw` / leftover `writeOwnershipAndRunMarkers`.” Do **not** put leftover remaining leftover count on this leftover type — leftover remaining leftover is a leftover closure. Do **not** put leftover `PROVIDER_UNAVAILABLE` leftover on leftover this leftover type. Do **not** put leftover `refresh_token` leftover on leftover this leftover type. Do **not** put leftover `vantage_live_test` leftover on leftover this leftover type. Do **not** put leftover Google leftover range leftover strings leftover on leftover this leftover type. Do **not** move leftover `ReportingDriveAdapter` / leftover `ReportingSheetsAdapter` leftover into leftover a leftover new leftover `types/` leftover folder.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// transientRetryWrapper.ts
// Wrap the live Drive and Sheets adapters so the next N
// create-spreadsheet, write-raw, or write-markers calls
// throw a Google 503 — never trash, never list, never promote —
// so official retry can prove itself.
// Share one remaining count across those three verbs.
// Do not throw a canned PROVIDER_UNAVAILABLE.
// Do not wrap the official adapter from the inside —
// throw before the official verb so wrapProvider never sees it.
// Today nobody asks this wrap.
// Orchestration asks the worker-hooks inject instead.
// The leftover remaining-count export is not this wrap's remaining.
// Do not start the worker from this file.
// Do not trash a folder.
// Do not hit HTTP.

// ── 1. Inject the next Google 503 if any remain ───────────

function injectTheNextGoogle503IfAnyRemain()
  // remaining <= 0 → return
  // remaining -= 1
  // throw Error("Injected transient Google 503") { status: 503, code: 503 }

// ── 2. Wrap only create-spreadsheet, write-raw, and write-markers ─

export async function injectBoundedGoogle503sOnCreateWriteAndMarkers(input)
  // remaining = max(0, failureCount)
  // drive = { ...input.drive, createSpreadsheet: inject then passthrough }
  // sheets = {
  //   ...input.sheets,
  //   writeValuesRaw: inject then passthrough,
  //   writeOwnershipAndRunMarkers: inject then passthrough,
  // }
  // trashFile / getFile / list / create-tab / hide / rename /
  // delete / promote / read / verify / find stay passthrough

export const wrapReportingAdaptersWithTransientFailures =
  injectBoundedGoogle503sOnCreateWriteAndMarkers

// leftover subtract — not the wrap's remaining
export function subtractHowManyInjectedFailuresWouldRemain(initial, consumed)
export const remainingTransientFailures =
  subtractHowManyInjectedFailuresWouldRemain
```

Read the wrap path out loud: *Seed remaining from the failure count. The next create-spreadsheet, write-raw, or write-markers call throws a Google 503 and burns one. Trash, list, promote, and verify never throw. Official wrapProvider never sees the throw. Today nobody asks this wrap. Orchestration asks the worker-hooks inject instead. The leftover remaining-count export is not this wrap’s remaining.*

That is the operation. `wrapReportingAdaptersWithTransientFailures` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Nobody asks the wrap.** `wrapReportingAdaptersWithTransientFailures` has **no `src/` caller**. Orchestration snapshot inject **asks** `configureLiveTestTransientWriteFailures`. The worker **asks** `consumeLiveTestTransientWriteFailure` and throws canned `PROVIDER_UNAVAILABLE` **before** the pack write. Name the orphan. Do **not** silently start orchestration **asking** this wrap in this rename.

2. **`remainingTransientFailures` is not the wrap’s remaining.** The wrap remaining is a closure `maybeFail` mutates. The export subtracts `initial - consumed` and the wrap never **asks** it. The harness test only proves that subtract. Do **not** silently delete the export in this rename unless wrap tests migrate onto the wrap.

3. **Throw happens before the official verb.** `maybeFail` then `return input.sheets.writeValuesRaw`. Official `wrapProvider` lives **inside** the official verb catch. Pack catch would still **ask** `sanitizeReportingProviderFailure` on the raw `{ status: 503 }` → `retryable_transient`. Name the outside-wrap / inside-`wrapProvider` **seam**. Do **not** silently move inject inside the official adapters so “one wrap owns Google.”

4. **One remaining count across three verbs.** Snapshot create typically **asks** `createSpreadsheet` first. `failureCount: 1` would burn on create and never hit `writeValuesRaw`. Name first-verb-wins. Do **not** silently split remaining per verb so “each verb retries once.”

5. **Never wraps trash / list / promote / verify.** Fake `maybeFail` wraps every verb including trash and `getFile`. The Drive rec already named this gap. Do **not** silently start wrapping `trashFile` so “every Drive verb retries.”

6. **Two inject depths.** Worker hooks throw canned `PROVIDER_UNAVAILABLE` at `writeBoundedReportingBatch` before the engine write. This wrap would throw at the adapter. Hooks already skipped as inject counter. Do **not** merge them in this rename.

7. **Fake message differs.** Fake throws `Simulated Google 503` with `status` only. This file sets `status` **and** `code` 503. Do **not** silently unify those strings so “one 503 owns both stories.”

8. **Verify is not wrapped.** If someone **asked** the wrap with `failureCount: 2` on the write path: first `writeValuesRaw` throws, pack catch **asks** `verifyRange` (passthrough) then replay `writeValuesRaw` (would throw again if remaining still `> 0`). Name the verify-not-wrapped / replay-consumes-again gap. Do **not** silently wrap `verifyRange`.

9. **Leave sibling modules alone.** Worker hooks stay `liveTestWorkerHooks.ts`. Official Drive / Sheets wrap stay `reportingDriveAdapter.ts` / `reportingSheetsAdapter.ts`. Canned failure stays `providerFailures.ts`. Pack replay stays `deliveryEngine.ts`. Fake stays `fakeReportingGoogle.ts`. Orchestration stays `liveGoogleOrchestration.ts`. Do not open unvisited `live/piiSafeEvidence.ts` this pass.

## Testing

The **interface** is the test surface: `injectBoundedGoogle503sOnCreateWriteAndMarkers` (today `wrapReportingAdaptersWithTransientFailures`).

Today `live/liveGoogleHarness.test.ts` only **asks** `remainingTransientFailures(2, 1)` / `(2, 2)`. That is subtract, not the wrap. That is not enough for a story that chooses which Google verbs fail.

Replace the subtract style with tests that name the operation. Use `TEST_MODE`. Do not boot live Google.

**Inject**
- `failureCount: 1`: first `createSpreadsheet` throws `Injected transient Google 503` with `status: 503` and `code: 503`. Second `createSpreadsheet` passthrough succeeds.
- `failureCount: 0` or negative: never throw.
- `sanitizeReportingProviderFailure` on the thrown error is `retryable_transient`.

**Shared remaining**
- `failureCount: 2`: first `writeValuesRaw` throws, first `writeOwnershipAndRunMarkers` throws, next write passthrough succeeds.
- `failureCount: 1` then `createSpreadsheet` burns remaining so later `writeValuesRaw` does not throw. Name first-verb-wins.

**Never those verbs**
- `trashFile` / `getFile` / `listSheets` / `promoteStagingTab` / `verifyRange` never throw even when remaining `> 0`.

**Orphan**
- Name that no `src/` caller **asks** the wrap. Do **not** silently start orchestration **asking** the wrap from a unit test that boots live Google.

Do **not** add a test per `maybeFail` helper. Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** boot official janitor, worker write, queue publish, Analytics, or Sheet Sync inside these tests. Fake Google stays `fakeReportingGoogle` / delivery tests. Live Google stays `pnpm reporting:live-google-harness`. Worker hooks stay `liveTestSecurity.test.ts`.

## What I would not do

- I would not implement this pass.
- I would not rewrite recommendations/form-lead.md.
- I would not edit src/, tests, routes, models, or docs/knowledge/.
- I would not invent a CONTEXT.md term or an ADR. CONTEXT.md does not define Reporting or Reporting Sheets.
- I would not open Wave B (`src/routes/reporting.routes.ts`, `src/config/domain/reportingLiveTest.ts`, `scripts/reporting/run-live-google-harness.ts`).
- I would not write a whole-folder Reporting recommendation.
- I would not introduce a `TransientRetryWrapperService` class or a `wrap.ts` / `remaining.ts` / `create.ts` / `update.ts` / `delete.ts` split.
- I would not silently start leftover orchestration leftover **asking** leftover wrap.
- I would not silently merge leftover this leftover wrap leftover into leftover leftover worker leftover hooks.
- I would not silently wrap leftover `trashFile` leftover / leftover `verifyRange` leftover / leftover leftover every leftover leftover Drive leftover leftover verb.
- I would not silently move leftover inject leftover inside leftover leftover official leftover `wrapProvider`.
- I would not silently delete leftover `remainingTransientFailures` leftover until leftover wrap leftover tests leftover exist.
- I would not silently unify leftover `Injected transient Google 503` leftover with leftover leftover fake leftover `Simulated Google 503`.
- I would not silently start leftover the leftover worker leftover from leftover this leftover file.
- I would not open leftover `live/piiSafeEvidence.ts` leftover while leftover this leftover checklist leftover still leftover has leftover unchecked leftover modules leftover after leftover this leftover row.
- I would not silently reorder ADR-known side effects.
