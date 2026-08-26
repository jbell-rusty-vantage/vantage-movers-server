# Session story-granot-lifecycle-normalization-2026-08-26T1411Z

- Date (UTC): 2026-08-26T14:11Z
- Service / module: `granotLifecycle` / `normalization.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / (new PR after #45 merged)

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 11 / 1 / 26
- Recommendations on disk: 42 (`form-lead.md`, twelve `leads-*.md`, seven `bookings-*.md`, three `cancellations-*.md`, two `customers-*.md`, two `agents-*.md`, `lead-source-companies-lead-source-company.md`, `cpl-cpl-rate.md`, `catalog-catalog.md`, four `search-*.md`, two `enrichment-*.md`, two `reconciliation-*.md`, `granot-lifecycle-capture.md`, `granot-lifecycle-queue-publisher.md`, `granot-lifecycle-extension-apply.md`, `granot-lifecycle-automation-apply.md`, `granot-lifecycle-automation-compatibility.md`)
- Current service / next module (TRAVERSAL): `granotLifecycle` (in-progress) / `normalization.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/granot-lifecycle-normalization.md`
- operations named: Say what this Granot receipt observed; Keep that Observation for this receipt
- remaining in this service: `sourcePolicy.ts` and the rest of the checklist

## Stock at end

- Visited / in-progress / unvisited: 11 / 1 / 26
- Current service / next module: `granotLifecycle` (in-progress) / `sourcePolicy.ts`

## Messages posted

- 2026-08-26T1411Z next-run

## Ideas parked

- none

## Contradictions

- `upsertGranotObservation` drops `payload_schema_hint`. `PRIORITY_BROAD_ENRICHMENT_CANONICALS` unused by runtime callers; siblings hard-code 1/5 and set `quoted`. Schema lists `missing_job_number` / `granot_agent_identity_conflict`; this fold never emits them. See CONTRADICTIONS.md.
