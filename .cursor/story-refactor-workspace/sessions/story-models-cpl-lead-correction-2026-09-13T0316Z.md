# Session story-models-cpl-lead-correction-2026-09-13T0316Z

- Date (UTC): 2026-09-13T0316Z
- Service / module: `models` / `CplLeadCorrection.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 351
- Current service / next module (TRAVERSAL): `models` (in-progress) / `CplLeadCorrection.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/models-cpl-lead-correction.md` (`src/models/CplLeadCorrection.ts`)
- operations named: Hold the immutable before/after Lead CPL evidence as the durable rewrite receipt; Unique-index one evidence row per frozen job plus Lead kind plus Lead id, and index Lead plus correctedAt for history without uniqueness; Bind the default Mongo connection through the getter
- remaining in this service: `Merchant.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `Merchant.ts`

## Messages posted

- 2026-09-13T0316Z next

## Ideas parked

- none (do not unique-index Lead alone so a second job 11000s; do not drop uniqueness on job-plus-Lead so retries can append a second receipt; do not flip evidence `cpl` to cents so “evidence matches the period”; do not add `useDb` so “evidence matches the job”; do not invent a default `CplLeadCorrection` export so “evidence matches the job”; do not copy this desk’s unique job-plus-Lead or no-`useDb` getter onto leftover next `Merchant.ts` without reading it)

## Contradictions

- Unique is `{ job_id, lead_model, lead_id }`; history `{ lead_model, lead_id, corrected_at: -1 }` is not unique — Owner may file a second job against the same Lead
- Evidence `cpl` is Lead dollars; leftover period `amount_cents` is integer cents
- Snapshot has no `duplicate`; leftover Lead CAS filters on `duplicate`
- Getter is default-connection only (`mongoose.models` / `mongoose.model`); leftover job getter uses `useDb`; leftover fourteen-slot has no getter
- There is no default `CplLeadCorrection` export
- This file does not set `autoIndex: false`; Form / Call / Booking / Cancellation do
- Leftover store `create` after Lead CAS; nobody leftover-finds `cpl_lead_corrections` after append
- Leftover overview does not count this collection; leftover historical-consolidation does not validate this collection
- Nested Form / Call `cpl_correction` is `{ job_id, corrected_at, previous_cpl }`, not this before/after receipt
- This checkout has no `historical/CplLeadCorrection.ts`
- Leftover next `Merchant.ts` is default-only unique `normalized_name` — do not copy this desk onto it without reading it
