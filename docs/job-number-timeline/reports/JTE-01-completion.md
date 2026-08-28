# JTE-01 completion

Closed 2026-08-27 on `job-timeline-enhancement` in `vantage-main-server`.

## Files moved vs copied

Moved (prototype copy deleted after the production file existed):

- `assemble.ts`, `assemble.test.ts`, `types.ts`, `rows.ts`, `normalize.ts`, `masking.ts`, `masking.test.ts`

New production files (not a second assembler):

- `src/services/jobNumberTimeline/index.ts` — factory + public types only
- `module.ts` — normalize, company filter, load, assemble, redact
- `evidence-loader.port.ts`
- `mongo-evidence-loader.ts` — row loading from former `load.ts`
- `memory-evidence-loader.ts`
- `fixtures.ts` — shared v1 fixtures used by assemble and module tests
- `module.test.ts`, `normalize.test.ts`

Prototype retained as CLI/proof adapter:

- `cli.ts` — `render` and `discover` call `createJobNumberTimelineModule`
- `discover.ts` — ranking only; assembles through the production module / `assembleJobNumberTimeline`
- `load.ts` — database name + production-confirm helpers only

Also retargeted `scripts/prototypes/lifecycle-assurance` assemble/types/row-load imports to `src/services/jobNumberTimeline/`. That script was a hidden compile dependency of the old prototype path. Not a v2 change.

v1 fixtures were not rewritten to pass. Headlines, kinds, sort, and assemble cases are the relocated tests.

## `rg` proving `src/` is clean

```text
rg "scripts/prototypes/job-number-timeline" src
# (no matches)
```

## Focused tests

```text
node --import tsx --import ./scripts/test-setup.ts --test \
  "src/services/jobNumberTimeline/**/*.test.ts" \
  "src/routes/job-number-timeline-admin.routes.test.ts"
# 31 pass, 0 fail

pnpm test:prototype:job-number-timeline
# 6 pass, 0 fail

pnpm typecheck
# tsc --noEmit exit 0
```

Route tests still inject `deps.read` and still prove Owner-only vs Admin 403.

## Service doc

`docs/knowledge/services/job-number-timeline.md` now names `src/services/jobNumberTimeline/` as primary code. The prototype is a retained CLI/proof adapter. v2 fields are not described as shipped.

## Left for JTE-02

- `schema_version`, stages, dual clocks, evidence/correlation/activity
- `source_received` and Observation Receipt / RingCentral ledger / cursor reads
- Outcome, attention, limitations, freshness (JTE-03)
- Admin UI (JTE-04)

No Command, EntityChange, case, outbox row, or notification was produced.

## Residual (not fixed)

CLI `--source-granularity-id` that does not belong to `--source-company-id` now prints `filtered_out` (exit 0) instead of throwing exit 2. That matches the HTTP module. Route tests still inject `deps.read` and do not exercise `defaultRead` against Mongo.
