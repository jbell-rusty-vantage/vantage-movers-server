# Session story-domain-commands-command-context-2026-09-09T0912Z

- Date (UTC): 2026-09-09
- Service / module: `domainCommands` / `commandContext.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 31 / 1 / 6
- Recommendations on disk: 263 (through `domain-commands-idempotency.md`)
- Current service / next module (TRAVERSAL): `domainCommands` (in-progress) / `commandContext.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/domain-commands-command-context.md`
- operations named: refuse an incomplete envelope (command id, idempotency key, SHA-256); refuse unless this origin’s speaker is trusted (sheet ingestion / vantage admin or compatibility system pair / Granot processor + channel-agrees-with-initiator / RingCentral ingest + server-verified telephony)
- remaining in this service: `ringcentralProvenance.ts`, `entityChange.ts`, `existingWriteContext.ts`, `existingWrites.ts`, `bookings.ts`

## Stock at end

- Visited / in-progress / unvisited: 31 / 1 / 6
- Current service / next module: `domainCommands` (in-progress) / `ringcentralProvenance.ts`

## Messages posted

- 2026-09-09T0912Z next

## Ideas parked

- none

## Contradictions

- Knowledge says Granot’s third initiator is a `vantage_admin` Owner; `isTrustedHumanActor` accepts owner or admin
- File is named `commandContext.ts` but judges a bag; HTTP factory that builds the admin bag is later `existingWriteContext.ts`
- `granot_http_automation` has no dedicated initiator; the Owner who approved the run speaks as `vantage_admin`
- Barrel does not re-export this file; only the executor asks it
- Checksum case is judged here (`/i`) and lowercased next door after a pass
