# Session story-routes-extension-users-admin-2026-09-11T1822Z

- Date (UTC): 2026-09-11
- Service / module: `routes` / `extension-users-admin.routes.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B (`src/routes/` in-progress)
- Visited / in-progress / unvisited: 42 / 1 / 5
- Recommendations on disk: 318 (through `routes-conversations-admin.md`)
- Current service / next module (TRAVERSAL): `routes` (in-progress) / `extension-users-admin.routes.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/routes-extension-users-admin.md`
- operations named: show the signed Owner every Extension User login newest first (Owner desk list, never create); issue an Extension User login so they can open the Granot extension (Owner POST, Zod then create, 201, never token); correct email password or roles and kick their tokens when something actually changed (Owner PATCH, empty password already omitted, service decides token_version); revoke the login so the email can be issued again (Owner DELETE, hard-remove, `{ id }`) — never put this desk before the secret, never authenticate, never create an Agent, never deactivate, never store Employee, never return the secret
- remaining in this service: `extension-granot-apply.routes.ts` then the rest of the Wave B routes checklist

## Stock at end

- Visited / in-progress / unvisited: 42 / 1 / 5
- Current service / next module: `routes` (in-progress) / `extension-granot-apply.routes.ts`

## Messages posted

- 2026-09-11T1822Z next

## Ideas parked

- This desk sits after `/api/v1` secret; leftover extension login / Drive sit before. Do not remount `requireApiSecret`.
- Zod owns leftover Employee / empty `roles` / empty password omit; this file only parses.
- Project-organization and `schema-and-crud-inputs.mdc` still say singular `{ email, password, role }`; Zod and this desk parse `roles[]`.
- Host rule / operator skill omit PATCH and DELETE; `v1.routes.test.ts` only locks GET.
- `sendError` has `AppError` (409 / 404). Conversations / Job Number desks do not.
- Unhandled `500` echoes `error.message` and does not log (unlike Job Number timeline `"Internal error"`).
- Zod refuse is `"Invalid request payload"` with `issues` (matches extension-auth; not conversations / Job Number).
- Admin is 403 on all four paths; this desk has no read-actor hatch.
- This file does not hash, bump `token_version`, or dual-read leftover Employee.
- Issue is 201; show / correct / revoke are 200.
- Revoke is hard-remove, not deactivate. No last-Owner refuse.
- Junk ObjectId is 400; unknown hex is 404.
- This checkout has no `docs/adr/` and no `daily-operations-admin.routes.ts`.

## Contradictions

- Host rule / operator skill omit PATCH / DELETE
- Project-organization / schema-and-crud still say singular `role`
- Unhandled 500 echoes `error.message` vs Job Number timeline `"Internal error"`
- Zod `issues` vs conversations / Job Number no-`issues` refuse strings
