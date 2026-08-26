# Session story-granot-lifecycle-granot-temporal-2026-08-26T1712Z

- Date (UTC): 2026-08-26T17:12Z
- Service / module: `granotLifecycle` / `granotTemporal.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / (open after this pass; #48 already merged)

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 11 / 1 / 26
- Recommendations on disk: 45 (`form-lead.md`, twelve `leads-*.md`, seven `bookings-*.md`, three `cancellations-*.md`, two `customers-*.md`, two `agents-*.md`, `lead-source-companies-lead-source-company.md`, `cpl-cpl-rate.md`, `catalog-catalog.md`, four `search-*.md`, two `enrichment-*.md`, two `reconciliation-*.md`, `granot-lifecycle-capture.md`, `granot-lifecycle-queue-publisher.md`, `granot-lifecycle-extension-apply.md`, `granot-lifecycle-automation-apply.md`, `granot-lifecycle-automation-compatibility.md`, `granot-lifecycle-normalization.md`, `granot-lifecycle-source-policy.md`, `granot-lifecycle-identity.md`)
- Current service / next module (TRAVERSAL): `granotLifecycle` (in-progress) / `granotTemporal.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/granot-lifecycle-granot-temporal.md`
- operations named: Say whether this Observation is newer than the last accepted one; Only accept this Observation as the winner if the stored stamp is older
- remaining in this service: `leadDesiredState.ts` and the rest of the checklist

## Stock at end

- Visited / in-progress / unvisited: 11 / 1 / 26
- Current service / next module: `granotLifecycle` (in-progress) / `leadDesiredState.ts`

## Messages posted

- 2026-08-26T1712Z next-run

## Ideas parked

- none

## Contradictions

- Compare can claim a first winner; the filter cannot (`$exists` forbidden). Sync omits the filter when no stamp exists; processor always spreads it. Planner `same` is `already_current`; sync `same` is a temporal race. Compare folds strings; filter `$lt`s ObjectId. See CONTRADICTIONS.md.
