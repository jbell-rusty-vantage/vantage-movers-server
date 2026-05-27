# 07 Current Utils Refactor

## Purpose

Sort `api/utils/` into true shared utilities and integration/domain-specific utility folders.

This should happen after the main service extractions reveal which helpers are genuinely shared.

## Read First

- `api/utils/phone.ts`
- `api/utils/ids.ts`
- `api/utils/pickupZipState.ts`
- `api/utils/stateNamesToCodes.ts`
- `api/utils/googleSheetsRanges.ts`
- `api/utils/googleSheetsDiagnostics.ts`
- `api/utils/sanitizeFormLeadForLog.ts`
- `api/utils/sheetRows.ts`
- `api/services/googleSheets.service.ts` or new `api/services/googleSheets/`
- `api/config/domain.ts`

## Current Utility Inventory

- `phone.ts`: true shared phone normalization utility.
- `ids.ts`: lead ID generation.
- `pickupZipState.ts`: location utility with external HTTP behavior.
- `stateNamesToCodes.ts`: location mapping utility.
- `googleSheetsRanges.ts`: Sheets range parsing/escaping.
- `googleSheetsDiagnostics.ts`: Google auth/API diagnostics.
- `sanitizeFormLeadForLog.ts`: form lead PII/logging sanitizer.
- `sheetRows.ts`: likely stale or misplaced form lead row projection.

## Target Files

```text
api/utils/
  phone.ts
  ids.ts
  objectId.ts
  location/
    pickupZipState.ts
    stateNamesToCodes.ts
  googleSheets/
    ranges.ts
    diagnostics.ts
  logging/
    sanitizeForLog.ts
    sanitizeFormLeadForLog.ts
```

Do not create `objectId.ts` unless object ID helpers are used by multiple domains after service extraction.

## Placement Decisions

### Keep In Root Utils

- `phone.ts`: used by models, search, enrichment, reconciliation, and services.
- `ids.ts`: keep root-level unless ID generation becomes lead-only.

### Move To Location Utils

- `pickupZipState.ts` -> `api/utils/location/pickupZipState.ts`
- `stateNamesToCodes.ts` -> `api/utils/location/stateNamesToCodes.ts`

### Move To Sheets Utils Or Service

- `googleSheetsRanges.ts` -> `api/utils/googleSheets/ranges.ts`
- `googleSheetsDiagnostics.ts` -> prefer `api/services/googleSheets/diagnostics.ts` if only the Sheets adapter uses it; use `api/utils/googleSheets/diagnostics.ts` if scripts also need it.

### Move To Logging Utils

- `sanitizeFormLeadForLog.ts` -> `api/utils/logging/sanitizeFormLeadForLog.ts`
- Add `sanitizeForLog.ts` only if multiple sanitizers emerge.

### Audit Or Delete

- `sheetRows.ts`: compare with the new `services/googleSheets/projections/formLeadRow.ts`. If no runtime or script imports `leadToSheetRow`, delete it. If scripts need header constants, import headers from `api/config/domain/sheets.ts` after config split instead of keeping stale row formatting.

## Compatibility Strategy

For low-risk movement, keep temporary re-export files at old paths:

```ts
export * from "./location/pickupZipState";
```

Use this only while imports are being migrated. Remove compatibility files in a later cleanup once no imports use old paths.

## Agent Instructions

1. Use exact import search before moving each utility.
2. Move one utility category at a time.
3. Prefer compatibility re-exports for files with many imports.
4. Do not move sheet row projection into generic utils; it belongs in `services/googleSheets/projections/`.
5. Do not change phone normalization behavior.
6. Do not change location lookup behavior or HTTP behavior.
7. Run `pnpm typecheck` and `pnpm test`.

## Behavioral Invariants

- `normalizePhoneNumber` and phone matching output must not change.
- Zip/state lookup behavior must not change.
- Google Sheets range escaping must not change.
- Google API diagnostic messages and hints must not change unless the Sheets adapter plan explicitly changes them.
- Sanitized log output must not expose more PII than before.

## Suggested Tests

- Keep `api/utils/phone.test.ts` passing.
- Add range helper tests if not already covered.
- If moving `sheetRows.ts`, add a test proving runtime projection uses the new Sheets projection module instead.

## Handoff To Next Agent

Report:

- Which old utility paths still exist as compatibility re-exports.
- Whether `sheetRows.ts` was deleted, retained, or marked stale.
- Whether Google Sheets diagnostics ended up under `services/googleSheets/` or `utils/googleSheets/`.

The next agent can then split validation schemas without chasing utility import churn.
