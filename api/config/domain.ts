/**
 * Backward-compatible barrel for the split `./domain/` modules.
 *
 * The original `api/config/domain.ts` mixed pure constants, source
 * metadata, env-derived CPL values, runtime mode handling, and Google auth
 * env selection in one file. That file is now split into focused modules
 * under `./domain/`:
 *
 *   - `./domain/constants` -- pure domain enums (`LOCAL_TYPES`, `LEAD_MODELS`,
 *     `MOVE_SIZES`, `SHEET_SYNC_STATUSES`).
 *   - `./domain/sheets`    -- sheet tab names, header arrays, sheet
 *     container env-var name constants, and sheet env-var-name types.
 *   - `./domain/sources`   -- source-company slugs, labels, aliases,
 *     `SOURCE_COMPANY_CONFIGS` (pure metadata, no env reads), and
 *     normalization helpers.
 *   - `./domain/cpl`       -- env-snapshot CPL table and `getCplForSource`.
 *   - `./domain/runtime`   -- `TEST_MODE`, Mongo DB name, required-env
 *     lookup, and `TEST_`-prefixed Sheet container resolution.
 *   - `./domain/googleAuth` -- Google service-account env-var names and
 *     mode-aware selector functions.
 *
 * Every symbol the original file exported is re-exported here so existing
 * imports like `import { ... } from "../../config/domain"` keep working.
 * New code should prefer importing directly from the focused module.
 */

export * from "./domain/constants";
export * from "./domain/sheets";
export * from "./domain/sources";
export * from "./domain/cpl";
export * from "./domain/runtime";
export * from "./domain/googleAuth";
export * from "./domain/sheetSync";
