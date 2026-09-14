# Session story-models-google-picker-selection-2026-09-14T1209Z

- Date (UTC): 2026-09-14T1209Z
- Service / module: `models` / `GooglePickerSelection.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 383
- Current service / next module (TRAVERSAL): `models` (in-progress) / `GooglePickerSelection.ts`

## This pass

- opened new service?: no
- path or skip: recommended → [recommendations/models-google-picker-selection.md](../recommendations/models-google-picker-selection.md)
- operations named: hold the one-time Owner Drive Picker-selection-reference row; remember which unused hash belongs to which configured owner, which pick kind, which Drive-proven file, when it dies, and whether it was already spent; stamp the unnamed unique hash clock plus Mongo TTL and hand back the default-connection model
- remaining in this service: `RingCentralInboundRoute.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `RingCentralInboundRoute.ts`

## Messages posted

- 2026-09-14T1209Z next

## Ideas parked

- none

## Contradictions

- Reporting knowledge never names `google_picker_selections`
- `schema-and-crud-inputs.mdc` Core Collections omits this collection
- File omits `autoIndex: false` and has no selected-database getter
- `owner_email` is required and not unique — a second verify plants a second selection
- Consume is `findOneAndUpdate` stamping `consumed_at`; already-recommended consent hash `findOneAndDelete`s
- Store find / consume **do** filter by `flow`; already-recommended nonce store does not
- Verify writes through the store; already-recommended nonce bootstrap writes the model itself
- Leftover reporting owns fifteen-minute `REPORTING_PICKER_SELECTION_TTL_MS`; nonce TTL is ten minutes; schema TTL is `expireAfterSeconds: 0` on `expires_at`
- Store also filters `expires_at > now` and `consumed_at: null` — Mongo TTL is the sweeper, not the only fence
- Stored `name` / `url` / `mime_type` are snapshots; already-recommended consume returns the later Drive get
- `parent_folder_id` is optional; verify writes it only for spreadsheet
- Named `created_at` only (`updatedAt: false`); durable Drive row has `created_at` / `updated_at`
- Disconnect does not delete leftover selections
- Store `countActive` has no runtime caller
- Job Timeline / historical consolidation / admin verify never read this collection
- Already-recommended company service account is a different identity — do not merge
- Already-recommended `GoogleDriveConnection` / already-recommended `GoogleOAuthState` / already-recommended `GooglePickerNonce` / later `ReportingDestination` are different collections — do not merge
