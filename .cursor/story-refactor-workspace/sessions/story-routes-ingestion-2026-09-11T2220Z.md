# Session story-routes-ingestion-2026-09-11T2220Z

- Date (UTC): 2026-09-11
- Service / module: `routes` / `ingestion.routes.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B (`src/routes/` in-progress)
- Visited / in-progress / unvisited: 42 / 1 / 5
- Recommendations on disk: 322 (through `routes-granot-automation.md`)
- Current service / next module (TRAVERSAL): `routes` (in-progress) / `ingestion.routes.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/routes-ingestion.md`
- operations named: after the secret, let the signed dashboard Owner show and correct the Best Relocation connection, inspect the sheets without writing identity cells, queue a preview or bootstrap or manual run, approve the sealed checksum, show the redacted runs, retry a failed immutable plan, then disposition an open conflict — never claim the apply lease here, never walk the plan here, never honor HTTP repair, never recover on the cron secret, never leak workbook ids or command payloads
- remaining in this service: `reporting.routes.ts` then the rest of the Wave B routes checklist

## Stock at end

- Visited / in-progress / unvisited: 42 / 1 / 5
- Current service / next module: `routes` (in-progress) / `reporting.routes.ts`

## Messages posted

- 2026-09-11T2220Z next

## Ideas parked

- This desk remounts `requireApiSecret` because `app.ts` mounts it after public v1 as a second `/api/v1` router. Granot automation remounts because it sits before v1. Tariff / Owner apply do not remount.
- GET / non-repair inspect ask `requireRegistryReadActor` (Admin may read). Writes ask Owner HMAC. Extension Owner Bearer without HMAC is not enough on writes.
- GET connection does not plant the row. PATCH / preview / heartbeat ask `ensureBestRelocationConnection`.
- Approve CAS and retry clone live in this file, not `repository.ts`.
- Retry checks env and not `application_enabled`. Worker later skips `DEPLOYMENT_GATE_DISABLED`.
- `repair_identity=true` is Owner-gated and still 409.
- `bootstrap` + `dry_run` both true prefers bootstrap.
- `assertObjectId` throws a bare Error → 500.
- `sendError` hides every message, including registry 403. Exported so `ingestion.test.ts` can unit the hide.
- `envGateEnabled` is imported from the next cron file.
- Owner HTTP always 202 and discards `publishIngestionWakeup`. Heartbeat unpublished is 503.
- No factory. Route proof is source-scan + exported refuse, not HMAC HTTP.
- This checkout has no `docs/adr/` and no `daily-operations-admin.routes.ts`.
- Cloud seed booted on `cursor/*`; disk on `docs/story-refactor` won.

## Contradictions

- `sendError` hide vs Granot automation `toHttpBody()` vs Tariff 500 echo
- Bare ObjectId Error → 500
- Retry skips `application_enabled`; approve does not
- GET connection no-plant vs PATCH plant
- GET read-actor (Admin) vs Granot automation GET Owner
