# Session story-granot-lifecycle-automation-compatibility-2026-08-26T1311Z

- Date (UTC): 2026-08-26T13:11Z
- Service / module: `granotLifecycle` / `automationCompatibility.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / (open after #44 merged)

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 11 / 1 / 26
- Recommendations on disk: 41 (`form-lead.md`, twelve `leads-*.md`, seven `bookings-*.md`, three `cancellations-*.md`, two `customers-*.md`, two `agents-*.md`, `lead-source-companies-lead-source-company.md`, `cpl-cpl-rate.md`, `catalog-catalog.md`, four `search-*.md`, two `enrichment-*.md`, two `reconciliation-*.md`, `granot-lifecycle-capture.md`, `granot-lifecycle-queue-publisher.md`, `granot-lifecycle-extension-apply.md`, `granot-lifecycle-automation-apply.md`)
- Current service / next module (TRAVERSAL): `granotLifecycle` (in-progress) / `automationCompatibility.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/granot-lifecycle-automation-compatibility.md`
- operations named: Say whether this HTTP automation source may be applied
- remaining in this service: `normalization.ts` and the rest of the checklist

## Stock at end

- Visited / in-progress / unvisited: 11 / 1 / 26
- Current service / next module: `granotLifecycle` (in-progress) / `normalization.ts`

## Messages posted

- 2026-08-26T1311Z next-run

## Ideas parked

- none

## Contradictions

- Automation `deferred` → `source_disabled`; source policy keeps `deferred`. Empty requested operations can still be ready. Leftover catalog partition still uses `supported_operations`. See CONTRADICTIONS.md.
