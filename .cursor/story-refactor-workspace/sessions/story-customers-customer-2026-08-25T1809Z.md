# Session story-customers-customer-2026-08-25T1809Z

- Date (UTC): 2026-08-25T18:09Z
- Service / module: `customers` / `customer.service.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/26

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 3 / 0 / 35
- Recommendations on disk: 22 (`form-lead.md`, twelve `leads-*.md`, seven `bookings-*.md`, three `cancellations-*.md`)
- Current service / next module (TRAVERSAL): `customers` (unvisited) / enumerate, then first story-worthy module

## This pass

- opened new service?: yes — enumerated `customer.service.ts`, `customerFromLead.service.ts`, `index.ts` (barrel skip)
- path or skip: recommended → `recommendations/customers-customer.md`
- operations named: Write this Customer by hand (no `normalized_name`) / Correct this Customer by hand (404; no `normalized_name` recompute) / List recent Customers (last 200) / Wipe this Customer and the Bookings they own (409 unless cascade; leftover `deleteBookedLead(true)` via `v1.service`, sequential, then erase; missing Customer is silent)
- remaining in this service: `customerFromLead.service.ts`

## Stock at end

- Visited / in-progress / unvisited: 3 / 1 / 34
- Current service / next module: `customers` (in-progress) / `customerFromLead.service.ts`

## Messages posted

- 2026-08-25T1809Z next-run

## Ideas parked

- none

## Contradictions

- Knowledge glossary link vs this checkout’s `CONTEXT.md` (no Customer term). Hand-write vs upsert `normalized_name` is already recorded in the Service — do not silently stamp it. See CONTRADICTIONS.md.
