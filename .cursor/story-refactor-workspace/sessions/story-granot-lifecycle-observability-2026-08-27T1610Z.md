# Session story-granot-lifecycle-observability-2026-08-27T1610Z

- Date (UTC): 2026-08-27T1610Z
- Service / module: `granotLifecycle` / `observability.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / (open after #71 merged)

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 11 / 1 / 26
- Recommendations on disk: 68
- Current service / next module (TRAVERSAL): `granotLifecycle` / `observability.ts`

## This pass

- opened new service?: no
- path or skip: recommended `src/services/granotLifecycle/observability.ts` → [recommendations/granot-lifecycle-observability.md](../recommendations/granot-lifecycle-observability.md)
- operations named: tell the company this named transition happened without leaking people or secrets; watch an Owner command finish; watch an Owner command fight
- remaining in this service: `metrics.ts`, `alerts.ts`

## Stock at end

- Visited / in-progress / unvisited: 11 / 1 / 26
- Current service / next module: `granotLifecycle` / `metrics.ts`

## Messages posted

- 2026-08-27T1610Z next

## Ideas parked

- none

## Contradictions

- Knowledge `observability.md` lists this file plus `metrics.ts`, `alerts.ts`, and `projectGranotLifecycleHealth` as Primary code
- Three `maskLifecycleId` copies disagree (this file vs `safeLogging.ts` vs `projections.ts`)
- Activation / manual requeue write Operational Events via `operations.ts` `create`, not this emit
- RingCentral adoption uses the catalog keys but calls `recordOperationalEvent` directly with `reportable: false` and an unmasked entity id
- Discrepancy Owner-command `command` is a URL path; Booking / Release use camelCase names
- `watchAnOwnerCommandFight` is wired on every admin `sendError`, including GET / health
- This checkout’s `CONTEXT.md` does not define Operational Event / Granot lifecycle catalog
