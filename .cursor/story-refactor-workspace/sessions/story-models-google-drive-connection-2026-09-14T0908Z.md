# Session story-models-google-drive-connection-2026-09-14T0908Z

- Date (UTC): 2026-09-14T0908Z
- Service / module: `models` / `GoogleDriveConnection.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 380
- Current service / next module (TRAVERSAL): `models` (in-progress) / `GoogleDriveConnection.ts`

## This pass

- opened new service?: no
- path or skip: recommended → [recommendations/models-google-drive-connection.md](../recommendations/models-google-drive-connection.md)
- operations named: hold the Owner Drive connection row; remember which configured owner this ciphertext belongs to; stamp the unnamed unique owner clock and hand back the default-connection model
- remaining in this service: `GoogleOAuthState.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `GoogleOAuthState.ts`

## Messages posted

- 2026-09-14T0908Z next

## Ideas parked

- none

## Contradictions

- Reporting knowledge never names `google_drive_connections`
- `schema-and-crud-inputs.mdc` Core Collections omits this collection
- File omits `autoIndex: false` and has no selected-database getter
- `scopes` is a free string array — this file does not import `ALLOWED_GOOGLE_OAUTH_SCOPES`
- Destination existence (`findOne` by `owner_email`) is not token health
- Complete upsert on `owner_email` preserves `_id` for destination pointers
- No plaintext `refresh_token` field; later `GoogleOAuthState` expires, this row does not
- Job Timeline / historical consolidation / admin status do not read this collection
- Already-recommended company service account is a different identity — do not merge
- Later `GoogleOAuthState` / later picker nonce / later picker selection / later `ReportingDestination` are different collections — do not merge
