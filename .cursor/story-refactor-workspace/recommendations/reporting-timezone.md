# Count This Window The Same Way Every Time — operational story

- Status: recommended
- Service: `reporting` (Wave A, in-progress)
- Pass: 2 of this service — `timezone.ts`
- Remaining in this service: `destinationContract.ts`, `destinationLineage.ts`, `destinationIdentity.ts`, `reportingDestination.service.ts`, `reportingDestinationRepository.ts`, `reportingDestinationPort.adapter.ts`, `query/canonicalReporting.ts`, `query/pagination.ts`, `reportingWorker.ts`, `deliveryEngine.ts`, `executionStream.ts`, `queue.ts`, `reportingRunRepository.ts`, `reportingDeliveryRepository.ts`, `reportingManifestRepository.ts`, `manifestPageAdapter.ts`, `promotion.ts`, `promotionReservation.ts`, `snapshotAdapter.ts`, `reportingObservability.ts`, `cleanup.ts`, `ownershipMarker.ts`, `registryFilters.ts`, leftover `google/*` adapters, leftover `live/*` harness
- Target: `src/services/reporting/timezone.ts`
- Knowledge: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (primary code is leftover `reporting.service.ts`. Role: Owner-designed, checksum-bound reports. Datasets section: windows are half-open `[from,to)`; max window 366 days. Knowledge names `America/New_York`; this file is IANA-generic — do not hardcode Eastern so “the Service sentence wins”). Distinct from already-recommended leftover preview / freeze / estimate / confirm: [`reporting-reporting.md`](reporting-reporting.md) (**asks** `resolveReportingDateWindow` only on leftover `revisionToQueryInput`; Wave B draft validate **asks** it first). Distinct from leftover query: sibling `query/canonicalReporting.ts` (**asks** `displayInstant` for row clocks and `halfOpenDatePredicate` for Mongo `$gte` / `$lt`; it owns which field is the clock). Distinct from leftover Wave B `src/validation/reporting.validation.ts` (Zod `reportingDateWindowSchema` + `REPORTING_MAX_WINDOW_DAYS` span after this file returns). Distinct from leftover catalog: sibling `catalog/index.ts` (`reportingError` only). Distinct from leftover `src/utils/easternTime.ts` (Florida calendar persist for Lead / Booking / Cancellation dates — not this report window). Distinct from already-recommended leftover Observability morning letter: [`observability-notification-digest.md`](observability-notification-digest.md) and leftover `adminObservability.service.ts` `startOfDayInTimeZone`. Distinct from already-recommended leftover Analytics UTC `$dateToString`: [`analytics-revenue-trend.md`](analytics-revenue-trend.md). Distinct from leftover CPL `CPL_BUSINESS_TIME_ZONE`. This is not Admin Analytics and not Sheet Sync. This checkout’s `CONTEXT.md` does not define Reporting / Reporting Sheets — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Do not add a Reporting Service file in this rename.
- Callers: Wave B `src/validation/reporting.validation.ts` (`validateReportingDraft` → `resolveReportingDateWindow` then max-days span). Already-recommended leftover `reporting.service.ts` (`revisionToQueryInput` re-resolves at estimate / confirm with `new Date()`). Leftover `query/canonicalReporting.ts` (`displayInstant`, `halfOpenDatePredicate`). Tests: `reporting.test.ts` proves New York spring-forward 23-hour day, fall-back 25-hour day, nonexistent `02:30`, ambiguous `01:30` needs earlier/later, rolling last-2-days is DST-aware and fresh. **Does not call** `assertIanaTimezone` / `displayInstant` / `halfOpenDatePredicate` as named operations. Leftover delivery / live harness fixtures hard-code a resolved window; they do not **ask** this file.
- Seams callers need: resolve-this-window (`resolveReportingDateWindow`) vs convert-this-local-boundary (`localBoundaryToUtc`) vs paint-this-instant (`displayInstant`) vs mongo-half-open (`halfOpenDatePredicate`). The explicit / rolling **seam** exists because the owner stores a spec, not a frozen pair of instants, and leftover estimate re-resolves. The through-local / exclusive-end **seam** exists because Zod and this file both require exactly one end. There is no begin / complete Domain Command **seam**. There is no Google write **seam**. There is no query-page **seam**. There is no Analytics **seam**. There is no Sheet Sync **seam**.
- Split later (only if the file outgrows one sitting): this ~190-line file is one sitting if you read it as count this window the same way every time. Do **not** split into `resolve.ts` / `display.ts` / `predicate.ts`. Do **not** split into `create.ts` / `update.ts` / `delete.ts`. Do **not** pull leftover query / leftover draft Zod / leftover `easternTime.ts` here so “one clock owns the company.” If it later splits: `resolveThisReportsDateWindow.ts` / `convertThisLocalBoundaryToUtc.ts` only as later story files, never CRUD.

