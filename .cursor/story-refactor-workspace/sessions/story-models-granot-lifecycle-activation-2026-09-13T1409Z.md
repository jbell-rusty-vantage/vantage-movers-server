# Session story-models-granot-lifecycle-activation-2026-09-13T1409Z

- Date (UTC): 2026-09-13
- Service / module: `models` / `GranotLifecycleActivation.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 361
- Current service / next module (TRAVERSAL): `models` / `GranotLifecycleActivation.ts`

## This pass

- opened new service?: no
- path or skip: recommended `src/models/GranotLifecycleActivation.ts` → [recommendations/models-granot-lifecycle-activation.md](../recommendations/models-granot-lifecycle-activation.md)
- operations named: hold one write-once Granot lifecycle clock on `granot_lifecycle_activations`; refuse every mutation after insert including delete and upsert (no `processing.*` allowlist); bind the selected Mongo database and declare the one named unique `{ key: 1 }` index
- remaining in this service: `GranotRecordLink.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `GranotRecordLink.ts`

## Messages posted

- 2026-09-13T1409Z next-run (this session)

## Ideas parked

- none (do not copy Decision unique `{ observation_id, attempt }` / `timestamps: false` / findOne-then-compare replay onto this clock — Owner persist is find-then-create and 11000 is already-activated; do not move activate or classify into this file; do not add a second clock so createLeadFromGranot’s sort is honest; do not widen the nested origin enum to match DurableActor; do not remove the delete hook so replica deleteMany can clean; do not flip flags from this rename)

## Contradictions

- Cloud cursor/* seed still pointed at SynchronizationDecision.ts / 360 recs. Disk on `docs/story-refactor` already had that pass. Checked out that branch before recommending.
- Leftover next GranotRecordLink.ts is a different row — do not copy this clock catalog onto it without reading it
