# Session story-analytics-source-hierarchy-2026-09-05T2011Z

- Date (UTC): 2026-09-05T20:11Z
- Service / module: `analytics` / `sourceHierarchy.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/186

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 25 / 1 / 12
- Recommendations on disk: 183
- Current service / next module (TRAVERSAL): `analytics` (in-progress) / `sourceHierarchy.ts`

This checkout booted on `cursor/vantage-server-story-refactor-9d87` with a stale seed (NOW pointed at `analyticsFilters.ts` / 181 recs / PR #184). Checked out `docs/story-refactor` before choosing the module. Disk already had `analytics-analytics-filters.md` + `analytics-analytics-merge.md`, lock none, `analytics` in-progress, next `sourceHierarchy.ts`. PR #185 was already merged.

Stayed on `analytics`. Next unchecked module: `sourceHierarchy.ts`.

## This pass

- opened new service?: no
- path or skip: recommended `sourceHierarchy.ts` → [recommendations/analytics-source-hierarchy.md](../recommendations/analytics-source-hierarchy.md)
- operations named: put these counted source rows under the Filter Catalog tree (`nestObservedSourceRows`: live seeds catalog zeros, historical with no keys stays company-only); fold these leaves into Source Company cards (`nestSourceCompanyRows`); keep these historical companies childless (`companyOnlySourceRows`); name these Source Granularities from the Filter Catalog (`sourceLabelIndexFromCatalog`: Receiver-Agent labels without nesting). Parent totals = sum of children. Does not count. Does not rematch chips. Does not add the two databases. Does not flatten.
- remaining in this service: none (`index.ts` already skipped)

## Stock at end

- Visited / in-progress / unvisited: 26 / 0 / 12
- Current service / next module: `observability` (unvisited) / enumerate `src/services/observability/`

## Messages posted

- 2026-09-05T2011Z next-run

## Ideas parked

- none

## Contradictions

- Historical company-only is "no real granularity key on any leaf," not "scope is historical." One historical leaf with a real key nests the whole set with `seedZeros: false`.
- The unused live-facets loader is unused.
- `nestObservedSourceRows` is untested at this interface (proven through scorecards / Lead Cost).
- knowledge ADR-0001 link is absent in this checkout (`docs/adr/` missing)
