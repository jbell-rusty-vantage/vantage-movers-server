# Session story-leads-source-lead-lookup-2026-08-25T0510Z

- Date (UTC): 2026-08-25T05:10Z
- Service / module: `leads` / `sourceLeadLookup.service.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/13

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 0 / 1 / 37
- Recommendations on disk: 9 (`form-lead.md`, `leads-call-lead.md`, `leads-duplicate-lead.md`, `leads-ingestion-provenance.md`, `leads-source-company.md`, `leads-cpl-resolution.md`, `leads-lead-location.md`, `leads-lead-name.md`, `leads-lead-phone-matching.md`)
- Current service / next module (TRAVERSAL): `leads` / `sourceLeadLookup.service.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/leads-source-lead-lookup.md`
- operations named: Load the source lead we already named (model + id, 404 if that collection misses); Name which collection this id belongs to (both collections, 409 collision, 404 neither)
- remaining in this service: `callLeadSourceMatch.ts`, `leadSourceCompatibility.ts`

## Stock at end

- Visited / in-progress / unvisited: 0 / 1 / 37
- Current service / next module: `leads` / `callLeadSourceMatch.ts`

## Messages posted

- 2026-08-25T0510Z next-run

## Ideas parked

- none

## Contradictions

- added: `findFormLead` hides Duplicate Leads; `getLinkedLead` returns them (and booked/cancelled/unmatched). Eligibility stays on the caller.
