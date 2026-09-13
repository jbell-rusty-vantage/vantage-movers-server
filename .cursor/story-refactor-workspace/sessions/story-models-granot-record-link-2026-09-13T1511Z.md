# Session story-models-granot-record-link-2026-09-13T1511Z

- Date (UTC): 2026-09-13T1511Z
- Service / module: `models` / `GranotRecordLink.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 362
- Current service / next module (TRAVERSAL): `models` (in-progress) / `GranotRecordLink.ts`

## This pass

- opened new service?: no
- path or skip: recommended → [recommendations/models-granot-record-link.md](../recommendations/models-granot-record-link.md)
- operations named: hold the current job-level Granot Record Link; allow only refresh / dispute / supersede through the named allowlist (mongoose refuses `booking_ref`, replace, delete, upsert); bind the selected Mongo database and declare the three named indexes with partial unique `{ provider, normalized_job_no }` where `state:"active"`
- remaining in this service: `GranotBookingReconciliationCase.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `GranotBookingReconciliationCase.ts`

## Messages posted

- 2026-09-13T1511Z next

## Ideas parked

- none

## Contradictions

- Unique is exact `{ provider, normalized_job_no }` while active; identity lookup uses prefix-equivalent Jobs. Leave both.
- `timestamps: false` but `updatedAt` is on the mongoose allowlist. Leave both.
- Leftover next GranotBookingReconciliationCase.ts is a different row — do not copy this link catalog onto it without reading it
