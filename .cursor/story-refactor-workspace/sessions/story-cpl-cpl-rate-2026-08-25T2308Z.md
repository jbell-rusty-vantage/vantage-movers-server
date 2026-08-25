# Session story-cpl-cpl-rate-2026-08-25T2308Z

- Date (UTC): 2026-08-25T23:08Z
- Service / module: `cpl` / `cplRate.service.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/31

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 6 / 0 / 32
- Recommendations on disk: 27 (`form-lead.md`, twelve `leads-*.md`, seven `bookings-*.md`, three `cancellations-*.md`, two `customers-*.md`, two `agents-*.md`, `lead-source-companies-lead-source-company.md`)
- Current service / next module (TRAVERSAL): `cpl` (unvisited) / enumerate, then first story-worthy module

## This pass

- opened new service?: yes — enumerated `cplRate.service.ts` (no barrel)
- path or skip: recommended → `recommendations/cpl-cpl-rate.md`
- operations named: Read leftover slot CPL / List leftover CPL for the leftover admin page
- remaining in this service: none — `cpl` visited

## Stock at end

- Visited / in-progress / unvisited: 7 / 0 / 31
- Current service / next module: `catalog` (unvisited) / enumerate, then first story-worthy module

## Messages posted

- 2026-08-25T2308Z next-run

## Ideas parked

- none

## Contradictions

- Ghost `updateCplRate` / “Owner-editable” `cpl_rates` vs read-only leftover file. Hot-path comment vs Registry Lead pricing. Nested leftover list vs 14-slot slot read. Leftover `/cpl-rates` vs Owner `/cpl/snapshot`. See CONTRADICTIONS.md.
