# Delete a Document Row from Current and Remembered Sheet Targets

- Target: `src/services/googleSheets/deleteRows.ts`
- Evidence: `src/services/googleSheets/deleteRows.ts`, `docs/knowledge/services/google-sheets.md`

Keep `deleteRowsFromTargets` as the public operation; it expands fallback targets and remembered allowed targets through getDeleteTargets, preserving spreadsheet:tab dedupe and row-number hints. For each target, validate the cached row holds this Mongo ID; otherwise scan A:ZZ for the first matching data row. Missing row skips that target. After a row is found, fetch the numeric sheet id and issue deleteDimension for zero-based [rowNumber-1,rowNumber).

Preserve actual missing-tab behavior: the helper returns void when the sheet id is absent, and the caller **still appends the target name** after that return. If the tab was already absent during values.get lookup, that provider error can throw before the helper runs. Do not assert a blanket missing-tab no-op or 'only actually deleted targets' guarantee. These are observed limitations to expose, not silently fix during a rename.

Targets process sequentially. Any lookup/get/delete failure rejects and skips remaining targets; previously deleted Google rows remain deleted, and the partial names array is not returned. This differs from syncRowToTargets' per-target catch. The function does not create tabs, save documents, merge sheet_sync or enqueue jobs. Call stale-tab and Bad Leads cleanup choices belong to the facade/drainer; queued bulk delete/quota policy belongs to batchWriter.

Prove verified hint versus rescan, absent row, existing row whose tab disappears before sheet-id lookup (returned target), earlier missing-tab read error, zero-based delete bounds and later-target failure with earlier side effect preserved. A behavior fix for missing-tab reporting needs separate authorization and tests; keep export aliases if a caller migration is chosen.


## Source-verified implementation constraints (2026-10-29)

The retained brief claimed missing tabs never appear in returned deletedTargets; source's void deleteSheetRow returns on missing sheet id, then the caller unconditionally pushes the target. Missing-tab failure before that can also propagate from row lookup.
