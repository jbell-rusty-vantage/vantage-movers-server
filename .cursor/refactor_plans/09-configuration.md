# 09 Configuration Refactor

## Purpose

Split `api/config/domain.ts` into pure domain constants, source-company config, sheet config, CPL resolution, runtime mode config, and Google auth env selection.

This task should happen after service and validation imports are stable because `domain.ts` is widely imported.

## Read First

- `api/config/domain.ts`
- `api/db.ts`
- `api/services/googleSheets.service.ts` or new `api/services/googleSheets/`
- `api/validation/v1.validation.ts` or new validation modules
- `api/models/schemaHelpers.ts`
- `.cursor/rules/schema-and-company-maps.mdc`
- `.cursor/rules/sheet-sync-process.mdc`

## Current Responsibilities

`api/config/domain.ts` currently owns:

- `TEST_MODE` behavior through `isTestMode`.
- Mongo database name selection.
- Source company constants and types.
- Source label and alias resolution.
- Local type, lead model, move size, and sheet sync status constants.
- Sheet tab names and sheet headers.
- Sheet container env var names and mode-aware env var selection.
- Google service account env var selection.
- Source company configs including env-derived CPL values.
- Required env var lookup.

## Target Files

```text
api/config/
  domain.ts
  domain/
    constants.ts
    sources.ts
    sheets.ts
    cpl.ts
    runtime.ts
    googleAuth.ts
```

Suggested ownership:

- `constants.ts`: `LOCAL_TYPES`, `LEAD_MODELS`, `MOVE_SIZES`, `SHEET_SYNC_STATUSES`, shared type exports.
- `sources.ts`: `SOURCE_COMPANIES`, `SOURCE_LABEL_TO_COMPANY`, source aliases, `resolveSourceCompany`, `resolveSourceCompanyFromLabel`, `normalizeSourceCompany`, `getSourceCompanyLabel`, and source metadata that does not read env.
- `sheets.ts`: `SHEET_TAB_NAMES`, sheet headers, sheet container env var names, sheet env var types.
- `cpl.ts`: `getCplForSource` and all env-backed CPL reads.
- `runtime.ts`: `isTestMode`, `getMongoDatabaseName`, `MONGO_DATABASE_NAME`, `getRequiredEnv`, `getRuntimeSheetContainerEnvVar`, sheet container ID functions.
- `googleAuth.ts`: `GOOGLE_SERVICE_ACCOUNT_ENV_VARS`, `getGoogleServiceAccountJsonEnvVar`, `getGoogleServiceAccountJsonBase64EnvVar`.
- `domain.ts`: compatibility barrel.

## Compatibility Barrel

After the split, `api/config/domain.ts` should look like:

```ts
export * from "./domain/constants";
export * from "./domain/sources";
export * from "./domain/sheets";
export * from "./domain/cpl";
export * from "./domain/runtime";
export * from "./domain/googleAuth";
```

Do not migrate all imports in the same task unless the codebase is already stable and typecheck is clean.

## Important Design Decision

Separate pure constants from environment reads.

Pure modules should be safe to import in tests and scripts without requiring env vars. Runtime modules may read env vars, throw missing-env errors, or log selected runtime targets.

## Agent Instructions

1. Create `api/config/domain/`.
2. Move pure constants first.
3. Move sheet names, headers, and env var name constants second.
4. Move source labels and aliases third, but avoid env reads in `sources.ts`.
5. Move CPL lookup to `cpl.ts`; this is where source-company CPL env reads should live.
6. Move runtime mode and sheet ID env resolution to `runtime.ts`.
7. Move Google service account env selector functions to `googleAuth.ts`.
8. Keep `api/config/domain.ts` as a compatibility barrel.
9. Run `pnpm typecheck` and `pnpm test`.

## Behavioral Invariants

- `TEST_MODE=true` must still select `testvantagemovers`.
- Production mode must still select `vantagemovers`.
- Runtime sheet container env vars must still be prefixed with `TEST_` in test mode.
- Google auth env var selection must still use test env names in test mode.
- `not_provided` must still have no source sheet env var and CPL 0.
- Source aliases and label resolution must not change.
- Sheet tab names and header arrays must not change.

## Suggested Tests

- `isTestMode` and `getMongoDatabaseName` with env toggles.
- `getRuntimeSheetContainerEnvVar` in test and production mode.
- Source company alias resolution.
- CPL lookup for simple and local/long-distance sources.
- Google service account env var selector functions.

Use env-reset helpers in tests if adding them. Avoid relying on module-load env state in tests unless the module is reloaded intentionally.

## Handoff To Next Agent

Report:

- Whether `domain.ts` remains a barrel only.
- Which modules contain env reads.
- Any source config pieces that still mix pure metadata and env-derived values.

The next agent should then introduce a shared error model and clean up service facades.
