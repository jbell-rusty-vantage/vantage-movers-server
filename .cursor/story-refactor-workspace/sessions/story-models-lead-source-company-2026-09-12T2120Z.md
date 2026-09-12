# Session story-models-lead-source-company-2026-09-12T2120Z

- Date (UTC): 2026-09-12T2120Z
- Service / module: `models` / `LeadSourceCompany.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 345
- Current service / next module (TRAVERSAL): `models` (in-progress) / `LeadSourceCompany.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/models-lead-source-company.md` (`src/models/LeadSourceCompany.ts`)
- operations named: Hold the Source Company as the catalog System of Record row; Keep one company per immutable slug and browse-index leftover nested feed keys; Bind the selected Mongo database
- remaining in this service: `LeadSourceGranularity.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `LeadSourceGranularity.ts`

## Messages posted

- 2026-09-12T2120Z next

## Ideas parked

- none (do not delete `getLeadSourceCompanyModel` so “Source Company matches Agent”; leftover Registry write / leftover leftover-book seed / leftover health already import the getter. Do not flip schema `active` default to false so “schema matches Registry create.”)

## Contradictions

- Leftover Registry write / leftover leftover-book seed / leftover health / leftover Granot / RingCentral / reporting ask `getLeadSourceCompanyModel`; leftover overview count and leftover historical-consolidation validate ask default `LeadSourceCompany`
- Schema `active` defaults `true`; leftover Registry create stamps `false`; leftover leftover-book seed stamps `true`
- Embedded `granularities[]` is M3 rollback evidence (leftover CPL + inbound phones, nested `active` default true, nested key not unique); leftover next first-class Feed is a different collection (unique key, `active` default false, no `cpl`, no inbound phones)
- Compatibility default keys and first-class default ObjectId refs both live on this row
- Exported type `LeadSourceGranularity` here is the embedded subdocument; leftover next file exports a model value of the same name
- Live Source Company does not set `autoIndex: false`; Form / Call / Booking / Cancellation do
- This checkout has no `historical/LeadSourceCompany.ts`
