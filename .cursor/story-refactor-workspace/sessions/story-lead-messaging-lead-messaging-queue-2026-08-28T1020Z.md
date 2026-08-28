# Session story-lead-messaging-lead-messaging-queue-2026-08-28T1020Z

- Date (UTC): 2026-08-28T10:20Z
- Service / module: `leadMessaging` / `leadMessagingQueue.service.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/90

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 15 / 1 / 22
- Recommendations on disk: 86
- Current service / next module (TRAVERSAL): `leadMessaging` (in-progress) / `leadMessagingQueue.service.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/lead-messaging-lead-messaging-queue.md`
- operations named: wake the drain for due Lead Messages — never throw, Mongo still owns who sends
- remaining in this service: `twilioAdapter.ts`

## Stock at end

- Visited / in-progress / unvisited: 15 / 1 / 22
- Current service / next module: `leadMessaging` (in-progress) / `twilioAdapter.ts`

## Messages posted

- 2026-08-28T1020Z next-run

## Ideas parked

- none

## Contradictions

- Consumer ignores `{ kind, reason }`
- `cron` is on the reason union and never published
- Skip is silent; fail logs only
- All three callers ignore the boolean
- No operational event on publish fail
- No folder test for this file
- `CONTEXT.md` does not define Lead Message
