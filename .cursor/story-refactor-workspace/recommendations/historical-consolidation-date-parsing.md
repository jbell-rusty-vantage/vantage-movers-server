# Read This Historical Eastern Wall Clock As A UTC Instant — Strip A Weekday Prefix, Accept Slash Or ISO, Correct 7/20/0205 Only When The Book Date Option Is On, Refuse The Spring-Forward Gap, Then Prefer Eastern Standard On The Fall-Back Hour — Never Store Florida Calendar Midnight, Never Classify The April 30 Cohort, Never Ask Live parseFloridaCalendarDate — operational story

- Status: recommended
- Service: `historicalConsolidation` (Wave A, in-progress)
- Pass: 12 of this service — `dateParsing.ts`
- Remaining in this service: `stableJson.ts`, `mongoValues.ts`
- Target: `src/services/historicalConsolidation/dateParsing.ts`
- Knowledge: none for this folder. The staged-merge spec is [`historical-consolidation-rules-and-staging-spec.md`](../../../docs/index.md) (Form Lead duplicate cutoff is `2026-04-30 00:00 America/New_York`; ParsedCandidate wants “parsed date/time with timezone and correction evidence”; rehearsal: “The 0205 Book Date correction is present as 2025-07-20 with source evidence”). Hardening plan: [`historical-consolidation-final-hardening-and-pre-run-implementation-plan.md`](../../../docs/index.md) (calendar dates and business timestamps use explicit America/New_York rules, strict accepted formats, DST fixtures, and deterministic malformed-year correction; `7/20/0205` must resolve to 2025-07-20 and appear in every applicable manifest). Inventory: [`historical-database-consolidation-plan.md`](../../../docs/index.md) (Booked Deals row 2782 raw Book Date `7/20/0205`, submission `7/20/2025 16:23:32` — normalize Book Date to 2025-07-20 and record the correction). Already-recommended siblings: [historical-consolidation-classification.md](historical-consolidation-classification.md) (hardcoded `FORM_DUPLICATE_CUTOFF = 2026-04-30T04:00:00.000Z` — **does not ask** this file), [historical-consolidation-planner.md](historical-consolidation-planner.md) (**asks** `parseEasternDate` for Form Time Stamp / Move Date, Call Date+Time, Booked Timestamp / Book Date with `allow_known_0205_correction`, Refund Request Date / Timestamp; `missing_known_0205_correction` fires when the Book Date **text** still contains `0205` without `corrected_7_20_0205_to_2025_07_20`), [historical-consolidation-manifest.md](historical-consolidation-manifest.md), [historical-consolidation-apply.md](historical-consolidation-apply.md), [historical-consolidation-verify.md](historical-consolidation-verify.md), [historical-consolidation-rollback.md](historical-consolidation-rollback.md), [historical-consolidation-migration-context.md](historical-consolidation-migration-context.md), [historical-consolidation-target-guard.md](historical-consolidation-target-guard.md), [historical-consolidation-operational-lock.md](historical-consolidation-operational-lock.md), [historical-consolidation-schema-validation.md](historical-consolidation-schema-validation.md), [historical-consolidation-normalization.md](historical-consolidation-normalization.md) (owns `ParseResult`; this file **asks** the type only). Distinct from `stableJson.ts` / `mongoValues.ts` (hash / `$oid`). Distinct from live `src/utils/easternTime.ts` `parseFloridaCalendarDate` (UTC midnight of the owner calendar day; **throws**; no DST wall clock, no 0205) and `easternWallClockToUtc` (same EST/EDT candidate loop Lead Messaging quiet hours **asks** — this file **copies** it and does **not** import it). Distinct from already-recommended [reporting-timezone.md](reporting-timezone.md) `localBoundaryToUtc` (throws `Nonexistent` on the spring gap **and** `Ambiguous` on the fall-back hour unless earlier/later is passed). Distinct from already-recommended [best-relocation-sheet-ingest-parsing.md](best-relocation-sheet-ingest-parsing.md) `parseDate` / `parseNewYorkWallClock` / `dateFromGoogleSerial` (weekday strip + loose `new Date` fallback; serial is a UTC instant, **not** Eastern wall-clock parts; no 0205; returns `Date | undefined`). Distinct from `ingest-historical-sheets.ts` (the write-capable row-by-row upsert the spec forbids becoming the planner *or* this clock). `package.json` still names `pnpm historical:plan`; the staged-merge script folder is **absent** from this checkout. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — do not invent “Historical Eastern Date” copies. `docs/adr/` is absent here — do not invent ADR copies. Do not add a Historical Consolidation Service in this rename.
- Callers: **already-recommended planner, the barrel, and this folder fixture.** `planner.ts` imports `parseEasternDate` from this file (not the barrel). `googleSerialToEastern` has **no planner or script caller**. Barrel `historicalConsolidation/index.ts` re-exports both functions. Folder `normalization.test.ts` **asks** `parseEasternDate` / `googleSerialToEastern` in the same file as `normalizeExact` — those two date exports **are** this **interface**, not `normalization.ts`. Folder `planner.test.ts` does **not** import this file — it **asks** `planHistoricalConsolidation`, which **asks** `parseEasternDate` as a sibling **ask**. Already-recommended sealer / apply / verify / rollback / classifier / schema parity / fold do **not** import this file. Scripts in this checkout do **not** import this file. Not this **interface**: `planHistoricalConsolidation`, `classifyHistoricalLeads`, `FORM_DUPLICATE_CUTOFF`, `parseFloridaCalendarDate`, `easternWallClockToUtc` in `src/utils/easternTime.ts`, `localBoundaryToUtc`, `parseDate` / `dateFromGoogleSerial` in Best Relocation, `normalizeExact`, `ingest-historical-sheets.ts`.
- Seams callers need: `ParseResult` empty / invalid / accepted vs throw; Book Date `allow_known_0205_correction` vs every other cell (off); slash / ISO text vs Google serial number; spring-forward refuse vs fall-back prefer-EST; this UTC ISO instant vs live Florida calendar midnight; this copy of `easternWallClockToUtc` vs live `src/utils/easternTime.ts`. There is no begin / complete Domain Command **seam**. There is no live Form / Booking **adapter**. There is no classifier **adapter**. There is no Sheet Sync **adapter**. There is no HTTP **adapter**. There is no Google Sheets **adapter**.
- Split later (only if the file outgrows one sitting): this ~59-line file is one sitting if you read it as read this Eastern wall clock, then the Google serial the same way. If it later splits by **story**: do not. One text clock plus one serial clock. Never `create.ts` / `update.ts` / `delete.ts` / `parse.ts` / `date.ts`. Planner, classifier cutoff, name/money fold, live Florida calendar, live quiet-hours clock, reporting window, and Best Relocation parse stay siblings / other services.

