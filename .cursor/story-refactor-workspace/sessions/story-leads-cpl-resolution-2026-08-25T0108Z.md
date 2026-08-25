# Session story-leads-cpl-resolution-2026-08-25T0108Z

- Date (UTC): 2026-08-25T01:08Z
- Service / module: `leads` / `leadCplResolution.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / (open after this pass; prior #8 merged)

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 0 / 1 / 37
- Recommendations on disk: 5 (`form-lead.md`, `leads-call-lead.md`, `leads-duplicate-lead.md`, `leads-ingestion-provenance.md`, `leads-source-company.md`)
- Current service / next module (TRAVERSAL): `leads` / `leadCplResolution.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/leads-cpl-resolution.md`
- operations named: Price the Lead (Eastern day → Registry → stamp snapshot); Report a missing CPL rate (after-commit owner event)
- remaining in this service: `leadLocation.service.ts`, `leadName.service.ts`, `leadPhoneMatching.ts`, `sourceLeadLookup.service.ts`, `callLeadSourceMatch.ts`, `leadSourceCompatibility.ts`

## Stock at end

- Visited / in-progress / unvisited: 0 / 1 / 37
- Current service / next module: `leads` / `leadLocation.service.ts`

## Messages posted

- 2026-08-25T0108Z next-run

## Ideas parked

- none

## Contradictions

- none new. Form ingest still omits `duplicate` (real rate). Only unmatched Call create passes `applicable: false`. Mirror / enrichment / recon / unmatched create price without reporting; ingest/Granot report after commit; employee recon create reports inside the session.
