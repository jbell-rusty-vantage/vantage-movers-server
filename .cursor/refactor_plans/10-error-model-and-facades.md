# 10 Error Model And Facades Refactor

## Purpose

Introduce a shared service error model and shrink compatibility facades after the code has been moved into domain modules.

This should be late in the sequence because changing error types and route imports too early can obscure whether behavior changed during file movement.

## Read First

- `api/services/v1.service.ts`
- `api/routes/v1.routes.ts`
- `api/middleware/requireApiSecret.ts`
- `api/logger.ts`
- `api/middleware/httpLogger.ts`
- all newly created service folders
- `docs/refactor-and-agentic-documentation-plan.md`

## Current State

`api/services/v1.service.ts` currently exports `V1ServiceError`, and routes likely map thrown service errors to HTTP responses. Several services also throw plain `Error` values for external integration failures.

During earlier refactor tasks, `v1.service.ts`, `googleSheets.service.ts`, `v1.validation.ts`, and `config/domain.ts` should remain compatibility facades. This task reduces those facades only after imports and tests are stable.

## Target Files

```text
api/services/errors/
  AppError.ts
  serviceErrors.ts
  errorCodes.ts
  index.ts
```

Possible route support:

```text
api/routes/
  routeHandler.ts
  errorResponse.ts
```

Only add route helpers if this task explicitly includes route cleanup. Otherwise, keep route behavior unchanged and only add service-side compatibility.

## Error Model Target

`AppError` should eventually carry:

- stable `code`
- `statusCode`
- public `message`
- optional internal detail
- optional `cause`
- safe metadata for logs

Do not leak raw internal or external API errors in public responses.

## Compatibility Strategy

1. Add `AppError`.
2. Make `V1ServiceError` extend `AppError` or become an alias/wrapper while preserving constructor behavior.
3. Update service modules gradually to throw typed errors.
4. Update routes only after services consistently throw typed errors.
5. Keep public response shapes stable unless a separate API change is approved.

## Facade Cleanup Targets

After imports are migrated:

- `api/services/v1.service.ts` should contain no business logic and should either re-export route-facing service functions or be retired after routes import domain facades directly.
- `api/services/googleSheets.service.ts` should re-export from `api/services/googleSheets/googleSheets.service.ts` until all imports use the new path.
- `api/validation/v1.validation.ts` should remain a stable barrel unless route imports are deliberately changed.
- `api/config/domain.ts` can remain a stable barrel long-term.

## Agent Instructions

1. Confirm previous refactor tasks have passed `pnpm typecheck` and `pnpm test`.
2. Add the `services/errors/` folder.
3. Preserve `V1ServiceError` constructor compatibility.
4. Migrate one domain folder at a time to typed errors.
5. Do not rewrite all route error handling unless the task explicitly includes route cleanup.
6. Remove facade exports only after exact import search proves they are unused.
7. Run `pnpm typecheck` and `pnpm test`.

## Behavioral Invariants

- Existing HTTP status codes must not change accidentally.
- Existing public error messages must not change accidentally.
- Logs may gain structured metadata, but should not expose secrets or more PII.
- External integration errors should keep enough internal detail for debugging.
- Routes should remain thin: auth, validation, service call, response.

## Suggested Tests

- `V1ServiceError` remains compatible with current route error mapping.
- New `AppError` exposes public status/message and internal cause separately.
- A representative service still returns the same HTTP status through the route layer.

## Handoff To Future Agents

Report:

- Which domains now throw `AppError` or subclasses.
- Which routes still depend on `V1ServiceError`.
- Which facades are still needed.
- Any planned route-level error wrapper work that was intentionally deferred.
