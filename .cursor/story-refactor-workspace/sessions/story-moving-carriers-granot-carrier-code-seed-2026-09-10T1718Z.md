# Session story-moving-carriers-granot-carrier-code-seed-2026-09-10T1718Z

- Date (UTC): 2026-09-10
- Service / module: `movingCarriers` / `granotCarrierCodeSeed.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 35 / 1 / 2
- Recommendations on disk: 295 (through `moving-carriers-moving-carrier.md`)
- Current service / next module (TRAVERSAL): `movingCarriers` (in-progress) / `granotCarrierCodeSeed.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/moving-carriers-granot-carrier-code-seed.md`
- operations named: for each Owner seed, find the Moving Carrier by DOT and say missing / already set / would stamp / would replace — never stamp Mongo, never drop the unique index, never resolve a Tariff cell
- remaining in this service: none (`movingCarriers` visited)

## Stock at end

- Visited / in-progress / unvisited: 36 / 0 / 2
- Current service / next module: `errors` (unvisited — enumerate first)

## Messages posted

- 2026-09-10T1718Z next

## Ideas parked

- Wave A tour rows omit `conversations`, `extensionUsers`, `jobNumberTimeline`, `tariff` — enumerate after listed Wave A, do not jump an in-progress checklist

## Contradictions

- Seed plan matches by DOT only; sibling catalog identity is DOT+MC
- Returned `dot_number` is the seed’s raw string; script `--apply` keys that, not the stored catalog DOT
- Last catalog row with a folded DOT wins; no conflict outcome
- `active` / `name` / `mc_number` are invisible; deactivated carriers still plan `will_set` / `will_replace`
- Extra catalog rows never appear; seed list drives the walk
- First test locks leftover `GRANOT_CARRIER_CODE_SEEDS` uniqueness (21 / C2C), not injected seeds
- Script throws on `missing`, drops `granot_carrier_code_1`, then `$set`s — not this file
- Barrel does not re-export this planner
- No dedicated Moving Carrier Service file; closest knowledge is `tariff.md`
- This checkout’s `CONTEXT.md` does not define Moving Carrier / Granot Carrier Code; `docs/adr/` is absent
