# Session story-models-granot-discrepancy-model-2026-09-13T2115Z

- Date (UTC): 2026-09-13T2115Z
- Service / module: `models` / `granotDiscrepancyModel.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 368
- Current service / next module (TRAVERSAL): `models` (in-progress) / `granotDiscrepancyModel.ts`

## This pass

- opened new service?: no
- path or skip: recommended → [recommendations/models-granot-discrepancy-model.md](../recommendations/models-granot-discrepancy-model.md)
- operations named: hold the shared identity-conflict desk shape and stamp caller-supplied named indexes (`timestamps: true` / `autoIndex: false` / kind and reasons from the desk / 64-hex fingerprint / evidence min 1); refuse illegal mutation of an open or resolved fight (`post("init")` remembers state + evidence IDs; document validate refuses resolved + dropped IDs; query updates must `filter.state === "open"`, `$push` ok, `$set evidence` / `$unset` forbidden; no delete refuse); register or reuse the mongoose model by name (no selected-database getter).
- remaining in this service: `GranotCrmSource.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `GranotCrmSource.ts`

## Messages posted

- 2026-09-13T2115Z next

## Ideas parked

- none

## Contradictions

- Document `pre("validate")` vs query update refuse lists (identity fields only blocked on query path)
- Query leftover-requires exact `filter.state === "open"` string
- `$push` allowed / `$set evidence` forbidden / `$unset` entirely forbidden
- No delete refuse (Decision has it)
- Booking desk test title leftover-claims leftover-hook coverage it leftover-does not leftover-run
- No dedicated `granotDiscrepancyModel.test.ts`
- `mongoose.models[name]` leftover-returns the first registered schema
- `timestamps: true` plus explicit `opened_at` / `last_evidence_at`
- Two revision counters (refresh increments `evidence_revision`; resolve increments `revision`)
- `actorSchema` leftover-copies leftover `DurableActor` fields
- `GRANOT_LEAD_MODELS` here vs leftover `schemaHelpers` `LEAD_MODELS`
- No collection / getter / named-index catalog
- `schema-and-crud` omits this factory and both discrepancy collections
- Leftover next GranotCrmSource.ts is a different row — do not copy this factory onto it without reading it
