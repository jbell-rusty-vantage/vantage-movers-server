# Session story-models-google-picker-nonce-2026-09-14T1109Z

- Date (UTC): 2026-09-14T1109Z
- Service / module: `models` / `GooglePickerNonce.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 382
- Current service / next module (TRAVERSAL): `models` (in-progress) / `GooglePickerNonce.ts`

## This pass

- opened new service?: no
- path or skip: recommended → [recommendations/models-google-picker-nonce.md](../recommendations/models-google-picker-nonce.md)
- operations named: hold the one-time Owner Drive Picker-nonce row; remember which unused hash belongs to which configured owner, which pick kind, when it dies, and whether it was already spent; stamp the unnamed unique hash clock plus Mongo TTL and hand back the default-connection model
- remaining in this service: `GooglePickerSelection.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `GooglePickerSelection.ts`

## Messages posted

- 2026-09-14T1109Z next

## Ideas parked

- none

## Contradictions

- Reporting knowledge never names `google_picker_nonces`
- `schema-and-crud-inputs.mdc` Core Collections omits this collection
- File omits `autoIndex: false` and has no selected-database getter
- `owner_email` is required and not unique — a second bootstrap plants a second nonce
- Consume is `findOneAndUpdate` stamping `consumed_at`; already-recommended consent hash `findOneAndDelete`s
- Store find / consume do not filter by `flow`; stored `flow` rides on the row
- Bootstrap writes `GooglePickerNonce.create` itself; the store has no `create`
- Leftover reporting owns ten-minute `REPORTING_PICKER_NONCE_TTL_MS`; schema TTL is `expireAfterSeconds: 0` on `expires_at`
- Store also filters `expires_at > now` and `consumed_at: null` — Mongo TTL is the sweeper, not the only fence
- Named `created_at` only (`updatedAt: false`); durable Drive row has `created_at` / `updated_at`
- Disconnect does not delete leftover nonces
- Job Timeline / historical consolidation / admin bootstrap never read this collection
- Already-recommended company service account is a different identity — do not merge
- Already-recommended `GoogleDriveConnection` / already-recommended `GoogleOAuthState` / later `GooglePickerSelection` are different collections — do not merge
