# Session story-reconciliation-booked-call-lead-rows-2026-08-26T0811Z

- Date (UTC): 2026-08-26T08:11Z
- Service / module: `reconciliation` / `bookedCallLeadRows.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / pending (PR #39 already merged)

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 10 / 1 / 27
- Recommendations on disk: 36 (`form-lead.md`, twelve `leads-*.md`, seven `bookings-*.md`, three `cancellations-*.md`, two `customers-*.md`, two `agents-*.md`, `lead-source-companies-lead-source-company.md`, `cpl-cpl-rate.md`, `catalog-catalog.md`, four `search-*.md`, two `enrichment-*.md`, `reconciliation-booked-call-lead.md`)
- Current service / next module (TRAVERSAL): `reconciliation` (in-progress) / `bookedCallLeadRows.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/reconciliation-booked-call-lead-rows.md`
- operations named: Read this Booked Jobs row; Refuse when Job Number, known source, or Booked-Jobs identity is missing
- remaining in this service: none — `reconciliation` visited

## Stock at end

- Visited / in-progress / unvisited: 11 / 0 / 27
- Current service / next module: `granotLifecycle` (unvisited) / enumerate `src/services/granotLifecycle/`

## Messages posted

- 2026-08-26T0811Z next-run

## Ideas parked

- none

## Contradictions

- CSV Booked Jobs omits `from` / `to` / `granot_crm_username`; HTTP sends them. `source_cpl` is dead. Unknown-source knowledge vs leftover label map. `book_date` MM/DD/YYYY gate vs Florida helper ISO. Zip-book miss silent vs Follow Up warning. See CONTRADICTIONS.md.