`parseEasternDate` / `googleSerialToEastern` are executor mechanics. The owner question is: *The planner already has a sheet date cell. Strip a weekday prefix. Read slash or ISO text as America/New_York wall clock. Correct `7/20/0205` to `2025-07-20` only when the Book Date option is on. Refuse a blank, an unknown shape, a year outside 2000–2100, or a clock that does not exist on the spring gap. On the fall-back hour prefer Eastern Standard (−5). Give back a UTC ISO instant, or say empty / invalid with a reason code. A Google serial is the same story after you treat its UTC Y/M/D H:M:S as Eastern wall-clock parts. This file does not store Florida calendar midnight. This file does not classify the April 30 cohort. This file does not **ask** live `parseFloridaCalendarDate`.*

Who walks the sheets, who classifies Duplicate Lead, who folds Agent / money, and who owns live Eastern midnight already live in **modules**. Do not pull those in.

## What this file actually does

Two “read this Eastern wall clock as a UTC instant” stories in one sitting, not “a date helper,” and not Plan This Historical Merge / Classify This Historical Lead Batch / Store The Owner Calendar Day At UTC Midnight / Window This Best Relocation Row:

1. **Read this Eastern wall-clock cell as a UTC ISO instant, or say empty / invalid** — `parseEasternDate(rawValue, options?)`. `String(rawValue ?? "")`, NFKC, trim, strip a leading `Sun`–`Sat` plus space. Blank → `{ disposition: "empty", reason_codes: ["missing_date"] }`. Match `DATE_TIME` (`M/D/YYYY` or `M-D-YYYY`, then space / comma / `T`, then `H:MM[:SS]` plus optional AM/PM) or `DATE_ONLY`. Else `ISO_DATE_TIME` / `ISO_DATE_ONLY`. No match → `invalid` / `unsupported_date_format`. Year `205` + month `7` + day `20` + `allow_known_0205_correction` → year `2025` and `corrected_7_20_0205_to_2025_07_20`. AM 12 → 0; PM hour < 12 → +12. Date-only defaults to midnight. `validCalendar` refuses year outside 2000–2100, a clock outside 0–23 / 0–59, or a day that `Date.UTC` cannot keep (`invalid_calendar_date`). Then the local `easternWallClockToUtc` tries EST (−5) then EDT (−4) and **asks** `Intl` `America/New_York` `formatToParts`. No match → `nonexistent_or_ambiguous_eastern_time`. Accepted returns `instant.toISOString()`. Today’s fixture proves `"2025-08-20 19:55:56"` → `"2025-08-20T23:55:56.000Z"` (EDT); `"3/8/2026 2:30 AM"` invalid (spring gap); `"11/1/2026 1:30 AM"` → `"2026-11-01T06:30:00.000Z"` (EST first); `"7/20/0205"` with the option → `"2025-07-20T04:00:00.000Z"` plus the reason code; without the option invalid. Already-recommended planner **asks** this beat for Form Time Stamp / Move Date (option off), Call Date + Time concatenated (option off), Booked Timestamp (option off) and Book Date (option on), Refund Request Date / Timestamp (option off). A miss quarantines the row. This beat does not throw. This beat does not **ask** `classifyHistoricalLeads`. This beat does not store UTC midnight of the calendar day.

