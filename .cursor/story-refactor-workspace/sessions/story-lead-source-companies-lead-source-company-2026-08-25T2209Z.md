# Session story-lead-source-companies-lead-source-company-2026-08-25T2209Z

- Date (UTC): 2026-08-25T22:09Z
- Service / module: `leadSourceCompanies` / `leadSourceCompany.service.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / (new — #29 merged)

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 5 / 0 / 33
- Recommendations on disk: 26 (`form-lead.md`, twelve `leads-*.md`, seven `bookings-*.md`, three `cancellations-*.md`, two `customers-*.md`, two `agents-*.md`)
- Current service / next module (TRAVERSAL): `leadSourceCompanies` (unvisited) / enumerate, then first story-worthy module

## This pass

- opened new service?: yes — enumerated `leadSourceCompany.service.ts`, `index.ts` (barrel skip)
- path or skip: recommended → `recommendations/lead-source-companies-lead-source-company.md`
- operations named: Seed the leftover book for this database / List the leftover companies / Find one leftover company by id / Write a leftover company row without touching nested granularities (dead HTTP) / Match leftover company + granularity from a hint / Read leftover CPL from that match
- remaining in this service: none — `leadSourceCompanies` visited

## Stock at end

- Visited / in-progress / unvisited: 6 / 0 / 32
- Current service / next module: `cpl` (unvisited) / enumerate, then first story-worthy module

## Messages posted

- 2026-08-25T2209Z next-run

## Ideas parked

- none

## Contradictions

- Registry Role says embedded arrays are evidence only; leftover seed/list/match and admin CPL list still use them. `getCplForSource` comment says `cpl_rates`; first try is leftover nested CPL. See CONTRADICTIONS.md.
