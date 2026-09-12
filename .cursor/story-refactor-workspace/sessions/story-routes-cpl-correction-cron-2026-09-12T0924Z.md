# Session story-routes-cpl-correction-cron-2026-09-12T0924Z

- Date (UTC): 2026-09-12
- Service / module: `routes` / `cpl-correction-cron.routes.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B (`src/routes/` in-progress)
- Visited / in-progress / unvisited: 42 / 1 / 5
- Recommendations on disk: 333 (through `routes-lead-messaging-cron.md`)
- Current service / next module (TRAVERSAL): `routes` (in-progress) / `cpl-correction-cron.routes.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/routes-cpl-correction-cron.md`
- operations named: after the cron secret proves this tick is ours, wake up to five due prior-Lead CPL rewrite jobs — never claim a lease here, never preview a window, never stamp a Lead, never file or cancel a job, never use the API secret or Owner HMAC
- remaining in this service: `notification-cron.routes.ts` then the rest of the Wave B routes checklist

## Stock at end

- Visited / in-progress / unvisited: 42 / 1 / 5
- Current service / next module: `routes` (in-progress) / `notification-cron.routes.ts`

## Messages posted

- 2026-09-12T0924Z next

## Ideas parked

- Do not copy Sheet Sync’s queued-only route fence onto CPL correction cron — there is no mode/flag gate.
- HTTP `claimed` is `results.length` (jobs asked), not Wave A `result.claimed` (lease won).
- Wave A `runDue` default `limit` is 1; this tick asks 5.
- No global `cpl-correction:drain` seat and no HTTP `lease_held`.
- Route 500 is generic `CPL_CORRECTION_DRAIN_FAILED`; does not echo `error.message`.
- Missing-secret copy is `"CRON_SECRET is not configured"`, not `"is not set"`.
- This desk never writes `cpl_correction.*` letters — Wave A batch already does.
- `connectMongo` lives on the route and leftover Owner HTTP, not inside Wave A `runDue`.
- No factory inject; harness is auth 500/401 status only.
- `requireCronAuth` is copied across sibling crons — do not extract in this rename.
- `router.all` is GET-and-POST; Vercel cron GETs.
- Host / hit-vantage-api omit `/api/cron/cpl-corrections-drain` and list Owner `cpl-corrections*`.
- There is no CPL correction queue consumer — do not invent `publishCplCorrectionWakeup`.
- Cloud seed booted on `cursor/*`; disk on `docs/story-refactor` won.

## Contradictions

- Always-ask wake (empty due is 200 `{ claimed: 0 }`) vs Sheet Sync queued-only HTTP skip vs rematch flag-off skip
- HTTP `claimed` = array length vs Wave A batch `claimed` = lease won vs Call Log `lease_held`
- Generic 500 `CPL_CORRECTION_DRAIN_FAILED` vs Lead Messaging / Sheet Sync echo `error.message` vs rematch unhandled Express
- Missing-secret `"is not configured"` vs sibling `"is not set"` vs reporting `"is not configured."`
- Host / hit-vantage-api omit `/api/cron/cpl-corrections-drain`
- No queue consumer vs Sheet Sync / Lead Messaging / Granot lifecycle wake-up
