# Session story-models-granot-lifecycle-schemas-2026-09-13T2018Z

- Date (UTC): 2026-09-13T2018Z
- Service / module: `models` / `granotLifecycleSchemas.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 367
- Current service / next module (TRAVERSAL): `models` (in-progress) / `granotLifecycleSchemas.ts`

## This pass

- opened new service?: no
- path or skip: recommended → [recommendations/models-granot-lifecycle-schemas.md](../recommendations/models-granot-lifecycle-schemas.md)
- operations named: hold the shared Granot lifecycle word catalog (mongoose enums `satisfies` leftover `types.ts`; leftover `release_case_*` reasons stay); hold the Lead provenance and aggregate-revision field bags and refuse illegal mutation (`legacy_unknown` / `legacy_baseline` on new rows; ingested snapshots immutable after insert; paired `last_change_*`; write-once server `change_history_started_at`); hold the receipt processing shape and assert channel-operation identity (webhook route class vs extension lowercase UUID v4 vs automation first-colon run/action). No collection. No capture / normalize / decide / assign origin.
- remaining in this service: `granotDiscrepancyModel.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `granotDiscrepancyModel.ts`

## Messages posted

- 2026-09-13T2018Z next

## Ideas parked

- none

## Contradictions

- Dual catalog: this file `satisfies` leftover `types.ts` unions
- `release_case_opened` / `release_case_refreshed` remain after processor stopped opening Release cases
- Dual booked/release: `GRANOT_BOOKING_ACTIONS` vs `GRANOT_RECONCILIATION_ACTION_KINDS`
- Dual Lead models: `GRANOT_LEAD_MODELS` vs leftover `schemaHelpers` `LEAD_MODELS`
- Effect kinds generic `discrepancy_*`; reason codes split booking / release
- `job_no` in provenance names, not in public forbidden list; `normalized_job_no` is forbidden
- Call provenance has `quoted` + convergence, no move snapshot; Form has move snapshot
- `applyLeadProvenanceGuards` leftover-skips missing `ingested_move_snapshot` via `schema.path`
- `RECEIVER_AGENT_SOURCES` is Lead attribution living on this catalog
- `AUTHENTICATION_METHODS` allows `legacy_unknown`; leftover capture never writes it on a new webhook
- Automation identity leftover-splits on the first colon
- No collection / getter / `autoIndex` / named-index catalog / dedicated test file
- Leftover next granotDiscrepancyModel.ts is a different row — do not copy this catalog onto it without reading it
