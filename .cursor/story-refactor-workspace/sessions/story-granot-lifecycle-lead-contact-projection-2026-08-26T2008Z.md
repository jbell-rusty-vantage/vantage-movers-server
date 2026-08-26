# Session story-granot-lifecycle-lead-contact-projection-2026-08-26T2008Z

- Date (UTC): 2026-08-26T2008Z
- Service / module: `granotLifecycle` / `leadContactProjection.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/52

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 11 / 1 / 26
- Recommendations on disk: 48
- Current service / next module (TRAVERSAL): `granotLifecycle` / `leadContactProjection.ts`

## This pass

- opened new service?: no
- path or skip: recommended `src/services/granotLifecycle/leadContactProjection.ts` → [recommendations/granot-lifecycle-lead-contact-projection.md](../recommendations/granot-lifecycle-lead-contact-projection.md)
- operations named: show the landing-page contact and the Granot contact as two masked cards
- remaining in this service: `processor.ts` and the rest of the `granotLifecycle` checklist

## Stock at end

- Visited / in-progress / unvisited: 11 / 1 / 26
- Current service / next module: `granotLifecycle` / `processor.ts`

## Messages posted

- 2026-08-26T2008Z next

## Ideas parked

- none

## Contradictions

- Knowledge titles this file as planner primary code; it does not plan
- Role-safe has no role; WordPress branch is a no-op
- Admin DTO display is `projections.ts`; this file has no runtime caller
- submitted_contact is live fields, not ingested snapshot
- Two mask alphabets (`***` vs `•••`)