`resolveReportingDateWindow` / `resolveLocalWindow` / `localBoundaryToUtc` are executor mechanics. The owner question is: *I asked for these local days in this IANA zone, including today if it is rolling. Count from the start of the first local morning through the start of the morning after the last included day. March 8 in New York is 23 hours. November 1 is 25 hours. 2:30 AM on a spring-forward day never existed — refuse it. 1:30 AM on a fall-back day happened twice — make me say earlier or later. Last N days starts from whatever local morning it is when I preview or run. Do not give leftover query a closed interval. Do not count Analytics UTC days. Do not store Florida calendar midnights.*

Leftover preview / freeze, leftover query pages, leftover draft Zod, leftover Florida persist, leftover Observability letter, leftover Analytics buckets already live in other **modules**. Do not pull those in.

## What this file actually does

Four operations of one “count this window the same way every time” story, not “a timezone helper,” and not leftover query or leftover preview:

1. **Resolve this report’s date window** — `resolveReportingDateWindow`. Explicit spec → leftover `resolveLocalWindow` with the draft timezone. Rolling `last_n_days` only: `anchor` must be `preview_or_run_time`, `endPolicy` must be `include_current_local_day`, `days` a safe integer 1–366, `now` a real instant. Paint `now` in the zone, take the local calendar date, walk back `days - 1` local midnights, and resolve `[that morning, tomorrow after today]` as an inclusive through-local range. Unknown preset / anchor / policy → `invalid_date_window`. This is the **interface** Wave B draft validate and leftover `revisionToQueryInput` share.

2. **Convert this local boundary to UTC** — `resolveLocalWindow` + `localBoundaryToUtc`. Require a real IANA zone. Require exactly one end: `throughLocal` (inclusive calendar day → next local midnight) or `toExclusiveLocal`. Date-only `YYYY-MM-DD` becomes `T00:00:00`. Search ±14 hours in 15-minute steps for UTC instants whose zone parts match the wall clock. Zero matches → `invalid_date_window` nonexistent local time. Two or more without `earlier` / `later` → ambiguous. `fromUtc >= toExclusiveUtc` refuses. Return `{ timezone, fromUtc, toExclusiveUtc }` ISO strings.

3. **Display this instant in the report timezone** — `displayInstant`. Same IANA gate. Format `YYYY-MM-DDTHH:mm:ss` with `en-CA` + `hourCycle: "h23"` in that zone. Leftover query uses this for lead / book / cancel / exception clocks and then slices ten characters when it wants a date-only cell.

4. **Give leftover query a half-open Mongo predicate** — `halfOpenDatePredicate`. `{ $gte: fromUtc, $lt: toExclusiveUtc }`. Leftover query decides whether that predicate sits on `timestamp` or an observation clock. This file does not load Leads.

`assertIanaTimezone` / `addLocalDays` / `parseLocal` / `partsInZone` are beats, not extra owner operations. `assertIanaTimezone` accepts `UTC` or a string that contains `/` after `Intl` accepts it; `EST` and empty fail. Do not export `normalizeBoundary` / `parseDateOnly` / `sameParts`.

## Organization

