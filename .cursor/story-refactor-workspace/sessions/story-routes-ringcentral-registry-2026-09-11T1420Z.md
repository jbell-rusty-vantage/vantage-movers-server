# Session story-routes-ringcentral-registry-2026-09-11T1420Z

- Date (UTC): 2026-09-11
- Service / module: `routes` / `ringcentral-registry.routes.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B (`src/routes/` in-progress)
- Visited / in-progress / unvisited: 42 / 1 / 5
- Recommendations on disk: 314 (through `routes-google-drive-oauth.md`)
- Current service / next module (TRAVERSAL): `routes` (in-progress) / `ringcentral-registry.routes.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/routes-ringcentral-registry.md`
- operations named: show the inbound-number cards (signed read); record or correct an inactive card (Owner POST 201 / PATCH 200); ask RingCentral if this account can see it; turn it on or move it onto a live call Feed; archive never delete; count dependents without `can_deactivate` — never put this desk before the secret, never stamp last-seen here, never decide which incoming call becomes a Call Lead, never delete the card
- remaining in this service: `granot-lifecycle-admin.routes.ts` then the rest of the Wave B routes checklist

## Stock at end

- Visited / in-progress / unvisited: 42 / 1 / 5
- Current service / next module: `routes` (in-progress) / `granot-lifecycle-admin.routes.ts`

## Messages posted

- 2026-09-11T1420Z next

## Ideas parked

- This desk sits after `/api/v1` secret; Drive / extension login sit before. Do not remount `requireApiSecret`.
- `assignmentHandler` hides activate vs reassign behind a string; POST / PATCH share `createOrUpdateRingCentralRoute`.
- `can_deactivate` is gone on the service; Wave A still names it.
- Folder path-presence misses `/validate` and `/dependencies`.
- Bad `:id` throws empty `ZodError([])`. Zod string is `"Invalid request"`, not v1 `"Invalid request payload"`. Unknown errors rethrow.
- Extension Owner Bearer cannot mutate these paths.

## Contradictions

- Wave A `operations-registry-ring-central-registry.md` still says `can_deactivate: true`; current code + knowledge + `ringCentralRegistry.test.ts` say the field is gone
- Knowledge still lists inbound-route HTTP on `v1.routes.ts`
- `v1.routes.test.ts` CRUD surface list misses `/validate` and `/dependencies`
- This checkout has no `docs/adr/` and no `daily-operations-admin.routes.ts`