2. **Read this Google Sheets serial as Eastern wall-clock parts, then the same UTC instant** — `googleSerialToEastern(serial)`. Non-finite number → `invalid` / `invalid_google_date_serial`. `Math.round(serial * 86_400_000)` plus `Date.UTC(1899, 11, 30)`. Treat that Date’s UTC Y/M/D H:M:S as Eastern wall clock, then **ask** the same `easternWallClockToUtc`. Miss → the same serial reason code. Today’s fixture **asks** `46_000` and only checks `accepted` — it does not lock the ISO instant. Already-recommended planner does **not** **ask** this beat. The barrel still re-exports it for the missing `pnpm historical:plan` script. This beat does not treat the serial as a UTC instant the way Best Relocation `dateFromGoogleSerial` does. This beat does not correct `0205`.

There is no third plan, classify, or fold operation. `ParseResult` stays on already-recommended `normalization.ts`. The local `easternWallClockToUtc` / `validCalendar` are folds inside these two stories.

## Organization

Keep one file. This is the screenplay for “read this Eastern wall clock as a UTC instant.” Sheet walk / Booking plan already live on already-recommended `planner.ts`. April 30 cohort already lives on already-recommended `classification.ts`. Name / money fold already lives on already-recommended `normalization.ts`. Live Florida calendar midnight already lives on `src/utils/easternTime.ts`. Reporting window already lives on `reporting/timezone.ts`. Best Relocation parse already lives on `bestRelocationSheetIngest/parsing.ts`. Do not pull those in. Do not invent a `HistoricalDateParsingService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a live Eastern **adapter** so “one clock owns the company.” Do not invent an HTTP **adapter** so “a route can parse a date.” Do not invent a CRUD folder so “text / serial each get a file.”

Do not move `parseEasternDate` into `planner.ts` so “the planner owns the clock.” Do not merge this into `parseFloridaCalendarDate` so “one date parse owns live and historical.” Do not merge this into `parseNewYorkWallClock` so “one Best Relocation clock owns every sheet.” Do not split `create.ts` / `update.ts` / `delete.ts` / `parse.ts` / `date.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `parseEasternDate` | `readThisHistoricalEasternWallClockAsAUtcInstantOrSayEmptyOrInvalid` | planner must key Form / Call / Booking / Cancellation timestamps without guessing UTC midnight |
| `googleSerialToEastern` | `readThisGoogleSheetsSerialAsAnEasternWallClockThenTheUtcInstant` | serial cells must use the same Eastern story when a future script **asks** them |

