# Session story-routes-extension-auth-2026-09-11T1221Z

- Date (UTC): 2026-09-11
- Service / module: `routes` / `extension-auth.routes.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B (`src/routes/` in-progress)
- Visited / in-progress / unvisited: 42 / 1 / 5
- Recommendations on disk: 312 (through `routes-v1.md`)
- Current service / next module (TRAVERSAL): `routes` (in-progress) / `extension-auth.routes.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/routes-extension-auth.md`
- operations named: admit this Granot extension user to a session (password, no API secret); renew from the refresh token; show who this access token is; acknowledge logout without revoking — never put this desk behind the secret, never hash here, never kick tokens on logout, never issue an Admin login
- remaining in this service: `google-drive-oauth.routes.ts` then the rest of the Wave B routes checklist

## Stock at end

- Visited / in-progress / unvisited: 42 / 1 / 5
- Current service / next module: `routes` (in-progress) / `google-drive-oauth.routes.ts`

## Messages posted

- 2026-09-11T1221Z next

## Ideas parked

- Login and refresh share flatten + refuse — extract `handTheSessionCard`, keep both parents deep
- Logout is a polite goodbye — do not invent a denylist or bump `token_version` here
- `sendAuthError` 500 echoes `error.message` — do not silently import public v1 `sendError`
- `me` has no refuse wrapper — unexpected throw is Express 500
- `readBearerUser` copies `requireApiSecret.readBearerToken` — identify vs gated admit; do not share this pass
- Inline Zod stays in this file until the Wave B validation pass
- 401 strings stay distinct (login vs refresh vs me)
- Sales may still receive tokens here; role-route 403 lives on `requireApiSecret`

## Contradictions

- Knowledge / host rule list the four paths as unguarded; there is no dedicated route test
- `logout` does not revoke; Owner PATCH `token_version` is the kick
- This checkout has no `docs/adr/` and no `daily-operations-admin.routes.ts`
