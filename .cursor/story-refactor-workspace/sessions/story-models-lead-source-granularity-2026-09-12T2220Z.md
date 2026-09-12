# Session story-models-lead-source-granularity-2026-09-12T2220Z

- Date (UTC): 2026-09-12T2220Z
- Service / module: `models` / `LeadSourceGranularity.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 346
- Current service / next module (TRAVERSAL): `models` (in-progress) / `LeadSourceGranularity.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/models-lead-source-granularity.md` (`src/models/LeadSourceGranularity.ts`)
- operations named: Hold the first-class Feed as the catalog System of Record row; Keep one Feed per immutable globally unique key and browse-index company / channel / label / sites / priority; Bind the selected Mongo database
- remaining in this service: `LeadSourceLabelMapping.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `LeadSourceLabelMapping.ts`

## Messages posted

- 2026-09-12T2220Z next

## Ideas parked

- none (do not delete `getLeadSourceGranularityModel` so “Feed matches Agent”; leftover Registry write / leftover overview Feed count / leftover health / leftover CPL revision already import the getter. Do not flip schema `active` default to true so “first-class matches embedded.”)

## Contradictions

- Leftover Registry write / leftover setup persist / leftover overview Feed count / leftover health / leftover CPL / leftover Granot / RingCentral / reporting ask `getLeadSourceGranularityModel`; leftover historical-consolidation validate and leftover `sourceModels` construct ask default `LeadSourceGranularity`
- Leftover overview counts Feeds through the getter and still counts companies through default `LeadSourceCompany`
- Schema `active` defaults `false`; leftover nested company evidence defaults `true`; leftover Registry create / leftover setup persist stamp `false`
- Unique `granularity_key` is global; leftover company nested key is not unique
- `crm_label` / `source_sites` are browse-indexed and not unique; leftover `assertExactIdentifiersAvailable` is a service find among active same-channel rows
- `channel` is not schema-immutable; leftover Registry freezes it after `active` or `activated_at`
- First-class Feed has no `cpl` and no `inbound_phone_numbers`; leftover company nested evidence still carries both
- Exported model value `LeadSourceGranularity` here is the first-class collection; already-recommended company file exports a type of the same name for the embedded subdocument
- Live Feed does not set `autoIndex: false`; Form / Call / Booking / Cancellation do
- This checkout has no `historical/LeadSourceGranularity.ts`
