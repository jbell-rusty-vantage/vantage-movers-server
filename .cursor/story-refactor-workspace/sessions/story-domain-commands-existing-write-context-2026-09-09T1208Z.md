# Session story-domain-commands-existing-write-context-2026-09-09T1208Z

- Date (UTC): 2026-09-09
- Service / module: `domainCommands` / `existingWriteContext.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 31 / 1 / 6
- Recommendations on disk: 266 (through `domain-commands-entity-change.md`)
- Current service / next module (TRAVERSAL): `domainCommands` (in-progress) / `existingWriteContext.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/domain-commands-existing-write-context.md`
- operations named: name this HTTP write (mint command id, submission-or-request idempotency, payload checksum); name the speaker from already-judged auth (Owner JWT, admin headers plus secret, scoped-key fingerprint, or compatibility API-secret system actor)
- remaining in this service: `existingWrites.ts`, `bookings.ts`

## Stock at end

- Visited / in-progress / unvisited: 31 / 1 / 6
- Current service / next module: `domainCommands` (in-progress) / `existingWrites.ts`

## Messages posted

- 2026-09-09T1208Z next

## Ideas parked

- none

## Contradictions

- Knowledge “Employee role throws” vs every non-Owner JWT refused; error says owner or admin
- `fingerprintScopedApiKey` unused; middleware already hashed
- Admin headers without HMAC; incomplete headers become the API-secret system actor
- Durable key is `submission_id`, not `wordpress_submission_key`
