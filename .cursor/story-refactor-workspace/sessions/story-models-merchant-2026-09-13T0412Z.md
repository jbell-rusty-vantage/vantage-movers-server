# Session story-models-merchant-2026-09-13T0412Z

- Date (UTC): 2026-09-13T0412Z
- Service / module: `models` / `Merchant.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 352
- Current service / next module (TRAVERSAL): `models` (in-progress) / `Merchant.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/models-merchant.md` (`src/models/Merchant.ts`)
- operations named: Hold the Merchant as the catalog System of Record row; Keep one Merchant per folded name and index aliases for name-or-alias lookup without uniqueness; Bind the default Mongo connection
- remaining in this service: `MovingCarrier.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `MovingCarrier.ts`

## Messages posted

- 2026-09-13T0412Z next

## Ideas parked

- none (do not unique-index aliases so Registry availability matches the schema; do not invent `getMerchantModel` so Merchant matches Form; do not delete the default `Merchant` export so Merchant matches evidence; do not copy Agent Granot uniques or inverse Lead virtuals; do not copy Booking autoIndex-false without a migration; do not copy this unique folded name onto leftover next `MovingCarrier.ts` without reading it)

## Contradictions

- Unique is `{ normalized_name }`; Registry also refuses aliases on another row
- Projection finds exact display `name` + active; Registry `$or`s fold-or-alias
- Health copy says inactive Merchants remain valid for explicit Owner booking; Owner Booking asks `{ _id, active: true }`; public resolve has no include-inactive
- `created_from` defaults `"admin"`; already-recommended Agent defaults `"booked_lead"`
- This file does not set `autoIndex: false`; Form / Call / Booking / Cancellation do
- Overview counts this collection; historical-consolidation validates it
- There is no `historical/Merchant.ts`
- Booking snapshot is a display string, not ObjectId
- Leftover next `MovingCarrier.ts` unique is DOT / MC / Granot Carrier Code; `normalized_name` is indexed not unique — do not copy this desk onto it without reading it
