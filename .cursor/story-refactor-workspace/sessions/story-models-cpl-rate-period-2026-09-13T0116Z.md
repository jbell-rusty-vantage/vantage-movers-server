# Session story-models-cpl-rate-period-2026-09-13T0116Z

- Date (UTC): 2026-09-13T0116Z
- Service / module: `models` / `CplRatePeriod.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 349
- Current service / next module (TRAVERSAL): `models` (in-progress) / `CplRatePeriod.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/models-cpl-rate-period.md` (`src/models/CplRatePeriod.ts`)
- operations named: Hold the live CPL period as the writable price-book row; Index Feed plus start, Feed plus end, and Feed plus archive without uniqueness; Bind the selected Mongo database
- remaining in this service: `CplCorrectionJob.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `CplCorrectionJob.ts`

## Messages posted

- 2026-09-13T0116Z next

## Ideas parked

- none (do not unique-index Feed plus start so leftover archive-then-insert breaks; leftover schedule / leftover M4 already use `{ archived_at: null }` while leftover health uses `$exists: false`. Do not flip `amount_cents` to dollars so “the period matches the slot.” Do not delete `getCplRatePeriodModel` so “period matches fourteen-slot.”)

## Contradictions

- Leftover schedule / leftover M4 ask `{ archived_at: null }`; leftover health / leftover projection / leftover activate / leftover Paid Overflow ask `{ archived_at: { $exists: false } }`
- Three leftover lookup compounds are not unique; leftover archive-then-insert may share `effective_from`
- `amount_cents` is integer cents; leftover fourteen-slot `cpl` is dollars; leftover M4 `dollarsToCents` later
- Period `schedule_revision` is a snapshot `min: 1`; leftover Feed `schedule_revision` is the CAS default `0`
- Leftover schedule / leftover health / leftover M4 ask `getCplRatePeriodModel`; leftover `schema.indexes()` asks default `CplRatePeriod`
- Leftover overview does not count this collection; leftover historical-consolidation does not validate this collection
- This file does not set `autoIndex: false`; Form / Call / Booking / Cancellation do
- This checkout has no `historical/CplRatePeriod.ts`
