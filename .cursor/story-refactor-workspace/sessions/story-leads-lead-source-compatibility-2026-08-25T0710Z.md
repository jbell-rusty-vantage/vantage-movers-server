# Session story-leads-lead-source-compatibility-2026-08-25T0710Z

- Date (UTC): 2026-08-25T07:10Z
- Service / module: `leads` / `leadSourceCompatibility.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / (new PR after #14 merged)

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 0 / 1 / 37
- Recommendations on disk: 11 (`form-lead.md`, `leads-call-lead.md`, `leads-duplicate-lead.md`, `leads-ingestion-provenance.md`, `leads-source-company.md`, `leads-cpl-resolution.md`, `leads-lead-location.md`, `leads-lead-name.md`, `leads-lead-phone-matching.md`, `leads-source-lead-lookup.md`, `leads-call-lead-source-match.md`)
- Current service / next module (TRAVERSAL): `leads` / `leadSourceCompatibility.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/leads-lead-source-compatibility.md`
- operations named: Score how this Lead fits the booking’s source (same site / same company / still unassigned / disagree)
- remaining in this service: none — `leads` visited

## Stock at end

- Visited / in-progress / unvisited: 1 / 0 / 37
- Current service / next module: `bookings` / enumerate `src/services/bookings/`

## Messages posted

- 2026-08-25T0710Z next-run

## Ideas parked

- none

## Contradictions

- updated: four-way score vs Follow Up yes/no (stricter unassigned, fold vs exact, leftover+granularity can be same-site without ids, same-company-different-site is not conflict)
