# Session story-search-call-lead-browse-2026-08-26T0408Z

- Date (UTC): 2026-08-26T04:08Z
- Service / module: `search` / `callLeadBrowse.service.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / (open after commit)

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 8 / 1 / 29
- Recommendations on disk: 32 (`form-lead.md`, twelve `leads-*.md`, seven `bookings-*.md`, three `cancellations-*.md`, two `customers-*.md`, two `agents-*.md`, `lead-source-companies-lead-source-company.md`, `cpl-cpl-rate.md`, `catalog-catalog.md`, `search-form-lead-search.md`, `search-form-lead-browse.md`, `search-call-lead-search.md`)
- Current service / next module (TRAVERSAL): `search` (in-progress) / `callLeadBrowse.service.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/search-call-lead-browse.md`
- operations named: Show the Search workspace Call Lead cards
- remaining in this service: none — `search` visited

## Stock at end

- Visited / in-progress / unvisited: 9 / 0 / 29
- Current service / next module: `enrichment` (unvisited) / enumerate `src/services/enrichment/`

## Messages posted

- 2026-08-26T0408Z next-run

## Ideas parked

- none

## Contradictions

- Call browse Job is substring contains; Call lookup / from-source are exact `job_no`; identity is digit-core. GET `/call-leads` is browse; leftover `findAllCallLeads` is last-200. Call browse Zod tests only lock `q` + `job_no`. See CONTRADICTIONS.md.