Keep the old names as one-line aliases until already-recommended `planner.ts`, the barrel, and `normalization.test.ts` migrate. Do not make callers learn `DATE_TIME` / `Intl.DateTimeFormat` / `Date.UTC(1899, 11, 30)` as the domain language. Do **not** export `easternWallClockToUtc` or `validCalendar` from here. Do **not** put `parseEasternDate` onto a live Booking route so “HTTP can parse Book Date.” Do **not** rename the `reason_codes` strings (`missing_date`, `unsupported_date_format`, `corrected_7_20_0205_to_2025_07_20`, `invalid_calendar_date`, `nonexistent_or_ambiguous_eastern_time`, `invalid_google_date_serial`). Do **not** rename `disposition` members (`accepted` / `empty` / `invalid`). Do **not** rename `allow_known_0205_correction`. Do **not** move `ParseResult` onto this file in this rename so “dates own money.”

**No workflow class.** The type that *does* earn a name is already `ThisHistoricalParsedCell` on `normalization.ts` — reuse it. Do not add `cohort` or `form_duplicate_cutoff` onto the result so “the clock owns classification.” Do not add `session` or a Booking id onto `parseEasternDate` so “the clock writes Mongo.”

Leave plan on already-recommended `planner.ts`. Leave `FORM_DUPLICATE_CUTOFF` on `classification.ts`. Leave `ParseResult` on `normalization.ts`. Leave `parseFloridaCalendarDate` / live `easternWallClockToUtc` on `src/utils/easternTime.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// dateParsing.ts
// The planner already has a sheet date cell.
// Strip a weekday prefix.
// Read slash or ISO text as America/New_York wall clock.
// Correct 7/20/0205 only when the Book Date option is on.
// Refuse the spring gap.
// Prefer Eastern Standard on the fall-back hour.
// Give back a UTC ISO instant, or say empty / invalid.
// A Google serial is the same story after its UTC parts are treated as Eastern wall clock.
// Do not store Florida calendar midnight.
// Do not classify the April 30 cohort.
// Do not **ask** live `parseFloridaCalendarDate`.

import type { ParseResult as ThisHistoricalParsedCell } from "./normalization"

// ── 1. Read this Eastern wall clock as a UTC instant ──

export function readThisHistoricalEasternWallClockAsAUtcInstantOrSayEmptyOrInvalid(
  rawValue: unknown,
  options?: { allow_known_0205_correction?: boolean },
): ThisHistoricalParsedCell<string>
function stripThisWeekdayPrefixFromTheHistoricalDateCell(raw: string)
function matchThisHistoricalSlashOrIsoDateText(raw: string)
function correctThisKnown0205BookDateOnlyWhenTheOptionIsOn(year, month, day, options, reasons)
function applyThisHistoricalMeridiemToTheHour(hour, meridiem)
function refuseThisHistoricalCalendarWhenYearClockOrDayIsImpossible(year, month, day, hour, minute, second)
function resolveThisHistoricalEasternWallClockToUtcOrRefuseTheGap(year, month, day, hour, minute, second)

// ── 2. Read this Google serial as Eastern wall clock then UTC ──

export function readThisGoogleSheetsSerialAsAnEasternWallClockThenTheUtcInstant(
  serial: unknown,
): ThisHistoricalParsedCell<string>
function refuseThisHistoricalGoogleSerialWhenItIsNotAFiniteNumber(serial)
function readTheseUtcPartsFromTheLotusEpochSerialAsIfTheyWereEasternWallClock(serial)
```

