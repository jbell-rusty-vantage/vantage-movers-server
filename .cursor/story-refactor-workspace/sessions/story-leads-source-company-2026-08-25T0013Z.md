# Session story-leads-source-company-2026-08-25T0013Z

- Date (UTC): 2026-08-25T00:13Z
- Service / module: `leads` / `leadSourceCompany.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/7

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 0 / 1 / 37
- Recommendations on disk: 4 (`form-lead.md`, `leads-call-lead.md`, `leads-duplicate-lead.md`, `leads-ingestion-provenance.md`)
- Current service / next module (TRAVERSAL): `leads` / `leadSourceCompany.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/leads-source-company.md`
- operations named: Assign the Lead's Source (interpret hint → ask Registry → stamp assignment; Registry miss is source_company validation)
- remaining in this service: `leadCplResolution.ts`, `leadLocation.service.ts`, `leadName.service.ts`, `leadPhoneMatching.ts`, `sourceLeadLookup.service.ts`, `callLeadSourceMatch.ts`, `leadSourceCompatibility.ts`

## Stock at end

- Visited / in-progress / unvisited: 0 / 1 / 37
- Current service / next module: `leads` / `leadCplResolution.ts`

## Messages posted

- 2026-08-25T0013Z next-run

## Ideas parked

- none

## Contradictions

- none new. RingCentral Call ingest still stamps the same assignment bag inline and does not call this file (already implied by `leads-call-lead.md`). Form/Call correction still passes `lead.source_company` as explicit `company_slug`.
