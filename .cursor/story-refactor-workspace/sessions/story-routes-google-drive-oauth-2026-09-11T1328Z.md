# Session story-routes-google-drive-oauth-2026-09-11T1328Z

- Date (UTC): 2026-09-11
- Service / module: `routes` / `google-drive-oauth.routes.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B (`src/routes/` in-progress)
- Visited / in-progress / unvisited: 42 / 1 / 5
- Recommendations on disk: 313 (through `routes-extension-auth.md`)
- Current service / next module (TRAVERSAL): `routes` (in-progress) / `google-drive-oauth.routes.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/routes-google-drive-oauth.md`
- operations named: finish the Owner's Drive login from Google's unguarded redirect (HTML / 303, never JSON); start consent; show sanitized connection + public config; hand a one-time Picker then verify the pick (no consume route); put a folder; cut the connection; prove a test-shaped workbook — never put the callback behind the secret, never hash tokens here, never consume a Picker reference here, never invent the company service account
- remaining in this service: `ringcentral-registry.routes.ts` then the rest of the Wave B routes checklist

## Stock at end

- Visited / in-progress / unvisited: 42 / 1 / 5
- Current service / next module: `routes` (in-progress) / `ringcentral-registry.routes.ts`

## Messages posted

- 2026-09-11T1328Z next

## Ideas parked

- Per-route `requireApiSecret` is load-bearing because this router mounts before the global `/api/v1` guard
- Callback remaps leftover JSON 403-class failures to 400; denied Google query never emits leftover health
- Leftover health emit only on authorize / status / Picker bootstrap / callback — not verify / folder / disconnect / test-spreadsheet
- `!status.connected` after complete is a persist re-read, not a second owner story
- Picker verify accepts unused display fields; leftover Picker trusts Drive metadata
- No consume HTTP route — leftover destination spends the selection reference
- JSON Zod `invalid_request` is not public v1 / extension-auth `"Invalid request payload"`

## Contradictions

- Knowledge / host rule list the callback as unguarded and the seven owner-gated paths as Drive admin; there is no dedicated route test
- `ownerAuth.test.ts` signs HMAC against the status path string and never boots this router
- This checkout has no `docs/adr/` and no `daily-operations-admin.routes.ts`
