# Session story-models-lead-source-label-mapping-2026-09-12T2318Z

- Date (UTC): 2026-09-12T2318Z
- Service / module: `models` / `LeadSourceLabelMapping.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 347
- Current service / next module (TRAVERSAL): `models` (in-progress) / `LeadSourceLabelMapping.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/models-lead-source-label-mapping.md` (`src/models/LeadSourceLabelMapping.ts`)
- operations named: Hold the hung spelling as the catalog System of Record row; Keep one live mapping per namespace plus folded key, browse-index company / Feed, and refuse destination edits after create; Bind the selected Mongo database
- remaining in this service: `CplRate.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `CplRate.ts`

## Messages posted

- 2026-09-12T2318Z next

## Ideas parked

- none (do not delete `getLeadSourceLabelMappingModel` so “accepted label matches Agent”; leftover hang / leftover health / leftover projection already import the getter. Do not flip schema `active` default to false so “accepted label matches Feed.” Do not drop the partial unique so “every historical spelling is unique.”)

## Contradictions

- Leftover hang / leftover archive / leftover list / leftover collection-first ask / leftover health / leftover projection ask `getLeadSourceLabelMappingModel`; leftover unique-index inspect and leftover document construct ask default `LeadSourceLabelMapping`
- Leftover overview does not count this collection; leftover historical-consolidation does not validate this collection
- Schema `active` defaults `true`; leftover first-class Feed defaults `false`; leftover hang stamps `true`
- Named partial unique `{ namespace, normalized_label }` where `{ active: true }` is live-only; leftover hang / leftover restore also `findOne` first; leftover health collision finding says the unique is missing or bypassed
- `normalized_label` must equal leftover `normalizeSourceLabel(label)` and is not stamped on validate; leftover hang stamps both fields
- Destination fields are schema-immutable plus `pre("validate")`; `normalized_label` is validator-only
- Live mapping does not set `autoIndex: false`; Form / Call / Booking / Cancellation do; leftover inventory apply does not apply indexes
- This checkout has no `historical/LeadSourceLabelMapping.ts`
