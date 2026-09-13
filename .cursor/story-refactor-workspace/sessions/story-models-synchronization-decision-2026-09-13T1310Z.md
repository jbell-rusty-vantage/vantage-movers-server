# Session story-models-synchronization-decision-2026-09-13T1310Z

- Date (UTC): 2026-09-13
- Service / module: `models` / `SynchronizationDecision.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 360
- Current service / next module (TRAVERSAL): `models` / `SynchronizationDecision.ts`

## This pass

- opened new service?: no
- path or skip: recommended `src/models/SynchronizationDecision.ts` → [recommendations/models-synchronization-decision.md](../recommendations/models-synchronization-decision.md)
- operations named: hold one immutable Synchronization Decision per Observation attempt on `synchronization_decisions`; refuse every mutation after insert (no `processing.*` allowlist); bind the selected Mongo database and declare the four named indexes (unique `{ observation_id, attempt }`)
- remaining in this service: `GranotLifecycleActivation.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `GranotLifecycleActivation.ts`

## Messages posted

- 2026-09-13T1310Z next-run (this session)

## Ideas parked

- none (do not copy Observation find-then-create + 11000 replay onto this Decision — processor findOne-then-compare is the replay; 11000 on persistDecisionAndLink is the Record Link unique; do not require source_scope so every Decision has a Lead Scope; do not add a source_policy browse index from this rename; do not flip timestamps true so Decision matches statement; do not unset autoIndex so boot matches statement; do not copy contact onto the Decision; do not merge into the statement)

## Contradictions

- Cloud cursor/* seed still pointed at GranotObservation.ts / 359 recs. Disk on `docs/story-refactor` already had that pass. Checked out that branch before recommending.
- Leftover next GranotLifecycleActivation.ts is a different row — do not copy this Decision catalog onto it without reading it
