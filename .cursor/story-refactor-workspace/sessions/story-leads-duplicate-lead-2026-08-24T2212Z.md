# Session story-leads-duplicate-lead-2026-08-24T2212Z

- Date (UTC): 2026-08-24T22:12Z
- Service / module: `leads` / `duplicateLead.service.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/7

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 0 / 1 / 37
- Recommendations on disk: 2 (`form-lead.md`, `leads-call-lead.md`)
- Current service / next module (TRAVERSAL): `leads` / `duplicateLead.service.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/leads-duplicate-lead.md`
- operations named: Duplicate Form Lead classification, Form Fill linkage (detect + mark)
- remaining in this service: `leadIngestionProvenance.ts`, `leadSourceCompany.ts`, `leadCplResolution.ts`, `leadLocation.service.ts`, `leadName.service.ts`, `leadPhoneMatching.ts`, `sourceLeadLookup.service.ts`, `callLeadSourceMatch.ts`, `leadSourceCompatibility.ts`

## Stock at end

- Visited / in-progress / unvisited: 0 / 1 / 37
- Current service / next module: `leads` / `leadIngestionProvenance.ts`

## Messages posted

- 2026-08-24T2212Z next-run

## Ideas parked

- none

## Contradictions

- JSDoc “same source company” vs exact-granularity classify (see CONTRADICTIONS.md + recommendation)
