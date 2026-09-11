# Session story-routes-granot-automation-2026-09-11T2118Z

- Date (UTC): 2026-09-11
- Service / module: `routes` / `granot-automation.routes.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B (`src/routes/` in-progress)
- Visited / in-progress / unvisited: 42 / 1 / 5
- Recommendations on disk: 321 (through `routes-tariff-adjustments.md`)
- Current service / next module (TRAVERSAL): `routes` (in-progress) / `granot-automation.routes.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/routes-granot-automation.md`
- operations named: after the secret, let the signed dashboard Owner keep the exact Granot labels, queue a durable Form or Call run or a correlated group, show the redacted run, approve selected actions, then wake the worker — never write a Lead, never call the leftover CSV writes, never capture a receipt here, never recover on the cron secret, never admit Admin or Sales or leftover Employee, never close the label-only gap
- remaining in this service: `ingestion.routes.ts` then the rest of the Wave B routes checklist

## Stock at end

- Visited / in-progress / unvisited: 42 / 1 / 5
- Current service / next module: `routes` (in-progress) / `ingestion.routes.ts`

## Messages posted

- 2026-09-11T2118Z next

## Ideas parked

- This desk remounts `requireApiSecret` because `app.ts` mounts it before public v1. Tariff / Owner apply do not remount.
- Every handler asks `requireRegistryOwnerActor`, including GET. Admin HMAC is FORBIDDEN. Extension Owner Bearer without HMAC is not enough. Unsigned preview never reached.
- Approve always inlines `runGranotWorker` when `VERCEL !== "1"`. Create / group only inline when `!queue_published`.
- Run-group local-worker loop ignores `_run`.
- One-run Zod allows `source_labels` only — known `createGranotRun` gap. Leave it.
- Date-window / filters Zod copied twice. `parseGranotDate` is the real calendar decision.
- `sendError` 502 hides provider text. 500 is `GRANOT_AUTOMATION_FAILED` `"Granot automation failed"` (no `error.message` echo).
- Route test is stack-scan + sibling source-scan. No factory. No HMAC HTTP.
- This checkout has no `docs/adr/` and no `daily-operations-admin.routes.ts`.
- Cloud seed booted on `cursor/*`; disk on `docs/story-refactor` won.

## Contradictions

- Knowledge names create / group inline worker; approve always inlines on non-Vercel without checking `queue_published`
- Lifecycle admin GET uses `requireRegistryReadActor` (Admin can read); this desk GET uses Owner HMAC
- Label-only `createGranotRun` skip of `resolveGranotAutomationSources` stays open (CONTRADICTIONS already records it)
- `sendError` 500 hide vs Tariff 500 echo vs Job Number `"Internal error"`
- Route test never HTTP-posts; sibling Tariff injects
