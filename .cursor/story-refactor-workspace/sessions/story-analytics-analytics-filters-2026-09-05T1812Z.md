# Session story-analytics-analytics-filters-2026-09-05T1812Z

- Date (UTC): 2026-09-05T18:12Z
- Service / module: `analytics` / `analyticsFilters.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/185

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 25 / 1 / 12
- Recommendations on disk: 181
- Current service / next module (TRAVERSAL): `analytics` (in-progress) / `analyticsFilters.ts`

This checkout booted on `cursor/vantage-server-story-refactor-48dd` with a stale seed (NOW pointed at `leadCost.service.ts` / 179 recs / PR #183). Checked out `docs/story-refactor` before choosing the module. Disk already had `analytics-analytics-export.md`, lock none, `analytics` in-progress, next `analyticsFilters.ts`. PR #184 had already merged; this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/185.

Stayed on `analytics`. Next unchecked module: `analyticsFilters.ts`.

## This pass

- opened new service?: no
- path or skip: recommended `analyticsFilters.ts` → [recommendations/analytics-analytics-filters.md](../recommendations/analytics-analytics-filters.md)
- operations named: match these dashboard chips to Bookings (`bookedLeadPrefix`: employee snapshot then joined Lead); match these dashboard chips to Cancellations (`cancelledLeadPrefix`: join Booking then Lead; `local` omitted); match these dashboard chips to Form or Call Leads (`leadMatchForQuery` / `leadMatch`: Filter Catalog only when Source Granularity is set; historical `company_slug` is channel-scoped). `source_granularity_key` wins over `source_company`. Math helpers are not chip seams. This file does not count, nest, merge, or flatten.
- remaining in this service: `analyticsMerge.ts`, `sourceHierarchy.ts`

## Stock at end

- Visited / in-progress / unvisited: 25 / 1 / 12
- Current service / next module: `analytics` (in-progress) / `analyticsMerge.ts`

## Messages posted

- 2026-09-05T1812Z next-run

## Ideas parked

- none

## Contradictions

- Cancellation prefix omits `local`; Booking prefix applies it
- Cancellation `agent` is Cancellation `agent`, not allocation snapshot
- Lead `lead_type` empties the other collection via `{ _id: { $exists: false } }`
- `dateMatch` and `bookedLeadSourceLookups` are exported and unused outside this file
- `SOURCE_LABEL_TO_COMPANY` leftover walk is ORS-1 apply work, not this rename
- Tests prove Booking prefix + Lead `company_slug`, not `cancelledLeadPrefix`
- knowledge ADR-0001 link is absent in this checkout (`docs/adr/` missing)
