# Session story-models-cpl-correction-job-2026-09-13T0219Z

- Date (UTC): 2026-09-13T0219Z
- Service / module: `models` / `CplCorrectionJob.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 350
- Current service / next module (TRAVERSAL): `models` (in-progress) / `CplCorrectionJob.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/models-cpl-correction-job.md` (`src/models/CplCorrectionJob.ts`)
- operations named: Hold the frozen prior-Lead rewrite job as the durable Owner rewrite row; Index claimable status plus lease plus createdAt, Feed plus createdAt, and request id without uniqueness; Bind the selected Mongo database
- remaining in this service: `CplLeadCorrection.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `CplLeadCorrection.ts`

## Messages posted

- 2026-09-13T0219Z next

## Ideas parked

- none (do not unique-index request id so leftover second confirm 11000s; leftover store claim / leftover `findClaimable` already use missing or null or `$lte now` while leftover health stalled uses `{ status: "processing", leased_until: { $lte: now } }` only. Do not flip frozen Lead `cpl` to cents so “the job matches the period.” Do not delete `getCplCorrectionJobModel` so “the job matches fourteen-slot.” Do not copy leftover next evidence’s no-`useDb` getter onto this desk.)

## Contradictions

- Leftover store claim / leftover `findClaimable` ask missing or null or `$lte now`; leftover health stalled asks `{ status: "processing", leased_until: { $lte: now } }` only
- Three leftover lookup compounds are not unique; leftover Owner may file a second job under the same request id
- Frozen `reviewed_targets[].cpl` is Lead dollars; leftover period `amount_cents` is integer cents
- Job `target_schedule_revision` is a snapshot `min: 1`; leftover Feed `schedule_revision` is the CAS default `0`
- Leftover store / leftover health ask `getCplCorrectionJobModel`; nobody leftover-inspects leftover `CplCorrectionJob.schema.indexes()`
- Leftover overview does not count this collection; leftover historical-consolidation does not validate this collection
- This file does not set `autoIndex: false`; Form / Call / Booking / Cancellation do
- Leftover next `CplLeadCorrection.ts` getter has no `useDb`; this file’s getter does
- This checkout has no `historical/CplCorrectionJob.ts`