Read the primary path out loud: *Strip a weekday prefix from the cell. Read slash or ISO text as America/New_York wall clock — midnight when there is no time, AM/PM when the slash form carries it. Correct `7/20/0205` to `2025-07-20` only when the Book Date option is on; every other cell keeps year `205` and fails the calendar bound. Refuse a blank, an unknown shape, a year outside 2000–2100, or `2:30 AM` on the spring gap. On `11/1/2026 1:30 AM` prefer Eastern Standard and return `2026-11-01T06:30:00.000Z`. Give back a UTC ISO instant or say empty / invalid with a reason code. A Google serial uses the same Eastern story after you treat its UTC parts as wall clock. Do not store Florida calendar midnight. Do not classify the April 30 cohort. Do not **ask** live `parseFloridaCalendarDate`.*

That is the operation. `parseEasternDate` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This file copies live `easternWallClockToUtc` and does not import it.** `src/utils/easternTime.ts` already tries −5 then −4 and **asks** `America/New_York`. Lead Messaging quiet hours **asks** the live helper. Do not replace this copy in this rename so “one clock owns the company.” Do not export the local helper so “quiet hours can import historical.”

2. **Fall-back is accepted EST; reporting throws `Ambiguous`.** `11/1/2026 1:30 AM` here → `2026-11-01T06:30:00.000Z`. `localBoundaryToUtc` refuses the same wall clock unless you pass `earlier` / `later`. Do not flip this file to a throw so “the reporting sentence becomes true.” The fixture already locks EST.

3. **`0205` correction is Book Date only at the planner.** This file corrects any cell when the option is on and the triple is `7/20/205`. Already-recommended planner passes the option only on Book Date, then separately conflicts `missing_known_0205_correction` when the raw text still contains `0205` without the reason code. Do not hardcode `Book Date` onto this file so “the clock owns the column.” Do not correct `7/21/0205` or `7/20/205` (three-digit year is `unsupported_date_format`).

4. **`googleSerialToEastern` has no planner ask.** Best Relocation treats a serial as a UTC instant (`dateFromGoogleSerial`). This file rereads those UTC parts as Eastern wall clock — a different story, not a bug to fix here. Do not route this export through `dateFromGoogleSerial` so “one serial owns every sheet.” Do not delete the export in this rename because planner is quiet — leave that for a later **interface** proof of the ISO instant.

5. **Year `205` without the option is `invalid_calendar_date`, not `unsupported_date_format`.** The slash form matched. Do not collapse those reason codes so “one invalid owns every miss.” Already-recommended planner concatenates all reason codes onto the conflict.

6. **`normalization.test.ts` hosts this interface.** Do not keep proving DST as `normalizeExact`. Do not move those tests in this rename — leave them until a later sitting splits the fixture file.

7. **Do not ask `FORM_DUPLICATE_CUTOFF` from here.** Already-recommended classification hardcodes `2026-04-30T04:00:00.000Z`. That is midnight Eastern on cutoff day — prove it on classification, not by parsing `"4/30/2026"` from this file in this rename.

8. **Leave sibling modules and live writes alone.** `planHistoricalConsolidation`, `classifyHistoricalLeads`, `parseFloridaCalendarDate`, `localBoundaryToUtc`, `parseNewYorkWallClock`, and `ingest-historical-sheets.ts` are not this file. Do not inline them so “the clock is one sitting.”

## Testing

