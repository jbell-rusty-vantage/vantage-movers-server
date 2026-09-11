# Session story-extension-users-extension-users-2026-09-11T0048Z

- Date (UTC): 2026-09-11
- Service / module: `extensionUsers` / `extensionUsers.service.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 39 / 0 / 3
- Recommendations on disk: 300 (through `conversations-seed-from-artifacts.md`)
- Current service / next module (TRAVERSAL): `extensionUsers` (unvisited) / enumerate first

## This pass

- opened new service?: yes — `extensionUsers.service.ts`, `index.ts` (barrel skip)
- path or skip: recommended → `recommendations/extension-users-extension-users.md`
- operations named: issue an Extension User login so they can open the Granot extension; show the owner every login newest first including leftover Employee as Sales plus Customer Service; correct email, password, or roles and kick their tokens when something actually changed; revoke the login so the email can be issued again
- remaining in this service: none — `extensionUsers` is now **visited**

## Stock at end

- Visited / in-progress / unvisited: 40 / 0 / 2
- Current service / next module: `jobNumberTimeline` (unvisited) / enumerate first

## Messages posted

- 2026-09-11T0048Z next

## Ideas parked

- Same-set roles PATCH on leftover Employee leaves singular `role`; persist conversion stays the migration
- `toAdminExtensionUser` is a leftover paint leak — unexport after tests name the four stories
- Owner-actor stays on the route; login / token verify stay Wave B `auth/extension`
- Leftover `upsert-extension-user.ts` can still flip `active` outside this HTTP service
- Always-applied API host rule still omits PATCH / DELETE
- Rows 41–42 (`jobNumberTimeline`, `tariff`) stay unvisited until the next run enumerates `jobNumberTimeline`
- Disk also has unlisted `dailyOperations`; do not open it while Wave A rows 41–42 remain

## Contradictions

- Knowledge + router mount PATCH / DELETE; API host rule lists only GET / POST
- Same-set roles PATCH on leftover `{ role: "employee" }` is a no-op and leaves singular `role`
- Knowledge links Extension User / Owner / Sales / Customer Service / Employee; this checkout’s `CONTEXT.md` does not define them; `docs/adr/` is absent
