# Session story-models-cpl-rate-2026-09-13T0025Z

- Date (UTC): 2026-09-13T0025Z
- Service / module: `models` / `CplRate.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 348
- Current service / next module (TRAVERSAL): `models` (in-progress) / `CplRate.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/models-cpl-rate.md` (`src/models/CplRate.ts`)
- operations named: Hold the leftover fourteen-slot row as read-only migration compatibility data; Keep one slot per unique label, and one slot per company plus channel plus optional Move Type
- remaining in this service: `CplRatePeriod.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `CplRatePeriod.ts`

## Messages posted

- 2026-09-13T0025Z next

## Ideas parked

- none (do not invent `getCplRateModel` so “fourteen-slot matches period”; leftover seed / leftover inventory / leftover M4 already import default `CplRate`. Do not flip `cpl` to `amount_cents` so “the slot matches the period.” Do not require `local` on every row so “the compound always has three fields.”)

## Contradictions

- Leftover seed / leftover slot read / leftover inventory / leftover M4 ask default `CplRate`; leftover next period asks `getCplRatePeriodModel`; this file has no getter
- Leftover overview does not count this collection; leftover health asks `getCplRatePeriodModel` and names path `legacy_cpl_rates`; leftover historical-consolidation does not validate this collection
- File comment says “Owner-editable”; leftover service only seeds / lists / reads; `updateCplRate` is a ghost
- `cpl` is dollars (`190` / `195` / `40` / `0`); leftover next `amount_cents` is integer cents; leftover M4 `dollarsToCents` later
- Field unique `label` is the leftover seed key; compound unique `{ source_company, lead_type, local }` is the leftover slot identity; leftover cache skips orphan labels
- Optional `local` plus unique compound: Mongo treats missing `local` as one null; only Best Relocation forms set `local`
- `source_company` is a string slug; leftover next period points at Feed ObjectId
- This file does not set `autoIndex: false`; Form / Call / Booking / Cancellation do
- This checkout has no `historical/CplRate.ts`
