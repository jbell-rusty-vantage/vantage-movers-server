# Session story-models-schema-helpers-2026-09-13T0811Z

- Date (UTC): 2026-09-13T0811Z
- Service / module: `models` / `schemaHelpers.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 356
- Current service / next module (TRAVERSAL): `models` (in-progress) / `schemaHelpers.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/models-schema-helpers.md` (`src/models/schemaHelpers.ts`)
- operations named: Hold the shared Lead source-company, move-type, and Lead-model field contracts; Hold the per-target sheet-row hint subdocument; Drop deleted targets and merge last-write-wins hints by target
- remaining in this service: `WordpressFormSubmissionReceipt.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `WordpressFormSubmissionReceipt.ts`

## Messages posted

- 2026-09-13T0811Z next

## Ideas parked

- none (do not enum SOURCE_COMPANIES on sourceCompanyField; do not add trim so runtime matches historical; do not flip leadModelField optional so Booking owns the helper; do not add status deleted onto SheetSyncEntry; do not merge historical/schemaHelpers.ts; do not copy sourceCompanyField onto Testimonial optional source_company; do not move merge into persistence or drain; do not unique-index sheet_sync.target)

## Contradictions

- Runtime sourceCompanyField is required default `"not_provided"` with no trim and no SOURCE_COMPANIES enum; historical sibling is optional trimmed with no default and no sheetSyncSchema
- SheetSyncEntry never stores `deleted`; persistence owns the delete-marker; drain drops only synced deletes
- leadModelField is required here; Booking / Cancellation spread required: false
- GranotCrmSource asks sourceCompanyField; Testimonial optional source_company does not
- row_number is a hint; Lead ID is identity
- No schemaHelpers.test.ts
- Leftover next WordpressFormSubmissionReceipt.ts is an ingress receipt — do not copy this sheet-hint catalog onto it without reading it
