# Session story-routes-ringcentral-cron-2026-09-12T0524Z

- Date (UTC): 2026-09-12
- Service / module: `routes` / `ringcentral-cron.routes.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B (`src/routes/` in-progress)
- Visited / in-progress / unvisited: 42 / 1 / 5
- Recommendations on disk: 329 (through `routes-twilio-voice.md`)
- Current service / next module (TRAVERSAL): `routes` (in-progress) / `ringcentral-cron.routes.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/routes-ringcentral-cron.md`
- operations named: after the cron secret proves this tick is ours, wake the Call Log sweep if the flag is on and map a held lease to a safe skip — then once a day snapshot yesterday's inbound answered-over-two-minutes counts — never elect the sweeper here, never page Call Log here, never create a Call Lead, never use the API secret
- remaining in this service: `booking-reconciliation-cron.routes.ts` then the rest of the Wave B routes checklist

## Stock at end

- Visited / in-progress / unvisited: 42 / 1 / 5
- Current service / next module: `routes` (in-progress) / `booking-reconciliation-cron.routes.ts`

## Messages posted

- 2026-09-12T0524Z next

## Ideas parked

- Call Log 500 is generic; snapshot 500 echoes `error.message` and writes a notification-candidate letter.
- Disabled Call Log never claims; `lease_held` is 200 skipped, never 500.
- `requireCronAuth` is copied across sibling crons — do not extract in this rename.
- Today's harness never wakes the snapshot (flag forced off).
- `router.all` is GET-and-POST; Vercel cron GETs.
- Both flags default false; inbound webhook defaults true.
- Host tables / hit-vantage-api omit `/api/cron/ringcentral-*`.
- Cloud seed booted on `cursor/*`; disk on `docs/story-refactor` won.

## Contradictions

- Call Log generic 500 vs snapshot echo + failed letter
- Disabled never-claims vs `lease_held` 200 skip vs throw 500
- Copied `requireCronAuth` vs reporting 503 missing secret
- Host / hit-vantage-api omit `/api/cron/ringcentral-*`
