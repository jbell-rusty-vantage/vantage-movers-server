# Session story-models-moving-carrier-2026-09-13T0512Z

- Date (UTC): 2026-09-13T0512Z
- Service / module: `models` / `MovingCarrier.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 353
- Current service / next module (TRAVERSAL): `models` (in-progress) / `MovingCarrier.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/models-moving-carrier.md` (`src/models/MovingCarrier.ts`)
- operations named: Hold the Moving Carrier as the Tariff-resolve catalog row; Keep one carrier per DOT, one per MC, and one non-empty Granot Carrier Code and index folded name without uniqueness; Bind the default Mongo connection
- remaining in this service: `ExtensionUser.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `ExtensionUser.ts`

## Messages posted

- 2026-09-13T0512Z next

## Ideas parked

- none (do not unique-index folded name so carrier matches Merchant; do not drop field-level DOT or MC uniques so schema identity matches CSV; do not invent `getMovingCarrierModel` so carrier matches Form; do not delete the default `MovingCarrier` export so carrier matches evidence; do not copy Booking autoIndex-false without a migration; do not copy this DOT / MC / Granot-code unique onto leftover next `ExtensionUser.ts` without reading it)

## Contradictions

- Unique is DOT alone and MC alone plus a weaker compound `{ dot_number, mc_number }`; desk / CSV identity is DOT+MC
- Tariff finds `{ granot_carrier_code }` with no active filter; desk list defaults active-only
- Seed matches DOT only; desk identity is DOT+MC
- `normalized_name` is indexed not unique; already-recommended Merchant unique-indexes folded name
- This file does not set `autoIndex: false`; Form / Call / Booking / Cancellation do
- Overview does not count this collection; historical-consolidation does not validate it
- There is no `historical/MovingCarrier.ts`
- There is no `getMovingCarrierModel`
- Leftover next `ExtensionUser.ts` unique is email — do not copy this desk onto it without reading it
