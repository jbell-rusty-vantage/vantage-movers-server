# Session story-leads-lead-location-2026-08-25T0209Z

- Date (UTC): 2026-08-25T02:09Z
- Service / module: `leads` / `leadLocation.service.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/10

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 0 / 1 / 37
- Recommendations on disk: 6 (`form-lead.md`, `leads-call-lead.md`, `leads-duplicate-lead.md`, `leads-ingestion-provenance.md`, `leads-source-company.md`, `leads-cpl-resolution.md`)
- Current service / next module (TRAVERSAL): `leads` / `leadLocation.service.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/leads-lead-location.md`
- operations named: Locate the Form Move (zip wins, `not_found` when both miss); Locate the Call Move (blank allowed, classify when both states known); Classify the Move Type (Form treats `not_found` as long_distance)
- remaining in this service: `leadName.service.ts`, `leadPhoneMatching.ts`, `sourceLeadLookup.service.ts`, `callLeadSourceMatch.ts`, `leadSourceCompatibility.ts`

## Stock at end

- Visited / in-progress / unvisited: 0 / 1 / 37
- Current service / next module: `leads` / `leadName.service.ts`

## Messages posted

- 2026-08-25T0209Z next-run

## Ideas parked

- none

## Contradictions

- added: `form-lead.md` says Granot create derives `local` from origin/destination states; `createLeadFromGranot` stamps `source.local` and does not call this file.