Keep one file. This is the screenplay for “count this window the same way every time.” Draft Zod, max-days span, leftover query field choice, leftover preview persist, and Florida calendar persist already live in deeper **modules**. Do not pull those in. Do not invent a `ReportingTimezoneService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second clock **adapter** beside this file’s Intl walk. Do not invent a second Mongo predicate **adapter** beside `halfOpenDatePredicate`.

Do not split resolve / display / predicate into CRUD files. Rolling and explicit stay together because they share one exclusive-end contract. Do not move `REPORTING_MAX_WINDOW_DAYS` into this file so “the clock owns the cap.” Do not start reading `REPORTING_GOOGLE_DELIVERY_ENABLED`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `resolveReportingDateWindow` | `resolveThisReportsDateWindow` | Wave B draft validate and leftover estimate / confirm |
| `resolveLocalWindow` | `resolveThisInclusiveLocalDayRange` | explicit through-local vs exclusive end; DST day length |
| `localBoundaryToUtc` | `convertThisLocalBoundaryToUtc` | DST gap / fold |
| `displayInstant` | `displayThisInstantInTheReportTimezone` | leftover query row clocks |
| `halfOpenDatePredicate` | `halfOpenUtcPredicateForThisWindow` | leftover query Mongo `$gte` / `$lt` |
| `assertIanaTimezone` | `requireARealIanaTimezone` | Wave B `timezone` string is not yet IANA |
| `ReportingDateWindowSpec` | `ReportDateWindowSpec` | owner stores explicit vs rolling, not instants |

Keep the old names as one-line aliases until Wave B `reporting.validation.ts`, leftover `reporting.service.ts`, leftover `query/canonicalReporting.ts`, and `reporting.test.ts` migrate. Do not make callers learn `resolveLocalWindow` as the only domain language — rolling owners **ask** `resolveThisReportsDateWindow`.

**No class for the workflow.** The type that *does* earn a name is the resolved half-open window:

```ts
type ResolvedReportingWindow = {
  timezone: string
  fromUtc: string
  toExclusiveUtc: string
}
```

That is the handoff from “the owner named local days” to “leftover query may `$gte` / `$lt`.” Do **not** put sample rows on this type. Do **not** collapse leftover `date_window_spec` into this type — the spec is what leftover estimate re-resolves.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// timezone.ts
// The owner named local days in an IANA zone.
// Count from the first local morning through the morning after the last day.
// Spring-forward is 23 hours. Fall-back is 25.
// A clock that never existed is refused. A clock that happened twice needs earlier or later.
// Last N days includes today, from whatever morning it is when we look.
// Leftover query gets [from, to).

// ── 1. Resolve this report’s date window ──────────────────

export function resolveThisReportsDateWindow(spec, timezone, now)

function refuseAnUnknownRollingSpec(spec, now)          // preset / anchor / policy / days / now
function localCalendarDateOf(now, timezone)             // display, then slice YYYY-MM-DD
function walkBackInclusiveLocalDays(today, days)        // days - 1 midnights

// ── 2. Convert this local boundary to UTC ─────────────────

export function resolveThisInclusiveLocalDayRange(input)
export function convertThisLocalBoundaryToUtc(value, timezone, earlierOrLater)
export function requireARealIanaTimezone(timezone)      // UTC or contains /

function requireExactlyOneEnd(throughLocal, toExclusiveLocal)
function treatADateOnlyAsLocalMidnight(value)
function walkFifteenMinuteOffsetsUntilTheWallClockMatches(expected, timezone)
function refuseAGapOrAnUnnamedFold(matches, earlierOrLater)
function refuseAnEmptyOrInvertedWindow(fromUtc, toExclusiveUtc)

// ── 3. Display this instant in the report timezone ────────

export function displayThisInstantInTheReportTimezone(instant, timezone)

// ── 4. Give leftover query a half-open Mongo predicate ────

export function halfOpenUtcPredicateForThisWindow(window) // $gte / $lt

/** @deprecated Use resolveThisReportsDateWindow */
export const resolveReportingDateWindow = resolveThisReportsDateWindow
/** @deprecated Use resolveThisInclusiveLocalDayRange */
export const resolveLocalWindow = resolveThisInclusiveLocalDayRange
/** @deprecated Use convertThisLocalBoundaryToUtc */
export const localBoundaryToUtc = convertThisLocalBoundaryToUtc
/** @deprecated Use displayThisInstantInTheReportTimezone */
export const displayInstant = displayThisInstantInTheReportTimezone
/** @deprecated Use halfOpenUtcPredicateForThisWindow */
export const halfOpenDatePredicate = halfOpenUtcPredicateForThisWindow
/** @deprecated Use requireARealIanaTimezone */
export const assertIanaTimezone = requireARealIanaTimezone
export type ReportingDateWindowSpec = ReportDateWindowSpec
```

Read the primary path out loud: the owner names an IANA zone and either two local boundaries or last N days including today. We refuse a fake zone, a rolling spec we do not know, and a window with two ends or none. We walk the UTC offsets until the wall clock matches. A spring-forward hole is a refusal. A fall-back fold needs earlier or later. Inclusive through-local becomes the next local midnight. Leftover query receives `[fromUtc, toExclusiveUtc)` and paints each instant back in that same zone. Last N days is counted again when leftover estimate looks — not last night’s frozen pair.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Leftover estimate re-resolves. The frozen `resolved_window` is a cite, not the query clock.** Already-recommended `revisionToQueryInput` **asks** this file with `new Date()`. Wave B draft validate already resolved once for preview. Do not silently swap in `revision.resolved_window` so “checksum means the same rows.” That split is known. See [`reporting-reporting.md`](reporting-reporting.md).

2. **Knowledge says America/New_York. This file is IANA-generic.** Draft `timezone` is any non-empty string; this file is the IANA gate. Tests use New York. Do not hardcode `America/New_York` so “the Service sentence wins.” Do not invent a glossary “Reporting Timezone” term.

3. **`assertIanaTimezone` is not “Intl accepted it.”** After Intl formats, only `UTC` or a string containing `/` pass. `EST` fails even if a runtime would paint it. `Etc/UTC` passes because of the slash. Do not silently accept abbreviations so “Intl is enough.”

