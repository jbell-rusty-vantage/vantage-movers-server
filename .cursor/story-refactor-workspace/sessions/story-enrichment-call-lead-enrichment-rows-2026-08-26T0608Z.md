# Session story-enrichment-call-lead-enrichment-rows-2026-08-26T0608Z

- Date (UTC): 2026-08-26T06:08Z
- Service / module: `enrichment` / `callLeadEnrichmentRows.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / new PR (previous #37 merged)

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 9 / 1 / 28
- Recommendations on disk: 34 (`form-lead.md`, twelve `leads-*.md`, seven `bookings-*.md`, three `cancellations-*.md`, two `customers-*.md`, two `agents-*.md`, `lead-source-companies-lead-source-company.md`, `cpl-cpl-rate.md`, `catalog-catalog.md`, four `search-*.md`, `enrichment-call-lead-enrichment.md`)
- Current service / next module (TRAVERSAL): `enrichment` (in-progress) / `callLeadEnrichmentRows.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/enrichment-call-lead-enrichment-rows.md`
- operations named: Read this Follow Up row; Refuse when neither phone nor Job Number remains
- remaining in this service: none — `enrichment` visited

## Stock at end

- Visited / in-progress / unvisited: 10 / 0 / 28
- Current service / next module: `reconciliation` (unvisited) / enumerate `src/services/reconciliation/`

## Messages posted

- 2026-08-26T0608Z next-run

## Ideas parked

- none

## Contradictions

- Follow Up empty source is leftover `not_provided` (`resolveSourceCompany`). Booked-jobs empty source is `undefined` (`resolveSourceCompanyFromLabel`). CSV Follow Up omits `from` / `to` / `granot_crm_username`; HTTP automation sends them. `source_cpl` is declared and never set. See CONTRADICTIONS.md.
