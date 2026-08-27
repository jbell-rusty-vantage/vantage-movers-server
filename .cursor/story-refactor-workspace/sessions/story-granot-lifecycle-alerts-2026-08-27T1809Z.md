# Session story-granot-lifecycle-alerts-2026-08-27T1809Z

- Date (UTC): 2026-08-27T1809Z
- Service / module: `granotLifecycle` / `alerts.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / new PR after #73 merged

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 11 / 1 / 26
- Recommendations on disk: 70
- Current service / next module (TRAVERSAL): `granotLifecycle` / `alerts.ts`

## This pass

- opened new service?: no
- path or skip: recommended `src/services/granotLifecycle/alerts.ts` → [recommendations/granot-lifecycle-alerts.md](../recommendations/granot-lifecycle-alerts.md)
- operations named: judge the seven frozen rollout problems against what health already counted; tell the company only when a problem just started or just cleared
- remaining in this service: none — `granotLifecycle` visited

## Stock at end

- Visited / in-progress / unvisited: 12 / 0 / 26
- Current service / next module: `granotHttpCollector` (unvisited) / enumerate `src/services/granotHttpCollector/`

## Messages posted

- 2026-08-27T1809Z next

## Ideas parked

- none

## Contradictions

- Knowledge `observability.md` lists this file plus `observability.ts`, `metrics.ts`, and `projectGranotLifecycleHealth` as Primary code
- Alert codes live on `observability.ts`; thresholds live on `config/domain/granotLifecycle.ts` and are not env-overridable
- `alertCatalogFrozen` is unused at runtime; tests freeze codes on the emit sibling
- Persist is untested at this interface; replica health only deletes the events/incidents afterward
- This file never reads `metrics.ts`; p95 samples are Mongo Decision durations health already loaded
- Oldest-due continuity is a pair health already computed (`oldestDue + 15 min`), then this file requires 10 more minutes
- Empty p95 / empty source rates are `insufficient_data` and never recover an open incident
- Firing emit is `warn` (incident upsert); recovery emit is `info` + `autoResolveKey`
- `GRANOT_LIFECYCLE_EMAIL_ENABLED` is unrelated and stays false
- This checkout’s `CONTEXT.md` does not define Operational Event / rollout alert / Section 33
