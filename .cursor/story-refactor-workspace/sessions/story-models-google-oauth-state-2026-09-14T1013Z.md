# Session story-models-google-oauth-state-2026-09-14T1013Z

- Date (UTC): 2026-09-14T1013Z
- Service / module: `models` / `GoogleOAuthState.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 381
- Current service / next module (TRAVERSAL): `models` (in-progress) / `GoogleOAuthState.ts`

## This pass

- opened new service?: no
- path or skip: recommended → [recommendations/models-google-oauth-state.md](../recommendations/models-google-oauth-state.md)
- operations named: hold the one-time Owner Drive consent-hash row; remember which unused hash belongs to which configured owner and when it dies; stamp the unnamed unique hash clock plus Mongo TTL and hand back the default-connection model
- remaining in this service: `GooglePickerNonce.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `GooglePickerNonce.ts`

## Messages posted

- 2026-09-14T1013Z next

## Ideas parked

- none

## Contradictions

- Reporting knowledge never names `google_oauth_states`
- `schema-and-crud-inputs.mdc` Core Collections omits this collection
- File omits `autoIndex: false` and has no selected-database getter
- `owner_email` is required and not unique — a second begin plants a second hash
- Consume is `findOneAndDelete`; later picker nonce stamps `consumed_at`
- Login owns ten-minute `STATE_TTL_MS`; schema TTL is `expireAfterSeconds: 0` on `expires_at`
- Complete also filters `expires_at > now` — Mongo TTL is the sweeper, not the only fence
- Named `created_at` only (`updatedAt: false`); durable Drive row has `created_at` / `updated_at`
- Disconnect does not delete leftover hashes
- Job Timeline / historical consolidation / admin authorize never read this collection
- Already-recommended company service account is a different identity — do not merge
- Already-recommended `GoogleDriveConnection` / later `GooglePickerNonce` / later `GooglePickerSelection` are different collections — do not merge
