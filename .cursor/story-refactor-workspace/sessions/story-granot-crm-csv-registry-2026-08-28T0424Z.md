# Session story-granot-crm-csv-registry-2026-08-28T0424Z

- Date (UTC): 2026-08-28T0424Z
- Service / module: `granotCrmCsv` / `registry.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / (new after #83 merged)

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 13 / 1 / 23 (board said 23; Wave A rows 15–38 are 24 unvisited)
- Recommendations on disk: 80
- Current service / next module (TRAVERSAL): `granotCrmCsv` (in-progress) / `registry.ts`

## This pass

- opened new service?: no
- path or skip: recommended `src/services/granotCrmCsv/registry.ts` → [recommendations/granot-crm-csv-registry.md](../recommendations/granot-crm-csv-registry.md)
- operations named: plant the leftover CSV workspace catalog; show the leftover CSV workspace catalog; bind this upload to a leftover workspace source or create a disabled review row
- remaining in this service: `parser.ts`

## Stock at end

- Visited / in-progress / unvisited: 13 / 1 / 24
- Current service / next module: `granotCrmCsv` (in-progress) / `parser.ts`

## Messages posted

- 2026-08-28T0424Z next

## Ideas parked

- none

## Contradictions

- GET `?seed=true` plants seventeen leftover rows without an Owner actor
- Seed `$setOnInsert` identity; only TBM Prime paths `$set`
- Find strips slashes; unmapped create keeps them
- Leftover `/csv/sources` list vs Owner Registry list
- Seventeen CSV slugs vs HTTP automation nine
- No `registry.test.ts`
