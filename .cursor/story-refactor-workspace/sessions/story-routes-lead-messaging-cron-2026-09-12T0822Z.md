# Session story-routes-lead-messaging-cron-2026-09-12T0822Z

- Date (UTC): 2026-09-12
- Service / module: `routes` / `lead-messaging-cron.routes.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B (`src/routes/` in-progress)
- Visited / in-progress / unvisited: 42 / 1 / 5
- Recommendations on disk: 332 (through `routes-sheet-sync-cron.md`)
- Current service / next module (TRAVERSAL): `routes` (in-progress) / `lead-messaging-cron.routes.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/routes-lead-messaging-cron.md`
- operations named: after the cron secret proves this tick is ours, wake the due Lead Message drain — never claim a row here, never publish a wake-up, never talk to Twilio, never use the API secret
- remaining in this service: `cpl-correction-cron.routes.ts` then the rest of the Wave B routes checklist

## Stock at end

- Visited / in-progress / unvisited: 42 / 1 / 5
- Current service / next module: `routes` (in-progress) / `cpl-correction-cron.routes.ts`

## Messages posted

- 2026-09-12T0822Z next

## Ideas parked

- Do not copy Sheet Sync’s queued-only route fence onto Lead Messaging cron — leftover inline `pending` still must drain.
- Disabled is `{ claimed: 0, outcomes: { disabled: 1 } }` with HTTP 200, not `{ skipped: true }`.
- No global `lead-messaging:drain` seat and no HTTP `lease_held`.
- Quiet hours is Message Scheduling `sendAt`, not a cron `next_attempt_at`.
- Route 500 echoes `error.message`; consumer throws; rematch has no catch.
- This desk never writes `lead_messaging.drain.completed` — Wave A drain already does after a live scan.
- `connectMongo` lives on the route and the consumer, not inside Wave A drain.
- No factory inject; no dedicated route test today.
- `requireCronAuth` is copied across sibling crons — do not extract in this rename.
- `router.all` is GET-and-POST; Vercel cron GETs.
- Host / hit-vantage-api omit `/api/cron/lead-messaging-drain` and list Owner `lead-messages*`.
- `reason: "cron"` on the wake-up union has no publisher — do not publish from this path.
- Cloud seed booted on `cursor/*`; disk on `docs/story-refactor` won.

## Contradictions

- Always-ask drain (inline leftover `pending`) vs Sheet Sync queued-only HTTP skip
- Disabled counts with HTTP `ok: true` vs rematch / Sheet Sync `{ skipped: true }`
- No global drain seat vs Call Log `lease_held` / Sheet Sync `sheet-sync:drain`
- 500 echoes `error.message` vs Call Log generic 500 vs rematch unhandled Express vs consumer throw
- Host / hit-vantage-api omit `/api/cron/lead-messaging-drain`