4. **Two max-day caps.** This file refuses rolling `days` outside 1–366. Wave B Zod uses leftover `REPORTING_MAX_WINDOW_DAYS` (also 366) and then measures the resolved span. Do not pull the span check here so “the clock owns the cap.” Do not delete this file’s 1–366 so “Zod already did it” — leftover `revisionToQueryInput` does not re-run Zod.

5. **`addLocalDays` is calendar days, not 24-hour slices.** It adds to Y-M-D via `Date.UTC` and returns midnight. Rolling last-2 across March 8 is supposed to be a 23-hour day plus a 24-hour day, not 48 hours. Do not switch to `+ days * 86_400_000`.

6. **The ±14h / 15-minute walk is the DST adapter.** Do not replace it with leftover `easternTime.ts`, Temporal, or date-fns in this rename. Do not invent a second **adapter** that only leftover query would call.

7. **`halfOpenDatePredicate` is a one-liner and still a real seam.** Leftover query **asks** it on `timestamp` and on exception observation clocks. Do not inline `$gte` / `$lt` at each leftover query site so “the helper was too thin.” Do not change `$lt` to `$lte` so “throughLocal feels inclusive” — inclusive is the local day, exclusive is the UTC end.

8. **`displayInstant` vs leftover query `dateOnly`.** Date-only cells live in leftover `query/canonicalReporting.ts` (`slice(0, 10)`). Do not pull `dateOnly` here so “the clock owns painting.”

9. **Wave B Zod already requires exactly one end.** This file checks again. Leftover `revisionToQueryInput` can pass a stored spec that skipped Zod. Keep both. Do not delete this file’s check so “validation owns the shape.”

10. **Leave sibling modules alone.** Leftover `validateReportingDraft`, leftover `previewReportingQuery`, leftover `registryMongoPredicate`, leftover `parseFloridaCalendarDate` are already the right **depth**. This file does not load Leads or write Google.

## Testing

The **interface** is the test surface: `resolveThisReportsDateWindow`, `resolveThisInclusiveLocalDayRange`, `convertThisLocalBoundaryToUtc`, `displayThisInstantInTheReportTimezone`, `halfOpenUtcPredicateForThisWindow`, `requireARealIanaTimezone`.

Today’s `reporting.test.ts` already names the New York DST days and the rolling last-2 freshness. Keep those. Add the missing named operations:

**Resolve this report’s date window**
- Explicit through-local March 8 New York → `fromUtc` `2026-03-08T05:00:00.000Z`, `toExclusiveUtc` `2026-03-09T04:00:00.000Z`, length 23 hours.
- Explicit through-local November 1 New York → length 25 hours.
- Rolling last 2 days at `2026-03-08T16:00:00Z` New York → `[2026-03-07T05:00:00.000Z, 2026-03-09T04:00:00.000Z)`. Same spec at `2026-03-09T16:00:00Z` is a different window (fresh). The spec object is not mutated.
- Rolling refuses `days` 0 / 367, unknown preset / anchor / policy, and a non-finite `now`.
- Explicit refuses two ends, zero ends, and `from >= to`.

**Convert this local boundary to UTC**
- `2026-03-08T02:30:00` New York → `invalid_date_window` nonexistent.
- `2026-03-08T02:30:00` New York with `earlier` still nonexistent (gap, not fold).
- `2026-11-01T01:30:00` New York without disambiguation → ambiguous.
- `earlier` vs `later` on that fold are different instants.

**Display / predicate / IANA**
- `displayInstant` of `2026-03-08T05:00:00.000Z` in New York is `2026-03-08T00:00:00`.
- `halfOpenDatePredicate` is `$gte` / `$lt` on the ISO pair, not `$lte`.
- `America/New_York` and `UTC` pass. `EST`, empty, and a non-IANA token → `invalid_timezone`.

Do **not** add a test per helper (`walkFifteenMinuteOffsetsUntilTheWallClockMatches`, `treatADateOnlyAsLocalMidnight`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** start leftover preview / leftover estimate / leftover query execution inside these tests. Wave B max-days span stays a validation test.

## What I would not do

- A `ReportingTimezoneService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `Intl.DateTimeFormat`.
- Moving the module into `resolve.ts` / `display.ts` / `predicate.ts` or `create.ts` / `update.ts` / `delete.ts`.
- Breaking the half-open **seam** (`$gte` / `$lt`, exclusive UTC end).
- Treating leftover query pages, leftover preview / freeze, leftover Analytics UTC buckets, leftover Observability letter, leftover Florida persist, or leftover CPL business zone as this story.
- Inventing a clock **seam** that has only one **adapter** beside this file’s Intl walk.
- Silently “fixing” estimate re-resolution, knowledge’s America/New_York sentence, or the 366-day cap split while recommending a rename.
- Jumping to `destinationContract.ts`’s leftover destination desk — wait, next pass is that module; do not pull it into this file. Do not jump to `ingestion` (or Wave B) while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `reporting`.
