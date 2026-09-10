# Session story-moving-carriers-moving-carrier-2026-09-10T1612Z

- Date (UTC): 2026-09-10
- Service / module: `movingCarriers` / `movingCarrier.service.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 35 / 0 / 3
- Recommendations on disk: 294 (through `testimonials-testimonial-helpers.md`)
- Current service / next module (TRAVERSAL): `movingCarriers` (unvisited) / enumerate first

## This pass

- opened new service?: yes — modules enumerated: `movingCarrier.service.ts`, `granotCarrierCodeSeed.ts`, `index.ts` (skip — barrel)
- path or skip: recommended → `recommendations/moving-carriers-moving-carrier.md`
- operations named: show the desk the Moving Carriers they asked for; record a Moving Carrier so Tariff can later resolve its Granot code; correct a Moving Carrier including clearing its Granot code; load Moving Carriers from a CSV that patches or replaces the catalog — never delete, never resolve a Tariff row, never stamp the seed list
- remaining in this service: `granotCarrierCodeSeed.ts`

## Stock at end

- Visited / in-progress / unvisited: 35 / 1 / 2
- Current service / next module: `movingCarriers` (in-progress) / `granotCarrierCodeSeed.ts`

## Messages posted

- 2026-09-10T1612Z next

## Ideas parked

- Wave A tour rows omit `conversations`, `extensionUsers`, `jobNumberTimeline`, `tariff` — enumerate after listed Wave A, do not jump an in-progress checklist

## Contradictions

- Service identity is DOT+MC; model also uniques DOT alone and MC alone
- CSV-internal duplicates skip; Mongo `11000` throws and skips replace-deactivate
- PATCH empty string unsets Granot code; blank CSV cell leaves it
- Public GET and admin GET share the same card including `granot_carrier_code`
- `package.json` names `scripts/ingest-moving-carriers.ts`; that file is not on this checkout
- `createMovingCarrier` / `updateMovingCarrier` are untested
- No dedicated Moving Carrier Service file; closest knowledge is `tariff.md`
- This checkout’s `CONTEXT.md` does not define Moving Carrier / Granot Carrier Code; `docs/adr/` is absent