The **interface** is the test surface: `readThisHistoricalEasternWallClockAsAUtcInstantOrSayEmptyOrInvalid`, `readThisGoogleSheetsSerialAsAnEasternWallClockThenTheUtcInstant` (today `parseEasternDate`, `googleSerialToEastern`).

`normalization.test.ts` today proves ISO EDT, the spring gap, fall-back EST, 0205 on/off, and serial `accepted`. Keep those as this **interface**. `normalizeExact` / `parseAgentNames` / `parseMoneyToCents` / `allocateCents` are **not** this **interface**. `planner.test.ts` through `planHistoricalConsolidation` is **not** this **interface**.

Add only what this **interface** still hides. Do **not** point `planHistoricalConsolidation` at live `vantagemovers` from this fixture.

**Read this Eastern wall clock as a UTC instant**
- `"2025-08-20 19:55:56"` → `"2025-08-20T23:55:56.000Z"` (today).
- `"3/8/2026 2:30 AM"` → `invalid` / `nonexistent_or_ambiguous_eastern_time` (today).
- `"11/1/2026 1:30 AM"` → `"2026-11-01T06:30:00.000Z"` (today EST).
- `"7/20/0205"` with `allow_known_0205_correction` → `"2025-07-20T04:00:00.000Z"` plus `corrected_7_20_0205_to_2025_07_20` (today).
- `"7/20/0205"` without the option → `invalid` / `invalid_calendar_date` (today disposition only — lock the reason code).
- blank → `empty` / `missing_date`.
- `"Wed 7/20/2025"` strips the weekday and accepts midnight EDT (`2025-07-20T04:00:00.000Z`).
- `"7/21/0205"` with the option on stays invalid (`invalid_calendar_date`).
- `"not a date"` → `unsupported_date_format`.
- Do **not** require `parseFloridaCalendarDate` as this beat.
- Do **not** require `classifyHistoricalLeads` as this beat.

**Read this Google serial as Eastern wall clock then UTC**
- `46_000` accepted (today disposition only — lock the ISO instant on this **interface**).
- `Number.POSITIVE_INFINITY` → `invalid` / `invalid_google_date_serial`.
- Do **not** require `dateFromGoogleSerial` as this beat.
- Do **not** require `planHistoricalConsolidation` as this beat.

Do **not** add a test per helper (`stripThisWeekdayPrefixFromTheHistoricalDateCell`, `resolveThisHistoricalEasternWallClockToUtcOrRefuseTheGap`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

The two function names may stay exported as aliases. They are the test surface. Do **not** export a cutoff so “the fixture owns classification.”

## What I would not do

- A `HistoricalDateParsingService` class with `parse` / `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `Date.UTC` / `Intl.DateTimeFormat`.
- Moving this into a CRUD folder, or a `parse/` folder that also swallows `planner.ts`, `normalization.ts`, `easternTime.ts`, and Best Relocation `parsing.ts`.
- Splitting `create.ts` / `update.ts` / `delete.ts` / `parse.ts` / `date.ts`.
- Treating `planHistoricalConsolidation`, `classifyHistoricalLeads`, `parseFloridaCalendarDate`, `localBoundaryToUtc`, `parseNewYorkWallClock`, `dateFromGoogleSerial`, or `ingest-historical-sheets.ts` as this story.
- Inventing a Domain Command **seam** that has only this clock as an **adapter**.
- Inventing a live Eastern **adapter** so “one clock owns the company.”
- Inventing an HTTP **adapter** so “a route can parse a date.”
- Asking `FORM_DUPLICATE_CUTOFF` from here so “the clock owns the April 30 cohort.”
- Flipping fall-back to a throw so “the reporting sentence becomes true.”
- Routing `googleSerialToEastern` through `dateFromGoogleSerial` so “one serial owns every sheet.”
- Moving `ParseResult` onto this file in this rename so “dates own money.”
- Opening `stableJson.ts` in this pass, or writing a whole-folder recommendation for `historicalConsolidation`.
