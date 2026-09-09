# Session story-domain-commands-ringcentral-provenance-2026-09-09T1012Z

- Date (UTC): 2026-09-09
- Service / module: `domainCommands` / `ringcentralProvenance.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 31 / 1 / 6
- Recommendations on disk: 264 (through `domain-commands-command-context.md`)
- Current service / next module (TRAVERSAL): `domainCommands` (in-progress) / `ringcentralProvenance.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/domain-commands-ringcentral-provenance.md`
- operations named: refuse a blank telephony identity; prove the named path (Call Log exact `ringcentral:call_log_sync:${receipt}` without the session store, or webhook exact `ringcentral:webhook:${receipt}` plus a live session whose telephony id matches)
- remaining in this service: `entityChange.ts`, `existingWriteContext.ts`, `existingWrites.ts`, `bookings.ts`

## Stock at end

- Visited / in-progress / unvisited: 31 / 1 / 6
- Current service / next module: `domainCommands` (in-progress) / `entityChange.ts`

## Messages posted

- 2026-09-09T1012Z next

## Ideas parked

- none

## Contradictions

- Knowledge `applies_to` omits this file while Command origins names the function
- Leftover identity can be `callLogId`; webhook proof treats receipt as telephony session id
- Call Log is format-only; webhook find may `connectMongo` before the executor’s own connect
- Webhook proof ignores `ingestEligible`
