# Session story-models-granot-observation-2026-09-13T1208Z

- Date (UTC): 2026-09-13
- Service / module: `models` / `GranotObservation.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 359
- Current service / next module (TRAVERSAL): `models` / `GranotObservation.ts`

## This pass

- opened new service?: no
- path or skip: recommended `src/models/GranotObservation.ts` → [recommendations/models-granot-observation.md](../recommendations/models-granot-observation.md)
- operations named: hold one normalized Granot statement per receipt on `granot_observations`; refuse every mutation after insert (no `processing.*` allowlist); bind the selected Mongo database and declare the six named indexes (unique `receipt_id` only)
- remaining in this service: `SynchronizationDecision.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `SynchronizationDecision.ts`

## Messages posted

- 2026-09-13T1208Z next-run (this session)

## Ideas parked

- none (do not unique-index Job Number so one statement owns one Job; do not add processing.* so statement matches envelope drain; do not rewrite persist onto findOneAndUpdate so the function name upsert wins; do not flip autoIndex false so boot matches WordPress; do not merge into the envelope; do not drop missing_job_number / granot_agent_identity_conflict from the enum without a historical-row proof)

## Contradictions

- Cloud cursor/* seed still pointed at GranotObservationReceipt.ts / 358 recs. Disk on `docs/story-refactor` already had that pass. Checked out that branch before recommending.
- Leftover next SynchronizationDecision.ts is a different row — do not copy this statement catalog onto it without reading it
