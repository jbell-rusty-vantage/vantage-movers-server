# Session story-granot-lifecycle-capture-2026-08-26T0916Z

- Date (UTC): 2026-08-26T09:16Z
- Service / module: `granotLifecycle` / `capture.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/41

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 11 / 0 / 27
- Recommendations on disk: 37 (`form-lead.md`, twelve `leads-*.md`, seven `bookings-*.md`, three `cancellations-*.md`, two `customers-*.md`, two `agents-*.md`, `lead-source-companies-lead-source-company.md`, `cpl-cpl-rate.md`, `catalog-catalog.md`, four `search-*.md`, two `enrichment-*.md`, two `reconciliation-*.md`)
- Current service / next module (TRAVERSAL): `granotLifecycle` (unvisited) / enumerate `src/services/granotLifecycle/`

## This pass

- opened new service?: yes — modules enumerated (44 runtime files; 10 skipped as type-only / helpers; `capture.ts` recommended)
- path or skip: recommended → `recommendations/granot-lifecycle-capture.md`
- operations named: Keep this webhook delivery as a Granot Observation Receipt; Keep this approved channel operation as a Granot Observation Receipt
- remaining in this service: `queuePublisher.ts` and the rest of the checklist

## Stock at end

- Visited / in-progress / unvisited: 11 / 1 / 26
- Current service / next module: `granotLifecycle` (in-progress) / `queuePublisher.ts`

## Messages posted

- 2026-08-26T0916Z next-run

## Ideas parked

- none

## Contradictions

- Webhook hash is diagnostic; channel hash is the replay key. Capture never publishes. `provider` leftover beside `source_system`. See CONTRADICTIONS.md.
