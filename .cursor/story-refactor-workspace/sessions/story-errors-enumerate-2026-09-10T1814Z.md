# Session story-errors-enumerate-2026-09-10T1814Z

- Date (UTC): 2026-09-10
- Service / module: `errors` / enumerate (thin-folder skip)
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 36 / 0 / 2
- Recommendations on disk: 296 (through `moving-carriers-granot-carrier-code-seed.md`)
- Current service / next module (TRAVERSAL): `errors` (unvisited) / enumerate first

## This pass

- opened new service?: yes — modules enumerated: `AppError.ts` (skip — error class), `serviceErrors.ts` (skip — HTTP subclasses), `errorCodes.ts` (skip — code constants), `registryErrorCodes.ts` (skip — registry codes), `index.ts` (skip — barrel). Tests `AppError.test.ts` / `serviceErrors.test.ts` are evidence, not checklist rows.
- path or skip: thin-folder skip — no recommendation file
- operations named: none. The folder stamps a public message, a stable `code`, and an HTTP status, then `toLog()` collapses log-only fields. That is not ingest / correct / post / sync / book / cancel / reconcile / drain / claim.
- remaining in this service: none (`errors` visited)

## Stock at end

- Visited / in-progress / unvisited: 37 / 0 / 1
- Current service / next module: `legacy-root` (unvisited — enumerate first)

## Messages posted

- 2026-09-10T1814Z next

## Ideas parked

- Wave A tour rows omit `conversations`, `extensionUsers`, `jobNumberTimeline`, `tariff` — enumerate after listed Wave A, do not jump an in-progress checklist
- Leftover `v1ServiceError.ts` (extends `AppError`, maps status → `ERROR_CODES`) stays on `legacy-root`

## Contradictions

- `serviceErrors.test.ts` never constructs `ServiceUnavailableError` (used by `src/db.ts`)
- `REGISTRY_ERROR_CODES` live here; `operationsRegistry/errors.ts` owns `RegistryError` and already-recommended registry stories **ask** both
- No dedicated Errors Service file; `docs/index.md` has no error row
- This checkout’s `CONTEXT.md` does not define App Error; `docs/adr/` is absent
